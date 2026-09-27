import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { decideNextBestAction, nba, planNextBestAction, pursues, type PlanTurnInput } from "../src/lib/qualification-intelligence/nba.ts";
import { resolveOffer } from "../src/lib/qualification-intelligence/offer-profile.ts";
import {
  deriveConversationStage,
  goalCloseAction,
  goalForConversionType,
  goalMotion,
  resolveGoal,
} from "../src/lib/qualification-intelligence/goals.ts";
import {
  QUESTION_INTENTS,
  buildCandidates,
  clarifyIntentFor,
  evaluatePredicate,
  intentByKey,
  intentFromConfiguredQuestion,
  renderIntent,
  verifyIntentFor,
} from "../src/lib/qualification-intelligence/question-intents.ts";
import { interpret } from "../src/lib/qualification-intelligence/interpret.ts";
import {
  CUSTOM_INTENT_KEY_PATTERN,
  EXTRACTOR_KEYS,
  LIBRARY_INTENT_KEY_PATTERN,
  NBA_ACTIONS,
  NBA_RULES,
  QI_CHANNELS,
  QI_DIMENSION_KEYS,
  nextBestActionSchema,
  type DimensionStatusEntry,
  type GoalKey,
  type IntentAssessment,
} from "../src/lib/qualification-intelligence/types.ts";
import { fact, intentFixture, MESSAGE_ID, NOW } from "./qualification-intel/matrix.ts";

const MSP = resolveOffer({ archetypeKey: "MSP" });
const Q_ID = "33333333-3333-4333-8333-333333333333";

function dim(dimension: DimensionStatusEntry["dimension"], status: DimensionStatusEntry["status"], extra: Partial<DimensionStatusEntry> = {}): DimensionStatusEntry {
  return { dimension, status, fact_ids: [], material: false, required: false, stale: false, ...extra };
}

function plan(extra: Partial<PlanTurnInput> & { goalKey?: GoalKey; intent?: IntentAssessment } = {}) {
  const resolved = extra.resolved ?? MSP;
  const intent = extra.intent ?? intentFixture("MEDIUM", 55);
  const goal = extra.goal ?? resolveGoal({ motion: resolved.motion, offerGoal: extra.goalKey ?? "B_BOOK_MEETING", intentState: intent.state });
  return planNextBestAction({
    now: NOW,
    channel: "email",
    stage: "QUALIFYING",
    resolved,
    goal,
    intent,
    dimensions: [],
    facts: [],
    engineVerdict: "PENDING",
    qualificationScore: 40,
    suppressed: false,
    interpretation: null,
    bindingVerdict: null,
    policy: {},
    checkoutAllowed: true,
    bookingScheduled: false,
    dealValueGbp: null,
    ...extra,
  });
}

const reply = (text: string, dimensions: DimensionStatusEntry[] = []) => interpret(text, { messageId: MESSAGE_ID, now: NOW, dimensions });

describe("NBA: contract", () => {
  test("every rule and action is reachable in this suite's vocabulary", () => {
    assert.equal(NBA_RULES.length, 12);
    assert.ok(NBA_ACTIONS.includes("WAIT") && NBA_ACTIONS.includes("NO_ACTION"));
    assert.equal(nba, decideNextBestAction, "nba() is the orchestrator's alias");
  });

  test("the output always validates against nextBestActionSchema", () => {
    const result = plan().nba;
    assert.doesNotThrow(() => nextBestActionSchema.parse(result));
    assert.equal(result.engine_version, "nba-1");
  });
});

