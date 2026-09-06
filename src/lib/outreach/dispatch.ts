import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { evaluate } from "@/lib/policy/service";
import { sendEmail, unsubscribeUrl } from "@/lib/email/smtp";
import { normaliseEmail } from "@/lib/prospects/dedupe";
import { mergeValuesFor, renderTemplate } from "./templates";

/**
 * Cold outreach dispatch (V4 §17).
 *
 * This is what makes "auto-contact" mean something. A sourcing run that
 * finishes in AUTO_CONTACT mode enqueues this, and it sends the campaign's
 * first step to prospects that are READY and ELIGIBLE.
 *
 * The rule it exists to enforce: **being in a campaign is not permission to
 * send.** Everything the sourcing run concluded about a prospect is treated as
 * stale here. Contactability is re-evaluated per recipient, immediately before
 * the send, against live suppression and live policy — because a person can
 * opt out between being sourced and being contacted, and that opt-out has to
 * win.
 *
 * Deliberately single-step. Multi-step sequences, delays between steps, A/B
 * variants and warmup ramping are a separate engine that does not exist yet;
 * this sends step 1 and stops. `outreach_recipient_runs` carries the position
 * so that engine can pick up where this leaves off without a migration.
 */

/** Never send more than this in one job invocation, whatever the caps say. */
const MAX_PER_INVOCATION = 25;

export type DispatchOutcome = {
  sent: number;
  skipped: number;
  blocked: number;
  /** Set when the campaign cannot dispatch at all. */
  haltReason: string | null;
  /** True when prospects remain and the job should be re-queued. */
  more: boolean;
};

type Step = {
  sequenceId: string;
  position: number;
  subjectTemplate: string | null;
  bodyTemplate: string;
};

