import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BANK_HOLIDAY_YEARS_COVERED,
  DEFAULT_CALLING_HOURS,
  isUkBankHoliday,
  isWithinCallingHours,
  localParts,
  nextCallableAt,
  parseCallingHoursConfig,
  resolveRecipientTimezone,
  UK_BANK_HOLIDAYS,
  zonedTimeToUtc,
} from "../src/lib/voice/calling-hours.ts";

const LDN = "Europe/London";
const at = (iso: string) => new Date(iso);

test("timezone resolution order: lead, then phone country, then workspace; never silent", () => {
  assert.deepEqual(resolveRecipientTimezone({ leadTimezone: "Europe/Paris", phoneE164: "+447700900123", workspaceTimezone: LDN }), {
    timezone: "Europe/Paris",
    source: "LEAD",
  });
  assert.deepEqual(resolveRecipientTimezone({ leadTimezone: "Not/AZone", phoneE164: "+447700900123", workspaceTimezone: "Europe/Paris" }), {
    timezone: LDN,
    source: "PHONE_COUNTRY",
  });
  assert.deepEqual(resolveRecipientTimezone({ phoneE164: "+35312345678" }), { timezone: "Europe/Dublin", source: "PHONE_COUNTRY" });
  // +1 spans many zones: the number alone must not decide.
  assert.deepEqual(resolveRecipientTimezone({ phoneE164: "+14155550100", workspaceTimezone: LDN }), { timezone: LDN, source: "WORKSPACE" });
  assert.deepEqual(resolveRecipientTimezone({ phoneE164: "+14155550100", workspaceTimezone: null }), {
    timezone: null,
    source: "UNRESOLVED",
    reason: "NO_VALID_TIMEZONE",
  });
});

test("localParts and zonedTimeToUtc agree across both DST edges", () => {
  // BST: 09:00 London on Mon 28 Sep 2026 is 08:00Z.
  assert.equal(zonedTimeToUtc("2026-09-28", 9 * 60, LDN).toISOString(), "2026-09-28T08:00:00.000Z");
  // GMT after the clocks go back (25 Oct 2026).
  assert.equal(zonedTimeToUtc("2026-10-26", 9 * 60, LDN).toISOString(), "2026-10-26T09:00:00.000Z");
  // The spring-forward day itself (29 Mar 2026): 10:00 local is 09:00Z.
  assert.equal(zonedTimeToUtc("2026-03-29", 10 * 60, LDN).toISOString(), "2026-03-29T09:00:00.000Z");
  const p = localParts(at("2026-09-28T08:30:00Z"), LDN);
  assert.equal(p.hhmm, "09:30");
  assert.equal(p.weekday, 1);
});

test("default windows: weekdays 09:00 to 20:00, Saturday 10:00 to 16:00, no Sunday", () => {
  const rows: [string, boolean, string | null][] = [
    ["2026-09-28T07:59:00Z", false, "BEFORE_WINDOW"], // Mon 08:59 BST
    ["2026-09-28T08:00:00Z", true, null], // Mon 09:00
    ["2026-09-28T18:59:00Z", true, null], // Mon 19:59
    ["2026-09-28T19:00:00Z", false, "AFTER_WINDOW"], // Mon 20:00 (end exclusive)
    ["2026-10-03T08:59:00Z", false, "BEFORE_WINDOW"], // Sat 09:59
    ["2026-10-03T09:00:00Z", true, null], // Sat 10:00
    ["2026-10-03T15:00:00Z", false, "AFTER_WINDOW"], // Sat 16:00
    ["2026-09-27T12:00:00Z", false, "SUNDAY"], // Sun
  ];
  for (const [iso, allowed, reason] of rows) {
    const r = isWithinCallingHours({ at: at(iso), timezone: LDN });
    assert.equal(r.allowed, allowed, iso);
    if (!r.allowed) assert.equal(r.reason, reason, iso);
  }
});

test("the recipient's zone decides, not the server's or the workspace's", () => {
  // 08:30Z Monday is 09:30 in London (open) but 04:30 in New York (closed).
  assert.equal(isWithinCallingHours({ at: at("2026-09-28T08:30:00Z"), timezone: LDN }).allowed, true);
  assert.equal(isWithinCallingHours({ at: at("2026-09-28T08:30:00Z"), timezone: "America/New_York", applyUkBankHolidays: false }).allowed, false);
});

test("UK bank holidays block by default, per region, and all regions when unknown", () => {
  // Summer bank holiday: 31 Aug in England and Wales, 3 Aug in Scotland.
  const eng = at("2026-08-31T10:00:00Z");
  assert.deepEqual(isWithinCallingHours({ at: eng, timezone: LDN, region: "ENGLAND_AND_WALES" }).allowed, false);
  assert.equal(isWithinCallingHours({ at: eng, timezone: LDN, region: "SCOTLAND" }).allowed, true);
  const sco = at("2026-08-03T10:00:00Z");
  assert.equal(isWithinCallingHours({ at: sco, timezone: LDN, region: "ENGLAND_AND_WALES" }).allowed, true);
  const unknown = isWithinCallingHours({ at: sco, timezone: LDN });
  assert.ok(!unknown.allowed && unknown.reason === "BANK_HOLIDAY");
  // St Patrick's Day 2027 (Wednesday) in NI only.
  assert.equal(isUkBankHoliday("2027-03-17", "NORTHERN_IRELAND").holiday, true);
  assert.equal(isUkBankHoliday("2027-03-17", "ENGLAND_AND_WALES").holiday, false);
  // Substitute days.
  assert.equal(isUkBankHoliday("2026-12-28", "ENGLAND_AND_WALES").holiday, true);
  assert.equal(isUkBankHoliday("2027-12-27", "SCOTLAND").holiday, true);
  // Scotland's one-off 2026 World Cup bank holiday.
  assert.equal(isUkBankHoliday("2026-06-15", "SCOTLAND").holiday, true);
  // A workspace may opt in to calling on bank holidays.
  const cfg = { ...DEFAULT_CALLING_HOURS, callOnBankHolidays: true };
  assert.equal(isWithinCallingHours({ at: eng, timezone: LDN, region: "ENGLAND_AND_WALES", config: cfg }).allowed, true);
});

