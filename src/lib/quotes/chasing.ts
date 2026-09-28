import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { stopAutomationRuns } from "@/lib/jobs/handlers/shared";
import { recordAudit } from "@/lib/audit";
import { logWriteError } from "@/lib/supabase/write-result";
import { chaseStopPlan } from "./follow-up";

/**
 * Paid -> stop all sales chasing, immediately (brief §72; follow-up.ts
 * `chaseStopPlan`): the lead's follow-up automation is switched off and its
 * runs stopped, and every queued quote reminder, abandoned-checkout nudge and
 * re-engagement trigger for the lead is cancelled. Invoice reminders are
 * billing, not selling, and carry on.
 *
 * Idempotent (a second call finds nothing left to stop) and never throws: a
 * payment is never refused because a clean-up failed. Every job it would
 * have cancelled re-reads the quote and the lead before acting anyway.
 */
export async function stopSalesChasing(businessId: string, quoteId: string, status: "PAID" | "DEPOSIT_PAID"): Promise<void> {
  const plan = chaseStopPlan(status);
  if (!plan.stop) return;
  try {
    const db = createAdminClient() as unknown as SupabaseClient;
    const { data: quote } = await db.from("quotes").select("opportunity_id").eq("business_id", businessId).eq("id", quoteId).maybeSingle();
    const opportunityId = (quote as { opportunity_id: string } | null)?.opportunity_id;
    if (!opportunityId) return;
    const { data: opp } = await db.from("opportunities").select("lead_id").eq("business_id", businessId).eq("id", opportunityId).maybeSingle();
    const leadId = (opp as { lead_id: string | null } | null)?.lead_id ?? null;
    if (!leadId) return;

    logWriteError(
      await db.from("leads").update({ automation_active: false }).eq("business_id", businessId).eq("id", leadId).eq("automation_active", true),
      "quote paid: stop follow-up",
      { businessId, leadId },
    );
    await stopAutomationRuns(businessId, leadId, "won");

    const now = new Date().toISOString();
    const { data: pending } = await db
      .from("jobs")
      .select("id, type, payload")
      .eq("business_id", businessId)
      .eq("state", "pending")
      .in("type", [...plan.cancelJobTypes])
      .limit(200);
    const mine = ((pending ?? []) as { id: string; type: string; payload: Record<string, unknown> | null }[]).filter(
      (job) => job.payload?.quoteId === quoteId || job.payload?.leadId === leadId,
    );
    if (mine.length > 0) {
      logWriteError(
        await db
          .from("jobs")
          .update({ state: "cancelled", cancel_requested_at: now, cancelled_at: now, last_error: "Cancelled: the quote was paid." })
          .in("id", mine.map((job) => job.id))
          .eq("state", "pending"),
        "quote paid: cancel sales chases",
        { businessId, leadId },
      );
    }
    await recordAudit({
      businessId,
      actorType: "system",
      action: "quote.chasing_stopped",
      entityType: "quote",
      entityId: quoteId,
      metadata: { lead_id: leadId, status, cancelled_jobs: mine.length },
    });
  } catch (error) {
    console.error("[quote paid] sales chasing not stopped", { businessId, quoteId, error: error instanceof Error ? error.message : String(error) });
  }
}
