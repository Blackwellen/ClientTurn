import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEntitlements } from "@/lib/billing/entitlements";
import { canSend, summariseEligibility } from "./channel-policy";
import { packForCountry } from "./packs";
import { checkSuppression } from "./suppression";
import {
  POLICY_CHANNELS,
  type CampaignType,
  type ConsentStatus,
  type OutreachEligibility,
  type PolicyChannel,
  type PolicyDecision,
  type PolicyInput,
  type RelationshipType,
  type SubscriberType,
} from "./types";

/**
 * ChannelPolicyService — the I/O half (V4 §67).
 *
 * `evaluate()` gathers everything the pure rules in `channel-policy.ts` need,
 * runs them, and records the decision with its policy version and evidence
 * snapshot so an audit can reconstruct why a send was permitted or blocked
 * even after the pack changes (§91.3).
 *
 * Callers must treat a thrown error as a blocked send. Every failure mode here
 * — an unreachable suppression list, a missing pack — is one where proceeding
 * would be worse than stopping.
 */

export type PolicySubject = {
  type: "LEAD" | "PROSPECT";
  id: string;
  email?: string | null;
  phone?: string | null;
  social?: string | null;
  country?: string | null;
  subscriberType?: SubscriberType;
  relationshipType?: RelationshipType;
  consentStatus?: ConsentStatus;
  hasConsentEvidence?: boolean;
  optedOut?: boolean;
  /** Recipient timezone; falls back to the workspace's. */
  timezone?: string | null;
};

export type EvaluateOptions = {
  businessId: string;
  subject: PolicySubject;
  channel: PolicyChannel;
  campaignType: CampaignType;
  /** Skip the cap/budget checks when only permission matters (e.g. rendering
   *  an eligibility badge, where "you are out of allowance" is not the answer
   *  the user is asking for). */
  permissionOnly?: boolean;
  /** Sender readiness, resolved by the caller that owns the channel. */
  sender?: { available: boolean; health: "HEALTHY" | "WATCH" | "WARNING" | "PAUSED" };
  caps?: { withinDaily: boolean; withinMonthly: boolean; withinBudget: boolean };
  /** Persist the decision. Off for speculative checks in list rendering. */
  record?: boolean;
  at?: Date;
};

function destinationFor(subject: PolicySubject, channel: PolicyChannel): string | null {
  if (channel === "EMAIL") return subject.email?.trim() || null;
  if (channel === "SOCIAL") return subject.social?.trim() || null;
  return subject.phone?.trim() || null;
}

/** Local wall-clock in the recipient's timezone, for the quiet-hours rule. */
function localTimeIn(timezone: string | null | undefined, at: Date) {
  const zone = timezone || "Europe/London";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return { hour, minute };
  } catch {
    // An invalid timezone must not crash a send decision.
    return { hour: at.getUTCHours(), minute: at.getUTCMinutes() };
  }
}

/**
 * Loads the stored permission record for a subject, if the workspace has one.
 * Absent permission is not the same as denied permission — it means UNKNOWN,
 * which the rules turn into a review or consent request as appropriate.
 */
async function loadPermission(businessId: string, subject: PolicySubject) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("contact_permissions")
    .select(
      "relationship_type, consent_status, consent_evidence, subscriber_type, country",
    )
    .eq("business_id", businessId)
    .eq("subject_type", subject.type)
    .eq("subject_id", subject.id)
    .maybeSingle();
  return data;
}

export async function evaluate(options: EvaluateOptions): Promise<PolicyDecision> {
  const { businessId, subject, channel, campaignType } = options;
  const at = options.at ?? new Date();

  const [permission, entitlements] = await Promise.all([
    loadPermission(businessId, subject),
    getEntitlements(businessId),
  ]);

  const country = subject.country ?? permission?.country ?? null;
  const pack = await packForCountry(country);

  const destination = destinationFor(subject, channel);

  // Only look up suppression when there is something to look up; the RPC would
  // return nothing anyway, and this keeps list rendering cheap.
  const suppression = destination
    ? await checkSuppression(businessId, channel, {
        email: channel === "EMAIL" ? destination : subject.email,
        phone: channel === "SMS" || channel === "WHATSAPP" ? destination : subject.phone,
        social: channel === "SOCIAL" ? destination : subject.social,
      })
    : null;

  const caps = options.permissionOnly
    ? { withinDaily: true, withinMonthly: true, withinBudget: true }
    : (options.caps ?? { withinDaily: true, withinMonthly: true, withinBudget: true });

  const sender = options.permissionOnly
    ? { available: true, health: "HEALTHY" as const }
    : (options.sender ?? { available: true, health: "HEALTHY" as const });

  const input: PolicyInput = {
    channel,
    campaignType,
    country,
    subscriberType:
      subject.subscriberType ?? (permission?.subscriber_type as SubscriberType) ?? "UNKNOWN",
    relationshipType:
      subject.relationshipType ?? (permission?.relationship_type as RelationshipType) ?? "UNKNOWN",
    consentStatus:
      subject.consentStatus ?? (permission?.consent_status as ConsentStatus) ?? "UNKNOWN",
    hasConsentEvidence:
      subject.hasConsentEvidence ?? Boolean(permission?.consent_evidence),
    destination,
    suppression: suppression
      ? { reason: suppression.reason, scope: suppression.scope }
      : null,
    optedOut: subject.optedOut ?? false,
    businessActive: entitlements.active,
    senderAvailable: sender.available,
    senderHealth: sender.health,
    withinDailyCap: caps.withinDaily,
    withinMonthlyCap: caps.withinMonthly,
    withinBudget: caps.withinBudget,
    localTime: localTimeIn(subject.timezone, at),
    pack,
  };

  const decision = canSend(input);

  if (options.record !== false) {
    await recordDecision(businessId, subject, channel, campaignType, input, decision);
  }

  return decision;
}

