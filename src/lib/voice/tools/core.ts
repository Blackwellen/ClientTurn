/**
 * The voice tool core (voice phase P3). Pure orchestration over injected
 * ports: the route handler wires Supabase and the service registry in
 * (`voice/tools/server.ts`), the tests and the QA simulator wire fakes.
 *
 * One request is one Retell custom-function invocation. In a fixed order:
 *
 *   1. the tool exists and its arguments parse (Zod, `definitions.ts`);
 *   2. the call exists and is this workspace's, and is live (or just ended,
 *      for the wrap-up tools: a summary, an objection, an opt-out);
 *   3. idempotency: (call id, tool call id) is claimed once. A retry gets
 *      the stored answer; the same id with different arguments is refused;
 *   4. the deterministic gate for the tool: the workspace's AI permissions
 *      (book, quote, send quote, checkout), the transfer mode, the consent
 *      basis for an AI callback, and the in-call evidence rules (a meeting
 *      only at a time check_availability returned in THIS call; a quote only
 *      by a reference calculate_quote returned in THIS call);
 *   5. the port runs the work, through the service registry as caller AGENT;
 *   6. the answer is a small JSON object for the model: `say` (the only
 *      words it may use for a figure or time: they come from the tool), the
 *      data, and the time governor's level and instruction for this moment.
 *
 * Resolved conflict 1: nothing here lets the model decide a price, a
 * discount, availability or an area. A refusal comes back as `ok: false`
 * with a line the model can say ("a colleague will confirm that").
 */

import { createHash } from "node:crypto";
import { VOICE_TOOL_ARGS, isVoiceToolName, type VoiceToolArgs, type VoiceToolName } from "./definitions.ts";
import { governTime, type TimeLevel, type VoiceRouteKey } from "../time-governor.ts";
import { timeRouteFor, type BriefRoute, type TransferModeLike } from "../call-brief.ts";
import { checkAgentTurn, agentTargets, measurePace } from "../pacing.ts";
import { houseStyleViolations } from "../opener.ts";
import { aiMay, type AiAuthority } from "../../commercial/ai-permissions.ts";
import { quoteToolGate } from "../../agent/quote-flow.ts";

/* ------------------------------------------------------------------ types */

export type ToolCallRow = {
  id: string;
  business_id: string;
  lead_id: string;
  route: string;
  state: string;
  direction: "OUTBOUND" | "INBOUND";
  consent_basis: string | null;
  answered_at: string | null;
  started_at: string | null;
  created_at: string;
};

export type ToolPermissions = {
  aiEnabled: boolean;
  book: boolean;
  quote: boolean;
  sendQuote: boolean;
  checkout: boolean;
  transferMode: TransferModeLike;
  transferNumberSet: boolean;
  /** aiMay(transfer_human): the owner let the assistant hand a live call to a person. */
  transferHuman: boolean;
  /** aiMay(call): the owner let the assistant place calls it decides on (an AI call-back). */
  aiCall: boolean;
  /** The lead has an email address (send_quote / checkout by email). */
  hasEmail: boolean;
  /** The lead's number is a UK mobile we may text (checkout by SMS). */
  smsLawful: boolean;
  /**
   * The business has a booking link the assistant may send ("just email me",
   * send_booking_link). Optional: absent reads as none.
   */
  bookingLink?: boolean;
};

/**
 * The tool permissions from the SAME sources and gates a text turn uses (not
 * copies): aiMay for book / call / transfer_human, quoteToolGate for the
 * quote tools (AI on, quote_ai_enabled, create_quote / send_quote), and the
 * direct-close facts for a checkout link (checkoutGate runs again per link).
 */
export function deriveToolPermissions(input: {
  aiEnabled: boolean;
  quoteAiCapability: boolean;
  authority: AiAuthority;
  directClose: { enabled: boolean; motionAllows: boolean; approvedLinks: number };
  transfer: { mode: TransferModeLike; numberSet: boolean };
  hasEmail: boolean;
  smsLawful: boolean;
  /** A booking link is configured (business_settings booking URL). */
  bookingLink?: boolean;
}): ToolPermissions {
  const access = { aiEnabled: input.aiEnabled, quoteAiCapability: input.quoteAiCapability, authority: input.authority };
  return {
    aiEnabled: input.aiEnabled,
    book: aiMay(input.authority, "book"),
    quote: quoteToolGate("calculate_quote", access).allowed,
    sendQuote: quoteToolGate("draft_quote", access).allowed && quoteToolGate("send_quote", access).allowed,
    checkout: input.directClose.enabled && input.directClose.motionAllows && input.directClose.approvedLinks > 0,
    transferMode: input.transfer.mode,
    transferNumberSet: input.transfer.numberSet,
    transferHuman: aiMay(input.authority, "transfer_human"),
    aiCall: aiMay(input.authority, "call"),
    hasEmail: input.hasEmail,
    smsLawful: input.smsLawful,
    bookingLink: Boolean(input.bookingLink),
  };
}

