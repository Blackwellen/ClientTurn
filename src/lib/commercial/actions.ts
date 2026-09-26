"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { commercialAuthoritySchema } from "./authority";

export type CommercialActionResult = { ok: true } | { ok: false; error: string };

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

  const { error } = await db.from("commercial_authority").upsert(
    {
      business_id: workspace.businessId,
      enabled: parsed.data.enabled,
      approved_checkout_links: parsed.data.approved_checkout_links,
      max_discount_percent: parsed.data.max_discount_percent,
      requires_human_above_value_minor: parsed.data.requires_human_above_value_minor,
      updated_by: workspace.userId,
    },
    { onConflict: "business_id" },
  );
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
  return { ok: true };
}
