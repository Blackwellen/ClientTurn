import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WEIGHTS,
  gradeForScore,
  meetsMinimumGrade,
  passesPersonalisationGate,
  scoreProspect,
  type ScoreFeature,
} from "../src/lib/prospects/scoring.ts";
import {
  cheapChecks,
  classifyContactMatch,
  companyDedupeKey,
  isRoleMailbox,
  normaliseCompanyName,
  normaliseDomain,
  normaliseEmail,
} from "../src/lib/prospects/dedupe.ts";

/**
 * The scoring rules are the product's defence against spending enrichment and
 * outreach budget on bad-fit contacts, so these tests are mostly about the
 * arithmetic being bounded, deterministic and explainable — never about a
 * particular prospect getting a particular number.
 */

function feature(
  factor: ScoreFeature["factor"],
  value: number,
  confidence = 1,
): ScoreFeature {
  return { factor, value, confidence, evidenceSummary: `${factor} evidence` };
}

const PERFECT: ScoreFeature[] = (
  Object.keys(DEFAULT_WEIGHTS) as ScoreFeature["factor"][]
).map((f) => feature(f, 1, 1));

/* ------------------------------------------------------------- arithmetic */

test("a perfect prospect scores 100 and grades A+", () => {
  const result = scoreProspect(PERFECT);
  assert.equal(result.totalScore, 100);
  assert.equal(result.grade, "A+");
});

test("no evidence at all scores 0 and grades D", () => {
  const result = scoreProspect([]);
  assert.equal(result.totalScore, 0);
  assert.equal(result.grade, "D");
  assert.match(result.explanation, /Not enough evidence/);
});

test("scoring is deterministic", () => {
  const a = scoreProspect(PERFECT);
  const b = scoreProspect(PERFECT);
  assert.deepEqual(a, b);
});

test("out-of-range model output cannot inflate a score", () => {
  const wild = [
    feature("ICP_FIT", 4.2, 9),
    feature("ROLE_AUTHORITY", -3, 1),
    feature("NEED", Number.NaN, 1),
    feature("GEOGRAPHY", Number.POSITIVE_INFINITY, 1),
  ];
  const result = scoreProspect(wild);
  assert.ok(result.totalScore <= 100, "score must stay within 0..100");
  assert.ok(result.totalScore >= 0);
});

test("missing factors score zero rather than renormalising the weights", () => {
  // Two perfect factors out of six must NOT reach grade A.
  const partial = [feature("ICP_FIT", 1, 1), feature("ROLE_AUTHORITY", 1, 1)];
  const result = scoreProspect(partial);
  assert.equal(result.totalScore, 50);
  assert.equal(result.grade, "D");
});

test("low confidence discounts a contribution rather than discarding it", () => {
  const certain = scoreProspect([feature("ICP_FIT", 1, 1)]);
  const halfSure = scoreProspect([feature("ICP_FIT", 1, 0.5)]);
  assert.ok(halfSure.totalScore > 0);
  assert.ok(halfSure.totalScore < certain.totalScore);
});

test("the strongest evidence wins when several signals speak to one factor", () => {
  const weakMany = scoreProspect([
    feature("ICP_FIT", 0.3, 0.4),
    feature("ICP_FIT", 0.3, 0.4),
    feature("ICP_FIT", 0.3, 0.4),
  ]);
  const strongOne = scoreProspect([feature("ICP_FIT", 0.9, 0.9)]);
  assert.ok(strongOne.totalScore > weakMany.totalScore);
});

/* ------------------------------------------------------------ intent boost */

test("intent boost is bounded and cannot carry a poor-fit prospect to grade A", () => {
  const poorFit = scoreProspect([feature("ICP_FIT", 0.1, 1)], { intentBoost: 999 });
  assert.ok(poorFit.totalScore <= 100);
  assert.notEqual(poorFit.grade, "A+");
  assert.notEqual(poorFit.grade, "A");
});

test("intent boost can lift a good-fit prospect over a threshold", () => {
  const features = (Object.keys(DEFAULT_WEIGHTS) as ScoreFeature["factor"][]).map((f) =>
    feature(f, 0.8, 1),
  );
  const without = scoreProspect(features);
  const withBoost = scoreProspect(features, { intentBoost: 10 });
  assert.ok(withBoost.totalScore > without.totalScore);
  assert.match(withBoost.explanation, /buying-intent/);
});

/* ------------------------------------------------------------------ grades */

test("grade bands match the specification", () => {
  assert.equal(gradeForScore(100), "A+");
  assert.equal(gradeForScore(95), "A+");
  assert.equal(gradeForScore(94.99), "A");
  assert.equal(gradeForScore(85), "A");
  assert.equal(gradeForScore(84.99), "B");
  assert.equal(gradeForScore(70), "B");
  assert.equal(gradeForScore(69.99), "C");
  assert.equal(gradeForScore(55), "C");
  assert.equal(gradeForScore(54.99), "D");
  assert.equal(gradeForScore(0), "D");
});

test("minimum grade comparison is ordered correctly", () => {
  assert.equal(meetsMinimumGrade("A+", "B"), true);
  assert.equal(meetsMinimumGrade("B", "B"), true);
  assert.equal(meetsMinimumGrade("C", "B"), false);
  assert.equal(meetsMinimumGrade(null, "D"), false);
});

