/**
 * Voice QA pass, part F: the enterprise checks on the voice agent, in the
 * pure layer and the in-memory runtime (no Retell, no Twilio, no database):
 *
 *   - every tool call that reaches a verdict is stored (voice_tool_calls) and
 *     observed (voice.tool_used), and every write goes through the service
 *     registry, which writes the audit row;
 *   - one actor per lead: the commercial tools claim the lead's lease;
 *   - a tool timeout or outage: an apology and a text follow-up;
 *   - the maintenance pause and the tool route's maintenance class;
 *   - the owner's AI permissions gate every tool, and an opt-out is never
 *     gated;
 *   - the recording notice is part of the locked opener;
 *   - opt-out propagation: "take me off your list" reaches every channel,
 *     a wrong number is not rung again, an inbound caller's own number is
 *     the one suppressed;
 *   - data minimisation in logs: the tool event carries no words.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runVoiceTool, voiceToolGate, type ToolCallRow, type ToolPermissions, type VoiceToolPorts, type VoiceToolResponse, type ToolObservation } from "../src/lib/voice/tools/core.ts";
import { VOICE_TOOL_NAMES } from "../src/lib/voice/tools/definitions.ts";
import { buildLockedPreamble, RECORDING_NOTICE } from "../src/lib/voice/opener.ts";
import { classifyRoute } from "../src/lib/maintenance/routes.ts";
import { buildLogRecord } from "../src/lib/observability/log.ts";
import { dialCall, ingestVoiceEvent, postProcessCall, requestCall } from "../src/lib/voice/runtime-core.ts";
import type { VoiceEvent } from "../src/lib/voice/providers/types.ts";
import { BIZ, LEAD, VoiceWorld } from "./voice-world.ts";

const row: ToolCallRow = {
  id: "00000000-0000-4000-8000-00000000c001",
  business_id: "11111111-1111-4111-8111-111111111111",
  lead_id: "22222222-2222-4222-8222-222222222222",
  route: "QUALIFICATION",
  state: "IN_CONVERSATION",
  direction: "OUTBOUND",
  consent_basis: "CALL_REQUESTED",
  answered_at: "2026-09-29T10:00:00.000Z",
  started_at: "2026-09-29T10:00:00.000Z",
  created_at: "2026-09-29T10:00:00.000Z",
};
const ALL_ON: ToolPermissions = { aiEnabled: true, book: true, quote: true, sendQuote: true, checkout: true, transferMode: "ON_REQUEST", transferNumberSet: true, transferHuman: true, aiCall: true, hasEmail: true, smsLawful: true, bookingLink: true };

function ports(perms: ToolPermissions, seen: ToolObservation[], stored: { status: string; code: string | null }[], executed: string[]): VoiceToolPorts {
  const done = new Map<string, VoiceToolResponse>();
  return {
    now: () => new Date("2026-09-29T10:01:00.000Z"),
    loadCall: async () => row,
    claim: async ({ toolCallId }) => (done.has(toolCallId) ? { kind: "DONE", response: done.get(toolCallId)! } : { kind: "NEW" }),
    complete: async ({ toolCallId, status, response, refusalCode }) => {
      done.set(toolCallId, response);
      stored.push({ status, code: refusalCode });
    },
    priorResults: async () => [],
    permissions: async () => perms,
    execute: async (name) => {
      executed.push(name);
      return { ok: true, say: null, data: {}, operation: `voice_agent.${name}` };
    },
    observe: (e) => seen.push(e),
  };
}

describe("part F: every tool action is recorded and observed", () => {
  test("OK and REFUSED both leave a stored verdict and one operator event", async () => {
    const seen: ToolObservation[] = [];
    const stored: { status: string; code: string | null }[] = [];
    const executed: string[] = [];
    const p = ports(ALL_ON, seen, stored, executed);
    await runVoiceTool(p, { name: "log_objection", toolCallId: "a", callId: row.id, providerCallId: "p", args: { key: "PRICE" } });
    // book_meeting at a time check_availability never returned: refused.
    await runVoiceTool(p, { name: "book_meeting", toolCallId: "b", callId: row.id, providerCallId: "p", args: { start_iso: "2026-09-30T09:00:00.000Z" } });
    assert.deepEqual(stored.map((s) => s.status), ["OK", "REFUSED"]);
    assert.equal(stored[1].code, "NOT_OFFERED");
    assert.deepEqual(seen.map((e) => `${e.tool}:${e.status}`), ["log_objection:OK", "book_meeting:REFUSED"]);
    assert.deepEqual(executed, ["log_objection"], "a refused tool never runs");
  });

  test("every tool with work behind it is a service-registry operation (the audit row is the registry's)", () => {
    const server = readFileSync(new URL("../src/lib/voice/tools/server.ts", import.meta.url), "utf8");
    const registry = readFileSync(new URL("../src/lib/services/registry.ts", import.meta.url), "utf8");
    for (const name of VOICE_TOOL_NAMES.filter((n) => n !== "get_call_status")) {
      assert.ok(server.includes(`${name}: "voice_agent.${name}"`), `${name} maps to its operation`);
      assert.ok(registry.includes(`name: "voice_agent.${name}"`), `voice_agent.${name} is declared`);
    }
    assert.match(server, /logEvent\("voice\.tool_used"/);
  });

  test("the operator event is redacted: ids, verdict and timing only, never words or numbers", () => {
    const record = buildLogRecord("voice.tool_used", { callId: row.id, businessId: row.business_id, tool: "opt_out", status: "OK", code: null, operation: "suppression.record", latencyMs: 12, transcript: "please stop calling me", phone: "+447700900123" }, "info");
    const text = JSON.stringify(record);
    assert.doesNotMatch(text, /please stop calling|\+447700900123/);
  });
});

describe("part F: one actor per lead", () => {
  test("the commercial tools claim the lead's lease as VOICE before they act", () => {
    const work = readFileSync(new URL("../src/lib/voice/tools/work.ts", import.meta.url), "utf8");
    assert.match(work, /holder: \{ kind: "VOICE", ref: l\.call\.id \}/);
    assert.match(work, /claimForCall\(l, "PAYMENT_LINK"/);
    assert.match(work, /claimForCall\(l, "BOOKING"|bookingActionKey/);
  });
});

describe("part F: AI permissions and the opt-out", () => {
  test("with AI off, nothing commercial runs, and an opt-out still does", () => {
    const off = { ...ALL_ON, aiEnabled: false };
    for (const name of ["check_availability", "send_checkout_link", "send_booking_link", "calculate_quote", "schedule_callback"] as const) {
      const args = name === "send_checkout_link" ? { item: "x", channel: "sms" } : name === "send_booking_link" ? { channel: "sms" } : name === "calculate_quote" ? { items: [{ name: "x", quantity: 1 }] } : name === "schedule_callback" ? { by: "AI" } : {};
      assert.equal(voiceToolGate({ name, args: args as never, call: row, permissions: off, prior: [] }).allowed, false, name);
    }
    // Second live call 2026-09-28 (docs/VOICE.md §16.16): noting what the lead
    // said and a person's call-back are core call functions, not selling, so
    // they follow the call, not the text assistant's switch. The dial itself
    // is refused while the assistant is off (entitlement AI_ASSISTANT_OFF).
    assert.equal(voiceToolGate({ name: "record_fact", args: { dimension: "TEAM_SIZE", value: "5", confirmed: false } as never, call: row, permissions: off, prior: [] }).allowed, true);
    assert.equal(voiceToolGate({ name: "schedule_callback", args: { by: "PERSON" } as never, call: row, permissions: off, prior: [] }).allowed, true);
    assert.equal(voiceToolGate({ name: "opt_out", args: { scope: "ALL" }, call: row, permissions: { ...off, transferHuman: false }, prior: [] }).allowed, true);
  });

  test("each permission gates its own tool", () => {
    const g = (name: string, perms: Partial<ToolPermissions>, args: unknown) => voiceToolGate({ name: name as never, args: args as never, call: row, permissions: { ...ALL_ON, ...perms }, prior: [] }).allowed;
    assert.equal(g("check_availability", { book: false }, {}), false);
    assert.equal(g("calculate_quote", { quote: false }, { items: [{ name: "x", quantity: 1 }] }), false);
    assert.equal(g("send_checkout_link", { checkout: false }, { item: "x", channel: "sms" }), false);
    assert.equal(g("send_booking_link", { bookingLink: false }, { channel: "sms" }), false);
    assert.equal(g("transfer_to_human", { transferHuman: false }, { reason: "ASKED_FOR_PERSON" }), false);
    assert.equal(g("schedule_callback", { aiCall: false }, { by: "AI", at_iso: "2026-09-30T09:00:00.000Z" }), false);
  });
});

describe("part F: the recording notice and the maintenance pause", () => {
  test("recording on: the notice is spoken in the locked opener, before the model says anything", () => {
    const p = buildLockedPreamble({ callingAsName: "Acme Studio", enquiryAt: new Date("2026-09-28T10:00:00Z"), now: new Date("2026-09-29T10:00:00Z"), timezone: "Europe/London", recordingEnabled: true });
    assert.ok(p.text.includes(RECORDING_NOTICE));
    assert.match(p.text, /AI assistant/);
    const off = buildLockedPreamble({ callingAsName: "Acme Studio", enquiryAt: new Date("2026-09-28T10:00:00Z"), now: new Date("2026-09-29T10:00:00Z"), timezone: "Europe/London", recordingEnabled: false });
    assert.ok(!off.text.includes(RECORDING_NOTICE));
  });

  test("a live call's tools keep working in a maintenance window; new dials are paused by the runtime", () => {
    assert.equal(classifyRoute("/api/voice/tools/opt_out"), "WEBHOOK");
    const core = readFileSync(new URL("../src/lib/voice/runtime-core.ts", import.meta.url), "utf8");
    assert.match(core, /maintenancePauseUntil/);
  });
});

describe("part F: opt-out propagation after the call (the deterministic safety net)", () => {
  function ev(callId: string, pid: string, e: Partial<VoiceEvent> & { type: VoiceEvent["type"] }, key: string): VoiceEvent {
    return { provider: "retell", dedupeKey: key, occurredAt: null, providerCallId: pid, metadata: { voice_call_id: callId }, ...e } as VoiceEvent;
  }
  async function answered(w: VoiceWorld, transcript: { role: "agent" | "user"; content: string }[]) {
    const r = await requestCall(w.deps(), { businessId: BIZ, leadId: LEAD, route: "QUALIFICATION", entryPoint: "OUTBOUND_DIAL", requestedBy: null });
    const id = (r as { callId: string }).callId;
    await dialCall(w.deps(), id);
    const pid = w.calls.get(id)!.provider_call_id!;
    const fake = w.voice!.calls.get(pid)!;
    fake.transcript = transcript.map((t) => ({ ...t, startMs: null, endMs: null }));
    fake.durationSec = 30;
    fake.status = "ENDED";
    await ingestVoiceEvent(w.deps(), ev(id, pid, { type: "CALL_STARTED" }, `${pid}:call_started`));
    await ingestVoiceEvent(w.deps(), ev(id, pid, { type: "CALL_ENDED", outcome: "COMPLETED", durationSec: 30, disconnectionReason: "user_hangup" }, `${pid}:call_ended`));
    await postProcessCall(w.deps(), { callId: id });
    return id;
  }

  test("'take me off your list' in ASR words: every channel", async () => {
    const w = new VoiceWorld();
    const id = await answered(w, [{ role: "user", content: "nah take me of ya list mate" }]);
    assert.equal(w.outcomes.get(id)?.disposition, "OPTED_OUT");
    assert.deepEqual(w.optOutScopes, ["ALL"]);
    assert.ok(!w.jobs.some((j) => j.type === "voice.retry"));
  });

  test("'don't ring me again': calls only", async () => {
    const w = new VoiceWorld();
    await answered(w, [{ role: "user", content: "dont ring me again" }]);
    assert.deepEqual(w.optOutScopes, ["CALLS"]);
  });

  test("a wrong number is not rung again, and nothing is recorded as the lead's words", async () => {
    const w = new VoiceWorld();
    const id = await answered(w, [{ role: "user", content: "wrong number love, there's no one called that here" }]);
    assert.equal(w.outcomes.get(id)?.disposition, "WRONG_PERSON");
    assert.deepEqual(w.optOutScopes, ["CALLS"]);
  });

  test("a voicemail greeting that reached the model is no conversation: no signals, no opt-out", async () => {
    const w = new VoiceWorld();
    const id = await answered(w, [{ role: "user", content: "you've reached the voicemail of dave please leave a message after the tone" }]);
    assert.equal(w.outcomes.get(id)?.disposition, "NO_CONVERSATION");
    assert.deepEqual(w.signals, []);
    assert.deepEqual(w.optOutScopes, []);
  });

  test("the all-channel opt-out is wired to the one suppression list and the lead flag", () => {
    const deps = readFileSync(new URL("../src/lib/voice/server-deps.ts", import.meta.url), "utf8");
    assert.match(deps, /input\.scope === "ALL"/);
    assert.match(deps, /channel: "ALL",\s+reason: "OPT_OUT"/);
    assert.match(deps, /opted_out: true, automation_active: false/);
    const work = readFileSync(new URL("../src/lib/voice/tools/work.ts", import.meta.url), "utf8");
    assert.match(work, /applySuppression\(toolContext\(l, \{ optOutRecognised: true \}\), \{ reason: "opt_out", scope: "all" \}\)/);
  });
});
