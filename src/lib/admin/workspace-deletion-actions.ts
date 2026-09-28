"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { isSchemaMissing } from "@/lib/billing/stripe-events";
import { guarded, type AdminActionResult } from "./guarded";

/**
 * The HOLD on a scheduled day-90 deletion: a dispute, a legal hold or a
 * customer in talks. A held workspace gets no notice and is never deleted
 * while held (billing/workspace-deletion.ts `decide`, and the job re-reads the
 * hold immediately before erasing). Releasing it resumes the schedule; if the
 * final notice was never sent it is sent first and deletion waits 7 days.
 *
 * Guarded: platform admin, step-up, audited. A hold needs a reason.
 */
const holdSchema = z.discriminatedUnion("hold", [
  z.object({ businessId: z.uuid(), hold: z.literal(true), reason: z.string().trim().min(3).max(500) }),
  z.object({ businessId: z.uuid(), hold: z.literal(false), reason: z.string().trim().max(500).optional() }),
]);

export async function setDeletionHold(input: {
  businessId: string;
  hold: boolean;
  reason?: string;
}): Promise<AdminActionResult> {
  return guarded(input.hold ? "workspace.deletion_hold_set" : "workspace.deletion_hold_released", async (operator) => {
    const parsed = holdSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: input.hold ? "Give the reason for the hold (a dispute, a legal hold)." : "That workspace is not valid." };
    }
    const now = new Date().toISOString();
    const db = createAdminClient() as unknown as SupabaseClient;
    const { data, error } = await db
      .from("workspace_deletion_schedule")
      .update(
        parsed.data.hold
          ? { hold: true, hold_reason: parsed.data.reason, held_by: operator.id, held_at: now, updated_at: now }
          : { hold: false, hold_reason: null, held_by: null, held_at: null, updated_at: now },
      )
      .eq("business_id", parsed.data.businessId)
      .is("deleted_at", null)
      .select("business_id")
      .maybeSingle();

    if (error) {
      return { ok: false, error: isSchemaMissing(error) ? "Scheduled deletion needs migration 0170 applied first." : "The hold could not be saved." };
    }
    if (!data) return { ok: false, error: "That workspace is not on the deletion schedule (or is already deleted)." };

    await recordAudit({
      businessId: parsed.data.businessId,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: parsed.data.hold ? "workspace.deletion_hold_set" : "workspace.deletion_hold_released",
      entityType: "business",
      entityId: parsed.data.businessId,
      metadata: { reason: parsed.data.reason ?? null },
    });

    revalidatePath("/admin/billing/deletions");
    return {
      ok: true,
      message: parsed.data.hold
        ? "Held. No notice or deletion while the hold stands."
        : "Hold released. The schedule resumes at the next daily run.",
    };
  });
}