test("a year outside the bank-holiday table fails closed", () => {
  assert.deepEqual(isUkBankHoliday("2028-06-06"), { holiday: true, reason: "YEAR_NOT_COVERED" });
  assert.deepEqual(BANK_HOLIDAY_YEARS_COVERED, [2026, 2027]);
});

test("bank holiday list matches gov.uk counts for 2026 and 2027 (checked 2026-09-27)", () => {
  const count = (r: keyof typeof UK_BANK_HOLIDAYS, y: string) => UK_BANK_HOLIDAYS[r].filter((d) => d.startsWith(y)).length;
  assert.equal(count("ENGLAND_AND_WALES", "2026"), 8);
  assert.equal(count("ENGLAND_AND_WALES", "2027"), 8);
  assert.equal(count("SCOTLAND", "2026"), 10);
  assert.equal(count("SCOTLAND", "2027"), 9);
  assert.equal(count("NORTHERN_IRELAND", "2026"), 10);
  assert.equal(count("NORTHERN_IRELAND", "2027"), 10);
  for (const list of Object.values(UK_BANK_HOLIDAYS)) {
    for (const d of list) assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Set(list).size, list.length);
  }
  // Every listed holiday is a weekday (gov.uk substitutes weekend dates).
  for (const list of Object.values(UK_BANK_HOLIDAYS)) {
    for (const d of list) {
      const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
      assert.ok(wd >= 1 && wd <= 5, d);
    }
  }
  const src = readFileSync("src/lib/voice/calling-hours.ts", "utf8");
  assert.match(src, /gov\.uk\/bank-holidays\.json/);
});

test("configuration is bounded by 08:00 and 21:00 local", () => {
  const ok = parseCallingHoursConfig({
    ...DEFAULT_CALLING_HOURS,
    days: [{ start: "10:00", end: "14:00" }, ...DEFAULT_CALLING_HOURS.days.slice(1)],
  });
  assert.equal(ok.ok, true);
  const early = parseCallingHoursConfig({
    ...DEFAULT_CALLING_HOURS,
    days: [null, { start: "07:30", end: "20:00" }, ...DEFAULT_CALLING_HOURS.days.slice(2)],
  });
  assert.equal(early.ok, false);
  const late = parseCallingHoursConfig({
    ...DEFAULT_CALLING_HOURS,
    days: [null, { start: "09:00", end: "21:30" }, ...DEFAULT_CALLING_HOURS.days.slice(2)],
  });
  assert.equal(late.ok, false);
  const inverted = parseCallingHoursConfig({
    ...DEFAULT_CALLING_HOURS,
    days: [null, { start: "15:00", end: "10:00" }, ...DEFAULT_CALLING_HOURS.days.slice(2)],
  });
  assert.equal(inverted.ok, false);
  assert.equal(parseCallingHoursConfig({ days: [], callOnBankHolidays: false }).ok, false);
});

test("a configured Sunday window is honoured", () => {
  const cfg = { ...DEFAULT_CALLING_HOURS, days: [{ start: "11:00", end: "15:00" }, ...DEFAULT_CALLING_HOURS.days.slice(1)] as typeof DEFAULT_CALLING_HOURS.days };
  assert.equal(isWithinCallingHours({ at: at("2026-09-27T11:00:00Z"), timezone: LDN, config: cfg }).allowed, true);
});

test("nextCallableAt skips nights, Sundays and bank holidays", () => {
  // Saturday 17:00 BST -> Monday 09:00 BST.
  assert.equal(nextCallableAt({ at: at("2026-10-03T16:00:00Z"), timezone: LDN })?.toISOString(), "2026-10-05T08:00:00.000Z");
  // Christmas Eve 2026 (Thu) 21:00 GMT -> 25 Fri holiday, 26 Sat 10:00.
  assert.equal(nextCallableAt({ at: at("2026-12-24T21:00:00Z"), timezone: LDN })?.toISOString(), "2026-12-26T10:00:00.000Z");
  // Inside a window returns now.
  const now = at("2026-09-28T10:15:30Z");
  assert.equal(nextCallableAt({ at: now, timezone: LDN })?.toISOString(), now.toISOString());
  // The last 5 minutes of a window do not start a call.
  assert.equal(nextCallableAt({ at: at("2026-09-28T18:57:00Z"), timezone: LDN })?.toISOString(), "2026-09-29T08:00:00.000Z");
  // Across the clocks going back: Sat 24 Oct 16:30 BST -> Mon 26 Oct 09:00 GMT.
  assert.equal(nextCallableAt({ at: at("2026-10-24T15:30:00Z"), timezone: LDN })?.toISOString(), "2026-10-26T09:00:00.000Z");
  // No window at all.
  const none = { days: [null, null, null, null, null, null, null] as typeof DEFAULT_CALLING_HOURS.days, callOnBankHolidays: false };
  assert.equal(nextCallableAt({ at: now, timezone: LDN, config: none }), null);
});
