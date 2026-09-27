import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessDestination,
  checkRateCap,
  classifyDestination,
  DEFAULT_MAX_RATE_USD_PER_MIN,
  isSmsCapableDestination,
  lookupRate,
  normaliseE164,
} from "../src/lib/voice/destinations.ts";

test("normaliseE164 accepts the shapes UK lead forms produce", () => {
  const cases: [string, string][] = [
    ["07700 900123", "+447700900123"],
    ["+44 (0)7700 900123", "+447700900123"],
    ["0044 7700 900123", "+447700900123"],
    ["447700900123", "+447700900123"],
    ["+447700900123", "+447700900123"],
    ["020 7946 0018", "+442079460018"],
    ["(020) 7946-0018", "+442079460018"],
    ["+4407700900123", "+447700900123"],
    ["+353 1 234 5678", "+35312345678"],
  ];
  for (const [raw, want] of cases) {
    const r = normaliseE164(raw);
    assert.equal(r.ok, true, raw);
    if (r.ok) assert.equal(r.e164, want, raw);
  }
});

test("normaliseE164 refuses garbage with a reason", () => {
  assert.deepEqual(normaliseE164(""), { ok: false, reason: "EMPTY" });
  assert.deepEqual(normaliseE164(null), { ok: false, reason: "EMPTY" });
  assert.deepEqual(normaliseE164("07700 ABC"), { ok: false, reason: "INVALID_CHARACTERS" });
  assert.deepEqual(normaliseE164("7700900123"), { ok: false, reason: "UNSUPPORTED_FORMAT" });
  assert.deepEqual(normaliseE164("+44 12"), { ok: false, reason: "INVALID_LENGTH" });
  assert.deepEqual(normaliseE164("+44 7700 900123 999"), { ok: false, reason: "INVALID_LENGTH" });
});

test("classifyDestination covers every UK range class", () => {
  const cases: [string, string][] = [
    ["+441632960000", "UK_GEOGRAPHIC"],
    ["+442079460018", "UK_GEOGRAPHIC"],
    ["+443001234567", "NON_GEO_03"],
    ["+447700900123", "UK_MOBILE"],
    ["+447012345678", "BLOCKED_PERSONAL_070"],
    ["+447612345678", "BLOCKED_PAGER_076"],
    ["+447624123456", "BLOCKED_PAGER_076"], // Isle of Man by prefix
    ["+448001234567", "TOLL_FREE_080"],
    ["+448081234567", "TOLL_FREE_080"],
    ["+448451234567", "BLOCKED_SPECIAL_084_087_09_118"],
    ["+448701234567", "BLOCKED_SPECIAL_084_087_09_118"],
    ["+44118118", "BLOCKED_SPECIAL_084_087_09_118"],
    ["+44116123", "BLOCKED_SPECIAL_084_087_09_118"],
    ["+441189496000", "UK_GEOGRAPHIC"], // 0118 Reading, not directory enquiries
    ["+449012345678", "BLOCKED_PREMIUM"],
    ["+445512345678", "BLOCKED_PREMIUM"],
    ["+445612345678", "BLOCKED_PREMIUM"],
    ["+44500123456", "BLOCKED_PREMIUM"],
    ["+444012345678", "BLOCKED_PREMIUM"], // unallocated fails closed
    ["+14155550100", "NON_UK"],
    ["+353123456789", "NON_UK"],
  ];
  for (const [e164, cls] of cases) assert.equal(classifyDestination(e164), cls, e164);
});

test("rate lookup uses the research table, SIP by default", () => {
  assert.equal(lookupRate("UK_MOBILE"), 0.0265);
  assert.equal(lookupRate("UK_MOBILE", "PROGRAMMABLE_VOICE"), 0.0305);
  assert.equal(lookupRate("UK_GEOGRAPHIC"), 0.0118);
  assert.equal(lookupRate("BLOCKED_PREMIUM", "PROGRAMMABLE_VOICE"), 1.0479);
  assert.equal(lookupRate("TOLL_FREE_080", "ELASTIC_SIP"), null);
  assert.equal(lookupRate("NON_UK"), null);
  assert.equal(lookupRate("BLOCKED_PAGER_076"), null);
});

