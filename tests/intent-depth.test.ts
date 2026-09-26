import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  EVIDENCE_KIND_LABELS,
  INTENT_EVIDENCE_KINDS,
  MAX_SNIPPET,
  evidenceSummary,
  kindsForCategory,
  recencyStrength,
  truncateSnippet,
} from "../src/lib/find-leads/intent-evidence.ts";
import {
  detectTechnologies,
  hiringRoleMatches,
  isPathAllowed,
  keywordMatches,
  parseRobots,
  parseSitemap,
  publishedDate,
  recentSitemapEntries,
} from "../src/lib/find-leads/website-signals.ts";
import { registerSignals } from "../src/lib/find-leads/companies-house-signals.ts";
import {
  EVIDENCE_KIND_FEED,
  NO_LAWFUL_SOURCE,
  SIGNAL_FEED_PROVIDERS,
  SIGNAL_KINDS,
  SIGNAL_KIND_FEEDS,
  intentWantsFor,
  liveFeeds,
  requestedEvidenceKinds,
  signalAvailability,
  signalKindForPlan,
} from "../src/lib/find-leads/signals.ts";
import { checkPlanReadiness, parsePlan, planWantsIntent, type SearchPlan } from "../src/lib/find-leads/plan.ts";

/**
 * Intent depth from free, first-party sources: the company's own website and
 * the Companies House register.
 *
 * What must stay true: every signal kind maps to a real, free source or says
 * plainly that none exists; nothing depends on a paid vendor; recency and
 * volume raise strength without breaking the cap; the register evidence never
 * carries a person's name; and every result carries evidence a customer can
 * check.
 */

const NOW = new Date("2026-09-26T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function plan(patch: Record<string, unknown>): SearchPlan {
  return parsePlan(patch) as SearchPlan;
}