export type PriorToolResult = { tool: VoiceToolName; status: string; result: Record<string, unknown> };

export type ClaimResult =
  | { kind: "NEW" }
  | { kind: "DONE"; response: VoiceToolResponse }
  | { kind: "IN_PROGRESS" }
  | { kind: "MISMATCH" }
  | { kind: "UNAVAILABLE" };

export type PortOutcome =
  | { ok: true; say: string | null; data: Record<string, unknown>; operation: string | null }
  | { ok: false; code: string; say: string; operation: string | null };

export type VoiceToolPorts = {
  now(): Date;
  loadCall(ref: { callId: string | null; providerCallId: string | null }): Promise<ToolCallRow | null>;
  claim(input: { call: ToolCallRow; toolCallId: string; tool: VoiceToolName; argsHash: string }): Promise<ClaimResult>;
  complete(input: {
    call: ToolCallRow;
    toolCallId: string;
    status: "OK" | "REFUSED" | "FAILED";
    operation: string | null;
    response: VoiceToolResponse;
    refusalCode: string | null;
    latencyMs: number;
  }): Promise<void>;
  /** Earlier tool results on this call (for the in-call evidence rules). */
  priorResults(callId: string): Promise<PriorToolResult[]>;
  permissions(call: ToolCallRow): Promise<ToolPermissions>;
  /** The work, through the service registry as caller AGENT. */
  execute<N extends VoiceToolName>(name: N, call: ToolCallRow, args: VoiceToolArgs<N>, key: string): Promise<PortOutcome>;
  /**
   * One structured event per tool call that reached a verdict (OK, REFUSED or
   * FAILED), for operators (`voice.tool_used`, observability/log.ts). No
   * arguments and no words: ids, the tool, the verdict, the code, latency.
   * Optional: the stored voice_tool_calls row is the record either way.
   */
  observe?(event: ToolObservation): void;
};

export type ToolObservation = {
  callId: string;
  businessId: string;
  tool: VoiceToolName;
  status: "OK" | "REFUSED" | "FAILED";
  code: string | null;
  operation: string | null;
  latencyMs: number;
};

export type VoiceToolRequest = {
  name: string;
  toolCallId: string | null;
  callId: string | null;
  providerCallId: string | null;
  args: unknown;
};

export type VoiceToolResponse = {
  ok: boolean;
  tool: string;
  /** Words the assistant may say. Figures and times in it come from the tool. */
  say: string | null;
  data: Record<string, unknown>;
  code?: string;
  time_level: TimeLevel;
  time_instruction: string;
  seconds_left: number;
};

export type VoiceToolHttpResult = { status: number; body: VoiceToolResponse | { ok: false; error: string } };

/* --------------------------------------------------------------- helpers */

const LIVE: ReadonlySet<string> = new Set(["DIALLING", "RINGING", "ANSWERED", "IN_CONVERSATION", "WRAPPING_UP", "TRANSFERRED"]);
const JUST_ENDED: ReadonlySet<string> = new Set(["ENDED", "POST_PROCESSING", "COMPLETE", "VOICEMAIL"]);
/** Tools Retell may still call as the call closes. */
const WRAP_UP_TOOLS: ReadonlySet<VoiceToolName> = new Set(["end_call_summary", "log_objection", "opt_out"]);
const AI_CALL_BASES: ReadonlySet<string> = new Set(["CALL_REQUESTED", "FORM_CONSENT_TO_CALL"]);

export const TIME_INSTRUCTIONS: Readonly<Record<TimeLevel, string>> = {
  GREEN: "Carry on with the plan.",
  TIME_AMBER: "Sum up what you have learned in one sentence, start nothing new, and steer to the next step.",
  TIME_RED: "Sum up now, take the next step or offer a follow-up, call end_call_summary, and end the call.",
  OVER: "Thank them, call end_call_summary, and end the call now.",
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function argsHash(args: unknown): string {
  return createHash("sha256").update(canonicalJson(args)).digest("hex");
}

export function elapsedSec(call: ToolCallRow, now: Date): number {
  const from = call.answered_at ?? call.started_at ?? call.created_at;
  const t = Date.parse(from);
  return Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 1000)) : 0;
}

