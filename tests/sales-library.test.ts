import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ARCHETYPES,
  archetypeFor,
  qualificationPlan,
  SCORING_PROFILES,
} from "../src/lib/sales-library/archetypes.ts";
import {
  MOTIONS,
  combineWeights,
  isDecisionThresholdMet,
  missingForThreshold,
  normaliseWeights,
} from "../src/lib/sales-library/motions.ts";
import { OBJECTIONS, matchObjection } from "../src/lib/sales-library/objections.ts";
import { chooseMethod, METHOD_EVIDENCE, type MethodInput } from "../src/lib/sales-library/method-router.ts";
import {
  normaliseSicCode,
  resolveArchetype,
  sicPrefixMatches,
} from "../src/lib/sales-library/classify.ts";
import { QUALIFICATION_CATALOGUE } from "../src/lib/sales-library/qualification-dimensions.ts";
import {
  DEAL_SIZE_BANDS,
  FIT_SIGNALS,
  LIBRARY_VERSION,
  OBJECTION_KEYS,
  QUALIFICATION_DIMENSION_KEYS,
  SALES_METHODS,
  SALES_MOTIONS,
  SCORE_DIMENSIONS,
  type DimensionWeights,
  type SalesMotion,
} from "../src/lib/sales-library/types.ts";

const sum = (weights: DimensionWeights) => SCORE_DIMENSIONS.reduce((total, d) => total + weights[d], 0);

/** Every UK SIC 2026 code in migration 0120, in dotted form. */
function sic2026CodesFromMigration(): Set<string> {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase", "migrations", "0120_industry_taxonomy.sql"),
    "utf8",
  );
  const codes = new Set<string>();
  for (const match of sql.matchAll(/\('uk_sic_2026', '([^']+)', (?:null|'\d+'), '[A-Z]+'/g)) {
    codes.add(match[1]);
  }
  return codes;
}

