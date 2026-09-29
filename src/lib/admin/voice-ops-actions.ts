"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { runOperation } from "@/lib/services";
import { logEvent } from "@/lib/observability/log";
import { guarded, type AdminActionResult } from "./guarded";
import { stepUpRemainingMs } from "./step-up";
import { authorizeAdminVoiceControl } from "./voice-ops-model";
import { runVoiceMarginCheck } from "./voice-margin-check";

/**
 * Admin -> System -> Voice ops: the emergency controls (brief §58).
 *
 * Every action runs through `guarded()` (platform_role from the database,
 * step-up in the last 30 minutes, refusals audited) and then
 * `authorizeAdminVoiceControl()` (the tested rule: confirmation and a
 * reason). The state change itself is a registered service operation called
 * as SYSTEM with the operator as the actor, so it is audited with its before
 * and after exactly like every other write. Nothing here takes a workspace id
 * from anywhere but the validated input, and each op re-reads the row.
 */

const controlInput = z.object({
  businessId: z.uuid(),
  reason: z.string().trim().max(500),
  confirm: z.boolean(),
});

async function authorise(operatorId: string, input: { reason: string; confirm: boolean }): Promise<AdminActionResult | null> {
  const verdict = authorizeAdminVoiceControl({
    // guarded() has already resolved the operator from profiles.platform_role.
    platformRole: "platform_admin",
    stepUpRemainingMs: await stepUpRemainingMs(operatorId),
    confirmed: input.confirm,
    reason: input.reason,
  });
  if (verdict.ok) return null;
  switch (verdict.code) {
    case "step_up_required":
      return { ok: false, code: "step_up_required", error: "Confirm your password and authenticator code to continue." };
    case "confirmation_required":
      return { ok: false, error: "Tick the confirmation before applying this control." };
    case "reason_required":
      return { ok: false, error: "Give a reason (at least 4 characters) for the audit log." };
    default:
      return { ok: false, code: "forbidden", error: "Not permitted." };
  }
}

async function asSystem(
  operation: Parameters<typeof runOperation>[0],
  args: Record<string, unknown>,
  businessId: string,
  operatorId: string,
): Promise<AdminActionResult> {
  const result = await runOperation(operation, args, {
    businessId,
    userId: operatorId,
    role: "owner",
    caller: "SYSTEM",
    confirmed: true,
    correlationId: randomUUID(),
  });
  if (!result.success) return { ok: false, error: result.message };
  await recordAudit({
    businessId,
    actorUserId: operatorId,
    actorType: "platform_admin",
    action: "admin.voice_control",
    entityType: result.entityType ?? undefined,
    entityId: result.entityId,
    metadata: { operation, after: result.after, service_audit_id: result.auditEventId },
  });
  logEvent("admin.voice_control", { operation, businessId });
  revalidatePath("/admin/system");
  return { ok: true };
}