/**
 * Persists the decision and the inputs that produced it. Upserted per
 * (subject, channel, campaign type) so the current state is one row, while the
 * durable audit trail of *changes* lives in compliance_decisions and the
 * activity log.
 *
 * Never throws: a failure to record must not block a send that policy allowed,
 * nor allow one it refused.
 */
async function recordDecision(
  businessId: string,
  subject: PolicySubject,
  channel: PolicyChannel,
  campaignType: CampaignType,
  input: PolicyInput,
  decision: PolicyDecision,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("contactability_results")
    .upsert(
      {
        business_id: businessId,
        subject_type: subject.type,
        subject_id: subject.id,
        channel,
        campaign_type: campaignType,
        country: input.country,
        subscriber_type: input.subscriberType,
        relationship_type: input.relationshipType,
        result: decision.outcome,
        reason_code: decision.reasonCode,
        policy_version: decision.policyVersion,
        evidence_json: {
          consent_status: input.consentStatus,
          has_consent_evidence: input.hasConsentEvidence,
          opted_out: input.optedOut,
          suppression: input.suppression,
          sender_health: input.senderHealth,
          sender_available: input.senderAvailable,
          within_caps: {
            daily: input.withinDailyCap,
            monthly: input.withinMonthlyCap,
            budget: input.withinBudget,
          },
          requirements: decision.requirements ?? [],
          pack: input.pack.name,
        },
        evaluated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,subject_type,subject_id,channel,campaign_type" },
    )
    .then(
      () => undefined,
      () => undefined,
    );
}

/**
 * Evaluates every channel at once and returns the single eligibility label the
 * Prospect and Lead surfaces display, plus the per-channel detail the
 * permission grid needs.
 */
export async function evaluateAllChannels(
  businessId: string,
  subject: PolicySubject,
  campaignType: CampaignType,
  options: { record?: boolean } = {},
): Promise<{
  eligibility: OutreachEligibility;
  byChannel: Record<PolicyChannel, PolicyDecision>;
}> {
  const decisions = await Promise.all(
    POLICY_CHANNELS.map((channel) =>
      evaluate({
        businessId,
        subject,
        channel,
        campaignType,
        permissionOnly: true,
        record: options.record ?? false,
      }),
    ),
  );

  const byChannel = Object.fromEntries(
    POLICY_CHANNELS.map((channel, index) => [channel, decisions[index]]),
  ) as Record<PolicyChannel, PolicyDecision>;

  return { eligibility: summariseEligibility(decisions), byChannel };
}

/**
 * Records the relationship and consent evidence a human supplied — the Add
 * Lead wizard's permission step, the import classifier, or a support action.
 *
 * Upserted per subject: a workspace holds one current permission record per
 * contact, and changing it is an audited event, not a silent overwrite.
 */
export async function recordPermission(input: {
  businessId: string;
  subject: { type: "LEAD" | "PROSPECT"; id: string };
  relationshipType: RelationshipType;
  relationshipDetail?: string | null;
  consentStatus?: ConsentStatus;
  consentEvidence?: string | null;
  consentSource?: string | null;
  subscriberType?: SubscriberType;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  recordedBy?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from("contact_permissions").upsert(
    {
      business_id: input.businessId,
      subject_type: input.subject.type,
      subject_id: input.subject.id,
      email: input.email ?? null,
      phone_e164: input.phone ?? null,
      relationship_type: input.relationshipType,
      relationship_detail: input.relationshipDetail ?? null,
      consent_status: input.consentStatus ?? "UNKNOWN",
      consent_evidence: input.consentEvidence ?? null,
      consent_source: input.consentSource ?? null,
      consent_captured_at: input.consentEvidence ? new Date().toISOString() : null,
      subscriber_type: input.subscriberType ?? "UNKNOWN",
      country: input.country ?? null,
      recorded_by: input.recordedBy ?? null,
    },
    { onConflict: "business_id,subject_type,subject_id" },
  );
}

export { canSend, summariseEligibility } from "./channel-policy";
export * from "./types";
