/**
 * Voice P3: the voice agent's tools (src/lib/voice/tools/*). The core runs
 * over in-memory ports: no Retell, no database, no spend.
 */

import { test, describe } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { AI_PERMISSIONS_ENFORCED_BY_ASSISTANT, DEFAULT_AI_AUTHORITY } from "../src/lib/commercial/ai-permissions.ts";
import {
  argsHash,
  deriveToolPermissions,
  runVoiceTool,
  speakable,
  timeFields,
  toolCallIdOf,
  voiceToolGate,
  type PortOutcome,
  type PriorToolResult,
  type ToolCallRow,
  type ToolPermissions,
  type VoiceToolPorts,
  type VoiceToolResponse,
} from "../src/lib/voice/tools/core.ts";
import { retellCustomTools, VOICE_TOOL_ARGS, VOICE_TOOL_NAMES, RETELL_GENERAL_PROMPT, RETELL_BEGIN_MESSAGE } from "../src/lib/voice/tools/definitions.ts";
import { agentOverrideOf, buildCreatePhoneCallBody, parseRetellWebhook } from "../src/lib/voice/providers/retell-protocol.ts";
import { parseTwilioWebhook } from "../src/lib/voice/providers/twilio-protocol.ts";

const NOW = new Date("2026-09-28T11:00:00.000Z");

function call(overrides: Partial<ToolCallRow> = {}): ToolCallRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    business_id: "11111111-1111-4111-8111-111111111111",
    lead_id: "22222222-2222-4222-8222-222222222222",
    route: "BOOKING_CLOSE",
    state: "IN_CONVERSATION",
    direction: "OUTBOUND",
    consent_basis: "CALL_REQUESTED",
    answered_at: new Date(NOW.getTime() - 60_000).toISOString(),
    started_at: new Date(NOW.getTime() - 70_000).toISOString(),
    created_at: new Date(NOW.getTime() - 90_000).toISOString(),
    ...overrides,
  };
}

function perms(overrides: Partial<ToolPermissions> = {}): ToolPermissions {
  return {
    aiEnabled: true,
    book: true,
    quote: true,
    sendQuote: true,
    checkout: true,
    transferMode: "ON_REQUEST",
    transferNumberSet: true,
    transferHuman: true,
    aiCall: true,
    hasEmail: true,
    smsLawful: true,
    ...overrides,
  };
}

class FakePorts implements VoiceToolPorts {
  rows = new Map<string, { hash: string; status: string; response: VoiceToolResponse | null; tool: string }>();
  executed: { name: string; key: string }[] = [];
  outcomes: Partial<Record<string, PortOutcome | (() => PortOutcome)>> = {};
  row: ToolCallRow;
  p: ToolPermissions;
  clock: Date;
  constructor(row: ToolCallRow = call(), p: ToolPermissions = perms(), clock = NOW) {
    this.row = row;
    this.p = p;
    this.clock = clock;
  }
  now() {
    return this.clock;
  }
  async loadCall() {
    return this.row;
  }
  async claim({ toolCallId, tool, argsHash: hash }: { toolCallId: string; tool: string; argsHash: string }) {
    const r = this.rows.get(toolCallId);
    if (!r) {
      this.rows.set(toolCallId, { hash, status: "IN_PROGRESS", response: null, tool });
      return { kind: "NEW" as const };
    }
    if (r.hash !== hash) return { kind: "MISMATCH" as const };
    if (r.status === "IN_PROGRESS") return { kind: "IN_PROGRESS" as const };
    return { kind: "DONE" as const, response: r.response as VoiceToolResponse };
  }
  async complete({ toolCallId, status, response }: { toolCallId: string; status: string; response: VoiceToolResponse }) {
    const r = this.rows.get(toolCallId)!;
    r.status = status;
    r.response = response;
  }
  async priorResults(): Promise<PriorToolResult[]> {
    return [...this.rows.values()].filter((r) => r.response).map((r) => ({ tool: r.tool as never, status: r.status, result: r.response!.data }));
  }
  async permissions() {
    return this.p;
  }
  async execute(name: string, _c: ToolCallRow, _a: unknown, key: string): Promise<PortOutcome> {
    this.executed.push({ name, key });
    const o = this.outcomes[name];
    if (typeof o === "function") return o();
    if (o) return o;
    if (name === "check_availability") {
      return { ok: true, say: "I have Tue 29 Sep, 10:00am or Tue 29 Sep, 2:00pm. Does either work?", data: { slots: [{ start: "2026-09-29T09:00:00.000Z", end: "2026-09-29T09:30:00.000Z", label: "Tue 29 Sep, 10:00am" }, { start: "2026-09-29T13:00:00.000Z", end: "2026-09-29T13:30:00.000Z", label: "Tue 29 Sep, 2:00pm" }] }, operation: "booking.availability" };
    }
    if (name === "calculate_quote") return { ok: true, say: "That comes to £1,200.00 plus VAT, so £1,440.00 in total.", data: { quote_ref: "calc:abc", total: "£1,440.00" }, operation: "quote.calculate" };
    return { ok: true, say: null, data: { done: name }, operation: `voice_agent.${name}` };
  }
}

