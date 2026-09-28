import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { logEvent } from "@/lib/observability/log";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * Platform-operator emergency controls for AI calling (brief §58).
 *
 * These are ClientTurn staff controls, not workspace settings. Every one is
 * declared `callers: ["SYSTEM"]` in the registry, so no workspace user, API
 * key, MCP client, Copilot or agent can reach them. The only caller is the
 * admin shell (src/lib/admin/voice-ops-actions.ts), which first runs
 * `guarded()`: platform_role read server-side from the database, a step-up in
 * the last 30 minutes, and an audit row on refusal. The runtime then audits
 * the change itself (actor = the operator, caller = SYSTEM).
 *
 * Confirmation is enforced HERE, not only in the dialog: each schema requires
 * `confirm: true`, so a call without an explicit yes is refused as invalid.
 *
 * The platform kill switch for a whole workspace is voice-P2's
 * `voice.admin_disable_workspace` (0150 columns); these add the narrower
 * controls on the 0158 columns. Until 0158 is applied they say so.
 */

type Untyped = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const db = () => createAdminClient() as unknown as Untyped;

const confirmed = z.literal(true, { message: "Confirm this change before it is applied." });
const reason = z.string().trim().min(4, "Give a reason for the audit log.").max(500);

function pending(error: { code?: string | null; message: string }): never {
  if (isSchemaLag(error)) {
    throw new ServiceError("UNAVAILABLE", "This control needs migration 0158, which is not applied on this database yet.");
  }
  throw new ServiceError("UNAVAILABLE", "The change could not be saved.");
}

async function settingsRow(businessId: string) {
  const { data, error } = await db()
    .from("voice_settings")
    .select("business_id, admin_outbound_paused, admin_spend_limit_gbp_month")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) pending(error);
  return data as { business_id: string; admin_outbound_paused: boolean; admin_spend_limit_gbp_month: number | string | null } | null;
}

defineOperation("admin_voice.pause_outbound", {
  schema: z.object({ paused: z.boolean(), reason, confirm: confirmed }),
  async run({ args, context }: HandlerInput<{ paused: boolean; reason: string; confirm: true }>) {
    const before = await settingsRow(context.businessId);
    const now = new Date().toISOString();
    const { error } = await db()
      .from("voice_settings")
      .upsert(
        {
          business_id: context.businessId,
          admin_outbound_paused: args.paused,
          admin_outbound_paused_reason: args.paused ? args.reason : null,
          admin_controls_updated_at: now,
        },
        { onConflict: "business_id" },
      );
    if (error) pending(error);
    logEvent("admin.voice_control", { control: "pause_outbound", businessId: context.businessId, paused: args.paused });
    return {
      data: { paused: args.paused },
      entityId: context.businessId,
      before: { admin_outbound_paused: Boolean(before?.admin_outbound_paused) },
      after: { admin_outbound_paused: args.paused, reason: args.reason },
    };
  },
});

defineOperation("admin_voice.suspend_number", {
  schema: z.object({ numberId: z.uuid(), suspended: z.boolean(), reason, confirm: confirmed }),
  async run({ args, context }: HandlerInput<{ numberId: string; suspended: boolean; reason: string; confirm: true }>) {
    const { data: row, error: readError } = await db()
      .from("business_numbers")
      .select("id, business_id, provisioning_state, admin_suspended_at")
      .eq("business_id", context.businessId)
      .eq("id", args.numberId)
      .maybeSingle();
    if (readError) pending(readError);
    if (!row) throw new ServiceError("NOT_FOUND", "That number does not belong to this workspace.");
    const now = new Date().toISOString();
    const { error } = await db()
      .from("business_numbers")
      .update(args.suspended ? { admin_suspended_at: now, admin_suspended_reason: args.reason } : { admin_suspended_at: null, admin_suspended_reason: null })
      .eq("business_id", context.businessId)
      .eq("id", args.numberId);
    if (error) pending(error);
    logEvent("admin.voice_control", { control: "suspend_number", businessId: context.businessId, numberId: args.numberId, suspended: args.suspended });
    return {
      data: { suspended: args.suspended },
      entityId: args.numberId,
      before: { admin_suspended: Boolean((row as { admin_suspended_at: string | null }).admin_suspended_at) },
      after: { admin_suspended: args.suspended, reason: args.reason },
    };
  },
});

defineOperation("admin_voice.set_spend_limit", {
  schema: z.object({
    /** GBP per calendar month of provider spend. Null removes the ceiling. */
    limitGbp: z.number().min(0).max(100_000).nullable(),
    reason,
    confirm: confirmed,
  }),
  async run({ args, context }: HandlerInput<{ limitGbp: number | null; reason: string; confirm: true }>) {
    const before = await settingsRow(context.businessId);
    const { error } = await db()
      .from("voice_settings")
      .upsert(
        {
          business_id: context.businessId,
          admin_spend_limit_gbp_month: args.limitGbp,
          admin_controls_updated_at: new Date().toISOString(),
        },
        { onConflict: "business_id" },
      );
    if (error) pending(error);
    logEvent("admin.voice_control", { control: "spend_limit", businessId: context.businessId, limitGbp: args.limitGbp });
    return {
      data: { limitGbp: args.limitGbp },
      entityId: context.businessId,
      before: { admin_spend_limit_gbp_month: before?.admin_spend_limit_gbp_month === undefined || before?.admin_spend_limit_gbp_month === null ? null : Number(before.admin_spend_limit_gbp_month) },
      after: { admin_spend_limit_gbp_month: args.limitGbp, reason: args.reason },
    };
  },
});
