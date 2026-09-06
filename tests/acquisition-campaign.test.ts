import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STEP_DELAYS_DAYS,
  ESTIMATE_BANDS,
  GRADES,
  MAX_SEQUENCE_STEPS,
  WIZARD_STEP_KEYS,
  campaignDraftSchema,
  defaultOptimizationConfig,
  defaultSuccessEvent,
  emptyDraft,
  estimateResults,
  furthestValidStep,
  gradesAtOrAbove,
  optimizationAllowed,
  optimizationConfigSchema,
  parseDraft,
  replyActionFor,
  successEventCompatible,
  unknownMergeFields,
  validateAll,
  validateAudience,
  validateBudget,
  validateGoal,
  validateIntentScore,
  validateOutreach,
  type BudgetCeilings,
  type CampaignDraft,
} from "../src/lib/outreach/campaign-draft.ts";
import {
  autoPauseReason,
  allowedTransitions,
  canTransition,
  CampaignTransitionError,
  assertTransition,
  type AutoPauseSignals,
} from "../src/lib/outreach/campaign-state.ts";
import {
  effectiveFreshnessDays,
  eligibilityRules,
  evaluateEligibility,
  type EligibilityCandidate,
} from "../src/lib/outreach/campaign-eligibility.ts";
import {
  evaluateLaunch,
  launchBlocked,
  reviewCompleteness,
  type LaunchFacts,
} from "../src/lib/outreach/campaign-validation.ts";
import { summariseCampaignBudget } from "../src/lib/outreach/campaign-budget.ts";

/**
 * The acquisition campaign wizard's decision layer.
 *
 * These tests are about what must remain true when something misbehaves — a
 * stored draft from an older version, a crafted payload, a race between two
 * launches — rather than about a particular configuration producing a
 * particular number. The parts that decide who gets emailed live in pure
 * modules precisely so they can be tested without a database.
 */

const CEILINGS: BudgetCeilings = {
  prospectsRemaining: 4000,
  prospectsLimit: 5000,
  dailyContactMax: 200,
  monthlyContactsRemaining: 4000,
  monthlyContactsLimit: 5000,
  providerCeilingMinor: 200_000,
  communicationRemaining: 9000,
  communicationLimit: 10_000,
  overageAvailable: false,
};

/** A draft that passes every step, as a baseline to break in each test. */
function completeDraft(): CampaignDraft {
  const draft = emptyDraft();

  draft.goal = {
    campaignName: "Property managers – Bournemouth outreach",
    conversionGoal: "REQUEST_QUOTE",
    primaryServiceId: "11111111-1111-4111-8111-111111111111",
    successEvent: "QUOTE_REQUESTED",
  };
  draft.audience.locations = ["Bournemouth"];
  draft.audience.industries = ["Property Management"];
  draft.audience.roles = ["Property Manager"];
  draft.intentScore.minimumGrade = "A";
  draft.outreach.senderIdentityId = "22222222-2222-4222-8222-222222222222";
  draft.outreach.steps = DEFAULT_STEP_DELAYS_DAYS.map((delayDays, index) => ({
    position: index + 1,
    delayDays,
    subject: `Step ${index + 1} subject`,
    body: "Hi {{first_name}}, I came across {{company_name}} and wanted to ask about your roofing.",
    enabled: true,
  }));
  draft.budget = {
    prospectsPerRun: 1000,
    dailyContacts: 50,
    monthlyContacts: 1000,
    providerCostCeilingMinor: 50_000,
    communicationAllowance: 1000,
    autoOverage: false,
    autoOptimize: false,
  };

  return draft;
}

/* ------------------------------------------------------------------ draft */

