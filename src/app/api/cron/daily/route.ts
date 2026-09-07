import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Once-a-day trigger. This route only enqueues; `/api/cron/worker` (running
 * every minute) does the actual work, so a slow rollup can never block the
 * message pipeline. Idempotency keys mean a duplicate cron fire is a no-op.
 *
 * Also closes a pre-existing gap: `usage.aggregate` and `retention.cleanup`
 * job types had handlers registered but nothing that ever enqueued them.
 */
export async function GET(request: Request) {
  const secret = serverEnv.cronSecret;
  const provided =
    request.headers.get("authorization")?.replace("Bearer ", "") ??
    new URL(request.url).searchParams.get("secret");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const isFirstOfMonth = now.getUTCDate() === 1;

  const enqueued: string[] = [];

  await enqueue("cost.rollup_daily", {}, { idempotencyKey: `cost-rollup-daily:${dateKey}` });
  enqueued.push("cost.rollup_daily");

  await enqueue("usage.aggregate", {}, { idempotencyKey: `usage-aggregate:${dateKey}` });
  enqueued.push("usage.aggregate");

  await enqueue("retention.cleanup", {}, { idempotencyKey: `retention-cleanup:${dateKey}` });
  enqueued.push("retention.cleanup");

  // Expires stale intent matches and releases reservations left behind by a
  // worker that died mid-flight. Without this, expired signals keep inflating
  // prospect scores and abandoned reservations permanently consume allowance.
  await enqueue("maintenance.expiry", {}, { idempotencyKey: `maintenance-expiry:${dateKey}` });
  enqueued.push("maintenance.expiry");

  // Recurring sourcing. The sweep re-runs plans the customer already approved
  // and whose bounds have not changed since; each run still passes the full
  // budget and entitlement check, so a workspace out of allowance simply
  // produces no run this cycle.
  await enqueue(
    "recurring_search.tick",
    {},
    { idempotencyKey: `recurring-search:${dateKey}` },
  );
  enqueued.push("recurring_search.tick");

  // The affiliate ledger. Approves commission that has cleared its refund
  // hold, expires abandoned trials, flags self-referrals, and raises payouts
  // for partners who are ready and over the threshold. Idempotent throughout,
  // so a re-run on the same day approves and pays nothing twice.
  await enqueue(
    "affiliate.ledger",
    {},
    { idempotencyKey: `affiliate-ledger:${dateKey}` },
  );
  enqueued.push("affiliate.ledger");

  // Bounded auto-optimisation. Only campaigns that opted in are touched, and
  // every proposal is checked against that campaign's stored bounds before it
  // is written — a refusal is recorded with its reason rather than dropped.
  await enqueue(
    "outreach.optimize",
    {},
    { idempotencyKey: `outreach-optimize:${dateKey}` },
  );
  enqueued.push("outreach.optimize");

  if (isFirstOfMonth) {
    await enqueue(
      "cost.rollup_monthly",
      {},
      { idempotencyKey: `cost-rollup-monthly:${dateKey}` },
    );
    enqueued.push("cost.rollup_monthly");
  }

  return NextResponse.json({ enqueued });
}
