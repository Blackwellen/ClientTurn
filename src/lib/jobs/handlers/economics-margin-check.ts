import "server-only";
import { runMarginCheck } from "@/lib/admin/economics-alerts";

/**
 * `economics.margin_check`: the daily Admin → Economics margin alert. The
 * logic lives in `admin/economics-alerts.ts`; this is only the queue entry.
 * Retry-safe: the check re-reads usage and existing alerts on every run and
 * raises each workspace's alert at most once a month.
 */
export async function handleEconomicsMarginCheck(): Promise<void> {
  const result = await runMarginCheck();
  console.info("[economics.margin_check]", result);
}