describe("campaign draft", () => {
  test("a blank draft has every safety default on and every spending default off", () => {
    const draft = emptyDraft();
    assert.equal(draft.audience.exclusions.globalSuppression, true);
    assert.equal(draft.audience.exclusions.existingCustomers, true);
    assert.equal(draft.audience.exclusions.existingLeads, true);
    assert.equal(draft.budget.autoOverage, false);
    assert.equal(draft.budget.autoOptimize, false);
    assert.equal(draft.outreach.startMode, "MANUAL_REVIEW");
    assert.equal(draft.outreach.promotionRule, "MANUAL");
  });

  test("global suppression cannot be turned off in a stored draft", () => {
    const draft = emptyDraft();
    const tampered = {
      ...draft,
      audience: {
        ...draft.audience,
        exclusions: { ...draft.audience.exclusions, globalSuppression: false },
      },
    };

    // z.literal(true): the whole section fails to parse rather than being
    // honoured, and `parseDraft` falls back to the safe default.
    assert.equal(campaignDraftSchema.safeParse(tampered).success, false);
    assert.equal(parseDraft(tampered).audience.exclusions.globalSuppression, true);
  });

  test("a draft from an older shape keeps whatever still parses", () => {
    const stored = {
      goal: {
        campaignName: "Legacy campaign",
        conversionGoal: "REQUEST_QUOTE",
        primaryServiceId: null,
        successEvent: "QUOTE_REQUESTED",
      },
      audience: { nonsense: true },
      intentScore: { minimumGrade: "A", intentCategoryIds: [], intentRequired: false, maxIntentAgeDays: 30, reviewThreshold: 70 },
    };

    const draft = parseDraft(stored);
    // The good section survives; the broken one falls back rather than taking
    // the whole configuration down with it.
    assert.equal(draft.goal.campaignName, "Legacy campaign");
    assert.equal(draft.intentScore.minimumGrade, "A");
    assert.equal(draft.audience.source, "BOTH");
    assert.equal(draft.audience.exclusions.globalSuppression, true);
  });

  test("unparseable input becomes a blank draft rather than throwing", () => {
    assert.deepEqual(parseDraft(null), emptyDraft());
    assert.deepEqual(parseDraft("nonsense"), emptyDraft());
  });
});

/* ------------------------------------------------------------------- goal */

describe("step 1 — goal", () => {
  test("every required field is required", () => {
    const errors = validateGoal(emptyDraft());
    assert.ok(errors.campaignName);
    assert.ok(errors.conversionGoal);
    assert.ok(errors.primaryServiceId);
    assert.ok(errors.successEvent);
  });

  test("a complete goal validates", () => {
    assert.deepEqual(validateGoal(completeDraft()), {});
  });

  test("an incompatible success event is refused", () => {
    const draft = completeDraft();
    draft.goal.successEvent = "PURCHASE_COMPLETED";
    assert.ok(validateGoal(draft).successEvent);
    assert.equal(successEventCompatible("REQUEST_QUOTE", "PURCHASE_COMPLETED"), false);
  });

  test("every goal has a compatible default success event", () => {
    for (const goal of [
      "BOOK_APPOINTMENT",
      "BOOK_SITE_VISIT",
      "BOOK_DEMO",
      "REQUEST_QUOTE",
      "PHONE_CALL",
      "DIRECT_SIGNUP",
      "DIRECT_PURCHASE",
      "HUMAN_HANDOVER",
      "CUSTOM",
    ] as const) {
      assert.equal(successEventCompatible(goal, defaultSuccessEvent(goal)), true);
    }
  });

  test("a blank name is refused even when it is only whitespace", () => {
    const draft = completeDraft();
    draft.goal.campaignName = "   ";
    assert.ok(validateGoal(draft).campaignName);
  });
});

/* --------------------------------------------------------------- audience */

describe("step 2 — audience", () => {
  test("some basis for targeting is required", () => {
    assert.ok(validateAudience(emptyDraft()).basis);
  });

  test("an ICP alone is enough of a basis", () => {
    const draft = emptyDraft();
    draft.audience.icpProfileId = "33333333-3333-4333-8333-333333333333";
    assert.deepEqual(validateAudience(draft), {});
  });

  test("a radius without a location is refused", () => {
    const draft = completeDraft();
    draft.audience.locations = [];
    draft.audience.industries = ["Property Management"];
    draft.audience.radiusMiles = 25;
    assert.ok(validateAudience(draft).locations);
  });
});

