import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  completenessFor,
  defaultOfferProfile,
  disqualifiersForService,
  knownDimensions,
  parseOfferProfile,
  parseSalesOverrides,
  resolveOffer,
  thresholdStatus,
} from "../src/lib/qualification-intelligence/offer-profile.ts";
import {
  offerProfileSchema,
  type DimensionStatusEntry,
  type OfferDisqualifier,
} from "../src/lib/qualification-intelligence/types.ts";
import {
  ARCHETYPES,
  QUALIFICATION_PROFILES,
  archetypeFor,
  qualificationProfileFor,
} from "../src/lib/sales-library/archetypes.ts";
import { MOTIONS } from "../src/lib/sales-library/motions.ts";
import { resolveArchetype } from "../src/lib/sales-library/classify.ts";
import { QUALIFICATION_DIMENSION_KEYS, SALES_MOTIONS } from "../src/lib/sales-library/types.ts";

const SERVICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function dim(dimension: DimensionStatusEntry["dimension"], status: DimensionStatusEntry["status"], extra: Partial<DimensionStatusEntry> = {}): DimensionStatusEntry {
  return { dimension, status, fact_ids: [], material: false, required: false, stale: false, ...extra };
}

describe("offer profile: parsing (CD-22)", () => {
  test("absent or invalid stored profiles fall back to {} with defaults", () => {
    assert.deepEqual(parseOfferProfile(null), { profile: {}, valid: true });
    assert.deepEqual(parseOfferProfile({ pricingModel: "BARTER" }), { profile: {}, valid: false });
    assert.deepEqual(parseOfferProfile({ unknownField: 1 }), { profile: {}, valid: false });
    assert.equal(parseOfferProfile({ pricingModel: "RETAINER", averageDealValue: 1500 }).profile.pricingModel, "RETAINER");
  });

  test("an invalid stored profile is ignored, not half-applied", () => {
    const resolved = resolveOffer({ archetypeKey: "MSP", offerProfileRaw: { motion: "ENTERPRISE", pricingModel: "BARTER" } });
    assert.equal(resolved.storedProfileValid, false);
    assert.equal(resolved.motion, "BOOK_MEETING_B2B", "the invalid profile's motion is not used");
  });
});

describe("offer profile: defaults per archetype x motion", () => {
  test("every archetype x motion default is schema-valid", () => {
    for (const archetype of ARCHETYPES) {
      for (const motion of SALES_MOTIONS) {
        const profile = defaultOfferProfile(archetype, motion);
        assert.doesNotThrow(() => offerProfileSchema.parse(profile), `${archetype.key} x ${motion}`);
        assert.equal(profile.motion, motion);
      }
    }
    assert.doesNotThrow(() => offerProfileSchema.parse(defaultOfferProfile(null, "BOOK_MEETING_B2B")));
  });

  test("library disqualifier hints become REVIEW-first disqualifiers, never automatic", () => {
    const msp = defaultOfferProfile(archetypeFor("MSP"), "BOOK_MEETING_B2B");
    assert.ok(msp.disqualifiers && msp.disqualifiers.length > 0);
    for (const d of msp.disqualifiers!) {
      assert.equal(d.reviewInstead, true);
      assert.equal(d.suppress, false);
    }
    assert.deepEqual(msp.disqualifiers![0].when, { op: "lt", dimension: "COMPANY_SIZE", value: 5 });
  });

  test("B2B-first profiles exist for every supported business type", () => {
    for (const key of [
      "B2B_SAAS", "PLG_SAAS", "ENTERPRISE_SAAS", "MSP", "IT_CONSULTANCY", "CYBERSECURITY",
      "MARKETING_AGENCY", "ADVERTISING_AGENCY", "SEO_AGENCY", "CREATIVE_WEB_STUDIO",
      "ACCOUNTING", "BOOKKEEPING", "LAW_FIRM", "MANAGEMENT_CONSULTING", "RECRUITMENT",
      "ECOMMERCE", "SUBSCRIPTION_ECOMMERCE", "ROOFER",
    ]) {
      const profile = QUALIFICATION_PROFILES[key];
      assert.ok(profile, key);
      assert.ok(archetypeFor(key), `${key} is an archetype`);
      for (const d of [...profile.requiredDimensions, ...profile.neverAsk, ...profile.gatingDimensions]) {
        assert.ok(QUALIFICATION_DIMENSION_KEYS.includes(d), `${key}: ${d}`);
      }
      assert.ok(!profile.requiredDimensions.some((d) => profile.neverAsk.includes(d)), `${key} requires what it never asks`);
    }
    for (const b2b of ["MSP", "B2B_SAAS", "MARKETING_AGENCY", "CREATIVE_WEB_STUDIO", "ACCOUNTING"]) {
      assert.equal(QUALIFICATION_PROFILES[b2b].customerType, "B2B", b2b);
    }
  });

  test("an archetype without a hand-written profile gets its motion family default", () => {
    const plumber = qualificationProfileFor(archetypeFor("PLUMBER"));
    assert.equal(plumber.archetypeKey, "PLUMBER");
    assert.ok(plumber.neverAsk.includes("AUTHORITY"));
    assert.ok(plumber.gatingDimensions.includes("LOCATION"));
    assert.equal(qualificationProfileFor(null).customerType, "B2B");
  });
});

