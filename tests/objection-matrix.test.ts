/**
 * The objection matrix, text and voice (voice QA pass, 2026-09-28). Pure: no
 * model, no spend. Fixture: tests/fixtures/objection-matrix/cells.json (120
 * prioritised cells: objection x channel x goal x first/repeat) and
 * rubric.ts.
 *
 * Two things are proved per cell:
 *   1. the LIBRARY and STRATEGY produce what the cell needs (the right
 *      pattern for first or repeat, the goal's own next step, the repeat
 *      note; for voice, the brief's objection rules and goal step), so a
 *      regression in the source fails here for free;
 *   2. the reply written for the cell, as the model would given that plan,
 *      grades at least 90 (rubric, plus the repo's reply grader for text).
 *
 * What this does NOT prove: that the production model (Azure for text,
 * Retell's LLM for voice) writes these replies. The replies were written by
 * Claude acting as the model. OBJECTION_MATRIX_REPORT=1 prints the table,
 * with the before column (the replies the old library led to).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OBJECTIONS, matchObjection } from "../src/lib/sales-library/objections.ts";
import { pickResponsePattern, nextStepFor, GOAL_NEXT_STEP, REPEAT_OBJECTION_NOTE, type ObjectionGoal } from "../src/lib/sales-library/objection-responses.ts";
import { buildStrategyBlock } from "../src/lib/agent/strategy.ts";
import { buildVoiceCallBrief, voiceGoalStep, type CallBriefInput } from "../src/lib/voice/call-brief.ts";
import { renderClosingLine } from "../src/lib/voice/opener.ts";
import type { ObjectionKey, SalesMotion } from "../src/lib/sales-library/types.ts";
import { gradeCell, CLAIMS, type Cell, type StepKind } from "./fixtures/objection-matrix/rubric.ts";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/objection-matrix/cells.json", import.meta.url), "utf8")) as { cells: Cell[] };
const CELLS = FIXTURE.cells;

const MOTION: Record<ObjectionGoal, SalesMotion> = { MEETING: "BOOK_MEETING_B2B", DIRECT_SALE: "ECOMMERCE_DIRECT", TRIAL: "SAAS_SELF_SERVE", QUOTE: "LOCAL_SERVICE" };
const LATER_PATTERNS = new Set(["timing-accept", "timing-prepare", "not-now-later", "later-confirm", "incumbent-door-open"]);
const VOICE_LATER_ON_REPEAT = new Set(["TIMING", "NOT_NOW", "CALL_LATER", "EXISTING_PROVIDER"]);

/** What the library says the next step must be for this cell. */
export function stepFor(cell: Cell): { step: StepKind; proofExpected: boolean; pattern: string | null } {
  const key = cell.key as ObjectionKey;
  const entry = OBJECTIONS[key];
  if (entry.respectAsRefusal) return { step: "stop", proofExpected: false, pattern: null };
  if (entry.handover.always) return { step: "handover", proofExpected: false, pattern: null };
  if (cell.channel === "voice") {
    // The call brief: the first time, its one question; again, a timing /
    // not-now / happy-supplier is accepted, anything else gets one approved
    // reason and the goal's step. The AI question and "send me something"
    // take the goal's step at once (LISTEN FOR, SEND ME SOMETHING).
    if (cell.aiConcern || key === "SEND_INFORMATION") return { step: "goal", proofExpected: cell.turn === "repeat" && !cell.aiConcern, pattern: null };
    if (cell.turn === "first") return { step: "clarify", proofExpected: false, pattern: null };
    if (VOICE_LATER_ON_REPEAT.has(key)) return { step: "later", proofExpected: false, pattern: null };
    return { step: "goal", proofExpected: true, pattern: null };
  }
  if (entry.assist?.always) return { step: "assist", proofExpected: false, pattern: null };
  const p = pickResponsePattern(key, { seenBefore: cell.turn === "repeat", text: cell.inbound });
  const proof = !p.reframe.startsWith("none");
  if (p.clarify) return { step: "clarify", proofExpected: proof, pattern: p.name };
  if (p.advances) return { step: "goal", proofExpected: proof, pattern: p.name };
  if (LATER_PATTERNS.has(p.name)) return { step: "later", proofExpected: false, pattern: p.name };
  return { step: "own", proofExpected: false, pattern: p.name };
}

function strategyFor(cell: Cell) {
  return buildStrategyBlock({
    mode: "OBJECTION_HANDLING",
    motion: MOTION[cell.goal],
    archetypeKey: null,
    channel: cell.channel,
    selection: { question: null, stopReason: null, known: [] },
    latestMessage: cell.inbound,
    hasApprovedInsight: true,
    bookingAvailable: true,
    objectionSeenBefore: cell.turn === "repeat",
  });
}

function briefFor(cell: Cell) {
  const goal = cell.goal;
  const input: CallBriefInput = {
    route: goal === "DIRECT_SALE" ? "DIRECT_CLOSE" : "QUALIFICATION",
    direction: "OUTBOUND",
    callingAsName: "Acme Studio",
    personaName: "Sam",
    leadFirstName: "Priya",
    identityAnswer: "This is Acme Studio Ltd. You can reach us at 1 High Street, London, EC1A 1AA.",
    openerSuffix: null,
    motion: MOTION[goal],
    goal: goal === "TRIAL" ? "D_SIGNUP_TRIAL" : goal === "DIRECT_SALE" ? "C_DIRECT_SALE" : null,
    nba: null,
    known: [],
    offerLines: CLAIMS[goal],
    workspaceObjections: null,
    booking: "SLOTS",
    permissions: { book: true, quote: true, sendQuote: true, checkout: true, bookingLink: true },
    transfer: { mode: "ON_REQUEST", available: true },
    textFollowUpLawful: true,
    conversationSummary: null,
    closingLine: renderClosingLine({ callingAsName: "Acme Studio", whiteLabel: false }).text,
  };
  return { brief: buildVoiceCallBrief(input), input };
}