/** SIC 2007 → 2026 correspondence from 0120, for classification tests. */
function sicMappingFromMigration(): Map<string, string[]> {
  const sql = readFileSync(
    path.join(process.cwd(), "supabase", "migrations", "0120_industry_taxonomy.sql"),
    "utf8",
  );
  const map = new Map<string, string[]>();
  for (const match of sql.matchAll(/\('uk_sic_2007', '([^']+)', 'uk_sic_2026', '([^']+)'/g)) {
    map.set(match[1], [...(map.get(match[1]) ?? []), match[2]]);
  }
  return map;
}

describe("library shape", () => {
  test("LIBRARY_VERSION is set", () => {
    assert.match(LIBRARY_VERSION, /^sl-\d{4}\.\d{2}\.\d+$/);
  });

  test("about sixty archetypes with unique keys, covering the ICP deeply", () => {
    assert.ok(ARCHETYPES.length >= 55, `only ${ARCHETYPES.length} archetypes`);
    const keys = ARCHETYPES.map((a) => a.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate archetype key");
    for (const key of [
      "B2B_SAAS", "PLG_SAAS", "ENTERPRISE_SAAS", "MSP", "MARKETING_AGENCY", "SEO_AGENCY",
      "CREATIVE_WEB_STUDIO", "ECOMMERCE", "ACCOUNTING", "LAW_FIRM", "MANAGEMENT_CONSULTING",
      "RECRUITMENT",
    ]) {
      assert.equal(archetypeFor(key)?.depth, "DEEP", `${key} should be a DEEP (ICP) archetype`);
    }
    assert.ok(archetypeFor("OTHER"), "a fallback archetype exists");
  });

  test("every scoring profile's weights sum to exactly 100", () => {
    for (const profile of Object.values(SCORING_PROFILES)) {
      assert.equal(sum(profile.weights), 100, `profile ${profile.key}`);
      for (const d of SCORE_DIMENSIONS) assert.ok(profile.weights[d] >= 0, `${profile.key}.${d}`);
    }
    for (const archetype of ARCHETYPES) {
      assert.equal(sum(archetype.scoringProfile.weights), 100, `archetype ${archetype.key}`);
    }
  });

  test("every archetype × motion combination sums to 100", () => {
    for (const archetype of ARCHETYPES) {
      for (const motion of SALES_MOTIONS) {
        const w = combineWeights(archetype.scoringProfile.weights, motion);
        assert.equal(sum(w), 100, `${archetype.key} × ${motion}`);
        for (const d of SCORE_DIMENSIONS) assert.ok(Number.isInteger(w[d]) && w[d] >= 0);
      }
    }
  });

  test("motion weight adjustments are zero-sum", () => {
    for (const motion of Object.values(MOTIONS)) {
      const total = Object.values(motion.weightAdjustments).reduce((a, b) => a + (b ?? 0), 0);
      assert.equal(total, 0, motion.key);
    }
  });

  test("workspace overrides renormalise to 100 and a zeroed override falls back", () => {
    const base = SCORING_PROFILES.DEFAULT_B2B.weights;
    const w = combineWeights(base, null, { FIT: 60 });
    assert.equal(sum(w), 100);
    assert.ok(w.FIT > base.FIT, "override raised FIT");
    const zero = normaliseWeights(
      { FIT: 0, INTENT: 0, NEED: 0, COMMERCIAL: 0, DECISION_ACCESS: 0, TIMING: 0, ENGAGEMENT: 0 },
      base,
    );
    assert.deepEqual(zero, base);
    assert.equal(sum(normaliseWeights({ FIT: 1, INTENT: 1, NEED: 1 }, base)), 100);
  });

  test("fit signals, deal bands, motions and methods use known vocabulary", () => {
    for (const archetype of ARCHETYPES) {
      assert.ok(archetype.defaultMotions.length > 0, archetype.key);
      for (const motion of archetype.defaultMotions) assert.ok(SALES_MOTIONS.includes(motion));
      assert.ok(DEAL_SIZE_BANDS.includes(archetype.dealSizeBand));
      assert.ok(archetype.scoringProfile.fitSignals.length > 0);
      for (const signal of archetype.scoringProfile.fitSignals) assert.ok(FIT_SIGNALS.includes(signal));
      assert.ok(archetype.decisionMakerRoles.length > 0, archetype.key);
    }
    for (const motion of Object.values(MOTIONS)) {
      assert.ok(SALES_METHODS.includes(motion.defaultMethod));
      assert.equal(motion.maxPrimaryQuestionsPerMessage, 1);
    }
  });

  test("qualification dimensions are complete, in range and have one question", () => {
    for (const key of QUALIFICATION_DIMENSION_KEYS) {
      const d = QUALIFICATION_CATALOGUE[key];
      for (const attr of ["informationGain", "decisionRelevance", "commercialValue", "friction", "prematurity"] as const) {
        assert.ok(d[attr] >= 0 && d[attr] <= 1, `${key}.${attr}`);
      }
      assert.equal((d.question.match(/\?/g) ?? []).length, 1, `${key} asks exactly one question`);
    }
    for (const archetype of ARCHETYPES) {
      for (const d of archetype.qualification) {
        assert.ok(QUALIFICATION_DIMENSION_KEYS.includes(d.key), `${archetype.key}: ${d.key}`);
        assert.equal((d.question.match(/\?/g) ?? []).length, 1, `${archetype.key}.${d.key} asks one question`);
      }
    }
  });

  test("budget and authority are premature relative to the problem", () => {
    const c = QUALIFICATION_CATALOGUE;
    assert.ok(c.BUDGET.prematurity > c.PROBLEM.prematurity);
    assert.ok(c.AUTHORITY.prematurity > c.USE_CASE.prematurity);
  });

  test("every archetype × default motion plan can reach the motion's decision threshold", () => {
    for (const archetype of ARCHETYPES) {
      for (const motion of SALES_MOTIONS) {
        const plan = qualificationPlan(archetype, motion).map((d) => d.key);
        assert.equal(new Set(plan).size, plan.length, `${archetype.key}×${motion} repeats a dimension`);
        assert.ok(isDecisionThresholdMet(motion, plan), `${archetype.key} × ${motion} cannot meet its threshold`);
      }
    }
  });

  test("decision threshold stopping rule", () => {
    assert.equal(isDecisionThresholdMet("LOCAL_SERVICE", ["SERVICE_NEEDED", "LOCATION"]), false);
    assert.equal(isDecisionThresholdMet("LOCAL_SERVICE", ["SERVICE_NEEDED", "LOCATION", "TIMING"]), true);
    assert.equal(isDecisionThresholdMet("BOOK_MEETING_B2B", ["USE_CASE"]), false, "needs one of anyOf");
    assert.equal(isDecisionThresholdMet("BOOK_MEETING_B2B", ["USE_CASE", "TEAM_SIZE"]), true);
    assert.deepEqual(missingForThreshold("ENTERPRISE", ["PROBLEM"]), ["STAKEHOLDERS", "DECISION_PROCESS"]);
  });
});

describe("SIC codes", () => {
  const codes = sic2026CodesFromMigration();

  test("the migration parse found the taxonomy", () => {
    assert.ok(codes.size > 1000, `parsed only ${codes.size} codes`);
    assert.ok(codes.has("62.12/1") && codes.has("73.11") && codes.has("43.41"));
  });

  test("every archetype SIC 2026 prefix exists in 0120", () => {
    const missing: string[] = [];
    for (const archetype of ARCHETYPES) {
      for (const prefix of archetype.sic2026Prefixes) {
        if (!codes.has(prefix)) missing.push(`${archetype.key}: ${prefix}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  test("only form-not-activity archetypes have no SIC prefix", () => {
    const empty = ARCHETYPES.filter((a) => a.sic2026Prefixes.length === 0).map((a) => a.key).sort();
    assert.deepEqual(empty, ["FRANCHISE", "FREELANCER", "OTHER"]);
  });

  test("the 0121 alias seed only uses codes that exist", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase", "migrations", "0121_sales_intelligence.sql"),
      "utf8",
    );
    const block = sql.slice(sql.indexOf("insert into public.industry_aliases"));
    const rows = [...block.matchAll(/\('([0-9./]+)', '([^']+)'\)/g)];
    assert.ok(rows.length > 100, `only ${rows.length} alias rows`);
    for (const [, code] of rows) assert.ok(codes.has(code), `alias code ${code}`);
  });

  test("code normalisation and hierarchical matching", () => {
    assert.equal(normaliseSicCode("62121"), "62.12/1");
    assert.equal(normaliseSicCode("62120"), "62.12");
    assert.equal(normaliseSicCode("73.11"), "73.11");
    assert.equal(normaliseSicCode("not a code"), null);
    assert.equal(sicPrefixMatches("62.20", "62.20/1"), true);
    assert.equal(sicPrefixMatches("43", "43.21/3"), true);
    assert.equal(sicPrefixMatches("62.1", "62.12/4"), true);
    assert.equal(sicPrefixMatches("62.1", "62.20"), false);
    assert.equal(sicPrefixMatches("6", "62.20"), false);
    assert.equal(sicPrefixMatches("43.2", "43.22/1"), true);
  });
});

describe("classification", () => {
  const mapping = sicMappingFromMigration();
  const mapSic2007 = (klass: string) => mapping.get(klass) ?? [];

  test("an unambiguous SIC 2026 code binds", () => {
    const result = resolveArchetype({ sic2026Codes: ["43.41"] });
    assert.equal(result.best, "ROOFER");
    assert.equal(result.binding, true);
    assert.equal(result.classificationSource, "USER");
  });

  test("a SIC code shared by two archetypes is never binding", () => {
    // SIC 2026 cannot separate a shop from an ecommerce brand.
    const result = resolveArchetype({ sic2026Codes: ["47.71"] });
    assert.equal(result.binding, false);
    const keys = result.candidates.map((c) => c.archetypeKey);
    assert.ok(keys.includes("RETAILER") && keys.includes("ECOMMERCE"));
  });

  test("a Companies House SIC 2007 code maps through the correspondence table", () => {
    // 2007 73.11 (advertising agencies) → 2026 73.11.
    const result = resolveArchetype({ sic2007Codes: ["73110"], mapSic2007 });
    assert.ok(result.candidates.length > 0);
    assert.ok(result.candidates.every((c) => c.source === "SIC_2007_MAPPED"));
    assert.equal(result.classificationSource, "COMPANIES_HOUSE");
  });

  test("alias text disambiguates a shared SIC code", () => {
    const result = resolveArchetype({ sic2026Codes: ["47.71"], aliasText: "We're an online shop selling clothing" });
    assert.equal(result.best, "ECOMMERCE");
  });

  test("an exact alias binds on its own", () => {
    const result = resolveArchetype({ aliasText: "Web design" });
    assert.equal(result.best, "CREATIVE_WEB_STUDIO");
    assert.equal(result.binding, true);
  });

  test("website keywords alone are not binding", () => {
    const result = resolveArchetype({ websiteKeywords: ["We are a digital marketing agency"] });
    assert.equal(result.best, "MARKETING_AGENCY");
    assert.equal(result.binding, false);
    assert.equal(result.classificationSource, "WEBSITE");
  });

  test("nothing matched gives no answer", () => {
    const result = resolveArchetype({ aliasText: "zzz" });
    assert.equal(result.best, null);
    assert.equal(result.binding, false);
  });

  test("deterministic", () => {
    const input = { sic2026Codes: ["62.20/9"], aliasText: "managed it support" };
    assert.deepEqual(resolveArchetype(input), resolveArchetype(input));
  });
});

describe("objections", () => {
  test("the library covers every brief §59 category", () => {
    assert.deepEqual(Object.keys(OBJECTIONS).sort(), [...OBJECTION_KEYS].sort());
    for (const key of OBJECTION_KEYS) {
      const entry = OBJECTIONS[key];
      assert.ok(entry.patterns.length > 0, key);
      assert.ok(entry.underlyingConcerns.length > 0, key);
      assert.ok(entry.responseStrategy.length > 0, key);
      if (!entry.respectAsRefusal) assert.ok(entry.clarifyingQuestion.endsWith("?"), key);
    }
  });

  test("every objection key referenced by an archetype exists", () => {
    for (const archetype of ARCHETYPES) {
      for (const key of archetype.commonObjections) {
        assert.ok(OBJECTIONS[key], `${archetype.key} references unknown objection ${key}`);
      }
    }
  });

  test("security, compliance, procurement and contract always hand over", () => {
    for (const key of ["SECURITY", "COMPLIANCE", "PROCUREMENT", "CONTRACT"] as const) {
      assert.equal(OBJECTIONS[key].handover.always, true, key);
    }
  });

  test("response strategies never tell the drafter to invent incentives", () => {
    for (const entry of Object.values(OBJECTIONS)) {
      const text = entry.responseStrategy.join(" ").toLowerCase();
      assert.doesNotMatch(text, /\b(offer|give) (a )?discount\b|limited time|act now|only \d+ left/);
    }
  });

  test("matchObjection finds the right playbook", () => {
    assert.equal(matchObjection("Honestly it's a bit expensive for us")[0]?.key, "PRICE");
    assert.equal(matchObjection("We already have an agency we're happy with")[0]?.key, "EXISTING_PROVIDER");
    assert.equal(matchObjection("Can you send me some info?")[0]?.key, "SEND_INFORMATION");
    assert.equal(matchObjection("I'd need to check with my director")[0]?.key, "AUTHORITY");
    const security = matchObjection("We'd need you to complete our security questionnaire");
    assert.equal(security[0]?.key, "SECURITY");
    assert.equal(security[0]?.handoverRequired, true);
    assert.deepEqual(matchObjection(""), []);
    assert.deepEqual(matchObjection("Thursday at 2pm works"), []);
  });

  test("a refusal always leads, even when other patterns match", () => {
    const matches = matchObjection("Not interested, too expensive anyway");
    assert.equal(matches[0]?.key, "NOT_INTERESTED");
    assert.equal(OBJECTIONS.NOT_INTERESTED.respectAsRefusal, true);
  });
});

describe("method router", () => {
  const base: MethodInput = {
    motion: "BOOK_MEETING_B2B",
    dealSizeBand: "SMALL",
    direction: "INBOUND",
    stage: "NEW",
  };

  test("MEDDPICC is chosen only for the ENTERPRISE motion", () => {
    for (const motion of SALES_MOTIONS) {
      for (const band of DEAL_SIZE_BANDS) {
        for (const stakeholderCount of [0, 2, 6]) {
          for (const direction of ["INBOUND", "OUTBOUND"] as const) {
            const d = chooseMethod({ ...base, motion, dealSizeBand: band, stakeholderCount, direction, hasApprovedInsight: true });
            if (d.method === "MEDDPICC") assert.equal(motion, "ENTERPRISE");
            if (motion === "ENTERPRISE") assert.equal(d.method, "MEDDPICC");
          }
        }
      }
    }
  });

  test("CHALLENGER_INSIGHT is never chosen without an approved insight", () => {
    for (const motion of SALES_MOTIONS) {
      for (const band of DEAL_SIZE_BANDS) {
        for (const stage of ["NEW", "ENGAGED", "QUALIFYING", "OBJECTION", "CLOSING"] as const) {
          for (const hasApprovedInsight of [false, undefined]) {
            const d = chooseMethod({ ...base, motion, dealSizeBand: band, stage, direction: "OUTBOUND", hasApprovedInsight });
            assert.notEqual(d.method, "CHALLENGER_INSIGHT", `${motion}/${band}/${stage}`);
          }
        }
      }
    }
    const withInsight = chooseMethod({ ...base, direction: "OUTBOUND", hasApprovedInsight: true });
    assert.equal(withInsight.method, "CHALLENGER_INSIGHT");
  });

  test("motion defaults", () => {
    const expect: Record<SalesMotion, string> = {
      BOOK_MEETING_B2B: "SIMPLE_QUALIFICATION",
      DIRECT_B2B: "SIMPLE_QUALIFICATION",
      LOCAL_SERVICE: "SIMPLE_QUALIFICATION",
      HIGH_TICKET_B2C: "SIMPLE_QUALIFICATION",
      ECOMMERCE_DIRECT: "TRANSACTIONAL",
      SAAS_SELF_SERVE: "PLG",
      ENTERPRISE: "MEDDPICC",
    };
    for (const motion of SALES_MOTIONS) {
      assert.equal(chooseMethod({ ...base, motion }).method, expect[motion], motion);
    }
    assert.equal(chooseMethod({ ...base, dealSizeBand: "MID" }).method, "SPIN");
  });

  test("every decision carries an evidence grade, a reason and the motion's close target", () => {
    for (const motion of SALES_MOTIONS) {
      const d = chooseMethod({ ...base, motion });
      assert.equal(d.evidenceGrade, METHOD_EVIDENCE[d.method].grade);
      assert.equal(d.closeTarget, MOTIONS[motion].closeTarget);
      assert.ok(d.reason.length > 10);
      assert.equal(d.libraryVersion, LIBRARY_VERSION);
    }
    assert.equal(METHOD_EVIDENCE.SPIN.grade, "SALES_CONVENTION_OBSERVATIONAL");
    assert.equal(METHOD_EVIDENCE.MEDDPICC.grade, "SALES_CONVENTION");
    assert.equal(METHOD_EVIDENCE.CHALLENGER_INSIGHT.grade, "SALES_CONVENTION");
  });

  test("an objection turn narrows the question style", () => {
    assert.equal(chooseMethod({ ...base, dealSizeBand: "MID", stage: "OBJECTION" }).questionStyle, "ONE_DIRECT_QUESTION");
  });
});
