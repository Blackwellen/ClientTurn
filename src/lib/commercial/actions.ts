"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { commercialAuthoritySchema } from "./authority";
import { normaliseAiAuthorityInput } from "./ai-permissions";

export type CommercialActionResult = { ok: true; warning?: string } | { ok: false; error: string };

/**
 * Saves the workspace's commercial authority (decision Q2). Owner/admin only,
 * checked server-side; the whole row is validated by the same zod schema the
 * agent reads with, so a link that would not be honoured can never be saved.
 */
export async function saveCommercialAuthority(input: unknown): Promise<CommercialActionResult> {
  const parsed = commercialAuthoritySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue ? `${issue.path.join(".") || "Settings"}: ${issue.message}` : "Invalid settings." };
  }

  const workspace = await requireRole("admin");
  // commercial_authority (0125) post-dates the generated database types.
  const db = createAdminClient() as unknown as SupabaseClient;

  const { data: before } = await db
    .from("commercial_authority")
    .select("enabled, max_discount_percent, approved_checkout_links")
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  const row: Record<string, unknown> = {
    business_id: workspace.businessId,
    enabled: parsed.data.enabled,
    approved_checkout_links: parsed.data.approved_checkout_links,
    max_discount_percent: parsed.data.max_discount_percent,
    requires_human_above_value_minor: parsed.data.requires_human_above_value_minor,
    updated_by: workspace.userId,
  };
  const abandoned = parsed.data.abandoned_checkout;
  if (abandoned) {
    // Abandoned-checkout follow-up (0143).
    row.abandoned_checkout_enabled = abandoned.enabled;
    row.abandoned_checkout_delay_hours = abandoned.delay_hours;
    row.abandoned_checkout_max_nudges = abandoned.max_nudges;
    row.abandoned_checkout_gap_hours = abandoned.gap_hours;
  }
  let { error } = await db.from("commercial_authority").upsert(row, { onConflict: "business_id" });
  let warning: string | null = null;
  if (error && abandoned && isSchemaLag(error)) {
    // Before 0143: keep the links and limits; the follow-up settings wait.
    delete row.abandoned_checkout_enabled;
    delete row.abandoned_checkout_delay_hours;
    delete row.abandoned_checkout_max_nudges;
    delete row.abandoned_checkout_gap_hours;
    ({ error } = await db.from("commercial_authority").upsert(row, { onConflict: "business_id" }));
    warning = "Saved, but the abandoned-checkout settings need database update 0143 before they take effect.";
  }
  if (error) return { ok: false, error: "Those selling settings could not be saved." };

  const prior = before as { enabled?: boolean; max_discount_percent?: number; approved_checkout_links?: unknown[] } | null;
  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "commercial_authority.updated",
    entityType: "business",
    entityId: workspace.businessId,
    metadata: {
      before: prior
        ? {
            enabled: prior.enabled ?? false,
            max_discount_percent: prior.max_discount_percent ?? 0,
            links: prior.approved_checkout_links?.length ?? 0,
          }
        : null,
      after: {
        enabled: parsed.data.enabled,
        max_discount_percent: parsed.data.max_discount_percent,
        links: parsed.data.approved_checkout_links.length,
      },
    },
  });

  revalidatePath("/app/settings");
  return warning ? { ok: true, warning } : { ok: true };
}

/**
 * Saves what the AI may do (brief §74, commercial authority v2): the
 * per-capability switches and the assistant's discount policy. Owner/admin
 * only, checked server-side; validated by the same schema the gates read
 * with (ai-permissions.ts), dependencies applied (sending needs drafting).
 */
export async function saveAiAuthority(input: unknown): Promise<CommercialActionResult> {
  const normalised = normaliseAiAuthorityInput(input);
  if (!normalised.ok) return { ok: false, error: normalised.path ? `${normalised.path}: ${normalised.message}` : normalised.message };

  const workspace = await requireRole("admin");
  const db = createAdminClient() as unknown as SupabaseClient;
  const { data: before } = await db
    .from("commercial_authority")
    .select("*")
    .eq("business_id", workspace.businessId)
    .maybeSingle();

  const { error } = await db.from("commercial_authority").upsert(
    {
      business_id: workspace.businessId,
      ai_permissions: normalised.value.capabilities,
      ai_discount_policy: normalised.value.discount,
      updated_by: workspace.userId,
    },
    { onConflict: "business_id" },
  );
  if (error) {
    if (isSchemaLag(error)) {
      return { ok: false, error: "These settings need database update 0160 before they can be saved. Nothing was changed." };
    }
    return { ok: false, error: "Those settings could not be saved." };
  }

  const prior = (before ?? null) as { ai_permissions?: unknown; ai_discount_policy?: unknown } | null;
  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "commercial_authority.ai_updated",
    entityType: "business",
    entityId: workspace.businessId,
    metadata: {
      before: prior ? { capabilities: prior.ai_permissions ?? null, discount: prior.ai_discount_policy ?? null } : null,
      after: { capabilities: normalised.value.capabilities, discount: normalised.value.discount },
    },
  });

  revalidatePath("/app/settings");
  return { ok: true };
}