describe("offer profile: resolution order", () => {
  test("motion: service policy > offer profile > workspace policy > workspace > archetype", () => {
    const base = { archetypeKey: "MSP" as const };
    assert.equal(resolveOffer(base).motionSource, "ARCHETYPE");
    assert.equal(resolveOffer({ ...base, workspaceMotion: "DIRECT_B2B" }).motion, "DIRECT_B2B");
    assert.equal(resolveOffer({ ...base, workspaceMotion: "DIRECT_B2B", workspacePolicy: { motion: "ENTERPRISE" } }).motion, "ENTERPRISE");
    assert.equal(
      resolveOffer({ ...base, workspaceMotion: "DIRECT_B2B", workspacePolicy: { motion: "ENTERPRISE" }, offerProfileRaw: { motion: "SAAS_SELF_SERVE" } }).motion,
      "SAAS_SELF_SERVE",
    );
    const top = resolveOffer({
      ...base,
      workspacePolicy: { motion: "ENTERPRISE" },
      offerProfileRaw: { motion: "SAAS_SELF_SERVE" },
      servicePolicy: { motion: "LOCAL_SERVICE" },
    });
    assert.equal(top.motion, "LOCAL_SERVICE");
    assert.equal(top.motionSource, "SERVICE_POLICY");
  });

  test("the policy's archetype override changes the hierarchy's industry profile", () => {
    const resolved = resolveOffer({ archetypeKey: "MSP", workspacePolicy: { archetypeKey: "ROOFER" } });
    assert.equal(resolved.archetypeKey, "ROOFER");
    assert.equal(resolved.motion, "LOCAL_SERVICE");
  });

  test("narrowing lists are unions: a lower layer never un-forbids", () => {
    const d1: OfferDisqualifier = { dimension: "COMPANY_SIZE", when: { op: "lt", dimension: "COMPANY_SIZE", value: 3 }, reason: "Too small", reviewInstead: false, suppress: false };
    const resolved = resolveOffer({
      archetypeKey: "B2B_SAAS",
      workspacePolicy: { forbiddenQuestionIntents: ["BUDGET.RANGE"], requiredDimensions: ["COMPANY_SIZE"], disqualifiers: [d1] },
      offerProfileRaw: { forbiddenQuestionIntents: ["AUTHORITY.OTHERS_INVOLVED"], requiredDimensions: ["TIMING"], disqualifiers: [d1] },
    });
    assert.deepEqual([...resolved.forbiddenIntents].sort(), ["AUTHORITY.OTHERS_INVOLVED", "BUDGET.RANGE"]);
    for (const d of ["USE_CASE", "COMPANY_SIZE", "TIMING"] as const) assert.ok(resolved.requiredDimensions.includes(d), d);
    assert.equal(resolved.disqualifiers.filter((d) => d.dimension === "COMPANY_SIZE" && JSON.stringify(d.when) === JSON.stringify(d1.when)).length, 1, "deduplicated");
    for (const d of ["COMPANY_SIZE", "TIMING"] as const) assert.ok(resolved.threshold.allOf.includes(d), `required ${d} joins the threshold`);
  });

  test("goal: service policy > offer > workspace policy > motion default", () => {
    assert.equal(resolveOffer({ archetypeKey: "MSP" }).offer.goal, "B_BOOK_MEETING");
    assert.equal(resolveOffer({ archetypeKey: "MSP", workspacePolicy: { goal: "A_QUALIFY_ONLY" } }).offer.goal, "A_QUALIFY_ONLY");
    assert.equal(resolveOffer({ archetypeKey: "MSP", workspacePolicy: { goal: "A_QUALIFY_ONLY" }, offerProfileRaw: { goal: "E_HUMAN_CLOSER" } }).offer.goal, "E_HUMAN_CLOSER");
    assert.equal(resolveOffer({ archetypeKey: "PLG_SAAS" }).offer.goal, "D_SIGNUP_TRIAL");
  });

  test("services.average_value is the fallback deal value", () => {
    assert.equal(resolveOffer({ archetypeKey: "MSP", averageValue: 12000 }).offer.averageDealValue, 12000);
    assert.equal(resolveOffer({ archetypeKey: "MSP", averageValue: 12000, offerProfileRaw: { averageDealValue: 900 } }).offer.averageDealValue, 900);
  });

  test("the plan follows the hierarchy: never-ask dimensions drop, threshold dimensions stay", () => {
    const roofer = resolveOffer({ archetypeKey: "ROOFER" });
    for (const d of ["AUTHORITY", "STAKEHOLDERS", "BUDGET", "DECISION_PROCESS", "SUCCESS_METRICS"] as const) {
      assert.ok(!roofer.plan.includes(d), `roofer plan includes ${d}`);
      assert.ok(roofer.neverAsk.includes(d));
    }
    for (const d of MOTIONS.LOCAL_SERVICE.decisionThreshold.allOf) assert.ok(roofer.plan.includes(d));
    const msp = resolveOffer({ archetypeKey: "MSP" });
    for (const d of ["PROBLEM", "COMPANY_SIZE", "CURRENT_SOLUTION", "TIMING", "DISSATISFACTION"] as const) assert.ok(msp.plan.includes(d), d);
    assert.ok(msp.gatingDimensions.includes("COMPANY_SIZE"));
  });

  test("every archetype x motion resolves a plan that can meet its own threshold", () => {
    for (const archetype of ARCHETYPES) {
      for (const motion of SALES_MOTIONS) {
        const r = resolveOffer({ archetypeKey: archetype.key, workspaceMotion: motion });
        for (const d of r.threshold.allOf) assert.ok(r.plan.includes(d), `${archetype.key} x ${motion}: ${d}`);
        if (r.threshold.anyOf.length > 0) assert.ok(r.threshold.anyOf.some((d) => r.plan.includes(d)), `${archetype.key} x ${motion}: any-of`);
      }
    }
  });

  test("industry -> archetype -> offer: a SIC code reaches the offer's plan", () => {
    const archetype = resolveArchetype({ sic2026Codes: ["43.41"] }).best;
    assert.equal(archetype, "ROOFER");
    assert.equal(resolveOffer({ archetypeKey: archetype }).motion, "LOCAL_SERVICE");
  });
});

