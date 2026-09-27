import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLockedPreamble,
  houseStyleViolations,
  OPENER_TEMPLATE,
  OPENER_VERSION,
  RECORDING_NOTICE,
  renderEnquiryDay,
  renderOpener,
  validateEditableSuffix,
  validateFirstUtterance,
} from "../src/lib/voice/opener.ts";
import { BUILT_BY_ANSWER, classifyIdentificationContact, identityAnswer, identityReadiness } from "../src/lib/voice/identity.ts";
import { ESCALATION_LINES } from "../src/lib/voice/anti-loop.ts";
import { renderVoicemailScript } from "../src/lib/voice/retry-policy.ts";

const LDN = "Europe/London";
const now = new Date("2026-10-01T10:00:00Z"); // Thursday 11:00 BST

test("the opener is the OD-1 wording, versioned", () => {
  assert.equal(
    OPENER_TEMPLATE,
    "This is an AI assistant calling from {calling_as_name} about the enquiry you sent us {day}. Is now an OK time for a couple of minutes?",
  );
  assert.match(OPENER_VERSION, /^od1\./);
  assert.equal(
    renderOpener({ callingAsName: "Northwind Digital", enquiryAt: new Date("2026-09-29T09:00:00Z"), now, timezone: LDN }),
    "This is an AI assistant calling from Northwind Digital about the enquiry you sent us on Tuesday. Is now an OK time for a couple of minutes?",
  );
  assert.throws(() => renderOpener({ callingAsName: "  ", enquiryAt: now, now, timezone: LDN }));
});

test("{day} is relative and human in the recipient's time zone", () => {
  const rows: [string, string][] = [
    ["2026-10-01T07:00:00Z", "earlier today"],
    ["2026-10-01T12:00:00Z", "earlier today"], // clock skew: a future enquiry
    ["2026-09-30T21:00:00Z", "yesterday"], // 22:00 BST on Wednesday
    ["2026-09-30T23:30:00Z", "earlier today"], // 00:30 BST Thursday: today in London
    ["2026-09-28T10:00:00Z", "on Monday"],
    ["2026-09-25T10:00:00Z", "on Friday"], // 6 days ago
    ["2026-09-24T10:00:00Z", "on 24 September"], // 7 days ago
    ["2026-08-03T10:00:00Z", "on 3 August"],
  ];
  for (const [iso, want] of rows) assert.equal(renderEnquiryDay(new Date(iso), now, LDN), want, iso);
  // The same instant is "earlier today" in London but "yesterday" in New York.
  assert.equal(renderEnquiryDay(new Date("2026-10-01T02:00:00Z"), new Date("2026-10-01T10:00:00Z"), "America/New_York"), "yesterday");
});

test("recording notice follows the opener only when recording is on", () => {
  const base = { callingAsName: "Acme Studio", enquiryAt: now, now, timezone: LDN };
  const off = buildLockedPreamble({ ...base, recordingEnabled: false });
  assert.equal(off.recordingNotice, null);
  assert.equal(off.text, off.opener);
  const on = buildLockedPreamble({ ...base, recordingEnabled: true });
  assert.equal(on.text, `${on.opener} ${RECORDING_NOTICE}`);
  assert.equal(on.version, OPENER_VERSION);
});

test("validateFirstUtterance accepts only the locked preamble", () => {
  const base = { callingAsName: "Acme Studio", enquiryAt: now, now, timezone: LDN };
  const on = buildLockedPreamble({ ...base, recordingEnabled: true });
  const off = buildLockedPreamble({ ...base, recordingEnabled: false });
  assert.deepEqual(validateFirstUtterance(on.text, on), { ok: true });
  assert.deepEqual(validateFirstUtterance(`  ${on.text.replace(/ /g, "  ")} `, on), { ok: true });
  assert.deepEqual(validateFirstUtterance(on.text.replace("Is now", "Is now"), on), { ok: true });
  assert.deepEqual(validateFirstUtterance("", on), { ok: false, reason: "EMPTY" });
  assert.deepEqual(validateFirstUtterance(null, on), { ok: false, reason: "EMPTY" });
  assert.deepEqual(validateFirstUtterance(`Hi! ${on.text}`, on), { ok: false, reason: "MISSING_OPENER" });
  assert.deepEqual(validateFirstUtterance(on.opener, on), { ok: false, reason: "MISSING_RECORDING_NOTICE" });
  assert.deepEqual(validateFirstUtterance(on.text, off), { ok: false, reason: "UNEXPECTED_RECORDING_NOTICE" });
  assert.deepEqual(validateFirstUtterance(`${off.opener} Great to speak to you.`, off), { ok: false, reason: "TEXT_DIFFERS" });
  assert.deepEqual(
    validateFirstUtterance(off.opener.replace("an AI assistant", "a member of the team"), off),
    { ok: false, reason: "MISSING_OPENER" },
  );
});

