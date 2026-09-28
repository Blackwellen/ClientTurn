"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { recordAudit } from "@/lib/audit";
import { guarded, type AdminActionResult } from "./guarded";
import { normaliseHoldReason } from "./support-signals-types";

/**
 * Admin -> Customers -> support drawer: pause or resume one workspace's
 * LinkedIn Assist (0175 linkedin_assist_workspace_holds). For abuse, a
 * complaint, or an account LinkedIn has restricted. Every call goes through
 * `guarded`: platform_role checked server-side, step-up required, and a
 * refused or failed attempt audited; success is audited here with the reason.
 *
 * While held, every person's list shows replies only, nobody new can be
 * added and no AI draft is written (lib/linkedin-assist/store.ts). Nothing is
 * deleted, so resuming puts everything back as it was.
 */

const NOT_INSTALLED = "Pausing LinkedIn Assist needs migration 0175, which is not applied yet.";

const pauseInput = z.object({ businessId: z.string().uuid(), reason: z.string().max(2000) });
const resumeInput = z.object({ businessId: z.string().uuid() });

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export async function pauseWorkspaceLinkedInAssist(input: { businessId: string; reason: string }): Promise<AdminActionResult> {
  return guarded("admin.linkedin_assist_paused", async (operator) => {
    const parsed = pauseInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That workspace is not valid." };
    const reason = normaliseHoldReason(parsed.data.reason);
    if (!reason) return { ok: false, error: "Give a reason (3 to 500 characters). The workspace is told support paused it." };

    const { data: business } = await db().from("businesses").select("id").eq("id", parsed.data.businessId).maybeSingle();
    if (!business) return { ok: false, error: "That workspace no longer exists." };

    // Idempotent: a second pause keeps the first hold (and its time).
    const { error } = await db()
      .from("linkedin_assist_workspace_holds")
      .upsert({ business_id: parsed.data.businessId, reason, held_by: operator.id }, { onConflict: "business_id", ignoreDuplicates: true });
    if (error) return { ok: false, error: isSchemaLag(error) ? NOT_INSTALLED : "The pause could not be saved." };

    await recordAudit({
      businessId: parsed.data.businessId,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.linkedin_assist_paused",
      entityType: "business",
      entityId: parsed.data.businessId,
      metadata: { outcome: "ok", reason },
    });
    revalidatePath("/admin/customers");
    return { ok: true, message: "LinkedIn Assist paused for this workspace. Replies still show." };
  });
}

export async function resumeWorkspaceLinkedInAssist(input: { businessId: string }): Promise<AdminActionResult> {
  return guarded("admin.linkedin_assist_resumed", async (operator) => {
    const parsed = resumeInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "That workspace is not valid." };

    const { data, error } = await db()
      .from("linkedin_assist_workspace_holds")
      .delete()
      .eq("business_id", parsed.data.businessId)
      .select("reason");
    if (error) return { ok: false, error: isSchemaLag(error) ? NOT_INSTALLED : "The pause could not be lifted." };
    const removed = ((data ?? []) as { reason: string }[])[0] ?? null;
    if (!removed) return { ok: true, message: "LinkedIn Assist was not paused for this workspace." };

    await recordAudit({
      businessId: parsed.data.businessId,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.linkedin_assist_resumed",
      entityType: "business",
      entityId: parsed.data.businessId,
      metadata: { outcome: "ok", previous_reason: removed.reason },
    });
    revalidatePath("/admin/customers");
    return { ok: true, message: "LinkedIn Assist resumed for this workspace." };
  });
}
