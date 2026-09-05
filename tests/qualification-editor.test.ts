import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  blankQuestion,
  newDraftKey,
  publishDraftSchema,
  serviceScopeSummary,
  slugifyOptionValue,
  toPublishPayload,
  validateDraft,
  type DraftQuestion,
} from "../src/lib/qualification/draft.ts";
import {
  answerValues,
  describeRouting,
  readRouting,
  writeAllowedPrefixes,
  writeNumberRange,
  writeRouting,
} from "../src/lib/qualification/routing.ts";
import { evaluateDraft } from "../src/lib/qualification/preview.ts";
import type { ServiceRef } from "../src/lib/qualification/types.ts";

const SERVICES: ServiceRef[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Roof Repair", active: true },
  { id: "22222222-2222-4222-8222-222222222222", name: "New Roof", active: true },
  { id: "33333333-3333-4333-8333-333333333333", name: "Guttering", active: true },
];

const AREA = { allowedPrefixes: ["BH1", "BH2", "BH3", "BH4"], blockedPrefixes: [] };

function question(overrides: Partial<DraftQuestion> = {}): DraftQuestion {
  return { ...blankQuestion(), key: newDraftKey(), ...overrides };
}

/** The four reference questions from the design. */
function referenceSet(): DraftQuestion[] {
  const owner = question({
    questionText: "Are you the property owner?",
    responseType: "yes_no",
    required: true,
  });
  const postcode = question({
    questionText: "What postcode is the property in?",
    responseType: "postcode",
    required: true,
  });
  const timing = question({
    questionText: "When would you like the work?",
    responseType: "timing",
    required: true,
    options: [
      { key: "t1", label: "ASAP", value: "asap" },
      { key: "t2", label: "Within 30 days", value: "within_30_days" },
      { key: "t3", label: "Researching only", value: "researching" },
    ],
  });
  const service = question({
    questionText: "What service do you need?",
    responseType: "single_choice",
    required: false,
    options: [
      { key: "s1", label: "Roof Repair", value: "roof_repair" },
      { key: "s2", label: "New Roof", value: "new_roof" },
      { key: "s3", label: "Guttering", value: "guttering" },
    ],
  });

  return [
    { ...owner, rules: writeRouting(owner, { yes: "continue", no: "not_qualified" }) },
    { ...postcode, rules: writeAllowedPrefixes(postcode, AREA.allowedPrefixes) },
    {
      ...timing,
      rules: writeRouting(timing, {
        asap: "continue",
        within_30_days: "continue",
        researching: "review",
      }),
    },
    service,
  ];
}

describe("draft validation", () => {
  test("the reference set is valid", () => {
    assert.deepEqual(validateDraft(referenceSet(), SERVICES), []);
  });

  test("a blank question is invalid until it is written", () => {
    const issues = validateDraft([blankQuestion()], SERVICES);
    assert.ok(issues.some((i) => i.message.includes("needs a question")));
  });

  test("a choice question needs at least two options", () => {
    const issues = validateDraft(
      [
        question({
          questionText: "Pick one",
          responseType: "single_choice",
          options: [{ key: "a", label: "Only", value: "only" }],
        }),
      ],
      SERVICES,
    );
    assert.ok(issues.some((i) => i.message.includes("two options")));
  });

  test("an option with no label is invalid", () => {
    const issues = validateDraft(
      [
        question({
          questionText: "Pick one",
          responseType: "single_choice",
          options: [
            { key: "a", label: "", value: "a" },
            { key: "b", label: "B", value: "b" },
          ],
        }),
      ],
      SERVICES,
    );
    assert.ok(issues.some((i) => i.message.includes("no label")));
  });

  test("duplicate option values are invalid", () => {
    const issues = validateDraft(
      [
        question({
          questionText: "Pick one",
          responseType: "single_choice",
          options: [
            { key: "a", label: "A", value: "same" },
            { key: "b", label: "B", value: "SAME" },
          ],
        }),
      ],
      SERVICES,
    );
    assert.ok(issues.some((i) => i.message.includes("same value")));
  });

  test("a question scoped to a deleted service is invalid", () => {
    const issues = validateDraft(
      [
        question({
          questionText: "Still here?",
          serviceId: "99999999-9999-4999-8999-999999999999",
        }),
      ],
      SERVICES,
    );
    assert.ok(issues.some((i) => i.message.includes("no longer exists")));
  });
});

