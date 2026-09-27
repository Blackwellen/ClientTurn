import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  candidatesForDepth,
  selectNextQuestion,
  type QuestionRecord,
} from "../src/lib/qualification/next-question.ts";
import { chooseMethod, eligibleMethods, type MethodInput } from "../src/lib/sales-library/method-router.ts";
import { decideSpend } from "../src/lib/ai/budget.ts";
import { buildTierConfig, type TierConfig } from "../src/lib/ai/tiers.ts";
import {
  AGENT_CONFIDENCE,
  confidenceDecision,
  confidenceVerdictForTolerance,
  handoverFloor,
} from "../src/lib/agent/types.ts";
import {
  buildOfferCard,
  EXAMPLE_BAD_SECTION,
  EXAMPLE_GOOD_SECTION,
  type OfferCardInput,
} from "../src/lib/agent/offer-card.ts";
import { SALES_METHODS, SALES_MOTIONS } from "../src/lib/sales-library/types.ts";

/**
 * Core Revenue Engine gaps (coverage tracker rows 7/8, 26, 48, 51, 61-63, 74
 * and the leftovers). Pure logic only: every module here is imported with its
 * `.ts` extension and touches no database.
 */

/* ======================================================================
 * 1. Stored "AI & selling" preferences now change behaviour (§74)
 * ==================================================================== */

function q(id: string, questionText: string, position: number, extra: Partial<QuestionRecord> = {}): QuestionRecord {
  return { id, questionText, position, responseType: "text", required: false, serviceId: null, options: [], ...extra };
}

// BOOK_MEETING_B2B threshold: USE_CASE, plus one of TIMING / TEAM_SIZE / COMPANY_SIZE.
const USE_CASE = q("q-use", "What would you mainly want it to do for you?", 1, { required: true });
const TEAM = q("q-team", "How many people would be using it?", 2, { responseType: "number" });
const CURRENT = q("q-current", "What are you currently using for this?", 3);
const BUDGET = q("q-budget", "Do you have a budget range in mind?", 4);
const B2B = [USE_CASE, TEAM, CURRENT, BUDGET];

describe("qualification depth moves the stopping point", () => {
  const answered = [{ questionId: "q-use", answerValue: "lead follow-up" }];

  test("STANDARD (and absent): stops once the motion threshold is met", () => {
    const met = [...answered, { questionId: "q-team", answerValue: "4" }];
    for (const depth of [undefined, "STANDARD" as const]) {
      const result = selectNextQuestion({ questions: B2B, answers: met, serviceId: null, motion: "BOOK_MEETING_B2B", depth });
      assert.equal(result.thresholdMet, true);
      assert.equal(result.question, null);
      assert.equal(result.stopReason, "THRESHOLD_MET");
    }
  });

  test("THOROUGH: keeps asking optional questions after the threshold", () => {
    const met = [...answered, { questionId: "q-team", answerValue: "4" }];
    const result = selectNextQuestion({ questions: B2B, answers: met, serviceId: null, motion: "BOOK_MEETING_B2B", depth: "THOROUGH" });
    assert.equal(result.thresholdMet, true);
    assert.ok(result.question, "a question is still asked");
    assert.ok(["q-current", "q-budget"].includes(result.question!.id));
  });

  test("LIGHT: before the threshold, only questions that fill a missing threshold dimension", () => {
    const light = selectNextQuestion({ questions: B2B, answers: answered, serviceId: null, motion: "BOOK_MEETING_B2B", depth: "LIGHT" });
    assert.equal(light.thresholdMet, false);
    assert.deepEqual(light.ranked.map((entry) => entry.questionId), ["q-team"]);
    const standard = selectNextQuestion({ questions: B2B, answers: answered, serviceId: null, motion: "BOOK_MEETING_B2B", depth: "STANDARD" });
    assert.ok(standard.ranked.length > light.ranked.length, "STANDARD ranks more than LIGHT");
  });

  test("required questions survive every depth", () => {
    const unknown = [
      { question: { required: true }, dimension: null },
      { question: { required: false }, dimension: "BUDGET" as const },
    ];
    for (const depth of ["LIGHT", "STANDARD", "THOROUGH"] as const) {
      const kept = candidatesForDepth(unknown, { depth, hasMotion: true, thresholdMet: true, missing: [] });
      assert.ok(kept.some((entry) => entry.question.required), depth);
    }
  });

  test("LIGHT with no mapped question falls back rather than stopping short", () => {
    const unknown = [{ question: { required: false }, dimension: null }];
    const kept = candidatesForDepth(unknown, { depth: "LIGHT", hasMotion: true, thresholdMet: false, missing: ["USE_CASE"] });
    assert.equal(kept.length, 1);
  });

  test("no motion: every depth behaves as STANDARD", () => {
    const results = (["LIGHT", "STANDARD", "THOROUGH"] as const).map((depth) =>
      selectNextQuestion({ questions: B2B, answers: answered, serviceId: null, depth }).ranked.map((entry) => entry.questionId),
    );
    assert.deepEqual(results[0], results[1]);
    assert.deepEqual(results[2], results[1]);
  });
});

