import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  askedDimension,
  forbiddenDimensions,
  leadAsked,
  qaFailures,
  runQuestionQa,
  type QaContext,
} from "../src/lib/qualification-intelligence/qa.ts";
import { QA_CODES, type QaCode } from "../src/lib/qualification-intelligence/types.ts";
import { validateResponse, type ValidationFacts } from "../src/lib/agent/validate.ts";

/**
 * Pre-send question QA (design 08 §16, §B.13): the 13 checks, each proven to
 * fire on its own, a clean draft proven to pass, and the wiring into the
 * validator's reject -> retry -> handover loop.
 */

const base: QaContext = {
  channel: "sms",
  stage: "QUALIFYING",
  intentState: "MEDIUM",
  engineVerdict: "PENDING",
  nbaAction: "ASK",
  plannedQuestion: { key: "TIMING.START_WINDOW", dimension: "TIMING", purpose: "DISCOVER" },
  dimensions: [
    { dimension: "PROBLEM", status: "CONFIRMED" },
    { dimension: "TIMING", status: "UNKNOWN", required: true },
    { dimension: "LOCATION", status: "INFERRED", material: false },
    { dimension: "BUDGET", status: "UNKNOWN" },
  ],
  forbiddenIntents: [],
  inbound: "Our current provider is far too slow.",
  recentOutbound: [],
  customerType: "B2B",
};

const CLEAN = "Sorry to hear that. When are you hoping to have someone new in place?";

function codes(draft: string, ctx: Partial<QaContext> = {}): QaCode[] {
  return runQuestionQa(draft, { ...base, ...ctx }).findings.filter((f) => f.severity === "REJECT").map((f) => f.code);
}

describe("question detection", () => {
  const cases: [string, string | null][] = [
    ["When are you hoping to get started?", "TIMING"],
    ["Which postcode is the property in?", "LOCATION"],
    ["Just to check, is it around 40 staff at the moment?", "COMPANY_SIZE"],
    ["Which agency are you using at the moment?", "CURRENT_SOLUTION"],
    ["Roughly what budget have you set aside for this?", "BUDGET"],
    ["Who else would be involved in choosing a provider?", "AUTHORITY"],
    ["Which tools would it need to integrate with?", "TECHNICAL_REQUIREMENTS"],
    ["How many people on your team would be using it?", "TEAM_SIZE"],
    ["Roughly how many orders do you ship each month?", "VOLUME"],
    ["Would Tuesday or Thursday suit you better?", "AVAILABILITY"],
    ["Do you already own a domain name?", null],
  ];
  for (const [sentence, expected] of cases) {
    test(`${sentence} -> ${expected}`, () => assert.equal(askedDimension(sentence), expected));
  }

  test("a lead question is recognised with or without a question mark", () => {
    assert.equal(leadAsked("Do you work with Shopify stores?"), true);
    assert.equal(leadAsked("How long does onboarding take"), true);
    assert.equal(leadAsked("Our current provider is far too slow."), false);
    assert.equal(leadAsked(null), false);
  });

  test("forbidden intent keys resolve to their dimension family, aliases included", () => {
    assert.deepEqual([...forbiddenDimensions(["BUDGET.RANGE", "SIZE.STAFF_AND_DEVICES"])].sort(), ["BUDGET", "COMPANY_SIZE"]);
  });
});