async function run(ports: FakePorts, name: string, args: unknown, id = `tc_${Math.random()}`) {
  return runVoiceTool(ports, { name, toolCallId: id, callId: ports.row.id, providerCallId: "call_x", args });
}

describe("the tool list and Retell's shapes", () => {
  test("every tool has an argument schema and a custom-function definition at /api/voice/tools/<name>", () => {
    const tools = retellCustomTools("https://app.clientturn.com/");
    assert.equal(tools.length, VOICE_TOOL_NAMES.length);
    for (const t of tools) {
      assert.ok(VOICE_TOOL_ARGS[t.name], t.name);
      assert.equal(t.type, "custom");
      assert.equal(t.method, "POST");
      assert.equal(t.url, `https://app.clientturn.com/api/voice/tools/${t.name}`);
      assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/);
      assert.equal(t.parameters.type, "object");
      assert.ok(t.timeout_ms >= 1000 && t.timeout_ms <= 600_000);
    }
  });

  test("the begin message is the locked opener, never model output", () => {
    assert.equal(RETELL_BEGIN_MESSAGE, "{{locked_preamble}}");
    for (const v of ["{{call_brief}}", "{{time_plan}}", "{{locked_preamble}}"]) assert.ok(RETELL_GENERAL_PROMPT.includes(v), v);
  });

  test("create-phone-call carries the per-call ceiling and the voicemail choice as agent_override", () => {
    const body = buildCreatePhoneCallBody({
      fromNumber: "+447700900111",
      toNumber: "+447700900123",
      agentId: "agent_1",
      callKey: "k",
      metadata: { voice_call_id: "c" },
      dynamicVariables: { call_brief: "x" },
      overrides: { maxCallDurationMs: 420_000, voicemail: { mode: "STATIC_TEXT", text: "Hello" } },
    });
    assert.deepEqual(body.agent_override, { agent: { max_call_duration_ms: 420_000, voicemail_option: { action: { type: "static_text", text: "Hello" } } } });
    assert.deepEqual(agentOverrideOf({ voicemail: { mode: "HANG_UP" } }), { agent: { voicemail_option: { action: { type: "hangup" } } } });
    assert.equal(agentOverrideOf(undefined), null);
  });

  test("the tool call id: explicit, from the transcript, else derived deterministically", () => {
    assert.equal(toolCallIdOf({ tool_call_id: "tc_1" }, "opt_out"), "tc_1");
    assert.equal(
      toolCallIdOf({ call: { call_id: "c", transcript_with_tool_calls: [{ role: "tool_call_invocation", name: "opt_out", tool_call_id: "tc_9" }] } }, "opt_out"),
      "tc_9",
    );
    const a = toolCallIdOf({ call: { call_id: "c" }, args: { scope: "CALLS" } }, "opt_out");
    assert.equal(a, toolCallIdOf({ call: { call_id: "c" }, args: { scope: "CALLS" } }, "opt_out"));
    assert.notEqual(a, toolCallIdOf({ call: { call_id: "c" }, args: { scope: "ALL" } }, "opt_out"));
  });

  test("args hash is canonical (key order does not matter)", () => {
    assert.equal(argsHash({ a: 1, b: [1, { c: 2, d: 3 }] }), argsHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
  });

  test("the carrier id: Retell's telephony identifier and Twilio's number pair ride in metadata", () => {
    const retell = parseRetellWebhook(JSON.stringify({ event: "call_started", call: { call_id: "r1", metadata: { voice_call_id: "c1" }, telephony_identifier: { twilio_call_sid: `CA${"a".repeat(32)}` } } }));
    assert.equal((retell[0] as { metadata?: Record<string, string> }).metadata?.carrier_call_sid, `CA${"a".repeat(32)}`);
    const twilio = parseTwilioWebhook(new URLSearchParams({ CallSid: `CA${"b".repeat(32)}`, CallStatus: "ringing", From: "+447700900111", To: "+447700900123" }).toString());
    assert.deepEqual((twilio[0] as { metadata?: Record<string, string> }).metadata, { carrier_from: "+447700900111", carrier_to: "+447700900123" });
  });
});

