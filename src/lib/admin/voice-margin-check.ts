import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVoiceOps } from "./voice-ops";
import { margin, voiceMarginAlertFor, voiceRevenueLines, type LedgerSaleRow } from "./voice-ops-model";

/**
 * The voice gross-margin check (brief §59): raises an economics_alerts row
 * for each workspace whose voice GM this month is below 75%, once per
 * workspace per month. Same table, alert type and once-per-month rule as the
 * platform margin check (economics-alerts.ts, 0145); the period key is
 * `YYYY-MM:voice` so the two never collide.
 *
 * Retry-safe: it re-reads everything and the 0145 unique index absorbs a race.
 * Callable from the admin Voice ops view now, and from a scheduled job when
 * one is registered for it (the jobs area is owned elsewhere).
 */
export async function runVoiceMarginCheck(now = new Date()): Promise<{ checked: number; raised: number; state: string }> {
  const ops = await getVoiceOps(now);
  if (ops.state !== "ready") return { checked: 0, raised: 0, state: ops.state };
  const admin = createAdminClient();
  const periodKey = `${ops.month}:voice`;
  const monthStart = new Date(`${ops.month}-01T00:00:00.000Z`);

  const { data: existing, error } = await admin
    .from("economics_alerts")
    .select("business_id, metrics_json")
    .eq("alert_type", "MARGIN_BELOW_THRESHOLD")
    .gte("created_at", monthStart.toISOString());
  if (error) throw new Error(`Could not read existing margin alerts: ${error.message}`);
  const raisedKeys = new Set<string>();
  for (const row of existing ?? []) {
    if (row.business_id && (row.metrics_json as { period?: string } | null)?.period === periodKey) raisedKeys.add(`${row.business_id}:${ops.month}`);
  }

  // This month per workspace: provider cost (from the ops read), plus this
  // month's sales and their payment fees (read here, month-scoped).
  const monthly = new Map<string, { revenue: number; cogs: number }>();
  for (const w of ops.workspaces) monthly.set(w.businessId, { revenue: 0, cogs: w.providerSpendMonthGbp });
  const { data: ledger, error: ledgerError } = await admin
    .from("voice_minute_ledger")
    .select("business_id, kind, pack_delta_sec, included_delta_sec, created_at")
    .in("kind", ["PACK_PURCHASE", "PACK_REFUND", "PERIOD_GRANT"])
    .gte("created_at", monthStart.toISOString());
  if (ledgerError) throw new Error(`Could not read voice sales: ${ledgerError.message}`);
  for (const line of voiceRevenueLines((ledger ?? []) as LedgerSaleRow[]).lines) {
    const entry = monthly.get(line.businessId) ?? { revenue: 0, cogs: 0 };
    entry.revenue += line.sign * line.priceGbp;
    entry.cogs += line.sign * line.stripeFeeGbp;
    monthly.set(line.businessId, entry);
  }

  let raised = 0;
  for (const [businessId, totals] of monthly) {
    const name = ops.workspaces.find((w) => w.businessId === businessId)?.name ?? "a workspace";
    const alert = voiceMarginAlertFor({ businessId, name, margin: margin(totals.revenue, totals.cogs) }, ops.month, raisedKeys);
    if (!alert) continue;
    const { error: insertError } = await admin.from("economics_alerts").insert({
      business_id: alert.businessId,
      alert_type: "MARGIN_BELOW_THRESHOLD",
      severity: alert.severity,
      title: alert.title,
      detail: alert.detail,
      metrics_json: alert.metrics,
      status: "OPEN",
    });
    if (insertError && insertError.code !== "23505") throw new Error(`Could not raise a voice margin alert: ${insertError.message}`);
    if (!insertError) raised += 1;
    raisedKeys.add(`${businessId}:${ops.month}`);
  }
  return { checked: monthly.size, raised, state: "ready" };
}