describe("signal kinds map to real, free sources", () => {
  test("every kind either has a feed or says no lawful source exists", () => {
    for (const kind of SIGNAL_KINDS) {
      const feeds = SIGNAL_KIND_FEEDS[kind];
      const verdict = signalAvailability(kind, new Set());
      if (feeds.length === 0) assert.equal(verdict.needs, NO_LAWFUL_SOURCE, kind);
      else assert.ok(verdict.needs && verdict.needs !== NO_LAWFUL_SOURCE, kind);
    }
  });

  test("FUNDING, HIRING and JOB_CHANGE run on free sources, not a paid vendor", () => {
    assert.deepEqual(SIGNAL_KIND_FEEDS.FUNDING, ["COMPANIES_HOUSE"]);
    assert.deepEqual(SIGNAL_KIND_FEEDS.JOB_CHANGE, ["COMPANIES_HOUSE"]);
    assert.deepEqual(SIGNAL_KIND_FEEDS.HIRING, ["COMPANY_WEBSITE"]);
    const providers = Object.values(SIGNAL_FEED_PROVIDERS).flat();
    for (const paid of ["apollo", "hunter", "clearbit"]) assert.ok(!providers.includes(paid), paid);
  });

  test("every feed's provider key is a real adapter in the registry", () => {
    const registry = readFileSync(new URL("../src/lib/find-leads/server/providers/registry.ts", import.meta.url), "utf8");
    const dir = new URL("../src/lib/find-leads/server/providers/", import.meta.url);
    const keys = new Set<string>();
    for (const file of registry.matchAll(/from "\.\/([a-z-]+)"/g)) {
      const source = readFileSync(new URL(`${file[1]}.ts`, dir), "utf8");
      for (const match of source.matchAll(/key: "([a-z_]+)"/g)) keys.add(match[1]);
    }
    for (const key of Object.values(SIGNAL_FEED_PROVIDERS).flat()) assert.ok(keys.has(key), key);
  });

  test("without a Companies House key, register kinds say what to connect", () => {
    const live = liveFeeds(["website_signals", "google_places"]);
    assert.equal(signalAvailability("HIRING", live).available, true);
    const funding = signalAvailability("FUNDING", live);
    assert.equal(funding.available, false);
    assert.match(funding.needs!, /Companies House API key/);
    assert.match(funding.needs!, /developer\.company-information\.service\.gov\.uk/);
    assert.equal(signalAvailability("FUNDING", liveFeeds(["companies_house"])).available, true);
    assert.equal(signalAvailability("COMPETITOR", live).available, false);
  });

  test("each evidence kind has a label and a feed", () => {
    for (const kind of INTENT_EVIDENCE_KINDS) {
      assert.ok(EVIDENCE_KIND_LABELS[kind]);
      assert.ok(EVIDENCE_KIND_FEED[kind]);
    }
  });

  test("the plan's structured signals drive its kind and what the intent stage fetches", () => {
    assert.equal(signalKindForPlan(plan({})), "ICP_TOP");
    assert.equal(signalKindForPlan(plan({ intent: { categories: ["Rebrand"] } })), "KEYWORD");
    assert.equal(signalKindForPlan(plan({ signals: { fundingFilings: true } })), "FUNDING");
    assert.equal(signalKindForPlan(plan({ signals: { hiringRoles: ["Designer"] } })), "HIRING");
    assert.equal(signalKindForPlan(plan({ signals: { leadershipChanges: true } })), "JOB_CHANGE");
    assert.deepEqual(
      requestedEvidenceKinds(plan({ signals: { officeMoves: true, technologies: ["SHOPIFY"] } })),
      ["EXPANSION", "TECHNOLOGY"],
    );
    assert.equal(planWantsIntent(plan({})), false);
    assert.equal(planWantsIntent(plan({ signals: { recentlyIncorporated: true } })), true);
  });

  test("intent required is satisfied by structured signals alone", () => {
    const p = plan({ intent: { required: true }, signals: { fundingFilings: true } });
    assert.ok(!checkPlanReadiness(p).problems.includes("INTENT_REQUIRED_WITHOUT_CATEGORIES"));
  });

  test("named categories collect the structured kinds they describe", () => {
    assert.ok(kindsForCategory({ name: "New funding", keywords: [] }).includes("FUNDING"));
    assert.ok(kindsForCategory({ name: "Hiring for a related role", keywords: [], signalTypes: ["JOB_POSTING"] }).includes("HIRING"));
    assert.ok(kindsForCategory({ name: "Leadership change", keywords: [] }).includes("JOB_CHANGE"));
    assert.deepEqual(kindsForCategory({ name: "Rebrand", keywords: ["new logo"] }), ["WEBSITE_MENTION"]);

    const wants = intentWantsFor(plan({}), [
      { name: "Hiring for a related role", keywords: ["Head of Marketing"], signalTypes: ["JOB_POSTING"] },
      { name: "Runs a store", keywords: ["Shopify"] },
    ]);
    assert.deepEqual(wants.kinds, ["HIRING", "TECHNOLOGY"]);
    assert.deepEqual(wants.hiringRoles, ["Head of Marketing"]);
    assert.deepEqual(wants.technologies, ["SHOPIFY"]);
  });
});

describe("recency weighting", () => {
  test("fresher content counts for more, outside the window for nothing", () => {
    const at = (days: number) =>
      recencyStrength({ hits: 1, datedAt: daysAgo(days), now: NOW, freshnessDays: 90, max: 0.6 });
    assert.ok(at(1) > at(45));
    assert.ok(at(45) > at(89));
    assert.equal(at(120), 0);
  });

  test("undated content is scored mid-window, never as today", () => {
    const undated = recencyStrength({ hits: 1, datedAt: null, now: NOW, freshnessDays: 90, max: 0.6 });
    const today = recencyStrength({ hits: 1, datedAt: NOW.toISOString(), now: NOW, freshnessDays: 90, max: 0.6 });
    assert.ok(undated < today);
    assert.ok(undated > 0);
  });

  test("more distinct hits raise strength with diminishing returns, and the cap holds", () => {
    const s = (hits: number) => recencyStrength({ hits, datedAt: NOW.toISOString(), now: NOW, freshnessDays: 30, max: 0.6 });
    assert.equal(s(0), 0);
    assert.ok(s(2) > s(1));
    assert.ok(s(2) - s(1) > s(3) - s(2));
    assert.ok(s(50) <= 0.6);
  });
});

