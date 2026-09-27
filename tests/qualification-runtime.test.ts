import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  askedIntentFor,
  buildTurnAccounting,
  isReplyTrigger,
  legacyDecisionRecord,
  planFor,
  planNeedsModel,
  qaContextFromNba,
  runQiRecord,
  shadowDiffers,
  tokensByAction,
  type LegacyDecision,
} from "../src/lib/agent/qi-turn.ts";
import { runQuestionQa } from "../src/lib/qualification-intelligence/qa.ts";
import {
  NBA_ACTIONS,
  QIE_ENGINE_VERSION,
  resolveEngineMode,
  turnAccountingSchema,
  type NbaAction,
} from "../src/lib/qualification-intelligence/types.ts";
import { nbaFixture, TURN_FIXTURES } from "./fixtures/qi-turn-fixtures.ts";

/**
 * The engine inside the live agent flow (design 08 Wave 2, CD-9, CD-14):
 * OFF is the legacy turn, SHADOW computes and records without acting, LIVE
 * acts on the NBA. The pure decisions are tested directly; the server wiring
 * (orchestrator.ts, qi-runtime.ts) is pinned by its source, as the repo's
 * other runtime tests do, because it needs a database to run.
 */

const orchestrator = readFileSync(new URL("../src/lib/agent/orchestrator.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src/lib/agent/qi-runtime.ts", import.meta.url), "utf8");

const legacyAsking: LegacyDecision = { nextQuestionId: TURN_FIXTURES[0].nba.question_intent!.question_id, agentMode: "QUALIFICATION", stoppedQualifying: false };

describe("mode resolution (CD-9)", () => {
  test("no stored mode is SHADOW until the release gates pass, then LIVE; a stored mode always wins", () => {
    assert.equal(resolveEngineMode(null, false), "SHADOW");
    assert.equal(resolveEngineMode(null, true), "LIVE");
    assert.equal(resolveEngineMode("OFF", true), "OFF");
    assert.equal(resolveEngineMode("LIVE", false), "LIVE");
  });
});