/* ----------------------------------------------------------- intent/score */

describe("step 3 — intent and score", () => {
  test("requiring intent with no categories is refused", () => {
    const draft = completeDraft();
    draft.intentScore.intentRequired = true;
    draft.intentScore.intentCategoryIds = [];
    assert.ok(validateIntentScore(draft).intentCategoryIds);
  });

  test("intent may be optional with no categories", () => {
    const draft = completeDraft();
    draft.intentScore.intentRequired = false;
    assert.deepEqual(validateIntentScore(draft), {});
  });

  test("the review threshold is bounded to a score", () => {
    const draft = completeDraft();
    draft.intentScore.reviewThreshold = 140;
    assert.ok(validateIntentScore(draft).reviewThreshold);
  });

  test("grades at or above a minimum are ordered strongest first", () => {
    assert.deepEqual(gradesAtOrAbove("A"), ["A+", "A"]);
    assert.deepEqual(gradesAtOrAbove("D"), GRADES.slice().reverse());
  });

  test("the eligibility preview always states suppression, however configured", () => {
    const draft = completeDraft();
    draft.audience.exclusions.existingCustomers = false;
    draft.audience.exclusions.existingLeads = false;

    const keys = eligibilityRules(draft).map((rule) => rule.key);
    // Nobody should read the absence of a suppression line as "this campaign
    // skips suppression".
    assert.ok(keys.includes("suppression"));
    assert.equal(keys.includes("customers"), false);
  });

  test("the stricter of campaign and category freshness wins", () => {
    assert.equal(effectiveFreshnessDays(30, 90), 30);
    assert.equal(effectiveFreshnessDays(90, 14), 14);
  });
});

/* --------------------------------------------------------------- outreach */

describe("step 4 — outreach", () => {
  test("a complete sequence validates", () => {
    assert.deepEqual(validateOutreach(completeDraft()), {});
  });

  test("a sender is required", () => {
    const draft = completeDraft();
    draft.outreach.senderIdentityId = null;
    assert.ok(validateOutreach(draft).senderIdentityId);
  });

  test("an empty body is refused", () => {
    const draft = completeDraft();
    draft.outreach.steps[0].body = "too short";
    assert.ok(validateOutreach(draft)["step-1-body"]);
  });

  test("follow-up delays must move forwards", () => {
    const draft = completeDraft();
    draft.outreach.steps[2].delayDays = 1;
    assert.ok(validateOutreach(draft)["step-3-delay"]);
  });

  test("a merge field we cannot fill is refused", () => {
    const draft = completeDraft();
    draft.outreach.steps[0].body =
      "Hi {{first_name}}, your discount code is {{secret_code}} and it expires soon.";
    assert.ok(validateOutreach(draft)["step-1-body"]);
    assert.deepEqual(unknownMergeFields("{{first_name}} {{nope}}"), ["nope"]);
  });

  test("the sequence is bounded", () => {
    const draft = completeDraft();
    draft.outreach.steps = Array.from({ length: MAX_SEQUENCE_STEPS + 1 }, (_, index) => ({
      position: index + 1,
      delayDays: index * 2,
      subject: "s",
      body: "a body long enough to pass the minimum length check",
      enabled: true,
    }));
    assert.ok(validateOutreach(draft).steps);
  });

  test("an unsubscribe can only ever suppress", () => {
    // Even when a stored config asks for something softer.
    assert.equal(replyActionFor("UNSUBSCRIBE", { UNSUBSCRIBE: "NOTIFY_ONLY" }), "AUTO_SUPPRESS");
    assert.equal(replyActionFor("UNSUBSCRIBE", {}), "AUTO_SUPPRESS");
  });

  test("an unrecognised reply action falls back to the rule's default", () => {
    assert.equal(replyActionFor("POSITIVE", { POSITIVE: "DELETE_EVERYTHING" }), "NOTIFY_AND_FOLLOW_UP");
  });
});