test("rate cap: default $0.04 sits above UK mobile and below every surcharged route", () => {
  assert.equal(DEFAULT_MAX_RATE_USD_PER_MIN, 0.04);
  assert.deepEqual(checkRateCap({ cls: "UK_MOBILE", route: "PROGRAMMABLE_VOICE" }), { allowed: true, rateUsdPerMin: 0.0305 });
  assert.deepEqual(checkRateCap({ cls: "BLOCKED_PERSONAL_070" }), { allowed: false, reason: "RATE_ABOVE_CAP", rateUsdPerMin: 0.5537 });
  assert.deepEqual(checkRateCap({ cls: "NON_UK" }), { allowed: false, reason: "UNPRICED", rateUsdPerMin: null });
  // A +447 number Twilio prices as "Mobile Other": only the live rate sees it.
  assert.deepEqual(checkRateCap({ cls: "UK_MOBILE", providerRate: 0.32 }), { allowed: false, reason: "RATE_ABOVE_CAP", rateUsdPerMin: 0.32 });
  assert.equal(checkRateCap({ cls: "UK_MOBILE", capUsdPerMin: 0.02 }).allowed, false);
});

test("assessDestination: premium and special ranges are never dialable", () => {
  const blocked: [string, string][] = [
    ["07012 345678", "BLOCKED_RANGE"],
    ["07612 345678", "BLOCKED_RANGE"],
    ["0845 123 4567", "BLOCKED_RANGE"],
    ["0870 123 4567", "BLOCKED_RANGE"],
    ["0901 234 5678", "BLOCKED_RANGE"],
    ["118 118", "INVALID_NUMBER"],
    ["+44118118", "BLOCKED_RANGE"],
    ["0551 234 5678", "BLOCKED_RANGE"],
    ["0800 123 4567", "TOLL_FREE_NOT_PERMITTED"],
    ["+1 415 555 0100", "NON_UK"],
    ["not a number", "INVALID_NUMBER"],
  ];
  for (const [raw, reason] of blocked) {
    const a = assessDestination(raw);
    assert.equal(a.dialable, false, raw);
    if (!a.dialable) assert.equal(a.reason, reason, raw);
  }
  // Even a very high cap does not unlock a blocked range.
  const p = assessDestination("0901 234 5678", { capUsdPerMin: 5 });
  assert.equal(p.dialable, false);
});

test("assessDestination: mobiles, landlines and 03 are dialable", () => {
  for (const raw of ["07700 900123", "020 7946 0018", "0300 123 4567"]) {
    const a = assessDestination(raw);
    assert.equal(a.dialable, true, raw);
  }
  const m = assessDestination("07700 900123");
  assert.ok(m.dialable && m.cls === "UK_MOBILE" && m.rateUsdPerMin === 0.0265);
});

test("toll-free is blocked unless priced AND under the cap", () => {
  const off = assessDestination("0800 123 4567", { allowPricedTollFree: true });
  assert.ok(!off.dialable && off.reason === "UNPRICED"); // no SIP price row
  const over = assessDestination("0800 123 4567", { allowPricedTollFree: true, route: "PROGRAMMABLE_VOICE" });
  assert.ok(!over.dialable && over.reason === "RATE_ABOVE_CAP");
  const on = assessDestination("0800 123 4567", { allowPricedTollFree: true, route: "PROGRAMMABLE_VOICE", capUsdPerMin: 0.1 });
  assert.equal(on.dialable, true);
});

test("a live provider rate above the cap blocks an otherwise fine mobile", () => {
  const a = assessDestination("07700 900123", { providerRate: 0.32 });
  assert.ok(!a.dialable && a.reason === "RATE_ABOVE_CAP" && a.rateUsdPerMin === 0.32);
});

test("SMS only reaches UK mobiles", () => {
  assert.equal(isSmsCapableDestination("+447700900123"), true);
  assert.equal(isSmsCapableDestination("+442079460018"), false);
  assert.equal(isSmsCapableDestination("+443001234567"), false);
  assert.equal(isSmsCapableDestination("+447012345678"), false);
});