describe("NBA: rules R1-R12, first match wins", () => {
  test("R1 a binding verdict: opt-out suppresses and sends nothing, no model call", () => {
    const n = plan({ bindingVerdict: "UNSUBSCRIBE", interpretation: reply("STOP") }).nba;
    assert.equal(n.rule, "R1_BINDING_VERDICT");
    assert.equal(n.next_action, "NO_ACTION");
    assert.equal(n.suppress, true);
    assert.equal(n.model_call_required, false);
    const human = plan({ bindingVerdict: "HUMAN_REQUEST" }).nba;
    assert.equal(human.next_action, "ESCALATE");
    assert.equal(human.handover_reason, "HUMAN_REQUESTED");
    assert.equal(plan({ bindingVerdict: "COMPLAINT" }).nba.handover_reason, "COMPLAINT");
  });

  test("R2 NEGATIVE intent or suppression: never pursued; DISQUALIFY only under goal G", () => {
    const negative = plan({ intent: intentFixture("NEGATIVE", 5) }).nba;
    assert.equal(negative.rule, "R2_NEGATIVE_OR_SUPPRESSED");
    assert.equal(negative.next_action, "NO_ACTION");
    assert.equal(plan({ suppressed: true }).nba.next_action, "NO_ACTION");
    assert.equal(plan({ intent: intentFixture("NEGATIVE", 5), goalKey: "G_DISQUALIFY" }).nba.next_action, "DISQUALIFY");
  });

  test("R3 engine NOT_QUALIFIED disqualifies; a confirmed disqualifier disqualifies (and suppresses when told to)", () => {
    const engine = plan({ engineVerdict: "NOT_QUALIFIED" }).nba;
    assert.equal(engine.next_action, "DISQUALIFY");
    const policy = {
      disqualifiers: [
        { dimension: "COMPANY_SIZE" as const, when: { op: "lt" as const, dimension: "COMPANY_SIZE" as const, value: 2 }, reason: "Sole trader", reviewInstead: false, suppress: true },
      ],
    };
    const confirmed = plan({
      policy,
      resolved: resolveOffer({ archetypeKey: "MSP", workspacePolicy: policy }),
      facts: [fact("COMPANY_SIZE", "1", "CONFIRMED")],
      dimensions: [dim("COMPANY_SIZE", "CONFIRMED")],
    }).nba;
    assert.equal(confirmed.rule, "R3_DISQUALIFIED");
    assert.equal(confirmed.next_action, "DISQUALIFY");
    assert.equal(confirmed.suppress, true);
  });

  // Owner decision 2026-09-27 (human hand-over is the last resort): a reviewInstead
  // disqualifier is flagged for a person and the plan carries on (was ESCALATE
  // QUALIFICATION_REVIEW).
  test("R3 a reviewInstead disqualifier is flagged for a person; the library default is REVIEW", () => {
    const n = plan({ facts: [fact("COMPANY_SIZE", "3", "CONFIRMED")], dimensions: [dim("COMPANY_SIZE", "CONFIRMED")] }).nba;
    assert.notEqual(n.next_action, "ESCALATE");
    assert.notEqual(n.next_action, "DISQUALIFY");
    assert.equal(n.handover_reason, null);
    assert.equal(n.assist_reason, "QUALIFICATION_REVIEW");
  });

  test("R3 a disqualifier on an INFERRED fact asks a VERIFY question first, never disqualifies", () => {
    const n = plan({
      facts: [fact("COMPANY_SIZE", "3", "INFERRED")],
      dimensions: [dim("COMPANY_SIZE", "INFERRED", { material: true })],
    }).nba;
    assert.equal(n.rule, "R3_DISQUALIFIED");
    assert.equal(n.next_action, "ASK");
    assert.equal(n.question_intent?.purpose, "VERIFY");
    assert.equal(n.question_intent?.key, "COMPANY_SIZE.VERIFY");
    assert.match(n.question_intent!.rendering, /3/);
    const escalate = plan({
      facts: [fact("COMPANY_SIZE", "3", "INFERRED")],
      dimensions: [dim("COMPANY_SIZE", "INFERRED", { material: true })],
      policy: { escalationConditions: ["INFERRED_DISQUALIFIER"] },
    }).nba;
    assert.equal(escalate.next_action, "ESCALATE");
  });

  // Owner decision 2026-09-27 (human hand-over is the last resort): R4 escalates only
  // for a last resort. A security question, an engine REVIEW and a high-value
  // deal used to escalate; they now carry on (a security step and a REVIEW
  // raise an assist, a high-value deal closes with a meeting).
  test("R4 escalations: a person asked for, a contract question; security, REVIEW and high value carry on", () => {
    assert.equal(plan({ interpretation: reply("Can I speak to a real person please") }).nba.handover_reason, "HUMAN_REQUESTED");
    const contract = plan({ interpretation: reply("Can we change the liability terms in your contract?") }).nba;
    assert.equal(contract.rule, "R4_ESCALATE");
    assert.equal(contract.handover_reason, "POLICY");
    const security = plan({ interpretation: reply("We'd need you to complete our security questionnaire") }).nba;
    assert.notEqual(security.next_action, "ESCALATE");
    assert.equal(security.assist_reason, "SPECIALIST_REVIEW");
    const review = plan({ engineVerdict: "REVIEW" }).nba;
    assert.notEqual(review.next_action, "ESCALATE");
    assert.equal(review.assist_reason, "QUALIFICATION_REVIEW");
    const value = plan({ dealValueGbp: 90_000, policy: { humanCloserAboveValue: 50_000 } }).nba;
    assert.notEqual(value.next_action, "ESCALATE");
    assert.equal(value.handover_reason, null);
  });

  test("R5 the lead asked a question: ANSWER, or ANSWER_AND_ASK when a question is worth >= 0.4", () => {
    const n = plan({ interpretation: reply("Do you cover Manchester?") }).nba;
    assert.equal(n.rule, "R5_LEAD_ASKED");
    assert.equal(n.next_action, "ANSWER_AND_ASK");
    assert.ok(n.question_value!.total >= 0.4);
    const done = plan({
      interpretation: reply("Do you cover Manchester?"),
      dimensions: [dim("USE_CASE", "CONFIRMED"), dim("COMPANY_SIZE", "CONFIRMED"), dim("PROBLEM", "CONFIRMED")],
    }).nba;
    assert.equal(done.next_action, "ANSWER", "threshold met: answer and ask nothing");
    assert.equal(done.question_intent, null);
  });

  test("R6 NOT_NOW waits until resume_at, with no model call", () => {
    const resumeAt = "2026-12-01T09:00:00.000Z";
    const n = plan({ intent: intentFixture("NOT_NOW", 20, { resumeAt }) }).nba;
    assert.equal(n.rule, "R6_NOT_NOW");
    assert.equal(n.next_action, "WAIT");
    assert.equal(n.resume_at, resumeAt);
    assert.equal(n.current_goal, "F_NURTURE", "NOT_NOW routes to nurture (goal F)");
    assert.equal(n.model_call_required, false);
  });

  test("R7 BOOKING_READY + goal B: CTA_BOOK, with at most one gating question", () => {
    const gated = plan({ intent: intentFixture("BOOKING_READY", 80), interpretation: reply("Can we book a call for Thursday?") }).nba;
    assert.equal(gated.rule, "R7_BOOKING_READY");
    assert.equal(gated.next_action, "CTA_BOOK");
    assert.equal(gated.question_intent?.dimension, "COMPANY_SIZE", "MSP gates on headcount");
    const clear = plan({
      intent: intentFixture("BOOKING_READY", 80),
      dimensions: [dim("COMPANY_SIZE", "CONFIRMED")],
      facts: [fact("COMPANY_SIZE", "40", "CONFIRMED")],
    }).nba;
    assert.equal(clear.next_action, "CTA_BOOK");
    assert.equal(clear.question_intent, null, "no optional question slows a ready buyer");
  });

  // Owner decision 2026-09-27 (human hand-over is the last resort): a refused
  // checkout keeps the conversation with the AI and asks a colleague to send
  // the details (was ESCALATE READY_TO_BUY).
  test("R8 PURCHASE_READY + goal C/D: checkout or signup; refused checkout is an assisted close", () => {
    const saas = resolveOffer({ archetypeKey: "PLG_SAAS" });
    assert.equal(plan({ resolved: saas, intent: intentFixture("PURCHASE_READY", 85), goalKey: "D_SIGNUP_TRIAL" }).nba.next_action, "CTA_SIGNUP");
    assert.equal(plan({ resolved: saas, intent: intentFixture("PURCHASE_READY", 85), goalKey: "C_DIRECT_SALE" }).nba.next_action, "CTA_CHECKOUT");
    const refused = plan({ resolved: saas, intent: intentFixture("PURCHASE_READY", 85), goalKey: "C_DIRECT_SALE", checkoutAllowed: false }).nba;
    assert.equal(refused.next_action, "INFORM");
    assert.equal(refused.handover_reason, null);
    assert.equal(refused.assist_reason, "SEND_ORDER_DETAILS");
  });

  test("R9 asks the single best question while the threshold is unmet", () => {
    const n = plan().nba;
    assert.equal(n.rule, "R9_ASK");
    assert.equal(n.next_action, "ASK");
    assert.ok(n.question_intent);
    assert.equal((n.question_intent!.rendering.match(/\?/g) ?? []).length, 1, "one primary question");
    assert.ok(n.question_value!.total >= 0.25);
    assert.ok(n.alternatives.length <= 5);
  });

  test("R10 threshold met: the goal's close, never another question", () => {
    const known = [dim("USE_CASE", "CONFIRMED"), dim("COMPANY_SIZE", "CONFIRMED")];
    assert.equal(plan({ dimensions: known }).nba.next_action, "CTA_BOOK");
    const qualifyOnly = plan({ dimensions: known, goalKey: "A_QUALIFY_ONLY" }).nba;
    assert.equal(qualifyOnly.next_action, "ESCALATE");
    assert.equal(qualifyOnly.handover_reason, "POLICY");
    assert.equal(plan({ dimensions: known, bookingScheduled: true }).nba.next_action, "NO_ACTION");
    const gated = plan({ dimensions: known, policy: { thresholds: { booking: { minIntentState: "HIGH" } } }, intent: intentFixture("LOW", 15), interpretation: reply("ok") }).nba;
    assert.equal(gated.next_action, "INFORM", "the booking threshold holds the CTA back for a low-intent lead");
  });

  test("R11 low intent with nothing worth asking: INFORM when they wrote, WAIT when silent", () => {
    const known = [dim("USE_CASE", "CONFIRMED"), dim("COMPANY_SIZE", "CONFIRMED")];
    const policy = { thresholds: { booking: { minIntentState: "MEDIUM" as const } } };
    assert.equal(plan({ dimensions: known, policy, intent: intentFixture("LOW", 12), interpretation: reply("ok") }).nba.next_action, "INFORM");
    const silent = plan({ dimensions: known, policy, intent: intentFixture("NO_DETECTED_INTENT", 0) }).nba;
    assert.equal(silent.next_action, "WAIT");
    assert.ok(silent.resume_at);
  });

  // Owner decision 2026-09-27 (human hand-over is the last resort): with nothing
  // worth asking the AI informs with a soft next step (was ESCALATE
  // NO_NEXT_QUESTION).
  test("R12 nothing applies: inform with a soft next step; nurture keeps in touch", () => {
    const empty = resolveOffer({ archetypeKey: "MSP", workspacePolicy: { forbiddenQuestionIntents: [] } });
    const n = decideNextBestAction({ ...plan().input, candidates: [], resolved: undefined } as never);
    assert.equal(n.rule, "R12_FALLBACK");
    assert.equal(n.next_action, "INFORM");
    assert.equal(n.handover_reason, null);
    const nurture = plan({ resolved: empty, goalKey: "F_NURTURE" }).nba;
    assert.equal(nurture.next_action, "NURTURE", "nurture never restarts discovery");
  });

  test("a question just answered in this reply is never asked in the same turn", () => {
    const n = plan({ interpretation: reply("We've got 45 staff") }).nba;
    assert.notEqual(n.question_intent?.dimension, "COMPANY_SIZE");
  });

  test("a branch opened by the answer is followed (adaptive tree)", () => {
    const i = interpret("Our IT provider handles it", {
      messageId: MESSAGE_ID,
      now: NOW,
      currentIntent: intentByKey("CURRENT_SOLUTION.IT_PROVIDER"),
      context: { incumbentTerms: ["it provider"] },
    });
    assert.equal(i.answered_intent_key, "CURRENT_SOLUTION.IT_PROVIDER");
    const n = plan({ interpretation: i, dimensions: [dim("USE_CASE", "CONFIRMED"), dim("PROBLEM", "CONFIRMED")] }).nba;
    assert.equal(n.question_intent?.key, "TIMING.CONTRACT_RENEWAL", "the renewal follows the incumbent");
  });
});

