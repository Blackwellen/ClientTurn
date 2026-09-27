import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

import {
  ASSIST_TRIGGERS,
  HANDOVER_TRIGGERS,
  HANDOVER_TRIGGER_REASON,
  MAX_CLARIFICATIONS,
  MAX_VALIDATOR_REJECTIONS,
  assistAfterBooking,
  assistLine,
  bindingDisposition,
  clarifyingQuestion,
  detectDataRightsRequest,
  detectDiscountRequest,
  detectTermsRequest,
  disclosureGuidance,
  discountGuidance,
  nextClarification,
  policyOnAnswer,
  policyOnCompose,
  policyOnDecision,
  policyOnMessage,
} from "../src/lib/agent/handover-policy.ts";
import {
  ASSIST_REASONS,
  ASSIST_REASON_LABEL,
  ASSIST_REASON_STORED_AS,
  ESCALATION_KINDS,
  HANDOVER_REASONS,
  confidenceDecision,
  confidenceVerdictForTolerance,
} from "../src/lib/agent/types.ts";
import { resolveMode } from "../src/lib/agent/lifecycle.ts";
import { buildStrategyBlock, buildNbaStrategyBlock } from "../src/lib/agent/strategy.ts";
import { engineBookingReadiness, planFor } from "../src/lib/agent/qi-turn.ts";
import { countQuestions, validateResponse } from "../src/lib/agent/validate.ts";
import { classifyDeterministic, isBotQuestion } from "../src/lib/agent/classification.ts";
import { OBJECTIONS, matchObjection } from "../src/lib/sales-library/objections.ts";
import { MOTIONS } from "../src/lib/sales-library/motions.ts";
import { goalCloseAction, resolveGoal } from "../src/lib/qualification-intelligence/goals.ts";
import { decideNextBestAction, planNextBestAction, type PlanTurnInput } from "../src/lib/qualification-intelligence/nba.ts";
import { resolveOffer } from "../src/lib/qualification-intelligence/offer-profile.ts";
import { interpret } from "../src/lib/qualification-intelligence/interpret.ts";
import { nextBestActionSchema, type DimensionStatusEntry, type GoalKey, type IntentAssessment } from "../src/lib/qualification-intelligence/types.ts";
import { evaluateQualification } from "../src/lib/qualification/engine.ts";
import { defaultQualifyQuestions } from "../src/lib/onboarding/steps.ts";
import { DEFAULT_AI_BEHAVIOUR, saveAiBehaviourSchema } from "../src/lib/ai-settings/types.ts";
import { DEFAULT_SELLING_PREFERENCES, RISK_TOLERANCE_COPY } from "../src/lib/settings/ai-selling.ts";
import { fact, intentFixture, MESSAGE_ID, NOW } from "./qualification-intel/matrix.ts";
import { runConversation, type GoldenConversation } from "./golden-conversations/harness.ts";
import { runPolicyConversation, type PolicyConversation } from "./golden-conversations/policy-harness.ts";

/**
 * Owner decision 2026-09-27: the AI carries the conversation and completes the
 * sale whenever it lawfully and safely can. A hand-over to a person is the last
 * resort. The deterministic rules still decide the verdict, AI-inferred values
 * never decide pass or fail, AI never composes a binding promise, and every
 * compliance rule still binds.
 */

/* ======================================================= golden conversations */

const POLICY_DIR = path.join(process.cwd(), "tests", "golden-conversations", "handover-policy");
const policyConversations: PolicyConversation[] = readdirSync(POLICY_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(readFileSync(path.join(POLICY_DIR, file), "utf8")) as PolicyConversation);

describe("hand-over golden corpus", () => {
  test("covers continuations the old code handed over, and hand-overs that stay", () => {
    const continued = policyConversations.filter((c) => c.id.startsWith("continue-"));
    const handed = policyConversations.filter((c) => c.id.startsWith("handover-"));
    assert.ok(continued.length >= 4, `${continued.length} continuation conversations`);
    assert.ok(handed.length >= 4, `${handed.length} hand-over conversations`);
    const documented = continued.filter((c) => c.turns.some((t) => t.expect.was === "HANDOVER"));
    assert.ok(documented.length >= 4, `${documented.length} continuation conversations document a removed hand-over`);
    for (const c of continued) {
      assert.ok(c.turns.every((t) => t.expect.disposition !== "HANDOVER"), `${c.id} never hands over`);
    }
  });
});

