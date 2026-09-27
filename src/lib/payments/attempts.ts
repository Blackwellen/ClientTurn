import "server-only";
import { serverEnv } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { logWriteError } from "@/lib/supabase/write-result";
import {
  abandonedSettingsOf,
  parseAuthority,
  type CheckoutLink,
  type TrackedCheckoutLink,
} from "@/lib/commercial/authority";
import { nudgeDueAt, attemptExpiresAt } from "./abandoned";
import { tagCheckoutUrl, trackingParamFor, untagCheckoutUrl } from "./tracking";
import { derivedCheckoutToken, newCheckoutToken } from "./tracking-token";
import { db } from "./store";

/**
 * Tracked checkout sends (the direct-sale loop, step 1), server half.
 *
 * `trackCheckoutLink` runs before the message is composed, so the text the
 * validator checks is the text that goes out, token included.
 * `recordCheckoutAttempt` runs after the message is queued, writes the
 * `checkout_attempts` row, and schedules the first abandoned-checkout check.
 *
 * Retry safety: the token is derived from the send key under a server secret
 * (tracking-token.ts), so a retried turn -- whose message the send key
 * dedupes -- records the token the lead actually received; the attempt row is
 * unique on (workspace, send key).
 */

/** Whether 0143 is applied. Without it links go out untracked, exactly as before. */
async function trackingAvailable(): Promise<boolean> {
  // A GET, not a HEAD: PostgREST reports a missing table on a HEAD request
  // with no error body, which reads as "present" (seen live, story B5).
  const { error } = await db().from("checkout_attempts").select("id").limit(1);
  if (!error) return true;
  if (!isSchemaLag(error)) console.error("[payments] checkout_attempts probe failed", error.message);
  return false;
}

export async function trackCheckoutLink(input: { sendKey: string; link: CheckoutLink }): Promise<TrackedCheckoutLink> {
  if (!(await trackingAvailable())) return { ...input.link, tracked_url: input.link.url };
  const secret = serverEnv.credentialEncryptionKey;
  const token = secret && secret.length >= 16 ? derivedCheckoutToken(secret, input.sendKey) : newCheckoutToken();
  const param = trackingParamFor(input.link);
  return { ...input.link, tracked_url: tagCheckoutUrl(input.link.url, param, token) };
}

/** Writes the attempt and schedules the first nudge check. Never throws. */
export async function recordCheckoutAttempt(input: {
  businessId: string;
  leadId: string;
  link: TrackedCheckoutLink;
  channel: string;
  sendKey: string;
  messageId: string | null;
  agentRunId: string | null;
  opportunityId: string | null;
}): Promise<string | null> {
  try {
    const param = trackingParamFor(input.link);
    const split = untagCheckoutUrl(input.link.tracked_url, param);
    // Untracked (0143 not applied): nothing to record.
    if (!split) return null;

    const sentAt = new Date();
    const { data, error } = await db()
      .from("checkout_attempts")
      .insert({
        business_id: input.businessId,
        lead_id: input.leadId,
        opportunity_id: input.opportunityId,
        link_id: input.link.id,
        token: split.token,
        tracking_param: param,
        sent_url: input.link.tracked_url,
        channel: input.channel,
        send_key: input.sendKey,
        message_id: input.messageId,
        agent_run_id: input.agentRunId,
        sent_at: sentAt.toISOString(),
      })
      .select("id, sent_at")
      .single();

    let attemptId = (data as { id: string } | null)?.id ?? null;
    let attemptSentAt = sentAt;
    if (error?.code === "23505") {
      const { data: existing } = await db()
        .from("checkout_attempts")
        .select("id, sent_at")
        .eq("business_id", input.businessId)
        .eq("send_key", input.sendKey)
        .maybeSingle();
      attemptId = (existing as { id: string } | null)?.id ?? null;
      if (existing) attemptSentAt = new Date((existing as { sent_at: string }).sent_at);
    } else if (error) {
      logWriteError({ error }, "payments: record checkout attempt", { businessId: input.businessId, leadId: input.leadId });
      return null;
    }
    if (!attemptId) return null;

    await scheduleNudgeCheck({ businessId: input.businessId, attemptId, sentAt: attemptSentAt, nudge: 1 });
    return attemptId;
  } catch (error) {
    console.error("[payments] recordCheckoutAttempt threw", { businessId: input.businessId, error });
    return null;
  }
}

async function loadSettings(businessId: string) {
  const { data } = await db()
    .from("commercial_authority")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  return abandonedSettingsOf(parseAuthority(data));
}

/**
 * Queues the check for nudge `n` at its due time. The job re-reads
 * everything, so a settings change after this only moves the time: the job
 * re-queues itself for the new due time, or stops.
 */
export async function scheduleNudgeCheck(input: {
  businessId: string;
  attemptId: string;
  sentAt: Date;
  nudge: number;
  at?: Date;
}): Promise<void> {
  const settings = await loadSettings(input.businessId);
  const at = input.at ?? nudgeDueAt(input.sentAt, input.nudge, settings);
  await enqueue(
    "checkout.nudge",
    { attemptId: input.attemptId, nudge: input.nudge, kind: "nudge" },
    {
      businessId: input.businessId,
      runAt: at,
      priority: 90,
      maxAttempts: 3,
      idempotencyKey: `checkout.nudge:${input.attemptId}:${input.nudge}:${at.getTime()}`,
    },
  );
}

/** Queues the expiry check a week after the last nudge. */
export async function scheduleExpiryCheck(input: { businessId: string; attemptId: string; sentAt: Date; at?: Date }): Promise<void> {
  const settings = await loadSettings(input.businessId);
  const at = input.at ?? attemptExpiresAt(input.sentAt, settings);
  await enqueue(
    "checkout.nudge",
    { attemptId: input.attemptId, nudge: 0, kind: "expire" },
    {
      businessId: input.businessId,
      runAt: at,
      priority: 120,
      maxAttempts: 3,
      idempotencyKey: `checkout.expire:${input.attemptId}:${at.getTime()}`,
    },
  );
}