describe("goals A-G", () => {
  test("resolution order: state > lead > offer > policy > workspace default > motion", () => {
    assert.equal(resolveGoal({ motion: "BOOK_MEETING_B2B" }).source, "MOTION");
    assert.equal(resolveGoal({ motion: "BOOK_MEETING_B2B", workspaceDefaultGoal: { type: "DIRECT_PURCHASE", qualificationRequired: true } }).goal, "C_DIRECT_SALE");
    assert.equal(resolveGoal({ motion: "BOOK_MEETING_B2B", policyGoal: "A_QUALIFY_ONLY", workspaceDefaultGoal: { type: "DIRECT_PURCHASE", qualificationRequired: true } }).goal, "A_QUALIFY_ONLY");
    assert.equal(resolveGoal({ motion: "BOOK_MEETING_B2B", offerGoal: "E_HUMAN_CLOSER", policyGoal: "A_QUALIFY_ONLY" }).goal, "E_HUMAN_CLOSER");
    const lead = resolveGoal({ motion: "BOOK_MEETING_B2B", lead: { conversionGoalType: "DIRECT_SIGNUP" }, offerGoal: "E_HUMAN_CLOSER" });
    assert.equal(lead.goal, "D_SIGNUP_TRIAL");
    assert.equal(lead.source, "LEAD_CONVERSION_GOAL");
    assert.equal(lead.motion, "SAAS_SELF_SERVE", "the goal's own motion when the workspace motion does not fit");
    assert.equal(resolveGoal({ motion: "BOOK_MEETING_B2B", engineVerdict: "NOT_QUALIFIED", offerGoal: "B_BOOK_MEETING" }).goal, "G_DISQUALIFY");
    assert.equal(resolveGoal({ motion: "BOOK_MEETING_B2B", intentState: "NOT_NOW" }).goal, "F_NURTURE");
  });

  test("CD-16: HUMAN_HANDOVER / CUSTOM are A only with qualification_required, else E", () => {
    assert.equal(goalForConversionType("HUMAN_HANDOVER", true), "A_QUALIFY_ONLY");
    assert.equal(goalForConversionType("HUMAN_HANDOVER", false), "E_HUMAN_CLOSER");
    assert.equal(goalForConversionType("CUSTOM", false), "E_HUMAN_CLOSER");
    assert.equal(goalForConversionType("PHONE_CALL", false), "B_BOOK_MEETING");
  });

  test("a deal above the human-closer value upgrades B/C/D to E, never A/F/G", () => {
    assert.equal(resolveGoal({ motion: "BOOK_MEETING_B2B", dealValueGbp: 60_000, humanCloserAboveValue: 50_000 }).goal, "E_HUMAN_CLOSER");
    assert.equal(resolveGoal({ motion: "BOOK_MEETING_B2B", policyGoal: "A_QUALIFY_ONLY", dealValueGbp: 60_000, humanCloserAboveValue: 50_000 }).goal, "A_QUALIFY_ONLY");
  });

  test("close actions and motions", () => {
    assert.deepEqual(goalCloseAction("B_BOOK_MEETING"), { action: "CTA_BOOK", handoverReason: null });
    // Owner decision 2026-09-27 (human hand-over is the last resort): goal E closes with a booked
    // meeting, which is the hand-off (was ESCALATE READY_TO_BUY).
    assert.deepEqual(goalCloseAction("E_HUMAN_CLOSER"), { action: "CTA_BOOK", handoverReason: null });
    assert.equal(goalMotion("F_NURTURE", "ENTERPRISE"), "ENTERPRISE");
    assert.equal(goalMotion("C_DIRECT_SALE", "BOOK_MEETING_B2B"), "ECOMMERCE_DIRECT");
  });

  test("the real stage (defect F2)", () => {
    assert.equal(deriveConversationStage({ firstRepliedAt: null }), "NEW");
    assert.equal(deriveConversationStage({ firstRepliedAt: NOW }), "ENGAGED");
    assert.equal(deriveConversationStage({ firstRepliedAt: NOW, answeredCount: 2 }), "QUALIFYING");
    assert.equal(deriveConversationStage({ firstRepliedAt: NOW, leadStatus: "QUALIFIED" }), "CLOSING");
    assert.equal(deriveConversationStage({ firstRepliedAt: NOW, leadStatus: "BOOKED" }), "POST_BOOKING");
    assert.equal(deriveConversationStage({ firstRepliedAt: null, explicit: "OBJECTION" }), "OBJECTION");
  });
});