test("every fixed spoken line keeps house style: no emoji, no dashes", () => {
  const lines = [
    OPENER_TEMPLATE,
    RECORDING_NOTICE,
    BUILT_BY_ANSWER,
    ...Object.values(ESCALATION_LINES),
    renderVoicemailScript({ callingAsName: "Acme", enquiryAt: now, now, timezone: LDN, followUp: "SMS" }),
    renderVoicemailScript({ callingAsName: "Acme", enquiryAt: now, now, timezone: LDN, followUp: null }),
    identityAnswer({ callingAsName: "Acme", legalEntityName: "Acme Studio Ltd", identificationContact: "0800 123 4567" }),
  ];
  for (const l of lines) assert.deepEqual(houseStyleViolations(l), [], l);
  assert.deepEqual(houseStyleViolations("Hello — there"), ["DASH"]);
  assert.deepEqual(houseStyleViolations("Hello - there"), ["DASH"]);
  assert.deepEqual(houseStyleViolations("a follow-up call"), []);
  assert.deepEqual(houseStyleViolations("Great \u{1F44D}"), ["EMOJI"]);
});

test("ClientTurn is not named in the opener or the notice", () => {
  assert.doesNotMatch(OPENER_TEMPLATE, /clientturn/i);
  assert.doesNotMatch(RECORDING_NOTICE, /clientturn/i);
  assert.match(BUILT_BY_ANSWER, /ClientTurn/);
});

test("editable suffix: no restating locked text, no human claims, house style", () => {
  assert.deepEqual(validateEditableSuffix("I wanted to follow up on your website rebuild."), []);
  assert.deepEqual(validateEditableSuffix(""), ["EMPTY"]);
  assert.ok(validateEditableSuffix("I'm a real person from the sales team.").includes("CLAIMS_HUMAN"));
  assert.ok(validateEditableSuffix("I am not a bot.").includes("CLAIMS_HUMAN"));
  assert.ok(validateEditableSuffix("This call is recorded.").includes("RESTATES_LOCKED_TEXT"));
  assert.ok(validateEditableSuffix("Quick one – are you free?").includes("DASH"));
  assert.ok(validateEditableSuffix("x".repeat(241)).includes("TOO_LONG"));
});

test("identity readiness: required fields, freephone or address", () => {
  const ok = identityReadiness({ callingAsName: "Acme", legalEntityName: "Acme Studio Ltd", identificationContact: "1 High Street, Leeds, LS1 1AA" });
  assert.equal(ok.ready, true);
  const missing = identityReadiness({ callingAsName: "", legalEntityName: null, identificationContact: undefined });
  assert.ok(!missing.ready);
  if (!missing.ready) {
    assert.deepEqual(
      missing.problems.map((p) => `${p.field}:${p.problem}`),
      ["callingAsName:MISSING", "legalEntityName:MISSING", "identificationContact:MISSING"],
    );
  }
  const paid = identityReadiness({ callingAsName: "Acme", legalEntityName: "Acme Ltd", identificationContact: "020 7946 0018" });
  assert.ok(!paid.ready && paid.problems[0].problem === "PHONE_NOT_FREEPHONE");
  const free = identityReadiness({ callingAsName: "Acme", legalEntityName: "Acme Ltd", identificationContact: "0808 157 0000" });
  assert.equal(free.ready, true);
  const shortAddr = identityReadiness({ callingAsName: "Acme", legalEntityName: "Acme Ltd", identificationContact: "Leeds" });
  assert.ok(!shortAddr.ready && shortAddr.problems[0].problem === "ADDRESS_TOO_SHORT");
  const nl = identityReadiness({ callingAsName: "Acme\nLtd", legalEntityName: "Acme Ltd", identificationContact: "0800 123 4567" });
  assert.ok(!nl.ready && nl.problems.some((p) => p.problem === "CONTAINS_LINE_BREAK"));
  assert.equal(classifyIdentificationContact("0800 123 4567").kind, "FREEPHONE");
});

test("identity answer is deterministic and names the legal entity", () => {
  assert.equal(
    identityAnswer({ callingAsName: "Acme", legalEntityName: "Acme Studio Ltd", identificationContact: "1 High Street, Leeds, LS1 1AA" }),
    "I am calling on behalf of Acme Studio Ltd. You can reach them at 1 High Street, Leeds, LS1 1AA.",
  );
});