describe("preferred methods bias the router without breaking hard rules", () => {
  const base: MethodInput = { motion: "BOOK_MEETING_B2B", dealSizeBand: "SMALL", direction: "INBOUND", stage: "QUALIFYING" };

  test("no preference: unchanged default", () => {
    assert.equal(chooseMethod(base).method, "SIMPLE_QUALIFICATION");
    assert.equal(chooseMethod({ ...base, preferredMethods: [] }).method, "SIMPLE_QUALIFICATION");
  });

  test("an eligible preference wins", () => {
    const decision = chooseMethod({ ...base, preferredMethods: ["SPIN"] });
    assert.equal(decision.method, "SPIN");
    assert.match(decision.reason, /Workspace preference/);
  });

  test("MEDDPICC is never chosen outside ENTERPRISE, whatever the preference", () => {
    for (const motion of SALES_MOTIONS) {
      if (motion === "ENTERPRISE") continue;
      const decision = chooseMethod({ ...base, motion, dealSizeBand: "ENTERPRISE", preferredMethods: ["MEDDPICC"] });
      assert.notEqual(decision.method, "MEDDPICC", motion);
    }
  });

  test("CHALLENGER_INSIGHT needs an approved insight, whatever the preference", () => {
    assert.notEqual(chooseMethod({ ...base, preferredMethods: ["CHALLENGER_INSIGHT"] }).method, "CHALLENGER_INSIGHT");
    assert.equal(
      chooseMethod({ ...base, preferredMethods: ["CHALLENGER_INSIGHT"], hasApprovedInsight: true }).method,
      "CHALLENGER_INSIGHT",
    );
  });

  test("an ineligible-only preference keeps the default and says so", () => {
    const decision = chooseMethod({ ...base, motion: "LOCAL_SERVICE", preferredMethods: ["PLG", "MEDDPICC"] });
    assert.equal(decision.method, "SIMPLE_QUALIFICATION");
    assert.match(decision.reason, /do not fit this motion/);
  });

  test("preference order is respected among eligible methods", () => {
    const decision = chooseMethod({
      ...base,
      hasApprovedInsight: true,
      preferredMethods: ["MEDDPICC", "CHALLENGER_INSIGHT", "SPIN"],
    });
    assert.equal(decision.method, "CHALLENGER_INSIGHT");
  });

  test("an objection turn still narrows the style to one direct question", () => {
    const decision = chooseMethod({ ...base, stage: "OBJECTION", preferredMethods: ["SPIN"] });
    assert.equal(decision.method, "SPIN");
    assert.equal(decision.questionStyle, "ONE_DIRECT_QUESTION");
  });

  test("eligibility matrix: every motion admits only methods from its rules", () => {
    for (const motion of SALES_MOTIONS) {
      const eligible = eligibleMethods({ ...base, motion, hasApprovedInsight: true });
      for (const method of eligible) assert.ok((SALES_METHODS as readonly string[]).includes(method));
      if (motion !== "ENTERPRISE") assert.ok(!eligible.includes("MEDDPICC"), motion);
      if (motion !== "SAAS_SELF_SERVE") assert.ok(!eligible.includes("PLG"), motion);
      if (motion !== "ECOMMERCE_DIRECT") assert.ok(!eligible.includes("TRANSACTIONAL"), motion);
    }
  });
});

describe("research depth moves research-task ceilings only", () => {
  const WIDE: TierConfig = buildTierConfig(
    [
      { tier: 3, provider: "azure_openai", deploymentAlias: "mini", deploymentName: "gpt-big", inputPricePer1m: 2, cachedInputPricePer1m: 0.2, outputPricePer1m: 10, enabled: true },
    ],
    [
      { taskType: "research_summary", defaultTier: 2, allowedTiers: [1, 2, 3] },
      { taskType: "reply_generation", defaultTier: 2, allowedTiers: [1, 2, 3] },
    ],
  );

  test("STANDARD and absent: the default tier", () => {
    assert.equal(decideSpend({ taskType: "research_summary", config: WIDE, remaining: {} }).decision, "TIER_2");
    assert.equal(
      decideSpend({ taskType: "research_summary", config: WIDE, remaining: {}, researchDepth: "STANDARD" }).decision,
      "TIER_2",
    );
  });

  test("LIGHT: the cheapest allowed tier", () => {
    const result = decideSpend({ taskType: "research_summary", config: WIDE, remaining: {}, researchDepth: "LIGHT" });
    assert.equal(result.decision, "TIER_1");
    assert.equal(result.reason, "RESEARCH_DEPTH_LIGHT");
  });

  test("DEEP: one tier above the default when budgets allow", () => {
    const result = decideSpend({ taskType: "research_summary", config: WIDE, remaining: {}, researchDepth: "DEEP" });
    assert.equal(result.decision, "TIER_3");
    assert.equal(result.reason, "RESEARCH_DEPTH_DEEP");
  });

  test("DEEP never breaks a budget: an exhausted workspace ceiling falls back", () => {
    const result = decideSpend({
      taskType: "research_summary",
      config: WIDE,
      remaining: { WORKSPACE_MONTH: { remainingMinor: 0.0001, remainingTokens: null } },
      researchDepth: "DEEP",
    });
    assert.notEqual(result.decision, "TIER_3");
  });

  test("a non-research task ignores research depth", () => {
    for (const depth of ["LIGHT", "DEEP"] as const) {
      assert.equal(decideSpend({ taskType: "reply_generation", config: WIDE, remaining: {}, researchDepth: depth }).decision, "TIER_2");
    }
  });
});

describe("risk tolerance can only raise the clarify floor", () => {
  test("never below the current floor", () => {
    for (const tolerance of ["CAUTIOUS", "BALANCED", "ASSERTIVE", null, undefined] as const) {
      assert.ok(handoverFloor(tolerance) >= AGENT_CONFIDENCE.CLARIFY);
    }
  });

  test("BALANCED and ASSERTIVE behave exactly as before", () => {
    for (const confidence of [null, 0, 0.3, 0.59, 0.6, 0.7, 0.84, 0.85, 1]) {
      assert.equal(confidenceVerdictForTolerance(confidence, "BALANCED"), confidenceDecision(confidence));
      assert.equal(confidenceVerdictForTolerance(confidence, "ASSERTIVE"), confidenceDecision(confidence));
      assert.equal(confidenceVerdictForTolerance(confidence, null), confidenceDecision(confidence));
    }
  });

  // Owner decision 2026-09-27: below the floor the lead is asked to clarify
  // (UNCLEAR); confidence alone never hands over (was HANDOVER).
  test("CAUTIOUS clarifies anything short of ACT confidence", () => {
    assert.equal(confidenceVerdictForTolerance(0.7, "CAUTIOUS"), "UNCLEAR");
    assert.equal(confidenceVerdictForTolerance(null, "CAUTIOUS"), "UNCLEAR");
    assert.equal(confidenceVerdictForTolerance(0.5, "CAUTIOUS"), "UNCLEAR");
    assert.equal(confidenceVerdictForTolerance(0.9, "CAUTIOUS"), "ACT");
  });
});