describe("question-intent library", () => {
  test("every intent is well formed: key pattern, dimension, extractor, channels, one question per rendering", () => {
    for (const intent of QUESTION_INTENTS) {
      assert.match(intent.key, LIBRARY_INTENT_KEY_PATTERN, intent.key);
      assert.ok((QI_DIMENSION_KEYS as readonly string[]).includes(intent.dimension), intent.key);
      assert.ok(intent.key.startsWith(`${intent.dimension}.`), `${intent.key} is filed under its dimension`);
      assert.ok((EXTRACTOR_KEYS as readonly string[]).includes(intent.extractor), intent.key);
      for (const channel of intent.channels) assert.ok((QI_CHANNELS as readonly string[]).includes(channel));
      for (const [name, text] of Object.entries(intent.renderings)) {
        if (!text) continue;
        assert.equal((text.match(/\?/g) ?? []).length, 1, `${intent.key}.${name}: "${text}"`);
        assert.ok(text.length <= 300);
      }
      for (const branch of intent.branches) {
        if (branch.next !== "CTA" && branch.next !== "ESCALATE") assert.ok(intentByKey(branch.next), `${intent.key} -> ${branch.next}`);
      }
    }
  });

  test("every one of the 26 dimensions has a discovery intent; B2B types have their own wording", () => {
    for (const dimension of QI_DIMENSION_KEYS) {
      assert.ok(QUESTION_INTENTS.some((i) => i.dimension === dimension && !i.appliesTo.archetypes), dimension);
    }
    for (const key of ["COMPANY_SIZE.MSP", "PROBLEM.MARKETING_AGENCY", "PROJECT_SCOPE.CREATIVE_WEB_STUDIO", "SERVICE_NEEDED.ACCOUNTING", "USE_CASE.B2B_SAAS"]) {
      assert.ok(intentByKey(key), key);
    }
  });

  test("channel renderings: SMS short form, email, social for LinkedIn, default in conversation", () => {
    const intent = intentByKey("PROBLEM.PROMPT")!;
    assert.equal(renderIntent(intent, "sms"), intent.renderings.sms);
    assert.equal(renderIntent(intent, "whatsapp"), intent.renderings.sms);
    assert.equal(renderIntent(intent, "email"), intent.renderings.email);
    assert.equal(renderIntent(intent, "linkedin"), intent.renderings.social);
    assert.equal(renderIntent(intent, null), intent.renderings.default);
  });

  test("VERIFY and CLARIFY intents are synthesised with the value in the wording", () => {
    const verify = verifyIntentFor("COMPANY_SIZE", "40");
    assert.equal(verify.purpose, "VERIFY");
    assert.match(verify.renderings.default, /40 staff/);
    const clarify = clarifyIntentFor("TIMING", ["next month", "in the summer"]);
    assert.equal(clarify.purpose, "CLARIFY");
    assert.match(clarify.renderings.default, /next month or in the summer/);
  });

  test("a configured question becomes its library intent or a custom:<id> intent", () => {
    const base = { id: Q_ID, questionText: "How many people work there?", position: 1, responseType: "number" as const, required: true, serviceId: null, options: [] };
    const custom = intentFromConfiguredQuestion(base, "COMPANY_SIZE");
    assert.match(custom.key, CUSTOM_INTENT_KEY_PATTERN);
    assert.equal(custom.dimension, "COMPANY_SIZE");
    assert.equal(custom.required, true);
    const unmapped = intentFromConfiguredQuestion({ ...base, questionText: "Anything else?" }, null);
    assert.equal(unmapped.dimension, "UNMAPPED");
    const adopted = intentFromConfiguredQuestion({ ...base, intentKey: "COMPANY_SIZE.STAFF" }, null);
    assert.equal(adopted.key, "COMPANY_SIZE.STAFF");
    assert.equal(adopted.renderings.default, base.questionText, "its own wording is the rendering");
  });

  test("predicates evaluate without eval, and unknown values never satisfy a comparison", () => {
    const values = new Map([["COMPANY_SIZE" as const, { status: "CONFIRMED" as const, value: "45 staff", normalised: "45" }]]);
    assert.equal(evaluatePredicate({ op: "gt", dimension: "COMPANY_SIZE", value: 40 }, { values }), true);
    assert.equal(evaluatePredicate({ op: "lt", dimension: "TEAM_SIZE", value: 40 }, { values }), false);
    assert.equal(evaluatePredicate({ op: "all", of: [{ op: "known", dimension: "COMPANY_SIZE" }, { op: "not", of: { op: "known", dimension: "BUDGET" } }] }, { values }), true);
    assert.equal(evaluatePredicate({ op: "intentIn", states: ["HIGH"] }, { values, intentState: "HIGH" }), true);
  });
});

