import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import {
  LINKEDIN_PEOPLE_SEARCH,
  emptyLinkedinFilters,
  inferSeniority,
  linkedinFilterLines,
  linkedinFiltersSchema,
  linkedinFiltersText,
  linkedinSearchKeywords,
  linkedinSearchUrl,
  matchesIngestedLead,
  type LinkedinFilters,
} from "../src/lib/find-leads/linkedin-filters.ts";
import {
  importSubscriberType,
  mapColumns,
  parseLinkedinExport,
  personCompanyKey,
  profileKey,
  resolveImportDomain,
  workEmailDomain,
} from "../src/lib/find-leads/linkedin-import.ts";
import { lawfulBasisFor } from "../src/lib/find-leads/contact-legality.ts";
import { emptyPlan, parsePlan, planSummaryLines } from "../src/lib/find-leads/plan.ts";

/**
 * LinkedIn filters, the "Search LinkedIn" link, and the customer's own list.
 *
 * The rules that matter: an old plan parses to the same search it always was;
 * nothing relies on an undocumented LinkedIn URL or API; an imported file never
 * keeps a phone number; a list without a website column still becomes
 * prospects, with the domain resolved in a fixed order that never trusts a
 * freemail domain; and re-imports are idempotent.
 */

function filters(patch: Partial<LinkedinFilters>): LinkedinFilters {
  return linkedinFiltersSchema.parse(patch);
}

describe("linkedin filters in the plan", () => {
  test("a plan written before the block existed parses unchanged, with empty filters", () => {
    const plan = parsePlan({ industries: ["Web design"] });
    assert.ok(plan);
    assert.deepEqual(plan!.linkedin, emptyLinkedinFilters());
    assert.equal(linkedinFilterLines(plan!.linkedin).length, 0);
    assert.ok(!planSummaryLines(plan!).some((line) => line.label === "LinkedIn filters"));
  });

  test("the default conversion goal is a meeting, not a site visit", () => {
    assert.equal(emptyPlan().conversionGoal, "BOOK_APPOINTMENT");
  });

  test("values outside LinkedIn's vocabularies are refused", () => {
    assert.equal(linkedinFiltersSchema.safeParse({ seniorities: ["BOSS"] }).success, false);
    assert.equal(linkedinFiltersSchema.safeParse({ headcountBands: ["12-40"] }).success, false);
    assert.equal(linkedinFiltersSchema.safeParse({ functions: ["Wizardry"] }).success, false);
  });

  test("the copyable text names every filter that is set", () => {
    const text = linkedinFiltersText(
      filters({
        geography: ["London"],
        seniorities: ["DIRECTOR", "CXO"],
        functions: ["Marketing"],
        titlesInclude: ["Head of Marketing"],
        titlesExclude: ["Assistant"],
        headcountBands: ["11-50"],
        headcountGrowth: { minPct: 10, maxPct: null },
        changedJobsPast90Days: true,
        postedOnLinkedinPast30Days: true,
        keywords: "Shopify",
      }),
    );
    for (const expected of [
      "Geography: London",
      "Seniority level: Director, CXO",
      "Function: Marketing",
      "Current job title: Head of Marketing",
      "Exclude job title: Assistant",
      "Company headcount: 11-50",
      "Company headcount growth: 10% or more",
      "Changed jobs: In the past 90 days",
      "Posted on LinkedIn: In the past 30 days",
      "Keywords: Shopify",
    ]) {
      assert.ok(text.includes(expected), expected);
    }
  });
});

describe("no guesswork about LinkedIn", () => {
  test("the only link is LinkedIn's standard people search, with keywords only", () => {
    assert.equal(linkedinSearchUrl(""), LINKEDIN_PEOPLE_SEARCH);
    const keywords = linkedinSearchKeywords({ titles: ["Head of Marketing"], industries: ["Web design"], keywords: "" });
    assert.equal(keywords, "Head of Marketing Web design");
    assert.equal(
      linkedinSearchUrl(keywords),
      "https://www.linkedin.com/search/results/people/?keywords=Head%20of%20Marketing%20Web%20design",
    );
  });

  test("the partner-API mapping and the Sales Navigator URL builder are gone", () => {
    assert.equal(existsSync(new URL("../src/lib/find-leads/sales-navigator-url.ts", import.meta.url)), false);
    const provider = readFileSync(new URL("../src/lib/find-leads/server/providers/linkedin-sales-navigator.ts", import.meta.url), "utf8");
    assert.doesNotMatch(provider, /salesApi|snapToken|api\.linkedin\.com/);
    assert.doesNotMatch(provider, /COMPANY_SEARCH/);
    const env = readFileSync(new URL("../src/lib/env.ts", import.meta.url), "utf8");
    assert.doesNotMatch(env, /LINKEDIN_SNAP_ACCESS_TOKEN|LINKEDIN_COMMUNITY_MANAGEMENT_APPROVED/);
  });

  test("the LinkedIn engagement prospect source is removed", () => {
    assert.equal(existsSync(new URL("../src/lib/find-leads/server/providers/linkedin-engagement.ts", import.meta.url)), false);
    const registry = readFileSync(new URL("../src/lib/find-leads/server/providers/registry.ts", import.meta.url), "utf8");
    assert.doesNotMatch(registry, /linkedin-engagement|linkedinEngagementProvider/);
    assert.equal(lawfulBasisFor("linkedin_engagement"), "UNKNOWN");
  });

  test("an imported list is the customer's own data, not licensed data", () => {
    assert.equal(lawfulBasisFor("linkedin_sales_navigator"), "CUSTOMER_ASSERTED");
    assert.equal(lawfulBasisFor("linkedin_list_import"), "CUSTOMER_ASSERTED");
  });
});