describe("example messages reach the offer card as labelled tone examples", () => {
  const input: OfferCardInput = {
    businessName: "Northwind Studio",
    businessDescription: "A web design studio.",
    aiTone: "friendly",
    replyLength: "short",
    outreach: { tone: null, valueProposition: null, keyMessages: null, proofPoints: null, avoid: null, callToAction: null, claimRestrictions: null },
    playbook: null,
    signature: null,
    services: [],
    facts: [],
    now: new Date("2026-09-26T10:00:00Z"),
  };

  test("good and bad examples render under explicit not-facts headings", () => {
    const card = buildOfferCard({
      ...input,
      examples: { good: ["Hi Sam, thanks for getting in touch. What prompted the search?"], bad: ["ACT NOW!!! Limited offer!!!"] },
    });
    assert.ok(card.text.includes(EXAMPLE_GOOD_SECTION));
    assert.ok(card.text.includes(EXAMPLE_BAD_SECTION));
    assert.match(EXAMPLE_GOOD_SECTION, /not facts/);
    assert.ok(card.text.includes("What prompted the search?"));
  });

  test("examples are dropped first under the budget, never a rule or a service", () => {
    const long = "This is a long example sentence that goes on for a while. ".repeat(3).trim();
    const card = buildOfferCard({
      ...input,
      outreach: { ...input.outreach, avoid: "cheap" },
      services: [{ name: "Websites", description: "Brochure sites.", publicPriceText: null }],
      examples: { good: [long, long, long, long, long], bad: [long, long, long, long, long] },
      tokenBudget: 200,
    });
    assert.ok(card.tokens <= 200);
    assert.ok(card.dropped.length > 0);
    assert.ok(card.dropped.every((id) => id.startsWith("example:")), card.dropped.join(","));
    assert.ok(card.text.includes("cheap"));
    assert.ok(card.text.includes("Websites"));
  });

  test("no examples: the card is byte-identical to before", () => {
    assert.equal(buildOfferCard(input).text, buildOfferCard({ ...input, examples: { good: [], bad: [] } }).text);
  });
});

/* ======================================================================
 * 2. Lead status state machine (§51)
 * ==================================================================== */

import {
  allowedNextStatuses,
  LEAD_STATUS_ORDER,
  leadStatusTransition,
  overridePermitted,
} from "../src/lib/leads/status-transitions.ts";

describe("lead status transitions: the full matrix", () => {
  // Expected: rows are `from`, columns are `to`, in LEAD_STATUS_ORDER.
  // NEW CONTACTED RESPONDED QUALIFIED BOOKED WON LOST
  const Y = true;
  const N = false;
  const MATRIX: Record<string, boolean[]> = {
    NEW: [Y, Y, Y, Y, Y, Y, Y],
    CONTACTED: [N, Y, Y, Y, Y, Y, Y],
    RESPONDED: [N, N, Y, Y, Y, Y, Y],
    QUALIFIED: [N, N, Y, Y, Y, Y, Y],
    BOOKED: [N, N, Y, Y, Y, Y, Y],
    WON: [N, N, N, N, N, Y, N],
    LOST: [N, N, N, N, N, N, Y],
  };

  for (const from of LEAD_STATUS_ORDER) {
    test(`from ${from}`, () => {
      LEAD_STATUS_ORDER.forEach((to, i) => {
        assert.equal(leadStatusTransition(from, to).allowed, MATRIX[from][i], `${from} -> ${to}`);
      });
    });
  }

  test("WON -> NEW is refused with a clear reason", () => {
    const verdict = leadStatusTransition("WON", "NEW");
    assert.equal(verdict.allowed, false);
    if (!verdict.allowed) {
      assert.equal(verdict.code, "CLOSED");
      assert.match(verdict.reason, /admin can reopen/);
    }
  });

  test("an unknown status is refused", () => {
    assert.equal(leadStatusTransition("NEW", "ARCHIVED").allowed, false);
  });

  test("the picker offers exactly the allowed statuses, current included", () => {
    assert.deepEqual(allowedNextStatuses("WON"), ["WON"]);
    assert.deepEqual(allowedNextStatuses("RESPONDED"), ["RESPONDED", "QUALIFIED", "BOOKED", "WON", "LOST"]);
  });

  test("override: owner/admin, from the app, with a reason", () => {
    assert.equal(overridePermitted({ role: "admin", caller: "UI", reason: "Deal reopened by the client" }), true);
    assert.equal(overridePermitted({ role: "owner", caller: "UI", reason: "Reopened after a call" }), true);
    assert.equal(overridePermitted({ role: "member", caller: "UI", reason: "Deal reopened by the client" }), false);
    assert.equal(overridePermitted({ role: "admin", caller: "COPILOT", reason: "Deal reopened by the client" }), false);
    assert.equal(overridePermitted({ role: "admin", caller: "API", reason: "Deal reopened by the client" }), false);
    assert.equal(overridePermitted({ role: "admin", caller: "UI", reason: " " }), false);
  });
});