function routeOf(call: ToolCallRow): VoiceRouteKey {
  const r = call.route as BriefRoute;
  return timeRouteFor(["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION", "RETURN_CALL"].includes(r) ? r : "QUALIFICATION");
}

export function timeFields(call: ToolCallRow, now: Date): Pick<VoiceToolResponse, "time_level" | "time_instruction" | "seconds_left"> {
  const signal = governTime({ route: routeOf(call), elapsedSec: elapsedSec(call, now) });
  return { time_level: signal.level, time_instruction: TIME_INSTRUCTIONS[signal.level], seconds_left: signal.remainingSec };
}

/**
 * A `say` line must be speakable: no dashes, no emoji, no web address, one
 * question at most. A port's line that breaks this is replaced by a neutral
 * one rather than read out.
 */
export function speakable(say: string | null): string | null {
  if (!say) return null;
  const t = say.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const pace = agentTargets(measurePace([]));
  const problems = [...houseStyleViolations(t), ...checkAgentTurn(t, { ...pace, maxWordsPerTurn: 60 }).filter((v) => v !== "TOO_MANY_WORDS" && v !== "LONG_SENTENCE")];
  return problems.length ? null : t;
}

const REFUSAL_SAY: Readonly<Record<string, string>> = {
  NOT_PERMITTED: "That is something a colleague will handle. I will make sure they follow up.",
  NOT_OFFERED: "Let me check the times again first.",
  UNKNOWN_QUOTE: "Let me work out the figures first.",
  TRANSFER_OFF: "I cannot put you through right now, but a colleague will call you back.",
  NO_CONSENT_FOR_AI_CALLBACK: "A colleague will call you back at that time.",
  CALL_NOT_LIVE: "",
  INVALID_INPUT: "Sorry, could you say that once more?",
  // A tool that failed or timed out (provider outage, a cold start): apologise
  // once and move the step to a text follow-up; never guess the answer.
  UNAVAILABLE: "Sorry, I cannot do that just now. I will get the details sent to you by text or email, and a colleague will follow up.",
  NO_BOOKING_LINK: "I do not have a link to send, so a colleague will send you the details.",
  // After an opt-out nothing else is sent, booked or arranged in this call,
  // not even what they asked for earlier ("email me", then "f off").
  OPTED_OUT: "",
};

/** The only tools a call may still run once the lead has opted out in it. */
const AFTER_OPT_OUT: ReadonlySet<VoiceToolName> = new Set(["opt_out", "end_call_summary", "log_objection", "get_call_status"]);

function refusal(tool: string, code: string, call: ToolCallRow | null, now: Date, say?: string): VoiceToolResponse {
  const t = call
    ? timeFields(call, now)
    : { time_level: "GREEN" as TimeLevel, time_instruction: TIME_INSTRUCTIONS.GREEN, seconds_left: 0 };
  return { ok: false, tool, say: say ?? REFUSAL_SAY[code] ?? REFUSAL_SAY.UNAVAILABLE, data: {}, code, ...t };
}

/* --------------------------------------------------------------- the gate */

export type GateVerdict = { allowed: true } | { allowed: false; code: string; say?: string };

