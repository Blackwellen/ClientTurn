/**
 * Voice call QA simulation (brief §62, extended by the voice QA pass and the
 * adversarial QA pass, 2026-09-28): 94 scripted calls through the real call brief, the real
 * spoken-intent playbook and the real tool core, scored on naturalness
 * proxies (turn length, one question, at most two sentences, house style),
 * loop avoidance, route, commercial action, duration, tools and final
 * disposition. Zero cost: no Retell, no model, no database.
 *
 * Fixtures: tests/fixtures/voice-call-qa/{simulator,scenarios}.ts. Set
 * VOICE_QA_REPORT=1 to print the score table.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { simulate, asrGarble, deadAirAfter, complianceFailures, score, agentTurnsMerged, spokenEmail, readBackEmail, type SimResult, type Scenario } from "./fixtures/voice-call-qa/simulator.ts";
import { SCENARIOS } from "./fixtures/voice-call-qa/scenarios.ts";
import { buildVoiceCallBrief, estimateTokens, CALL_BRIEF_MAX_TOKENS, type BriefRoute } from "../src/lib/voice/call-brief.ts";
import { RETELL_GENERAL_PROMPT, retellCustomTools } from "../src/lib/voice/tools/definitions.ts";
import { voiceToolGate, type ToolCallRow, type ToolPermissions } from "../src/lib/voice/tools/core.ts";
import { detectSpokenIntents } from "../src/lib/voice/speech-intents.ts";
import { renderClosingLine } from "../src/lib/voice/opener.ts";

const results: SimResult[] = [];

/**
 * The fixed prompt carries the LISTEN FOR playbook; this pins what that costs per turn.
 *
 * Raised 1,100 -> 1,300 by the adversarial QA pass (2026-09-28), with the
 * reason written down as the owner asked: six intents a live call must hear
 * and that no per-call brief can carry (an automated call screen, a child or
 * vulnerable person, a subject access request, "can you hear me", a price /
 * date / area question, and hostile or TPS stops), plus UK phrasings that
 * were missed. It is the same text on every call, so it is cheap: ~150 more
 * input tokens a turn is about $0.0009 a 15-turn call on GPT-4.1 mini, and
 * the existing lines were shortened to pay for part of it (labels dropped
 * from the rendered block, actions tightened).
 */
const GENERAL_PROMPT_MAX_TOKENS = 1300;
/** General prompt + the largest brief + the time plan, before tool definitions (raised by the same 200). */
const PROMPT_TOTAL_MAX_TOKENS = 2550;

describe("§62: the call QA scenarios", () => {
  test("at least 90 scenarios, uniquely keyed, covering every route", () => {
    assert.ok(SCENARIOS.length >= 90, `${SCENARIOS.length} scenarios`);
    assert.equal(new Set(SCENARIOS.map((s) => s.key)).size, SCENARIOS.length);
    for (const route of ["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE", "NURTURE", "REACTIVATION"] as BriefRoute[]) {
      assert.ok(SCENARIOS.some((s) => s.route === route), route);
    }
  });

  for (const s of SCENARIOS) {
    test(`${s.key}: ${s.title}`, async () => {
      const r = await simulate(s);
      results.push(r);
      assert.equal(r.firstUtteranceOk, true, "the locked opener is the first utterance");
      assert.equal(r.disposition, s.expect.disposition, r.score.notes.join(" | "));
      assert.equal(r.closingSpoken, s.expect.closing, "closing attribution");
      assert.equal(r.score.commercial, 20, r.score.notes.join(" | "));
      assert.equal(r.score.loops, 15, r.score.notes.join(" | "));
      assert.equal(r.score.duration, 15, r.score.notes.join(" | "));
      assert.equal(r.score.total, 100, `${s.key} scored ${r.score.total}: ${r.score.notes.join(" | ")}`);
      // Every call ends with the assistant's own summary, and never after an opt-out's closing line.
      assert.ok(r.tools.some((t) => t.name === "end_call_summary"));
      if (s.expect.disposition === "OPTED_OUT") assert.equal(r.closingSpoken, false);
      // A machine is never pitched: nothing but the summary.
      if (s.expect.disposition === "VOICEMAIL") assert.deepEqual(r.tools.map((t) => t.name), ["end_call_summary"]);
    });
  }

  test("the heavy-accent scenario really injects ASR noise", () => {
    assert.equal(asrGarble("I think we are twenty five people"), "I fink we are twenny fife people");
  });

  test("score table", () => {
    if (process.env.VOICE_QA_REPORT) {
      console.log("\nscenario | natural | loops | route | commercial | duration | tools | disposition | total | seconds | tools called");
      for (const r of results) {
        const s = r.score;
        console.log(
          `${r.key} | ${s.naturalness} | ${s.loops} | ${s.route} | ${s.commercial} | ${s.duration} | ${s.tools} | ${s.disposition} | ${s.total} | ${r.elapsedSec} | ${r.tools.map((t) => t.name).join(",")}`,
        );
      }
    }
    assert.equal(results.length, SCENARIOS.length);
  });
});

