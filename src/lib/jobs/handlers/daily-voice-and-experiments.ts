import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";


/**
 * Two daily jobs, enqueued by `/api/cron/daily` (docs/CRON.md):
 *
 *   voice.margin_check      Admin -> Economics voice alert: raises an
 *                           economics alert for any workspace whose voice
 *                           gross margin this month is under the floor
 *                           (admin/voice-margin-check.ts). Read-only on
 *                           customer data; writes only the alert rows.
 *   experiment.auto_promote One evaluation pass over RUNNING experiments whose
 *                           owner or admin switched auto-promote ON (off by
 *                           default). Each goes through the ordinary
 *                           `experiment.promote` operation as SYSTEM, so the
 *                           significance, sample-size and compliance-sensitive
 *                           guards in learning/promotion.ts decide; a refusal
 *                           (not yet significant, sensitive field) is a no-op.
 */

export async function handleVoiceMarginCheck(): Promise<void> {
  const { runVoiceMarginCheck } = await import("@/lib/admin/voice-margin-check");
  const result = await runVoiceMarginCheck();
  console.info(`[voice.margin_check] state=${result.state} checked=${result.checked} raised=${result.raised}`);
}

const AUTO_PROMOTE_BATCH = 200;

export async function handleExperimentAutoPromote(): Promise<void> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin
    .from("experiments")
    .select("id, business_id")
    .eq("status", "RUNNING")
    .eq("auto_promote", true)
    .is("promoted_arm", null)
    .limit(AUTO_PROMOTE_BATCH);
  if (error) {
    // The promotion columns (0158) not present: nothing can be auto-promoted.
    if (["42703", "42P01", "PGRST204"].includes(error.code ?? "")) return;
    throw new Error(`experiment.auto_promote: ${error.message}`);
  }
  const { runOperation } = await import("@/lib/services");
  let promoted = 0;
  for (const row of (data ?? []) as { id: string; business_id: string }[]) {
    const result = await runOperation(
      "experiment.promote",
      { experimentId: row.id, reason: "Automatic promotion: a significant winner with auto-promote on." },
      { businessId: row.business_id, userId: null, role: "owner", caller: "SYSTEM", correlationId: randomUUID() },
    );
    if (result.success) promoted++;
  }
  console.info(`[experiment.auto_promote] evaluated=${(data ?? []).length} promoted=${promoted}`);
}
