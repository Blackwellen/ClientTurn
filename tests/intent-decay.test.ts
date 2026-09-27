/**
 * Intent decay and recalculation boundaries (design 08 §B.5).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  INTENT_THRESHOLDS,
  SIGNAL_TYPES,
  SIGNAL_TYPE_CATEGORY,
  intentSignalWriteSchema,
  signalPolarity,
  type IntentSignal,
  type SignalType,
} from "../src/lib/qualification-intelligence/types.ts";
import {
  DECAY_RULES,
  decayFactor,
  decayParamsFor,
  decayedStrength,
  isLive,
  nextDecayBoundary,
  recencyFactor,
} from "../src/lib/qualification-intelligence/decay.ts";
import { assessIntent } from "../src/lib/qualification-intelligence/intent.ts";
import { buildSignalWrite, signalFromRow } from "../src/lib/qualification-intelligence/signals.ts";

const NOW = new Date("2026-09-26T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const LEAD = "22222222-2222-4222-8222-222222222222";

let seq = 0;
function stored(type: SignalType, opts: { observedAt?: string; statedDate?: string; resumeAt?: string; freshnessDays?: number; sourceExpiresAt?: string; strength?: number } = {}): IntentSignal {
  seq += 1;
  const w = buildSignalWrite({
    leadId: LEAD,
    type,
    strength: opts.strength ?? 1,
    confidence: 1,
    source: "REPLY",
    sourceRef: `m-${seq}`,
    observedAt: opts.observedAt ?? NOW.toISOString(),
    reason: type,
    statedDate: opts.statedDate ?? null,
    resumeAt: opts.resumeAt ?? null,
    freshnessDays: opts.freshnessDays ?? null,
    sourceExpiresAt: opts.sourceExpiresAt ?? null,
  });
  return signalFromRow({ ...w, id: `00000000-0000-4000-9000-${String(seq).padStart(12, "0")}`, retracted_at: null });
}

describe("the half-life table", () => {
  test("every signal type has a rule; only UNSUBSCRIBE, COMPLAINT and NOT_NOW never decay", () => {
    for (const type of SIGNAL_TYPES) assert.ok(DECAY_RULES[type], type);
    const never = SIGNAL_TYPES.filter((t) => DECAY_RULES[t].halfLifeHours === null).sort();
    assert.deepEqual(never, ["COMPLAINT", "NOT_NOW", "UNSUBSCRIBE"]);
  });

  test("the design's rows (§B.5)", () => {
    assert.equal(DECAY_RULES.BOOKING_REQUEST.halfLifeHours, 5 * 24);
    assert.equal(DECAY_RULES.BOOKING_REQUEST.hardStopHours, 30 * 24);
    assert.equal(DECAY_RULES.PRICING_REQUEST.halfLifeHours, 10 * 24);
    assert.equal(DECAY_RULES.INBOUND_ENQUIRY.halfLifeHours, 14 * 24);
    assert.equal(DECAY_RULES.URGENCY.halfLifeHours, 7 * 24);
    assert.equal(DECAY_RULES.DISSATISFACTION_CURRENT.halfLifeHours, 30 * 24);
    assert.equal(DECAY_RULES.FAST_REPLY.halfLifeHours, 3 * 24);
    assert.equal(DECAY_RULES.NOT_INTERESTED.halfLifeHours, 90 * 24);
    assert.equal(DECAY_RULES.NOT_INTERESTED.hardStopHours, 365 * 24);
  });

  test("every type's write-side params satisfy the table CHECKs", () => {
    for (const type of SIGNAL_TYPES) {
      const w = buildSignalWrite({ leadId: LEAD, type, strength: 1, confidence: 1, source: "REPLY", sourceRef: "m", observedAt: NOW.toISOString(), reason: type });
      assert.equal(w.category, SIGNAL_TYPE_CATEGORY[type]);
      assert.equal(w.polarity, signalPolarity(type));
      const parsed = intentSignalWriteSchema.safeParse(w);
      assert.ok(parsed.success, `${type}: ${parsed.success ? "" : parsed.error.issues[0]?.message}`);
      if (w.expires_at) assert.ok(Date.parse(w.expires_at) > Date.parse(w.observed_at), type);
      assert.equal(w.resume_at !== null, type === "NOT_NOW", type);
    }
  });
});

describe("strength over time", () => {
  test("halves every half-life", () => {
    const s = stored("PRICING_REQUEST");
    assert.equal(decayFactor(s, NOW), 1);
    assert.ok(Math.abs(decayFactor(s, at(10 * DAY)) - 0.5) < 1e-9);
    assert.ok(Math.abs(decayFactor(s, at(20 * DAY)) - 0.25) < 1e-9);
  });

  test("ignored after four half-lives, or at the hard stop, whichever is first", () => {
    const booking = stored("BOOKING_REQUEST"); // 5 d half-life, 30 d stop -> 20 d wins
    assert.ok(isLive(booking, at(19 * DAY)));
    assert.equal(isLive(booking, at(20 * DAY)), false);
    const pricing = stored("PRICING_REQUEST"); // 10 d, 45 d stop -> 40 d wins
    assert.ok(isLive(pricing, at(39 * DAY)));
    assert.equal(isLive(pricing, at(40 * DAY)), false);
    const problem = stored("STATED_PROBLEM"); // 14 d, 60 d stop -> hard stop at 60 d... 56 d cut-off first
    assert.equal(isLive(problem, at(56 * DAY)), false);
  });

  test("a retracted signal counts for nothing", () => {
    const s = { ...stored("PRICING_REQUEST"), retractedAt: NOW.toISOString() };
    assert.equal(decayFactor(s, at(HOUR)), 0);
  });

  test("UNSUBSCRIBE never decays", () => {
    const s = stored("UNSUBSCRIBE");
    assert.equal(decayFactor(s, at(3650 * DAY)), 1);
  });

  test("TIMEFRAME is flat until the stated date + 7 d, then decays, and stops at date + 30 d", () => {
    const stated = new Date(NOW.getTime() + 60 * DAY).toISOString().slice(0, 10);
    const s = stored("TIMEFRAME", { statedDate: stated });
    const date = Date.parse(stated);
    assert.equal(s.flatUntil, new Date(date + 7 * DAY).toISOString());
    assert.equal(s.expiresAt, new Date(date + 30 * DAY).toISOString());
    assert.equal(decayFactor(s, new Date(date + 6 * DAY)), 1);
    assert.ok(Math.abs(decayFactor(s, new Date(date + 14 * DAY)) - 0.5) < 1e-9);
    assert.equal(decayFactor(s, new Date(date + 30 * DAY)), 0);
  });

  test("NOT_NOW is flat until resume_at (default +60 d) and ends there", () => {
    const explicit = stored("NOT_NOW", { resumeAt: new Date(NOW.getTime() + 20 * DAY).toISOString() });
    assert.equal(decayFactor(explicit, at(19 * DAY)), 1);
    assert.equal(decayFactor(explicit, at(20 * DAY)), 0);
    const defaulted = stored("NOT_NOW");
    assert.equal(Date.parse(defaulted.resumeAt!) - NOW.getTime(), INTENT_THRESHOLDS.NOT_NOW_DEFAULT_DAYS * DAY);
  });

  test("CONTEXT: half-life is freshness / 2 and it stops at the event's own expiry", () => {
    const s = stored("HIRING", { freshnessDays: 20, sourceExpiresAt: new Date(NOW.getTime() + 15 * DAY).toISOString() });
    assert.equal(s.halfLifeHours, 10 * 24);
    assert.equal(isLive(s, at(14 * DAY)), true);
    assert.equal(isLive(s, at(15 * DAY)), false);
  });

  test("decayed strength scales the stored strength", () => {
    const s = stored("PRICING_REQUEST", { strength: 0.8 });
    assert.ok(Math.abs(decayedStrength(s, at(10 * DAY)) - 0.4) < 1e-9);
  });

  test("recency halves weekly and ends after four weeks", () => {
    assert.equal(recencyFactor(NOW.toISOString(), NOW), 1);
    assert.ok(Math.abs(recencyFactor(NOW.toISOString(), at(7 * DAY)) - 0.5) < 1e-9);
    assert.equal(recencyFactor(NOW.toISOString(), at(28 * DAY)), 0);
  });
});

describe("recalculation boundaries (the sweep's valid_until)", () => {
  test("the next boundary is the next half-life, a flat end or a hard stop, never in the past", () => {
    const s = stored("PRICING_REQUEST");
    const next = nextDecayBoundary([s], at(HOUR));
    assert.ok(next);
    assert.ok(Date.parse(next) > at(HOUR).getTime());
    assert.ok(Date.parse(next) <= at(10 * DAY).getTime());
  });

  test("never sooner than an hour, so a lead cannot be swept in a loop", () => {
    const s = stored("FAST_REPLY", { observedAt: new Date(NOW.getTime() - 3 * DAY + 60_000).toISOString() });
    const next = nextDecayBoundary([s], NOW)!;
    assert.ok(Date.parse(next) - NOW.getTime() >= HOUR);
  });

  test("nothing decaying: no boundary", () => {
    assert.equal(nextDecayBoundary([stored("UNSUBSCRIBE")], NOW), null);
    assert.equal(nextDecayBoundary([], NOW), null);
  });

  test("a NOT_NOW's resume date is a boundary: the lead is re-assessed when it passes", () => {
    const resume = new Date(NOW.getTime() + 20 * DAY).toISOString();
    const s = stored("NOT_NOW", { resumeAt: resume });
    assert.equal(nextDecayBoundary([s], NOW), resume);
  });

  test("silence: a booking request fades from BOOKING_READY as days pass with no reply", () => {
    const s = stored("BOOKING_REQUEST", { strength: 0.9 });
    assert.equal(assessIntent([s], NOW).state, "BOOKING_READY");
    // 0.9 x 0.5^(3/5) = 0.59 < 0.6
    assert.notEqual(assessIntent([s], at(3 * DAY)).state, "BOOKING_READY");
    assert.equal(assessIntent([s], at(25 * DAY)).state, "NO_DETECTED_INTENT");
  });

  test("the assessment's valid_until is the next decay boundary", () => {
    const s = stored("PRICING_REQUEST");
    const a = assessIntent([s], at(HOUR));
    assert.ok(a.validUntil);
    assert.ok(Date.parse(a.validUntil) > at(HOUR).getTime());
  });

  test("decayParamsFor never produces expires <= observed, even for a resume in the past", () => {
    const p = decayParamsFor({ type: "NOT_NOW", observedAt: NOW.toISOString(), resumeAt: new Date(NOW.getTime() - DAY).toISOString() });
    assert.ok(Date.parse(p.expires_at!) > NOW.getTime());
    assert.equal(p.resume_at, p.expires_at);
  });
});
