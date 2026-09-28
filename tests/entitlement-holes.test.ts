import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  ARRIVING_LEAD_SOURCES,
  CREATED_LEAD_SOURCES,
  leadCapMessage,
  leadCapPolicyFor,
  leadIntakeGate,
  startWorkGate,
} from "../src/lib/billing/lead-cap.ts";
import { INGEST_SOURCE_TYPES } from "../src/lib/ingest/types.ts";
import {
  analyticsAllowed,
  countGate,
  overLimitNotice,
  overLimitReport,
  savedSearchGate,
  senderIdentityGate,
  sendersWithinLimit,
} from "../src/lib/billing/allowance-gates.ts";
import { unitCostsFromPriceBook, penceRateFor } from "../src/lib/find-leads/price-book.ts";
import { FALLBACK_UNIT_COST_MINOR } from "../src/lib/find-leads/cost-model.ts";
import { USD_TO_GBP_MODEL } from "../src/lib/billing/unit-costs.ts";
import {
  PAID_ENRICHMENT_ENV_KEYS,
  PAID_ENRICHMENT_PROVIDER_KEYS,
  allowedProviders,
  paidEnrichmentEnabled,
  paidEnrichmentKey,
} from "../src/lib/find-leads/paid-enrichment.ts";
import { automaticTaxEnabled, taxCheckoutParams, vatCopy } from "../src/lib/billing/tax.ts";
import { listMonthlyPrice, monthlyRevenue } from "../src/lib/billing/revenue.ts";
import { PLANS } from "../src/lib/billing/plans.ts";
import { SUBPROCESSORS } from "../src/lib/marketing/subprocessors.ts";