describe("runVoiceTool: order, idempotency and the gate", () => {
  test("an unknown tool is 404 and nothing runs", async () => {
    const p = new FakePorts();
    const r = await run(p, "place_order", {});
    assert.equal(r.status, 404);
    assert.equal(p.executed.length, 0);
  });

  test("a retry with the same tool call id is answered from the stored result, once", async () => {
    const p = new FakePorts();
    const first = await run(p, "log_objection", { key: "PRICE" }, "tc_same");
    const second = await run(p, "log_objection", { key: "PRICE" }, "tc_same");
    assert.equal(first.status, 200);
    assert.deepEqual((second.body as VoiceToolResponse).data, (first.body as VoiceToolResponse).data);
    assert.equal(p.executed.length, 1);
    const mismatch = await run(p, "log_objection", { key: "TIMING" }, "tc_same");
    assert.equal(mismatch.status, 409);
  });

  test("a meeting is booked only at a time check_availability returned in this call", async () => {
    const p = new FakePorts();
    const refused = await run(p, "book_meeting", { start_iso: "2026-09-29T09:00:00.000Z" });
    assert.equal((refused.body as VoiceToolResponse).code, "NOT_OFFERED");
    await run(p, "check_availability", {});
    const ok = await run(p, "book_meeting", { start_iso: "2026-09-29T10:00:00.000+01:00" });
    assert.equal((ok.body as VoiceToolResponse).ok, true);
    const invented = await run(p, "book_meeting", { start_iso: "2026-09-29T15:00:00.000Z" });
    assert.equal((invented.body as VoiceToolResponse).code, "NOT_OFFERED");
  });

  test("a quote is sent only by a reference calculate_quote returned in this call", async () => {
    const p = new FakePorts();
    const refused = await run(p, "send_quote", { quote_ref: "calc:abc" });
    assert.equal((refused.body as VoiceToolResponse).code, "UNKNOWN_QUOTE");
    const calc = await run(p, "calculate_quote", { items: [{ name: "Website", quantity: 1 }] });
    assert.match((calc.body as VoiceToolResponse).say ?? "", /£1,440\.00/);
    const sent = await run(p, "send_quote", { quote_ref: "calc:abc" });
    assert.equal((sent.body as VoiceToolResponse).ok, true);
  });

  test("the workspace's AI permissions bind every commercial tool (the same aiMay / quoteToolGate facts as text)", () => {
    const c = call();
    const off = perms({ book: false, quote: false, sendQuote: false, checkout: false, transferHuman: false, aiCall: false });
    for (const [name, args] of [
      ["check_availability", {}],
      ["book_meeting", { start_iso: "2026-09-29T09:00:00.000Z" }],
      ["calculate_quote", { items: [{ name: "x", quantity: 1 }] }],
      ["send_quote", { quote_ref: "r", channel: "email" }],
      ["send_checkout_link", { item: "x", channel: "sms" }],
      ["transfer_to_human", { reason: "ASKED_FOR_PERSON" }],
      ["schedule_callback", { by: "AI", at_iso: "2026-09-29T09:00:00.000Z" }],
    ] as const) {
      const v = voiceToolGate({ name, args: args as never, call: c, permissions: off, prior: [] });
      assert.equal(v.allowed, false, name);
    }
    // An opt-out is honoured whatever is switched off, even with the AI off.
    assert.equal(voiceToolGate({ name: "opt_out", args: { scope: "CALLS" }, call: c, permissions: perms({ aiEnabled: false }), prior: [] }).allowed, true);
  });

  test("transfer: never when off, on request only in ON_REQUEST, escalation in ON_REQUEST_OR_ESCALATION", () => {
    const c = call();
    const g = (p: ToolPermissions, reason: "ASKED_FOR_PERSON" | "STUCK") => voiceToolGate({ name: "transfer_to_human", args: { reason }, call: c, permissions: p, prior: [] }).allowed;
    assert.equal(g(perms({ transferMode: "NEVER" }), "ASKED_FOR_PERSON"), false);
    assert.equal(g(perms({ transferNumberSet: false }), "ASKED_FOR_PERSON"), false);
    assert.equal(g(perms(), "ASKED_FOR_PERSON"), true);
    assert.equal(g(perms(), "STUCK"), false);
    assert.equal(g(perms({ transferMode: "ON_REQUEST_OR_ESCALATION" }), "STUCK"), true);
  });

  test("an AI call-back needs call consent AND the owner's 'Phone leads' permission; a person's call-back does not", () => {
    const args = { by: "AI" as const, at_iso: "2026-09-29T09:00:00.000Z" };
    assert.equal(voiceToolGate({ name: "schedule_callback", args, call: call({ consent_basis: "PHONE_NUMBER_PROVIDED" }), permissions: perms(), prior: [] }).allowed, false);
    assert.equal(voiceToolGate({ name: "schedule_callback", args, call: call(), permissions: perms({ aiCall: false }), prior: [] }).allowed, false);
    assert.equal(voiceToolGate({ name: "schedule_callback", args, call: call(), permissions: perms(), prior: [] }).allowed, true);
    assert.equal(voiceToolGate({ name: "schedule_callback", args: { by: "PERSON" as const }, call: call({ consent_basis: null }), permissions: perms({ aiCall: false }), prior: [] }).allowed, true);
  });

  test("a call that has ended takes only the wrap-up tools", async () => {
    const p = new FakePorts(call({ state: "ENDED" }));
    assert.equal(((await run(p, "check_availability", {})).body as VoiceToolResponse).code, "CALL_NOT_LIVE");
    assert.equal(((await run(p, "end_call_summary", { summary: "Booked.", disposition: "MEETING_BOOKED" })).body as VoiceToolResponse).ok, true);
    assert.equal(((await run(p, "opt_out", { scope: "CALLS" })).body as VoiceToolResponse).ok, true);
  });

  test("a failing port is a refusal the model can say, and the row is completed", async () => {
    const p = new FakePorts();
    p.outcomes.check_availability = () => {
      throw new Error("calendar down");
    };
    const r = await run(p, "check_availability", {}, "tc_fail");
    const body = r.body as VoiceToolResponse;
    assert.equal(body.ok, false);
    assert.equal(body.code, "UNAVAILABLE");
    assert.match(body.say ?? "", /colleague/);
    assert.equal(p.rows.get("tc_fail")?.status, "FAILED");
  });

  test("every answer carries the time governor's level for this moment", async () => {
    const early = timeFields(call(), NOW);
    assert.equal(early.time_level, "GREEN");
    const late = timeFields(call({ answered_at: new Date(NOW.getTime() - 185_000).toISOString() }), NOW);
    assert.equal(late.time_level, "TIME_RED");
    assert.match(late.time_instruction, /end_call_summary/);
    const p = new FakePorts(call({ answered_at: new Date(NOW.getTime() - 140_000).toISOString() }));
    const r = await run(p, "get_call_status", {});
    assert.equal((r.body as VoiceToolResponse).time_level, "TIME_AMBER");
    assert.equal(p.executed.length, 0);
  });

  test("a port line that breaks house style is never read out", () => {
    assert.equal(speakable("That is £49 — per month."), null);
    assert.equal(speakable("See https://pay.example.com now."), null);
    assert.equal(speakable("Does Tuesday work? Or Wednesday?"), null);
    assert.equal(speakable("You are booked for Tue 29 Sep, 10:00am."), "You are booked for Tue 29 Sep, 10:00am.");
  });
});

