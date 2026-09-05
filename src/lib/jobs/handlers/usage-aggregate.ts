import "server-only";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePayload } from "./parse";
import { usageAggregatePayload } from "./payloads";

const METRICS = [
  "lead_processed",
  "message_sent",
  "message_received",
  "ai_call",
  "campaign_message",
] as const;

const PAGE = 1000;
const DEFAULT_PERIOD_DAYS = 30;

type Period = { start: Date; end: Date };

async function periodFor(businessId: string): Promise<Period> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("subscriptions")
    .select("current_period_start, current_period_end")
    .eq("business_id", businessId)
    .maybeSingle();

  if (data?.current_period_start) {
    return {
      start: new Date(data.current_period_start),
      end: data.current_period_end
        ? new Date(data.current_period_end)
        : new Date(),
    };
  }

  const end = new Date();
  return {
    start: new Date(end.getTime() - DEFAULT_PERIOD_DAYS * 864e5),
    end,
  };
}

async function totals(businessId: string, period: Period) {
  const admin = createAdminClient();
  const sums = new Map<string, number>(METRICS.map((metric) => [metric, 0]));

  for (let offset = 0; ; offset += PAGE) {
    const { data } = await admin
      .from("usage_events")
      .select("metric, quantity")
      .eq("business_id", businessId)
      .gte("occurred_at", period.start.toISOString())
      .lt("occurred_at", period.end.toISOString())
      .range(offset, offset + PAGE - 1);

    const rows = data ?? [];
    for (const row of rows) {
      sums.set(row.metric, (sums.get(row.metric) ?? 0) + Number(row.quantity));
    }
    if (rows.length < PAGE) break;
  }

  return sums;
}

/**
 * Derived, never authoritative: the counters are recomputed from the ledger
 * each run, so a re-run produces the same numbers rather than doubling them.
 */
export async function handleUsageAggregate(job: ClaimedJob) {
  const payload = parsePayload(usageAggregatePayload, job.payload);
  const admin = createAdminClient();

  let businessIds: string[];

  if (payload.businessId) {
    businessIds = [payload.businessId];
  } else {
    const { data } = await admin
      .from("businesses")
      .select("id")
      .in("status", ["active", "onboarding"])
      .limit(5000);
    businessIds = (data ?? []).map((row) => row.id);
  }

  for (const businessId of businessIds) {
    const period = await periodFor(businessId);
    const sums = await totals(businessId, period);

    const rows = [...sums].map(([metric, quantity]) => ({
      business_id: businessId,
      period_start: period.start.toISOString(),
      period_end: period.end.toISOString(),
      metric,
      quantity,
      computed_at: new Date().toISOString(),
    }));

    await admin
      .from("usage_counters")
      .upsert(rows, { onConflict: "business_id,period_start,metric" });
  }
}
