import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { gradeQuestion } from "../src/lib/qualification-intelligence/grade.ts";
import type { QaContext } from "../src/lib/qualification-intelligence/qa.ts";
import {
  QUESTION_GRADE_CRITERIA,
  QUESTION_GRADE_PASS,
  type QuestionGradeCriterion,
} from "../src/lib/qualification-intelligence/types.ts";

/**
 * The /100 question grader (design 08 §24).
 *
 * tests/fixtures/question-grades.json holds held-out labels written before
 * grade.ts existed. The grader must agree with every critical-failure label and
 * every pass/fail label; a disagreement is a logic bug to fix in grade.ts, never
 * a label to edit. The mutation suite proves each criterion can fail on its own.
 */

type FixtureCase = {
  id: string;
  channel: QaContext["channel"];
  stage: QaContext["stage"];
  intentState: QaContext["intentState"];
  engineVerdict: QaContext["engineVerdict"];
  nba: { action: NonNullable<QaContext["nbaAction"]>; dimension: string | null; purpose: string | null; key: string | null; rendering?: string };
  dimensions: Record<string, { status: "CONFIRMED" | "INFERRED" | "UNKNOWN" | "CONFLICTING"; required?: boolean; material?: boolean }>;
  forbiddenIntents?: string[];
  recentOutbound?: { dimension: string | null; answered: boolean }[];
  customerType?: "B2B" | "B2C" | "BOTH";
  inbound: string | null;
  draft: string;
  label: { pass: boolean; critical: string[] };
};

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/question-grades.json", import.meta.url), "utf8"),
) as { cases: FixtureCase[] };

export function contextFor(c: FixtureCase): QaContext {
  return {
    channel: c.channel,
    stage: c.stage,
    intentState: c.intentState,
    engineVerdict: c.engineVerdict,
    nbaAction: c.nba.action,
    plannedQuestion:
      c.nba.dimension && c.nba.key
        ? {
            key: c.nba.key,
            dimension: c.nba.dimension as never,
            purpose: (c.nba.purpose ?? "DISCOVER") as never,
            rendering: c.nba.rendering ?? null,
          }
        : null,
    dimensions: Object.entries(c.dimensions).map(([dimension, v]) => ({
      dimension: dimension as never,
      status: v.status,
      required: v.required ?? false,
      material: v.material,
    })),
    forbiddenIntents: c.forbiddenIntents ?? [],
    inbound: c.inbound,
    recentOutbound: (c.recentOutbound ?? []) as never,
    customerType: c.customerType ?? "B2B",
  };
}

describe("grader contract", () => {
  test("weights sum to 100 and the pass mark is 80", () => {
    const sum = Object.values(QUESTION_GRADE_CRITERIA).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100);
    assert.equal(QUESTION_GRADE_PASS, 80);
  });

  test("a draft with no question is not graded", () => {
    const c = fixture.cases[0];
    assert.equal(gradeQuestion("Thanks, that is really helpful.", contextFor(c)), null);
  });
});

/**
 * Labels the grader does not reach, recorded rather than tuned away. Each is a
 * limit of the contract's fixed weights, not of the label, and names what
 * stops the question being sent anyway.
 */
const KNOWN_DISAGREEMENTS: Record<string, string> = {};

describe("held-out labels (tests/fixtures/question-grades.json)", () => {
  const results = fixture.cases.map((c) => ({ c, grade: gradeQuestion(c.draft, contextFor(c)) }));

  test("the fixture has at least 30 labelled questions", () => {
    assert.ok(fixture.cases.length >= 30, `${fixture.cases.length}`);
  });

  for (const { c, grade } of results) {
    const known = KNOWN_DISAGREEMENTS[c.id];
    test(`${c.id}: ${c.label.pass ? "passes" : "fails"}${c.label.critical.length ? ` (${c.label.critical.join(", ")})` : ""}`, known ? { todo: known } : {}, () => {
      assert.ok(grade, "every fixture draft asks a question");
      assert.deepEqual([...grade.criticalFailures].sort(), [...c.label.critical].sort(), JSON.stringify(grade));
      assert.equal(grade.total >= QUESTION_GRADE_PASS, c.label.pass, `total ${grade.total}: ${JSON.stringify(grade.criteria)}`);
    });
  }

  test("report: mean grade and the number below the pass mark", () => {
    const totals = results.map((r) => r.grade!.total);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const below = totals.filter((t) => t < QUESTION_GRADE_PASS).length;
    const labelledFail = fixture.cases.filter((c) => !c.label.pass && !KNOWN_DISAGREEMENTS[c.id]).length;
    const agree = results.filter((r) => (r.grade!.total >= QUESTION_GRADE_PASS) === r.c.label.pass).length;
    // Printed for the release report (design 08 §C.5 "question grading").
    console.log(
      `[question-grader] n=${totals.length} mean=${mean.toFixed(1)} belowPass=${below} ` +
        `agreement=${agree}/${totals.length} knownDisagreements=${Object.keys(KNOWN_DISAGREEMENTS).length}`,
    );
    assert.equal(below, labelledFail);
  });
});

