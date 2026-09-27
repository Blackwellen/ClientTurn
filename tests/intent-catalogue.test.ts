import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TYPE_FOR_KIND,
  INTENT_CATALOGUE,
  INTENT_CATALOGUE_VERSION,
  INTENT_GROUPS,
  INTENT_SOURCES,
  INTENT_SOURCE_FEED,
  INTENT_TYPE_IDS,
  ROLE_FUNCTIONS,
  ROLE_FUNCTION_NEEDS,
  STRENGTH_CAP,
  detectingSources,
  effectiveWindowDays,
  intentType,
  intentTypeAvailability,
  intentTypesForCategory,
  intentTypesInGroup,
} from "../src/lib/find-leads/intent-catalogue.ts";
import {
  INTENT_EVIDENCE_KINDS,
  categoryKeywords,
  evidenceSignalType,
  evidenceSummary,
  intentDedupeKey,
  kindsForCategory,
  parseIntentDedupeKey,
} from "../src/lib/find-leads/intent-evidence.ts";
import { EVIDENCE_KIND_FEED, SIGNAL_FEED_PROVIDERS, liveFeeds } from "../src/lib/find-leads/signals.ts";
import { ARCHETYPES } from "../src/lib/sales-library/archetypes.ts";

/**
 * The buying-intent catalogue is the product's promise about where a signal
 * comes from. What must stay true: every type either has a lawful, free
 * source or says plainly that none exists; a named funding round is never
 * claimed from a share allotment; nothing depends on LinkedIn scraping or a
 * paid vendor; and the evidence path can carry and read back every type.
 */

const NOW = new Date("2026-09-27T12:00:00Z");