/** The deterministic gate for one tool. Pure; exported for the tests and the QA simulator. */
export function voiceToolGate<N extends VoiceToolName>(input: {
  name: N;
  args: VoiceToolArgs<N>;
  call: ToolCallRow;
  permissions: ToolPermissions;
  prior: readonly PriorToolResult[];
}): GateVerdict {
  const { name, call, permissions: p } = input;
  // An opt-out is always honoured, whatever else is switched off.
  if (name === "opt_out") return { allowed: true };
  // Owner decision 2026-09-28: once they opted out on this call (a swear-off
  // included), nothing more is sent or arranged, even a send they asked for
  // earlier in the same call. Deterministic: read from this call's own results.
  if (!AFTER_OPT_OUT.has(name) && input.prior.some((r) => r.tool === "opt_out" && r.status === "OK")) {
    return { allowed: false, code: "OPTED_OUT" };
  }
  if (!p.aiEnabled && name !== "end_call_summary" && name !== "log_objection" && name !== "get_call_status") {
    return { allowed: false, code: "NOT_PERMITTED" };
  }
  switch (name) {
    case "check_availability":
      return p.book ? { allowed: true } : { allowed: false, code: "NOT_PERMITTED" };
    case "book_meeting": {
      if (!p.book) return { allowed: false, code: "NOT_PERMITTED" };
      const start = (input.args as VoiceToolArgs<"book_meeting">).start_iso;
      const offered = input.prior
        .filter((r) => r.tool === "check_availability" && r.status === "OK")
        .flatMap((r) => (Array.isArray(r.result.slots) ? (r.result.slots as { start?: string }[]) : []))
        .map((s) => (s.start ? Date.parse(s.start) : NaN));
      return offered.includes(Date.parse(start)) ? { allowed: true } : { allowed: false, code: "NOT_OFFERED" };
    }
    case "calculate_quote":
      return p.quote ? { allowed: true } : { allowed: false, code: "NOT_PERMITTED" };
    case "send_quote": {
      if (!p.sendQuote) return { allowed: false, code: "NOT_PERMITTED" };
      const a = input.args as VoiceToolArgs<"send_quote">;
      if (a.channel === "email" && !p.hasEmail) return { allowed: false, code: "NOT_PERMITTED", say: "I do not have an email address for you, so a colleague will send it." };
      const known = input.prior.some((r) => r.tool === "calculate_quote" && r.status === "OK" && r.result.quote_ref === a.quote_ref);
      return known ? { allowed: true } : { allowed: false, code: "UNKNOWN_QUOTE" };
    }
    case "send_checkout_link": {
      if (!p.checkout) return { allowed: false, code: "NOT_PERMITTED" };
      const a = input.args as VoiceToolArgs<"send_checkout_link">;
      if (a.channel === "sms" && !p.smsLawful) return p.hasEmail ? { allowed: false, code: "NOT_PERMITTED", say: "I can email it to you instead. Is that all right?" } : { allowed: false, code: "NOT_PERMITTED" };
      if (a.channel === "email" && !p.hasEmail) return { allowed: false, code: "NOT_PERMITTED" };
      return { allowed: true };
    }
    case "send_booking_link": {
      if (!p.bookingLink) return { allowed: false, code: "NO_BOOKING_LINK" };
      const a = input.args as VoiceToolArgs<"send_booking_link">;
      if (a.channel === "sms" && !p.smsLawful) return p.hasEmail ? { allowed: false, code: "NOT_PERMITTED", say: "I can email it to you instead. Is that all right?" } : { allowed: false, code: "NOT_PERMITTED" };
      if (a.channel === "email" && !p.hasEmail) return { allowed: false, code: "NOT_PERMITTED", say: "I do not have an email address for you, so a colleague will send it." };
      return { allowed: true };
    }
    case "transfer_to_human": {
      const reason = (input.args as VoiceToolArgs<"transfer_to_human">).reason;
      if (!p.transferHuman || p.transferMode === "NEVER" || !p.transferNumberSet) return { allowed: false, code: "TRANSFER_OFF" };
      if (p.transferMode === "ON_REQUEST" && reason !== "ASKED_FOR_PERSON") return { allowed: false, code: "TRANSFER_OFF" };
      return { allowed: true };
    }
    case "schedule_callback": {
      const a = input.args as VoiceToolArgs<"schedule_callback">;
      // Only a lead who asked for or consented to AI calls is called back by the AI.
      if (a.by === "AI" && (!AI_CALL_BASES.has(call.consent_basis ?? "") || !p.aiCall)) {
        return { allowed: false, code: "NO_CONSENT_FOR_AI_CALLBACK" };
      }
      return { allowed: true };
    }
    default:
      return { allowed: true };
  }
}

/* ---------------------------------------------------------------- runner */