/* ======================================================================
 * Pressure / fake-urgency lint (evidence register §7, reactance)
 * ==================================================================== */

import { lintStyle, pressureIn } from "../src/lib/agent/validate.ts";

describe("pressure language is rejected, ordinary wording is not", () => {
  const PRESSURE = [
    "Only 3 spots left this month, so let me know.",
    "The offer ends today.",
    "This deal expires tonight.",
    "Last chance to get this price.",
    "Act now and we'll get you started.",
    "Book in before it's too late.",
    "We have limited spots available.",
    "Don't miss out on this.",
    "You need to decide by Friday.",
    "You must act quickly on this.",
    "You'll lose your place if you wait.",
    "Your slot will be given to someone else.",
    "Your competitors are already doing this.",
    "Why haven't you replied?",
    "Hurry, places are going fast.",
  ];
  const FINE = [
    "You must be busy, so no rush at all.",
    "You need to send your postcode so we can check coverage.",
    "The offer details are on our site if you'd like to read them.",
    "Would Tuesday or Thursday suit you better?",
    "Thanks for getting in touch. What prompted the search?",
    "We have a few options depending on what you need.",
    "I'll hold off until you've had a chance to look.",
    "Our last project like this took about six weeks.",
    "Take your time, there's no deadline on our side.",
  ];

  for (const text of PRESSURE) {
    test(`rejects: ${text}`, () => {
      assert.ok(pressureIn(text).length > 0, text);
      assert.ok(lintStyle(text).some((failure) => failure.code === "STYLE_PRESSURE"));
    });
  }
  for (const text of FINE) {
    test(`allows: ${text}`, () => {
      assert.deepEqual(pressureIn(text), [], text);
    });
  }
});

/* ======================================================================
 * 3. Email origin (§26)
 * ==================================================================== */

import {
  apolloEmailOrigin,
  coldSendRefusedForOrigin,
  emailVerificationClass,
  originForIngestSource,
  originForProvider,
} from "../src/lib/find-leads/email-origin.ts";
import { evaluateEligibility } from "../src/lib/outreach/campaign-eligibility.ts";
import { emptyDraft } from "../src/lib/outreach/campaign-draft.ts";

describe("email origin states", () => {
  test("Apollo guessed/extrapolated addresses are PATTERN_INFERRED", () => {
    assert.equal(apolloEmailOrigin("guessed"), "PATTERN_INFERRED");
    assert.equal(apolloEmailOrigin("Extrapolated"), "PATTERN_INFERRED");
    assert.equal(apolloEmailOrigin("verified"), "PROVIDED_BY_PROVIDER");
    assert.equal(apolloEmailOrigin(undefined), "PROVIDED_BY_PROVIDER");
  });

  test("provider and ingest defaults", () => {
    assert.equal(originForProvider("website_contacts"), "FOUND_PUBLICLY");
    assert.equal(originForProvider("hunter"), "PROVIDED_BY_PROVIDER");
    assert.equal(originForIngestSource("CRM"), "CRM_IMPORTED");
    assert.equal(originForIngestSource("CSV"), "CRM_IMPORTED");
    for (const type of ["AD_FORM", "WEB_FORM", "MANUAL", "API", "MCP", "SOCIAL_DM", "CONNECTOR"]) {
      assert.equal(originForIngestSource(type), "CUSTOMER_PROVIDED", type);
    }
  });

  test("verification class reuses prospects.verification_status", () => {
    assert.equal(emailVerificationClass("VALID"), "VERIFIED");
    assert.equal(emailVerificationClass("INVALID"), "INVALID");
    for (const status of ["UNKNOWN", "RISKY", "CATCH_ALL", "UNVERIFIABLE", null]) {
      assert.equal(emailVerificationClass(status), "UNVERIFIED");
    }
  });

  test("cold send refuses a guessed address until it is verified", () => {
    assert.equal(coldSendRefusedForOrigin({ origin: "PATTERN_INFERRED", verificationStatus: "UNKNOWN" }), true);
    assert.equal(coldSendRefusedForOrigin({ origin: "PATTERN_INFERRED", verificationStatus: "CATCH_ALL" }), true);
    assert.equal(coldSendRefusedForOrigin({ origin: "PATTERN_INFERRED", verificationStatus: "VALID" }), false);
    assert.equal(coldSendRefusedForOrigin({ origin: "PROVIDED_BY_PROVIDER", verificationStatus: "UNKNOWN" }), false);
    assert.equal(coldSendRefusedForOrigin({ origin: null, verificationStatus: "UNKNOWN" }), false);
  });

  test("campaign eligibility holds a guessed, unverified address for review", () => {
    const draft = emptyDraft();
    const candidate = {
      grade: "A" as const,
      score: 90,
      status: "VERIFIED",
      outreachEligibility: "ELIGIBLE",
      email: "sam@example.co.uk",
      promotedToLeadId: null,
      isExistingCustomer: false,
      matchingIntentSignals: 1,
      suppressed: false,
      companyExcluded: false,
    };
    const guessed = evaluateEligibility({ ...candidate, emailOrigin: "PATTERN_INFERRED", verificationStatus: "UNKNOWN" }, draft);
    assert.equal(guessed.reasonCode, "GUESSED_EMAIL");
    assert.notEqual(guessed.outcome, "ELIGIBLE");
    const verified = evaluateEligibility({ ...candidate, emailOrigin: "PATTERN_INFERRED", verificationStatus: "VALID" }, draft);
    assert.notEqual(verified.reasonCode, "GUESSED_EMAIL");
  });
});

/* ======================================================================
 * 4. Opportunity memory (§48)
 * ==================================================================== */

import {
  deriveOpportunityMemory,
  MEMORY_RENDER_CHARS,
  parseMemory,
  renderOpportunityMemory,
} from "../src/lib/opportunities/memory.ts";