describe("answer routing", () => {
  test("continue needs no rule at all", () => {
    const q = question({ responseType: "yes_no" });
    assert.deepEqual(writeRouting(q, { yes: "continue", no: "continue" }), []);
  });

  test("a rejection round-trips through the stored rule shape", () => {
    const q = question({ responseType: "yes_no" });
    const withRules = { ...q, rules: writeRouting(q, { yes: "continue", no: "not_qualified" }) };
    assert.deepEqual(readRouting(withRules), { yes: "continue", no: "not_qualified" });
  });

  test("rejections and reviews become separate rules", () => {
    const q = question({
      responseType: "timing",
      options: [
        { key: "a", label: "ASAP", value: "asap" },
        { key: "b", label: "Later", value: "later" },
        { key: "c", label: "Researching", value: "researching" },
      ],
    });
    const rules = writeRouting(q, {
      asap: "continue",
      later: "not_qualified",
      researching: "review",
    });
    assert.equal(rules.length, 2);
    assert.equal(rules.find((r) => r.result === "hard_fail")?.comparisonValue[0], "later");
    assert.equal(rules.find((r) => r.result === "review")?.comparisonValue[0], "researching");
  });

  test("a rule this editor does not model is preserved", () => {
    const q = question({ responseType: "number" });
    const withRange = { ...q, rules: writeNumberRange(q, { min: "5", max: "" }) };
    const after = writeRouting(withRange, {});
    assert.ok(after.some((rule) => rule.operator === "gte"));
  });

  test("the row summary reads the way the design does", () => {
    const [owner, postcode, timing, service] = referenceSet();
    assert.deepEqual(describeRouting(owner), {
      kind: "routing",
      parts: ["Yes → continue", "No → not qualified"],
    });
    assert.deepEqual(describeRouting(postcode), {
      kind: "validation",
      parts: ["Allowed prefixes: BH1, BH2, BH3, BH4"],
    });
    assert.deepEqual(describeRouting(timing), {
      kind: "routing",
      parts: ["ASAP → continue", "Within 30 days → continue", "Researching only → review"],
    });
    assert.deepEqual(describeRouting(service), {
      kind: "options",
      parts: ["Roof Repair", "New Roof", "Guttering"],
    });
  });

  test("yes/no answers are fixed regardless of options", () => {
    assert.deepEqual(
      answerValues(question({ responseType: "yes_no" })).map((v) => v.value),
      ["yes", "no"],
    );
  });
});

describe("live preview evaluation", () => {
  const questions = referenceSet();
  const service = SERVICES[0].id;

  function run(answers: Record<string, string>) {
    return evaluateDraft({
      questions,
      answers,
      serviceId: service,
      services: SERVICES,
      serviceArea: AREA,
    });
  }

  const [owner, postcode, timing, choice] = questions;

  test("an incomplete set is PENDING, not qualified", () => {
    assert.equal(run({ [owner.key]: "yes" }).result, "PENDING");
  });

  test("the reference answers qualify", () => {
    const out = run({
      [owner.key]: "yes",
      [postcode.key]: "BH2 6AA",
      [timing.key]: "within_30_days",
      [choice.key]: "roof_repair",
    });
    assert.equal(out.result, "QUALIFIED");
  });

  test("a non-owner is not qualified", () => {
    const out = run({
      [owner.key]: "no",
      [postcode.key]: "BH2 6AA",
      [timing.key]: "asap",
    });
    assert.equal(out.result, "NOT_QUALIFIED");
  });

  test("researching only goes to review", () => {
    const out = run({
      [owner.key]: "yes",
      [postcode.key]: "BH2 6AA",
      [timing.key]: "researching",
    });
    assert.equal(out.result, "REVIEW");
  });

  test("a postcode outside the allowed prefixes is not qualified", () => {
    const out = run({
      [owner.key]: "yes",
      [postcode.key]: "M1 1AA",
      [timing.key]: "asap",
    });
    assert.equal(out.result, "NOT_QUALIFIED");
  });

  test("an unmatched reply to a required question waits rather than guessing", () => {
    // Required-completeness is checked before the unmatched-value pass, so an
    // answer the engine cannot match to an option leaves the question
    // effectively unanswered. It is never guessed at either way.
    const out = run({
      [owner.key]: "yes",
      [postcode.key]: "BH2 6AA",
      [timing.key]: "sometime next century",
    });
    assert.equal(out.result, "PENDING");
  });

  test("an unmatched reply to an optional question goes to review", () => {
    const out = run({
      [owner.key]: "yes",
      [postcode.key]: "BH2 6AA",
      [timing.key]: "asap",
      [choice.key]: "something we do not offer",
    });
    assert.equal(out.result, "REVIEW");
  });

  test("a rejection outranks a review", () => {
    const out = run({
      [owner.key]: "no",
      [postcode.key]: "BH2 6AA",
      [timing.key]: "researching",
    });
    assert.equal(out.result, "NOT_QUALIFIED");
  });

  test("a question scoped to another service is not asked", () => {
    const scoped = [
      ...questions,
      question({
        questionText: "Gutter length in metres?",
        responseType: "number",
        required: true,
        serviceId: SERVICES[2].id,
      }),
    ];
    const out = evaluateDraft({
      questions: scoped,
      answers: {
        [owner.key]: "yes",
        [postcode.key]: "BH2 6AA",
        [timing.key]: "asap",
      },
      serviceId: service,
      services: SERVICES,
      serviceArea: AREA,
    });
    assert.equal(out.result, "QUALIFIED");
  });

  test("an inactive service is not qualified", () => {
    const out = evaluateDraft({
      questions,
      answers: { [owner.key]: "yes", [postcode.key]: "BH2 6AA", [timing.key]: "asap" },
      serviceId: SERVICES[0].id,
      services: [{ ...SERVICES[0], active: false }],
      serviceArea: AREA,
    });
    assert.equal(out.result, "NOT_QUALIFIED");
  });
});