/* ----------------------------------------------------------------- budget */

describe("step 5 — budget and limits", () => {
  test("a budget within every ceiling validates", () => {
    assert.deepEqual(validateBudget(completeDraft(), CEILINGS), {});
  });

  test("a target above the remaining allowance is refused", () => {
    const draft = completeDraft();
    draft.budget.prospectsPerRun = 9000;
    assert.ok(validateBudget(draft, CEILINGS).prospectsPerRun);
  });

  test("a daily cap above the mailbox ceiling is refused", () => {
    const draft = completeDraft();
    draft.budget.dailyContacts = 500;
    assert.ok(validateBudget(draft, CEILINGS).dailyContacts);
  });

  test("a provider ceiling above the plan's is refused", () => {
    const draft = completeDraft();
    draft.budget.providerCostCeilingMinor = 500_000;
    assert.ok(validateBudget(draft, CEILINGS).providerCostCeilingMinor);
  });

  test("a monthly cap below the daily cap is refused", () => {
    const draft = completeDraft();
    draft.budget.dailyContacts = 200;
    draft.budget.monthlyContacts = 100;
    assert.ok(validateBudget(draft, CEILINGS).monthlyContacts);
  });

  test("campaign overage cannot be enabled when the account has it off", () => {
    const draft = completeDraft();
    draft.budget.autoOverage = true;
    assert.ok(validateBudget(draft, CEILINGS).autoOverage);
  });

  test("campaign overage is permitted once the account allows it", () => {
    const draft = completeDraft();
    draft.budget.autoOverage = true;
    assert.deepEqual(
      validateBudget(draft, { ...CEILINGS, overageAvailable: true }).autoOverage,
      undefined,
    );
  });

  test("an existing-prospects campaign is quoted no sourcing cost", () => {
    const draft = completeDraft();
    draft.audience.source = "EXISTING_ONLY";
    const summary = summariseCampaignBudget(draft, 35);
    assert.equal(summary.prospectsToSource, 0);
    assert.equal(summary.providerCostMinor, 0);
  });

  test("the quoted provider cost never exceeds the campaign's own ceiling", () => {
    const draft = completeDraft();
    draft.budget.providerCostCeilingMinor = 10_000;
    const summary = summariseCampaignBudget(draft, 35);
    assert.ok(summary.providerCostMinor <= 10_000);
  });

  test("email credits are counted separately from money", () => {
    const summary = summariseCampaignBudget(completeDraft(), 35);
    // Allowance is a head count, not pounds; adding one into the other would
    // double-charge the customer in the summary.
    assert.equal(summary.totalCostMinor, summary.providerCostMinor);
    assert.equal(summary.emailCredits, summary.outreachContacts);
  });
});

/* --------------------------------------------------------------- stepping */

describe("step gating", () => {
  test("an empty draft cannot get past the first step", () => {
    assert.equal(furthestValidStep(validateAll(emptyDraft(), CEILINGS)), "goal");
  });

  test("a complete draft reaches review", () => {
    assert.equal(furthestValidStep(validateAll(completeDraft(), CEILINGS)), "review");
  });

  test("the furthest step is the first incomplete one, not the last complete one", () => {
    const draft = completeDraft();
    draft.outreach.senderIdentityId = null;
    assert.equal(furthestValidStep(validateAll(draft, CEILINGS)), "outreach");
  });

  test("the step order is the one the stepper renders", () => {
    assert.deepEqual(WIZARD_STEP_KEYS, [
      "goal",
      "audience",
      "intent",
      "outreach",
      "budget",
      "review",
    ]);
  });
});

/* ------------------------------------------------------------ eligibility */

