import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  summariseCampaignBudget,
  toCustomerCampaignBudget,
  type CampaignBudgetContext,
} from "../src/lib/outreach/campaign-budget.ts";
import { emptyDraft } from "../src/lib/outreach/campaign-draft.ts";

/**
 * Serving costs are admin-only (owner decision, 2026-09-30).
 *
 * Customers never see what ClientTurn pays its providers: no provider cost
 * ceiling in pounds, no "~£0.41 per prospect", no "£0.02 per refresh", no
 * provider spend meter, no cost per reply. Admin → Economics and the admin
 * customer drawer keep all of it. Customers keep what is theirs: allowances,
 * their own daily/monthly caps, and credits priced in the price list.
 *
 * The scan below is deliberately blunt: any customer component or page that
 * names one of these fields fails the build, so a cost cannot creep back in
 * through a new card.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

/** Serving-cost fields and phrases that must not appear on a customer surface. */
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /costPerProspectMinor/, why: "provider cost per prospect" },
  { pattern: /providerCostCeilingMinor/, why: "the provider cost ceiling (pence)" },
  { pattern: /providerCeilingMinor/, why: "the platform provider ceiling (pence)" },
  { pattern: /providerCostMinor/, why: "estimated provider cost" },
  { pattern: /maxProviderCostMinor/, why: "a sourcing run's provider cost cap" },
  { pattern: /estimatedCostMinor/, why: "a research refresh's provider cost" },
  { pattern: /budgetSpentMinor|budgetCapMinor/, why: "campaign provider spend in pounds" },
  { pattern: /costPerReplyMinor|costPerQualifiedMinor/, why: "provider spend per outcome" },
  { pattern: /spentMinor|capMinor/, why: "provider spend / ceiling in pence" },
  { pattern: /totalCostUsd|costUsd/, why: "AI provider cost" },
  { pattern: /Provider cost ceiling|Max provider cost|Estimated provider cost/i, why: "provider cost copy" },
  { pattern: /Provider spend|Provider costs/i, why: "provider spend copy" },
  { pattern: /per prospect\)|of your (sourcing )?budget, once per/i, why: "a unit serving cost" },
  // AI spend in money (owner decision 2026-09-30: AI usage is in AI credits).
  { pattern: /spentGbp|ceilingGbp|emergencyMinor|platformMinor|workspaceMinor/, why: "AI spend or ceilings in pounds" },
  { pattern: /Platform hard stop|Plan ceiling|AI budget this month|Spent this month/i, why: "AI money copy" },
  // Model tokens: customers see AI credits, never the model's token counts.
  { pattern: /\bAI tokens?\b|AI token packs?|Buy more tokens/i, why: "model tokens named as the AI unit" },
  { pattern: /formatTokens\(|\.tokens\.toLocaleString|tokensPerPound\(/, why: "a model-token count rendered" },
  { pattern: />\s*Tokens\s*</, why: "a Tokens column" },
  // Voice money (owner, 2026-09-30: "Hide voice call cost from customers").
  { pattern: /costGbp|totalCostGbp|costPerOutcome|voiceSpendGbp|returnMultiple/, why: "voice call cost" },
  { pattern: /Call cost|Cost per booking|Cost per outcome|Voice spend|x voice spend/i, why: "voice cost copy" },
  // ClientTurn's provider cost rollup (business_cost_daily) shown as "spend".
  { pattern: /totalSpend|Total spend/i, why: "provider spend in usage history" },
];

/**
 * Surfaces outside the scan, each with its reason. Anything added here needs
 * an owner decision, not a convenience.
 *  - marketing / public (filtered in `customerFiles`): pre-sign-up pages that
 *    describe the product ("before provider spend begins") and quote no cost.
 *
 * Voice is scanned like everything else (owner, 2026-09-30). The Voice
 * settings UI may show what the customer BUYS (minute packs, the number, the
 * voice item: prices and minutes), which none of the patterns above match.
 * `VOICE_SETTINGS_ALLOW` is the narrow, per-pattern exception for that UI; it
 * is empty today because nothing there needed one.
 */
const EXEMPT: RegExp[] = [];
const VOICE_SETTINGS = /[\\/]settings[\\/]voice[\\/]|voice-section\.tsx$/;
const VOICE_SETTINGS_ALLOW: RegExp[] = [];

/** Comments explain the rule; they are not rendered, so they are not scanned. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|mdx?)$/.test(name)) out.push(full);
  }
  return out;
}

function customerFiles(): string[] {
  const components = walk(path.join(ROOT, "src/components")).filter(
    (file) => !/[\\/]components[\\/](admin|marketing|public)[\\/]/.test(file),
  );
  const pages = walk(path.join(ROOT, "src/app/(app)"));
  return [...components, ...pages].filter((file) => !EXEMPT.some((rule) => rule.test(file)));
}

test("no customer component or page renders a serving cost", () => {
  const offences: string[] = [];
  for (const file of customerFiles()) {
    const text = stripComments(readFileSync(file, "utf8"));
    for (const { pattern, why } of FORBIDDEN) {
      if (VOICE_SETTINGS.test(file) && VOICE_SETTINGS_ALLOW.some((allow) => allow.source === pattern.source)) continue;
      if (pattern.test(text)) offences.push(`${path.relative(ROOT, file)}: ${why} (${pattern})`);
    }
  }
  assert.deepEqual(offences, [], `serving costs on customer surfaces:\n${offences.join("\n")}`);
});

test("the Find Leads help article does not ask customers to set a provider cost", () => {
  const article = readFileSync(
    path.join(ROOT, "content/help/finding-leads/find-leads-discovery.md"),
    "utf8",
  );
  assert.doesNotMatch(article, /Max provider cost|provider spend/i);
});

test("the wizard's budget context type carries no money field", () => {
  // Compile-time shape, checked at runtime through a literal: adding a money
  // field to CampaignBudgetContext makes this object fail `tsc`, and the key
  // list below fails the test.
  const context: CampaignBudgetContext = {
    ceilings: {
      prospectsRemaining: 1,
      prospectsLimit: 1,
      dailyContactMax: 1,
      monthlyContactsRemaining: 1,
      monthlyContactsLimit: 1,
      communicationRemaining: 1,
      communicationLimit: 1,
      overageAvailable: false,
    },
    meters: [{ key: "prospects", label: "Prospects (monthly)", used: 0, limit: 1 }],
    dailyCapSource: "PLAN",
  };
  const json = JSON.stringify(context);
  assert.doesNotMatch(json, /Minor|cost|money|spend/i);
});

test("the budget summary and campaign budget view are money-free", () => {
  const summary = summariseCampaignBudget(emptyDraft());
  assert.doesNotMatch(JSON.stringify(summary), /Minor|cost/i);

  const view = toCustomerCampaignBudget({
    capMinor: 100,
    spentMinor: 50,
    percentUsed: 50,
    breakdown: [],
    empty: true,
  });
  assert.doesNotMatch(JSON.stringify(view), /Minor/);
});

/* ------------------------------------------------ AI credits and voice */

test("the voice components and the Voice settings UI are scanned, not exempt", () => {
  const files = customerFiles().map((file) => path.relative(ROOT, file).split(path.sep).join("/"));
  assert.ok(files.some((file) => file.startsWith("src/components/voice/")), "components/voice must be scanned");
  assert.ok(files.some((file) => file.startsWith("src/components/settings/voice/")), "the Voice settings UI must be scanned");
});

test("help articles describe AI usage in AI credits and show no serving cost", () => {
  const offences: string[] = [];
  for (const file of walk(path.join(ROOT, "content/help"))) {
    if (file.endsWith("SCREENSHOTS.md")) continue;
    const text = readFileSync(file, "utf8");
    for (const pattern of [
      /\bAI tokens?\b|AI token packs?/i,
      /Platform hard stop|plan ceiling|AI budget this month/i,
      /Call cost|Cost per booking|Voice spend|Total spend/i,
      /(ceilings?|limits?) (are )?in pounds|£ (spending )?limits/i,
    ]) {
      if (pattern.test(text)) offences.push(`${path.relative(ROOT, file)}: ${pattern}`);
    }
  }
  assert.deepEqual(offences, [], `help still describes AI or voice money:\n${offences.join("\n")}`);
});

test("ai_usage.get (Copilot, MCP, API) returns AI credits, not money or model tokens", () => {
  const source = readFileSync(path.join(ROOT, "src/lib/services/operations/revenue.ts"), "utf8");
  const start = source.indexOf('defineOperation("ai_usage.get"');
  assert.ok(start >= 0);
  const block = source.slice(start, source.indexOf("defineOperation(", start + 10));
  const returned = block.slice(block.indexOf("return {"));
  assert.doesNotMatch(returned, /Gbp|Usd|cost|tokens:/);
  assert.match(returned, /usedCredits/);
});

test("the dashboard and AI & selling read AI credits, not the £ budget", () => {
  const dashboard = readFileSync(path.join(ROOT, "src/lib/dashboard/revenue-control.ts"), "utf8");
  assert.doesNotMatch(dashboard, /loadAiBudget|workspace_cost_usd/);
  const section = readFileSync(path.join(ROOT, "src/app/(app)/app/settings/_sections/ai-selling-section.tsx"), "utf8");
  assert.match(section, /getCreditStatus/);
});

test("the search plan sent to the browser carries no provider cost cap", async () => {
  const { emptyPlan, toCustomerPlan } = await import("../src/lib/find-leads/plan.ts");
  const plan = emptyPlan();
  assert.equal(typeof plan.maxProviderCostMinor, "number");
  const customer = toCustomerPlan(plan);
  assert.ok(!("maxProviderCostMinor" in customer));
  assert.doesNotMatch(JSON.stringify(customer), /cost/i);
  const page = readFileSync(path.join(ROOT, "src/app/(app)/app/find-leads/search/[sessionId]/page.tsx"), "utf8");
  assert.match(page, /toCustomerPlan\(session\.plan\)/);
});
