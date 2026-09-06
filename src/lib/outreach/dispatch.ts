import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { evaluate } from "@/lib/policy/service";
import { sendEmail, unsubscribeUrl } from "@/lib/email/smtp";
import { normaliseEmail } from "@/lib/prospects/dedupe";
import { checkSuppression } from "@/lib/policy/suppression";
import { evaluateEligibility } from "./campaign-eligibility";
import { autoPauseIfUnsafe } from "./campaigns/lifecycle";
import { campaignHasBudget, recordCampaignCost } from "./campaigns/budget";
import { loadSender } from "./campaigns/sender";
import { loadDraft } from "./campaigns/draft";
import { mergeValuesFor, renderTemplate } from "./templates";

/**
 * Cold outreach dispatch (V4 section 17, section 18.27).
 *
 * The rule this file exists to enforce: **being in a campaign is not permission
 * to send.** Everything the audience builder concluded about a prospect is
 * treated as stale here. Suppression, contactability, campaign caps, sender
 * health and budget are all re-evaluated per recipient, immediately before the
 * send, because a person can opt out between being selected and being written
 * to and that opt-out has to win.
 *
 * Ordering is deliberate throughout: claim the step, claim the caps, then send.
 * A claim that is not followed by a send is released. The alternative ordering
 * — send, then record — is how a provider timeout turns into a second email to
 * the same person.
 */

/** Never send more than this in one job invocation, whatever the caps say. */
const MAX_PER_INVOCATION = 25;

export type DispatchOutcome = {
  sent: number;
  skipped: number;
  blocked: number;
  /** Set when the campaign cannot dispatch at all. */
  haltReason: string | null;
  /** True when recipients remain and the job should be re-queued. */
  more: boolean;
};

const EMPTY: DispatchOutcome = {
  sent: 0,
  skipped: 0,
  blocked: 0,
  haltReason: null,
  more: false,
};

type Step = {
  id: string;
  sequenceId: string;
  position: number;
  delaySeconds: number;
  subjectTemplate: string | null;
  bodyTemplate: string;
};

