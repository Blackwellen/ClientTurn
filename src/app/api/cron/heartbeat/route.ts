import { NextResponse } from "next/server";
import { runOpsAlertChecks, workerIsAlive } from "@/lib/ops/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Worker heartbeat for an EXTERNAL uptime monitor (docs/CRON.md "Alerts").
 *
 * Every other ops check runs from pg_cron, so if pg_cron itself stops, or the
 * Vault secret is rotated on one side only, nothing inside the system notices.
 * An outside monitor (any free HTTP uptime checker) calling this every few
 * minutes closes that gap:
 *
 *   200 {"ok":true}   the worker was scheduled recently and jobs are completing
 *   503 {"ok":false}  it has not; the ops alert (email / webhook) is also sent,
 *                     deduped to one an hour
 *
 * Unauthenticated on purpose (monitors rarely send headers) and it discloses
 * nothing but that boolean. The result is cached for 30 s per instance, so
 * hammering it costs two indexed reads every 30 s at most. Under /api/cron,
 * so the maintenance gate never blocks it.
 */

const CACHE_MS = 30_000;
let cached: { at: number; ok: boolean } | null = null;

export async function GET() {
  const now = Date.now();
  if (!cached || now - cached.at > CACHE_MS) {
    const ok = await workerIsAlive(new Date(now));
    cached = { at: now, ok };
    if (!ok) await runOpsAlertChecks("heartbeat", { now: new Date(now) });
  }
  return NextResponse.json(
    { ok: cached.ok },
    { status: cached.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