describe("opportunity memory is derived, bounded and compact", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  const base = {
    answers: [
      { question: "What prompted this?", value: "Leads go cold before we reply", dimension: "PROBLEM" as const },
      { question: "What do you want it to do?", value: "Reply to every enquiry in minutes", dimension: "USE_CASE" as const },
      { question: "When are you hoping to start?", value: "This quarter", dimension: "TIMING" as const },
      { question: "Do you have a budget in mind?", value: "Around 500 a month", dimension: "BUDGET" as const },
      { question: "How did you hear about us?", value: "A podcast", dimension: null },
    ],
    unanswered: ["Is anyone else involved in deciding?"],
    messages: [
      { direction: "outbound" as const, body: "Thanks Sam. I'll send over a summary tomorrow.", at: "2026-09-25T09:00:00Z", channel: "email" },
      { direction: "inbound" as const, body: "Sounds good, but I need to check with my director first. How much is it?", at: "2026-09-25T10:00:00Z", channel: "email" },
    ],
    service: "Lead follow-up",
    summary: "Sam runs a small agency and wants faster replies.",
    now,
  };

  test("answers land in the right buckets", () => {
    const memory = deriveOpportunityMemory(base);
    assert.deepEqual(memory.pains, ["Leads go cold before we reply"]);
    assert.deepEqual(memory.goals, ["Reply to every enquiry in minutes"]);
    assert.equal(memory.timeframe, "This quarter");
    assert.ok(memory.budgetSignals.some((s) => s.includes("Around 500")));
    assert.ok(memory.budgetSignals.includes("Asked about price"));
    assert.ok(memory.facts.some((f) => f.includes("A podcast")));
    assert.ok(memory.productsDiscussed.includes("Lead follow-up"));
    assert.deepEqual(memory.openQuestions, ["Is anyone else involved in deciding?"]);
  });

  test("stakeholders, commitments and the next action come from the messages", () => {
    const memory = deriveOpportunityMemory(base);
    assert.ok(memory.stakeholders.some((s) => s.startsWith("director")), memory.stakeholders.join("|"));
    assert.ok(memory.commitments.some((c) => c.includes("send over a summary")));
    assert.match(memory.nextAction ?? "", /price/);
  });

  test("objections are kept across refreshes", () => {
    const first = deriveOpportunityMemory({
      ...base,
      messages: [{ direction: "inbound" as const, body: "Honestly it is too expensive for us right now", at: "x", channel: "sms" }],
    });
    assert.ok(first.objections.length > 0);
    const second = deriveOpportunityMemory({ ...base, messages: [], previous: first });
    assert.deepEqual(second.objections, first.objections);
  });

  test("lists are capped and the stored record round-trips", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ question: `Q${i}`, value: `pain ${i}`, dimension: "PROBLEM" as const }));
    const memory = deriveOpportunityMemory({ ...base, answers: many });
    assert.ok(memory.pains.length <= 5);
    assert.deepEqual(parseMemory(JSON.parse(JSON.stringify(memory)), now), memory);
    assert.equal(parseMemory({ version: 2 }), null);
    assert.equal(parseMemory("nope"), null);
  });

  test("the rendered block is compact and omits the summary", () => {
    const text = renderOpportunityMemory(deriveOpportunityMemory(base))!;
    assert.ok(text.length <= MEMORY_RENDER_CHARS);
    assert.ok(!text.includes("small agency"));
    assert.match(text, /People involved: .*director/);
    assert.equal(renderOpportunityMemory(null), null);
  });

  test("an empty memory renders nothing", () => {
    const memory = deriveOpportunityMemory({ answers: [], unanswered: [], messages: [], service: null, summary: null, now });
    assert.equal(renderOpportunityMemory(memory), null);
  });
});

/* ======================================================================
 * Method routing gets real direction and stakeholders; brief wording
 * ==================================================================== */

import { buildStrategyBlock, leadDirection } from "../src/lib/agent/strategy.ts";
import { internalApproachLabel } from "../src/lib/sales-library/method-router.ts";

describe("the agent's method routing sees the relationship", () => {
  test("lead direction from origin markers", () => {
    assert.equal(leadDirection({}), "INBOUND");
    assert.equal(leadDirection({ promoted_from_prospect_id: "p1" }), "OUTBOUND");
    assert.equal(leadDirection({ sourcing_run_id: "r1" }), "OUTBOUND");
    assert.equal(leadDirection({ relationship_type: "FOUND_BY_US" }), "OUTBOUND");
    assert.equal(leadDirection({ relationship_type: "THEY_CONTACTED_US" }), "INBOUND");
  });

  const strategy = (extra: Partial<Parameters<typeof buildStrategyBlock>[0]>) =>
    buildStrategyBlock({
      mode: "NEW_LEAD_RESPONSE",
      motion: "BOOK_MEETING_B2B",
      archetypeKey: null,
      channel: "email",
      selection: { question: null, stopReason: null, known: [] },
      latestMessage: null,
      hasApprovedInsight: true,
      bookingAvailable: true,
      ...extra,
    });

  test("CHALLENGER_INSIGHT is reachable for a reply to our own outreach", () => {
    assert.equal(strategy({ direction: "OUTBOUND" }).record.method, "CHALLENGER_INSIGHT");
    assert.notEqual(strategy({ direction: "INBOUND" }).record.method, "CHALLENGER_INSIGHT");
  });

  test("three or more stakeholders make a small B2B sale consultative", () => {
    assert.equal(strategy({ hasApprovedInsight: false, stakeholderCount: 3 }).record.method, "SPIN");
    assert.equal(strategy({ hasApprovedInsight: false, stakeholderCount: 0 }).record.method, "SIMPLE_QUALIFICATION");
  });

  test("the method name never reaches the prompt", () => {
    const text = strategy({ direction: "OUTBOUND" }).text;
    assert.ok(!/SPIN|MEDDPICC|CHALLENGER/i.test(text));
  });

  test("the handoff label is plain words with the evidence grade", () => {
    const label = internalApproachLabel("SPIN");
    assert.match(label, /consultative discovery/);
    assert.match(label, /not peer-reviewed/);
    assert.ok(!label.includes("SPIN"));
  });
});