describe("the prompt stays inside its budget", () => {
  test("general prompt and the largest brief plus time plan", () => {
    assert.ok(estimateTokens(RETELL_GENERAL_PROMPT) <= GENERAL_PROMPT_MAX_TOKENS, `general prompt ${estimateTokens(RETELL_GENERAL_PROMPT)}`);
    const b = buildVoiceCallBrief({
      route: "QUALIFICATION", direction: "OUTBOUND", callingAsName: "Acme Studio", personaName: "Sam", leadFirstName: "Priya",
      identityAnswer: "This is Acme Studio Ltd. You can reach us at 1 High Street, London, EC1A 1AA.", openerSuffix: "x ".repeat(200),
      motion: "BOOK_MEETING_B2B", goal: null, nba: null, known: Array.from({ length: 30 }, (_, i) => `Known item ${i}`),
      offerLines: Array.from({ length: 12 }, () => "An approved line about the offer that runs on for a good while. ".repeat(3)),
      workspaceObjections: null, booking: "SLOTS", permissions: { book: true, quote: true, sendQuote: true, checkout: true, bookingLink: true },
      transfer: { mode: "ON_REQUEST", available: true }, textFollowUpLawful: true, conversationSummary: "y ".repeat(900),
      closingLine: renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: false }).text,
    });
    assert.ok(estimateTokens(b.text) <= CALL_BRIEF_MAX_TOKENS);
    const total = estimateTokens(RETELL_GENERAL_PROMPT) + estimateTokens(b.text) + estimateTokens(b.timePlan);
    assert.ok(total <= PROMPT_TOTAL_MAX_TOKENS, `prompt total ${total}`);
  });
});

describe("no dead air after a silent note (Retell speak_after_execution)", () => {
  test("record_fact and log_objection let the agent carry on; only end_call_summary is silent", () => {
    const tools = Object.fromEntries(retellCustomTools("https://x.example").map((t) => [t.name, t]));
    assert.equal(tools.record_fact.speak_after_execution, true);
    assert.equal(tools.log_objection.speak_after_execution, true);
    assert.equal(tools.end_call_summary.speak_after_execution, false);
    assert.match(tools.log_objection.description, /never read the note aloud/);
    assert.match(RETELL_GENERAL_PROMPT, /silent notes, never a turn on their own/);
  });

  test("an objection logged mid-turn is followed by the agent's next line, in every scenario", async () => {
    const r = await simulate(SCENARIOS.find((s) => s.key === "two-objections-one-call")!);
    const logs = r.tools.filter((t) => t.name === "log_objection");
    assert.equal(logs.length, 2);
    for (const t of logs) {
      const next = r.transcript.find((u) => u.startMs >= t.atMs);
      assert.equal(next?.speaker, "AGENT", "the agent speaks right after logging the objection");
    }
    for (const s of SCENARIOS) assert.deepEqual(deadAirAfter(await simulate(s)), [], s.key);
  });

  test("the detector catches a silent note", () => {
    const fake = {
      tools: [{ name: "log_objection", args: {}, status: 200, ok: true, say: null, timeLevel: "GREEN", atMs: 5000 }],
      transcript: [
        { speaker: "AGENT", text: "Is now OK?", startMs: 0, endMs: 2000 },
        { speaker: "LEAD", text: "Too expensive.", startMs: 3000, endMs: 4000 },
        { speaker: "LEAD", text: "Hello?", startMs: 9000, endMs: 9500 },
      ],
    } as unknown as SimResult;
    assert.deepEqual(deadAirAfter(fake), ["log_objection"]);
  });
});

/* ============================ the scorer itself (adversarial QA pass, 2026-09-28) */