describe("the matrix fixture", () => {
  test("120 cells, unique, every library key, all four channels and goals, first and repeat", () => {
    assert.equal(CELLS.length, 120);
    assert.equal(new Set(CELLS.map((c) => c.id)).size, 120);
    for (const key of Object.keys(OBJECTIONS)) assert.ok(CELLS.some((c) => c.key === key), key);
    for (const ch of ["sms", "email", "whatsapp", "voice"]) assert.ok(CELLS.some((c) => c.channel === ch), ch);
    for (const g of ["MEETING", "DIRECT_SALE", "TRIAL", "QUOTE"]) assert.ok(CELLS.some((c) => c.goal === g), g);
    assert.ok(CELLS.some((c) => c.aiConcern), "the AI concern");
    for (const c of CELLS.filter((x) => x.turn === "repeat")) assert.ok(c.priorReply && c.priorInbound, c.id);
  });
});

describe("the library and strategy produce what each cell needs", () => {
  for (const cell of CELLS) {
    test(cell.id, () => {
      const matched = matchObjection(cell.inbound)[0]?.key;
      assert.equal(matched, cell.key, `"${cell.inbound}" should read as ${cell.key}`);
      const { step, pattern } = stepFor(cell);
      if (cell.channel === "voice") {
        const { brief, input } = briefFor(cell);
        assert.match(brief.text, /call log_objection with its key/);
        assert.match(brief.text, /The first time, ask its one question below and stop/);
        assert.match(brief.text, /never ask it twice/);
        assert.ok(brief.text.includes(voiceGoalStep(input)), "the goal's own step, with its tool");
        if (step === "later") assert.match(brief.text, /Timing, not now or happy with a supplier: accept it/);
        return;
      }
      const s = strategyFor(cell);
      assert.equal(s.record.objectionKey, cell.key);
      if (step === "stop") return assert.match(s.text, /Treat this as a refusal/);
      if (step === "handover") return assert.match(s.text, /REQUEST_HANDOVER/);
      if (step === "assist") return assert.match(s.text, /A colleague has been asked to send the approved information/);
      assert.equal(s.record.objectionPattern, pattern);
      if (step === "clarify") assert.match(s.text, /end on one clarifying question/);
      if (step === "goal") {
        const p = pickResponsePattern(cell.key as ObjectionKey, { seenBefore: cell.turn === "repeat", text: cell.inbound });
        const want = nextStepFor(p, cell.goal);
        assert.ok(s.text.includes(`next step (${want})`), `the step for ${cell.goal}: ${want}`);
        if (cell.goal !== "MEETING") assert.equal(want, GOAL_NEXT_STEP[cell.goal]);
      }
      if (cell.turn === "repeat") assert.ok(s.text.includes(REPEAT_OBJECTION_NOTE));
      if (cell.aiConcern) assert.equal(s.record.objectionPattern, "trust-ai-honest");
    });
  }
});

type Row = { id: string; before: number; after: number; notes: string[] };
const rows: Row[] = [];

describe("every cell grades at least 90", () => {
  for (const cell of CELLS) {
    test(cell.id, () => {
      const { step, proofExpected } = stepFor(cell);
      const after = gradeCell(cell, cell.reply, step, proofExpected);
      const before = cell.replyBefore ? gradeCell(cell, cell.replyBefore, step, proofExpected) : after;
      rows.push({ id: cell.id, before: before.grade, after: after.grade, notes: after.notes });
      assert.ok(after.grade >= 90, `${cell.id} graded ${after.grade}: ${after.notes.join(" | ")}`);
      if (cell.replyBefore) assert.ok(before.grade < after.grade, `${cell.id}: the before reply should grade lower (${before.grade} vs ${after.grade})`);
    });
  }

  test("report", () => {
    if (process.env.OBJECTION_MATRIX_REPORT) {
      const band = (g: number) => (g >= 90 ? "90+" : g >= 80 ? "80-89" : g >= 70 ? "70-79" : g >= 60 ? "60-69" : "<60");
      const dist = (key: "before" | "after") => rows.reduce<Record<string, number>>((m, r) => ((m[band(r[key])] = (m[band(r[key])] ?? 0) + 1), m), {});
      console.log("\nbefore", JSON.stringify(dist("before")), "mean", (rows.reduce((a, r) => a + r.before, 0) / rows.length).toFixed(1));
      console.log("after ", JSON.stringify(dist("after")), "mean", (rows.reduce((a, r) => a + r.after, 0) / rows.length).toFixed(1));
      const lowest = [...rows].sort((a, b) => a.after - b.after).slice(0, 5);
      for (const r of lowest) console.log(`lowest ${r.id} ${r.after} ${r.notes.join(" | ")}`);
      for (const r of rows) console.log(`${r.id} | ${r.before} | ${r.after}`);
    }
    assert.equal(rows.length, CELLS.length);
  });
});