describe("catalogue integrity", () => {
  test("is versioned and every id is defined exactly once", () => {
    assert.match(INTENT_CATALOGUE_VERSION, /^intent-catalogue-\d+$/);
    const ids = INTENT_CATALOGUE.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual([...ids].sort(), [...INTENT_TYPE_IDS].sort());
  });

  test("every type has a source, or an explicit not-available reason, never both", () => {
    for (const entry of INTENT_CATALOGUE) {
      if (entry.sources.length === 0) {
        assert.ok(entry.notAvailable && entry.notAvailable.length > 20, `${entry.id} needs a reason`);
      } else {
        assert.equal(entry.notAvailable, undefined, `${entry.id} has sources and a not-available reason`);
        for (const source of entry.sources) {
          assert.ok(INTENT_SOURCES.includes(source.source), `${entry.id}: ${source.source}`);
          assert.ok(source.shows.length > 10, `${entry.id}: say what ${source.source} shows`);
        }
      }
      assert.ok(entry.description && entry.label, entry.id);
      assert.ok(INTENT_EVIDENCE_KINDS.includes(entry.evidenceKind), entry.id);
      assert.ok(entry.decayDays >= 7 && entry.decayDays <= 365, entry.id);
      assert.ok(STRENGTH_CAP[entry.strength] > 0, entry.id);
      assert.ok(entry.aliases.length > 0, entry.id);
    }
  });

  test("every group the owner named is populated", () => {
    for (const group of INTENT_GROUPS) assert.ok(intentTypesInGroup(group).length >= 3, group);
    for (const id of [
      "SEED_ROUND", "SERIES_A", "SERIES_B", "SERIES_C_PLUS", "GRANT_AWARDED", "DEBT_FINANCE", "IPO_LISTING",
      "ACQUISITION_MERGER", "NEW_INVESTOR", "SENIOR_HIRE_C_LEVEL", "SENIOR_HIRE_VP", "SENIOR_HIRE_HEAD_OF",
      "LEADERSHIP_CHANGE", "NEW_DIRECTOR", "KEY_DEPARTURE", "TEAM_GROWTH", "HIRING_ROLE", "HIRING_SPIKE",
      "FIRST_HIRE_IN_FUNCTION", "NEW_OFFICE", "REGION_EXPANSION", "HEADCOUNT_GROWTH", "PRODUCT_LAUNCH", "REBRAND",
      "WEBSITE_RELAUNCH", "AWARD_ACCREDITATION", "NEW_PARTNERSHIP", "TECH_ADOPTED", "TECH_REPLACED",
      "PLATFORM_OUTGROWN", "SITE_TECHNICAL_ISSUE", "TENDER_PUBLISHED", "REGULATORY_DEADLINE",
      "CONTRACT_RENEWAL_WINDOW", "COMPANY_ANNIVERSARY", "ACCOUNTS_GROWTH", "REGISTERED_OFFICE_CHANGE",
    ] as const) {
      assert.ok(intentType(id), id);
    }
  });

  test("a named round is never detected from Companies House: an SH01 only says money went in", () => {
    for (const id of ["SEED_ROUND", "SERIES_A", "SERIES_B", "SERIES_C_PLUS"] as const) {
      const entry = intentType(id);
      assert.deepEqual(detectingSources(entry).map((s) => s.source), ["COMPANY_WEBSITE"], id);
      const register = entry.sources.find((s) => s.source === "COMPANIES_HOUSE");
      assert.equal(register?.role, "CORROBORATES", id);
      assert.match(entry.caveat ?? "", /announcement/i, id);
    }
    const raised = intentType("CAPITAL_RAISED");
    assert.ok(raised.sources.some((s) => s.source === "COMPANIES_HOUSE" && s.role === "DETECTED" && /SH01/.test(s.shows)));
  });

  test("no LinkedIn scraping and no paid vendor behind any source", () => {
    const text = JSON.stringify(INTENT_CATALOGUE.map((entry) => entry.sources));
    assert.ok(!/linkedin|apollo|hunter|clearbit|bombora|zoominfo/i.test(text));
    for (const feed of Object.values(INTENT_SOURCE_FEED)) {
      if (!feed) continue;
      for (const key of SIGNAL_FEED_PROVIDERS[feed]) assert.ok(!["apollo", "hunter", "clearbit"].includes(key), key);
    }
    // The types only a scrape or a vendor could supply are listed, not hidden.
    assert.equal(intentType("PERSONAL_JOB_CHANGE").sources.length, 0);
    assert.match(intentType("PERSONAL_JOB_CHANGE").notAvailable!, /LinkedIn/);
    assert.match(intentType("THIRD_PARTY_RESEARCH").notAvailable!, /paid intent vendors/);
  });

  test("Google Places only corroborates; it never makes a type detectable", () => {
    for (const entry of INTENT_CATALOGUE) {
      for (const source of entry.sources.filter((s) => s.source === "GOOGLE_PLACES")) {
        assert.equal(source.role, "CORROBORATES", entry.id);
      }
      for (const source of entry.sources.filter((s) => s.source === "CUSTOMER_DATA")) {
        assert.equal(source.role, "SUPPLIED", entry.id);
      }
    }
  });

  test("services each type indicates are real sales-library archetypes", () => {
    const keys = new Set(ARCHETYPES.map((a) => a.key));
    for (const entry of INTENT_CATALOGUE) {
      if (entry.sources.length > 0) assert.ok(entry.indicates.archetypes.length > 0 && entry.indicates.needs, entry.id);
      for (const key of entry.indicates.archetypes) assert.ok(keys.has(key), `${entry.id}: ${key}`);
    }
    for (const fn of ROLE_FUNCTIONS) {
      assert.ok(ROLE_FUNCTION_NEEDS[fn].needs, fn);
      for (const key of ROLE_FUNCTION_NEEDS[fn].archetypes) assert.ok(keys.has(key), `${fn}: ${key}`);
    }
    // "Hiring a marketing manager suggests an agency need."
    assert.ok(ROLE_FUNCTION_NEEDS.MARKETING.archetypes.includes("MARKETING_AGENCY"));
  });

  test("every coarse kind has a feed, and default types round-trip to their kind", () => {
    for (const kind of INTENT_EVIDENCE_KINDS) assert.ok(EVIDENCE_KIND_FEED[kind], kind);
    for (const [kind, id] of Object.entries(DEFAULT_TYPE_FOR_KIND)) {
      assert.equal(intentType(id!).evidenceKind, kind);
    }
  });
});

