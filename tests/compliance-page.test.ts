import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { FOOTER_LEGAL, PRIMARY_NAV } from "../src/components/marketing/public/nav-data.ts";
import { HARD_BOUNCE_RATE_LIMIT, COMPLAINT_RATE_LIMIT } from "../src/lib/outreach/campaign-state.ts";
import { DEFAULT_STEP_DELAYS_DAYS, MAX_SEQUENCE_STEPS, MAX_STEP_DELAY_DAYS } from "../src/lib/outreach/campaign-draft.ts";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const PAGE = "src/app/(marketing)/compliance/page.tsx";

test("the compliance page exists, is in the sitemap and reachable from the site chrome", () => {
  assert.ok(existsSync(path.join(root, PAGE)));
  assert.match(read("src/app/sitemap.ts"), /path: "compliance"/);
  assert.ok(FOOTER_LEGAL.some((link) => link.href === "/compliance"));
  const inNav = PRIMARY_NAV.some(
    (item) => item.kind === "mega" && item.columns.some((c) => c.links.some((l) => l.href === "/compliance")),
  );
  assert.ok(inNav, "/compliance is in a header menu");
});

test("the compliance page states the customer's responsibility and claims no certification", () => {
  const page = read(PAGE);
  assert.match(page, /not legal advice/);
  assert.match(page, /controller/);
  assert.doesNotMatch(page, /ISO ?27001|SOC ?2|Cyber Essentials|certified|GDPR[- ]compliant/i);
  // Residency is stated only as the sub-processor register records it.
  assert.match(read("src/lib/marketing/subprocessors.ts"), /London, United Kingdom \(eu-west-2\)/);
  assert.match(page, /eu-west-2/);
});

test("the cold email article quotes the thresholds and cadence the code uses", () => {
  const article = read("content/help/finding-leads/cold-email-that-gets-replies.md");
  assert.equal(HARD_BOUNCE_RATE_LIMIT, 0.05);
  assert.equal(COMPLAINT_RATE_LIMIT, 0.003);
  assert.match(article, /pass 5%, or spam complaints pass 0\.3%/);
  assert.deepEqual(DEFAULT_STEP_DELAYS_DAYS, [0, 3, 7, 14]);
  assert.match(article, /day 0, day 3, day 7 and day 14/);
  assert.equal(MAX_SEQUENCE_STEPS, 5);
  assert.equal(MAX_STEP_DELAY_DAYS, 30);
  assert.match(article, /up to five steps, each up to 30 days/);
});

test("the in-product tips link to articles that exist", () => {
  const sources = [
    "src/components/find-leads/prospect-drawer.tsx",
    "src/components/find-leads/social/social-outreach-panel.tsx",
  ].map(read).join("\n");
  for (const slug of [
    "finding-leads/reaching-the-decision-maker",
    "finding-leads/cold-email-that-gets-replies",
    "compliance/social-conversations-by-channel",
  ]) {
    assert.ok(sources.includes(`/app/help/${slug}`), `${slug} is linked from the product`);
    assert.ok(existsSync(path.join(root, "content/help", `${slug}.md`)), `${slug}.md exists`);
  }
});