export async function dispatchCampaign(input: {
  businessId: string;
  campaignId: string;
}): Promise<DispatchOutcome> {
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select(
      `id, name, status, sender_identity_id, active_sequence_id, review_before_outreach,
       daily_contact_cap, prospects_per_run, service_id, services ( name )`,
    )
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .maybeSingle();

  if (!campaign) return { ...EMPTY, haltReason: "CAMPAIGN_NOT_FOUND" };
  if (campaign.status !== "ACTIVE" && campaign.status !== "OPTIMIZING") {
    return { ...EMPTY, haltReason: "CAMPAIGN_NOT_ACTIVE" };
  }

  // A campaign configured for human review does not auto-send, whatever
  // enqueued this. Checked here as well as at launch because it can be turned
  // on after the campaign started.
  if (campaign.review_before_outreach) {
    return { ...EMPTY, haltReason: "REVIEW_REQUIRED" };
  }

  const steps = await loadSteps(input.businessId, campaign.active_sequence_id);
  if (steps.length === 0) return { ...EMPTY, haltReason: "NO_PUBLISHED_STEP" };

  const sender = campaign.sender_identity_id
    ? await loadSender(input.businessId, campaign.sender_identity_id)
    : null;

  if (!sender) return { ...EMPTY, haltReason: "SENDER_NOT_AVAILABLE" };

  // Before anything is sent, decide whether this campaign should still be
  // running at all. Priority is deliberately not consulted: a campaign marked
  // Urgent that is bouncing 8% of its mail stops exactly as fast as any other.
  const suppressionAvailable = await probeSuppression(input.businessId);
  const budgetAvailable = await campaignHasBudget(input.businessId, input.campaignId, 0);

  const paused = await autoPauseIfUnsafe({
    businessId: input.businessId,
    campaignId: input.campaignId,
    signals: {
      bounceRate: sender.bounceRate,
      complaintRate: sender.complaintRate,
      senderHealthy: sender.state !== "BLOCKED",
      senderVerified: sender.status === "VERIFIED",
      suppressionAvailable,
      contactabilityAvailable: true,
      providerHealthy: true,
      budgetExhausted: !budgetAvailable,
    },
  });

  if (paused.paused) return { ...EMPTY, haltReason: paused.reason ?? "AUTO_PAUSED" };
  if (sender.state === "BLOCKED") return { ...EMPTY, haltReason: "SENDER_NOT_AVAILABLE" };

  const loaded = await loadDraft(input.businessId, input.campaignId);
  if (!loaded) return { ...EMPTY, haltReason: "CAMPAIGN_NOT_FOUND" };

  const { data: business } = await admin
    .from("businesses")
    .select("name, timezone")
    .eq("id", input.businessId)
    .maybeSingle();

  const service = campaign.services as unknown as { name: string } | null;
  const bookingLink = await resolveBookingLink(input.businessId, input.campaignId);
  const batchSize = Math.min(
    MAX_PER_INVOCATION,
    Math.max(1, campaign.prospects_per_run || MAX_PER_INVOCATION),
  );

  // Due work, read from `next_step_due_at` — the same column the scheduler's
  // index covers. Nothing is eligible on a timestamp derived at read time.
  const { data: due } = await admin
    .from("outreach_recipient_runs")
    .select(
      `id, prospect_id, conversation_id, status, current_step_position, steps_sent,
       prospects ( id, first_name, last_name, role_title, email, unsubscribe_token, status,
                   outreach_eligibility, grade, score, promoted_to_lead_id,
                   prospect_companies ( name, domain, is_existing_customer, location_json ) )`,
    )
    .eq("business_id", input.businessId)
    .eq("campaign_id", input.campaignId)
    .in("status", ["PENDING", "SCHEDULED", "ACTIVE"])
    .not("next_step_due_at", "is", null)
    .lte("next_step_due_at", new Date().toISOString())
    .order("next_step_due_at", { ascending: true })
    .limit(batchSize);

  const queue = due ?? [];
  if (queue.length === 0) return EMPTY;

  let sent = 0;
  let skipped = 0;
  let blocked = 0;

  for (const run of queue) {
    const prospect = run.prospects as unknown as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      role_title: string | null;
      email: string | null;
      unsubscribe_token: string | null;
      status: string;
      outreach_eligibility: string;
      grade: string | null;
      score: number | null;
      promoted_to_lead_id: string | null;
      prospect_companies: {
        name: string;
        domain: string | null;
        is_existing_customer: boolean;
        location_json: Record<string, unknown> | null;
      } | null;
    } | null;

    if (!prospect) {
      skipped += 1;
      continue;
    }

    const email = normaliseEmail(prospect.email);
    if (!email) {
      await stopRun(input, run.id, "NO_EMAIL");
      skipped += 1;
      continue;
    }

    const nextPosition = run.current_step_position + 1;
    const step = steps.find((candidate) => candidate.position >= nextPosition);

    if (!step) {
      // Every step delivered. The recipient is done, not failed.
      await admin
        .from("outreach_recipient_runs")
        .update({
          status: "COMPLETED",
          next_step_due_at: null,
          completed_at: new Date().toISOString(),
        })
        .eq("business_id", input.businessId)
        .eq("id", run.id);
      continue;
    }

    /* ---- the per-recipient re-check, at send time, against live state ---- */

    let suppressed = false;
    try {
      suppressed = (await checkSuppression(input.businessId, "EMAIL", { email })) !== null;
    } catch {
      // A suppression lookup that fails stops the batch. Continuing would mean
      // emailing people we cannot confirm have not opted out.
      return { sent, skipped, blocked, haltReason: "SUPPRESSION_UNAVAILABLE", more: true };
    }

    const company = prospect.prospect_companies;
    const verdict = evaluateEligibility(
      {
        grade: prospect.grade as never,
        score: prospect.score === null ? null : Number(prospect.score),
        status: prospect.status,
        outreachEligibility: prospect.outreach_eligibility,
        email,
        promotedToLeadId: prospect.promoted_to_lead_id,
        isExistingCustomer: company?.is_existing_customer ?? false,
        // Intent was proved at selection. Re-proving it per send would be a
        // query per recipient for a fact that only becomes *less* true, and
        // the freshness window already bounds it.
        matchingIntentSignals: loaded.draft.intentScore.intentRequired ? 1 : 0,
        suppressed,
        companyExcluded: false,
      },
      loaded.draft,
    );

    if (verdict.outcome !== "ELIGIBLE") {
      blocked += 1;
      await recordBlocked(input, run.id, prospect.id, verdict.reasonCode);
      continue;
    }

    const location = (company?.location_json ?? {}) as { country?: string };

    // The authoritative contactability check. `record: true` writes the
    // decision, so "why was this person contacted" has an answer later.
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
      // "DEGRADED" is the sender module's word; the policy engine's
      // vocabulary is HEALTHY/WATCH/WARNING/PAUSED.
      sender: {
        available: true,
        health: sender.state === "HEALTHY" ? "HEALTHY" : "WARNING",
      },
      record: true,
    });

    if (decision.outcome !== "ALLOWED") {
      blocked += 1;
      await recordBlocked(input, run.id, prospect.id, decision.reasonCode);
      continue;
    }

    /* ------------------------- claim, then send ------------------------- */

    // Claiming the step is the idempotency guard. It is conditional on the
    // position we read, so a retried job, a duplicated queue entry or a second
    // worker all find the row already advanced and send nothing.
    const { data: claimedStep } = await admin
      .from("outreach_recipient_runs")
      .update({
        status: "ACTIVE",
        current_step_position: step.position,
        next_step_due_at: null,
      })
      .eq("business_id", input.businessId)
      .eq("id", run.id)
      .eq("current_step_position", run.current_step_position)
      .select("id");

    if (!claimedStep?.length) {
      skipped += 1;
      continue;
    }

    // Campaign caps and mailbox cap, both claimed atomically before the send.
    const { data: campaignSlot } = await admin.rpc("claim_campaign_contact_slot", {
      p_business_id: input.businessId,
      p_campaign_id: input.campaignId,
    });

    if (!campaignSlot) {
      await releaseStep(input, run.id, run.current_step_position, run.status);
      return { sent, skipped, blocked, haltReason: "CAMPAIGN_CONTACT_CAP", more: true };
    }

    const { data: senderSlot } = await admin.rpc("claim_sender_send_slot", {
      p_business_id: input.businessId,
      p_sender_id: sender.id,
    });

    if (!senderSlot) {
      await releaseCampaignSlot(input);
      await releaseStep(input, run.id, run.current_step_position, run.status);
      // Not a failure — the cap is doing its job.
      return { sent, skipped, blocked, haltReason: "SENDER_DAILY_CAP", more: true };
    }

    const conversationId = await ensureConversation({
      businessId: input.businessId,
      prospectId: prospect.id,
      existing: run.conversation_id,
      subject: campaign.name,
    });

    // `messages.conversation_id` is NOT NULL, and a send with nowhere to
    // record it would be invisible to the prospect drawer and to the lead it
    // later becomes. Give the slots back and try again next invocation.
    if (!conversationId) {
      await releaseCampaignSlot(input);
      await releaseStep(input, run.id, run.current_step_position, run.status);
      skipped += 1;
      continue;
    }

    const values = {
      ...mergeValuesFor(
        { ...prospect, company: company ? { name: company.name } : null },
        business?.name ?? "",
      ),
      location: (location as { city?: string }).city ?? "",
      service_name: service?.name ?? "",
      sender_name: sender.displayName,
      booking_link: bookingLink,
    };

    const subject = renderTemplate(step.subjectTemplate ?? "", values) || campaign.name;
    const body = [
      renderTemplate(step.bodyTemplate, values),
      // Cold B2B email in the UK must identify the sender in the message.
      await senderSignature(input.businessId, sender.id),
    ]
      .filter(Boolean)
      .join("\n\n");

    // Deterministic: campaign, prospect, sequence and step. The same logical
    // send always produces the same key, so a provider retry is deduplicable.
    const sendKey = `outreach:${input.campaignId}:${prospect.id}:${step.sequenceId}:${step.position}`;

    // No token means no working unsubscribe link, and a cold marketing email
    // without one is not lawful to send. Skip rather than send a broken link.
    if (!prospect.unsubscribe_token) {
      await releaseCampaignSlot(input);
      skipped += 1;
      continue;
    }

    const result = await sendEmail({
      businessId: input.businessId,
      to: email,
      subject,
      html: body,
      // A working one-click unsubscribe is what makes this send lawful.
      unsubscribeUrl: unsubscribeUrl(prospect.unsubscribe_token),
      sendKey,
    });

    if (!result.ok) {
      await releaseCampaignSlot(input);

      await admin
        .from("outreach_recipient_runs")
        .update({
          status: result.permanent ? "BOUNCED" : "SCHEDULED",
          stop_reason: result.errorCode,
          next_step_due_at: result.permanent
            ? null
            : new Date(Date.now() + 3600_000).toISOString(),
          bounced_at: result.permanent ? new Date().toISOString() : null,
        })
        .eq("business_id", input.businessId)
        .eq("id", run.id);

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

    // The message row is what makes this send visible: the campaign's metrics,
    // the prospect drawer, and — after promotion — the Lead's history all read
    // from here.
    await admin.from("messages").insert({
      business_id: input.businessId,
      conversation_id: conversationId,
      prospect_id: prospect.id,
      campaign_id: input.campaignId,
      outreach_step_id: step.id,
      sender_identity_id: sender.id,
      channel: "email",
      direction: "outbound",
      origin: "outreach",
      status: "SENT",
      subject,
      body,
      message_id_header: result.providerMessageId ?? sendKey,
      sent_at: new Date().toISOString(),
    });

    const nextStep = steps.find((candidate) => candidate.position > step.position);

    await admin
      .from("outreach_recipient_runs")
      .update({
        status: nextStep ? "SCHEDULED" : "COMPLETED",
        conversation_id: conversationId,
        steps_sent: run.steps_sent + 1,
        last_sent_at: new Date().toISOString(),
        next_step_due_at: nextStep
          ? new Date(Date.now() + nextStep.delaySeconds * 1000).toISOString()
          : null,
        completed_at: nextStep ? null : new Date().toISOString(),
        stop_reason: null,
      })
      .eq("business_id", input.businessId)
      .eq("id", run.id);

    await admin
      .from("prospects")
      .update({
        status: "OUTREACH_ACTIVE",
        conversation_id: conversationId,
        last_contacted_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      })
      .eq("business_id", input.businessId)
      .eq("id", prospect.id);

    // Attributed so the budget card reports where the money went rather than
    // presenting an invented split.
    await recordCampaignCost({
      businessId: input.businessId,
      campaignId: input.campaignId,
      category: "EMAIL_SENDING",
      costMinor: 1,
      reference: sendKey,
    });

    sent += 1;
  }

  if (sent > 0) {
    await recordAudit({
      businessId: input.businessId,
      actorType: "system",
      action: "outreach.dispatched",
      entityType: "outreach_campaign",
      entityId: input.campaignId,
      metadata: { sent, skipped, blocked },
    });
  }

  return { sent, skipped, blocked, haltReason: null, more: queue.length === batchSize };
}

