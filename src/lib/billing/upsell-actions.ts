"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole, requireWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { canSeeUpsells, isUpsellMomentKey, shouldRecordImpression } from "./upsell-moments";
import { loadUpsellHistory } from "./upsell-service";

/**
 * Upsell analytics and the owner's "Show me upgrade suggestions" setting.
 * Buying goes through the existing checkout actions (startTokenTopUp,
 * startCreditPurchase, startPlanCheckout); nothing here charges anything.
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const eventSchema = z.object({
  moment: z
    .string()
    .max(80)
    .refine((value) => isUpsellMomentKey(value.split(":")[0]) || value === "billing_passive", "Unknown moment."),
  offer: z.enum(["ai_token_pack", "whatsapp_tokens", "tier_upgrade"]),
  surface: z.enum(["modal", "banner", "card"]),
  event: z.enum(["impression", "click", "dismiss"]),
});

export type UpsellEventResult = { ok: true } | { ok: false; error: string };

/** Impression (once a day per moment and surface), click or dismiss (snooze 30 days). */
export async function recordUpsellEventAction(input: unknown): Promise<UpsellEventResult> {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid event." };
  const workspace = await requireWorkspace().catch(() => null);
  if (!workspace || !canSeeUpsells(workspace.role)) return { ok: false, error: "Not allowed." };

  const now = new Date();
  if (parsed.data.event === "impression") {
    const history = await loadUpsellHistory(workspace.businessId, workspace.userId, now).catch(() => null);
    if (
      history &&
      !shouldRecordImpression({
        moment: parsed.data.moment,
        surface: parsed.data.surface,
        userId: workspace.userId,
        history,
        now,
      })
    ) {
      return { ok: true };
    }
  }

  const { error } = await db().from("upsell_events").insert({
    business_id: workspace.businessId,
    user_id: workspace.userId,
    moment: parsed.data.moment,
    offer: parsed.data.offer,
    surface: parsed.data.surface,
    event: parsed.data.event,
  });
  if (error) return { ok: false, error: "Could not save." };
  return { ok: true };
}

const settingSchema = z.object({ enabled: z.boolean() });

export async function setUpgradeSuggestionsAction(input: unknown): Promise<UpsellEventResult> {
  const parsed = settingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid setting." };
  const workspace = await requireRole("owner").catch(() => null);
  if (!workspace) return { ok: false, error: "Only the workspace owner can change this." };

  const { data, error } = await db()
    .from("business_settings")
    .update({ upgrade_suggestions_enabled: parsed.data.enabled })
    .eq("business_id", workspace.businessId)
    .select("business_id");
  if (error || !data?.length) return { ok: false, error: "Could not save the setting. Try again." };

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "billing.upgrade_suggestions_changed",
    entityType: "business_settings",
    metadata: { enabled: parsed.data.enabled },
  });
  revalidatePath("/app/settings");
  revalidatePath("/app");
  return { ok: true };
}