describe("the scorer fails what it must fail", () => {
  const base: Scenario = { key: "x", title: "x", route: "QUALIFICATION", lines: [], expect: { disposition: "CONVERSATION", tools: [], closing: false } };
  const opener = { speaker: "AGENT" as const, text: "(opener)", startMs: 0, endMs: 1000 };
  const fake = (transcript: { speaker: "AGENT" | "LEAD"; text: string; startMs: number }[], tools: Partial<SimResult["tools"][number]>[] = []): SimResult =>
    ({
      key: "x",
      brief: { route: "QUALIFICATION", record: { route: "QUALIFICATION" } },
      transcript: [opener, ...transcript.map((u) => ({ ...u, endMs: u.startMs + 500 }))],
      tools: tools.map((t) => ({ args: {}, status: 200, ok: true, say: null, timeLevel: "GREEN", atMs: 0, ...t })),
      elapsedSec: 30,
      disposition: "CONVERSATION",
      closingSpoken: false,
      firstUtteranceOk: true,
      loops: { loopsDetected: [] },
    }) as unknown as SimResult;

  test("three back-to-back agent lines are ONE turn of three sentences", () => {
    const r = fake([
      { speaker: "LEAD", text: "Yes.", startMs: 2000 },
      { speaker: "AGENT", text: "Great.", startMs: 3000 },
      { speaker: "AGENT", text: "That helps.", startMs: 4000 },
      { speaker: "AGENT", text: "How many of you are there?", startMs: 5000 },
    ]);
    assert.equal(agentTurnsMerged(r).length, 1);
    assert.ok(score(base, r, "QUALIFICATION").notes.some((n) => /TOO_MANY_SENTENCES/.test(n)));
  });

  test("claiming to be human, 'may be recorded', an invented time or area all fail compliance", () => {
    const r = fake([
      { speaker: "LEAD", text: "Is this a robot?", startMs: 2000 },
      { speaker: "AGENT", text: "No, I am a real person.", startMs: 3000 },
      { speaker: "LEAD", text: "Are you recording this?", startMs: 4000 },
      { speaker: "AGENT", text: "It may be recorded.", startMs: 5000 },
      { speaker: "LEAD", text: "Do you cover Leeds?", startMs: 6000 },
      { speaker: "AGENT", text: "Yes, we cover Leeds and I can do Friday at 3pm.", startMs: 7000 },
    ]);
    const f = complianceFailures(base, r).join(" | ");
    assert.match(f, /claimed to be human/);
    assert.match(f, /may be recorded/);
    assert.match(f, /recording answer was not the locked line/);
    assert.match(f, /commitment of its own/);
    assert.match(f, /time or day not from a tool: Friday/);
    assert.match(f, /3pm/);
  });

  test("a pitch after an opt-out, an unconfirmed email and a call-back in the past fail", () => {
    const s: Scenario = { ...base, expect: { ...base.expect, disposition: "OPTED_OUT" } };
    const r = fake(
      [
        { speaker: "LEAD", text: "Stop calling me.", startMs: 2000 },
        { speaker: "AGENT", text: "Understood. We will not call you again.", startMs: 4000 },
        { speaker: "AGENT", text: "Before you go, our websites are great.", startMs: 6000 },
      ],
      [
        { name: "opt_out", say: "Understood. We will not call you again.", atMs: 3000 },
        { name: "record_fact", args: { dimension: "EMAIL", value: "priya@northwind.co.uk", confirmed: false }, atMs: 3000 },
        { name: "schedule_callback", args: { at_iso: "2026-09-01T09:00:00.000Z" }, atMs: 3000 },
      ],
    );
    const f = complianceFailures(s, r).join(" | ");
    assert.match(f, /after opt_out the agent said/);
    assert.match(f, /unconfirmed priya@northwind/);
    assert.match(f, /call-back in the past/);
  });

  test("spoken emails are parsed and read back letter by letter", () => {
    assert.equal(spokenEmail("It's priya at northwind dot co dot uk."), "priya@northwind.co.uk");
    assert.equal(spokenEmail("No, it's p r i y a at north wind dot com"), "priya@northwind.com");
    assert.equal(spokenEmail("we're at the office"), null);
    assert.equal(readBackEmail("priya@northwind.co.uk"), "p, r, i, y, a, at northwind dot co dot uk");
  });
});

/* ===================== swear-off = objection to ALL contact (owner decision 2026-09-28) */

describe("a swear-off stops every channel, and nothing more is sent in the call", () => {
  test("hostile dismissals are opt_out scope ALL, the same path as 'take me off your list'", () => {
    for (const said of ["oh f off", "piss off", "fuck off", "leave me alone", "go away", "take me off your list"]) {
      const hit = detectSpokenIntents(said)[0];
      assert.equal(hit?.key, "OPT_OUT_ALL", said);
      assert.equal(hit?.optOutScope, "ALL", said);
    }
  });

  test("after an OK opt_out in this call the gate refuses every send, booking and call-back", () => {
    const call = { id: "c", business_id: "b", lead_id: "l", route: "QUALIFICATION", state: "IN_CONVERSATION", direction: "OUTBOUND", consent_basis: "CALL_REQUESTED", answered_at: null, started_at: null, created_at: "2026-09-29T10:00:00Z" } as unknown as ToolCallRow;
    const permissions = { aiEnabled: true, book: true, quote: true, sendQuote: true, checkout: true, transferMode: "ON_REQUEST", transferNumberSet: true, transferHuman: true, aiCall: true, hasEmail: true, smsLawful: true, bookingLink: true } as unknown as ToolPermissions;
    const prior = [{ tool: "opt_out" as const, status: "OK", result: { scope: "ALL" } }];
    for (const name of ["send_booking_link", "send_checkout_link", "send_quote", "schedule_callback", "check_availability", "book_meeting", "transfer_to_human", "record_fact"] as const) {
      const v = voiceToolGate({ name, args: {} as never, call, permissions, prior });
      assert.deepEqual(v, { allowed: false, code: "OPTED_OUT" }, name);
    }
    for (const name of ["end_call_summary", "log_objection", "opt_out", "get_call_status"] as const) {
      assert.equal(voiceToolGate({ name, args: {} as never, call, permissions, prior }).allowed, true, name);
    }
  });
});
