import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  escapeIlike,
  ilikeContains,
  ilikeOrTerm,
  orIlike,
} from "../src/lib/supabase/ilike.ts";
import {
  addRecentSearch,
  agentHref,
  allGroupsFailed,
  bookingHref,
  buildSearchGroups,
  campaignHref,
  conversationHref,
  emptySearchResult,
  filterNavIndex,
  flattenSearchOptions,
  helpArticleHref,
  leadHref,
  NAV_INDEX,
  parseRecentSearches,
  prospectHref,
  RECENT_SEARCHES_CAP,
  SEARCH_CATEGORY_KEYS,
  seeAllHref,
  type GlobalSearchResult,
  type SearchResultItem,
} from "../src/lib/search/types.ts";
import { leadPageHref } from "../src/lib/leads/detail-page.ts";
import { SETTINGS_SECTIONS } from "../src/lib/settings/types.ts";

const ALL = { sourcing: true, analytics: true };
const NONE = { sourcing: false, analytics: false };

/** Splits an `.or()` string the way PostgREST does: commas inside quotes are text. */
function splitOr(filter: string): string[] {
  return filter.match(/(?:[^,"]|"(?:\\.|[^"\\])*")+/g) ?? [];
}

/** Undoes the PostgREST double-quote escaping, leaving the LIKE pattern. */
function unquote(value: string): string {
  assert.ok(value.startsWith('"') && value.endsWith('"'), `${value} is not quoted`);
  return value.slice(1, -1).replace(/\\(.)/g, "$1");
}

/* ---------------------------------------------------------------- escaping */

describe("ilike escaping", () => {
  test("escapeIlike escapes %, _ and backslash", () => {
    assert.equal(escapeIlike("50%_off\\x"), "50\\%\\_off\\\\x");
    assert.equal(escapeIlike("plain"), "plain");
  });

  test("ilikeContains wraps, trims, and neutralises PostgREST's * wildcard", () => {
    assert.equal(ilikeContains("  al%ice "), "%al\\%ice%");
    assert.equal(ilikeContains("a_b"), "%a\\_b%");
    // PostgREST rewrites * to %, so a literal * becomes a one-character wildcard.
    assert.equal(ilikeContains("a*b"), "%a_b%");
    assert.equal(ilikeContains("   "), null);
    assert.equal(ilikeContains(""), null);
  });

  test("ilikeOrTerm quotes the value so reserved characters stay text", () => {
    assert.equal(ilikeOrTerm("Smith, (Ltd)"), '"%Smith, (Ltd)%"');
    assert.equal(ilikeOrTerm("a.b:c"), '"%a.b:c%"');
    assert.equal(ilikeOrTerm(""), null);
  });

  test("ilikeOrTerm escapes quotes and backslashes inside the quoted value", () => {
    const term = ilikeOrTerm('say "hi" \\ 100%')!;
    // What Postgres receives after PostgREST un-escapes the quoted value:
    assert.equal(unquote(term), '%say "hi" \\\\ 100\\%%');
  });

  test("a term cannot inject extra predicates into an or() filter", () => {
    const or = orIlike(["first_name", "email"], "acme,status.eq.APPROVED)")!;
    const clauses = splitOr(or);
    assert.equal(clauses.length, 2);
    for (const clause of clauses) {
      assert.match(clause, /^(first_name|email)\.ilike\."/);
    }
    assert.equal(unquote(clauses[0].slice("first_name.ilike.".length)), "%acme,status.eq.APPROVED)%");
  });

  test("orIlike is null for an empty term or no columns", () => {
    assert.equal(orIlike(["a"], "  "), null);
    assert.equal(orIlike([], "x"), null);
  });

  test("wildcards typed by a person match literally, not as patterns", () => {
    const pattern = unquote(ilikeOrTerm("_%\\")!);
    assert.equal(pattern, "%\\_\\%\\\\%");
  });
});

/* ------------------------------------------------------------------- links */

describe("result links", () => {
  const id = "3f2a1c4e-8b9d-4e2f-a1b3-c4d5e6f70812";

  test("a lead opens the full lead page", () => {
    assert.equal(leadHref(id), `/app/leads/${id}`);
    assert.equal(leadHref(id), leadPageHref(id));
  });

  test("a booking opens the lead drawer's Summary tab, never a non-existent booking tab", () => {
    const href = bookingHref(id);
    assert.equal(href, `/app/leads?lead=${id}&leadTab=summary`);
    assert.doesNotMatch(href, /leadTab=booking/);
  });

  test("each entity type links to its own page", () => {
    assert.equal(prospectHref(id), `/app/find-leads?view=prospects&prospect=${id}`);
    assert.equal(agentHref(id), `/app/agents/${id}`);
    assert.equal(conversationHref(id), `/app/inbox?thread=${id}`);
    assert.equal(conversationHref(id, true), `/app/inbox?archive=1&thread=${id}`);
    assert.equal(campaignHref(id), `/app/reactivation?campaign=${id}`);
    assert.equal(helpArticleHref("connect-meta"), "/app/help?article=connect-meta");
  });

  test("ids are URL-encoded", () => {
    assert.equal(agentHref("a/b?c"), "/app/agents/a%2Fb%3Fc");
  });
});

/* ------------------------------------------------------------------ see all */

describe("see all", () => {
  test("list pages that read ?q= get the query", () => {
    assert.equal(seeAllHref("leads", " acme & co "), "/app/leads?q=acme+%26+co");
    assert.equal(seeAllHref("bookings", "acme"), "/app/leads?quick=booked&q=acme");
    assert.equal(seeAllHref("prospects", "acme"), "/app/find-leads?view=prospects&q=acme");
    assert.equal(seeAllHref("conversations", "acme"), "/app/inbox?q=acme");
    assert.equal(seeAllHref("campaigns", "acme"), "/app/reactivation?q=acme");
    assert.equal(seeAllHref("help", "acme"), "/app/help?q=acme");
  });

  test("agents has no search param; pages have no list", () => {
    assert.equal(seeAllHref("agents", "acme"), "/app/agents");
    assert.equal(seeAllHref("pages", "acme"), null);
  });
});

/* ------------------------------------------------------------ static index */

describe("static page index", () => {
  test("covers every sidebar destination and every settings section", () => {
    const hrefs = NAV_INDEX.map((entry) => entry.href);
    for (const href of [
      "/app",
      "/app/agents",
      "/app/inbox",
      "/app/leads",
      "/app/find-leads",
      "/app/follow-up",
      "/app/reactivation",
      "/app/analytics",
      "/app/settings",
      "/app/help",
    ]) {
      assert.ok(hrefs.includes(href), `${href} missing from the index`);
    }
    for (const section of SETTINGS_SECTIONS) {
      assert.ok(hrefs.includes(`/app/settings?section=${section.id}`), `${section.id} missing`);
    }
    assert.equal(new Set(NAV_INDEX.map((entry) => entry.id)).size, NAV_INDEX.length);
  });

  test("keywords find a page, and title-prefix matches rank first", () => {
    const billing = filterNavIndex("invoices", ALL);
    assert.equal(billing.items[0]?.href, "/app/settings?section=billing");

    const settings = filterNavIndex("sett", ALL);
    assert.equal(settings.items[0]?.title, "Settings");
    assert.ok(settings.items.every((item) => item.type === "page"));
  });

  test("every word must match; case and accents are ignored", () => {
    assert.equal(filterNavIndex("API KEYS", ALL).items[0]?.href, "/app/settings?section=developer");
    assert.equal(filterNavIndex("léads", ALL).items[0]?.href, "/app/leads");
    assert.equal(filterNavIndex("leads zzzz", ALL).total, 0);
    assert.equal(filterNavIndex("   ", ALL).total, 0);
  });

  test("plan-gated pages are hidden exactly as the sidebar hides them", () => {
    assert.ok(filterNavIndex("find leads", ALL).items.some((i) => i.href === "/app/find-leads"));
    assert.ok(!filterNavIndex("find leads", NONE).items.some((i) => i.href === "/app/find-leads"));
    assert.ok(!filterNavIndex("analytics", NONE).items.some((i) => i.href === "/app/analytics"));
  });

  test("results are capped but the total is reported", () => {
    const result = filterNavIndex("settings", ALL, 3);
    assert.equal(result.items.length, 3);
    assert.ok(result.total > 3);
  });
});

/* ---------------------------------------------------------------- grouping */

function item(type: SearchResultItem["type"], id: string): SearchResultItem {
  return { id, type, title: id, subtitle: null, href: `/x/${id}` };
}

describe("grouping", () => {
  test("groups follow the display order and skip empty groups", () => {
    const results: GlobalSearchResult = emptySearchResult();
    results.help = { items: [item("help", "h1")], total: 1 };
    results.leads = { items: [item("lead", "l1"), item("lead", "l2")], total: 9 };
    results.pages = { items: [item("page", "p1")], total: 1 };

    const groups = buildSearchGroups(results, "acme");
    assert.deepEqual(
      groups.map((group) => group.key),
      ["pages", "leads", "help"],
    );
    assert.deepEqual(
      groups.map((group) => group.key),
      SEARCH_CATEGORY_KEYS.filter((key) => ["pages", "leads", "help"].includes(key)),
    );
    const leads = groups.find((group) => group.key === "leads")!;
    assert.equal(leads.total, 9);
    assert.equal(leads.seeAllHref, "/app/leads?q=acme");
    assert.equal(groups.find((group) => group.key === "pages")!.seeAllHref, null);
  });

  test("a failed group is shown as failed, not dropped as empty", () => {
    const results = emptySearchResult();
    results.agents = { items: [], total: 0, error: true };
    const groups = buildSearchGroups(results, "acme");
    assert.equal(groups.length, 1);
    assert.equal(groups[0].key, "agents");
    assert.equal(groups[0].error, true);
    assert.equal(groups[0].seeAllHref, null);
  });

  test("flattened options put each group's See all after its items", () => {
    const results = emptySearchResult();
    results.pages = { items: [item("page", "p1")], total: 1 };
    results.leads = { items: [item("lead", "l1")], total: 4 };
    results.agents = { items: [item("agent", "a1")], total: 1 };
    const options = flattenSearchOptions(buildSearchGroups(results, "acme"));

    assert.deepEqual(
      options.map((option) => (option.kind === "item" ? option.item.id : `see-all:${option.group}`)),
      ["p1", "l1", "see-all:leads", "a1", "see-all:agents"],
    );
    const seeAllLeads = options[2];
    assert.equal(seeAllLeads.kind, "see-all");
    assert.equal(seeAllLeads.href, "/app/leads?q=acme");
    assert.match(seeAllLeads.kind === "see-all" ? seeAllLeads.label : "", /See all 4 leads/);
  });

  test("allGroupsFailed only when every searched group failed", () => {
    const results = emptySearchResult();
    const searched = SEARCH_CATEGORY_KEYS.filter((key) => key !== "pages");
    assert.equal(allGroupsFailed(results, []), false);
    assert.equal(allGroupsFailed(results, searched.slice(1)), false);
    assert.equal(allGroupsFailed(results, searched), true);
  });
});

/* --------------------------------------------------------- recent searches */

describe("recent searches", () => {
  test("most recent first, de-duplicated case-insensitively, capped", () => {
    let list: string[] = [];
    for (const term of ["alpha", "beta", "ALPHA", "gamma", "d1", "e1", "f1", "g1"]) {
      list = addRecentSearch(list, term);
    }
    assert.equal(list.length, RECENT_SEARCHES_CAP);
    assert.equal(list[0], "g1");
    assert.equal(list.filter((value) => value.toLowerCase() === "alpha").length, 1);
  });

  test("too-short terms are not remembered", () => {
    assert.deepEqual(addRecentSearch(["kept"], " a "), ["kept"]);
  });

  test("parsing tolerates anything storage hands back", () => {
    assert.deepEqual(parseRecentSearches(null), []);
    assert.deepEqual(parseRecentSearches("not json"), []);
    assert.deepEqual(parseRecentSearches('{"a":1}'), []);
    assert.deepEqual(parseRecentSearches('["ok", 3, "x", "fine"]'), ["ok", "fine"]);
  });
});
