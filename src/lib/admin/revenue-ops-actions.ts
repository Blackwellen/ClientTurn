"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import {
  MergeError,
  resolveMergeCandidate,
  revertMerge,
} from "@/lib/identity/merge";
import { guarded, type AdminActionResult } from "./guarded";

/**
 * Admin -> System -> Lead ops writes: resolving a duplicate pair and undoing a
 * merge. Both go through `guarded` (platform admin re-checked, step-up
 * required, failures audited) and through `lib/identity/merge.ts`, the one
 * implementation of what a merge does -- the same one the workspace's
 * `merge_candidate.resolve` operation uses.
 */

const resolveInput = z.object({
  candidateId: z.string().uuid(),
  decision: z.enum(["MERGE", "DISMISS"]),
  keeperId: z.string().uuid().nullable().optional(),
});

async function candidateBusiness(candidateId: string): Promise<string | null> {
  const { data } = await (createAdminClient() as unknown as SupabaseClient)
    .from("merge_candidates")
    .select("business_id")
    .eq("id", candidateId)
    .maybeSingle();
  return (data as { business_id: string } | null)?.business_id ?? null;
}

export async function resolveMergeCandidateAdmin(input: {
  candidateId: string;
  decision: "MERGE" | "DISMISS";
  keeperId?: string | null;
}): Promise<AdminActionResult> {
  return guarded("admin.merge_candidate_resolved", async (operator) => {
    const parsed = resolveInput.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        error: "That duplicate pair reference is not valid.",
      };

    const businessId = await candidateBusiness(parsed.data.candidateId);
    if (!businessId)
      return { ok: false, error: "That duplicate pair no longer exists." };

    try {
      const result = await resolveMergeCandidate({
        businessId,
        candidateId: parsed.data.candidateId,
        decision: parsed.data.decision,
        keeperId: parsed.data.keeperId ?? null,
        actor: { userId: operator.id, type: "USER" },
      });
      await recordAudit({
        businessId,
        actorUserId: operator.id,
        actorType: "platform_admin",
        action: "admin.merge_candidate_resolved",
        entityType: "merge_candidate",
        entityId: parsed.data.candidateId,
        metadata: { outcome: "succeeded", ...result },
      });
      revalidatePath("/admin/system");
      return {
        ok: true,
        message:
          result.decision === "MERGED"
            ? "Merged. The merge can be undone from the Merged list."
            : "Dismissed. The two records stay separate.",
      };
    } catch (error) {
      if (error instanceof MergeError)
        return { ok: false, error: error.message };
      throw error;
    }
  });
}

const revertInput = z.object({ mergeEventId: z.string().uuid() });

export async function revertMergeAdmin(input: {
  mergeEventId: string;
}): Promise<AdminActionResult> {
  return guarded("admin.merge_reverted", async (operator) => {
    const parsed = revertInput.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: "That merge reference is not valid." };

    const { data } = await (createAdminClient() as unknown as SupabaseClient)
      .from("merge_events")
      .select("business_id")
      .eq("id", parsed.data.mergeEventId)
      .maybeSingle();
    const businessId = (data as { business_id: string } | null)?.business_id;
    if (!businessId)
      return { ok: false, error: "That merge no longer exists." };

    try {
      const result = await revertMerge({
        businessId,
        mergeEventId: parsed.data.mergeEventId,
        actorUserId: operator.id,
      });
      await recordAudit({
        businessId,
        actorUserId: operator.id,
        actorType: "platform_admin",
        action: "admin.merge_reverted",
        entityType: "merge_event",
        entityId: parsed.data.mergeEventId,
        metadata: { outcome: "succeeded", ...result },
      });
      revalidatePath("/admin/system");
      return {
        ok: true,
        message: result.keptFields.length
          ? `Merge undone. ${result.keptFields.join(", ")} had been edited since and were left as they are.`
          : "Merge undone. Both records are back as they were.",
      };
    } catch (error) {
      if (error instanceof MergeError)
        return { ok: false, error: error.message };
      throw error;
    }
  });
}