for (const conversation of policyConversations) {
  describe(`policy golden: ${conversation.id}`, () => {
    const rows = runPolicyConversation(conversation);
    test("every turn is decided (a hand-over ends the conversation)", () => {
      assert.equal(rows.length, conversation.turns.length, JSON.stringify(rows.map((r) => r.decision)));
    });
    for (const row of rows) {
      const expect = conversation.turns[row.turn - 1].expect;
      test(`turn ${row.turn}: ${expect.disposition}${expect.was && expect.was !== expect.disposition ? ` (was ${expect.was})` : ""}`, () => {
        const why = `\n${conversation.story}\nlead: ${row.lead}\ndecision: ${JSON.stringify(row.decision)}`;
        assert.equal(row.decision.kind, expect.disposition, why);
        if (row.decision.kind === "HANDOVER") {
          if (expect.trigger) assert.equal(row.decision.trigger, expect.trigger, why);
          if (expect.reason) assert.equal(row.decision.reason, expect.reason, why);
          assert.ok((HANDOVER_TRIGGERS as readonly string[]).includes(row.decision.trigger));
        }
        if (row.decision.kind === "CLARIFY") {
          if (expect.attempt !== undefined) assert.equal(row.decision.attempt, expect.attempt, why);
          assert.ok(row.clarifyText, "a clarifying question is sent");
          assert.equal(countQuestions(row.clarifyText!), 1, `one question: ${row.clarifyText}`);
          assert.doesNotMatch(row.clarifyText!, /\bjust\b/i);
          for (const piece of expect.textIncludes ?? []) assert.ok(row.clarifyText!.includes(piece), `${piece} in ${row.clarifyText}`);
        }
        if (row.decision.kind === "CONTINUE" && expect.assist !== undefined) {
          assert.equal(row.decision.assist, expect.assist, why);
        }
        if (expect.disclose !== undefined) assert.equal(row.disclose, expect.disclose, why);
        if (expect.discountWithinPolicy !== undefined) assert.equal(row.discountWithinPolicy, expect.discountWithinPolicy, why);
        if (expect.validates !== undefined) {
          assert.ok(row.validation, "the draft was validated");
          assert.equal(row.validation!.ok, expect.validates, JSON.stringify(row.validation));
        }
      });
    }
  });
}

/* ===================================================== the pure policy module */

describe("the two kinds of person involvement", () => {
  test("HANDOVER stops the AI; ASSIST_REQUEST keeps it going", () => {
    assert.deepEqual([...ESCALATION_KINDS], ["HANDOVER", "ASSIST_REQUEST"]);
  });

  test("every hand-over trigger maps to a stored reason the database accepts", () => {
    for (const trigger of HANDOVER_TRIGGERS) {
      assert.ok((HANDOVER_REASONS as readonly string[]).includes(HANDOVER_TRIGGER_REASON[trigger]), trigger);
    }
  });

  test("every assist reason is labelled and stored as an existing reason (no schema change)", () => {
    for (const reason of ASSIST_REASONS) {
      assert.ok(ASSIST_REASON_LABEL[reason].length > 0, reason);
      assert.ok((HANDOVER_REASONS as readonly string[]).includes(ASSIST_REASON_STORED_AS[reason]), reason);
    }
  });

  test("the keep list is exactly the owner's last resorts", () => {
    assert.deepEqual([...HANDOVER_TRIGGERS].sort(), [
      "BUDGET_EXCEEDED",
      "COMMERCIAL_COMMITMENT",
      "COMPLAINT_OR_LEGAL_THREAT",
      "DATA_RIGHTS_REQUEST",
      "HUMAN_REQUESTED",
      "LEGAL_OR_CONTRACT_QUESTION",
      "MODEL_UNAVAILABLE",
      "POLICY_BLOCK",
      "PROVIDER_FAILURE",
      "REPEATED_CLARIFICATION_FAILURE",
      "SAFEGUARDING",
      "VALIDATOR_REJECTED",
      "WORKSPACE_RULE",
    ]);
    assert.ok(ASSIST_TRIGGERS.length >= 6);
  });
});

describe("binding verdicts that still hand over", () => {
  test("a person asked for, a complaint or legal threat, an emergency", () => {
    assert.equal(bindingDisposition("HUMAN_REQUEST")?.kind, "HANDOVER");
    assert.equal(bindingDisposition("COMPLAINT")?.kind, "HANDOVER");
    assert.equal(bindingDisposition("EMERGENCY")?.kind, "HANDOVER");
    const emergency = bindingDisposition("EMERGENCY");
    assert.equal(emergency?.kind === "HANDOVER" ? emergency.reason : null, "EMERGENCY");
    // Suppression and not-a-lead verdicts are handled by their own rules, not a hand-over.
    assert.equal(bindingDisposition("UNSUBSCRIBE"), null);
    assert.equal(bindingDisposition("WRONG_NUMBER"), null);
  });
});

