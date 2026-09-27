import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  careersFindings,
  detectAnnouncements,
  roleFunctionForTitle,
  seniorityForTitle,
  siteIssues,
} from "../src/lib/find-leads/website-announcements.ts";
import {
  accountsTier,
  filingCategoriesFor,
  registerSignals,
  registerWantsForTypes,
} from "../src/lib/find-leads/companies-house-signals.ts";
import { INTENT_CATALOGUE, type IntentTypeId } from "../src/lib/find-leads/intent-catalogue.ts";

/**
 * Every phrase family is proved twice: a real announcement matches, and the
 * marketing copy that uses the same words does not. Then a coverage check:
 * every catalogue type with a DETECTED source has a detector that produced it
 * from a fixture here, so a type cannot be offered and never found.
 */

const NOW = new Date("2026-09-27T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);
const produced = new Set<IntentTypeId>();

function types(text: string): IntentTypeId[] {
  const found = detectAnnouncements(text).map((a) => a.type);
  found.forEach((t) => produced.add(t));
  return found;
}

/** [type, positive, negative] for each family. */
const FAMILIES: [IntentTypeId, string, string][] = [
  ["SEED_ROUND", "Acme has closed a £1.2m seed round led by Ada Ventures.", "We help founders prepare for their seed round."],
  ["SERIES_A", "Today we announced our $12 million Series A funding round.", "Our guide to raising a Series A round for your startup."],
  ["SERIES_B", "Northwind raises £30m Series B investment to expand.", "Series B cables are sold in our shop."],
  ["SERIES_C_PLUS", "The company secured a Series D round of $80m.", "Watch Series D of our podcast."],
  ["CAPITAL_RAISED", "We've raised £2m from investors to accelerate growth.", "Our team raised £5,000 for charity in the fun run."],
  ["GRANT_AWARDED", "We have been awarded an Innovate UK Smart grant of £400k.", "We can help you apply for a grant this year."],
  ["DEBT_FINANCE", "Acme has secured a £5m revenue-based financing facility.", "Revenue-based financing explained: how to decide."],
  ["IPO_LISTING", "Today we completed our admission to trading on AIM.", "We advise clients on IPO readiness and admission to AIM."],
  ["ACQUISITION_MERGER", "Brightside has been acquired by Globex Group.", "Customer acquisition costs are rising across retail."],
  ["NEW_INVESTOR", "The round was led by Seedcamp with participation from angels.", "We are an investor-ready consultancy."],
  ["SENIOR_HIRE_C_LEVEL", "Acme welcomes Jane Smith as Chief Technology Officer.", "Contact our CTO for technical questions."],
  ["SENIOR_HIRE_VP", "Sam Lee joins as VP of Sales after ten years at Oracle.", "We're hiring a VP of Sales, apply now."],
  ["SENIOR_HIRE_HEAD_OF", "We are delighted to appoint Priya Shah as Head of Growth.", "Meet Priya, our Head of Growth, at the event."],
  ["KEY_DEPARTURE", "Our founder and CEO will step down at the end of the year.", "Use a step down transformer for the EU plug."],
  ["TEAM_GROWTH", "Please welcome our five new starters this month!", "Welcome to our website."],
  ["HEADCOUNT_GROWTH", "We have grown to 120 people across three countries.", "Grow your team with our recruitment help."],
  ["NEW_OFFICE", "We have opened a new office in Manchester.", "Our office opening hours are 9 to 5, open plan office."],
  ["REGION_EXPANSION", "Acme is expanding into the US with a New York team.", "We help brands expand into Europe."],
  ["PRODUCT_LAUNCH", "We're excited to launch our new analytics platform.", "Launch your product faster with our help."],
  ["REBRAND", "We've rebranded: Acme Digital is now known as Northwind.", "Our rebranding services help your brand stand out."],
  ["WEBSITE_RELAUNCH", "Welcome to our brand new website!", "We build new websites for ambitious companies."],
  ["AWARD_ACCREDITATION", "We won the Best Agency award at the UK Digital Awards 2026.", "An award-winning agency trusted since 2004."],
  ["NEW_PARTNERSHIP", "Acme announces a strategic partnership with Microsoft.", "Our team partners with clients to deliver results."],
  ["TECH_REPLACED", "We migrated from Magento to Shopify this spring.", "We help you migrate from Magento to Shopify."],
  ["TECH_ADOPTED", "We have now moved to HubSpot for all our marketing.", "Moving to HubSpot? Read our tips for your team."],
  ["PLATFORM_OUTGROWN", "We had outgrown our WordPress site, so we began re-platforming.", "Outgrown your website? Talk to us."],
  ["TENDER_PUBLISHED", "Invitation to tender: website redesign. Submission deadline 30 October.", "Our bid writing team helps you respond to an invitation to tender."],
];

describe("announcement phrase families", () => {
  for (const [type, positive, negative] of FAMILIES) {
    test(`${type}: announcement matches, copy does not`, () => {
      assert.ok(types(positive).includes(type), `positive: ${positive} -> ${types(positive).join(",")}`);
      assert.ok(!detectAnnouncements(negative).some((a) => a.type === type), `negative: ${negative}`);
    });
  }

  test("a named round carries the round and the amount", () => {
    const [round] = detectAnnouncements("Today we announced our $12 million Series A funding round.").filter((a) => a.type === "SERIES_A");
    assert.equal(round.round, "Series A");
    assert.equal(round.amount, "$12million");
    const [seed] = detectAnnouncements("Acme has closed a £1.2m pre-seed round.").filter((a) => a.type === "SEED_ROUND");
    assert.equal(seed.round, "Pre-seed");
    assert.equal(seed.amount, "£1.2m");
  });

  test("a senior hire snippet keeps the role and drops the person's name", () => {
    const [hire] = detectAnnouncements("Acme welcomes Jane Smith as Chief Technology Officer.").filter((a) => a.type === "SENIOR_HIRE_C_LEVEL");
    assert.ok(!/Jane|Smith/.test(hire.snippet), hire.snippet);
    assert.match(hire.snippet, /Chief Technology Officer/);
    assert.equal(hire.roleFunction, "ENGINEERING");
    const [growth] = detectAnnouncements("We are delighted to appoint Priya Shah as Head of Growth at Acme.").filter((a) => a.type === "SENIOR_HIRE_HEAD_OF");
    assert.equal(growth.roleFunction, "MARKETING");
    assert.ok(!/Priya/.test(growth.snippet));
  });

  test("titles map to seniority and function", () => {
    assert.equal(seniorityForTitle("Chief Marketing Officer"), "C_LEVEL");
    assert.equal(seniorityForTitle("VP Engineering"), "VP");
    assert.equal(seniorityForTitle("Head of People"), "HEAD");
    assert.equal(seniorityForTitle("Account Manager"), null);
    assert.equal(roleFunctionForTitle("Chief Financial Officer"), "FINANCE");
    assert.equal(roleFunctionForTitle("Chief Executive Officer"), null);
  });
});

describe("careers pages", () => {
  const careers =
    "Join our team! Open roles: Marketing Manager (London), Senior Software Engineer, Product Designer, " +
    "Account Executive, Data Analyst, Office Manager, Customer Success Manager. " +
    "This is our first marketing hire, reporting to the CEO. Apply now.";

  test("roles are grouped by function, with a spike and a first hire", () => {
    const found = careersFindings(careers);
    const fns = found.roles.map((r) => r.roleFunction).sort();
    assert.deepEqual(fns, ["CUSTOMER_SUCCESS", "DATA", "DESIGN", "ENGINEERING", "MARKETING", "OPERATIONS", "SALES"]);
    assert.ok(found.distinctTitles >= 6);
    assert.equal(found.spike, true);
    assert.deepEqual(found.firstHires.map((f) => f.roleFunction), ["MARKETING"]);
    produced.add("HIRING_ROLE");
    produced.add("HIRING_SPIKE");
    produced.add("FIRST_HIRE_IN_FUNCTION");
  });

  test("an about page naming staff is not hiring; two roles are not a spike; a first campaign is not a first hire", () => {
    assert.deepEqual(careersFindings("Meet Sam, our Marketing Manager, and Ali, our Software Engineer."), {
      roles: [], distinctTitles: 0, spike: false, firstHires: [],
    });
    const small = careersFindings("We're hiring: Marketing Manager and Software Engineer. Our first marketing campaign won praise.");
    assert.equal(small.spike, false);
    assert.equal(small.firstHires.length, 0);
    assert.equal(small.roles.length, 2);
  });
});

describe("site issues", () => {
  const padding = "<p>" + "content ".repeat(300) + "</p>";

  test("markup problems anyone can see are reported", () => {
    const html = `<html><head><script src="http://cdn.example.com/a.js"></script><script src="/js/jquery-1.11.3.min.js"></script>
      <meta name="generator" content="WordPress 5.2"></head><body>${padding}<footer>© 2019 Acme Ltd</footer></body></html>`;
    const codes = siteIssues(html, NOW).map((i) => i.code).sort();
    assert.deepEqual(codes, ["INSECURE_SCRIPT", "NO_VIEWPORT", "OLD_JQUERY", "OLD_WORDPRESS", "STALE_COPYRIGHT"]);
    produced.add("SITE_TECHNICAL_ISSUE");
  });

  test("a healthy page, or one too short to judge, reports nothing", () => {
    const healthy = `<html><head><meta name="viewport" content="width=device-width"><script src="https://cdn.example.com/a.js"></script></head><body>${padding}<footer>© 2025 Acme</footer></body></html>`;
    assert.deepEqual(siteIssues(healthy, NOW), []);
    assert.deepEqual(siteIssues("<html><body>Checking your browser…</body></html>", NOW), []);
  });
});

describe("Companies House register", () => {
  const everything = registerWantsForTypes(
    INTENT_CATALOGUE.filter((e) => e.sources.some((s) => s.source === "COMPANIES_HOUSE" && s.role === "DETECTED")).map((e) => e.id),
  );

  const signals = registerSignals({
    companyNumber: "12345678",
    profile: {
      date_of_creation: "2021-10-20",
      accounts: { next_due: daysAgo(-20) },
      confirmation_statement: { next_due: daysAgo(-200) },
    },
    officers: [
      { officer_role: "director", appointed_on: "2021-10-20" },
      { officer_role: "director", appointed_on: daysAgo(12), occupation: "Chief Financial Officer" },
      { officer_role: "director", appointed_on: daysAgo(30), occupation: "Company Director" },
      { officer_role: "director", appointed_on: "2022-01-01", resigned_on: daysAgo(20) },
      { officer_role: "secretary", appointed_on: daysAgo(3), occupation: "Chief Executive Officer" },
    ],
    filings: [
      { type: "SH01", date: daysAgo(8), transaction_id: "A1" },
      { type: "AD01", date: daysAgo(20) },
      { type: "MR01", date: daysAgo(15), transaction_id: "M1" },
      { type: "PSC02", date: daysAgo(40) },
      { type: "NM01", date: daysAgo(25) },
      { type: "AA", date: daysAgo(10), description: "accounts-with-accounts-type-small" },
      { type: "AA", date: daysAgo(375), description: "accounts-with-accounts-type-micro-entity" },
    ],
    wants: everything,
    now: NOW,
    freshnessDays: 180,
  });
  signals.forEach((s) => produced.add(s.intentType));
  const byType = new Map(signals.map((s) => [s.intentType, s]));

  test("every register fact the catalogue claims is produced, with a checkable reference", () => {
    for (const type of [
      "CAPITAL_RAISED", "NEW_DIRECTOR", "SENIOR_HIRE_C_LEVEL", "KEY_DEPARTURE", "LEADERSHIP_CHANGE",
      "REGISTERED_OFFICE_CHANGE", "DEBT_FINANCE", "ACQUISITION_MERGER", "REBRAND", "ACCOUNTS_GROWTH",
      "REGULATORY_DEADLINE", "COMPANY_ANNIVERSARY",
    ] as const) {
      const signal = byType.get(type);
      assert.ok(signal, type);
      assert.ok(signal!.reference.startsWith("https://find-and-update.company-information.service.gov.uk/company/12345678"), type);
      assert.ok(signal!.strength > 0 && signal!.strength <= 0.8, type);
    }
    assert.match(byType.get("CAPITAL_RAISED")!.snippet, /SH01/);
    assert.doesNotMatch(byType.get("CAPITAL_RAISED")!.snippet, /series/i);
    assert.equal(byType.get("SENIOR_HIRE_C_LEVEL")!.roleFunction, "FINANCE");
    assert.match(byType.get("ACCOUNTS_GROWTH")!.snippet, /small, previously micro-entity/);
    assert.match(byType.get("REGULATORY_DEADLINE")!.snippet, /^Accounts due on/);
    assert.match(byType.get("COMPANY_ANNIVERSARY")!.snippet, /^5-year anniversary/);
    assert.match(byType.get("ACQUISITION_MERGER")!.snippet, /possible acquisition/);
  });

  test("negative controls: secretaries, generic occupations, founding boards and shrinking accounts", () => {
    // Only one senior hire: the secretary's CEO occupation and "Company Director" do not count.
    assert.equal(signals.filter((s) => s.intentType.startsWith("SENIOR_HIRE_")).length, 1);
    const quiet = registerSignals({
      companyNumber: "1",
      profile: { date_of_creation: "2019-03-01", accounts: { next_due: daysAgo(-200) } },
      officers: [{ officer_role: "director", appointed_on: "2019-03-01", occupation: "Chief Executive Officer" }],
      filings: [
        { type: "AA", date: daysAgo(10), description: "accounts-with-accounts-type-micro-entity" },
        { type: "AA", date: daysAgo(375), description: "accounts-with-accounts-type-small" },
        { type: "SH01", date: daysAgo(400) },
      ],
      wants: everything,
      now: NOW,
      freshnessDays: 180,
    });
    assert.deepEqual(quiet, []);
  });

  test("register evidence never carries an officer's name", () => {
    const named = registerSignals({
      companyNumber: "2",
      profile: null,
      officers: [{ officer_role: "director", appointed_on: daysAgo(3), occupation: "Chief Operating Officer", name: "HARTLEY, Nina" } as never],
      filings: [],
      wants: everything,
      now: NOW,
      freshnessDays: 90,
    });
    assert.ok(named.length >= 1);
    assert.ok(!JSON.stringify(named).includes("HARTLEY"));
  });

  test("accounts tiers and filing categories", () => {
    assert.equal(accountsTier("accounts-with-accounts-type-dormant"), 0);
    assert.equal(accountsTier("accounts-with-accounts-type-total-exemption-full"), 2);
    assert.equal(accountsTier("accounts-with-accounts-type-full"), 4);
    assert.equal(accountsTier("legacy"), null);
    assert.deepEqual(filingCategoriesFor(everything).sort(), [
      "accounts", "address", "capital", "change-of-name", "mortgage", "persons-with-significant-control",
    ]);
  });
});

describe("coverage", () => {
  test("every type with a DETECTED source has a working detector", () => {
    // TECH_IN_USE is the long-standing fingerprint detector (tests/intent-depth.test.ts).
    produced.add("TECH_IN_USE");
    const fresh = registerSignals({
      companyNumber: "3",
      profile: { date_of_creation: daysAgo(20) },
      officers: [],
      filings: [],
      wants: registerWantsForTypes(["NEWLY_INCORPORATED"]),
      now: NOW,
      freshnessDays: 90,
    });
    assert.deepEqual(fresh.map((s) => s.intentType), ["NEWLY_INCORPORATED"]);
    produced.add("NEWLY_INCORPORATED");
    for (const entry of INTENT_CATALOGUE) {
      if (!entry.sources.some((s) => s.role === "DETECTED")) continue;
      assert.ok(produced.has(entry.id), `${entry.id} has a DETECTED source but no detector produced it`);
    }
  });
});