describe("runtime eligibility", () => {
  const base: EligibilityCandidate = {
    grade: "A",
    score: 90,
    status: "READY",
    outreachEligibility: "ELIGIBLE",
    email: "someone@example.com",
    promotedToLeadId: null,
    isExistingCustomer: false,
    matchingIntentSignals: 1,
    suppressed: false,
    companyExcluded: false,
  };

  test("an eligible prospect is eligible", () => {
    assert.equal(evaluateEligibility(base, completeDraft()).outcome, "ELIGIBLE");
  });

  test("suppression outranks everything else", () => {
    const verdict = evaluateEligibility(
      { ...base, suppressed: true, grade: "D", isExistingCustomer: true },
      completeDraft(),
    );
    // Both reasons are true; the recorded one has to be the opt-out.
    assert.equal(verdict.outcome, "EXCLUDED");
    assert.equal(verdict.reasonCode, "SUPPRESSED");
  });

  test("an already-promoted prospect is never cold-contacted again", () => {
    const verdict = evaluateEligibility(
      { ...base, promotedToLeadId: "44444444-4444-4444-8444-444444444444" },
      completeDraft(),
    );
    assert.equal(verdict.outcome, "EXCLUDED");
    assert.equal(verdict.reasonCode, "ALREADY_A_LEAD");
  });

  test("an existing customer is excluded when the campaign says so", () => {
    assert.equal(
      evaluateEligibility({ ...base, isExistingCustomer: true }, completeDraft()).outcome,
      "EXCLUDED",
    );
  });

  test("an existing customer is allowed when the campaign permits it", () => {
    const draft = completeDraft();
    draft.audience.exclusions.existingCustomers = false;
    assert.equal(
      evaluateEligibility({ ...base, isExistingCustomer: true }, draft).outcome,
      "ELIGIBLE",
    );
  });

  test("required intent with no signal excludes", () => {
    const draft = completeDraft();
    draft.intentScore.intentRequired = true;
    draft.intentScore.intentCategoryIds = ["55555555-5555-4555-8555-555555555555"];
    assert.equal(
      evaluateEligibility({ ...base, matchingIntentSignals: 0 }, draft).reasonCode,
      "NO_INTENT",
    );
  });

  test("below the minimum grade goes to review, not to a send", () => {
    const verdict = evaluateEligibility({ ...base, grade: "C" }, completeDraft());
    assert.equal(verdict.outcome, "REVIEW");
    assert.equal(verdict.reasonCode, "BELOW_GRADE");
  });

  test("below the review threshold goes to review", () => {
    const draft = completeDraft();
    draft.intentScore.reviewThreshold = 95;
    const verdict = evaluateEligibility(base, draft);
    assert.equal(verdict.outcome, "REVIEW");
    assert.equal(verdict.reasonCode, "BELOW_REVIEW_THRESHOLD");
  });

  test("an unresolved contactability decision goes to review", () => {
    assert.equal(
      evaluateEligibility({ ...base, outreachEligibility: "REVIEW" }, completeDraft()).outcome,
      "REVIEW",
    );
  });

  test("no email address is excluded rather than reviewed", () => {
    assert.equal(evaluateEligibility({ ...base, email: null }, completeDraft()).outcome, "EXCLUDED");
  });
});

/* ------------------------------------------------------------ state machine */

describe("campaign state machine", () => {
  test("the documented transitions are allowed", () => {
    const allowed: [string, string][] = [
      ["DRAFT", "READY"],
      ["DRAFT", "ACTIVE"],
      ["READY", "ACTIVE"],
      ["ACTIVE", "PAUSED"],
      ["PAUSED", "ACTIVE"],
      ["ACTIVE", "OPTIMIZING"],
      ["OPTIMIZING", "ACTIVE"],
      ["ACTIVE", "COMPLETED"],
      ["ACTIVE", "STOPPED"],
      ["PAUSED", "STOPPED"],
      ["READY", "STOPPED"],
    ];

    for (const [from, to] of allowed) {
      assert.equal(canTransition(from as never, to as never), true, `${from} → ${to}`);
    }
  });

  test("terminal states are terminal", () => {
    assert.deepEqual(allowedTransitions("STOPPED"), []);
    assert.deepEqual(allowedTransitions("COMPLETED"), []);
    assert.equal(canTransition("STOPPED", "ACTIVE"), false);
    assert.equal(canTransition("COMPLETED", "ACTIVE"), false);
  });

  test("a refused transition explains itself", () => {
    assert.throws(
      () => assertTransition("STOPPED", "ACTIVE"),
      (error: unknown) =>
        error instanceof CampaignTransitionError && /Duplicate it/.test(error.message),
    );
  });

  test("a draft cannot skip straight to paused", () => {
    assert.equal(canTransition("DRAFT", "PAUSED"), false);
  });
});