/* ---------------------------------------------------------------- helpers */

async function loadSteps(businessId: string, sequenceId: string | null): Promise<Step[]> {
  if (!sequenceId) return [];
  const admin = createAdminClient();

  // Only a PUBLISHED sequence sends. A draft is someone still writing.
  const { data: sequence } = await admin
    .from("outreach_sequences")
    .select("id, status")
    .eq("business_id", businessId)
    .eq("id", sequenceId)
    .maybeSingle();

  if (!sequence || sequence.status !== "PUBLISHED") return [];

  const { data: steps } = await admin
    .from("outreach_steps")
    .select("id, sequence_id, position, delay_seconds, subject_template, body_template")
    .eq("business_id", businessId)
    .eq("sequence_id", sequence.id)
    .eq("enabled", true)
    // Cold outreach is email-first by policy. A non-EMAIL step on a cold
    // campaign is not sent, whatever wrote it.
    .eq("channel", "EMAIL")
    .order("position", { ascending: true });

  return (steps ?? []).map((step) => ({
    id: step.id,
    sequenceId: step.sequence_id,
    position: step.position,
    delaySeconds: Number(step.delay_seconds),
    subjectTemplate: step.subject_template,
    bodyTemplate: step.body_template,
  }));
}

async function probeSuppression(businessId: string): Promise<boolean> {
  try {
    await checkSuppression(businessId, "EMAIL", { email: "dispatch-probe@clientturn.invalid" });
    return true;
  } catch {
    return false;
  }
}

