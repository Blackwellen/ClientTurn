import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  emptyLinkedinFilters,
  inferSeniority,
  linkedinFilterLines,
  linkedinFiltersSchema,
  linkedinFiltersText,
  matchesIngestedLead,
  snapFilterParams,
  type LinkedinFilters,
} from "../src/lib/find-leads/linkedin-filters.ts";
import {
  SALES_NAVIGATOR_PEOPLE_SEARCH,
  buildSalesNavigatorSearchUrl,
} from "../src/lib/find-leads/sales-navigator-url.ts";
import { mapColumns, parseLinkedinExport } from "../src/lib/find-leads/linkedin-import.ts";
import { emptyPlan, parsePlan, planSummaryLines } from "../src/lib/find-leads/plan.ts";

/**
 * Sales Navigator filters, the deep link, and the customer's own export.
 *
 * The rules that matter: an old plan parses to the same search it always was;
 * the link builder never guesses an id it does not hold and says what it left
 * out; an imported file never keeps a phone number; and the plan's title and
 * seniority filters apply to imported rows too.
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

describe("SNAP partner mapping (unverified names, one place)", () => {
  test("empty filters add no parameters", () => {
    assert.deepEqual(snapFilterParams(emptyLinkedinFilters(), "LEAD"), []);
  });

  test("lead-only facets are not sent on an account search", () => {
    const f = filters({ seniorities: ["VP"], headcountBands: ["51-200"], changedJobsPast90Days: true });
    const lead = Object.fromEntries(snapFilterParams(f, "LEAD"));
    const account = Object.fromEntries(snapFilterParams(f, "ACCOUNT"));
    assert.equal(lead["filters.SENIORITY_LEVEL"], "VP");
    assert.equal(lead["filters.RECENTLY_CHANGED_JOBS"], "true");
    assert.equal(account["filters.COMPANY_HEADCOUNT"], "51-200");
    assert.equal(account["filters.SENIORITY_LEVEL"], undefined);
  });
});

describe("Sales Navigator deep link", () => {
  test("no filters opens the plain search page", () => {
    const link = buildSalesNavigatorSearchUrl(emptyLinkedinFilters());
    assert.equal(link.url, SALES_NAVIGATOR_PEOPLE_SEARCH);
    assert.deepEqual(link.applied, []);
  });

  test("known facets are encoded with Sales Navigator's ids", () => {
    const link = buildSalesNavigatorSearchUrl(
      filters({
        seniorities: ["DIRECTOR"],
        headcountBands: ["11-50", "10001+"],
        functions: ["Marketing", "Customer Success and Support"],
        yearsInCurrentPosition: ["LESS_THAN_1"],
        changedJobsPast90Days: true,
      }),
    );
    assert.ok(link.url.startsWith(`${SALES_NAVIGATOR_PEOPLE_SEARCH}?query=(filters:List(`));
    assert.ok(link.url.includes("(type:SENIORITY_LEVEL,values:List((id:220,text:Director,selectionType:INCLUDED)))"));
    assert.ok(link.url.includes("(id:C,text:11-50,selectionType:INCLUDED)"));
    assert.ok(link.url.includes("(id:I,text:10001%2B,selectionType:INCLUDED)"));
    assert.ok(link.url.includes("(id:15,text:Marketing,selectionType:INCLUDED)"));
    assert.ok(link.url.includes("(id:26,text:Customer%20Success%20and%20Support"));
    assert.ok(link.url.includes("(type:YEARS_IN_CURRENT_POSITION,values:List((id:1,"));
    assert.ok(link.url.includes("(type:RECENTLY_CHANGED_JOBS,values:List((id:RPC,"));
  });

  test("text that would break the structure is escaped", () => {
    const link = buildSalesNavigatorSearchUrl(
      filters({ titlesInclude: ["Head (Growth), EMEA"], titlesExclude: ["Intern"], keywords: "a:b" }),
    );
    assert.ok(link.url.includes("text:Head%20%28Growth%29%2C%20EMEA,selectionType:INCLUDED"));
    assert.ok(link.url.includes("(text:Intern,selectionType:EXCLUDED)"));
    assert.ok(link.url.endsWith("keywords:a%3Ab)"));
    // Balanced brackets: nothing in a value closed the structure early.
    const query = link.url.split("?query=")[1];
    assert.equal((query.match(/\(/g) ?? []).length, (query.match(/\)/g) ?? []).length);
  });

  test("filters needing ids we do not hold are left out and named, never guessed", () => {
    const link = buildSalesNavigatorSearchUrl(
      filters({ geography: ["United Kingdom", "Leeds"], industries: ["Software Development"], companyTypes: ["PRIVATELY_HELD"] }),
    );
    assert.ok(link.url.includes("(id:101165590,text:United%20Kingdom"));
    assert.ok(!link.url.includes("Leeds"));
    assert.ok(!link.url.includes("Software"));
    assert.deepEqual(link.notApplied.sort(), ["Company type", "Geography", "Industry"]);
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

describe("importing the customer's own export", () => {
  test("common exporter headers map, and phone columns are named as discarded", () => {
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
      "Ana,Silva,Head of Marketing,Northgate Studio,https://www.northgate.studio/about,https://www.linkedin.com/sales/lead/ACwAA123,+44 7700 900123",
    ].join("\n");
    const result = parseLinkedinExport(csv);
    assert.equal(result.problem, null);
    assert.equal(result.rows.length, 1);
    assert.equal(result.surface, "SALES_NAVIGATOR");
    assert.equal(result.rows[0].companyDomain, "northgate.studio");
    assert.ok(!JSON.stringify(result.rows).includes("7700"));
    assert.deepEqual(result.discardedColumns, ["Phone"]);
  });

  test("a standard-account export is recorded as STANDARD, and a full name is split", () => {
    const csv = "Name,Position,Company,Domain,URL\nSam Lee Jones,Founder,Acme,acme.co.uk,https://www.linkedin.com/in/samlee\n";
    const result = parseLinkedinExport(csv);
    assert.equal(result.surface, "STANDARD");
    assert.equal(result.rows[0].firstName, "Sam");
    assert.equal(result.rows[0].lastName, "Lee Jones");
  });

  test("LinkedIn's own export preamble is skipped to the real header", () => {
    const csv = "Notes:\n\"When exporting your connection data...\"\n\nFirst Name,Last Name,URL,Email Address,Company,Company Website,Position\nJo,Bloggs,https://www.linkedin.com/in/jo,jo@acme.co.uk,Acme,acme.co.uk,CTO\n";
    const result = parseLinkedinExport(csv);
    assert.equal(result.problem, null);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].email, "jo@acme.co.uk");
  });

  test("every row is validated: bad rows are reported, good rows kept", () => {
    const csv = [
      "First Name,Last Name,Company,Website,LinkedIn URL,Email",
      "Ana,Silva,Acme,acme.co.uk,https://www.linkedin.com/in/ana,",
      ",,Acme,acme.co.uk,,",
      "Bo,Ng,Beta,,,",
      "Cy,Ro,Gamma,gamma.io,https://example.com/cy,",
      "Di,Po,Delta,delta.io,,not-an-email",
    ].join("\n");
    const result = parseLinkedinExport(csv);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(
      result.errors.map((e) => [e.row, e.message]),
      [
        [3, "No name"],
        [4, "No company website or domain"],
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
