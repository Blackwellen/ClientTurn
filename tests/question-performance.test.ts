import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  computeQuestionPerformance,
  LOW_SAMPLE_N,
  questionFeaturesOf,
  questionOutcome,
  type FactEvidence,
  type InboundReply,
  type LeadOutcome,
  type QuestionSend,
} from "../src/lib/analytics/question-performance.ts";
import { buildMessageFeatures } from "../src/lib/learning/features.ts";
import {
  experimentProblems,
  EXPERIMENT_KINDS,
  variantQuestion,
  type ExperimentVariant,
} from "../src/lib/learning/experiments.ts";
import { QIE_ENGINE_VERSION, QUESTION_STRATEGY_EXPERIMENT_KIND } from "../src/lib/qualification-intelligence/types.ts";

/**
 * Question-level self-improvement (design 08 §17, §B.15): MessageFeatures v2,
 * the joined outcomes, the read model's ranking (never by replies), the
 * low-sample flag, and QUESTION_STRATEGY experiments (CD-19).
 */

const T0 = "2026-09-01T10:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(T0) + hours * 3_600_000).toISOString();

function send(id: string, lead: string, overrides: Partial<QuestionSend> = {}): QuestionSend {
  return {
    messageId: id,
    leadId: lead,
    sentAt: T0,
    channel: "sms",
    questionIntent: "TIMING.START_WINDOW",
    dimension: "TIMING",
    wordingFamily: "timing-direct",
    questionPosition: 2,
    intentState: "MEDIUM",
    offerId: null,
    archetype: "MSP",
    industry: null,
    ...overrides,
  };
}

describe("MessageFeatures v2", () => {
  test("carries the question features, structure only", () => {
    const features = buildMessageFeatures({
      family: "AGENT_REPLY",
      body: "Thanks Sam. When are you hoping to start?",
      channel: "sms",
      sendAt: new Date(T0),
      timeZone: "Europe/London",
      question: {
        questionIntent: "TIMING.START_WINDOW",
        dimension: "TIMING",
        wordingFamily: "timing-direct",
        questionPosition: 2,
        intentState: "MEDIUM",
        goal: "B_BOOK_MEETING",
        offerId: null,
        nbaAction: "ASK",
        strategyVersion: QIE_ENGINE_VERSION,
      },
    });
    assert.equal(features.v, 2);
    assert.equal(features.questionIntent, "TIMING.START_WINDOW");
    assert.equal(features.nbaAction, "ASK");
    assert.equal(features.strategyVersion, QIE_ENGINE_VERSION);
    assert.ok(!JSON.stringify(features).includes("Sam"));
  });

  test("a message the engine did not plan has null question features", () => {
    const features = buildMessageFeatures({ family: "FOLLOW_UP", body: "Hi", channel: "email", sendAt: new Date(T0) });
    assert.equal(features.questionIntent, null);
    assert.equal(questionFeaturesOf(features), null);
  });

  test("v1 rows (no question keys) read as not-a-question", () => {
    assert.equal(questionFeaturesOf({ v: 1, family: "AGENT_REPLY" }), null);
    assert.equal(questionFeaturesOf(null), null);
  });
});

describe("joined outcomes", () => {
  const replies: InboundReply[] = [
    { messageId: "in-1", leadId: "L1", at: at(2), classification: "POSITIVE_INTEREST" },
    { messageId: "in-2", leadId: "L2", at: at(100), classification: null },
    { messageId: "in-3", leadId: "L3", at: at(5), classification: "UNSUBSCRIBE" },
  ];
  const facts: FactEvidence[] = [
    { leadId: "L1", sourceRef: "in-1", dimension: "TIMING" },
    { leadId: "L2", sourceRef: "in-2", dimension: "TIMING" },
  ];

  test("response within 72h, meaningful answer = a fact from that reply on the asked dimension", () => {
    const o = questionOutcome(send("m1", "L1"), replies, facts, undefined);
    assert.equal(o.response, 1);
    assert.equal(o.meaningful, 1);
    assert.equal(o.dropOff, 0);
  });

  test("a reply after 72h is not a response, and its fact is not a meaningful answer to this question", () => {
    const o = questionOutcome(send("m2", "L2"), replies, facts, undefined);
    assert.equal(o.response, 0);
    assert.equal(o.meaningful, 0);
    // 100h is inside the 7-day drop-off window, so the lead did not drop off.
    assert.equal(o.dropOff, 0);
  });

  test("an answer on a different dimension is not meaningful for this question", () => {
    const o = questionOutcome(send("m1", "L1", { dimension: "BUDGET" }), replies, facts, undefined);
    assert.equal(o.meaningful, 0);
  });

  test("an unsubscribe inside 7 days is an opt-out", () => {
    assert.equal(questionOutcome(send("m3", "L3"), replies, facts, undefined).optOut, 1);
  });

  test("booking, win and progression count only after the question", () => {
    const outcome: LeadOutcome = { leadId: "L1", qualifiedAt: at(3), bookedAt: at(-1), wonAt: at(400) };
    const o = questionOutcome(send("m1", "L1"), replies, facts, outcome);
    assert.equal(o.progression, 1);
    assert.equal(o.booking, 0);
    assert.equal(o.win, 1);
  });
});