describe("filtering imported rows", () => {
  test("seniority is read from the title, conservatively", () => {
    assert.equal(inferSeniority("Co-founder & CEO"), "OWNER_PARTNER");
    assert.equal(inferSeniority("Chief Marketing Officer"), "CXO");
    assert.equal(inferSeniority("VP Sales"), "VP");
    assert.equal(inferSeniority("Head of Growth"), "DIRECTOR");
    assert.equal(inferSeniority("Marketing Manager"), "ENTRY_LEVEL_MANAGER");
    assert.equal(inferSeniority("Senior Developer"), "SENIOR");
    assert.equal(inferSeniority("Designer"), null);
  });

  test("include, exclude and seniority all apply", () => {
    const f = filters({ titlesInclude: ["marketing"], titlesExclude: ["assistant"], seniorities: ["DIRECTOR", "CXO"] });
    assert.equal(matchesIngestedLead({ roleTitle: "Head of Marketing" }, f), true);
    assert.equal(matchesIngestedLead({ roleTitle: "Marketing Assistant" }, f), false);
    assert.equal(matchesIngestedLead({ roleTitle: "Head of Sales" }, f), false);
    assert.equal(matchesIngestedLead({ roleTitle: "Marketing Manager" }, f), false);
  });

  test("an unreadable title passes the seniority filter: the customer chose this person", () => {
    const f = filters({ seniorities: ["DIRECTOR"] });
    assert.equal(matchesIngestedLead({ roleTitle: "Brand Storyteller" }, f), true);
    assert.equal(matchesIngestedLead({ roleTitle: null }, emptyLinkedinFilters()), true);
  });
});

describe("importing the customer's own list", () => {
  test("common headers map, and phone columns are named as discarded", () => {
    const { mapping, discarded } = mapColumns([
      "First Name", "Last Name", "Job Title", "Company Name", "Company Website", "LinkedIn URL", "Location", "Email", "Phone Number", "Mobile",
    ]);
    assert.deepEqual(mapping, {
      firstName: 0, lastName: 1, roleTitle: 2, companyName: 3, companyDomain: 4, linkedinUrl: 5, location: 6, email: 7,
    });
    assert.deepEqual(discarded, ["Phone Number", "Mobile"]);
  });

  test("a phone number never appears in a parsed row", () => {
    const csv = [
      "First Name,Last Name,Title,Company,Website,Profile URL,Phone",
      "Ana,Silva,Head of Marketing,Northgate Studio,https://www.northgate.studio/about,https://www.linkedin.com/in/ana-silva,+44 7700 900123",
    ].join("\n");
    const result = parseLinkedinExport(csv);
    assert.equal(result.problem, null);
    assert.equal(result.rows.length, 1);
    assert.equal(result.surface, "CUSTOMER_LIST");
    assert.equal(result.rows[0].companyDomain, "northgate.studio");
    assert.ok(!JSON.stringify(result.rows).includes("7700"));
    assert.deepEqual(result.discardedColumns, ["Phone"]);
  });

  test("LinkedIn's own Connections export is recognised, preamble skipped, no website needed", () => {
    const csv = "Notes:\n\"When exporting your connection data...\"\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nJo,Bloggs,https://www.linkedin.com/in/jo,jo@acme.co.uk,Acme,CTO,01 Sep 2026\nSam,Lee,https://www.linkedin.com/in/samlee,,Beta Studio,Founder,02 Sep 2026\n";
    const result = parseLinkedinExport(csv);
    assert.equal(result.problem, null);
    assert.equal(result.surface, "LINKEDIN_CONNECTIONS");
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[1].companyDomain, null);
  });

  test("a full name is split", () => {
    const result = parseLinkedinExport("Name,Position,Company\nSam Lee Jones,Founder,Acme\n");
    assert.equal(result.rows[0].firstName, "Sam");
    assert.equal(result.rows[0].lastName, "Lee Jones");
  });

  test("every row is validated: bad rows are reported, good rows kept", () => {
    const csv = [
      "First Name,Last Name,Company,Website,LinkedIn URL,Email",
      "Ana,Silva,Acme,acme.co.uk,https://www.linkedin.com/in/ana,",
      ",,Acme,acme.co.uk,,",
      "Bo,Ng,,,,",
      "Cy,Ro,Gamma,gamma.io,https://example.com/cy,",
      "Di,Po,Delta,delta.io,,not-an-email",
      "Ed,Wu,Echo,,,",
    ].join("\n");
    const result = parseLinkedinExport(csv);
    assert.equal(result.rows.length, 2);
    assert.deepEqual(
      result.errors.map((e) => [e.row, e.message]),
      [
        [3, "No name"],
        [4, "No company"],
        [5, "Not a LinkedIn profile URL"],
        [6, "Not an email address"],
      ],
    );
  });

  test("a file with no name or company columns is refused as a whole", () => {
    const result = parseLinkedinExport("foo,bar\n1,2\n");
    assert.ok(result.problem);
    assert.equal(result.rows.length, 0);
  });
});

