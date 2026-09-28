import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  RENEWAL_WINDOW_DAYS,
  companyFactSignals,
  companyFactsSchema,
  hasCompanyFacts,
  parseHeadcount,
  parseRenewalDate,
  parseTechnologies,
  readCompanyFacts,
} from "../src/lib/imports/company-facts.ts";
import { COMPANY_FACT_FIELDS, IMPORT_FIELDS, guessMapping } from "../src/lib/imports/classify.ts";
import { intentType } from "../src/lib/find-leads/intent-catalogue.ts";
import { evidenceSignalType } from "../src/lib/find-leads/intent-evidence.ts";

/**
 * CRM / list import company facts: contract renewal date, headcount and
 * technologies, feeding CONTRACT_RENEWAL_WINDOW, HEADCOUNT_GROWTH and
 * TECH_ADOPTED from the customer's own data.
 */

const NOW = new Date("2026-09-28T09:00:00Z");

describe("parsing the cells", () => {
  test("renewal dates, day first", () => {
    assert.equal(parseRenewalDate("2027-01-15"), "2027-01-15");
    assert.equal(parseRenewalDate("15/01/2027"), "2027-01-15");
    assert.equal(parseRenewalDate("03/04/2027"), "2027-04-03", "3 April, not 4 March");
    assert.equal(parseRenewalDate("15-01-27"), "2027-01-15");
    assert.equal(parseRenewalDate("15 January 2027"), "2027-01-15");
    assert.equal(parseRenewalDate("1st Feb 2027"), "2027-02-01");
    assert.equal(parseRenewalDate("March 2027"), "2027-03-01");
    assert.equal(parseRenewalDate("Mar-27"), "2027-03-01");
    assert.equal(parseRenewalDate("31/02/2027"), null, "no 31 February");
    assert.equal(parseRenewalDate("soon"), null);
    assert.equal(parseRenewalDate(""), null);
  });

  test("headcount: separators, bands (lower bound) and nonsense", () => {
    assert.equal(parseHeadcount("1,200"), 1200);
    assert.equal(parseHeadcount("51-200"), 51);
    assert.equal(parseHeadcount("51 to 200"), 51);
    assert.equal(parseHeadcount("200+"), 200);
    assert.equal(parseHeadcount("80 employees"), 80);
    assert.equal(parseHeadcount("lots"), null);
    assert.equal(parseHeadcount("-4"), null);
  });

  test("technologies: split, trimmed, de-duplicated, capped", () => {
    assert.deepEqual(parseTechnologies("HubSpot, Shopify; hubspot | Xero\nSlack"), ["HubSpot", "Shopify", "Xero", "Slack"]);
    assert.equal(parseTechnologies(Array.from({ length: 40 }, (_, i) => `Tool${i}`).join(",")).length, 30);
    assert.deepEqual(parseTechnologies(""), []);
  });

  test("the row schema validates what is stored", () => {
    const facts = readCompanyFacts({ contractRenewalDate: "15/01/2027", headcount: "80", technologies: "HubSpot" });
    assert.equal(companyFactsSchema.safeParse(facts).success, true);
    assert.equal(hasCompanyFacts(facts), true);
    assert.equal(hasCompanyFacts(readCompanyFacts({})), false);
  });
});

describe("signals from the customer's own data", () => {
  const base = { previousHeadcount: null, domain: "acme.co.uk", reference: "import-1-row-2", now: NOW };

  test("a renewal inside the window is CONTRACT_RENEWAL_WINDOW; past or far-off dates are not", () => {
    const soon = companyFactSignals({ ...base, facts: { contractRenewalDate: "2026-11-30", headcount: null, technologies: [] } });
    assert.equal(soon.length, 1);
    assert.equal(soon[0].evidence.intentType, "CONTRACT_RENEWAL_WINDOW");
    assert.equal(soon[0].evidence.kind, "TRIGGER_EVENT");
    assert.equal(soon[0].evidence.source, "Your CRM or list");
    assert.match(soon[0].evidence.snippet, /renews on 2026-11-30/);
    assert.equal(evidenceSignalType(soon[0].evidence), "CUSTOMER_DATASET");
    const far = new Date(NOW.getTime() + (RENEWAL_WINDOW_DAYS + 5) * 86_400_000).toISOString().slice(0, 10);
    assert.deepEqual(companyFactSignals({ ...base, facts: { contractRenewalDate: far, headcount: null, technologies: [] } }), []);
    assert.deepEqual(companyFactSignals({ ...base, facts: { contractRenewalDate: "2026-01-01", headcount: null, technologies: [] } }), []);
  });

  test("headcount growth needs a baseline that is lower; a first headcount is not growth", () => {
    const grew = companyFactSignals({ ...base, previousHeadcount: 60, facts: { contractRenewalDate: null, headcount: 80, technologies: [] } });
    assert.equal(grew[0]?.evidence.intentType, "HEADCOUNT_GROWTH");
    assert.match(grew[0].evidence.snippet, /up from 60 \(33%\)/);
    assert.deepEqual(companyFactSignals({ ...base, facts: { contractRenewalDate: null, headcount: 80, technologies: [] } }), []);
    assert.deepEqual(companyFactSignals({ ...base, previousHeadcount: 90, facts: { contractRenewalDate: null, headcount: 80, technologies: [] } }), []);
  });

  test("each technology is a TECH_ADOPTED signal with its own reference", () => {
    const out = companyFactSignals({ ...base, facts: { contractRenewalDate: null, headcount: null, technologies: ["HubSpot", "Xero"] } });
    assert.deepEqual(out.map((s) => s.evidence.intentType), ["TECH_ADOPTED", "TECH_ADOPTED"]);
    assert.notEqual(out[0].evidence.reference, out[1].evidence.reference);
  });

  test("the catalogue lists the customer's data as the source of each type", () => {
    for (const id of ["CONTRACT_RENEWAL_WINDOW", "HEADCOUNT_GROWTH", "TECH_ADOPTED"] as const) {
      assert.ok(intentType(id).sources.some((s) => s.source === "CUSTOMER_DATA"), id);
    }
  });
});

describe("the import mapping", () => {
  test("the three columns are mappable import fields, grouped apart", () => {
    const keys = IMPORT_FIELDS.map((f) => f.key as string);
    for (const key of COMPANY_FACT_FIELDS) assert.ok(keys.includes(key), key);
  });

  test("common CRM headers are guessed", () => {
    const mapping = guessMapping(["Email", "Company", "Contract End Date", "Number of Employees", "Tech Stack"]);
    assert.equal(mapping.contractRenewalDate, 2);
    assert.equal(mapping.headcount, 3);
    assert.equal(mapping.technologies, 4);
    assert.equal(mapping.companyName, 1);
  });
});
