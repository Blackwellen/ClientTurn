import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEntitlements } from "@/lib/billing/entitlements";
import { canSend, summariseEligibility } from "./channel-policy";
import { packForCountry } from "./packs";
import { checkSuppression } from "./suppression";
import { loadDataControls } from "@/lib/compliance/queries";
import { verdictForSources } from "@/lib/compliance/types";
import {
  POLICY_CHANNELS,
  decisionColumnFor,
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
  /**
   * Append an evidence row to `compliance_decisions`.
   *
   * Separate from `record`, because the two tables answer different questions
   * and are written at different rates. `contactability_results` is current
   * state and is upserted, so refreshing it is cheap however often it happens.
   * `compliance_decisions` is append-only: every write is permanent, and a
   * caller that refreshes a whole permission grid would file seven "decisions"
   * for one question nobody asked.
   *
   * On by default wherever `record` is, and turned off by `evaluateAllChannels`,
   * which is a state refresh across every channel rather than a decision about
   * any one of them.
   */
  evidence?: boolean;
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
 * The provenance types recorded against a subject.
 *
 * Prospects carry per-field provenance in `prospect_data_sources`. Leads carry
 * one source on `lead_sources`, which is mapped onto the same vocabulary so a
 * single rule can judge both — the question "where did this record come from"
 * does not change depending on which table it happens to live in.
 */
async function loadProvenance(
  businessId: string,
  subject: PolicySubject,
): Promise<string[]> {
  const admin = createAdminClient();

  if (subject.type === "PROSPECT") {
    const { data } = await admin
      .from("prospect_data_sources")
      .select("source_type")
      .eq("business_id", businessId)
      .eq("prospect_id", subject.id)
      .limit(100);
    return [...new Set((data ?? []).map((row) => row.source_type))];
  }

  const { data: lead } = await admin
    .from("leads")
    .select("source_id")
    .eq("business_id", businessId)
    .eq("id", subject.id)
    .maybeSingle();

  if (!lead?.source_id) return [];

  const { data: source } = await admin
    .from("lead_sources")
    .select("provider")
    .eq("id", lead.source_id)
    .maybeSingle();

  // A lead arrives through one of a small, closed set of routes. Anything not
  // named here yields no provenance, which the rules read as UNKNOWN.
  const byProvider: Record<string, string> = {
    meta: "FIRST_PARTY",
    webform: "FIRST_PARTY",
    test: "FIRST_PARTY",
    csv: "IMPORT",
    manual: "MANUAL",
  };

  const mapped = source?.provider ? byProvider[source.provider] : undefined;
  return mapped ? [mapped] : [];
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

  const [permission, entitlements, controls, provenance] = await Promise.all([
    loadPermission(businessId, subject),
    getEntitlements(businessId),
    loadDataControls(businessId),
    // Only cold outreach consults this, so the lookup is skipped for the warm
    // paths that make up most traffic.
    campaignType === "COLD" ? loadProvenance(businessId, subject) : Promise.resolve([]),
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
    sourcePermitted:
      campaignType === "COLD"
        ? verdictForSources(provenance, controls.allowedSources)
        : // Not consulted for warm contact: the relationship is the basis, and
          // how the record was filed adds nothing to it.
          "PERMITTED",
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
    await recordDecision(businessId, subject, channel, campaignType, input, decision, {
      evidence: options.evidence ?? true,
    });
  }

  return decision;
}

/**
 * Persists the decision, twice, into two tables that answer different questions.
 *
 *   * `contactability_results` is **current state**, upserted per
 *     (subject, channel, campaign type). "Can we email this person today?" One
 *     row, overwritten each time it is asked.
 *   * `compliance_decisions` is the **append-only evidence trail**. "What did we
 *     decide, on what basis, under which policy version, at the moment we sent
 *     that message in March?" An upsert cannot answer that, because answering it
 *     requires the row not to have been overwritten since.
 *
 * The second write did not exist. This function's own comment claimed the
 * durable trail "lives in compliance_decisions", and nothing in the codebase
 * wrote a single row to it — while two admin surfaces read it: the per-version
 * decision count, and the compliance **review queue**, whose items are supposed
 * to be the evaluations the engine could not decide alone. That queue could
 * never receive an item, so a human-review workflow silently did nothing.
 *
 * Never throws: a failure to record must not block a send that policy allowed,
 * nor allow one it refused. Evidence is worth a great deal and it is not worth
 * more than the decision itself being applied correctly.
 */
async function recordDecision(
  businessId: string,
  subject: PolicySubject,
  channel: PolicyChannel,
  campaignType: CampaignType,
  input: PolicyInput,
  decision: PolicyDecision,
  options: { evidence: boolean },
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
          source_permitted: input.sourcePermitted,
        },
        evaluated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,subject_type,subject_id,channel,campaign_type" },
    )
    .then(
      () => undefined,
      () => undefined,
    );

  if (!options.evidence) return;

  // The evidence row. Insert, never upsert: a decision that has been made is a
  // fact about a moment, and a second evaluation tomorrow is a second fact, not
  // a correction of the first.
  await admin
    .from("compliance_decisions")
    .insert({
      business_id: businessId,
      subject_type: subject.type,
      subject_id: subject.id,
      channel,
      decision: decisionColumnFor(decision),
      // The sentence written for a person, which is the point of a rationale
      // column: a reader of the review queue needs to know why, not to look up
      // a code.
      rationale: decision.message,
      policy_version: decision.policyVersion,
      // Deliberately the same evidence the state row carries. Reconstructing a
      // past decision means seeing the inputs, not just the verdict, and the
      // two must not be able to disagree about what those inputs were.
      evidence_json: {
        campaign_type: campaignType,
        country: input.country,
        subscriber_type: input.subscriberType,
        relationship_type: input.relationshipType,
        reason_code: decision.reasonCode,
        outcome: decision.outcome,
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
        source_permitted: input.sourcePermitted,
      } as never,
      // Nobody pressed a button. This is the engine deciding, and saying so is
      // what distinguishes it from an operator override in the same table.
      decided_by: null,
      decided_by_admin: false,
      decided_at: new Date().toISOString(),
    })
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
        // State refresh, not seven decisions. See `evidence` on EvaluateOptions.
        evidence: false,
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