describe("the 13 checks", () => {
  test("a clean, planned, answer-first question passes every check", () => {
    const result = runQuestionQa(CLEAN, base);
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.deepEqual(result.asked, ["TIMING"]);
  });

  const each: { check: number; code: QaCode; draft: string; ctx?: Partial<QaContext> }[] = [
    { check: 1, code: "QA_UNPLANNED_QUESTION", draft: "Thanks. How many staff do you have?" },
    { check: 2, code: "QA_ASKS_KNOWN", draft: "Thanks. Where are you based?", ctx: { plannedQuestion: { key: "LOCATION.POSTCODE", dimension: "LOCATION", purpose: "DISCOVER" } } },
    { check: 3, code: "QA_OFF_PROFILE", draft: CLEAN, ctx: { plannedIntent: { appliesTo: { motions: ["ENTERPRISE"] }, stages: ["QUALIFYING"], channels: [] }, profile: { motion: "LOCAL_SERVICE" } } },
    { check: 4, code: "QA_FORBIDDEN_INTENT", draft: CLEAN, ctx: { forbiddenIntents: ["TIMING.START_WINDOW"] } },
    { check: 5, code: "QA_PREMATURE", draft: "Thanks. What budget have you set aside?", ctx: { stage: "NEW", dimensions: [{ dimension: "TIMING", status: "UNKNOWN" }], plannedQuestion: { key: "BUDGET.RANGE", dimension: "BUDGET", purpose: "DISCOVER" } } },
    { check: 6, code: "QA_INTRUSIVE", draft: "Thanks. Can I ask how old you are?", ctx: { plannedQuestion: null, nbaAction: null } },
    { check: 7, code: "QA_GENERIC", draft: "Thanks for that. How can I help?" },
    { check: 8, code: "STYLE_MULTIPLE_QUESTIONS", draft: "When do you want to start? And who else decides?" },
    { check: 8, code: "QA_FORM_LIKE", draft: "Which is the timeline: a) this month b) next month c) this quarter d) later?" },
    { check: 9, code: "QA_CHANNEL", draft: "**Quick one:** when are you hoping to start?" },
    { check: 9, code: "TOO_LONG", draft: `${"We can certainly help with that and have done so for many businesses like yours. ".repeat(12)}When would you like to start?` },
    { check: 10, code: "QA_IGNORES_LEAD", draft: "When are you hoping to start?", ctx: { inbound: "Do you work with Shopify stores?" } },
    { check: 11, code: "QA_QUESTION_FIRST", draft: "When are you hoping to start? We do work with Shopify stores.", ctx: { inbound: "Do you work with Shopify stores?" } },
    { check: 12, code: "QA_SHOULD_CLOSE", draft: "Happy to. Before we do, when are you hoping to start?", ctx: { nbaAction: "CTA_BOOK", plannedQuestion: null, intentState: "BOOKING_READY" } },
    { check: 13, code: "QA_REPEAT", draft: CLEAN, ctx: { recentOutbound: [{ dimension: "TIMING", answered: false }, { dimension: "TIMING", answered: false }] } },
  ];

  for (const item of each) {
    test(`check ${item.check}: ${item.code}`, () => {
      const found = codes(item.draft, item.ctx);
      assert.ok(found.includes(item.code), `${item.code} not in ${found.join(", ")}`);
    });
  }

  test("every QA code is exercised", () => {
    assert.deepEqual([...new Set(each.map((e) => e.code))].sort(), [...QA_CODES].sort());
  });

  test("a VERIFY of an inferred material fact is not 'asking the known'", () => {
    const ctx: Partial<QaContext> = {
      plannedQuestion: { key: "SIZE.STAFF_AND_DEVICES", dimension: "COMPANY_SIZE", purpose: "VERIFY" },
      dimensions: [{ dimension: "COMPANY_SIZE", status: "INFERRED", material: true, required: true }],
    };
    assert.deepEqual(codes("Thanks. Just to check, is it around 40 staff at the moment?", ctx), []);
  });

  test("one sticky re-ask is a warning, a second is a rejection", () => {
    const once = runQuestionQa(CLEAN, { ...base, recentOutbound: [{ dimension: "TIMING", answered: false }] });
    assert.equal(once.ok, true);
    assert.ok(once.findings.some((f) => f.code === "QA_REPEAT" && f.severity === "WARN"));
  });

  test("CTA_BOOK may carry its one gating question", () => {
    const ctx: Partial<QaContext> = {
      nbaAction: "CTA_BOOK",
      intentState: "BOOKING_READY",
      stage: "CLOSING",
      plannedQuestion: { key: "LOCATION.POSTCODE", dimension: "LOCATION", purpose: "DISQUALIFY_CHECK" },
      dimensions: [{ dimension: "LOCATION", status: "UNKNOWN", required: true, material: true }],
      inbound: "Can someone come out this week?",
    };
    assert.deepEqual(codes("Happy to arrange that. Which postcode is the property in?", ctx), []);
  });

  test("a booking-slot question is not qualifying under a CTA", () => {
    assert.deepEqual(codes("Happy to set that up. Would Tuesday or Thursday suit you better?", { nbaAction: "CTA_BOOK", plannedQuestion: null, intentState: "BOOKING_READY", inbound: "Let's book a call." }), []);
  });

  test("personal finance is intrusive on B2B and allowed as a word on B2C only by the protected list", () => {
    assert.ok(codes("Thanks. What is your personal income?", { nbaAction: null, plannedQuestion: null }).includes("QA_INTRUSIVE"));
    assert.ok(!codes("Thanks. What is your personal income?", { nbaAction: null, plannedQuestion: null, customerType: "B2C" }).includes("QA_INTRUSIVE"));
  });

  test("the engine OFF (no NBA) never flags an unplanned question", () => {
    assert.ok(!codes("Thanks. How many staff do you have?", { nbaAction: null, plannedQuestion: null }).includes("QA_UNPLANNED_QUESTION"));
  });
});

describe("wired into the validator's retry loop", () => {
  const facts: ValidationFacts = {
    channel: "sms",
    businessName: "Acme",
    publishedPriceText: [],
    confirmedSlots: [],
    bookingConfirmed: false,
    allowedUrls: [],
    serviceAreaConfirmed: false,
  };

  test("QA rejections become validation failures with a correction", () => {
    const result = validateResponse("Thanks. How many staff do you have?", {
      ...facts,
      extraChecks: (body) => qaFailures(runQuestionQa(body, base)),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      const failure = result.failures.find((f) => f.code === "QA_UNPLANNED_QUESTION");
      assert.ok(failure);
      assert.match(failure.correction, /one question in the strategy block/);
    }
  });

  test("a clean draft passes the validator with QA on", () => {
    const result = validateResponse(CLEAN, { ...facts, extraChecks: (body) => qaFailures(runQuestionQa(body, base)) });
    assert.equal(result.ok, true);
  });
});
