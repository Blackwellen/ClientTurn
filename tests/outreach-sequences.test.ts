import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  bucketFor,
  chooseVariant,
  warmupAllowance,
} from "../src/lib/outreach/variant-allocation.ts";

/**
 * Variant allocation and sender warm-up.
 *
 * Both decide something a customer cannot see happening: which of two messages
 * a stranger received, and how many strangers a new domain may write to today.
 * A bug in the first makes an experiment unreadable; a bug in the second burns
 * a sending domain. Neither announces itself.
 */

describe("recipient bucketing", () => {
  test("the same recipient always lands in the same bucket", () => {
    // The whole point: a retried send must re-derive the same variant rather
    // than re-roll and count one person twice.
    const id = "8f14e45f-ceea-467a-9d9a-1b0e1b5f3c21";
    assert.equal(bucketFor(id), bucketFor(id));
  });

  test("buckets stay inside 0..99", () => {
    for (let i = 0; i < 500; i += 1) {
      const bucket = bucketFor(`run-${i}-${i * 7919}`);
      assert.ok(bucket >= 0 && bucket < 100, `bucket ${bucket} out of range`);
    }
  });

  test("different recipients spread across the range", () => {
    // Not a distribution proof — just enough to catch a hash that collapses
    // every id onto one bucket, which would send every recipient variant A.
    const seen = new Set<number>();
    for (let i = 0; i < 300; i += 1) seen.add(bucketFor(`recipient-${i}`));
    assert.ok(seen.size > 50, `only ${seen.size} distinct buckets`);
  });
});

describe("variant selection", () => {
  const a = { id: "a", allocation_percent: 50 };
  const b = { id: "b", allocation_percent: 50 };

  test("an even split sends roughly half each", () => {
    let toA = 0;
    for (let bucket = 0; bucket < 100; bucket += 1) {
      if (chooseVariant([a, b], bucket)?.id === "a") toA += 1;
    }
    assert.equal(toA, 50);
  });

  test("weights that do not total 100 still split the whole audience", () => {
    // Two arms at 30% each is a normal thing to type. Treating them as
    // literal percentages would leave 40% of recipients with no message.
    const arms = [
      { id: "a", allocation_percent: 30 },
      { id: "b", allocation_percent: 30 },
    ];
    for (let bucket = 0; bucket < 100; bucket += 1) {
      assert.ok(chooseVariant(arms, bucket), `bucket ${bucket} got no variant`);
    }
  });

  test("a zero-allocation arm never receives anyone", () => {
    const arms = [
      { id: "live", allocation_percent: 100 },
      { id: "paused", allocation_percent: 0 },
    ];
    for (let bucket = 0; bucket < 100; bucket += 1) {
      assert.equal(chooseVariant(arms, bucket)?.id, "live");
    }
  });

  test("no usable arms means no variant, not a crash", () => {
    assert.equal(chooseVariant([], 42), null);
    assert.equal(chooseVariant([{ id: "x", allocation_percent: 0 }], 42), null);
  });

  test("an out-of-range bucket is clamped rather than dropping through", () => {
    assert.ok(chooseVariant([a, b], -5));
    assert.ok(chooseVariant([a, b], 999));
  });

  test("three uneven arms honour their relative weights", () => {
    const arms = [
      { id: "a", allocation_percent: 60 },
      { id: "b", allocation_percent: 30 },
      { id: "c", allocation_percent: 10 },
    ];
    const counts = { a: 0, b: 0, c: 0 };
    for (let bucket = 0; bucket < 100; bucket += 1) {
      const id = chooseVariant(arms, bucket)?.id as keyof typeof counts;
      counts[id] += 1;
    }
    assert.equal(counts.a, 60);
    assert.equal(counts.b, 30);
    assert.equal(counts.c, 10);
  });
});

describe("sender warm-up", () => {
  const cap = 200;
  const start = new Date("2026-01-01T00:00:00Z");
  const on = (days: number) => new Date(start.getTime() + days * 864e5);

  test("a sender with no warm-up gets its full cap", () => {
    assert.equal(
      warmupAllowance({ dailySendCap: cap, warmupStartedAt: null, warmupDays: 21 }),
      cap,
    );
  });

  test("day one is a fraction, not the full cap", () => {
    const day1 = warmupAllowance({
      dailySendCap: cap,
      warmupStartedAt: start,
      warmupDays: 21,
      now: on(0),
    });
    assert.ok(day1 < cap, "a new domain must not start at its full cap");
    assert.ok(day1 >= 5, "and must still be usable");
  });

  test("the allowance never decreases as the sender ages", () => {
    let previous = 0;
    for (let day = 0; day <= 30; day += 1) {
      const allowance = warmupAllowance({
        dailySendCap: cap,
        warmupStartedAt: start,
        warmupDays: 21,
        now: on(day),
      });
      assert.ok(allowance >= previous, `day ${day} went backwards`);
      previous = allowance;
    }
  });

  test("it reaches the full cap by the end of the ramp and never exceeds it", () => {
    assert.equal(
      warmupAllowance({
        dailySendCap: cap,
        warmupStartedAt: start,
        warmupDays: 21,
        now: on(20),
      }),
      cap,
    );
    assert.equal(
      warmupAllowance({
        dailySendCap: cap,
        warmupStartedAt: start,
        warmupDays: 21,
        now: on(400),
      }),
      cap,
    );
  });

  test("a small cap still ramps without falling to zero", () => {
    // A cap of 20 over 21 days would round to 1 a day without the floor.
    const day1 = warmupAllowance({
      dailySendCap: 20,
      warmupStartedAt: start,
      warmupDays: 21,
      now: on(0),
    });
    assert.ok(day1 >= 5, `day one allowance was ${day1}`);
    assert.ok(day1 <= 20);
  });

  test("a zero-day ramp is the same as no ramp", () => {
    assert.equal(
      warmupAllowance({
        dailySendCap: cap,
        warmupStartedAt: start,
        warmupDays: 0,
        now: on(0),
      }),
      cap,
    );
  });
});
