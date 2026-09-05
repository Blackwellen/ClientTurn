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
