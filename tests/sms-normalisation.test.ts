import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countSmsSegments, normaliseForSms, smsEncoding } from "../src/lib/messaging/sms-segments.ts";
import { NEW_LEAD_SEQUENCE } from "../src/lib/automation/defaults.ts";

// A realistic fill for the template variables.
const fill = (template: string) =>
  template
    .replace(/\{\{first_name\}\}/g, "Sam")
    .replace(/\{\{business_name\}\}/g, "Northwind Digital")
    .replace(/\{\{service_name\}\}/g, "website rebuild")
    .replace(/\{\{[a-z_]+\}\}/g, "x");

test("every default sequence SMS goes out as GSM-7 once normalised", () => {
  for (const step of NEW_LEAD_SEQUENCE) {
    const body = normaliseForSms(fill(step.template));
    assert.equal(smsEncoding(body), "GSM7", `step ${step.position}: ${body}`);
  }
});

test("normalising the default sequence saves segments (em dashes forced UCS-2)", () => {
  const raw = NEW_LEAD_SEQUENCE.reduce((n, s) => n + countSmsSegments(fill(s.template)).segments, 0);
  const sent = NEW_LEAD_SEQUENCE.reduce((n, s) => n + countSmsSegments(normaliseForSms(fill(s.template))).segments, 0);
  assert.ok(sent <= raw, `normalised ${sent} vs raw ${raw}`);
  assert.equal(sent, NEW_LEAD_SEQUENCE.length, "each default step fits one GSM-7 segment");
});

test("the send path normalises every SMS just before the carrier, and records what was sent", () => {
  const core = readFileSync("src/lib/jobs/send-core.ts", "utf8");
  assert.match(core, /gated\.channel === "sms" \? \{ \.\.\.gated, body: normaliseForSms\(gated\.body\) \}/);
  const store = readFileSync("src/lib/jobs/handlers/send-store.ts", "utf8");
  assert.match(store, /message\.channel === "sms" \? \{ body: message\.body \}/);
});

/* ------------------------------------------------ one segment per template */

// A long-but-realistic fill: the templates must stay one segment for real
// businesses, not only for a short sample name.
const fillLong = (template: string) =>
  template
    .replace(/\{\{first_name\}\}/g, "Alexandra")
    .replace(/\{\{business_name\}\}/g, "Northwind Digital")
    .replace(/\{\{service_name\}\}/g, "website redesign")
    .replace(/\{\{business_phone\}\}/g, "+447700900123")
    .replace(/\{\{[a-z_]+\}\}/g, "x");

test("every default template is exactly one GSM-7 segment after normalisation", () => {
  for (const step of NEW_LEAD_SEQUENCE) {
    for (const body of [fill(step.template), fillLong(step.template)]) {
      const sent = normaliseForSms(body);
      const count = countSmsSegments(sent);
      assert.equal(count.encoding, "GSM7", `step ${step.position}: ${sent}`);
      assert.equal(count.segments, 1, `step ${step.position} is ${count.segments} segments: ${sent}`);
    }
  }
});

test("the first step stays one segment with the opt-out line appended", async () => {
  const { withOptOutWording } = await import("../src/lib/messaging/sms-compliance.ts");
  const first = NEW_LEAD_SEQUENCE[0];
  const body = withOptOutWording(fill(first.template), { channel: "sms", wording: "Reply STOP to opt out." });
  assert.equal(countSmsSegments(normaliseForSms(body)).segments, 1, body);
});

test("no default template carries a character that forces UCS-2 before normalisation", () => {
  for (const step of NEW_LEAD_SEQUENCE) {
    assert.equal(smsEncoding(fill(step.template)), "GSM7", `step ${step.position}`);
  }
});

test("the agent's SMS length lint judges the normalised body", () => {
  const policy = readFileSync("src/lib/agent/policy.ts", "utf8");
  assert.match(policy, /countSmsSegments\(normaliseForSms\(body\)\)/);
});