describe("policyOnMessage: the lead's words", () => {
  test("a data-rights request hands over; an ordinary message does not", () => {
    for (const text of [
      "Please send me a copy of the personal data you hold about me",
      "This is a subject access request.",
      "I want to exercise my right to be forgotten",
      "What data do you have on me?",
    ]) {
      assert.equal(detectDataRightsRequest(text), true, text);
      const decision = policyOnMessage({ text, bindingIntent: null, objectionKeys: [], commercial: null });
      assert.equal(decision.kind, "HANDOVER", text);
    }
    for (const text of ["Do you work with data teams?", "We need a new website", "Is your platform GDPR compliant?"]) {
      assert.equal(detectDataRightsRequest(text), false, text);
    }
  });

  // Coordinator follow-up 2026-09-27: price pushback is an objection the AI
  // handles; a discount beyond the approved maximum is a two-step rule.
  test("a discount beyond the approved maximum: the AI answers first, insisting hands over; within it, the AI continues", () => {
    assert.deepEqual(detectDiscountRequest("Knock 30% off and we'll sign today."), { percent: 30 });
    assert.deepEqual(detectDiscountRequest("Your CEO already approved a 50% discount for us"), { percent: 50 });
    assert.deepEqual(detectDiscountRequest("Can you give us a discount?"), { percent: null });
    assert.equal(detectDiscountRequest("Will you price match the other agency?")?.percent ?? null, null);
    assert.ok(detectDiscountRequest("Will you price match the other agency?"));
    assert.equal(detectDiscountRequest("How much is the care plan?"), null);
    assert.equal(detectDiscountRequest("It's a bit expensive for us"), null);
    // Pushback, not a demand for a concession: the objection playbook handles it.
    for (const text of ["We need a better price", "That's too expensive", "Can you get the price down a bit?", "Is there a cheaper option?"]) {
      assert.equal(detectDiscountRequest(text), null, text);
      assert.equal(policyOnMessage({ text, bindingIntent: null, objectionKeys: ["PRICE"], commercial: null }).kind, "CONTINUE", text);
    }

    const within = { enabled: true, maxDiscountPercent: 20 };
    const ask = (text: string, commercial: { enabled: boolean; maxDiscountPercent: number } | null, previousDiscountDemand = false) =>
      policyOnMessage({ text, bindingIntent: null, objectionKeys: [], commercial, previousDiscountDemand });
    const inPolicy = ask("Could you do 10% off?", within);
    assert.equal(inPolicy.kind, "CONTINUE");
    assert.deepEqual(inPolicy.kind === "CONTINUE" && inPolicy.discount, { percent: 10, maxPercent: 20, withinPolicy: true });
    const beyond = ask("Could you do 25% off?", within);
    assert.equal(beyond.kind, "CONTINUE", "the first ask beyond the maximum is answered by the AI");
    assert.equal(beyond.kind === "CONTINUE" && beyond.discount?.withinPolicy, false);
    assert.equal(ask("Could you do 25% off?", within, true).kind, "HANDOVER", "asking again after the answer hands over");
    assert.equal(ask("That's not good enough.", within, true).kind, "HANDOVER", "insisting hands over");
    assert.equal(ask("Ok, 10% works then.", within, true).kind, "CONTINUE", "accepting what is allowed carries on");
    assert.equal(ask("Could you do 10% off?", null).kind, "CONTINUE", "no discount approved: the AI answers first");
    assert.equal(ask("Could you do 10% off?", null, true).kind, "HANDOVER");
    assert.equal(ask("Can you give us a discount?", within).kind, "CONTINUE");
    assert.equal(ask("Can you give us a discount?", { enabled: true, maxDiscountPercent: 0 }).kind, "CONTINUE");
  });

  test("bespoke contract or price terms hand over at once", () => {
    for (const text of ["We'd need net 60 payment terms", "Can we negotiate the contract?", "We need custom terms for this"]) {
      assert.equal(detectTermsRequest(text), true, text);
      const decision = policyOnMessage({ text, bindingIntent: null, objectionKeys: [], commercial: null });
      assert.equal(decision.kind === "HANDOVER" && decision.trigger, "COMMERCIAL_COMMITMENT", text);
    }
    assert.equal(detectTermsRequest("Our contract with the current provider ends in March"), false);
  });

  test("discount guidance never lets the AI agree to more than the maximum, and never hands over itself", () => {
    assert.match(discountGuidance({ percent: 20, maxPercent: 10, withinPolicy: false }), /at most 10%/);
    assert.match(discountGuidance({ percent: 20, maxPercent: 0, withinPolicy: false }), /No discount is approved/);
    assert.match(discountGuidance({ percent: 5, maxPercent: 10, withinPolicy: true }), /at most 10%/);
    // The AI can decline in words without the validator reading it as an offer,
    // and an offer beside a refusal is still checked.
    const facts = (max: number) => ({ channel: "email" as const, businessName: "Acme", publishedPriceText: [], confirmedSlots: [], bookingConfirmed: false, allowedUrls: [], serviceAreaConfirmed: false, commercial: { enabled: max > 0, maxDiscountPercent: max, checkoutLinks: [] } });
    assert.equal(validateResponse("I cannot offer a discount on this plan, but I can walk you through what is included.", facts(0)).ok, true);
    assert.equal(validateResponse("I can't do 20% off, but 10% off the first year is possible.", facts(10)).ok, true);
    assert.equal(validateResponse("I can't do 20% off, but 10% off the first year is possible.", facts(5)).ok, false);
    assert.equal(validateResponse("Happy to do 20% off if you sign today.", facts(10)).ok, false);
  });

  test("objections: legal and contract hand over; security and procurement become a background assist; the rest continue", () => {
    const at = (key: Parameters<typeof policyOnMessage>[0]["objectionKeys"][number]) =>
      policyOnMessage({ text: "x", bindingIntent: null, objectionKeys: [key], commercial: null });
    assert.equal(at("CONTRACT").kind, "HANDOVER");
    assert.equal(at("COMPLIANCE").kind, "HANDOVER");
    const security = at("SECURITY");
    assert.equal(security.kind, "CONTINUE");
    assert.equal(security.kind === "CONTINUE" && security.assist, "SPECIALIST_REVIEW");
    const procurement = at("PROCUREMENT");
    assert.equal(procurement.kind === "CONTINUE" && procurement.assist, "SPECIALIST_REVIEW");
    // A legal question beside a security one still hands over.
    assert.equal(policyOnMessage({ text: "x", bindingIntent: null, objectionKeys: ["SECURITY", "COMPLIANCE"], commercial: null }).kind, "HANDOVER");
    for (const key of ["PRICE", "BUDGET", "TIMING", "COMPETITOR", "AUTHORITY", "FEATURE", "RISK", "NOT_INTERESTED"] as const) {
      const decision = at(key);
      assert.equal(decision.kind, "CONTINUE", key);
      assert.equal(decision.kind === "CONTINUE" && decision.assist, null, key);
    }
  });
});