/* -------------------------------------------------------------- auto-pause */

describe("auto-pause", () => {
  const healthy: AutoPauseSignals = {
    bounceRate: 0.01,
    complaintRate: 0.0005,
    senderHealthy: true,
    senderVerified: true,
    suppressionAvailable: true,
    contactabilityAvailable: true,
    providerHealthy: true,
    budgetExhausted: false,
  };

  test("a healthy campaign is not paused", () => {
    assert.equal(autoPauseReason(healthy), null);
  });

  test("an unavailable suppression service outranks every other reason", () => {
    const reason = autoPauseReason({
      ...healthy,
      suppressionAvailable: false,
      bounceRate: 0.9,
      budgetExhausted: true,
    });
    assert.equal(reason?.code, "SUPPRESSION_UNAVAILABLE");
  });

  test("bounce and complaint thresholds pause sending", () => {
    assert.equal(autoPauseReason({ ...healthy, bounceRate: 0.09 })?.code, "BOUNCE_THRESHOLD");
    assert.equal(
      autoPauseReason({ ...healthy, complaintRate: 0.01 })?.code,
      "COMPLAINT_THRESHOLD",
    );
  });

  test("an exhausted budget pauses sending", () => {
    assert.equal(autoPauseReason({ ...healthy, budgetExhausted: true })?.code, "BUDGET_EXHAUSTED");
  });
});

/* --------------------------------------------------------- launch validation */

function facts(overrides: Partial<LaunchFacts> = {}): LaunchFacts {
  return {
    sender: {
      exists: true,
      active: true,
      verified: true,
      coldEnabled: true,
      hasPostalFooter: true,
      spf: "PASS",
      dkim: "PASS",
      dmarc: "PASS",
      bounceRate: 0.01,
      complaintRate: 0.0005,
      mailboxHealth: "HEALTHY",
      domainHealth: "HEALTHY",
      dailySendCap: 200,
      pausedUntil: null,
    },
    plan: { active: true, coldEmailEnabled: true, sourcingEnabled: true },
    suppressionAvailable: true,
    contactabilityAvailable: true,
    policyPackVersion: "uk-2026.01",
    providers: { healthy: true, degraded: [] },
    service: { exists: true, active: true },
    savedSearchAvailable: true,
    intentCategoriesActive: true,
    scoringPolicyVersion: "v1.2026.09",
    ceilings: CEILINGS,
    ...overrides,
  };
}

