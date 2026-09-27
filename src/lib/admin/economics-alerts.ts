import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMonthToDate } from "./economics-live";
import { marginAlertFor, periodKey } from "./economics-model";

/**
 * The daily margin check (`economics.margin_check`, enqueued by the daily cron).
 *
 * Raises an admin notification -- an `economics_alerts` row, which the admin
 * bell counts and Admin → Economics lists -- when a workspace's month-to-date
 * margin, or its projected month-end margin, is below 75%. At most once per
 * workspace per calendar month: the check reads what it already raised this
 * month, and the unique index from 0145 settles a race between two runs.
 *
 * Retry-safe: it re-reads everything on each run and writes nothing twice.
 */
export async function runMarginCheck(now = new Date()): Promise<{ checked: number; raised: number }> {
  const admin = createAdminClient();
  const { period, rows } = await loadMonthToDate(now);
  const key = periodKey(period);

  const { data: existing, error } = await admin
    .from("economics_alerts")
    .select("business_id, metrics_json")
    .eq("alert_type", "MARGIN_BELOW_THRESHOLD")
    .gte("created_at", period.start.toISOString());
  if (error) throw new Error(`Could not read existing margin alerts: ${error.message}`);

  const alreadyRaised = new Set<string>();
  for (const row of existing ?? []) {
    const alertPeriod = (row.metrics_json as { period?: string } | null)?.period;
    if (row.business_id && alertPeriod === key) alreadyRaised.add(`${row.business_id}:${key}`);
  }

  let raised = 0;
  for (const row of rows) {
    const alert = marginAlertFor(row, period, alreadyRaised);
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
    // 23505: another run raised it first. That is the once-per-month rule
    // working, not a failure.
    if (insertError && insertError.code !== "23505") {
      throw new Error(`Could not raise a margin alert: ${insertError.message}`);
    }
    if (!insertError) raised += 1;
    alreadyRaised.add(`${alert.businessId}:${key}`);
  }

  return { checked: rows.length, raised };
}