/* ======================================================================
 * 6d. SOFT_OPT_IN and REPLY_WINDOW_OPEN (0131)
 * ==================================================================== */

import { contactabilityState } from "../src/lib/policy/contactability-state.ts";

describe("contactability derives soft opt-in and the reply window", () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    result: "ALLOWED",
    reasonCode: "ALLOWED",
    relationshipType: "EXISTING_CUSTOMER" as string | null,
    channel: "EMAIL",
    subjectType: "LEAD",
    subscriberType: "INDIVIDUAL",
    evidence: null,
    ...extra,
  });

  test("SOFT_OPT_IN needs an individual subscriber and a sale or negotiation", () => {
    assert.equal(contactabilityState(row(), [], { saleOrNegotiation: true }), "SOFT_OPT_IN");
    assert.equal(contactabilityState(row({ subscriberType: "SOLE_TRADER" }), [], { saleOrNegotiation: true }), "SOFT_OPT_IN");
    assert.equal(contactabilityState(row(), [], {}), "EXISTING_CUSTOMER");
    assert.equal(contactabilityState(row({ subscriberType: "CORPORATE" }), [], { saleOrNegotiation: true }), "EXISTING_CUSTOMER");
    assert.equal(contactabilityState(row({ subjectType: "PROSPECT" }), [], { saleOrNegotiation: true }), "EXISTING_CUSTOMER");
  });

  test("REPLY_WINDOW_OPEN on WhatsApp / social within 24h of an inbound", () => {
    assert.equal(contactabilityState(row({ channel: "WHATSAPP" }), [], { inboundWithin24h: true }), "REPLY_WINDOW_OPEN");
    assert.equal(contactabilityState(row({ channel: "SOCIAL", relationshipType: "THEY_CONTACTED_US" }), [], { inboundWithin24h: true }), "REPLY_WINDOW_OPEN");
    assert.equal(contactabilityState(row({ channel: "EMAIL" }), [], { inboundWithin24h: true }), "EXISTING_CUSTOMER");
    assert.equal(contactabilityState(row({ channel: "WHATSAPP", relationshipType: null }), [], {}), "PERMITTED");
  });

  test("a block still wins over both", () => {
    assert.equal(
      contactabilityState(row({ result: "BLOCKED", reasonCode: "BLOCKED_OPT_OUT", channel: "WHATSAPP" }), [], { inboundWithin24h: true, saleOrNegotiation: true }),
      "OPTED_OUT",
    );
  });

  test("the SQL trigger and the TS mirror use the same vocabulary", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/0131_revenue_engine_gaps.sql", "utf8");
    for (const state of ["SOFT_OPT_IN", "REPLY_WINDOW_OPEN", "EXISTING_CUSTOMER", "LEGITIMATE_INTERESTS_REVIEWED"]) {
      assert.ok(sql.includes(`'${state}'`), state);
    }
  });
});

/* ======================================================================
 * 5. Governed learning and experiments (§§61-63)
 * ==================================================================== */

import {
  assignArm,
  computeExperimentResult,
  differenceInterval,
  experimentProblems,
  HOLDOUT_ARM,
  stableHash,
  variantTemplate,
  wilson,
} from "../src/lib/learning/experiments.ts";
import { buildMessageFeatures, ctaType, lengthBucket, localHourDow } from "../src/lib/learning/features.ts";

describe("outcome features", () => {
  test("CTA, length and local time buckets", () => {
    assert.equal(ctaType("Book here: https://calendly.com/x/20min"), "BOOKING_LINK");
    assert.equal(ctaType("Details: https://example.com/pricing"), "LINK");
    assert.equal(ctaType("Would Tuesday work?"), "QUESTION");
    assert.equal(ctaType("Thanks, speak soon."), "NONE");
    assert.equal(lengthBucket("short"), "SHORT");
    assert.equal(lengthBucket("x".repeat(200)), "MEDIUM");
    assert.equal(lengthBucket("x".repeat(500)), "LONG");
    // 2026-07-01 12:30Z is 13:30 in London (BST), a Wednesday.
    assert.deepEqual(localHourDow(new Date("2026-07-01T12:30:00Z"), "Europe/London"), { hour: 13, dow: 3 });
    assert.deepEqual(localHourDow(new Date("2026-07-01T12:30:00Z"), "Not/AZone"), { hour: 12, dow: 3 });
  });

  test("features carry structure only, never the text", () => {
    const features = buildMessageFeatures({
      family: "FOLLOW_UP",
      body: "Hi Sam, would Tuesday work?",
      channel: "sms",
      sendAt: new Date("2026-07-01T12:30:00Z"),
      timeZone: "Europe/London",
      templateId: "step-1",
      step: 1,
      scoreBand: "B",
      experimentId: "e1",
      arm: "B",
    });
    assert.equal(features.family, "FOLLOW_UP");
    assert.equal(features.cta, "QUESTION");
    assert.ok(!JSON.stringify(features).includes("Sam"));
  });
});