describe("launch validation", () => {
  test("a complete campaign with healthy facts passes every check", () => {
    const checks = evaluateLaunch(completeDraft(), facts());
    assert.equal(launchBlocked(checks), false);
    assert.equal(checks.length, 8);
    assert.ok(checks.every((check) => check.state === "PASS"));
  });

  test("an unverified sender blocks the launch", () => {
    const checks = evaluateLaunch(
      completeDraft(),
      facts({ sender: { ...facts().sender!, verified: false } }),
    );
    assert.equal(launchBlocked(checks), true);
    assert.equal(checks.find((c) => c.key === "SENDER_HEALTH")?.state, "BLOCK");
  });

  test("a missing postal address blocks the launch", () => {
    const checks = evaluateLaunch(
      completeDraft(),
      facts({ sender: { ...facts().sender!, hasPostalFooter: false } }),
    );
    assert.equal(launchBlocked(checks), true);
  });

  test("failing DMARC blocks, while incomplete authentication only warns", () => {
    const failing = evaluateLaunch(
      completeDraft(),
      facts({ sender: { ...facts().sender!, dmarc: "FAIL" } }),
    );
    assert.equal(failing.find((c) => c.key === "SENDER_HEALTH")?.state, "BLOCK");

    const unknown = evaluateLaunch(
      completeDraft(),
      facts({ sender: { ...facts().sender!, dmarc: "MISSING" } }),
    );
    assert.equal(unknown.find((c) => c.key === "SENDER_HEALTH")?.state, "WARN");
    // A warning must never gate the button.
    assert.equal(launchBlocked(unknown), false);
  });

  test("an unavailable suppression service blocks the launch", () => {
    const checks = evaluateLaunch(completeDraft(), facts({ suppressionAvailable: false }));
    assert.equal(checks.find((c) => c.key === "SUPPRESSION")?.state, "BLOCK");
    assert.equal(launchBlocked(checks), true);
  });

  test("a missing compliance policy blocks the launch", () => {
    const checks = evaluateLaunch(completeDraft(), facts({ policyPackVersion: null }));
    assert.equal(checks.find((c) => c.key === "CONTACTABILITY")?.state, "BLOCK");
  });

  test("an inactive plan or missing capability blocks the launch", () => {
    assert.equal(
      launchBlocked(evaluateLaunch(completeDraft(), facts({ plan: { active: false, coldEmailEnabled: true, sourcingEnabled: true } }))),
      true,
    );
    assert.equal(
      launchBlocked(evaluateLaunch(completeDraft(), facts({ plan: { active: true, coldEmailEnabled: false, sourcingEnabled: true } }))),
      true,
    );
  });

  test("a deactivated service blocks the launch", () => {
    const checks = evaluateLaunch(
      completeDraft(),
      facts({ service: { exists: true, active: false } }),
    );
    assert.equal(checks.find((c) => c.key === "PLAN_ENTITLEMENTS")?.state, "BLOCK");
  });

  test("a degraded provider blocks a sourcing campaign but only warns an existing-only one", () => {
    const sourcing = evaluateLaunch(
      completeDraft(),
      facts({ providers: { healthy: false, degraded: ["apollo"] } }),
    );
    assert.equal(sourcing.find((c) => c.key === "PROVIDER_HEALTH")?.state, "BLOCK");

    const existingOnly = completeDraft();
    existingOnly.audience.source = "EXISTING_ONLY";
    const warned = evaluateLaunch(
      existingOnly,
      facts({ providers: { healthy: false, degraded: ["apollo"] } }),
    );
    assert.equal(warned.find((c) => c.key === "PROVIDER_HEALTH")?.state, "WARN");
  });

  test("a bounce rate over the safe threshold blocks on domain safety", () => {
    const checks = evaluateLaunch(
      completeDraft(),
      facts({ sender: { ...facts().sender!, bounceRate: 0.2 } }),
    );
    assert.equal(checks.find((c) => c.key === "DOMAIN_SAFETY")?.state, "BLOCK");
  });

  test("a daily cap above the mailbox cap blocks on budget", () => {
    const draft = completeDraft();
    draft.budget.dailyContacts = 150;
    const checks = evaluateLaunch(
      draft,
      facts({ sender: { ...facts().sender!, dailySendCap: 100 } }),
    );
    assert.equal(checks.find((c) => c.key === "BUDGET")?.state, "BLOCK");
  });

  test("an invalid sequence blocks the launch", () => {
    const draft = completeDraft();
    draft.outreach.steps[0].subject = "";
    const checks = evaluateLaunch(draft, facts());
    assert.equal(checks.find((c) => c.key === "SEQUENCE")?.state, "BLOCK");
  });

  test("review completeness agrees with the step validators", () => {
    const complete = reviewCompleteness(completeDraft(), CEILINGS);
    assert.deepEqual(complete, {
      goal: true,
      audience: true,
      intent: true,
      outreach: true,
      budget: true,
    });

    const broken = completeDraft();
    broken.outreach.senderIdentityId = null;
    assert.equal(reviewCompleteness(broken, CEILINGS).outreach, false);
  });
});