describe("evidence", () => {
  test("snippets are truncated on a word boundary", () => {
    const long = "word ".repeat(100);
    const cut = truncateSnippet(long);
    assert.ok(cut.length <= MAX_SNIPPET);
    assert.ok(cut.endsWith("…"));
  });

  test("the summary names the kind, the source and the matched text", () => {
    const summary = evidenceSummary({
      kind: "FUNDING",
      source: "Companies House",
      reference: "https://example/ref",
      observedAt: NOW.toISOString(),
      snippet: "Share allotment (SH01) dated 12 Aug 2026",
    });
    assert.equal(summary, 'Raised new capital (Companies House): "Share allotment (SH01) dated 12 Aug 2026"');
  });
});

describe("website signals", () => {
  test("robots.txt is obeyed, longest rule wins, and sitemaps are read from it", () => {
    const rules = parseRobots(
      "User-agent: *\nDisallow: /private\nAllow: /private/press\nSitemap: https://acme.co.uk/sitemap_index.xml\n\nUser-agent: OtherBot\nDisallow: /",
    );
    assert.equal(isPathAllowed(rules, "/careers"), true);
    assert.equal(isPathAllowed(rules, "/private/x"), false);
    assert.equal(isPathAllowed(rules, "/private/press/2026"), true);
    assert.deepEqual(rules.sitemaps, ["https://acme.co.uk/sitemap_index.xml"]);
    assert.equal(isPathAllowed(parseRobots("User-agent: ClientTurnBot\nDisallow: /"), "/"), false);
    assert.equal(isPathAllowed(parseRobots(""), "/anything"), true);
  });

  test("only recent news, press, blog and job posts on the company's own host are read", () => {
    const { entries, index } = parseSitemap(`<?xml version="1.0"?><urlset>
      <url><loc>https://acme.co.uk/news/new-office</loc><lastmod>${daysAgo(5)}</lastmod></url>
      <url><loc>https://acme.co.uk/blog/old-post</loc><lastmod>${daysAgo(400)}</lastmod></url>
      <url><loc>https://acme.co.uk/careers/designer</loc><lastmod>${daysAgo(10)}</lastmod></url>
      <url><loc>https://acme.co.uk/services/seo</loc><lastmod>${daysAgo(1)}</lastmod></url>
      <url><loc>https://other.com/news/x</loc><lastmod>${daysAgo(1)}</lastmod></url>
      <url><loc>https://acme.co.uk/news/undated</loc></url>
    </urlset>`);
    assert.equal(index, false);
    const recent = recentSitemapEntries({ entries, domain: "acme.co.uk", now: NOW, freshnessDays: 90, limit: 5 });
    assert.deepEqual(recent.map((e) => e.loc), ["https://acme.co.uk/news/new-office", "https://acme.co.uk/careers/designer"]);
  });

  test("a sitemap index is recognised", () => {
    const parsed = parseSitemap("<sitemapindex><sitemap><loc>https://a.co/post-sitemap.xml</loc></sitemap></sitemapindex>");
    assert.equal(parsed.index, true);
    assert.equal(parsed.entries[0].loc, "https://a.co/post-sitemap.xml");
  });

  test("a page's own publication date is read; future dates are ignored", () => {
    const html = `<meta property="article:published_time" content="${daysAgo(3)}"><time datetime="2099-01-01">soon</time>`;
    assert.equal(publishedDate(html, NOW), daysAgo(3));
    assert.equal(publishedDate("<p>no date</p>", NOW), null);
  });

  test("hiring is detected only for the asked roles, and only on a hiring page", () => {
    const careers = "Join our team! Open roles: Senior Designer, Head of Marketing (London). Apply now.";
    assert.deepEqual(
      hiringRoleMatches(careers, ["Head of Marketing", "CFO"]).map((m) => m.role),
      ["Head of Marketing"],
    );
    assert.deepEqual(hiringRoleMatches("Meet Sam, our Head of Marketing.", ["Head of Marketing"]), []);
  });

  test("keyword matches carry a snippet", () => {
    const [match] = keywordMatches("We are planning a complete rebrand this autumn.", [{ name: "Rebrand", keywords: [] }]);
    assert.equal(match.category, "Rebrand");
    assert.ok(match.snippet.toLowerCase().includes("rebrand"));
  });

  test("technology is fingerprinted from the markup the site serves", () => {
    const html = `<script src="https://cdn.shopify.com/s/files/x.js"></script>
      <script src="//js.hs-scripts.com/123.js"></script><link href="/wp-content/themes/a.css">`;
    const keys = detectTechnologies(html).map((t) => t.key).sort();
    assert.deepEqual(keys, ["HUBSPOT", "SHOPIFY", "WORDPRESS"]);
    // A blog post that merely mentions a product is not evidence of use.
    assert.deepEqual(detectTechnologies("<p>Why we moved off Shopify and Intercom</p>"), []);
  });
});

