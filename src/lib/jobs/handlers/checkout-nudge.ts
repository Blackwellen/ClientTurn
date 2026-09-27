import "server-only";
import { z } from "zod";
import type { ClaimedJob } from "@/lib/jobs/queue";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logWriteError } from "@/lib/supabase/write-result";
import { leadContact, loadLead } from "./shared";
import { parsePayload } from "./parse";
import { abandonedSettingsOf, parseAuthority } from "@/lib/commercial/authority";
import {
  attemptExpiresAt,
  nudgeChannel,
  nudgeDecision,
  type NudgeChannel,
} from "@/lib/payments/abandoned";
import { db, loadAttemptForNudge, paymentUnderReview } from "@/lib/payments/store";
import { scheduleExpiryCheck, scheduleNudgeCheck } from "@/lib/payments/attempts";
import { getFollowUpChannelContext } from "@/lib/follow-up/channel-context";
import { followUpSmsAffordable, leadIsEngaged } from "@/lib/billing/limits-service";
import { enqueueAgentTurn } from "@/lib/agent/events";
import { checkoutNudgeEvent } from "@/lib/payments/nudge-event";

/**
 * `checkout.nudge` -- the abandoned-checkout follow-up (the direct-sale loop,
 * step 4).
 *
 * One job per nudge, queued for its due time (payments/attempts.ts). It
 * re-reads the attempt, the lead, the workspace's settings and any payment
 * under review, and asks `nudgeDecision` (pure, payments/abandoned.ts):
 *
 *   * STOP -- paid, a payment waiting for a person, opted out, closed,
 *     archived, taken over, paused, turned off or exhausted: nothing is sent;
 *   * WAIT -- the settings moved the due time: re-queued for it;
 *   * SEND -- the attempt becomes ABANDONED and ONE agent turn is queued
 *     (FOLLOW_UP_DUE with the attempt), which composes the nudge through the
 *     normal agent path: the model writes it, the same validator checks it
 *     (the tracked link and only its approved price text allowed), and the
 *     send guard re-checks every stop condition, opt-out and quiet hours
 *     immediately before it goes. A payment in between makes the lead WON,
 *     which the guard refuses to message.
 *
 * The next nudge (or the expiry check) is queued here, not by the agent, so a
 * turn that decided not to send does not end the schedule.
 */

export const checkoutNudgePayload = z.object({
  attemptId: z.uuid(),
  nudge: z.number().int().min(0).max(4),
  kind: z.enum(["nudge", "expire"]).default("nudge"),
});

async function settingsFor(businessId: string) {
  const { data } = await db()
    .from("commercial_authority")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  return abandonedSettingsOf(parseAuthority(data));
}

export async function handleCheckoutNudge(job: ClaimedJob): Promise<void> {
  const payload = parsePayload(checkoutNudgePayload, job.payload);
  const attempt = await loadAttemptForNudge(payload.attemptId);
  if (!attempt) return;
  const now = new Date();
  const sentAt = new Date(attempt.sent_at);
  const settings = await settingsFor(attempt.business_id);
  const admin = db();

  if (payload.kind === "expire") {
    if (attempt.status === "PAID" || attempt.status === "EXPIRED") return;
    const expiresAt = attemptExpiresAt(sentAt, settings);
    if (now < expiresAt) {
      await scheduleExpiryCheck({ businessId: attempt.business_id, attemptId: attempt.id, sentAt, at: expiresAt });
      return;
    }
    logWriteError(
      await admin
        .from("checkout_attempts")
        .update({ status: "EXPIRED" })
        .eq("id", attempt.id)
        .in("status", ["SENT", "ABANDONED"]),
      "checkout.nudge: expire",
      { attemptId: attempt.id },
    );
    return;
  }

  const lead = await loadLead(attempt.lead_id);
  if (!lead || lead.business_id !== attempt.business_id) return;
  const { data: extra } = await admin
    .from("leads")
    .select("archived_at, anonymised_at")
    .eq("id", lead.id)
    .maybeSingle();
  const archived = Boolean((extra as { archived_at?: string | null; anonymised_at?: string | null } | null)?.archived_at)
    || Boolean((extra as { anonymised_at?: string | null } | null)?.anonymised_at);

  const decision = nudgeDecision({
    attempt: { status: attempt.status, nudgesSent: attempt.nudges_sent, sentAt },
    nudge: payload.nudge,
    settings,
    lead: {
      optedOut: lead.opted_out,
      status: lead.status,
      humanTakeover: lead.human_takeover,
      archived,
      automationActive: lead.automation_active,
    },
    paymentUnderReview: await paymentUnderReview(attempt.business_id, lead.id),
    now,
  });

  if (decision.action === "WAIT") {
    await scheduleNudgeCheck({
      businessId: attempt.business_id,
      attemptId: attempt.id,
      sentAt,
      nudge: payload.nudge,
      at: decision.until,
    });
    return;
  }

  if (decision.action === "STOP") {
    console.info("[checkout.nudge] stopped", { attemptId: attempt.id, nudge: payload.nudge, reason: decision.reason });
    // Nothing more will be sent; the attempt still expires on schedule unless
    // it was paid (or already expired).
    if (decision.reason !== "PAID" && decision.reason !== "EXPIRED") {
      await markAbandoned(admin, attempt.id);
      await scheduleExpiryCheck({ businessId: attempt.business_id, attemptId: attempt.id, sentAt });
    }
    return;
  }

  await markAbandoned(admin, attempt.id);

  // Channel: engaged -> where the link went; unengaged -> email, SMS only if
  // affordable (follow-up/channel-strategy.ts owner rule).
  const engaged = await leadIsEngaged(attempt.business_id, lead.id);
  const context = await getFollowUpChannelContext(attempt.business_id);
  const leadHas = { sms: Boolean(leadContact(lead, "sms")), email: Boolean(leadContact(lead, "email")) };
  const smsAffordable =
    !engaged && context.available.sms && leadHas.sms
      ? await followUpSmsAffordable({ businessId: attempt.business_id, leadId: lead.id, automationRunId: null })
      : false;
  const channel = nudgeChannel({
    sentChannel: attempt.channel as NudgeChannel,
    engaged,
    available: { sms: Boolean(context.available.sms), email: Boolean(context.available.email) },
    leadHas,
    smsAffordable,
  });

  if (channel) {
    await enqueueAgentTurn(
      checkoutNudgeEvent({
        businessId: attempt.business_id,
        leadId: lead.id,
        attemptId: attempt.id,
        nudge: payload.nudge,
        channel,
        occurredAt: now.toISOString(),
      }),
    );
  } else {
    console.info("[checkout.nudge] no affordable channel; nudge skipped", { attemptId: attempt.id, nudge: payload.nudge });
  }

  if (payload.nudge < settings.max_nudges) {
    await scheduleNudgeCheck({ businessId: attempt.business_id, attemptId: attempt.id, sentAt, nudge: payload.nudge + 1 });
  } else {
    await scheduleExpiryCheck({ businessId: attempt.business_id, attemptId: attempt.id, sentAt });
  }
}

async function markAbandoned(admin: SupabaseClient, attemptId: string) {
  logWriteError(
    await admin.from("checkout_attempts").update({ status: "ABANDONED" }).eq("id", attemptId).eq("status", "SENT"),
    "checkout.nudge: mark abandoned",
    { attemptId },
  );
}