/**
 * Billing batch 2 (gap audit 15 top-10 #10, §9): every plan allowance is
 * enforced server-side, on every path; the downgrade-over-limit rule; the
 * Find Leads price book; paid enrichment hard-off; VAT readiness; real MRR.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("the lead cap covers every way a lead is created", () => {
  test("every ingest source has a policy; created sources refuse, arriving ones store", () => {
    for (const type of INGEST_SOURCE_TYPES) {
      const listed = CREATED_LEAD_SOURCES.includes(type) || ARRIVING_LEAD_SOURCES.includes(type);
      assert.ok(listed, `${type} is classified`);
    }
    for (const type of ["MANUAL", "CSV", "API", "MCP"] as const) assert.equal(leadCapPolicyFor(type), "REFUSE_AT_CAP");
    for (const type of ["AD_FORM", "WEB_FORM", "CONNECTOR", "SOCIAL_DM", "CRM"] as const) assert.equal(leadCapPolicyFor(type), "STORE_AND_HOLD");
  });

  test("a created lead that would be worked is refused at the cap, and while inactive", () => {
    assert.deepEqual(leadIntakeGate({ sourceType: "MANUAL", willBeWorked: true, active: true, used: 99, limit: 100 }), { allowed: true });
    assert.deepEqual(leadIntakeGate({ sourceType: "API", willBeWorked: true, active: true, used: 100, limit: 100 }), { allowed: false, reason: "plan_limit" });
    assert.deepEqual(leadIntakeGate({ sourceType: "MCP", willBeWorked: true, active: false, used: 0, limit: 100 }), { allowed: false, reason: "subscription_inactive" });
  });

  test("a record-only import is never capped; an arriving enquiry is never refused", () => {
    assert.deepEqual(leadIntakeGate({ sourceType: "CSV", willBeWorked: false, active: true, used: 500, limit: 100 }), { allowed: true });
    assert.deepEqual(leadIntakeGate({ sourceType: "AD_FORM", willBeWorked: true, active: false, used: 500, limit: 100 }), { allowed: true });
  });

  test("promotion and resume: counted once, refused at the cap", () => {
    assert.deepEqual(startWorkGate({ alreadyMetered: true, active: true, used: 500, limit: 100 }), { allowed: true });
    assert.deepEqual(startWorkGate({ alreadyMetered: false, active: true, used: 100, limit: 100 }), { allowed: false, reason: "plan_limit" });
    assert.match(leadCapMessage("plan_limit", 1000), /1,000 new leads/);
  });

  test("wired: ingest (manual, CSV, API, MCP), promotion, resume, lead.process", () => {
    const ingest = read("src/lib/ingest/service.ts");
    const gateAt = ingest.indexOf("leadIntakeGate(");
    const insertAt = ingest.indexOf('.from("leads").insert(row)');
    assert.ok(gateAt > 0 && insertAt > gateAt, "the cap is checked before the lead insert");
    assert.match(read("src/lib/find-leads/actions.ts"), /startWorkGate\(\{ alreadyMetered: false, \.\.\.capacity \}\)/);
    assert.match(read("src/lib/find-leads/actions.ts"), /meterLeadIfNeeded\(access\.workspace\.businessId, lead\.id\)/);
    assert.match(read("src/lib/services/operations/leads.ts"), /meterLeadIfNeeded\(context\.businessId, args\.leadId\)/);
    assert.match(read("src/lib/services/operations/leads.ts"), /"PLAN_LIMIT"/);
    assert.match(read("src/lib/mcp/handlers.ts"), /plan_limit/);
    assert.match(read("src/lib/leads/add-lead/actions.ts"), /plan_limit/);
    assert.match(read("src/lib/imports/actions.ts"), /Plan lead limit reached/);
    assert.match(read("src/lib/jobs/handlers/lead-process.ts"), /assertLeadCapacity\(business\.businessId\)/);
  });

  test("voice inbound creates no lead, so it has no cap to check", () => {
    for (const file of ["src/lib/voice/inbound-core.ts", "src/lib/voice/inbound.ts"]) {
      const source = read(file);
      assert.doesNotMatch(source, /ingestLead\(/, `${file} does not ingest`);
      assert.doesNotMatch(source, /from\("leads"\)\s*\.insert/, `${file} does not insert leads`);
    }
  });
});

describe("count allowances and the downgrade-over-limit rule", () => {
  test("countGate: at the limit refuses, over the limit refuses whatever is added", () => {
    assert.equal(countGate({ used: 1, limit: 2 }).allowed, true);
    assert.equal(countGate({ used: 2, limit: 2 }).allowed, false);
    const over = countGate({ used: 5, limit: 2 });
    assert.equal(over.allowed, false);
    if (!over.allowed) assert.equal(over.overBy, 3);
  });

  test("saved searches count ACTIVE schedules", () => {
    assert.equal(savedSearchGate({ activeSchedules: 1, limit: 2 }).allowed, true);
    assert.equal(savedSearchGate({ activeSchedules: 2, limit: 2 }).allowed, false);
  });

  test("sender identities: a new address needs a slot; re-saving never does", () => {
    assert.equal(senderIdentityGate({ activeEmails: ["a@x.co"], email: "b@x.co", limit: 1 }).allowed, false);
    assert.equal(senderIdentityGate({ activeEmails: ["a@x.co"], email: " A@X.co ", limit: 1 }).allowed, true);
    assert.equal(senderIdentityGate({ activeEmails: ["a@x.co", "b@x.co", "c@x.co"], email: "a@x.co", limit: 1 }).allowed, true);
    assert.equal(sendersWithinLimit({ activeSenders: 3, limit: 1 }), false);
    assert.equal(sendersWithinLimit({ activeSenders: 1, limit: 1 }), true);
  });

  test("the report lists exactly what to reduce, and nothing when within the plan", () => {
    const limits = { seats: 1, senderIdentities: 1, savedSearches: 2, intentMonitors: 5 };
    assert.deepEqual(overLimitReport({ seats: 1, senderIdentities: 1, savedSearches: 2, intentMonitors: 5 }, limits), []);
    const report = overLimitReport({ seats: 3, senderIdentities: 2, savedSearches: 2, intentMonitors: 0 }, limits);
    assert.deepEqual(report.map((r) => [r.key, r.reduceBy]), [["seats", 2], ["sender_identities", 1]]);
    assert.match(report[0].action, /Remove 2 team members/);
    const notice = overLimitNotice(report, "Starter");
    assert.ok(notice);
    assert.match(notice!.title, /over the Starter plan's limits/);
    assert.match(notice!.body, /Nothing has been removed/);
    assert.equal(overLimitNotice([], "Starter"), null);
  });

  test("wired server-side: saved searches, senders, launches, monitors, seats, banner, downgrade notice", () => {
    const findLeads = read("src/lib/find-leads/actions.ts");
    assert.equal((findLeads.match(/savedSearchSlotProblem\(admin, access\.workspace\.businessId\)/g) ?? []).length, 2, "create and resume");
    assert.match(read("src/lib/outreach/actions.ts"), /senderIdentityCreateProblem\(/);
    assert.match(read("src/lib/outreach/actions.ts"), /senderLimitLaunchProblem\(/);
    assert.match(read("src/lib/outreach/campaigns/launch.ts"), /senderLimitLaunchProblem\(/);
    assert.match(read("src/lib/intent/actions.ts"), /countGate\(\{ used: count \?\? 0/);
    assert.match(read("src/lib/services/operations/team.ts"), /seatsInUse\(/);
    assert.match(read("src/lib/billing/limits-service.ts"), /overLimitNotice\(/);
    assert.match(read("src/lib/billing/checkout.ts"), /overLimitForPlan\(workspace\.businessId, plan\)/);
    assert.match(read("src/lib/settings/queries.ts"), /overLimitNow\(businessId\)/);
  });
});

describe("the plan-allowance audit: every allowance has a server-side enforcement point", () => {
  // Allowance (plans.ts or plan_entitlements) -> [file, pattern] that enforces it.
  const ENFORCEMENT: [string, string, RegExp][] = [
    ["leadLimit", "src/lib/jobs/handlers/lead-process.ts", /assertLeadCapacity\(/],
    ["leadLimit (created leads)", "src/lib/ingest/service.ts", /leadIntakeGate\(/],
    ["userLimit", "src/lib/services/operations/team.ts", /seatsInUse\(members\.map\(facts\)\) >= entitlements\.userLimit/],
    ["smsSegmentAllowance", "src/lib/billing/limits-service.ts", /allowancesFor\(input\.entitlements\.plan\)\.smsSegmentAllowance/],
    ["reactivationContactLimit", "src/lib/jobs/handlers/campaign-expand.ts", /reactivationLimitProblem/],
    ["aiTokenAllowance", "src/lib/ai/tokens.ts", /reserve/i],
    ["whatsappEnabled", "src/lib/automations/actions.ts", /assertEntitlement\(workspace\.businessId, "whatsapp"\)/],
    ["verified_prospect / search_run", "src/lib/find-leads/server/budget.ts", /getV4Usage\(businessId, "verified_prospect"/],
    ["saved_search", "src/lib/find-leads/actions.ts", /savedSearchGate\(/],
    ["intent_monitor", "src/lib/intent/actions.ts", /countGate\(/],
    ["sender_identity", "src/lib/billing/sender-limit.ts", /senderIdentityGate\(/],
    ["email_sent", "src/lib/outreach/dispatch.ts", /checkCapacity\(input\.businessId, "email_sent"\)/],
    ["sourcing_enabled", "src/lib/find-leads/actions.ts", /assertCapability\(workspace\.businessId, "sourcing"\)/],
    ["cold_email_enabled", "src/lib/outreach/campaign-actions.ts", /assertCapability\(workspace\.businessId, "cold_email"\)/],
    ["analytics (trial)", "src/app/(app)/app/analytics/page.tsx", /analyticsAllowed\(entitlements\.plan\)/],
  ];
  for (const [allowance, file, pattern] of ENFORCEMENT) {
    test(`${allowance} is enforced in ${file}`, () => {
      assert.match(read(file), pattern);
    });
  }

  test("analytics: one rule for the nav and the page; trials see the locked state", () => {
    assert.equal(analyticsAllowed("trial"), false);
    assert.equal(analyticsAllowed("starter"), true);
    assert.match(read("src/app/(app)/layout.tsx"), /analytics: analyticsAllowed\(v4Entitlements\.plan\)/);
    assert.match(read("src/app/(app)/app/analytics/page.tsx"), /PlanLimitState/);
  });

  test("Enterprise has a lead_processed entitlement row (0138)", () => {
    const dir = path.join(process.cwd(), "supabase/migrations");
    const all = readdirSync(dir).map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
    assert.match(all, /\('enterprise',\s*'lead_processed'/);
  });
});

describe("Find Leads unit costs come from the price book, in pence", () => {
  const now = new Date("2026-09-28T00:00:00Z");

  test("a USD row is converted at the model rate, matched on the capability column", () => {
    const costs = unitCostsFromPriceBook(
      [
        { capability: "CONTACT_ENRICHMENT", currency: "USD", unit_cost: "0.0800", effective_from: "2026-01-01T00:00:00Z", effective_to: null },
      ],
      { now, usdToGbp: USD_TO_GBP_MODEL },
    );
    // $0.08 = £0.0604 = 6.04p, not the 8p the old code read.
    assert.equal(costs.CONTACT_ENRICHMENT, Math.ceil(0.08 * USD_TO_GBP_MODEL * 100 * 10_000) / 10_000);
    assert.ok(costs.CONTACT_ENRICHMENT! < 8);
  });

  test("the newest live row wins; ended, future and unknown-currency rows are skipped", () => {
    const costs = unitCostsFromPriceBook(
      [
        { capability: "COMPANY_SEARCH", currency: "GBP", unit_cost: 0.01, effective_from: "2026-01-01T00:00:00Z", effective_to: null },
        { capability: "COMPANY_SEARCH", currency: "GBP", unit_cost: 0.02, effective_from: "2026-06-01T00:00:00Z", effective_to: null },
        { capability: "COMPANY_SEARCH", currency: "GBP", unit_cost: 0.5, effective_from: "2027-01-01T00:00:00Z", effective_to: null },
        { capability: "INTENT", currency: "USD", unit_cost: 1, effective_from: "2026-01-01T00:00:00Z", effective_to: "2026-02-01T00:00:00Z" },
        { capability: "EMAIL_VERIFICATION", currency: "JPY", unit_cost: 1, effective_from: "2026-01-01T00:00:00Z", effective_to: null },
        { capability: "EMAIL_SEND", currency: "USD", unit_cost: 1, effective_from: "2026-01-01T00:00:00Z", effective_to: null },
      ],
      { now, usdToGbp: USD_TO_GBP_MODEL },
    );
    assert.deepEqual(costs, { COMPANY_SEARCH: 2 });
    assert.equal(penceRateFor("GBP", USD_TO_GBP_MODEL), 100);
    assert.equal(penceRateFor("EUR", USD_TO_GBP_MODEL), null);
    assert.ok(FALLBACK_UNIT_COST_MINOR.INTENT > 0, "INTENT falls back");
  });

  test("loadUnitCosts selects on `capability`, not `product`", () => {
    const budget = read("src/lib/find-leads/server/budget.ts");
    assert.match(budget, /\.in\("capability", CAPABILITIES\)/);
    assert.doesNotMatch(budget, /\.in\("product", CAPABILITIES\)/);
    assert.match(budget, /unitCostsFromPriceBook\(/);
  });
});

describe("paid enrichment is hard-off (CLAUDE.md resolved conflict 7)", () => {
  test("the switch defaults off and only exactly 'true' turns it on", () => {
    assert.equal(paidEnrichmentEnabled({}), false);
    assert.equal(paidEnrichmentEnabled({ ENABLE_PAID_ENRICHMENT: "false" }), false);
    assert.equal(paidEnrichmentEnabled({ ENABLE_PAID_ENRICHMENT: "1" }), false);
    assert.equal(paidEnrichmentEnabled({ ENABLE_PAID_ENRICHMENT: "yes" }), false);
    assert.equal(paidEnrichmentEnabled({ ENABLE_PAID_ENRICHMENT: "true" }), true);
  });

  test("with the switch off a key in the environment is never read", () => {
    const env = { APOLLO_API_KEY: "k1", HUNTER_API_KEY: "k2", CLEARBIT_API_KEY: "k3" };
    for (const name of PAID_ENRICHMENT_ENV_KEYS) assert.equal(paidEnrichmentKey(env, name), undefined);
    assert.equal(paidEnrichmentKey({ ...env, ENABLE_PAID_ENRICHMENT: "true" }, "APOLLO_API_KEY"), "k1");
  });

  test("the registry drops Apollo, Hunter and Clearbit unless enabled", () => {
    const providers = [{ key: "companies_house" }, { key: "apollo" }, { key: "hunter" }, { key: "clearbit" }, { key: "website_contacts" }];
    assert.deepEqual(allowedProviders(providers, false).map((p) => p.key), ["companies_house", "website_contacts"]);
    assert.equal(allowedProviders(providers, true).length, 5);
    assert.deepEqual([...PAID_ENRICHMENT_PROVIDER_KEYS].sort(), ["apollo", "clearbit", "hunter"]);
  });

  test("wired: env.ts and the registry both apply the guard", () => {
    const env = read("src/lib/env.ts");
    assert.match(env, /apolloApiKey: paidEnrichmentKey\(process\.env, "APOLLO_API_KEY"\)/);
    assert.match(env, /hunterApiKey: paidEnrichmentKey\(process\.env, "HUNTER_API_KEY"\)/);
    assert.match(env, /clearbitApiKey: paidEnrichmentKey\(process\.env, "CLEARBIT_API_KEY"\)/);
    assert.doesNotMatch(env, /optional\("(APOLLO|HUNTER|CLEARBIT)_API_KEY"\)/);
    assert.match(read("src/lib/find-leads/server/providers/registry.ts"), /allowedProviders\(REGISTERED, paidEnrichmentEnabled\(process\.env\)\)/);
    assert.match(read(".env.example"), /^ENABLE_PAID_ENRICHMENT=false$/m);
  });

  test("the privacy policy and sub-processor list stay true while it is off", () => {
    assert.equal(paidEnrichmentEnabled({ ENABLE_PAID_ENRICHMENT: undefined }), false);
    assert.match(read("src/app/(marketing)/privacy/page.tsx"), /We do not enrich it from external\s+data brokers\./);
    const names = SUBPROCESSORS.map((s) => s.name.toLowerCase()).join(" | ");
    for (const vendor of ["apollo", "hunter", "clearbit"]) assert.ok(!names.includes(vendor), `${vendor} is not a sub-processor`);
  });
});

describe("VAT readiness (Stripe Tax behind STRIPE_AUTOMATIC_TAX)", () => {
  test("off by default: Checkout params unchanged", () => {
    assert.equal(automaticTaxEnabled({}), false);
    assert.equal(automaticTaxEnabled({ STRIPE_AUTOMATIC_TAX: "true" }), true);
    assert.deepEqual(taxCheckoutParams({ enabled: false, mode: "subscription", hasCustomer: true }), {});
  });

  test("on: automatic tax, VAT number and address, with the customer rule Stripe needs", () => {
    assert.deepEqual(taxCheckoutParams({ enabled: true, mode: "subscription", hasCustomer: true }), {
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
    });
    assert.equal(taxCheckoutParams({ enabled: true, mode: "payment", hasCustomer: false }).customer_creation, "always");
    assert.equal(taxCheckoutParams({ enabled: true, mode: "subscription", hasCustomer: false }).customer_creation, undefined);
  });

  test("the copy only says 'added at checkout' when it is true", () => {
    assert.match(vatCopy(true).faq, /added at checkout/);
    assert.doesNotMatch(vatCopy(false).faq, /added at checkout/);
    assert.match(vatCopy(false).faq, /exclude VAT/);
    const pricing = read("src/app/(marketing)/pricing/page.tsx");
    assert.match(pricing, /vatCopy\(automaticTaxEnabled\(\)\)\.faq/);
    assert.doesNotMatch(pricing, /which is added at checkout where it applies/);
  });

  test("every Checkout ClientTurn builds carries the tax params", () => {
    for (const file of ["src/lib/billing/checkout.ts", "src/lib/billing/token-actions.ts", "src/lib/billing/voice-purchase.ts"]) {
      const source = read(file);
      const creates = (source.match(/checkout\.sessions\.create\(/g) ?? []).length;
      const taxed = (source.match(/taxCheckoutParams\(/g) ?? []).length;
      assert.ok(creates > 0, `${file} creates a session`);
      assert.equal(taxed, creates, `${file}: every session has tax params`);
    }
  });
});

describe("admin MRR uses real Stripe amounts", () => {
  test("stored MRR wins; list price only as the fallback", () => {
    assert.deepEqual(monthlyRevenue({ mrrMinor: 33900, plan: "pro", interval: "month" }), { gbp: 339, source: "stripe_invoice" });
    assert.deepEqual(monthlyRevenue({ mrrMinor: null, plan: "pro", interval: "month" }), { gbp: PLANS.pro.monthlyPrice!, source: "list_price" });
    assert.equal(listMonthlyPrice("growth", "year"), PLANS.growth.yearlyPrice! / 12);
    assert.deepEqual(monthlyRevenue({ mrrMinor: null, plan: "trial", interval: null }), { gbp: 0, source: "none" });
  });

  test("admin billing, customers, overview and economics read it", () => {
    assert.match(read("src/lib/admin/billing.ts"), /monthlyRevenue\(/);
    assert.match(read("src/lib/admin/customers.ts"), /monthlyRevenue\(/);
    assert.match(read("src/lib/admin/overview.ts"), /monthlyRevenue\(/);
    assert.match(read("src/lib/admin/economics-live.ts"), /mrr_minor/);
    assert.match(read("src/app/api/webhooks/stripe/route.ts"), /recordPaidInvoice\(/);
  });
});
