/**
 * Voice call QA simulation (brief §62, extended by the voice QA pass
 * 2026-09-28): 46 scripted calls through the real call brief, the real
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
import { simulate, asrGarble, deadAirAfter, type SimResult } from "./fixtures/voice-call-qa/simulator.ts";
import { SCENARIOS } from "./fixtures/voice-call-qa/scenarios.ts";
import { buildVoiceCallBrief, estimateTokens, CALL_BRIEF_MAX_TOKENS, type BriefRoute } from "../src/lib/voice/call-brief.ts";
import { RETELL_GENERAL_PROMPT, retellCustomTools } from "../src/lib/voice/tools/definitions.ts";
import { renderClosingLine } from "../src/lib/voice/opener.ts";

const results: SimResult[] = [];

/** The fixed prompt carries the LISTEN FOR playbook; this pins what that costs per turn. */
const GENERAL_PROMPT_MAX_TOKENS = 1100;
/** General prompt + the largest brief + the time plan, before tool definitions. */
const PROMPT_TOTAL_MAX_TOKENS = 2350;

describe("§62: the call QA scenarios", () => {
  test("at least 40 scenarios, uniquely keyed, covering every route", () => {
    assert.ok(SCENARIOS.length >= 40, `${SCENARIOS.length} scenarios`);
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