describe("service scope summary", () => {
  test("questions applying to all services give every service full coverage", () => {
    const rows = serviceScopeSummary(referenceSet(), SERVICES);
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.count, 4);
      assert.equal(row.percent, 100);
    }
  });

  test("a scoped question only counts towards its own service", () => {
    const questions = [
      ...referenceSet(),
      question({ questionText: "Gutter length?", serviceId: SERVICES[2].id }),
    ];
    const rows = serviceScopeSummary(questions, SERVICES);
    assert.equal(rows.find((r) => r.name === "Guttering")?.count, 5);
    assert.equal(rows.find((r) => r.name === "Roof Repair")?.count, 4);
    assert.equal(rows.find((r) => r.name === "All services")?.percent, 80);
  });

  test("a switched-off question is not counted", () => {
    const rows = serviceScopeSummary(
      referenceSet().map((q, i) => (i === 0 ? { ...q, active: false } : q)),
      SERVICES,
    );
    assert.equal(rows[0].count, 3);
  });

  test("an empty draft reports zero rather than dividing by zero", () => {
    const rows = serviceScopeSummary([], SERVICES);
    assert.ok(rows.every((row) => row.percent === 0));
  });
});

describe("publish payload", () => {
  test("the wire shape drops React keys and passes the schema", () => {
    const payload = toPublishPayload(referenceSet(), "2026-09-05T12:00:00.000Z");
    const parsed = publishDraftSchema.safeParse(payload);
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
    assert.equal(parsed.data?.questions.length, 4);
  });

  test("options are dropped for a type that does not use them", () => {
    const q = question({
      questionText: "Any notes?",
      responseType: "text",
      options: [{ key: "a", label: "Stale", value: "stale" }],
    });
    const [sent] = toPublishPayload([q], null).questions;
    assert.deepEqual(sent?.options, []);
  });

  test("empty rule values are stripped rather than sent blank", () => {
    const q = question({
      questionText: "Are you the owner?",
      responseType: "yes_no",
      rules: [
        {
          key: "r1",
          id: null,
          operator: "not_in",
          comparisonValue: ["no", "  "],
          result: "hard_fail",
          priority: 0,
          active: true,
        },
      ],
    });
    const [sent] = toPublishPayload([q], null).questions;
    assert.deepEqual(sent?.rules?.[0]?.comparisonValue, ["no"]);
  });

  test("a question over the length limit is rejected by the schema", () => {
    const payload = toPublishPayload(
      [question({ questionText: "x".repeat(400) })],
      null,
    );
    assert.equal(publishDraftSchema.safeParse(payload).success, false);
  });

  test("option values are machine-stable slugs", () => {
    assert.equal(slugifyOptionValue("Roof Repair"), "roof_repair");
    assert.equal(slugifyOptionValue("  Within 30 days!  "), "within_30_days");
    assert.equal(slugifyOptionValue("!!!"), "option");
  });
});