export async function dispatchCampaign(input: {
  businessId: string;
  campaignId: string;
}): Promise<DispatchOutcome> {
  const admin = createAdminClient();
  const empty: DispatchOutcome = {
    sent: 0,
    skipped: 0,
    blocked: 0,
    haltReason: null,
    more: false,
  };

  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select(
      "id, name, status, sender_identity_id, active_sequence_id, review_before_outreach, daily_contact_cap, prospects_per_run",
    )
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .maybeSingle();

  if (!campaign) return { ...empty, haltReason: "CAMPAIGN_NOT_FOUND" };
  if (campaign.status !== "ACTIVE") return { ...empty, haltReason: "CAMPAIGN_NOT_ACTIVE" };

  // A campaign configured for human review does not auto-send, whatever
  // enqueued this. The flag is checked here as well as at run creation because
  // it can be turned on after the run started.
  if (campaign.review_before_outreach) {
    return { ...empty, haltReason: "REVIEW_REQUIRED" };
  }

  const step = await loadFirstStep(input.businessId, campaign.active_sequence_id);
  if (!step) return { ...empty, haltReason: "NO_PUBLISHED_STEP" };

  const { data: sender } = await admin
    .from("sender_identities")
    .select("id, display_name, email, signature_text, postal_footer, cold_enabled, active, status")
    .eq("business_id", input.businessId)
    .eq("id", campaign.sender_identity_id ?? "")
    .maybeSingle();

  // Cold sending is opt-in per sender and gated on the sender being proved to
  // work. An unverified sender is not a sender.
  if (!sender || !sender.active || !sender.cold_enabled) {
    return { ...empty, haltReason: "SENDER_NOT_AVAILABLE" };
  }
  if (sender.status !== "VERIFIED") {
    return { ...empty, haltReason: "SENDER_NOT_VERIFIED" };
  }

  const { data: business } = await admin
    .from("businesses")
    .select("name, timezone")
    .eq("id", input.businessId)
    .maybeSingle();

  const batchSize = Math.min(
    MAX_PER_INVOCATION,
    Math.max(0, campaign.prospects_per_run || MAX_PER_INVOCATION),
  );

  // Prospects already enrolled are excluded by the unique index on
  // (campaign_id, prospect_id); this selects the ones with no run yet.
  const { data: enrolled } = await admin
    .from("outreach_recipient_runs")
    .select("prospect_id")
    .eq("business_id", input.businessId)
    .eq("campaign_id", campaign.id);

  const already = new Set((enrolled ?? []).map((row) => row.prospect_id));

  const { data: candidates } = await admin
    .from("prospects")
    .select(
      "id, first_name, last_name, role_title, email, unsubscribe_token, status, outreach_eligibility, company:prospect_companies(name, location_json)",
    )
    .eq("business_id", input.businessId)
    .eq("campaign_id", campaign.id)
    .eq("status", "READY")
    .eq("outreach_eligibility", "ELIGIBLE")
    .not("email", "is", null)
    .limit(batchSize + already.size);

  const queue = (candidates ?? [])
    .filter((prospect) => !already.has(prospect.id))
    .slice(0, batchSize);

  if (queue.length === 0) return empty;

  let sent = 0;
  let skipped = 0;
  let blocked = 0;

  for (const prospect of queue) {
    const email = normaliseEmail(prospect.email);
    if (!email) {
      skipped += 1;
      continue;
    }

    const company = Array.isArray(prospect.company) ? prospect.company[0] : prospect.company;
    const location = (company?.location_json ?? {}) as { country?: string };

    // The authoritative check, at send time. `record: true` writes the decision
    // so a customer asking "why was this person contacted" has an answer.
    const decision = await evaluate({
      businessId: input.businessId,
      subject: {
        type: "PROSPECT",
        id: prospect.id,
        email,
        country: location.country ?? null,
        subscriberType: "CORPORATE",
        relationshipType: "FOUND_BY_US",
        timezone: business?.timezone ?? null,
      },
      channel: "EMAIL",
      campaignType: "COLD",
      sender: { available: true, health: "HEALTHY" },
      record: true,
    });

    if (decision.outcome !== "ALLOWED") {
      blocked += 1;
      await recordBlocked(input, campaign.id, step, prospect.id, decision.reasonCode);
      continue;
    }

    // Reserve a slot against the sender's daily cap before sending, atomically,
    // so two workers cannot both take the last one.
    const { data: claimed } = await admin.rpc("claim_sender_send_slot", {
      p_business_id: input.businessId,
      p_sender_id: sender.id,
    });

    if (!claimed) {
      // Not a failure — the cap is doing its job. Stop and let the next
      // invocation continue tomorrow.
      return { sent, skipped, blocked, haltReason: "SENDER_DAILY_CAP", more: true };
    }

    const values = mergeValuesFor(
      { ...prospect, company: company ? { name: company.name } : null },
      business?.name ?? "",
    );

    const body = [
      renderTemplate(step.bodyTemplate, values),
      sender.signature_text ?? "",
      // Cold B2B email in the UK must identify the sender in the message.
      sender.postal_footer ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const sendKey = `outreach:${campaign.id}:${prospect.id}:${step.position}`;

    const result = await sendEmail({
      businessId: input.businessId,
      to: email,
      subject: renderTemplate(step.subjectTemplate ?? "", values) || campaign.name,
      html: body,
      // A working one-click unsubscribe is what makes this send lawful.
      unsubscribeUrl: unsubscribeUrl(prospect.unsubscribe_token),
      sendKey,
    });

    if (!result.ok) {
      await admin.from("outreach_recipient_runs").insert({
        business_id: input.businessId,
        campaign_id: campaign.id,
        sequence_id: step.sequenceId,
        prospect_id: prospect.id,
        status: result.permanent ? "BOUNCED" : "FAILED",
        stop_reason: result.errorCode,
        current_step_position: step.position,
      });

      if (result.permanent) {
        await admin
          .from("prospects")
          .update({ status: "BOUNCED", outreach_eligibility: "SUPPRESSED" })
          .eq("business_id", input.businessId)
          .eq("id", prospect.id);
      }

      skipped += 1;
      continue;
    }

    await admin.from("outreach_recipient_runs").insert({
      business_id: input.businessId,
      campaign_id: campaign.id,
      sequence_id: step.sequenceId,
      prospect_id: prospect.id,
      status: "ACTIVE",
      current_step_position: step.position,
      steps_sent: 1,
      last_sent_at: new Date().toISOString(),
    });

    await admin
      .from("prospects")
      .update({
        status: "OUTREACH_ACTIVE",
        last_contacted_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      })
      .eq("business_id", input.businessId)
      .eq("id", prospect.id);

    sent += 1;
  }

  if (sent > 0) {
    await recordAudit({
      businessId: input.businessId,
      actorType: "system",
      action: "outreach.dispatched",
      entityType: "outreach_campaign",
      entityId: campaign.id,
      metadata: { sent, skipped, blocked, step: step.position },
    });
  }

  return { sent, skipped, blocked, haltReason: null, more: queue.length === batchSize };
}

async function loadFirstStep(
  businessId: string,
  sequenceId: string | null,
): Promise<Step | null> {
  const admin = createAdminClient();

  // Only a PUBLISHED sequence sends. A draft is someone still writing.
  const { data: sequence } = sequenceId
    ? await admin
        .from("outreach_sequences")
        .select("id, status")
        .eq("business_id", businessId)
        .eq("id", sequenceId)
        .maybeSingle()
    : { data: null };

  if (!sequence || sequence.status !== "PUBLISHED") return null;

  const { data: step } = await admin
    .from("outreach_steps")
    .select("sequence_id, position, subject_template, body_template, channel, enabled")
    .eq("business_id", businessId)
    .eq("sequence_id", sequence.id)
    .eq("enabled", true)
    .eq("channel", "EMAIL")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!step) return null;

  return {
    sequenceId: step.sequence_id,
    position: step.position,
    subjectTemplate: step.subject_template,
    bodyTemplate: step.body_template,
  };
}

/** Records why a prospect was not contacted, so the decision is inspectable. */
async function recordBlocked(
  input: { businessId: string; campaignId: string },
  campaignId: string,
  step: Step,
  prospectId: string,
  reasonCode: string,
): Promise<void> {
  const admin = createAdminClient();

  await admin.from("outreach_recipient_runs").insert({
    business_id: input.businessId,
    campaign_id: campaignId,
    sequence_id: step.sequenceId,
    prospect_id: prospectId,
    status: "SUPPRESSED",
    stop_reason: reasonCode,
    current_step_position: step.position,
  });

  await admin
    .from("prospects")
    .update({
      outreach_eligibility: reasonCode === "BLOCKED_OPT_OUT" ? "SUPPRESSED" : "REVIEW",
      eligibility_reason: "Contactability changed before this message was sent",
    })
    .eq("business_id", input.businessId)
    .eq("id", prospectId);
}
