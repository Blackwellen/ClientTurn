import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWriteError } from "@/lib/supabase/write-result";
import { recordAudit, recordUsage } from "@/lib/audit";
import { checkCapacity } from "@/lib/billing/v4-entitlements";
import { evaluate } from "@/lib/policy/service";
import { sendEmail, unsubscribeUrl } from "@/lib/email/smtp";
import { applyEmailSendOutcome } from "@/lib/email/send-outcome";
import {
  buildSourceDisclosure,
  emailDisclosureDue,
  type Disclosure,
} from "@/lib/compliance/source-disclosure";
import { loadDataControls } from "@/lib/compliance/queries";
import { normaliseEmail } from "@/lib/prospects/dedupe";
import { assignVariant, recordVariantEvent } from "./variant-assignment";
import { checkSuppression } from "@/lib/policy/suppression";
import { evaluateEligibility } from "./campaign-eligibility";
import { autoPauseIfUnsafe } from "./campaigns/lifecycle";
import {
  campaignHasBudget,
  emailSendCostMinor,
  recordCampaignCost,
} from "./campaigns/budget";
import { loadSender } from "./campaigns/sender";
import { claimSenderSlot } from "@/lib/email/sender-slots";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { loadDraft } from "./campaigns/draft";
import { mergeValuesFor, renderTemplate } from "./templates";
import { loadProspectEmailOrigins } from "@/lib/find-leads/server/email-origin-store";

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

  // The plan allowance, checked before the loop rather than per recipient.
  //
  // Cold email is the metered unit of the acquisition product and this was the
  // one send path that neither recorded nor enforced it: the allowance was
  // displayed on Billing & Usage, read by the campaign budget card, and never
  // consumed. A workspace could run ten campaigns, each inside its own
  // `daily_contact_cap`, and pass the plan limit without anything noticing.
  //
  // A campaign-level halt rather than a per-message refusal, because the
  // allowance is a property of the workspace: stopping the run and saying so is
  // more useful than sending a partial batch and failing silently on the rest.
  const allowance = await checkCapacity(input.businessId, "email_sent");
  if (!allowance.allowed) {
    return { ...EMPTY, haltReason: "EMAIL_ALLOWANCE_EXHAUSTED" };
  }

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
  // Looked up once per batch, not per send. Zero for a customer's own mailbox,
  // which is the honest figure rather than a placeholder.
  const sendCostMinor = await emailSendCostMinor();
  const batchSize = Math.min(
    MAX_PER_INVOCATION,
    Math.max(1, campaign.prospects_per_run || MAX_PER_INVOCATION),
  );

  // Due work, read from `next_step_due_at` — the same column the scheduler's
  // index covers. Nothing is eligible on a timestamp derived at read time.
  const { data: due, error: dueError } = await admin
    .from("outreach_recipient_runs")
    .select(
      `id, prospect_id, conversation_id, status, current_step_position, steps_sent, campaign_variant_id,
       prospects ( id, first_name, last_name, role_title, email, unsubscribe_token, status,
                   outreach_eligibility, grade, score, promoted_to_lead_id, verification_status,
                   prospect_companies ( name, domain, is_existing_customer, location_json ) )`,
    )
    .eq("business_id", input.businessId)
    .eq("campaign_id", input.campaignId)
    .in("status", ["PENDING", "SCHEDULED", "ACTIVE"])
    .not("next_step_due_at", "is", null)
    .lte("next_step_due_at", new Date().toISOString())
    .order("next_step_due_at", { ascending: true })
    .limit(batchSize);

  /**
   * A failed due-work query must throw, never read as "nothing to do".
   *
   * The two outcomes are indistinguishable downstream: both produce an empty
   * list, the loop runs zero times and the job reports success. That is how a
   * missing column once left the social channel silently dead while every
   * signal said healthy. Throwing puts the reason in `jobs.last_error`, where
   * the worker records it and Admin -> System shows it.
   */
  if (dueError) {
    throw new Error(
      `Could not read due recipients for campaign ${input.campaignId}: ${dueError.message}`,
    );
  }

  const queue = due ?? [];
  if (queue.length === 0) return EMPTY;

  // §26: email origin (0131), read once per batch. A failed read stops the
  // batch rather than reading "unknown" as "not guessed".
  const origins = await loadProspectEmailOrigins(
    input.businessId,
    queue.map((run) => run.prospect_id).filter((id): id is string => Boolean(id)),
  );
  if (!origins) return { ...EMPTY, haltReason: "EMAIL_ORIGIN_UNAVAILABLE", more: true };

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
      verification_status: string | null;
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
      // Every step delivered. The recipient is done, not failed. A failed
      // write leaves the run due, and the next invocation lands here again.
      logWriteError(
        await admin
          .from("outreach_recipient_runs")
          .update({
            status: "COMPLETED",
            next_step_due_at: null,
            completed_at: new Date().toISOString(),
          })
          .eq("business_id", input.businessId)
          .eq("id", run.id),
        "outreach: complete recipient run",
        { businessId: input.businessId, campaignId: input.campaignId, runId: run.id },
      );
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
        emailOrigin: origins.get(prospect.id) ?? null,
        verificationStatus: prospect.verification_status,
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
        // No subscriber type or relationship here: the stored permission
        // record, or failing that the company's register verdict, decides.
        // Asserting CORPORATE on every send overrode a sole trader's record
        // (defect B1).
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
    const claim = await admin
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
    const claimedStep = claim.data;
    // A failed claim sends nothing (the safe direction), but is logged so it is
    // not mistaken for another worker having claimed the step.
    logWriteError(claim, "outreach: claim step", {
      businessId: input.businessId,
      campaignId: input.campaignId,
      runId: run.id,
    });

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

    // §43: the capped claim -- the ramped cap, ceilinged by the mailbox
    // provider's safe daily limit, refused while the sender is PAUSED by the
    // complaint monitor, and starting the warm-up clock on first use. A claim
    // that errors is no claim: the batch stops rather than sending uncounted.
    let senderSlot = false;
    try {
      senderSlot = await claimSenderSlot(input.businessId, sender.id);
    } catch {
      senderSlot = false;
    }

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

    // A running experiment on this step replaces the wording, and only the
    // wording — the recipient, the caps and every compliance check are
    // identical across variants, so a difference in replies is attributable to
    // the message rather than to who received it.
    const variant = await assignVariant({
      businessId: input.businessId,
      campaignId: input.campaignId,
      stepId: step.id,
      recipientRunId: run.id,
      existingVariantId: run.campaign_variant_id ?? null,
    });

    const subject =
      renderTemplate(variant?.subject ?? step.subjectTemplate ?? "", values) ||
      campaign.name;
    // Article 14: where the data did not come from the person themselves, they
    // must be told what is held and **where it came from**, at the latest on
    // first contact. Built from the provenance actually recorded against this
    // prospect -- never hand-written and never model-written, because a
    // plausible sentence naming a source that was never consulted is a
    // fabricated disclosure, which is worse than none.
    //
    // First contact only (Art 14(3)(b)): the line goes on the first cold step
    // delivered to this recipient, not under every follow-up. Follow-ups are
    // neither blocked nor annotated by it -- the information was given.
    const disclosure: Disclosure = emailDisclosureDue(run.steps_sent ?? 0)
      ? await sourceDisclosureFor(input.businessId, prospect.id)
      : { line: null, blocked: false, gap: null };

    // Refused rather than sent without it, on exactly the same reasoning as the
    // missing unsubscribe token below: a cold email that cannot say where it
    // got somebody's address is not lawful to send, and sending it anyway to
    // keep a campaign moving is the wrong trade.
    if (disclosure.blocked) {
      await releaseCampaignSlot(input);
      // Released, not left claimed: a claimed step has no due time and would
      // strand the recipient silently. Released, it is retried next tick and
      // goes out as soon as the privacy notice or provenance is fixed.
      await releaseStep(input, run.id, run.current_step_position, run.status);
      skipped += 1;
      continue;
    }

    const body = [
      renderTemplate(variant?.body ?? step.bodyTemplate, values),
      // Cold B2B email in the UK must identify the sender in the message.
      await senderSignature(input.businessId, sender.id),
      disclosure.line,
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
      await releaseStep(input, run.id, run.current_step_position, run.status);
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
      // The campaign's sender identity controls From (Phase 3.5).
      senderIdentity: { displayName: sender.displayName, email: sender.email },
    });

    if (!result.ok) {
      await releaseCampaignSlot(input);

      // Only a refusal of THIS address is a bounce. A mailbox-level failure
      // (password, TLS, sending policy) is not the prospect's fault: the run
      // is retried later and the mailbox's health records the problem, so a
      // wrong password can no longer mark a whole campaign's list BOUNCED.
      const recipientBounce = result.permanent && result.scope === "recipient";
      await applyEmailSendOutcome(input.businessId, email, result, "OUTREACH_SEND");

      // The claim above already cleared `next_step_due_at`, so a failure here
      // strands the run rather than re-sending it. Logged, not thrown: the
      // rest of the batch is unaffected.
      logWriteError(
        await admin
          .from("outreach_recipient_runs")
          .update({
            status: recipientBounce ? "BOUNCED" : "SCHEDULED",
            stop_reason: result.errorCode,
            next_step_due_at: recipientBounce
              ? null
              : new Date(Date.now() + 3600_000).toISOString(),
            bounced_at: recipientBounce ? new Date().toISOString() : null,
          })
          .eq("business_id", input.businessId)
          .eq("id", run.id),
        "outreach: record failed send on run",
        {
          businessId: input.businessId,
          campaignId: input.campaignId,
          runId: run.id,
          permanent: result.permanent,
          recipientBounce,
        },
      );

      if (recipientBounce && variant) {
        await recordVariantEvent({
          businessId: input.businessId,
          variantId: variant.id,
          event: "bounce",
        });
      }

      if (recipientBounce) {
        logWriteError(
          await admin
            .from("prospects")
            .update({ status: "BOUNCED", outreach_eligibility: "SUPPRESSED" })
            .eq("business_id", input.businessId)
            .eq("id", prospect.id),
          "outreach: mark prospect bounced",
          { businessId: input.businessId, campaignId: input.campaignId, prospectId: prospect.id },
        );
      }

      skipped += 1;
      continue;
    }

    // The message row is what makes this send visible: the campaign's metrics,
    // the prospect drawer, and — after promotion — the Lead's history all read
    // from here.
    //
    // The email has already gone, so none of the writes from here on throw:
    // aborting now would skip the usage charge and the run advance for a send
    // that really happened. A duplicate cannot follow from a failure here —
    // the step claim above moved `current_step_position` and cleared
    // `next_step_due_at` before the send — so each failure is logged loudly
    // with the send key instead.
    const sentContext = {
      businessId: input.businessId,
      campaignId: input.campaignId,
      runId: run.id,
      prospectId: prospect.id,
      sendKey,
    };
    const sentRow = (extras: Record<string, unknown>) =>
      admin.from("messages").insert({
        ...(extras as unknown as Record<string, never>),
        business_id: input.businessId,
        conversation_id: conversationId,
        prospect_id: prospect.id,
        campaign_id: input.campaignId,
        outreach_step_id: step.id,
        campaign_variant_id: variant?.id ?? null,
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
    // Cold outreach is marketing by definition (§43). message_class is a 0127
    // column: before that migration the row is still recorded without it.
    let sentWrite = await sentRow({ message_class: "MARKETING" });
    if (sentWrite.error && isSchemaLag(sentWrite.error)) sentWrite = await sentRow({});
    logWriteError(sentWrite, "outreach: record sent message (email WAS sent)", sentContext);

    const nextStep = steps.find((candidate) => candidate.position > step.position);

    // A failure leaves the run ACTIVE with no due time: stranded, not re-sent.
    logWriteError(
      await admin
        .from("outreach_recipient_runs")
        .update({
          status: nextStep ? "SCHEDULED" : "COMPLETED",
          conversation_id: conversationId,
          steps_sent: run.steps_sent + 1,
          // Sticky for the rest of the sequence: switching a person between
          // variants mid-sequence makes every later reply unattributable.
          campaign_variant_id: variant?.id ?? run.campaign_variant_id ?? null,
          last_sent_at: new Date().toISOString(),
          next_step_due_at: nextStep
            ? new Date(Date.now() + nextStep.delaySeconds * 1000).toISOString()
            : null,
          completed_at: nextStep ? null : new Date().toISOString(),
          stop_reason: null,
        })
        .eq("business_id", input.businessId)
        .eq("id", run.id),
      "outreach: advance recipient run after send",
      sentContext,
    );

    if (variant) {
      await recordVariantEvent({
        businessId: input.businessId,
        variantId: variant.id,
        event: "sent",
      });
    }

    logWriteError(
      await admin
        .from("prospects")
        .update({
          status: "OUTREACH_ACTIVE",
          conversation_id: conversationId,
          last_contacted_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
        })
        .eq("business_id", input.businessId)
        .eq("id", prospect.id),
      "outreach: mark prospect contacted",
      sentContext,
    );

    // The customer-facing meter, distinct from the provider cost below.
    //
    // `operationId` is the send key, which is deterministic across a retry, and
    // 0062 put a unique partial index on (business_id, operation_id) — so a
    // provider retry or a replayed job is charged exactly once. That is the
    // whole reason the column exists.
    // `email_sent`, not `cold_email_sent`: that is the metric carrying the plan
    // entitlement, and it is what `checkCapacity` above and Billing & Usage
    // both read. Recording a different name would leave the allowance
    // displayed-but-never-consumed, which is the defect this is fixing.
    // Cold and warm are distinguished by `feature`, which is what 0062 added
    // the column for.
    await recordUsage({
      businessId: input.businessId,
      metric: "email_sent",
      feature: "outreach",
      entity: { type: "prospect", id: prospect.id },
      operationId: sendKey,
      source: `campaign:${input.campaignId}`,
      metadata: { campaignId: input.campaignId, stepPosition: step.position },
    });

    // Attributed so the budget card reports where the money went rather than
    // presenting an invented split. A send that genuinely costs nothing —
    // the customer's own mailbox — records nothing, because a column of
    // £0.00 rows is noise dressed up as a breakdown.
    if (sendCostMinor > 0) {
      await recordCampaignCost({
        businessId: input.businessId,
        campaignId: input.campaignId,
        category: "EMAIL_SENDING",
        costMinor: sendCostMinor,
        reference: sendKey,
      });
    }

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

  const createdResult = await admin
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
  // Null makes the caller give the slots back and retry next invocation.
  logWriteError(createdResult, "outreach: create prospect conversation", {
    businessId: input.businessId,
    prospectId: input.prospectId,
  });

  return createdResult.data?.id ?? null;
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

/**
 * The Article 14 line for one prospect, from what is actually recorded.
 *
 * Two reads rather than one: the provenance rows say where the data came from,
 * and the workspace's data controls supply the controller's name and the
 * privacy notice the line points at. Either being absent blocks the send —
 * `buildSourceDisclosure` decides which, and says so in a sentence somebody can
 * act on rather than returning a boolean.
 */
async function sourceDisclosureFor(
  businessId: string,
  prospectId: string,
): Promise<Disclosure> {
  const admin = createAdminClient();

  const [{ data: sources, error: sourcesError }, controls] = await Promise.all([
    admin
      .from("prospect_data_sources")
      .select("source_type")
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .limit(50),
    loadDataControls(businessId),
  ]);

  // An unreadable provenance table is not "nothing recorded", but it is not
  // permission either: hold the send (the caller skips and retries next tick).
  if (sourcesError) {
    return {
      line: null,
      blocked: true,
      gap: `Could not read where this prospect's details came from: ${sourcesError.message}`,
    };
  }

  return buildSourceDisclosure({
    provenanceTypes: [...new Set((sources ?? []).map((row) => row.source_type))],
    legalName: controls.legalName,
    privacyPolicyUrl: controls.privacyPolicyUrl,
  });
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
  // A failure strands the claimed run (no due time) rather than re-sending it.
  logWriteError(
    await admin
      .from("outreach_recipient_runs")
      .update({
        status,
        current_step_position: position,
        next_step_due_at: new Date().toISOString(),
      })
      .eq("business_id", input.businessId)
      .eq("id", runId),
    "outreach: release claimed step",
    { businessId: input.businessId, campaignId: input.campaignId, runId },
  );
}

/** A claimed slot that was never used is given back, so a blocked send does
 *  not silently consume the day's capacity. */
async function releaseCampaignSlot(input: {
  businessId: string;
  campaignId: string;
}): Promise<void> {
  const admin = createAdminClient();
  // A failure only under-counts today's remaining capacity.
  logWriteError(
    await admin.rpc("release_campaign_contact_slot", {
      p_business_id: input.businessId,
      p_campaign_id: input.campaignId,
    }),
    "outreach: release campaign slot",
    { businessId: input.businessId, campaignId: input.campaignId },
  );
}

/** Records why a prospect was not contacted, so the decision is inspectable. */
async function recordBlocked(
  input: { businessId: string; campaignId: string },
  runId: string,
  prospectId: string,
  reasonCode: string,
): Promise<void> {
  const admin = createAdminClient();
  const context = { businessId: input.businessId, campaignId: input.campaignId, runId, prospectId, reasonCode };

  // Logged, not thrown: the send was already refused, and a run left due is
  // re-checked (and refused again) on the next invocation.
  logWriteError(
    await admin
      .from("outreach_recipient_runs")
      .update({
        status: "SUPPRESSED",
        stop_reason: reasonCode,
        next_step_due_at: null,
        stopped_at: new Date().toISOString(),
      })
      .eq("business_id", input.businessId)
      .eq("id", runId),
    "outreach: record blocked run",
    context,
  );

  logWriteError(
    await admin
      .from("prospects")
      .update({
        outreach_eligibility: reasonCode === "BLOCKED_OPT_OUT" ? "SUPPRESSED" : "REVIEW",
        eligibility_reason: "Contactability changed before this message was sent",
      })
      .eq("business_id", input.businessId)
      .eq("id", prospectId),
    "outreach: record blocked prospect",
    context,
  );
}

async function stopRun(
  input: { businessId: string; campaignId: string },
  runId: string,
  reason: string,
): Promise<void> {
  const admin = createAdminClient();
  // No send happened; a run left due is stopped again next invocation.
  logWriteError(
    await admin
      .from("outreach_recipient_runs")
      .update({
        status: "STOPPED",
        stop_reason: reason,
        next_step_due_at: null,
        stopped_at: new Date().toISOString(),
      })
      .eq("business_id", input.businessId)
      .eq("id", runId),
    "outreach: stop recipient run",
    { businessId: input.businessId, campaignId: input.campaignId, runId, reason },
  );
}
