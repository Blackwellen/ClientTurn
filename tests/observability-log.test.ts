import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildLogRecord,
  isForbiddenKey,
  logEvent,
  redact,
  REDACTED,
  scrubString,
  setLogSink,
} from "../src/lib/observability/log.ts";

const TRANSCRIPT = "Caller: hi, my number is 07700 900123 and email jo@example.co.uk. Agent: thanks Jo.";

describe("the redaction rule", () => {
  test("transcript text, phone numbers and emails never survive under their own keys", () => {
    const out = redact({
      callId: "3f0c6a8e-2d4b-4c1e-9a7f-1b2c3d4e5f60",
      transcript: TRANSCRIPT,
      segments: [{ text: TRANSCRIPT }],
      summary: "They want a quote",
      to: "+447700900123",
      from: "+441234567890",
      phone: "07700 900123",
      e164: "+447700900123",
      email: "jo@example.co.uk",
      signer_email: "jo@example.co.uk",
      body: "Hi Jo",
    }) as Record<string, unknown>;
    for (const key of ["transcript", "segments", "summary", "to", "from", "phone", "e164", "email", "signer_email", "body"]) {
      assert.equal(out[key], REDACTED, key);
    }
    assert.equal(out.callId, "3f0c6a8e-2d4b-4c1e-9a7f-1b2c3d4e5f60");
  });

  test("phone numbers and emails are masked even under an innocent key, at any depth", () => {
    const out = JSON.stringify(redact({ detail: { note2: `ring ${"+44 7700 900123"} or mail jo@example.co.uk` }, list: ["call 020 7946 0958"] }));
    assert.doesNotMatch(out, /7700/);
    assert.doesNotMatch(out, /example\.co\.uk/);
    assert.doesNotMatch(out, /7946/);
    assert.match(out, /\[phone\]/);
    assert.match(out, /\[email\]/);
  });

  test("identifiers, codes, states, durations and money pass through", () => {
    const out = redact({
      leadId: "0b8e6c1a-1111-4222-8333-944455556666",
      state: "IN_CONVERSATION",
      outcome: "COMPLETED",
      durationSec: 187,
      amountMinor: 125000,
      currency: "GBP",
      at: "2026-09-27T10:00:00.000Z",
      provider: "retell",
    });
    assert.deepEqual(out, {
      leadId: "0b8e6c1a-1111-4222-8333-944455556666",
      state: "IN_CONVERSATION",
      outcome: "COMPLETED",
      durationSec: 187,
      amountMinor: 125000,
      currency: "GBP",
      at: "2026-09-27T10:00:00.000Z",
      provider: "retell",
    });
  });

  test("long free text is capped so conversation cannot ride along", () => {
    const long = "word ".repeat(200);
    assert.ok(scrubString(long).length <= 201);
  });

  test("error objects are reduced to a scrubbed message", () => {
    const out = redact({ error: new Error("Twilio rejected +447700900123") }) as { error: { message: string } };
    assert.doesNotMatch(out.error.message, /7700/);
  });

  test("forbidden key matching ignores case, underscores and dashes", () => {
    for (const key of ["Transcript", "PHONE_NUMBER", "evidence-excerpt", "toNumber", "caller_id"]) assert.equal(isForbiddenKey(key), true, key);
    for (const key of ["callId", "durationSec", "route", "provider"]) assert.equal(isForbiddenKey(key), false, key);
  });
});

describe("the logger", () => {
  test("writes one JSON line per event with the redacted fields", () => {
    const lines: string[] = [];
    const restore = setLogSink((line) => lines.push(line));
    try {
      logEvent("voice.disconnected", { callId: "c1", durationSec: 42, transcript: TRANSCRIPT, to: "+447700900123" });
      logEvent("payment.error", { email: "jo@example.co.uk", code: "card_declined" }, "error");
    } finally {
      restore();
    }
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]);
    assert.equal(first.event, "voice.disconnected");
    assert.equal(first.fields.transcript, REDACTED);
    assert.equal(first.fields.to, REDACTED);
    assert.equal(first.fields.durationSec, 42);
    assert.doesNotMatch(lines.join("\n"), /7700|example\.co\.uk|my number/);
    assert.equal(JSON.parse(lines[1]).level, "error");
  });

  test("never throws, even on a circular or odd value", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const restore = setLogSink(() => {});
    try {
      assert.doesNotThrow(() => logEvent("voice.error", { circular, big: BigInt(5), fn: () => 1 }));
    } finally {
      restore();
    }
    const rec = buildLogRecord("quote.event", { circular });
    assert.equal(rec.event, "quote.event");
  });
});