test("mini-model personalisation is never spent on an uncontacted prospect", () => {
  assert.equal(passesPersonalisationGate(95, false), false);
  assert.equal(passesPersonalisationGate(95, true), true);
  assert.equal(passesPersonalisationGate(40, true), false);
});

/* ------------------------------------------------------------ explanations */

test("every factor is reported, so a score can always be explained", () => {
  const result = scoreProspect([feature("ICP_FIT", 1, 1)]);
  assert.equal(result.factors.length, Object.keys(DEFAULT_WEIGHTS).length);
  for (const f of result.factors) {
    assert.ok(typeof f.contribution === "number");
    assert.ok(["POSITIVE", "NEGATIVE", "NEUTRAL"].includes(f.direction));
  }
});

test("the score version travels with the result", () => {
  assert.match(scoreProspect(PERFECT).scoreVersion, /^v\d/);
});

/* -------------------------------------------------------------- identity */

test("domain normalisation strips scheme, www, path and port", () => {
  assert.equal(normaliseDomain("https://www.Acme.co.uk/about?x=1"), "acme.co.uk");
  assert.equal(normaliseDomain("acme.com:443"), "acme.com");
  assert.equal(normaliseDomain("mail.acme.com"), "acme.com");
  assert.equal(normaliseDomain("shop.acme.co.uk"), "acme.co.uk");
  assert.equal(normaliseDomain("not a domain"), null);
  assert.equal(normaliseDomain(""), null);
  assert.equal(normaliseDomain(null), null);
});

test("email normalisation rejects malformed addresses rather than repairing them", () => {
  assert.equal(normaliseEmail(" Buyer@Acme.CO.UK "), "buyer@acme.co.uk");
  assert.equal(normaliseEmail("two@@acme.com"), null);
  assert.equal(normaliseEmail("no-at-sign"), null);
  assert.equal(normaliseEmail("spaces in@acme.com"), null);
  assert.equal(normaliseEmail("nodot@localhost"), null);
});

test("role mailboxes are recognised, including decorated forms", () => {
  assert.equal(isRoleMailbox("info@acme.com"), true);
  assert.equal(isRoleMailbox("sales.uk@acme.com"), true);
  assert.equal(isRoleMailbox("no-reply@acme.com"), true);
  assert.equal(isRoleMailbox("jane.doe@acme.com"), false);
});

test("company name normalisation drops legal suffixes and punctuation", () => {
  assert.equal(normaliseCompanyName("Acme Roofing Ltd."), "acme roofing");
  assert.equal(normaliseCompanyName("ACME ROOFING LIMITED"), "acme roofing");
  assert.equal(normaliseCompanyName("Acme & Sons Ltd Group"), "acme and sons");
});

test("a generic mailbox domain never becomes a company dedupe key", () => {
  const key = companyDedupeKey({ domain: "gmail.com", name: "Acme Roofing", postcode: "BH1 1AA" });
  assert.ok(key.startsWith("name:"), `expected a name key, got ${key}`);
});

test("the same company from two sources produces one dedupe key", () => {
  const a = companyDedupeKey({ website: "https://www.acme.co.uk/" });
  const b = companyDedupeKey({ domain: "ACME.CO.UK" });
  assert.equal(a, b);
});

test("companies with nothing identifying do not collapse into one row", () => {
  const a = companyDedupeKey({});
  const b = companyDedupeKey({});
  assert.notEqual(a, b);
});

/* ------------------------------------------------------------- matching */

test("an exact email match merges, a name match does not", () => {
  const exact = classifyContactMatch(
    { email: "Jane@Acme.com" },
    { email: "jane@acme.com" },
  );
  assert.equal(exact.action, "MERGE");

  const nameOnly = classifyContactMatch(
    { firstName: "Jane", lastName: "Doe" },
    { firstName: "Jane", lastName: "Doe" },
  );
  assert.equal(nameOnly.action, "CREATE");
  assert.equal(nameOnly.strength, "WEAK");
});

test("same name at the same company is a review, never a silent merge", () => {
  const result = classifyContactMatch(
    { firstName: "Jane", lastName: "Doe", companyDomain: "acme.com", email: "j.doe@acme.com" },
    { firstName: "Jane", lastName: "Doe", companyDomain: "acme.com", email: "jane@acme.com" },
  );
  assert.equal(result.action, "REVIEW");
  assert.equal(result.strength, "STRONG");
});

/* ---------------------------------------------------------- cheap checks */

test("disposable and malformed candidates are rejected before paid enrichment", () => {
  assert.equal(cheapChecks({ email: "x@mailinator.com", companyName: "Acme" }).reject, true);
  assert.equal(cheapChecks({ email: "broken", companyName: "Acme" }).reject, true);
  assert.equal(cheapChecks({ companyName: null, domain: null }).reject, true);
});

test("a role mailbox is flagged but not rejected outright", () => {
  const result = cheapChecks({ email: "info@acme.co.uk", domain: "acme.co.uk", companyName: "Acme" });
  assert.equal(result.reject, false);
  assert.ok(result.flags.includes("ROLE_MAILBOX"));
});

test("a clean corporate candidate raises no flags", () => {
  const result = cheapChecks({
    email: "jane.doe@acme.co.uk",
    domain: "acme.co.uk",
    companyName: "Acme Roofing",
  });
  assert.deepEqual(result.flags, []);
  assert.equal(result.reject, false);
});