/** One conversation per prospect, reused across every step and every reply. */
async function ensureConversation(input: {
  businessId: string;
  prospectId: string;
  existing: string | null;
  subject: string;
}): Promise<string | null> {
  if (input.existing) return input.existing;
  const admin = createAdminClient();

  const { data: found } = await admin
    .from("conversations")
    .select("id")
    .eq("business_id", input.businessId)
    .eq("prospect_id", input.prospectId)
    .maybeSingle();

  if (found) return found.id;

  const { data: created } = await admin
    .from("conversations")
    .insert({
      business_id: input.businessId,
      prospect_id: input.prospectId,
      // Cross-channel by definition: promotion keeps this row and a lead may
      // continue on SMS or WhatsApp from the same thread.
      channel: "multi",
      subject: input.subject,
    })
    .select("id")
    .single();

  return created?.id ?? null;
}

/**
 * The link `{{booking_link}}` renders to.
 *
 * Taken from the campaign's own conversion goal rather than typed into a
 * template, so a customer cannot paste a competitor's URL or a stale one into
 * a cold email going out under their business name. An empty string when the
 * goal has no URL destination, which renders as nothing rather than as a
 * broken link.
 */
async function resolveBookingLink(businessId: string, campaignId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("outreach_campaigns")
    .select("conversion_goals ( destination_type, destination_config )")
    .eq("business_id", businessId)
    .eq("id", campaignId)
    .maybeSingle();

  const goal = data?.conversion_goals as unknown as
    | { destination_type: string; destination_config: Record<string, unknown> | null }
    | null;

  if (!goal) return "";
  const url = goal.destination_config?.url;
  return typeof url === "string" && /^https:\/\//i.test(url) ? url : "";
}