/* ------------------------------------------------------------- optimisation */

describe("bounded auto-optimisation", () => {
  const config = { ...defaultOptimizationConfig("B"), enabled: true };

  test("a disabled optimiser refuses everything", () => {
    const verdict = optimizationAllowed(
      { ...config, enabled: false },
      { dimension: "SEND_TIME", before: null, after: { startHour: 10, endHour: 12 } },
    );
    assert.equal(verdict.allowed, false);
  });

  test("spend is not an optimisable dimension at all", () => {
    for (const dimension of [
      "PROVIDER_BUDGET",
      "AUTO_OVERAGE",
      "COMMUNICATION_ALLOWANCE",
      "SUPPRESSION",
      "SENDER_IDENTITY",
      "CHANNEL",
    ]) {
      const verdict = optimizationAllowed(config, { dimension, before: 1, after: 999_999 });
      assert.equal(verdict.allowed, false, dimension);
    }
  });

  test("a grade change inside the bounds is allowed and outside is not", () => {
    assert.equal(
      optimizationAllowed(config, { dimension: "GRADE_THRESHOLD", before: "B", after: "A" })
        .allowed,
      true,
    );
    // Below the floor the campaign was configured with.
    assert.equal(
      optimizationAllowed(config, { dimension: "GRADE_THRESHOLD", before: "B", after: "D" })
        .allowed,
      false,
    );
  });

  test("a send window outside the permitted hours is refused", () => {
    assert.equal(
      optimizationAllowed(config, {
        dimension: "SEND_TIME",
        before: null,
        after: { startHour: 10, endHour: 16 },
      }).allowed,
      true,
    );
    assert.equal(
      optimizationAllowed(config, {
        dimension: "SEND_TIME",
        before: null,
        after: { startHour: 3, endHour: 23 },
      }).allowed,
      false,
    );
  });

  test("follow-up spacing is clamped to the configured range", () => {
    assert.equal(
      optimizationAllowed(config, { dimension: "FOLLOW_UP_SPACING", before: 3, after: 4 })
        .allowed,
      true,
    );
    assert.equal(
      optimizationAllowed(config, { dimension: "FOLLOW_UP_SPACING", before: 3, after: 90 })
        .allowed,
      false,
    );
  });

  test("a stored config cannot claim the budget is optimisable", () => {
    const tampered = { ...config, budgetImmutable: false };
    assert.equal(optimizationConfigSchema.safeParse(tampered).success, false);
  });

  test("a refusal explains itself", () => {
    const verdict = optimizationAllowed(config, {
      dimension: "GRADE_THRESHOLD",
      before: "B",
      after: "D",
    });
    assert.equal(verdict.allowed, false);
    assert.ok(verdict.reason && verdict.reason.length > 0);
  });
});

/* ---------------------------------------------------------------- estimates */

describe("estimated results", () => {
  test("estimates are ranges, never a single number", () => {
    const estimates = estimateResults(1000);
    assert.equal(estimates.prospectsToContact, 1000);
    assert.ok(estimates.replies.low < estimates.replies.high);
    assert.ok(estimates.qualified.low < estimates.qualified.high);
    assert.ok(estimates.conversions.low < estimates.conversions.high);
  });

  test("each stage estimates fewer than the one above it", () => {
    const estimates = estimateResults(1000);
    assert.ok(estimates.replies.high > estimates.qualified.high);
    assert.ok(estimates.qualified.high > estimates.conversions.high);
  });

  test("no contacts means no estimated outcomes", () => {
    const estimates = estimateResults(0);
    assert.equal(estimates.replies.high, 0);
    assert.equal(estimates.qualified.high, 0);
  });

  test("the bands are the ones the card labels", () => {
    assert.deepEqual(ESTIMATE_BANDS.reply, [0.15, 0.25]);
    assert.deepEqual(ESTIMATE_BANDS.qualified, [0.05, 0.1]);
    assert.deepEqual(ESTIMATE_BANDS.conversion, [0.03, 0.07]);
  });
});
