import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "../src/lib/help/frontmatter.ts";
import {
  bodyImages,
  findRawHtml,
  headingId,
  pngSize,
  tableOfContents,
  validateArticle,
  type HelpArticle,
} from "../src/lib/help/contract.ts";
import {
  HELP_CATEGORIES,
  HELP_CATEGORY_SLUGS,
  normaliseCategory,
} from "../src/lib/help/categories.ts";
import { readHelpDirectory } from "../src/lib/help/disk.ts";
import { scoreArticle, searchArticles, tokenize } from "../src/lib/help/search.ts";

/**
 * The help-centre contract (Phase 8.1), enforced.
 *
 * `content/help/README.md` is what article authors follow; this file is what
 * makes it binding. Every article on disk is parsed and validated here, so a
 * missing field, an unknown category, raw HTML or a screenshot that was never
 * added fails the build rather than rendering a broken page.
 */

const index = readHelpDirectory(path.join(process.cwd(), "content", "help"), true);

describe("every article on disk meets the contract", () => {
  test("there are articles to check", () => {
    // The thirteen bundled articles that used to live in help.ts.
    assert.ok(index.articles.length >= 13, `found ${index.articles.length}`);
  });

  test("no article file has a problem", () => {
    const report = Object.entries(index.problems).map(
      ([file, problems]) => `${file}:\n    ${problems.join("\n    ")}`,
    );
    assert.deepEqual(report, [], `Help content problems:\n  ${report.join("\n  ")}`);
  });

  test("every category is a known one and matches its folder", () => {
    for (const article of index.articles) {
      assert.ok(
        (HELP_CATEGORY_SLUGS as readonly string[]).includes(article.category),
        `${article.slug}: ${article.category}`,
      );
    }
  });

  test("slugs are unique across categories", () => {
    const slugs = index.articles.map((article) => article.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  test("no body contains raw HTML", () => {
    for (const article of index.articles) {
      assert.deepEqual(findRawHtml(article.body), [], article.slug);
    }
  });

  test("every referenced screenshot exists", () => {
    for (const article of index.articles) {
      const sources = [...bodyImages(article.body).map((i) => i.src), ...article.screenshots.map((s) => s.src)];
      for (const src of sources) {
        assert.ok(existsSync(path.join(process.cwd(), "public", src)), `${article.slug}: ${src}`);
      }
    }
  });

  test("the thirteen formerly bundled articles kept their slugs", () => {
    const slugs = new Set(index.articles.map((article) => article.slug));
    for (const slug of [
      "getting-started",
      "finding-and-sourcing-leads",
      "setting-up-email-outreach",
      "managing-bookings",
      "api-keys",
      "webhooks",
      "connect-an-ai-assistant",
      "connecting-zapier",
      "ai-agents-setup",
      "troubleshooting-integrations",
      "connecting-hubspot",
      "connecting-zoho-crm",
      "connecting-pipedrive-and-other-crms",
    ]) {
      assert.ok(slugs.has(slug), `${slug} is missing`);
    }
  });

  test("help.ts no longer carries article text (one copy of every article)", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "lib", "support", "help.ts"), "utf8");
    assert.ok(!/body:\s*"/.test(source), "help.ts still contains article bodies");
    assert.match(source, /loadHelpIndex/);
  });

  test("the README documents every category", () => {
    const readme = readFileSync(path.join(process.cwd(), "content", "help", "README.md"), "utf8");
    for (const slug of HELP_CATEGORY_SLUGS) assert.ok(readme.includes(`\`${slug}\``), slug);
  });
});

describe("frontmatter parsing", () => {
  const sample = [
    "---",
    'title: "Connecting X: the basics"',
    "summary: Plain summary # with a comment",
    "category: integrations",
    'keywords: [crm, "service key, token", \'it\'\'s\']',
    "order: 20",
    "updated: 2026-09-26",
    "screenshots:",
    "  - src: /help/screenshots/a.png",
    "    alt: The dialog",
    '    caption: "Paste it here"',
    "---",
    "",
    "## Body",
  ].join("\n");

  test("reads the documented subset", () => {
    const { data, body, problems } = parseFrontmatter(sample);
    assert.deepEqual(problems, []);
    assert.equal(data.title, "Connecting X: the basics");
    assert.equal(data.summary, "Plain summary");
    assert.deepEqual(data.keywords, ["crm", "service key, token", "it's"]);
    assert.equal(data.order, 20);
    assert.equal(data.updated, "2026-09-26");
    assert.deepEqual(data.screenshots, [{ src: "/help/screenshots/a.png", alt: "The dialog", caption: "Paste it here" }]);
    assert.equal(body, "## Body");
  });

  test("block lists of strings", () => {
    const { data } = parseFrontmatter("---\nkeywords:\n  - one\n  - \"two, three\"\n---\nx");
    assert.deepEqual(data.keywords, ["one", "two, three"]);
  });

  test("CRLF files and a BOM parse the same", () => {
    const { data, problems } = parseFrontmatter("﻿" + sample.replace(/\n/g, "\r\n"));
    assert.deepEqual(problems, []);
    assert.equal(data.category, "integrations");
  });

  test("missing or unterminated frontmatter is reported", () => {
    assert.ok(parseFrontmatter("# no frontmatter").problems.length > 0);
    assert.ok(parseFrontmatter("---\ntitle: x\n").problems.length > 0);
  });

  test("malformed lines are reported, not guessed", () => {
    const { problems } = parseFrontmatter("---\njust some text\ntitle: ok\n---\nbody");
    assert.ok(problems.some((p) => p.includes("expected")));
  });
});

describe("contract validation", () => {
  const good = {
    title: "T",
    summary: "S",
    category: "faq",
    keywords: ["k"],
    order: 1,
    updated: "2026-09-26",
  };

  test("a complete article is valid", () => {
    const { article, problems } = validateArticle({ slug: "a-b", folder: "faq", data: good, body: "Hello" });
    assert.deepEqual(problems, []);
    assert.equal(article?.category, "faq");
  });

  test("each required field is required", () => {
    for (const field of Object.keys(good)) {
      const data: Record<string, unknown> = { ...good };
      delete data[field];
      const { problems } = validateArticle({ slug: "a", folder: "faq", data: data as never, body: "x" });
      assert.ok(problems.some((p) => p.startsWith(field)), `${field}: ${problems.join("; ")}`);
    }
  });

  test("unknown category, folder mismatch, bad slug and unknown fields fail", () => {
    assert.ok(validateArticle({ slug: "a", folder: "faq", data: { ...good, category: "nope" }, body: "x" }).problems.length);
    assert.ok(validateArticle({ slug: "a", folder: "billing", data: good, body: "x" }).problems.length);
    assert.ok(validateArticle({ slug: "Bad_Slug", folder: "faq", data: good, body: "x" }).problems.length);
    assert.ok(validateArticle({ slug: "a", folder: "faq", data: { ...good, author: "me" }, body: "x" }).problems.length);
  });

  test("raw HTML is rejected outside code, allowed inside it", () => {
    assert.deepEqual(findRawHtml("Use `<div>` or\n\n```\n<script>x</script>\n```\n"), []);
    assert.deepEqual(findRawHtml("See <https://example.com>"), []);
    assert.equal(findRawHtml("Hi <b>there</b>").length, 2);
    assert.equal(findRawHtml("<!-- note -->").length, 1);
    const { problems } = validateArticle({ slug: "a", folder: "faq", data: good, body: '<img src="x" onerror="alert(1)">' });
    assert.ok(problems.some((p) => p.includes("raw HTML")));
  });

  test("images need alt text, a caption and a real file under /help/screenshots", () => {
    const body = "![](/help/screenshots/x.png)\n\n![Alt](/elsewhere/y.png \"Cap\")\n\n![Alt](/help/screenshots/z.png \"Cap\")";
    const { problems } = validateArticle({ slug: "a", folder: "faq", data: good, body, screenshotExists: () => false });
    assert.ok(problems.some((p) => p.includes("no alt text")));
    assert.ok(problems.some((p) => p.includes("no \"caption\"")));
    assert.ok(problems.some((p) => p.includes("must live under")));
    assert.ok(problems.some((p) => p.includes("does not exist")));
  });

  test("frontmatter screenshots need src, alt and caption", () => {
    const { problems } = validateArticle({
      slug: "a",
      folder: "faq",
      data: { ...good, screenshots: [{ src: "/help/screenshots/a.png", alt: "", caption: "" }] },
      body: "x",
      screenshotExists: () => true,
    });
    assert.ok(problems.some((p) => p.includes("alt")));
    assert.ok(problems.some((p) => p.includes("caption")));
  });

  test("a level-1 heading in the body is rejected", () => {
    const { problems } = validateArticle({ slug: "a", folder: "faq", data: good, body: "# Title again\n\ntext" });
    assert.ok(problems.some((p) => p.includes("level-1")));
  });

  test("table of contents and heading ids", () => {
    assert.equal(headingId("Connect a **mailbox** & go"), "connect-a-mailbox-and-go");
    assert.deepEqual(tableOfContents("## One\ntext\n```\n## not a heading\n```\n## Two"), [
      { id: "one", text: "One" },
      { id: "two", text: "Two" },
    ]);
  });

  test("PNG dimensions are read from the header", () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(bytes.buffer).setUint32(16, 1440);
    new DataView(bytes.buffer).setUint32(20, 900);
    assert.deepEqual(pngSize(bytes), { width: 1440, height: 900 });
    assert.equal(pngSize(new Uint8Array(32)), null);
  });

  test("database categories normalise onto slugs", () => {
    assert.equal(normaliseCategory("INTEGRATIONS"), "integrations");
    assert.equal(normaliseCategory("Getting started"), "getting-started");
    assert.equal(normaliseCategory("Booking & sales"), "booking-and-sales");
    assert.equal(normaliseCategory("OTHER"), "faq");
    assert.equal(normaliseCategory("OTHER", "developers"), "developers");
    assert.equal(HELP_CATEGORIES.length, HELP_CATEGORY_SLUGS.length);
  });
});