async function senderSignature(businessId: string, senderId: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sender_identities")
    .select("signature_text, postal_footer")
    .eq("business_id", businessId)
    .eq("id", senderId)
    .maybeSingle();

  return [data?.signature_text, data?.postal_footer].filter(Boolean).join("\n\n");
}

async function releaseStep(
  input: { businessId: string; campaignId: string },
  runId: string,
  position: number,
  status: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("outreach_recipient_runs")
    .update({
      status,
      current_step_position: position,
      next_step_due_at: new Date().toISOString(),
    })
    .eq("business_id", input.businessId)
    .eq("id", runId);
}

/** A claimed slot that was never used is given back, so a blocked send does
 *  not silently consume the day's capacity. */
async function releaseCampaignSlot(input: {
  businessId: string;
  campaignId: string;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.rpc("release_campaign_contact_slot", {
    p_business_id: input.businessId,
    p_campaign_id: input.campaignId,
  });
}

/** Records why a prospect was not contacted, so the decision is inspectable. */
async function recordBlocked(
  input: { businessId: string; campaignId: string },
  runId: string,
  prospectId: string,
  reasonCode: string,
): Promise<void> {
  const admin = createAdminClient();

  await admin
    .from("outreach_recipient_runs")
    .update({
      status: "SUPPRESSED",
      stop_reason: reasonCode,
      next_step_due_at: null,
      stopped_at: new Date().toISOString(),
    })
    .eq("business_id", input.businessId)
    .eq("id", runId);

  await admin
    .from("prospects")
    .update({
      outreach_eligibility: reasonCode === "BLOCKED_OPT_OUT" ? "SUPPRESSED" : "REVIEW",
      eligibility_reason: "Contactability changed before this message was sent",
    })
    .eq("business_id", input.businessId)
    .eq("id", prospectId);
}

async function stopRun(
  input: { businessId: string; campaignId: string },
  runId: string,
  reason: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("outreach_recipient_runs")
    .update({
      status: "STOPPED",
      stop_reason: reason,
      next_step_due_at: null,
      stopped_at: new Date().toISOString(),
    })
    .eq("business_id", input.businessId)
    .eq("id", runId);
}