describe("resolving the company's domain", () => {
  test("order: website column, then work email, then unresolved", () => {
    assert.deepEqual(resolveImportDomain({ companyDomain: "acme.co.uk", email: "jo@other.io" }), {
      domain: "acme.co.uk",
      resolution: "WEBSITE_COLUMN",
    });
    assert.deepEqual(resolveImportDomain({ companyDomain: null, email: "jo@beta.studio" }), {
      domain: "beta.studio",
      resolution: "WORK_EMAIL",
    });
    assert.deepEqual(resolveImportDomain({ companyDomain: null, email: null }), {
      domain: null,
      resolution: "UNRESOLVED",
    });
  });

  test("a freemail domain is never taken as the company's", () => {
    assert.equal(workEmailDomain("jo.bloggs@gmail.com"), null);
    assert.equal(workEmailDomain("jo@hotmail.co.uk"), null);
    assert.deepEqual(resolveImportDomain({ companyDomain: null, email: "jo@outlook.com" }), {
      domain: null,
      resolution: "UNRESOLVED",
    });
    // A freemail domain typed in a website column is dropped too.
    const result = parseLinkedinExport("First Name,Last Name,Company,Website\nJo,Bloggs,Acme,gmail.com\n");
    assert.equal(result.rows[0].companyDomain, null);
  });

  test("a row with no domain at all is still a valid prospect row", () => {
    const result = parseLinkedinExport("First Name,Last Name,Company\nJo,Bloggs,Acme Studio\n");
    assert.equal(result.errors.length, 0);
    assert.equal(result.rows.length, 1);
    assert.equal(resolveImportDomain(result.rows[0]).resolution, "UNRESOLVED");
  });
});

describe("re-imports stay idempotent", () => {
  test("the profile URL is the first key, normalised", () => {
    assert.equal(profileKey("https://www.linkedin.com/in/Jo-Bloggs/?trk=abc"), "in/jo-bloggs");
    assert.equal(profileKey("http://uk.linkedin.com/in/jo-bloggs"), "in/jo-bloggs");
    assert.equal(profileKey("https://example.com/in/jo"), null);
    assert.equal(profileKey(null), null);
  });

  test("name + company is the fallback key, by domain when known", () => {
    const a = personCompanyKey({ firstName: "Jo", lastName: "Bloggs", companyDomain: null, companyName: "Acme Ltd" });
    const b = personCompanyKey({ firstName: "jo", lastName: "BLOGGS", companyDomain: null, companyName: "Acme Limited" });
    assert.ok(a);
    assert.equal(a, b);
    assert.notEqual(a, personCompanyKey({ firstName: "Jo", lastName: "Bloggs", companyDomain: "acme.co.uk", companyName: "Acme" }));
    assert.equal(personCompanyKey({ firstName: null, lastName: null, companyDomain: "a.io", companyName: null }), null);
  });
});

describe("subscriber type of an imported prospect", () => {
  test("the strictest wins, and no email is UNKNOWN", () => {
    assert.equal(importSubscriberType("INDIVIDUAL", "CORPORATE"), "INDIVIDUAL");
    assert.equal(importSubscriberType("CORPORATE", "PARTNERSHIP"), "PARTNERSHIP");
    assert.equal(importSubscriberType("CORPORATE", "CORPORATE"), "CORPORATE");
    assert.equal(importSubscriberType("UNKNOWN", "CORPORATE"), "UNKNOWN");
    assert.equal(importSubscriberType("CORPORATE", null), "CORPORATE");
  });
});