describe("search", () => {
  const make = (over: Partial<HelpArticle>): HelpArticle => ({
    slug: "x",
    title: "",
    summary: "",
    category: "faq",
    keywords: [],
    order: 0,
    updated: null,
    screenshots: [],
    body: "",
    source: "file",
    viewCount: 0,
    ...over,
  });

  const articles = [
    make({ slug: "hubspot", title: "Connecting HubSpot", summary: "Push leads to your CRM", keywords: ["crm", "service key"], category: "integrations" }),
    make({ slug: "email", title: "Setting up email outreach", summary: "Connect your mailbox", keywords: ["smtp", "imap"], body: "Connect Google Workspace. DKIM and SPF." }),
    make({ slug: "zoho", title: "Connecting Zoho CRM", summary: "Push qualified leads", keywords: ["crm"], body: "Zoho data centres" }),
    make({ slug: "api", title: "API keys", summary: "Create a key", keywords: ["bearer"], body: "rapid response" }),
    make({ slug: "popular", title: "Getting started", summary: "Basics", viewCount: 50 }),
  ];

  test("tokenize drops stop words and punctuation, keeps a pure stop-word query", () => {
    assert.deepEqual(tokenize("How do I connect, HubSpot?"), ["connect", "hubspot"]);
    assert.deepEqual(tokenize("how do i"), ["how", "do", "i"]);
    assert.deepEqual(tokenize("   "), []);
  });

  test("keywords are searched (the old .or() filter ignored them)", () => {
    assert.equal(searchArticles(articles, "smtp")[0]?.slug, "email");
    assert.equal(searchArticles(articles, "bearer")[0]?.slug, "api");
  });

  test("a comma in the query is just text, not a filter separator", () => {
    const results = searchArticles(articles, "hubspot, crm");
    assert.equal(results[0]?.slug, "hubspot");
  });

  test("filter-syntax characters cannot break or widen the search", () => {
    assert.deepEqual(searchArticles(articles, "title.ilike.%,summary.eq.x)"), []);
    assert.deepEqual(searchArticles(articles, "%_%"), searchArticles(articles, ""));
  });

  test("title outranks keywords outranks body", () => {
    const ranked = searchArticles(articles, "zoho");
    assert.equal(ranked[0].slug, "zoho");
    const title = scoreArticle(make({ title: "Alpha guide" }), ["alpha"]).score;
    const keyword = scoreArticle(make({ keywords: ["alpha"] }), ["alpha"]).score;
    const summary = scoreArticle(make({ summary: "About alpha" }), ["alpha"]).score;
    const body = scoreArticle(make({ body: "alpha alpha alpha alpha" }), ["alpha"]).score;
    assert.ok(summary > body, `${summary} ${body}`);
    assert.ok(title > keyword && keyword > body, `${title} ${keyword} ${body}`);
  });

  test("articles matching every term beat those matching some", () => {
    const ranked = searchArticles(articles, "crm zoho");
    assert.equal(ranked[0].slug, "zoho");
  });

  test("a partly misspelt query still returns partial matches", () => {
    assert.equal(searchArticles(articles, "hubspot integrashun")[0]?.slug, "hubspot");
  });

  test("word-prefix matching: 'mail' finds mailbox, 'api' does not match 'rapid'", () => {
    assert.ok(searchArticles(articles, "mail").some((a) => a.slug === "email"));
    const apiHits = searchArticles(articles, "api").map((a) => a.slug);
    assert.deepEqual(apiHits, ["api"]);
  });

  test("an empty query returns the most viewed first", () => {
    assert.equal(searchArticles(articles, "")[0].slug, "popular");
  });

  test("respects the limit", () => {
    assert.equal(searchArticles(articles, "", 2).length, 2);
  });

  test("the real index answers real questions", () => {
    const top = (q: string) => searchArticles(index.articles, q, 3).map((a) => a.slug);
    assert.ok(top("hubspot").includes("connecting-hubspot"));
    assert.ok(top("webhook signature").includes("webhooks"));
    assert.ok(top("mailbox imap").includes("setting-up-email-outreach"));
    assert.ok(top("MCP claude").includes("connect-an-ai-assistant"));
  });
});