describe("mutation: every criterion can fail on its own", () => {
  // A baseline that earns full marks on every criterion.
  const base: QaContext = {
    channel: "email",
    stage: "QUALIFYING",
    intentState: "MEDIUM",
    engineVerdict: "PENDING",
    nbaAction: "ASK",
    plannedQuestion: { key: "USE_CASE.PRIMARY", dimension: "USE_CASE", purpose: "DISCOVER" },
    dimensions: [
      { dimension: "PROBLEM", status: "CONFIRMED" },
      { dimension: "USE_CASE", status: "UNKNOWN", required: true },
    ],
    forbiddenIntents: [],
    inbound: "Our sales team spends hours on admin.",
    recentOutbound: [],
    customerType: "B2B",
  };
  const baseDraft = "Thanks, that helps. What would you mainly want it to do for the team?";
  const full = gradeQuestion(baseDraft, base)!;

  test("the baseline scores full marks (friction: the dimension's own intrinsic cost only)", () => {
    for (const [criterion, weight] of Object.entries(QUESTION_GRADE_CRITERIA)) {
      if (criterion === "friction") continue;
      assert.equal(full.criteria[criterion as QuestionGradeCriterion], weight, `${criterion}: ${JSON.stringify(full.criteria)}`);
    }
    // USE_CASE carries a library friction of 0.15: 8.5 of 10, and nothing else deducted.
    assert.equal(full.criteria.friction, 8.5);
    assert.ok(full.total >= 98, `${full.total}`);
  });

  const mutations: { criterion: QuestionGradeCriterion; draft?: string; ctx?: Partial<QaContext> }[] = [
    { criterion: "necessity", ctx: { plannedQuestion: { key: "TIMING.START_WINDOW", dimension: "TIMING", purpose: "DISCOVER" }, dimensions: [...base.dimensions, { dimension: "TIMING", status: "UNKNOWN", required: true }] } },
    { criterion: "notKnown", ctx: { dimensions: [{ dimension: "PROBLEM", status: "CONFIRMED" }, { dimension: "USE_CASE", status: "CONFLICTING", required: true }] } },
    { criterion: "stageFit", ctx: { plannedIntent: { appliesTo: {}, stages: ["CLOSING"], channels: [] } } },
    { criterion: "intentFit", ctx: { intentState: "NOT_NOW" } },
    { criterion: "friction", ctx: { recentOutbound: [{ dimension: "USE_CASE", answered: false }] } },
    { criterion: "channelNaturalness", draft: `Thanks, that helps. ${"We have read everything you sent over and it is useful. ".repeat(40)}What would you mainly want it to do for the team?` },
    { criterion: "responsiveness", ctx: { inbound: "Do you integrate with HubSpot?" }, draft: "What would you mainly want it to do for the team? Thanks, that helps." },
    { criterion: "specificity", ctx: { plannedQuestion: { key: "custom:6f1d8c1e-2b1a-4c1e-9d1e-1a2b3c4d5e6f", dimension: "UNMAPPED", purpose: "DISCOVER", rendering: "Can you tell me more about what you need?" } }, draft: "Thanks, that helps. Can you tell me more about what you need?" },
    { criterion: "singleFocus", draft: "Thanks, that helps. What would you mainly want it to do for the team, and what is your deadline?" },
    { criterion: "progression", ctx: { dimensions: [{ dimension: "PROBLEM", status: "CONFIRMED" }, { dimension: "USE_CASE", status: "UNKNOWN", required: false }] } },
  ];

  for (const m of mutations) {
    test(`${m.criterion} drops below full marks`, () => {
      const grade = gradeQuestion(m.draft ?? baseDraft, { ...base, ...m.ctx })!;
      assert.ok(grade, "still a question");
      assert.ok(
        grade.criteria[m.criterion] < QUESTION_GRADE_CRITERIA[m.criterion],
        `${m.criterion} stayed at ${grade.criteria[m.criterion]}: ${JSON.stringify(grade.criteria)}`,
      );
    });
  }

  test("every criterion has a mutation", () => {
    assert.deepEqual(
      mutations.map((m) => m.criterion).sort(),
      Object.keys(QUESTION_GRADE_CRITERIA).sort(),
    );
  });

  const criticalMutations: { failure: string; draft?: string; ctx?: Partial<QaContext> }[] = [
    { failure: "ASKS_KNOWN_DIMENSION", ctx: { dimensions: [{ dimension: "USE_CASE", status: "CONFIRMED" }] } },
    { failure: "ASKS_FORBIDDEN_INTENT", ctx: { forbiddenIntents: ["USE_CASE.PRIMARY"] } },
    { failure: "MULTIPLE_QUESTIONS", draft: "What would you mainly want it to do for the team? When do you want to start?" },
    { failure: "QUALIFIES_WHEN_BOOKING_READY", ctx: { intentState: "BOOKING_READY", nbaAction: "CTA_BOOK", plannedQuestion: null } },
    { failure: "PURSUES_NEGATIVE_OR_DISQUALIFIED", ctx: { intentState: "NEGATIVE", nbaAction: "NO_ACTION" } },
  ];
  for (const m of criticalMutations) {
    test(`critical ${m.failure} grades the question 0`, () => {
      const grade = gradeQuestion(m.draft ?? baseDraft, { ...base, ...m.ctx })!;
      assert.ok(grade.criticalFailures.includes(m.failure as never), JSON.stringify(grade));
      assert.equal(grade.total, 0);
    });
  }
});