describe("Companies House signals", () => {
  const all = { funding: true, leadership: true, incorporation: true, officeMove: true };

  test("allotments, appointments, incorporation and office moves in the window become evidence", () => {
    const signals = registerSignals({
      companyNumber: "12345678",
      profile: { date_of_creation: daysAgo(30) },
      officers: [
        { officer_role: "director", appointed_on: daysAgo(30) },
        { officer_role: "director", appointed_on: daysAgo(12) },
        { officer_role: "secretary", appointed_on: daysAgo(5) },
        { officer_role: "director", appointed_on: daysAgo(10), resigned_on: daysAgo(2) },
        { officer_role: "director", appointed_on: daysAgo(500) },
      ],
      filings: [
        { type: "SH01", date: daysAgo(8), transaction_id: "MzA" },
        { type: "AD01", date: daysAgo(20) },
        { type: "SH01", date: daysAgo(400) },
        { type: "AA", date: daysAgo(3) },
      ],
      wants: all,
      now: NOW,
      freshnessDays: 90,
    });

    const kinds = signals.map((s) => s.kind).sort();
    assert.deepEqual(kinds, ["EXPANSION", "FUNDING", "JOB_CHANGE", "NEW_COMPANY"]);

    const funding = signals.find((s) => s.kind === "FUNDING")!;
    assert.match(funding.snippet, /SH01/);
    assert.ok(funding.reference.endsWith("/company/12345678/filing-history#MzA"));

    // Founding directors and secretaries are not a leadership change; the
    // resigned one is gone.
    const leadership = signals.find((s) => s.kind === "JOB_CHANGE")!;
    assert.match(leadership.snippet, /^Director appointed on/);
    assert.ok(!/and \d other/.test(leadership.snippet));
    assert.ok(leadership.reference.endsWith("/officers"));

    for (const signal of signals) {
      assert.ok(signal.strength > 0 && signal.strength <= 0.8, signal.kind);
    }
    assert.ok(signals.find((s) => s.kind === "EXPANSION")!.strength <= 0.5);
  });

  test("register evidence never carries an officer's name", () => {
    const signals = registerSignals({
      companyNumber: "OC123456",
      profile: null,
      officers: [{ officer_role: "llp-designated-member", appointed_on: daysAgo(3), name: "HARTLEY, Nina" } as never],
      filings: [],
      wants: all,
      now: NOW,
      freshnessDays: 30,
    });
    assert.equal(signals.length, 1);
    assert.ok(!JSON.stringify(signals).includes("HARTLEY"));
  });

  test("only what was asked for is produced", () => {
    const signals = registerSignals({
      companyNumber: "1",
      profile: { date_of_creation: daysAgo(3) },
      officers: [],
      filings: [{ type: "SH01", date: daysAgo(3) }],
      wants: { funding: false, leadership: false, incorporation: true, officeMove: false },
      now: NOW,
      freshnessDays: 30,
    });
    assert.deepEqual(signals.map((s) => s.kind), ["NEW_COMPANY"]);
  });
});