describe("the server-only boundary for the voice tools", () => {
  test("the core and the definitions are pure; the wiring and the work are server-only", () => {
    for (const f of ["core.ts", "definitions.ts"]) {
      assert.doesNotMatch(readFileSync(`src/lib/voice/tools/${f}`, "utf8"), /^import "server-only"|from "[^"]*supabase/m, f);
    }
    for (const f of ["server.ts", "work.ts"]) {
      assert.match(readFileSync(`src/lib/voice/tools/${f}`, "utf8"), /^import "server-only";/m, f);
    }
    for (const f of ["call-brief.ts", "continuity.ts", "channel-orchestration.ts"]) {
      assert.doesNotMatch(readFileSync(`src/lib/voice/${f}`, "utf8"), /^import "server-only"|from "[^"]*supabase/m, f);
    }
  });
});

describe("deriveToolPermissions: the same aiMay and quoteToolGate facts as a text turn", () => {
  const base = {
    aiEnabled: true,
    quoteAiCapability: true,
    directClose: { enabled: true, motionAllows: true, approvedLinks: 1 },
    transfer: { mode: "ON_REQUEST" as const, numberSet: true },
    hasEmail: true,
    smsLawful: true,
  };
  function authority(caps: Partial<Record<string, boolean>>) {
    return { version: 2 as const, capabilities: { ...DEFAULT_AI_AUTHORITY.capabilities, ...caps }, discount: DEFAULT_AI_AUTHORITY.discount };
  }

  test("least privilege by default: book only; no call, transfer or quote", () => {
    const p = deriveToolPermissions({ ...base, authority: DEFAULT_AI_AUTHORITY });
    assert.equal(p.book, true);
    assert.equal(p.aiCall, false);
    assert.equal(p.transferHuman, false);
    assert.equal(p.quote, false);
    assert.equal(p.sendQuote, false);
  });

  test("each switch opens exactly its tool", () => {
    const p = deriveToolPermissions({ ...base, authority: authority({ call: true, transfer_human: true, create_quote: true, send_quote: true }) });
    assert.equal(p.aiCall, true);
    assert.equal(p.transferHuman, true);
    assert.equal(p.quote, true);
    assert.equal(p.sendQuote, true);
  });

  test("the plan capability and the AI switch still bind the quote tools", () => {
    const a = authority({ create_quote: true, send_quote: true });
    assert.equal(deriveToolPermissions({ ...base, quoteAiCapability: false, authority: a }).quote, false);
    assert.equal(deriveToolPermissions({ ...base, aiEnabled: false, authority: a }).quote, false);
  });

  test("with transfer_human off the transfer tool is refused and a call-back is offered", async () => {
    const p = new FakePorts(call(), perms({ transferHuman: false }));
    const r = await run(p, "transfer_to_human", { reason: "ASKED_FOR_PERSON" });
    assert.equal((r.body as VoiceToolResponse).code, "TRANSFER_OFF");
    assert.match((r.body as VoiceToolResponse).say ?? "", /call you back/);
  });

  test("call and transfer_human are now enforced, so the settings card lets owners edit them", () => {
    assert.ok(AI_PERMISSIONS_ENFORCED_BY_ASSISTANT.includes("call"));
    assert.ok(AI_PERMISSIONS_ENFORCED_BY_ASSISTANT.includes("transfer_human"));
  });
});