describe("availability", () => {
  test("register-only types need the free Companies House key, and say so", () => {
    const websiteOnly = liveFeeds(["website_signals"]);
    const director = intentTypeAvailability("NEW_DIRECTOR", websiteOnly);
    assert.equal(director.available, false);
    assert.match(director.reason!, /Companies House key/);
    assert.equal(intentTypeAvailability("NEW_DIRECTOR", liveFeeds(["companies_house"])).available, true);
  });

  test("website types run with nothing connected; register+website types use whichever is live", () => {
    const websiteOnly = liveFeeds(["website_signals"]);
    assert.equal(intentTypeAvailability("SERIES_A", websiteOnly).available, true);
    const raised = intentTypeAvailability("CAPITAL_RAISED", websiteOnly);
    assert.equal(raised.available, true);
    assert.deepEqual(raised.liveSources, ["COMPANY_WEBSITE"]);
    assert.deepEqual(
      intentTypeAvailability("CAPITAL_RAISED", liveFeeds(["website_signals", "companies_house"])).liveSources.sort(),
      ["COMPANIES_HOUSE", "COMPANY_WEBSITE"],
    );
  });

  test("customer-data-only and unavailable types are greyed with the reason", () => {
    const all = liveFeeds(["website_signals", "companies_house", "google_places"]);
    const renewal = intentTypeAvailability("CONTRACT_RENEWAL_WINDOW", all);
    assert.equal(renewal.available, false);
    assert.match(renewal.reason!, /your own CRM or list/);
    const speed = intentTypeAvailability("SITE_SPEED_MEASURED", all);
    assert.equal(speed.available, false);
    assert.equal(speed.reason, intentType("SITE_SPEED_MEASURED").notAvailable);
  });

  test("decay follows the type but never outlasts the caller's window", () => {
    assert.equal(effectiveWindowDays("HIRING_ROLE", 90), 45);
    assert.equal(effectiveWindowDays("IPO_LISTING", 90), 90);
    assert.equal(effectiveWindowDays(null, 30), 30);
  });
});

describe("categories and the evidence path", () => {
  test("a category started from the catalogue collects its type and kind", () => {
    assert.deepEqual(intentTypesForCategory({ name: "Series A", keywords: [] }), ["SERIES_A"]);
    assert.ok(intentTypesForCategory({ name: "Anything", keywords: ["new head of growth"] }).includes("SENIOR_HIRE_HEAD_OF"));
    assert.ok(kindsForCategory({ name: "Tender or RFP published", keywords: [] }).includes("TRIGGER_EVENT"));
    // No unavailable type is ever collected.
    assert.deepEqual(intentTypesForCategory({ name: "Visited your website", keywords: [] }), []);
  });

  test("the dedupe key keeps its original shape for original types and records finer ones", () => {
    const base = { domain: "acme.co.uk", sourceUrl: null, observedAt: NOW.toISOString(), prospectId: "p1" };
    const legacy = intentDedupeKey({ ...base, evidence: { kind: "FUNDING", reference: "https://x/filing#1", intentType: "CAPITAL_RAISED" } });
    assert.equal(legacy, `acme.co.uk:FUNDING:https://x/filing#1:${NOW.toISOString().slice(0, 10)}:p1`);
    assert.deepEqual(parseIntentDedupeKey(legacy), { kind: "FUNDING", intentType: "CAPITAL_RAISED", roleFunction: null });

    const typed = intentDedupeKey({ ...base, evidence: { kind: "HIRING", reference: "https://acme.co.uk/careers", intentType: "HIRING_ROLE", roleFunction: "MARKETING" } });
    assert.ok(typed.endsWith(":t=HIRING_ROLE/MARKETING"));
    assert.deepEqual(parseIntentDedupeKey(typed), { kind: "HIRING", intentType: "HIRING_ROLE", roleFunction: "MARKETING" });

    const round = intentDedupeKey({ ...base, evidence: { kind: "FUNDING", reference: "https://acme.co.uk/news/a", intentType: "SERIES_A" } });
    assert.equal(parseIntentDedupeKey(round).intentType, "SERIES_A");
    // A keyword mention has no type.
    assert.equal(parseIntentDedupeKey("a.co:WEBSITE_MENTION:https://a.co/:2026-09-01:p").intentType, null);
  });

  test("summary and signal type follow the type and the real source", () => {
    const summary = evidenceSummary({
      kind: "FUNDING",
      source: "Company website",
      reference: "https://a.co/news",
      observedAt: NOW.toISOString(),
      snippet: "Acme closes £4m Series A",
      intentType: "SERIES_A",
    });
    assert.equal(summary, 'Series A (Company website): "Acme closes £4m Series A"');
    assert.equal(evidenceSignalType({ kind: "FUNDING", source: "Company website" }), "COMPANY_WEBSITE");
    assert.equal(evidenceSignalType({ kind: "FUNDING", source: "Companies House" }), "COMPANY_REGISTRY");
    assert.equal(evidenceSignalType({ kind: "HIRING", source: "Company careers page" }), "JOB_POSTING");
  });

  test("category keywords are read whether saved as terms or keywords", () => {
    assert.deepEqual(categoryKeywords({ terms: ["replatform", " "] }), ["replatform"]);
    assert.deepEqual(categoryKeywords({ keywords: ["Shopify"] }), ["Shopify"]);
    assert.deepEqual(categoryKeywords(null), []);
  });
});
