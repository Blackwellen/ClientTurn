import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canSeeEngineMode,
  describeDisqualifier,
  disqualifierFromDraft,
  draftFromDisqualifier,
  parseQualificationPolicy,
  policyForRole,
  qualificationPolicyUpdateSchema,
} from "../src/lib/settings/ai-selling.ts";
import { intentKeyFamily, questionMappingSchema } from "../src/lib/qualification/mapping.ts";
import { dimensionLabel } from "../src/lib/qualification-intelligence/explain.ts";
import {
  POLICY_KEY_PATTERN,
  parseOfferProfile,
  qualificationPolicySchema,
  resolveEngineMode,
} from "../src/lib/qualification-intelligence/types.ts";

/**
 * Settings -> AI & selling -> Qualification policy (design §B.18, brief §20),
 * and the question editor's dimension / intent mapping.
 */

const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const SERVICE = "55555555-5555-4555-8555-555555555555";
const QUESTION = "99999999-9999-4999-8999-999999999999";

describe("the policy update envelope", () => {
  test("the scope is the workspace or one offer, nothing else", () => {
    const ok = (scope: string) => qualificationPolicyUpdateSchema.safeParse({ scope, policy: {} }).success;
    assert.equal(ok("*"), true);
    assert.equal(ok(`service:${SERVICE}`), true);
    assert.equal(ok("service:not-a-uuid"), false);
    assert.equal(ok("workspace"), false);
    assert.match(`service:${SERVICE}`, POLICY_KEY_PATTERN);
  });

  test("merge is the default mode; the Settings form sends replace", () => {
    const parsed = qualificationPolicyUpdateSchema.parse({ scope: "*", policy: {} });
    assert.equal(parsed.mode, "merge");
    const action = src("src/lib/settings/ai-selling-actions.ts");
    assert.match(action, /runOperation\(\s*"qualification\.policy_update",\s*\{ \.\.\.parsed\.data, mode: "replace" \}/);
  });

  test("the payload is the frozen contract, strictly: unknown keys are refused", () => {
    assert.equal(qualificationPolicyUpdateSchema.safeParse({ scope: "*", policy: { tone: "friendly" } }).success, false);
    assert.equal(
      qualificationPolicyUpdateSchema.safeParse({ scope: "*", policy: { forbiddenQuestionIntents: ["budget"] } }).success,
      false,
      "question keys are library keys like BUDGET.RANGE",
    );
    assert.equal(
      qualificationPolicyUpdateSchema.safeParse({
        scope: "*",
        policy: {
          goal: "B_BOOK_MEETING",
          motion: "BOOK_MEETING_B2B",
          requiredDimensions: ["USE_CASE", "COMPANY_SIZE"],
          forbiddenQuestionIntents: ["BUDGET.RANGE"],
          thresholds: { booking: { minIntentState: "MEDIUM", minCompleteness: 0.6 } },
          escalationConditions: ["HIGH_VALUE"],
          humanCloserAboveValue: 25000,
          maxAutonomy: "SUGGEST_ONLY",
          archetypeKey: "MSP",
          engineMode: "SHADOW",
        },
      }).success,
      true,
    );
  });

  test("a stored payload that no longer validates reads as the empty policy", () => {
    assert.deepEqual(parseQualificationPolicy({ goal: "WIN_EVERYTHING" }), {});
    assert.deepEqual(parseQualificationPolicy(null), {});
    assert.deepEqual(parseQualificationPolicy({ goal: "F_NURTURE" }), { goal: "F_NURTURE" });
  });
});

describe("the engine mode is for owners and admins", () => {
  test("only owners and admins see it", () => {
    assert.equal(canSeeEngineMode("owner"), true);
    assert.equal(canSeeEngineMode("admin"), true);
    assert.equal(canSeeEngineMode("member"), false);
    assert.equal(canSeeEngineMode("viewer"), false);
  });

  test("other roles read the policy without it", () => {
    const policy = { engineMode: "LIVE" as const, goal: "B_BOOK_MEETING" as const };
    assert.deepEqual(policyForRole(policy, "member"), { goal: "B_BOOK_MEETING" });
    assert.deepEqual(policyForRole(policy, "admin"), policy);
  });

  test("without a stored value the release default applies (CD-9)", () => {
    assert.equal(resolveEngineMode(undefined, false), "SHADOW");
    assert.equal(resolveEngineMode(undefined, true), "LIVE");
    assert.equal(resolveEngineMode("OFF", true), "OFF");
  });

  test("the queries only read the engine mode for roles allowed to see it", () => {
    const queries = src("src/lib/settings/ai-selling-queries.ts");
    assert.match(queries, /canSeeEngineMode\(role\) \? readEngineMode\(businessId\) : Promise\.resolve\(null\)/);
    const card = src("src/components/settings/ai-selling/qualification-policy-card.tsx");
    assert.match(card, /scope === WORKSPACE_POLICY_KEY && view\.engineMode &&/);
  });
});

describe("disqualification criteria", () => {
  test("a form row becomes the contract's predicate", () => {
    const d = disqualifierFromDraft({
      dimension: "COMPANY_SIZE",
      op: "lt",
      value: "10",
      reason: "We work with companies of 10 or more",
      reviewInstead: false,
      suppress: false,
    });
    assert.notEqual(typeof d, "string");
    if (typeof d === "string") return;
    assert.deepEqual(d.when, { op: "lt", dimension: "COMPANY_SIZE", value: 10 });
    assert.equal(qualificationPolicySchema.safeParse({ disqualifiers: [d] }).success, true);
    assert.deepEqual(draftFromDisqualifier(d)?.value, "10");
    assert.match(describeDisqualifier(d, dimensionLabel), /less than 10: disqualify/);
  });

  test("a list, a word and a bad number", () => {
    const list = disqualifierFromDraft({ dimension: "LOCATION", op: "in", value: "Jersey, Guernsey", reason: "Outside the UK mainland", reviewInstead: true, suppress: false });
    assert.equal(typeof list !== "string" && list.when.op === "in" && list.when.values.length, 2);
    assert.equal(typeof disqualifierFromDraft({ dimension: "BUDGET", op: "gt", value: "lots", reason: "x x x", reviewInstead: true, suppress: false }), "string");
    assert.equal(typeof disqualifierFromDraft({ dimension: "BUDGET", op: "equals", value: " ", reason: "x x x", reviewInstead: true, suppress: false }), "string");
  });

  test("a compound rule the form cannot edit is kept as saved", () => {
    const compound = {
      dimension: "BUDGET" as const,
      when: { op: "all" as const, of: [{ op: "known" as const, dimension: "BUDGET" as const }] },
      reason: "Needs review",
      reviewInstead: true,
      suppress: false,
    };
    assert.equal(draftFromDisqualifier(compound), null);
    const card = src("src/components/settings/ai-selling/qualification-policy-card.tsx");
    assert.match(card, /lockedDisqualifiers/);
  });
});

describe("offer-specific rules", () => {
  test("an offer's profile is read safely: invalid means library defaults", () => {
    assert.deepEqual(parseOfferProfile({ pricingModel: "SUBSCRIPTION" }), { profile: { pricingModel: "SUBSCRIPTION" }, valid: true });
    assert.deepEqual(parseOfferProfile({ pricingModel: "FREE_LUNCH" }), { profile: {}, valid: false });
    const queries = src("src/lib/settings/ai-selling-queries.ts");
    assert.match(queries, /parseOfferProfile\(service\.offer_profile\)/);
  });

  test("the question editor links each offer to its rules", () => {
    const scope = src("src/components/qualification/service-scope-card.tsx");
    assert.match(scope, /\/app\/settings\?section=ai-selling#qualification-policy/);
    const card = src("src/components/settings/ai-selling/qualification-policy-card.tsx");
    assert.match(card, /id="qualification-policy"/);
  });
});

describe("the Qualification policy card covers §20", () => {
  const card = src("src/components/settings/ai-selling/qualification-policy-card.tsx");
  for (const [what, pattern] of [
    ["sales goal", /label="Sales goal"/],
    ["framework", /label="Framework"/],
    ["industry profile override", /label="Industry profile"/],
    ["required dimensions", /Required before the next step/],
    ["disqualification criteria", /Disqualification criteria/],
    ["booking / direct-sale / handoff thresholds", /booking[\s\S]*directSale[\s\S]*handoff/],
    ["min/max autonomy", /label="Autonomy"[\s\S]*can only lower it/],
    ["escalation conditions", /Escalate to a person when/],
    ["forbidden questions, picked from the library", /\["forbidden", "Never ask"[\s\S]*add a question from the library/],
    ["custom questions and the question editor", /\["custom", "Also ask"[\s\S]*\/app\/follow-up\?view=qualification/],
    ["unknown question keys are refused", /is not in the question library/],
    ["AI credits link", /AI credits/],
    ["engine mode", /Engine mode/],
    ["offer profile", /OfferProfileSummary/],
    ["plan-limit state", /PlanLimitState/],
    ["read-only state", /Only an owner or admin can change the qualification policy/],
  ] as const) {
    test(what, () => assert.match(card, pattern));
  }

  test("it is mounted in AI & selling with its own error state", () => {
    const section = src("src/app/(app)/app/settings/_sections/ai-selling-section.tsx");
    assert.match(section, /<QualificationPolicyCard/);
    assert.match(section, /<SectionLoadError title="Qualification policy" \/>/);
    assert.match(section, /subscriptionActive=\{entitlements\.active\}/);
  });

  test("it saves through the registry operation, never directly", () => {
    assert.match(card, /saveQualificationPolicyAction\(/);
    assert.equal(/createAdminClient|from\("workspace_sales_overrides"\)/.test(card), false);
  });
});

describe("mapping a question to a detail", () => {
  test("a mapping names a known dimension and, optionally, a library key", () => {
    assert.equal(questionMappingSchema.safeParse({ questionId: QUESTION, dimensionKey: "TIMING", questionIntentKey: "TIMING.START_WINDOW" }).success, true);
    assert.equal(questionMappingSchema.safeParse({ questionId: QUESTION, dimensionKey: null, questionIntentKey: null }).success, true);
    assert.equal(questionMappingSchema.safeParse({ questionId: QUESTION, dimensionKey: "MOOD", questionIntentKey: null }).success, false);
    assert.equal(
      questionMappingSchema.safeParse({ questionId: QUESTION, dimensionKey: null, questionIntentKey: `custom:${QUESTION}` }).success,
      false,
      "custom keys are synthesised, never stored",
    );
    assert.equal(intentKeyFamily("TIMING.START_WINDOW"), "TIMING");
    assert.equal(intentKeyFamily(null), null);
  });

  test("the save is admin-only, scoped to the workspace, audited, and refuses a mismatched key", () => {
    const actions = src("src/lib/qualification/actions.ts");
    const save = actions.slice(actions.indexOf("export async function saveQuestionMapping"));
    assert.match(save, /await editor\(\)/);
    assert.match(save, /\.eq\("business_id", workspace\.businessId\)/);
    assert.match(save, /recordAudit\(/);
    assert.match(save, /family !== dimensionKey/);
  });

  test("the question row offers the mapping once the question is published", () => {
    const row = src("src/components/qualification/question-row.tsx");
    assert.match(row, /Map to a detail/);
    assert.match(row, /disabled=\{!question\.id\}/);
  });
});
