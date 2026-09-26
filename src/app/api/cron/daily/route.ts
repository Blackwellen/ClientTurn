import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { scheduleSlackDigests } from "@/lib/jobs/handlers/slack-digest";

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

  await scheduleSlackDigests();
  enqueued.push("notification.slack_digest");

  // Sending-domain DNS health (Phase 3.5): SPF, DMARC and a DKIM selector
  // probe per active sender domain, written to domain_health_snapshots. One
  // job fans out over every workspace; the snapshot is keyed per day.
  await enqueue(
    "domain.health_check",
    {},
    { idempotencyKey: `domain-health:${dateKey}` },
  );
  enqueued.push("domain.health_check");

  // Complaint rate per sender identity over 7 days (§43): WATCH at 0.1%,
  // PAUSED at 0.3%. Fans out one job per workspace with an active sender.
  await enqueue("email.sender_health", {}, { idempotencyKey: `sender-health:${dateKey}` });
  enqueued.push("email.sender_health");

  // The WhatsApp approved-template registry (§45): the platform's Twilio
  // Content templates, then each Cloud API workspace's own.
  await enqueue("whatsapp.template_sync", {}, { idempotencyKey: `whatsapp-template-sync:${dateKey}` });
  enqueued.push("whatsapp.template_sync");

  // Failed-payment recovery (8.10): each failed subscription invoice is
  // retried at most once a day for up to 30 days and stops once paid; then
  // messaging overage is added to the customer's next invoice (8.13).
  await enqueue("billing.daily", {}, { idempotencyKey: `billing-daily:${dateKey}`, maxAttempts: 3 });
  enqueued.push("billing.daily");

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