export async function runVoiceTool(ports: VoiceToolPorts, req: VoiceToolRequest): Promise<VoiceToolHttpResult> {
  const started = Date.now();
  const now = ports.now();
  if (!isVoiceToolName(req.name)) return { status: 404, body: { ok: false, error: "Unknown tool." } };
  const name = req.name;
  if (!req.toolCallId) return { status: 400, body: { ok: false, error: "Missing tool call id." } };

  const call = await ports.loadCall({ callId: req.callId, providerCallId: req.providerCallId });
  if (!call) return { status: 404, body: { ok: false, error: "Unknown call." } };

  const parsed = VOICE_TOOL_ARGS[name].safeParse(req.args ?? {});
  if (!parsed.success) return { status: 200, body: refusal(name, "INVALID_INPUT", call, now) };
  const args = parsed.data as VoiceToolArgs<typeof name>;

  const live = LIVE.has(call.state) || (JUST_ENDED.has(call.state) && WRAP_UP_TOOLS.has(name));
  if (!live) return { status: 200, body: refusal(name, "CALL_NOT_LIVE", call, now, "The call has ended.") };

  // get_call_status reads nothing but the clock: no claim, no row.
  if (name === "get_call_status") {
    return { status: 200, body: { ok: true, tool: name, say: null, data: { elapsed_sec: elapsedSec(call, now) }, ...timeFields(call, now) } };
  }

  const claim = await ports.claim({ call, toolCallId: req.toolCallId, tool: name, argsHash: argsHash(args) });
  if (claim.kind === "DONE") return { status: 200, body: { ...claim.response, ...timeFields(call, now) } };
  if (claim.kind === "IN_PROGRESS") return { status: 409, body: { ok: false, error: "This tool call is still running." } };
  if (claim.kind === "MISMATCH") return { status: 409, body: { ok: false, error: "This tool call id was used with different arguments." } };
  if (claim.kind === "UNAVAILABLE") return { status: 200, body: refusal(name, "UNAVAILABLE", call, now) };

  const finish = async (status: "OK" | "REFUSED" | "FAILED", response: VoiceToolResponse, operation: string | null, code: string | null) => {
    const latencyMs = Date.now() - started;
    await ports.complete({ call, toolCallId: req.toolCallId as string, status, operation, response, refusalCode: code, latencyMs });
    try {
      ports.observe?.({ callId: call.id, businessId: call.business_id, tool: name, status, code, operation, latencyMs });
    } catch {
      // An operator event never changes what the caller hears.
    }
    return { status: 200, body: response };
  };

  const [permissions, prior] = await Promise.all([ports.permissions(call), ports.priorResults(call.id)]);
  const gate = voiceToolGate({ name, args, call, permissions, prior });
  if (!gate.allowed) return finish("REFUSED", refusal(name, gate.code, call, now, gate.say), null, gate.code);

  let outcome: PortOutcome;
  try {
    outcome = await ports.execute(name, call, args, `voice:${call.id}:${req.toolCallId}`);
  } catch {
    return finish("FAILED", refusal(name, "UNAVAILABLE", call, now), null, "UNAVAILABLE");
  }
  if (!outcome.ok) {
    return finish("REFUSED", refusal(name, outcome.code, call, now, speakable(outcome.say) ?? undefined), outcome.operation, outcome.code);
  }
  const response: VoiceToolResponse = {
    ok: true,
    tool: name,
    say: speakable(outcome.say),
    data: outcome.data,
    ...timeFields(call, now),
  };
  return finish("OK", response, outcome.operation, null);
}

/* ------------------------------------------------------- the request body */

export type RetellToolBody = {
  name?: unknown;
  tool_call_id?: unknown;
  args?: unknown;
  call?: {
    call_id?: unknown;
    metadata?: Record<string, unknown>;
    transcript_with_tool_calls?: { role?: string; name?: string; tool_call_id?: string }[];
  };
};

/**
 * Retell's id for this invocation. UNVERIFIED: the custom-function payload
 * documented on 2026-09-27 is `{ name, call, args }` with no top-level id, so
 * the id is taken from (in order) a top-level `tool_call_id`, the last
 * `tool_call_invocation` for this tool in `call.transcript_with_tool_calls`,
 * else a hash of the call, the tool and the arguments (a retry with the same
 * arguments is then the same invocation, which is the safe reading).
 */
export function toolCallIdOf(body: RetellToolBody, tool: string): string {
  if (typeof body.tool_call_id === "string" && body.tool_call_id) return body.tool_call_id;
  const turns = Array.isArray(body.call?.transcript_with_tool_calls) ? body.call!.transcript_with_tool_calls! : [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t?.role === "tool_call_invocation" && t.name === tool && typeof t.tool_call_id === "string" && t.tool_call_id) return t.tool_call_id;
  }
  const callId = typeof body.call?.call_id === "string" ? body.call.call_id : "";
  return `derived:${createHash("sha256").update(`${callId}|${tool}|${JSON.stringify(body.args ?? {})}`).digest("hex").slice(0, 40)}`;
}

