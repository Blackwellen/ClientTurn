import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recordThenQueue } from "../src/lib/jobs/inbox-core.ts";
import { STRIPE_PROCESSING_LEASE_MS, stripeEventReclaimable, stripeReclaimFilter } from "../src/lib/billing/stripe-inbox.ts";

/**
 * Backend QA 2026-09-28: a webhook recorded in `webhook_events` whose enqueue
 * then failed was lost for good. The route answered 5xx, the provider
 * redelivered, the insert hit the unique index and the redelivery was
 * acknowledged as a "duplicate". A fake inbox + queue reproduces it.
 */

class FakeInbox {
  rows = new Map<string, string>();
  jobs = new Set<string>();
  failQueue = 0;
  failStatusRead = false;

  async deliver(id: string) {
    return recordThenQueue({
      insert: async () => {
        if (this.rows.has(id)) return { code: "23505" };
        this.rows.set(id, "received");
        return null;
      },
      status: async () => {
        if (this.failStatusRead) throw new Error("read failed");
        return this.rows.get(id) ?? null;
      },
      queue: async () => {
        if (this.failQueue > 0) {
          this.failQueue--;
          throw new Error("database blip");
        }
        this.jobs.add(id); // idempotency key: a second add is a no-op
      },
    });
  }
}

describe("recordThenQueue", () => {
  test("first delivery: recorded and queued", async () => {
    const box = new FakeInbox();
    assert.equal(await box.deliver("SM1"), "QUEUED");
    assert.ok(box.jobs.has("SM1"));
  });

  test("an enqueue that failed on the first delivery is queued on the redelivery (was: acknowledged and lost)", async () => {
    const box = new FakeInbox();
    box.failQueue = 1;
    assert.equal(await box.deliver("SM2"), "FAILED"); // the provider gets a 5xx and retries
    assert.equal(box.jobs.size, 0);
    assert.equal(await box.deliver("SM2"), "REQUEUED");
    assert.ok(box.jobs.has("SM2"));
  });

  test("a redelivery of a processed event is a duplicate and queues nothing", async () => {
    const box = new FakeInbox();
    await box.deliver("SM3");
    box.rows.set("SM3", "processed");
    box.jobs.clear();
    assert.equal(await box.deliver("SM3"), "DUPLICATE");
    assert.equal(box.jobs.size, 0);
  });

  test("an unreadable inbox row on a redelivery is not acknowledged", async () => {
    const box = new FakeInbox();
    box.failQueue = 1;
    await box.deliver("SM4");
    box.failStatusRead = true;
    assert.equal(await box.deliver("SM4"), "FAILED");
  });

  test("any other insert error is not acknowledged", async () => {
    const out = await recordThenQueue({ insert: async () => ({ code: "57014" }), status: async () => null, queue: async () => undefined });
    assert.equal(out, "FAILED");
  });
});

describe("every inbox route that queues a job uses it", () => {
  const routes = [
    "src/app/api/webhooks/twilio/route.ts",
    "src/app/api/webhooks/meta/route.ts",
    "src/app/api/webhooks/calendly/route.ts",
    "src/app/api/webhooks/linkedin-ads/route.ts",
    "src/app/api/webhooks/slack/interactive/route.ts",
    "src/lib/voice/webhook-inbox.ts",
  ];
  for (const file of routes) {
    test(file, () => {
      const src = readFileSync(file, "utf8");
      assert.match(src, /recordThenQueue\(/);
    });
  }
});

describe("the Stripe billing inbox reclaims a killed attempt", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  test("failed rows are re-applied (unchanged behaviour)", () => {
    assert.equal(stripeEventReclaimable({ status: "failed", received_at: now.toISOString() }, now), true);
  });
  test("a processing row past its lease was killed mid-way and is reclaimed (was: acknowledged as a duplicate, lost)", () => {
    const old = new Date(now.getTime() - STRIPE_PROCESSING_LEASE_MS - 1000).toISOString();
    assert.equal(stripeEventReclaimable({ status: "processing", received_at: old }, now), true);
    assert.match(stripeReclaimFilter(now), /^status\.eq\.failed,and\(status\.eq\.processing,received_at\.lt\.2026-09-28T11:55:00\.000Z\)$/);
  });
  test("a live attempt inside its lease, or a processed event, is left alone", () => {
    assert.equal(stripeEventReclaimable({ status: "processing", received_at: new Date(now.getTime() - 30_000).toISOString() }, now), false);
    assert.equal(stripeEventReclaimable({ status: "processed", received_at: "2026-01-01T00:00:00.000Z" }, now), false);
    assert.ok(STRIPE_PROCESSING_LEASE_MS > 60_000 * 2, "well above the route's 60s limit");
  });
  test("the route uses the filter", () => {
    assert.match(readFileSync("src/app/api/webhooks/stripe/route.ts", "utf8"), /\.or\(stripeReclaimFilter\(/);
  });
});