describe("experiment assignment is deterministic", () => {
  const experiment = {
    id: "exp-1",
    holdoutPercent: 10,
    variants: [
      { key: "A", label: "Control" },
      { key: "B", label: "Shorter", templates: { "1": "Short copy" } },
    ],
  };

  test("same lead, same arm, every time", () => {
    for (let i = 0; i < 50; i++) {
      const lead = `lead-${i}`;
      assert.equal(assignArm(experiment, lead), assignArm(experiment, lead));
    }
    assert.equal(stableHash("abc"), stableHash("abc"));
  });

  test("the split is close to the configured shares", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 10_000; i++) {
      const arm = assignArm(experiment, `lead-${i}`);
      counts[arm] = (counts[arm] ?? 0) + 1;
    }
    assert.ok(Math.abs(counts[HOLDOUT_ARM] - 1000) < 200, JSON.stringify(counts));
    assert.ok(Math.abs(counts.A - counts.B) < 500, JSON.stringify(counts));
  });

  test("zero holdout never holds out", () => {
    for (let i = 0; i < 500; i++) assert.notEqual(assignArm({ ...experiment, holdoutPercent: 0 }, `l${i}`), HOLDOUT_ARM);
  });

  test("variant templates replace only the steps they name", () => {
    assert.equal(variantTemplate(experiment, "B", 1), "Short copy");
    assert.equal(variantTemplate(experiment, "B", 2), null);
    assert.equal(variantTemplate(experiment, "A", 1), null);
  });

  test("definitions are validated", () => {
    assert.deepEqual(experimentProblems({ holdoutPercent: 10, variants: experiment.variants, minSamplePerArm: 100 }), []);
    assert.ok(experimentProblems({ holdoutPercent: 10, variants: experiment.variants, minSamplePerArm: 50 }).length > 0);
    assert.ok(experimentProblems({ holdoutPercent: 60, variants: experiment.variants, minSamplePerArm: 100 }).length > 0);
    assert.ok(
      experimentProblems({ holdoutPercent: 0, variants: [{ key: "A", label: "a" }, { key: "B", label: "b" }], minSamplePerArm: 100 }).length > 0,
      "a variant that changes nothing is refused",
    );
    assert.ok(
      experimentProblems({ holdoutPercent: 0, variants: [{ key: "B", label: "b", templates: { "1": "x" } }, { key: "A", label: "a" }], minSamplePerArm: 100 }).length > 0,
      "control must be first",
    );
  });
});

describe("results need evidence before a winner is shown", () => {
  const arm = (name: string, leads: number, bookings: number, optOuts = 0) => ({
    arm: name,
    leads,
    wins: 0,
    bookings,
    positiveReplies: bookings,
    optOuts,
  });

  test("Wilson and Newcombe intervals behave", () => {
    const w = wilson(0, 100);
    assert.equal(w.rate, 0);
    assert.ok(w.low === 0 && w.high > 0 && w.high < 0.05);
    const d = differenceInterval({ x: 30, n: 100 }, { x: 10, n: 100 });
    assert.ok(d.low > 0 && d.rate > 0.19 && d.rate < 0.21);
  });

  test("below 100 per arm: never a winner, whatever the gap", () => {
    const result = computeExperimentResult({ metric: "BOOKING", minSamplePerArm: 100, arms: [arm("A", 99, 1), arm("B", 99, 60)] });
    assert.equal(result.verdict, "NOT_ENOUGH_DATA");
    assert.equal(result.winner, null);
  });

  test("the minimum sample cannot be configured below 100", () => {
    const result = computeExperimentResult({ metric: "BOOKING", minSamplePerArm: 10, arms: [arm("A", 50, 1), arm("B", 50, 40)] });
    assert.equal(result.verdict, "NOT_ENOUGH_DATA");
  });

  test("a credible lift wins; a noisy one does not", () => {
    const clear = computeExperimentResult({ metric: "BOOKING", minSamplePerArm: 100, arms: [arm("A", 400, 20), arm("B", 400, 60)] });
    assert.equal(clear.verdict, "WINNER");
    assert.equal(clear.winner, "B");
    const noisy = computeExperimentResult({ metric: "BOOKING", minSamplePerArm: 100, arms: [arm("A", 120, 12), arm("B", 120, 15)] });
    assert.equal(noisy.verdict, "NO_DIFFERENCE");
    assert.equal(noisy.winner, null);
  });

  test("more opt-outs disqualify an arm that converts better (negative constraint)", () => {
    const result = computeExperimentResult({
      metric: "BOOKING",
      minSamplePerArm: 100,
      arms: [arm("A", 400, 20, 2), arm("B", 400, 60, 40)],
    });
    assert.notEqual(result.winner, "B");
    assert.equal(result.arms.find((a) => a.arm === "B")!.harmful, true);
  });

  test("the holdout is reported but never wins", () => {
    const result = computeExperimentResult({
      metric: "BOOKING",
      minSamplePerArm: 100,
      arms: [arm("A", 400, 20), arm("B", 400, 21), arm(HOLDOUT_ARM, 100, 90)],
    });
    assert.notEqual(result.winner, HOLDOUT_ARM);
    assert.ok(result.arms.some((a) => a.arm === HOLDOUT_ARM));
  });

  test("raw replies are not an optimisation target", async () => {
    const { PRIMARY_METRICS } = await import("../src/lib/learning/experiments.ts");
    assert.ok(!(PRIMARY_METRICS as readonly string[]).includes("REPLY"));
  });
});

/* ======================================================================
 * Scoring gets its features; FIT averages evidence; weights are editable
 * ==================================================================== */

import { answerFeatures, pricingRequestedFact, timelineDays } from "../src/lib/scoring/answer-features.ts";
import { scoreLead } from "../src/lib/scoring/lead-score.ts";
import { defaultScoringWeights, parseScoringWeights, scoringWeightsSchema } from "../src/lib/settings/ai-selling.ts";