describe("the read model", () => {
  test("ranks by booking rate, never by response rate, and flags low samples", () => {
    // Family A: every lead replies, nobody books. Family B: few reply, more book.
    const sends: QuestionSend[] = [];
    const replies: InboundReply[] = [];
    const outcomes: LeadOutcome[] = [];
    for (let i = 0; i < 40; i++) {
      sends.push(send(`a${i}`, `A${i}`, { wordingFamily: "chatty" }));
      replies.push({ messageId: `ra${i}`, leadId: `A${i}`, at: at(1), classification: null });
      outcomes.push({ leadId: `A${i}`, qualifiedAt: null, bookedAt: null, wonAt: null });
      sends.push(send(`b${i}`, `B${i}`, { wordingFamily: "direct" }));
      if (i < 5) replies.push({ messageId: `rb${i}`, leadId: `B${i}`, at: at(1), classification: null });
      outcomes.push({ leadId: `B${i}`, qualifiedAt: null, bookedAt: i < 8 ? at(24) : null, wonAt: null });
    }
    sends.push(send("c0", "C0", { wordingFamily: "rare" }));

    const rows = computeQuestionPerformance({ slice: "wordingFamily", sends, replies, facts: [], outcomes });
    assert.deepEqual(rows.map((r) => r.key), ["direct", "chatty", "rare"]);
    assert.ok(rows[1].response.rate > rows[0].response.rate, "the more-replied family is still ranked second");
    assert.equal(rows[2].lowSample, true);
    assert.equal(rows[0].lowSample, false);
    assert.ok(rows[0].sent >= LOW_SAMPLE_N);
    // Wilson intervals, never a bare rate.
    assert.ok(rows[0].booking.low < rows[0].booking.rate && rows[0].booking.high > rows[0].booking.rate);
  });

  test("slices by position (5+ grouped) and by intent state", () => {
    const sends = [send("m1", "L1", { questionPosition: 1 }), send("m2", "L2", { questionPosition: 7 }), send("m3", "L3", { questionPosition: 9 })];
    const rows = computeQuestionPerformance({ slice: "position", sends, replies: [], facts: [], outcomes: [] });
    assert.deepEqual(rows.map((r) => [r.key, r.sent]).sort(), [["1", 1], ["5+", 2]]);
    const byState = computeQuestionPerformance({ slice: "intentState", sends, replies: [], facts: [], outcomes: [] });
    assert.equal(byState[0].key, "MEDIUM");
  });

  test("the server read is scoped by business_id on every table", () => {
    const source = readFileSync(new URL("../src/lib/analytics/question-performance-query.ts", import.meta.url), "utf8");
    const reads = source.match(/\.from\("[a-z_]+"\)/g) ?? [];
    const scoped = source.match(/\.eq\("business_id", businessId\)/g) ?? [];
    assert.ok(reads.length >= 5);
    assert.equal(scoped.length, reads.length);
    assert.match(source, /^import "server-only";/);
  });
});

describe("QUESTION_STRATEGY experiments (CD-19)", () => {
  const variants: ExperimentVariant[] = [
    { key: "A", label: "Library wording" },
    { key: "B", label: "Softer timing", questions: { "TIMING.START_WINDOW": { wordingFamily: "timing-soft", rendering: "Roughly when would suit you to start?" } } },
  ];

  test("the kind is registered", () => {
    assert.ok((EXPERIMENT_KINDS as readonly string[]).includes(QUESTION_STRATEGY_EXPERIMENT_KIND));
  });

  test("a valid question experiment has no problems", () => {
    assert.deepEqual(experimentProblems({ kind: "QUESTION_STRATEGY", holdoutPercent: 0, variants, minSamplePerArm: 100, primaryMetric: "BOOKING" }), []);
  });

  test("never optimises for replies", () => {
    const problems = experimentProblems({ kind: "QUESTION_STRATEGY", holdoutPercent: 0, variants, minSamplePerArm: 100, primaryMetric: "POSITIVE_REPLY" });
    assert.ok(problems.some((p) => /never on replies/.test(p)));
  });

  test("a variant must change a question or the strategy version", () => {
    const problems = experimentProblems({ kind: "QUESTION_STRATEGY", holdoutPercent: 0, variants: [variants[0], { key: "B", label: "Same" }], minSamplePerArm: 100 });
    assert.ok(problems.some((p) => /wording or the strategy version/.test(p)));
  });

  test("the arm's wording for a planned intent, and the library's for everything else", () => {
    const definition = { id: "exp-q", holdoutPercent: 0, variants };
    assert.deepEqual(variantQuestion(definition, "B", "TIMING.START_WINDOW"), { wordingFamily: "timing-soft", rendering: "Roughly when would suit you to start?" });
    assert.equal(variantQuestion(definition, "A", "TIMING.START_WINDOW"), null);
    assert.equal(variantQuestion(definition, "B", "BUDGET.RANGE"), null);
    assert.equal(variantQuestion(definition, "HOLDOUT", "TIMING.START_WINDOW"), null);
  });
});