export async function setWorkspaceVoiceDisabled(input: unknown): Promise<AdminActionResult> {
  return guarded("admin.voice_control", async (operator) => {
    const parsed = controlInput.extend({ disabled: z.boolean() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "That request is not valid." };
    const denied = await authorise(operator.id, parsed.data);
    if (denied) return denied;
    const result = await asSystem(
      "voice.admin_disable_workspace",
      { disabled: parsed.data.disabled, reason: parsed.data.reason },
      parsed.data.businessId,
      operator.id,
    );
    return result.ok ? { ok: true, message: parsed.data.disabled ? "AI calling disabled for the workspace." : "AI calling re-enabled." } : result;
  });
}

export async function setOutboundPaused(input: unknown): Promise<AdminActionResult> {
  return guarded("admin.voice_control", async (operator) => {
    const parsed = controlInput.extend({ paused: z.boolean() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "That request is not valid." };
    const denied = await authorise(operator.id, parsed.data);
    if (denied) return denied;
    const result = await asSystem(
      "admin_voice.pause_outbound",
      { paused: parsed.data.paused, reason: parsed.data.reason, confirm: true },
      parsed.data.businessId,
      operator.id,
    );
    return result.ok ? { ok: true, message: parsed.data.paused ? "Outbound calls paused." : "Outbound calls resumed." } : result;
  });
}

export async function setNumberSuspended(input: unknown): Promise<AdminActionResult> {
  return guarded("admin.voice_control", async (operator) => {
    const parsed = controlInput.extend({ numberId: z.uuid(), suspended: z.boolean() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "That request is not valid." };
    const denied = await authorise(operator.id, parsed.data);
    if (denied) return denied;
    const result = await asSystem(
      "admin_voice.suspend_number",
      { numberId: parsed.data.numberId, suspended: parsed.data.suspended, reason: parsed.data.reason, confirm: true },
      parsed.data.businessId,
      operator.id,
    );
    return result.ok ? { ok: true, message: parsed.data.suspended ? "Number suspended." : "Number reinstated." } : result;
  });
}

export async function setSpendLimit(input: unknown): Promise<AdminActionResult> {
  return guarded("admin.voice_control", async (operator) => {
    const parsed = controlInput.extend({ limitGbp: z.number().min(0).max(100_000).nullable() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "Enter a limit between £0 and £100,000, or clear it." };
    const denied = await authorise(operator.id, parsed.data);
    if (denied) return denied;
    const result = await asSystem(
      "admin_voice.set_spend_limit",
      { limitGbp: parsed.data.limitGbp, reason: parsed.data.reason, confirm: true },
      parsed.data.businessId,
      operator.id,
    );
    return result.ok ? { ok: true, message: parsed.data.limitGbp === null ? "Spending limit removed." : "Spending limit saved." } : result;
  });
}

const MAX_VOICE_WEBHOOK_RETRIES = 3;

/**
 * Re-queues a failed voice webhook through the voice ingest job (the path the
 * live webhook uses). The generic webhook replay has no voice path, which is
 * why this exists. Conditional on the failed state, so two operators cannot
 * both queue it; the ingest is idempotent on the event's dedupe key.
 */
export async function retryVoiceWebhook(input: unknown): Promise<AdminActionResult> {
  return guarded("admin.webhook_retried", async (operator) => {
    const parsed = z.object({ webhookEventId: z.uuid(), confirm: z.boolean() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: "That event reference is not valid." };
    const denied = await authorise(operator.id, { reason: "retry failed voice webhook", confirm: parsed.data.confirm });
    if (denied) return denied;
    const db = createAdminClient() as unknown as SupabaseClient;
    const { data: event } = await db
      .from("webhook_events")
      .select("id, provider, external_event_id, status, attempts, business_id")
      .eq("id", parsed.data.webhookEventId)
      .maybeSingle();
    const row = event as { id: string; provider: string; external_event_id: string; status: string; attempts: number; business_id: string | null } | null;
    if (!row) return { ok: false, error: "That event no longer exists." };
    if (row.provider !== "retell" && row.provider !== "twilio_voice") return { ok: false, error: "That is not a voice webhook." };
    if (row.status !== "failed") return { ok: false, error: "Only a failed event can be retried." };
    if (row.attempts >= MAX_VOICE_WEBHOOK_RETRIES) return { ok: false, error: `This event has reached the retry limit of ${MAX_VOICE_WEBHOOK_RETRIES}.` };
    const next = row.attempts + 1;
    const { data: moved, error } = await db
      .from("webhook_events")
      .update({ status: "received", attempts: next, last_error: null, processed_at: null })
      .eq("id", row.id)
      .eq("status", "failed")
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: "The event could not be re-queued." };
    if (!moved) return { ok: false, error: "Someone else has already retried this event." };
    await enqueue(
      "voice.webhook_ingest",
      { provider: row.provider === "retell" ? "retell" : "twilio", externalEventId: row.external_event_id },
      { priority: 10, idempotencyKey: `voice.webhook_ingest:admin-retry:${row.id}:${next}` },
    );
    await recordAudit({
      businessId: row.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.webhook_retried",
      entityType: "webhook_event",
      entityId: row.id,
      metadata: { provider: row.provider, attempt: next },
    });
    revalidatePath("/admin/system");
    return { ok: true, message: "Voice event re-queued." };
  });
}

/** Runs the voice GM check now and raises any below-75% alerts. */
export async function runVoiceMarginCheckNow(): Promise<AdminActionResult> {
  return guarded("admin.voice_margin_checked", async (operator) => {
    const result = await runVoiceMarginCheck();
    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.voice_margin_checked",
      metadata: result,
    });
    revalidatePath("/admin/system");
    if (result.state !== "ready") return { ok: false, error: "Voice is not on this database yet." };
    return {
      ok: true,
      message: result.raised === 0 ? `Checked ${result.checked} workspaces. No new alerts.` : `Raised ${result.raised} voice margin alert${result.raised === 1 ? "" : "s"}.`,
    };
  });
}