describe("qualification answers feed the lead score", () => {
  const at = "2026-09-20T10:00:00Z";
  const a = (dimension: string | null, value: string, answeredAt = at) =>
    ({ dimension, value, answeredAt, confidence: null }) as Parameters<typeof answerFeatures>[0][number];

  test("timing wording becomes days, and near-term is urgent", () => {
    assert.equal(timelineDays("ASAP"), 7);
    assert.equal(timelineDays("in 2 weeks"), 14);
    assert.equal(timelineDays("this quarter"), 90);
    assert.equal(timelineDays("next year"), 365);
    assert.equal(timelineDays("depends on the board"), null);
    const facts = answerFeatures([a("TIMING", "as soon as possible")]);
    assert.deepEqual(facts.map((f) => f.feature).sort(), ["timeline_days", "urgent"]);
  });

  test("budget, authority and stakeholders only from clear wording", () => {
    const byFeature = (answers: Parameters<typeof answerFeatures>[0]) =>
      Object.fromEntries(answerFeatures(answers).map((f) => [f.feature, f.value]));
    assert.deepEqual(byFeature([a("BUDGET", "£2k a month")]), { budget_confirmed: true });
    assert.deepEqual(byFeature([a("BUDGET", "not sure yet")]), { budget_confirmed: false });
    assert.deepEqual(byFeature([a("BUDGET", "it depends")]), {});
    assert.deepEqual(byFeature([a("AUTHORITY", "Yes, it's my call")]), { authority_confirmed: true });
    assert.deepEqual(byFeature([a("AUTHORITY", "No, my director decides")]), { authority_confirmed: false });
    assert.deepEqual(byFeature([a("STAKEHOLDERS", "3 of us")]), { stakeholder_count: 3 });
    assert.deepEqual(byFeature([a("STAKEHOLDERS", "a few people")]), {});
    assert.deepEqual(byFeature([a(null, "£5k")]), {}, "an unmapped question produces nothing");
  });

  test("the latest answer wins", () => {
    const facts = answerFeatures([a("BUDGET", "no budget", "2026-09-01T00:00:00Z"), a("BUDGET", "yes, £3k", "2026-09-10T00:00:00Z")]);
    assert.equal(facts.find((f) => f.feature === "budget_confirmed")?.value, true);
  });

  test("a price question in the lead's own words is pricing_requested", () => {
    assert.equal(pricingRequestedFact([{ body: "How much does it cost?", created_at: at }])?.feature, "pricing_requested");
    assert.equal(pricingRequestedFact([{ body: "Thanks, speak Tuesday", created_at: at }]), null);
  });

  test("the new features move the score through the engine", () => {
    const without = scoreLead({ facts: [{ feature: "inbound_enquiry", value: true, source: "x" }] });
    const withFacts = scoreLead({
      facts: [
        { feature: "inbound_enquiry", value: true, source: "x" },
        ...answerFeatures([a("TIMING", "asap"), a("BUDGET", "£2k"), a("AUTHORITY", "yes")]),
      ],
    });
    assert.ok(withFacts.total > without.total);
    for (const dim of ["TIMING", "COMMERCIAL", "DECISION_ACCESS"]) {
      assert.ok(withFacts.dimensions.find((d) => d.dimension === dim)!.score > 0, dim);
    }
  });
});

describe("FIT averages the signals that have evidence", () => {
  test("missing enrichment lowers confidence, not the fit score", () => {
    const one = scoreLead({ facts: [{ feature: "company_size_match", value: 1, source: "x" }], archetypeKey: "B2B_SAAS" });
    const fit = one.dimensions.find((d) => d.dimension === "FIT")!;
    assert.equal(fit.score, fit.max);
    assert.ok(fit.confidence < 0.5);
    assert.ok(fit.missing.length > 0);
  });

  test("a known poor fit still scores low", () => {
    const poor = scoreLead({
      facts: [
        { feature: "company_size_match", value: 0, source: "x" },
        { feature: "industry_match", value: 0.2, source: "x" },
      ],
      archetypeKey: "B2B_SAAS",
    });
    const fit = poor.dimensions.find((d) => d.dimension === "FIT")!;
    assert.ok(fit.score < fit.max * 0.2);
  });

  test("a dimension with no evidence at all still scores zero", () => {
    const none = scoreLead({ facts: [{ feature: "inbound_enquiry", value: true, source: "x" }], archetypeKey: "B2B_SAAS" });
    assert.equal(none.dimensions.find((d) => d.dimension === "FIT")!.score, 0);
  });
});

describe("scoring weights editor validation", () => {
  test("the default sums to 100 and validates", () => {
    const defaults = defaultScoringWeights(null, null);
    assert.equal(Object.values(defaults).reduce((s, v) => s + v, 0), 100);
    assert.equal(scoringWeightsSchema.safeParse(defaults).success, true);
  });

  test("weights must be whole numbers summing to exactly 100", () => {
    const defaults = defaultScoringWeights("B2B_SAAS", "SAAS_SELF_SERVE");
    assert.equal(scoringWeightsSchema.safeParse({ ...defaults, FIT: defaults.FIT + 1 }).success, false);
    assert.equal(scoringWeightsSchema.safeParse({ ...defaults, FIT: 1.5 }).success, false);
    assert.equal(parseScoringWeights({ FIT: 100 }), null);
    assert.deepEqual(parseScoringWeights(defaults), defaults);
  });

  test("a stored override changes the engine's weights", () => {
    const weights = { FIT: 0, INTENT: 100, NEED: 0, COMMERCIAL: 0, DECISION_ACCESS: 0, TIMING: 0, ENGAGEMENT: 0 };
    const result = scoreLead({ facts: [{ feature: "positive_reply", value: true, source: "x" }], weightOverrides: weights });
    assert.equal(result.dimensions.find((d) => d.dimension === "INTENT")!.max, 100);
  });
});