describe("OFF: the legacy turn, unchanged", () => {
  test("the runtime returns no engine turn when the mode is OFF", () => {
    assert.match(runtime, /if \(mode === "OFF"\) return null;/);
  });

  test("no qi record is written, no QA is enforced and the legacy strategy is kept", () => {
    // closeRun reads run.qi lazily; with stats.qi null the record is null.
    assert.match(orchestrator, /const qi = stats\.qi;\s*\n\s*if \(!qi\) return null;/);
    // QA rejections are wired only for LIVE.
    assert.match(orchestrator, /if \(qa && input\.stats\.qi\?\.mode === "LIVE"\)/);
    // The NBA strategy replaces the legacy one only for LIVE.
    assert.match(orchestrator, /if \(qi\?\.mode === "LIVE"\) \{\s*\n\s*const acted = await actOnNba\(input, qi\);/);
  });

  test("an engine failure falls back to the legacy path, never to silence", () => {
    assert.match(runtime, /continuing on the legacy path/);
    assert.match(runtime, /catch \(error\) \{[\s\S]*?return null;/);
  });
});

describe("SHADOW: compute, store and diff, never act", () => {
  test("the NBA and the legacy decision are compared on the move and the question", () => {
    const same = TURN_FIXTURES[0].nba;
    assert.equal(shadowDiffers(same, legacyAsking), false);
    assert.equal(shadowDiffers(same, { ...legacyAsking, nextQuestionId: "11111111-1111-4111-8111-111111111111" }), true);
    const book = TURN_FIXTURES.find((f) => f.id === "studio-threshold-met-book")!.nba;
    assert.equal(shadowDiffers(book, { nextQuestionId: null, agentMode: "QUALIFICATION", stoppedQualifying: true }), false);
    assert.equal(shadowDiffers(book, legacyAsking), true);
    const wait = nbaFixture({ next_action: "WAIT", rule: "R6_NOT_NOW", intent_state: "NOT_NOW", resume_at: "2026-12-01T09:00:00.000Z" });
    assert.equal(shadowDiffers(wait, { nextQuestionId: null, agentMode: "FOLLOW_UP", stoppedQualifying: false }), true);
  });

  test("the legacy decision record carries the diff note (lead_assessments.legacy_decision)", () => {
    const record = legacyDecisionRecord(TURN_FIXTURES[0].nba, { ...legacyAsking, nextQuestionId: null });
    assert.equal(record.differs, true);
    assert.match(record.note ?? "", /NBA ASK TIMING\.START_WINDOW/);
  });

  test("the accounting records the diff and never claims a call avoided", () => {
    const accounting = buildTurnAccounting({
      mode: "SHADOW",
      nba: nbaFixture({ next_action: "WAIT", rule: "R6_NOT_NOW", intent_state: "NOT_NOW", resume_at: "2026-12-01T09:00:00.000Z" }),
      modelCalled: true,
      shadowDiffers: true,
      strategyBlockTokens: 140,
      interpretationTokens: 0,
      qaFindings: ["QA_UNPLANNED_QUESTION"],
      questionGrade: 62,
    });
    assert.equal(accounting.shadow_differs, true);
    assert.equal(accounting.model_call_avoided, false);
    assert.ok(turnAccountingSchema.safeParse(accounting).success);
  });

  test("the orchestrator records the turn-level diff and keeps acting on the legacy decision", () => {
    assert.match(orchestrator, /if \(qi\?\.mode === "SHADOW"\) input\.stats\.shadowDiffers = shadowDiffers\(qi\.nba, legacy\);/);
    // SHADOW QA and grade are recorded on the run, not enforced.
    assert.match(orchestrator, /if \(input\.stats\.qi\?\.mode === "SHADOW"\) \{\s*\n\s*input\.stats\.qaFindings\.push/);
  });
});

describe("LIVE: the turn acts on the NBA", () => {
  const cases: { action: NbaAction; kind: string; model: boolean }[] = [
    { action: "WAIT", kind: "SILENT", model: false },
    { action: "NO_ACTION", kind: "SILENT", model: false },
    { action: "DISQUALIFY", kind: "SILENT", model: false },
    { action: "ESCALATE", kind: "ESCALATE", model: false },
    { action: "ASK", kind: "COMPOSE", model: true },
    { action: "ANSWER", kind: "COMPOSE", model: true },
    { action: "INFORM", kind: "COMPOSE", model: true },
    { action: "CTA_CHECKOUT", kind: "COMPOSE", model: true },
  ];
  for (const c of cases) {
    test(`${c.action} -> ${c.kind}${c.model ? " (model composes)" : " (no model call)"}`, () => {
      const nba = nbaFixture({
        next_action: c.action,
        rule: "R12_FALLBACK",
        question_intent: c.action === "ASK" ? TURN_FIXTURES[0].nba.question_intent : null,
        handover_reason: c.action === "ESCALATE" ? "NO_NEXT_QUESTION" : null,
        resume_at: c.action === "WAIT" ? "2026-12-01T09:00:00.000Z" : null,
      });
      const plan = planFor(nba, { manual: false });
      assert.equal(plan.kind, c.kind);
      assert.equal(planNeedsModel(plan), c.model);
    });
  }

  test("CTA_BOOK in manual booking mode asks for a preferred time without a model call (H3)", () => {
    const book = TURN_FIXTURES.find((f) => f.id === "studio-threshold-met-book")!.nba;
    assert.equal(planFor(book, { manual: true }).kind, "ASK_PREFERRED_TIME");
    assert.equal(planFor(book, { manual: false }).kind, "COMPOSE");
  });

  test("every NBA action has a plan", () => {
    for (const action of NBA_ACTIONS) {
      const nba = nbaFixture({
        next_action: action,
        rule: "R12_FALLBACK",
        question_intent: action === "ASK" || action === "ANSWER_AND_ASK" ? TURN_FIXTURES[0].nba.question_intent : null,
        handover_reason: action === "ESCALATE" ? "NO_NEXT_QUESTION" : null,
        resume_at: action === "WAIT" ? "2026-12-01T09:00:00.000Z" : null,
      });
      assert.ok(planFor(nba, { manual: false }).kind);
    }
  });

  test("QA holds the model to the NBA's one question", () => {
    const nba = TURN_FIXTURES[0].nba;
    const ctx = qaContextFromNba({
      nba,
      channel: "sms",
      stage: "QUALIFYING",
      dimensions: [
        { dimension: "PROBLEM", status: "CONFIRMED" },
        { dimension: "COMPANY_SIZE", status: "CONFIRMED" },
        { dimension: "TIMING", status: "UNKNOWN", required: true },
      ],
      forbiddenIntents: [],
      inbound: "Tickets take days to get answered.",
      interpretation: null,
      recentOutbound: [],
    });
    assert.equal(runQuestionQa("Sorry to hear that. When does your current contract come up for renewal?", ctx).ok, true);
    assert.equal(runQuestionQa("Sorry to hear that. How many staff do you have?", ctx).ok, false);
  });

  test("the orchestrator wiring: interpret + write-back, NBA before language, decision_json.qi", () => {
    // interpret() writes back with source_ref = the inbound message (CD-15).
    assert.match(runtime, /interpret\(input\.latestMessage, state/);
    assert.match(runtime, /await writeInterpretation\(\{/);
    // The NBA is decided with the real checkout gate, then recorded.
    assert.match(runtime, /checkoutAllowed: await checkoutAllowed\(context\)/);
    assert.match(runtime, /planLeadTurn\(intel, qualificationScore, turn\)/);
    assert.match(runtime, /recordLeadAssessment\(intel, \{[\s\S]*?nba: planned\.nba/);
    // The engine runs before the model is called.
    assert.ok(orchestrator.indexOf("await prepareQiTurn(") < orchestrator.indexOf("const proposal = await proposeDecision("));
    // Every closeRun carries decision_json.qi.
    assert.match(orchestrator, /run\.qi = \(\) => qiRunRecord\(stats\);/);
  });

  test("LIVE accounting: a zero-token action is a call avoided", () => {
    const silent = nbaFixture({ next_action: "NO_ACTION", rule: "R2_NEGATIVE_OR_SUPPRESSED", intent_state: "NEGATIVE", intent_score: 5 });
    const accounting = buildTurnAccounting({
      mode: "LIVE",
      nba: silent,
      modelCalled: false,
      shadowDiffers: null,
      strategyBlockTokens: 0,
      interpretationTokens: 0,
      qaFindings: [],
      questionGrade: null,
    });
    assert.equal(accounting.model_call_avoided, true);
    assert.equal(accounting.engine_version, QIE_ENGINE_VERSION);
    const record = runQiRecord({ nba: silent, interpretation: null, accounting });
    assert.ok(record);
  });
});

describe("tokens per action (design 08 §B.16)", () => {
  test("tokens per turn by NBA action and model calls avoided, from the run's own columns", () => {
    const live = (action: NbaAction, called: boolean) =>
      buildTurnAccounting({
        mode: "LIVE",
        nba: nbaFixture({
          next_action: action,
          rule: "R12_FALLBACK",
          question_intent: action === "ASK" ? TURN_FIXTURES[0].nba.question_intent : null,
          handover_reason: action === "ESCALATE" ? "NO_NEXT_QUESTION" : null,
        }),
        modelCalled: called,
        shadowDiffers: null,
        strategyBlockTokens: 70,
        interpretationTokens: 0,
        qaFindings: [],
        questionGrade: null,
      });
    const rows = tokensByAction([
      { accounting: live("ASK", true), inputTokens: 2400, outputTokens: 120 },
      { accounting: live("ASK", true), inputTokens: 2200, outputTokens: 100 },
      { accounting: live("NO_ACTION", false), inputTokens: 0, outputTokens: 0 },
      { accounting: live("ESCALATE", false), inputTokens: 0, outputTokens: 0 },
      { accounting: null, inputTokens: 2600, outputTokens: 130 },
    ]);
    const ask = rows.find((r) => r.action === "ASK")!;
    assert.equal(ask.meanInputTokensPerTurn, 2300);
    assert.equal(rows.find((r) => r.action === "NO_ACTION")!.callsAvoided, 1);
    assert.equal(rows.find((r) => r.action === "ENGINE_OFF")!.modelCalls, 1);
  });
});

describe("the reply trigger and the asked intent", () => {
  test("inbound messages are replies; other triggers keep the follow-up switch (I3)", () => {
    assert.equal(isReplyTrigger("INBOUND_SMS"), true);
    assert.equal(isReplyTrigger("REACTIVATION_REPLY"), true);
    assert.equal(isReplyTrigger("FOLLOW_UP_DUE"), false);
    assert.equal(isReplyTrigger("LEAD_CREATED"), false);
  });

  test("a VERIFY or CLARIFY key resolves to its dimension, so the reply is read as its answer", () => {
    assert.equal(askedIntentFor("COMPANY_SIZE.VERIFY")?.purpose, "VERIFY");
    assert.equal(askedIntentFor("TIMING.CLARIFY")?.dimension, "TIMING");
    assert.equal(askedIntentFor("USE_CASE.MSP")?.key, "USE_CASE.MSP");
    assert.equal(askedIntentFor("NOT_A_KEY"), null);
    assert.equal(askedIntentFor(null), null);
  });
});