describe("candidates: the hierarchy and the rules that filter it", () => {
  const baseCtx = {
    resolved: MSP,
    goal: "B_BOOK_MEETING" as const,
    stage: "QUALIFYING" as const,
    channel: "email" as const,
    intentState: "MEDIUM" as const,
    dimensions: [] as DimensionStatusEntry[],
  };

  test("CONFIRMED dimensions are never candidates; INFERRED material ones are verified; conflicts clarified", () => {
    const { candidates } = buildCandidates({
      ...baseCtx,
      dimensions: [dim("USE_CASE", "CONFIRMED"), dim("AUTHORITY", "INFERRED", { material: true }), dim("TIMING", "CONFLICTING"), dim("PROBLEM", "INFERRED")],
    });
    assert.ok(!candidates.some((c) => c.dimension === "USE_CASE"));
    assert.ok(!candidates.some((c) => c.dimension === "PROBLEM"), "a non-material inference is not asked");
    assert.equal(candidates.find((c) => c.dimension === "AUTHORITY")?.purpose, "VERIFY");
    assert.equal(candidates.find((c) => c.dimension === "TIMING")?.purpose, "CLARIFY");
  });

  test("one intent per dimension, the most specific: the MSP wording beats the generic one", () => {
    const { candidates } = buildCandidates(baseCtx);
    const dims = candidates.map((c) => c.dimension);
    assert.equal(new Set(dims).size, dims.length);
    assert.equal(candidates.find((c) => c.dimension === "COMPANY_SIZE")?.key, "COMPANY_SIZE.MSP");
  });

  test("budget waits for a problem; authority waits for engagement", () => {
    const early = buildCandidates({ ...baseCtx, resolved: resolveOffer({ archetypeKey: "MARKETING_AGENCY" }), stage: "NEW" }).candidates;
    assert.ok(!early.some((c) => c.dimension === "BUDGET"));
    assert.ok(!early.some((c) => c.dimension === "AUTHORITY"));
    const later = buildCandidates({ ...baseCtx, resolved: resolveOffer({ archetypeKey: "MARKETING_AGENCY" }), dimensions: [dim("PROBLEM", "CONFIRMED")] }).candidates;
    assert.ok(later.some((c) => c.dimension === "BUDGET"));
  });

  test("forbidden intents and FORBID overrides are removed; REWORD and REQUIRE apply", () => {
    const forbidden = buildCandidates({ ...baseCtx, resolved: resolveOffer({ archetypeKey: "MSP", workspacePolicy: { forbiddenQuestionIntents: ["PROBLEM.MSP"] } }) });
    assert.notEqual(forbidden.candidates.find((c) => c.dimension === "PROBLEM")?.key, "PROBLEM.MSP");
    const overridden = buildCandidates({
      ...baseCtx,
      intentOverrides: {
        "COMPANY_SIZE.MSP": { action: "REWORD", renderings: { default: "Roughly how many laptops and people?" } },
        "PROBLEM.MSP": { action: "FORBID" },
      },
    });
    assert.equal(overridden.candidates.find((c) => c.key === "COMPANY_SIZE.MSP")?.renderings.default, "Roughly how many laptops and people?");
    assert.ok(!overridden.candidates.some((c) => c.key === "PROBLEM.MSP"));
    assert.ok(overridden.excluded.some((e) => e.key === "PROBLEM.MSP"));
  });

  test("an intent asked twice without an answer is not a candidate again: a different intent or none", () => {
    const { candidates, excluded } = buildCandidates({ ...baseCtx, askHistory: [{ key: "COMPANY_SIZE.MSP", asked: 2, answered: false }] });
    assert.ok(!candidates.some((c) => c.key === "COMPANY_SIZE.MSP"));
    assert.ok(excluded.some((e) => e.key === "COMPANY_SIZE.MSP"));
    const other = candidates.find((c) => c.dimension === "COMPANY_SIZE");
    if (other) assert.notEqual(other.wordingFamily, "COMPANY_SIZE.MSP", "a different wording, not a third ask");
  });

  test("the local-service hierarchy never produces enterprise-checklist, authority or budget intents", () => {
    const { candidates } = buildCandidates({ ...baseCtx, resolved: resolveOffer({ archetypeKey: "ROOFER" }), stage: "CLOSING" });
    for (const c of candidates) assert.ok(!["STAKEHOLDERS", "DECISION_PROCESS", "SUCCESS_METRICS", "AUTHORITY", "BUDGET"].includes(c.dimension), c.key);
    assert.ok(candidates.some((c) => c.dimension === "LOCATION"));
  });

  test("configured questions join the candidates, and unmapped ones are still asked", () => {
    const { candidates } = buildCandidates({
      ...baseCtx,
      configuredQuestions: [
        { id: Q_ID, questionText: "Anything else we should know first?", position: 1, responseType: "text", required: true, serviceId: null, options: [] },
      ],
    });
    assert.ok(candidates.some((c) => c.questionId === Q_ID && c.dimension === "UNMAPPED"));
  });
});

describe("pursuit", () => {
  test("pursues() covers asking, pitching, informing and nurturing", () => {
    for (const action of ["ASK", "ANSWER_AND_ASK", "CTA_BOOK", "CTA_CHECKOUT", "CTA_SIGNUP", "INFORM", "NURTURE"] as const) assert.equal(pursues(action), true, action);
    for (const action of ["ANSWER", "ESCALATE", "WAIT", "DISQUALIFY", "NO_ACTION"] as const) assert.equal(pursues(action), false, action);
  });
});