describe("\"Are you a bot?\" is answered honestly, never handed over", () => {
  test("the classifier reads it as a question, not a request for a person", () => {
    for (const text of ["Are you a bot?", "is this a real person?", "Am I talking to a real person?", "Are you a person or a bot?", "Is it AI answering?"]) {
      assert.equal(isBotQuestion(text), true, text);
      assert.equal(classifyDeterministic(text), null, text);
    }
    for (const text of ["Can I speak to a real person please?", "Are you a bot? I'd rather speak to a person", "real person please"]) {
      assert.equal(classifyDeterministic(text)?.intent, "HUMAN_REQUEST", text);
    }
    assert.equal(isBotQuestion("I want to automate my invoicing"), false);
    // The engine agrees: the question is not a request for a person, the explicit ask is.
    assert.notEqual(plan({ interpretation: reply("Am I talking to a real person?") }).nba.next_action, "ESCALATE");
    assert.equal(plan({ interpretation: reply("Can I speak to a real person please") }).nba.next_action, "ESCALATE");
  });

  test("the policy continues with a disclosure line; the model must never claim to be human", () => {
    const decision = policyOnMessage({ text: "Are you a bot?", bindingIntent: null, objectionKeys: [], commercial: null, botQuestion: true });
    assert.equal(decision.kind, "CONTINUE");
    assert.equal(decision.kind === "CONTINUE" && decision.disclose, true);
    const line = disclosureGuidance("Acme Studio");
    assert.match(line, /Acme Studio's AI assistant/);
    assert.match(line, /a person from the team can join/);
    assert.match(line, /Never claim or imply to be human/);
    const facts = { channel: "sms" as const, businessName: "Acme Studio", publishedPriceText: [], confirmedSlots: [], bookingConfirmed: false, allowedUrls: [], serviceAreaConfirmed: false };
    for (const claim of ["No, I'm a real person.", "I'm not a bot, promise.", "I am not an AI.", "You're talking to a real person here.", "This is a real person."]) {
      const result = validateResponse(claim, facts);
      assert.equal(result.ok, false, claim);
      assert.ok(!result.ok && result.failures.some((f) => f.code === "CLAIMS_TO_BE_HUMAN"), claim);
    }
    assert.equal(validateResponse("I am Acme Studio's AI assistant, and a person from the team can join if you would like.", facts).ok, true);
  });
});

describe("policyOnAnswer: unusable answers and REVIEW verdicts", () => {
  const answer = (matched: boolean, structured = true) => ({ questionId: "q1", matched, structured });

  test("an unmatched answer is clarified, twice, then handed over", () => {
    const first = policyOnAnswer({ text: "stuff", answer: answer(false), verdict: null, handoverOnReview: false, previousClarification: null });
    assert.deepEqual(first, { kind: "CLARIFY", point: "question:q1", attempt: 1 });
    const second = policyOnAnswer({ text: "stuff", answer: answer(false), verdict: null, handoverOnReview: false, previousClarification: { point: "question:q1", attempt: 1 } });
    assert.deepEqual(second, { kind: "CLARIFY", point: "question:q1", attempt: 2 });
    const third = policyOnAnswer({ text: "stuff", answer: answer(false), verdict: null, handoverOnReview: false, previousClarification: { point: "question:q1", attempt: 2 } });
    assert.equal(third.kind, "HANDOVER");
    assert.equal(third.kind === "HANDOVER" && third.trigger, "REPEATED_CLARIFICATION_FAILURE");
    assert.equal(MAX_CLARIFICATIONS, 2);
  });

  test("a clarification on another point starts a fresh count", () => {
    assert.deepEqual(nextClarification({ point: "reply", attempt: 2 }, "question:q1"), { kind: "CLARIFY", point: "question:q1", attempt: 1 });
    assert.deepEqual(nextClarification(null, "reply"), { kind: "CLARIFY", point: "reply", attempt: 1 });
  });

  test("a reply that asks a question is answered, not clarified", () => {
    const decision = policyOnAnswer({ text: "What's the difference between a build and a redesign?", answer: answer(false), verdict: null, handoverOnReview: false, previousClarification: null });
    assert.equal(decision.kind, "CONTINUE");
  });

  test("a free-text question is never 'unmatched'", () => {
    assert.equal(policyOnAnswer({ text: "stuff", answer: answer(false, false), verdict: null, handoverOnReview: false, previousClarification: null }).kind, "CONTINUE");
  });

  test("REVIEW is recorded and flagged for a person; the AI continues", () => {
    const decision = policyOnAnswer({ text: "Under £5k", answer: answer(true), verdict: { result: "REVIEW", reasons: [{ code: "rule_review", questionId: "q1" }] }, handoverOnReview: false, previousClarification: null });
    assert.equal(decision.kind, "CONTINUE");
    assert.equal(decision.kind === "CONTINUE" && decision.assist, "QUALIFICATION_REVIEW");
  });

  test("REVIEW from an unmatched stored answer (the deterministic path) is clarified first", () => {
    const decision = policyOnAnswer({ text: "not sure", answer: { questionId: "q1", matched: false, structured: true }, verdict: { result: "REVIEW", reasons: [{ code: "answer_unmatched", questionId: "q1" }] }, handoverOnReview: false, previousClarification: null });
    assert.equal(decision.kind, "CLARIFY");
  });

  test("a workspace that opted in to hand-over on review still gets it", () => {
    const decision = policyOnAnswer({ text: "Under £5k", answer: answer(true), verdict: { result: "REVIEW", reasons: [{ code: "rule_review", questionId: "q1" }] }, handoverOnReview: true, previousClarification: null });
    assert.equal(decision.kind, "HANDOVER");
    assert.equal(decision.kind === "HANDOVER" && decision.reason, "QUALIFICATION_REVIEW");
  });

  test("the default B2B question's review rule flags, it does not hand over", () => {
    const [service] = defaultQualifyQuestions(["Website Design", "Website Build"]);
    assert.equal(service.questionText, "What do you need help with?");
    assert.equal(service.rule?.result, "review", "the deterministic rule still records REVIEW");
    const question = { id: "q1", responseType: "single_choice" as const, required: true, serviceId: null, options: service.options.map((value) => ({ value })) };
    const rule = { id: "r1", questionId: "q1", ruleType: "answer" as const, operator: "is_present" as const, comparisonValue: [], result: "review" as const, priority: 1 };
    const base = { questions: [question], rules: [rule], serviceId: "s1", serviceIsActive: true, postcode: null, allowedPostcodePrefixes: [], blockedPostcodePrefixes: [] };
    const matched = evaluateQualification({ ...base, answers: [{ questionId: "q1", answerValue: "Website Build", answerText: "Website Build" }] });
    assert.equal(matched.result, "QUALIFIED");
    // Required and unmatched: still awaiting an answer. Optional and unmatched:
    // the review rule records REVIEW. Neither is ever a hand-over by itself.
    const pending = evaluateQualification({ ...base, answers: [{ questionId: "q1", answerValue: null, answerText: "a bit of everything" }] });
    assert.equal(pending.result, "PENDING");
    const unmatched = evaluateQualification({
      ...base,
      questions: [{ ...question, required: false }],
      answers: [{ questionId: "q1", answerValue: null, answerText: "a bit of everything" }],
    });
    assert.equal(unmatched.result, "REVIEW");
    const decision = policyOnAnswer({
      text: "a bit of everything",
      answer: { questionId: "q1", matched: false, structured: true },
      verdict: { result: unmatched.result, reasons: unmatched.reasons },
      handoverOnReview: DEFAULT_AI_BEHAVIOUR.agentHandoverOnReview,
      previousClarification: null,
    });
    assert.equal(decision.kind, "CLARIFY");
  });
});

describe("policyOnDecision: the model's proposal", () => {
  const decide = (extra: Partial<Parameters<typeof policyOnDecision>[0]>) =>
    policyOnDecision({ proposedAction: "REPLY", handoverReason: null, confidence: 0.9, riskTolerance: null, previousClarification: null, ...extra });

  test("low confidence clarifies instead of handing over", () => {
    assert.deepEqual(decide({ confidence: 0.3 }), { kind: "CLARIFY", point: "reply", attempt: 1 });
    assert.equal(decide({ confidence: 0.3, previousClarification: { point: "reply", attempt: 2 } }).kind, "HANDOVER");
    assert.equal(decide({ confidence: 0.9 }).kind, "CONTINUE");
  });

  test("CAUTIOUS clarifies below 0.85; it never hands over for confidence alone", () => {
    assert.deepEqual(decide({ confidence: 0.7, riskTolerance: "CAUTIOUS" }), { kind: "CLARIFY", point: "reply", attempt: 1 });
    assert.equal(decide({ confidence: 0.7, riskTolerance: "BALANCED" }).kind, "CONTINUE");
  });

  test("a model hand-over request is honoured only for a last resort", () => {
    for (const reason of ["HUMAN_REQUESTED", "COMPLAINT", "EMERGENCY", "POLICY"] as const) {
      assert.equal(decide({ proposedAction: "REQUEST_HANDOVER", handoverReason: reason }).kind, "HANDOVER", reason);
    }
    const assists = {
      OUT_OF_SCOPE: "CONFIRM_DETAIL",
      PRICING_NOT_CONFIGURED: "CONFIRM_PRICE",
      READY_TO_BUY: "SEND_ORDER_DETAILS",
      QUALIFICATION_REVIEW: "QUALIFICATION_REVIEW",
      LOW_CONFIDENCE: "CONFIRM_DETAIL",
      HIGH_VALUE: "CONFIRM_DETAIL",
      NO_NEXT_QUESTION: "CONFIRM_DETAIL",
    } as const;
    for (const [reason, assist] of Object.entries(assists)) {
      const decision = decide({ proposedAction: "REQUEST_HANDOVER", handoverReason: reason as never });
      assert.equal(decision.kind, "CONTINUE", reason);
      assert.equal(decision.kind === "CONTINUE" && decision.assist, assist, reason);
    }
    assert.equal(decide({ proposedAction: "REQUEST_HANDOVER", handoverReason: null }).kind, "CONTINUE");
  });

  test("the validator gets three drafts before a hand-over", () => {
    assert.equal(MAX_VALIDATOR_REJECTIONS, 3);
    assert.equal(policyOnCompose(1), "RETRY");
    assert.equal(policyOnCompose(2), "RETRY");
    assert.equal(policyOnCompose(3), "HANDOVER");
  });

  test("confidence tiers: below the floor is UNCLEAR (clarify), never HANDOVER", () => {
    assert.equal(confidenceDecision(0.2), "UNCLEAR");
    assert.equal(confidenceVerdictForTolerance(0.7, "CAUTIOUS"), "UNCLEAR");
    assert.equal(confidenceVerdictForTolerance(0.9, "CAUTIOUS"), "ACT");
  });
});

describe("fixed wording", () => {
  test("clarifying questions: one question, the options named, never 'just'", () => {
    const question = { questionText: "What do you need help with?", responseType: "single_choice" as const, options: ["Website Design", "Website Build", "Ecommerce Website"].map((label) => ({ label, value: label })) };
    for (const attempt of [1, 2] as const) {
      const text = clarifyingQuestion({ question, attempt, firstName: "Sam" });
      assert.equal(countQuestions(text), 1, text);
      assert.match(text, /Website Build/);
      assert.doesNotMatch(text, /\bjust\b|—/i);
    }
    assert.notEqual(clarifyingQuestion({ question, attempt: 1, firstName: null }), clarifyingQuestion({ question, attempt: 2, firstName: null }), "the second attempt is worded differently");
    const open = clarifyingQuestion({ question: null, attempt: 1, firstName: null });
    assert.equal(countQuestions(open), 1);
  });

  test("assist lines promise a colleague, never a time, a price or an outcome", () => {
    for (const reason of ASSIST_REASONS) {
      const line = assistLine(reason, "Sam");
      assert.match(line, /colleague/i, reason);
      assert.doesNotMatch(line, /£|\d+\s?(minutes?|hours?)|today|tomorrow|guarantee/i, reason);
    }
  });
});

/* ============================================================= the engine */

const MSP = resolveOffer({ archetypeKey: "MSP" });
function dim(dimension: DimensionStatusEntry["dimension"], status: DimensionStatusEntry["status"], extra: Partial<DimensionStatusEntry> = {}): DimensionStatusEntry {
  return { dimension, status, fact_ids: [], material: false, required: false, stale: false, ...extra };
}
function plan(extra: Partial<PlanTurnInput> & { goalKey?: GoalKey; intent?: IntentAssessment } = {}) {
  const resolved = extra.resolved ?? MSP;
  const intent = extra.intent ?? intentFixture("MEDIUM", 55);
  const goal = extra.goal ?? resolveGoal({ motion: resolved.motion, offerGoal: extra.goalKey ?? "B_BOOK_MEETING", intentState: intent.state });
  return planNextBestAction({
    now: NOW, channel: "email", stage: "QUALIFYING", resolved, goal, intent, dimensions: [], facts: [],
    engineVerdict: "PENDING", qualificationScore: 40, suppressed: false, interpretation: null, bindingVerdict: null,
    policy: {}, checkoutAllowed: true, bookingScheduled: false, dealValueGbp: null, ...extra,
  });
}
const reply = (text: string) => interpret(text, { messageId: MESSAGE_ID, now: NOW, dimensions: [] });

describe("NBA: only last resorts escalate", () => {
  test("engine REVIEW flags for a person and keeps planning (was ESCALATE QUALIFICATION_REVIEW)", () => {
    const n = plan({ engineVerdict: "REVIEW" }).nba;
    assert.notEqual(n.next_action, "ESCALATE");
    assert.equal(n.assist_reason, "QUALIFICATION_REVIEW");
    assert.ok(nextBestActionSchema.safeParse(n).success);
  });

  test("a reviewInstead disqualifier on a confirmed answer flags, it does not escalate", () => {
    const n = plan({ facts: [fact("COMPANY_SIZE", "3", "CONFIRMED")], dimensions: [dim("COMPANY_SIZE", "CONFIRMED")] }).nba;
    assert.notEqual(n.next_action, "ESCALATE");
    assert.notEqual(n.next_action, "DISQUALIFY", "a review is never a disqualification");
    assert.equal(n.assist_reason, "QUALIFICATION_REVIEW");
  });

  test("a security questionnaire continues with a specialist assist; a contract question still escalates", () => {
    const security = plan({ interpretation: reply("We'd need you to complete our security questionnaire") }).nba;
    assert.notEqual(security.next_action, "ESCALATE");
    assert.equal(security.assist_reason, "SPECIALIST_REVIEW");
    const contract = plan({ interpretation: reply("Can we change the liability terms in your contract?") }).nba;
    assert.equal(contract.next_action, "ESCALATE");
    assert.equal(contract.handover_reason, "POLICY");
  });

  test("a deal above the human-closer value is booked, not escalated", () => {
    const known = [dim("USE_CASE", "CONFIRMED"), dim("COMPANY_SIZE", "CONFIRMED")];
    const n = plan({ dimensions: known, dealValueGbp: 90_000, policy: { humanCloserAboveValue: 50_000 }, goalKey: "E_HUMAN_CLOSER" }).nba;
    assert.equal(n.next_action, "CTA_BOOK");
  });

  test("goal E closes with a meeting: the meeting is the hand-off", () => {
    assert.deepEqual(goalCloseAction("E_HUMAN_CLOSER"), { action: "CTA_BOOK", handoverReason: null });
    const known = [dim("USE_CASE", "CONFIRMED"), dim("COMPANY_SIZE", "CONFIRMED")];
    assert.equal(plan({ dimensions: known, goalKey: "E_HUMAN_CLOSER" }).nba.next_action, "CTA_BOOK");
  });

  test("ready to buy without direct close: the AI keeps going and a colleague sends the details", () => {
    const saas = resolveOffer({ archetypeKey: "PLG_SAAS" });
    const refused = plan({ resolved: saas, intent: intentFixture("PURCHASE_READY", 85), goalKey: "C_DIRECT_SALE", checkoutAllowed: false }).nba;
    assert.notEqual(refused.next_action, "ESCALATE");
    assert.equal(refused.assist_reason, "SEND_ORDER_DETAILS");
  });

  test("nothing worth asking: inform with a soft next step, not a hand-over (was ESCALATE NO_NEXT_QUESTION)", () => {
    const decided = decideNextBestAction({ ...plan().input, candidates: [] });
    assert.equal(decided.rule, "R12_FALLBACK");
    assert.equal(decided.next_action, "INFORM");
  });

  test("still escalates: a person asked for, a complaint, a qualify-only goal, a workspace rule", () => {
    assert.equal(plan({ bindingVerdict: "HUMAN_REQUEST" }).nba.next_action, "ESCALATE");
    assert.equal(plan({ bindingVerdict: "COMPLAINT" }).nba.next_action, "ESCALATE");
    assert.equal(plan({ interpretation: reply("Can I speak to a real person please") }).nba.next_action, "ESCALATE");
    const known = [dim("USE_CASE", "CONFIRMED"), dim("COMPANY_SIZE", "CONFIRMED")];
    assert.equal(plan({ dimensions: known, goalKey: "A_QUALIFY_ONLY" }).nba.next_action, "ESCALATE");
    const inferred = plan({
      facts: [fact("COMPANY_SIZE", "3", "INFERRED")],
      dimensions: [dim("COMPANY_SIZE", "INFERRED", { material: true })],
      policy: { escalationConditions: ["INFERRED_DISQUALIFIER"] },
    }).nba;
    assert.equal(inferred.next_action, "ESCALATE");
  });
});

describe("the enterprise lead ends in a booked meeting with a brief", () => {
  const conversation = JSON.parse(
    readFileSync(path.join(process.cwd(), "tests", "golden-conversations", "enterprise-04-meeting-is-the-handoff.json"), "utf8"),
  ) as GoldenConversation;
  const rows = runConversation(conversation);
  const last = rows[rows.length - 1];

  test("the AI qualifies and never hands over on the way (was ESCALATE READY_TO_BUY at the threshold)", () => {
    for (const row of rows) assert.notEqual(row.action, "ESCALATE", `turn ${row.turn}: ${row.nba.reason}`);
    assert.equal(last.action, "CTA_BOOK");
    assert.equal(last.nba.current_goal, "E_HUMAN_CLOSER");
    assert.equal(planFor(last.nba, { manual: false }).kind, "COMPOSE");
  });

  test("the engine's booking-readiness covers goal E, so the booking can be created", () => {
    // The real gate, as qi-runtime builds it: the motion's booking gate, the
    // offer's required and gating dimensions and every disqualifier dimension.
    const resolved = last.resolved;
    const gate = [
      ...new Set([
        ...MOTIONS.ENTERPRISE.bookingGate,
        ...resolved.requiredDimensions,
        ...(resolved.gatingDimensions ?? []),
        ...resolved.disqualifiers.map((d) => d.dimension),
      ]),
    ];
    const readiness = engineBookingReadiness(last.nba, { gateDimensions: gate, requiredDimensions: [] });
    assert.equal(readiness.ready, true, readiness.reason);
  });

  test("the booked meeting carries the hand-off brief as a background assist", () => {
    assert.equal(assistAfterBooking({ motion: "ENTERPRISE", goal: null }), "MEETING_BRIEF");
    assert.equal(assistAfterBooking({ motion: "BOOK_MEETING_B2B", goal: "E_HUMAN_CLOSER" }), "MEETING_BRIEF");
    assert.equal(assistAfterBooking({ motion: "BOOK_MEETING_B2B", goal: "B_BOOK_MEETING" }), null);
  });

  test("the ENTERPRISE motion's close is a meeting, and the legacy strategy offers one", () => {
    assert.match(MOTIONS.ENTERPRISE.closeTargetDescription, /book a call/i);
    assert.doesNotMatch(MOTIONS.ENTERPRISE.closeTargetDescription, /hand to a person|a person owns it/i);
    const { text } = buildStrategyBlock({
      mode: "QUALIFICATION",
      motion: "ENTERPRISE",
      archetypeKey: null,
      channel: "email",
      selection: { question: null, stopReason: "THRESHOLD_MET", known: [] },
      latestMessage: "Board sign-off after a pilot.",
      hasApprovedInsight: false,
      bookingAvailable: true,
    });
    assert.match(text, /CHECK_AVAILABILITY/);
  });
});

describe("the strategy the model sees", () => {
  test("security: a colleague handles the documents, the conversation stays with the AI", () => {
    const { objection, text } = buildStrategyBlock({
      mode: "OBJECTION_HANDLING",
      motion: "ENTERPRISE",
      archetypeKey: null,
      channel: "email",
      selection: { question: null, stopReason: null, known: [] },
      latestMessage: "We'd need your security questionnaire before anything",
      hasApprovedInsight: false,
      bookingAvailable: true,
    });
    assert.equal(objection?.key, "SECURITY");
    assert.equal(objection?.handoverRequired, false);
    assert.equal(objection?.assistRequired, true);
    assert.doesNotMatch(text, /This is a person's job/);
    assert.match(text, /colleague/i);
  });

  test("an NBA with an assist tells the model to say a colleague will confirm, and carry on", () => {
    const n = plan({ interpretation: reply("We'd need you to complete our security questionnaire") }).nba;
    assert.equal(n.assist_reason, "SPECIALIST_REVIEW");
    const { text } = buildNbaStrategyBlock(
      {
        mode: "QUALIFICATION",
        motion: "BOOK_MEETING_B2B",
        archetypeKey: "MSP",
        channel: "email",
        selection: { question: null, stopReason: null, known: [] },
        latestMessage: null,
        hasApprovedInsight: false,
        bookingAvailable: true,
      },
      n,
      { booking: "SLOTS" },
    );
    assert.match(text, /colleague/i);
    assert.match(text, /carry on/i);
    // A REVIEW is internal: the lead is not told a person is checking them.
    const review = buildNbaStrategyBlock(
      { mode: "QUALIFICATION", motion: "BOOK_MEETING_B2B", archetypeKey: "MSP", channel: "email", selection: { question: null, stopReason: null, known: [] }, latestMessage: null, hasApprovedInsight: false, bookingAvailable: true },
      plan({ engineVerdict: "REVIEW" }).nba,
      { booking: "SLOTS" },
    );
    assert.doesNotMatch(review.text, /colleague/i);
  });

  test("the objection library: legal and contract hand over, security and procurement are assists", () => {
    for (const key of ["COMPLIANCE", "CONTRACT"] as const) assert.equal(OBJECTIONS[key].handover.always, true, key);
    for (const key of ["SECURITY", "PROCUREMENT"] as const) {
      assert.equal(OBJECTIONS[key].handover.always, false, key);
      assert.equal(OBJECTIONS[key].assist?.always, true, key);
    }
    const security = matchObjection("We'd need you to complete our security questionnaire")[0];
    assert.equal(security?.handoverRequired, false);
    assert.equal(security?.assistRequired, true);
  });
});

describe("lifecycle: a REVIEW verdict no longer routes the turn to a person", () => {
  test("REVIEW keeps qualifying, or answers", () => {
    const base = { lifecycle: "REVIEW" as const, eventType: "INBOUND_SMS" as const, intent: "UNKNOWN" as const, bookingEnabled: true };
    assert.equal(resolveMode({ ...base, hasOutstandingQuestions: true }), "QUALIFICATION");
    assert.equal(resolveMode({ ...base, hasOutstandingQuestions: false }), "GENERAL_ENQUIRY");
    assert.equal(resolveMode({ ...base, intent: "HUMAN_REQUEST", hasOutstandingQuestions: false }), "HUMAN_HANDOVER", "an explicit request still hands over");
  });
});

describe("defaults for new and existing workspaces", () => {
  test("hand-over on review is OFF", () => {
    assert.equal(DEFAULT_AI_BEHAVIOUR.agentHandoverOnReview, false);
    const parsed = saveAiBehaviourSchema.parse({
      enabled: true, tone: "professional", replyLength: "short", allowAiReply: false, allowAiInterpretation: true,
    });
    assert.equal(parsed.agentHandoverOnReview, false);
  });

  test("risk tolerance is BALANCED, and CAUTIOUS is described as clarifying, not handing over", () => {
    assert.equal(DEFAULT_SELLING_PREFERENCES.riskTolerance, "BALANCED");
    assert.doesNotMatch(RISK_TOLERANCE_COPY.CAUTIOUS.description, /hand the conversation/i);
  });

  test("a migration after the highest number moves existing workspaces to the new defaults", () => {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const file = readdirSync(dir).find((name) => /ai_carries_the_weight/.test(name));
    assert.ok(file, "migration present");
    const sql = readFileSync(path.join(dir, file!), "utf8");
    assert.match(sql, /alter column agent_handover_on_review set default false/i);
    assert.match(sql, /update public\.business_ai_settings\s+set agent_handover_on_review = false/i);
    assert.match(sql, /riskTolerance/);
    assert.match(sql, /'"BALANCED"'/);
    assert.ok(existsSync(path.join(dir, file!)));
  });
});