describe("offer profile: threshold, completeness, materiality", () => {
  const msp = resolveOffer({ archetypeKey: "MSP" });

  test("an INFERRED material fact, a conflict and a stale fact do not count as known", () => {
    const known = knownDimensions([
      dim("USE_CASE", "CONFIRMED"),
      dim("COMPANY_SIZE", "INFERRED", { material: true }),
      dim("TIMING", "CONFLICTING"),
      dim("CURRENT_SOLUTION", "INFERRED", { stale: true }),
      dim("PROBLEM", "INFERRED"),
    ]);
    assert.deepEqual([...known].sort(), ["PROBLEM", "USE_CASE"]);
  });

  test("threshold status lists what is missing, the whole any-of group when unmet", () => {
    const status = thresholdStatus(msp.threshold, [dim("USE_CASE", "CONFIRMED")]);
    assert.equal(status.met, false);
    assert.ok(status.missing.includes("COMPANY_SIZE"));
    assert.ok(status.missing.includes("TIMING"));
    const met = thresholdStatus(msp.threshold, [dim("USE_CASE", "CONFIRMED"), dim("COMPANY_SIZE", "CONFIRMED")]);
    assert.equal(met.met, true);
  });

  test("completeness counts an any-of group once", () => {
    assert.equal(completenessFor(msp, []), 0);
    const full = completenessFor(msp, [dim("USE_CASE", "CONFIRMED"), dim("COMPANY_SIZE", "CONFIRMED")]);
    assert.equal(full, 1);
  });
});

describe("workspace sales overrides (defect F9)", () => {
  test("QUALIFICATION_QUESTION, DISQUALIFIER and QUALIFICATION_POLICY rows are read and validated", () => {
    const parsed = parseSalesOverrides([
      { kind: "QUALIFICATION_QUESTION", key: "BUDGET.RANGE", payload: { action: "FORBID" } },
      { kind: "QUALIFICATION_QUESTION", key: "TIMING.START_WINDOW", payload: { action: "REWORD" } },
      { kind: "DISQUALIFIER", key: "*", payload: { dimension: "COMPANY_SIZE", when: { op: "lt", dimension: "COMPANY_SIZE", value: 2 }, reason: "Sole trader" } },
      {
        kind: "DISQUALIFIER",
        key: `service:${SERVICE}`,
        payload: { disqualifiers: [{ dimension: "LOCATION", when: { op: "equals", dimension: "LOCATION", value: "OUTSIDE" }, reason: "Out of area", reviewInstead: false }] },
      },
      { kind: "DISQUALIFIER", key: "anything", payload: {} },
      { kind: "QUALIFICATION_POLICY", key: "*", payload: { goal: "B_BOOK_MEETING", engineMode: "SHADOW" } },
      { kind: "QUALIFICATION_POLICY", key: `service:${SERVICE}`, payload: { motion: "DIRECT_B2B" } },
      { kind: "OBJECTION", key: "PRICE", payload: {} },
    ]);
    assert.equal(parsed.intentOverrides["BUDGET.RANGE"]?.action, "FORBID");
    assert.equal(parsed.intentOverrides["TIMING.START_WINDOW"], undefined, "REWORD without renderings is rejected");
    assert.equal(parsed.disqualifiers.length, 2);
    assert.equal(parsed.disqualifiers[0].disqualifier.reviewInstead, true, "the schema default is REVIEW");
    assert.equal(parsed.workspacePolicy?.goal, "B_BOOK_MEETING");
    assert.equal(parsed.servicePolicies[SERVICE]?.motion, "DIRECT_B2B");
    assert.equal(parsed.rejected.length, 2);
    assert.equal(disqualifiersForService(parsed, null).length, 1);
    assert.equal(disqualifiersForService(parsed, SERVICE).length, 2);
  });
});
