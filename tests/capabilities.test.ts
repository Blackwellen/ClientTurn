import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  CAPABILITIES,
  CAPABILITY_DEFAULTS,
  CAPABILITY_PLANS,
  quotesIncludedOnPlan,
  resolveCapability,
  unlockingPlanFor,
} from "../src/lib/billing/capability-rules.ts";
import { QUOTES_ON_PLAN } from "../src/lib/marketing/voice-offer.ts";

/**
 * `can(business, capability)` (billing/capabilities.ts) resolves through
 * `resolveCapability`: plan row (or the documented default), plus grants that
 * only raise, all denied on an inactive subscription. The defaults, the 0156
 * rows and the public site must agree.
 */

const NOW = new Date("2026-09-27T12:00:00Z");
const base = { plan: "growth", active: true, planRows: [], grants: [], now: NOW };

describe("resolveCapability", () => {
  test("falls back to the plan default when there is no row", () => {
    const decision = resolveCapability("quote_approval_enabled", base);
    assert.equal(decision.allowed, true);
    assert.equal(decision.source, "default");
  });

  test("a plan row wins over the default", () => {
    const decision = resolveCapability("esign_enabled", { ...base, planRows: [{ metric: "esign_enabled", hard_limit: 0 }] });
    assert.equal(decision.allowed, false);
    assert.equal(decision.source, "plan");
    assert.equal(decision.reason, "NOT_IN_PLAN");
  });

  test("a live grant raises; an expired or revoked one does not", () => {
    const grant = { entitlement_key: "white_label_public_pages", numeric_value: null, boolean_value: true, expires_at: null, revoked_at: null };
    assert.equal(resolveCapability("white_label_public_pages", { ...base, grants: [grant] }).allowed, true);
    assert.equal(resolveCapability("white_label_public_pages", { ...base, grants: [{ ...grant, expires_at: "2026-09-01T00:00:00Z" }] }).allowed, false);
    assert.equal(resolveCapability("white_label_public_pages", { ...base, grants: [{ ...grant, revoked_at: "2026-09-02T00:00:00Z" }] }).allowed, false);
  });

  test("a grant never lowers a value", () => {
    const decision = resolveCapability("quote_builder_enabled", {
      ...base,
      grants: [{ entitlement_key: "quote_builder_enabled", numeric_value: 0, boolean_value: null, expires_at: null, revoked_at: null }],
    });
    assert.equal(decision.allowed, true);
  });

  test("numeric capabilities carry their allowance", () => {
    const decision = resolveCapability("voice_minutes_included", {
      ...base,
      plan: "pro",
      grants: [{ entitlement_key: "voice_minutes_included", numeric_value: "200", boolean_value: null, expires_at: null, revoked_at: null }],
    });
    assert.equal(decision.value, 200);
    assert.equal(decision.source, "grant");
  });

  test("an inactive subscription allows nothing", () => {
    const decision = resolveCapability("quote_builder_enabled", { ...base, active: false });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "SUBSCRIPTION_INACTIVE");
  });

  test("an unknown plan denies rather than grants", () => {
    assert.equal(resolveCapability("quote_builder_enabled", { ...base, plan: "legacy" }).allowed, false);
  });

  test("a locked capability names the plan that unlocks it", () => {
    const decision = resolveCapability("quote_approval_enabled", { ...base, plan: "starter" });
    assert.equal(decision.unlockingPlan, "growth");
    assert.match(decision.message ?? "", /Growth/);
    assert.equal(unlockingPlanFor("white_label_public_pages"), null, "grant-only: an add-on, no plan");
  });
});

describe("the plan defaults (owner decision 2026-09-27)", () => {
  test("quotes, e-signature and invoicing: every paid plan, not the trial", () => {
    for (const cap of ["quote_builder_enabled", "esign_enabled", "invoicing_enabled"] as const) {
      assert.equal(CAPABILITY_DEFAULTS.trial[cap], 0, `${cap} trial`);
      for (const plan of ["starter", "growth", "pro", "enterprise"] as const) assert.equal(CAPABILITY_DEFAULTS[plan][cap], 1, `${cap} ${plan}`);
    }
  });

  test("approvals on plans with more than one user (growth+)", () => {
    assert.equal(CAPABILITY_DEFAULTS.starter.quote_approval_enabled, 0);
    for (const plan of ["growth", "pro", "enterprise"] as const) assert.equal(CAPABILITY_DEFAULTS[plan].quote_approval_enabled, 1);
  });

  test("white-label is off everywhere and voice is never granted by a plan", () => {
    for (const plan of CAPABILITY_PLANS) {
      assert.equal(CAPABILITY_DEFAULTS[plan].white_label_public_pages, 0);
      assert.equal(CAPABILITY_DEFAULTS[plan].voice_sales_enabled, 0);
      assert.equal(CAPABILITY_DEFAULTS[plan].voice_minutes_included, 0);
    }
  });

  test("the marketing site reads the same defaults", () => {
    for (const plan of ["starter", "growth", "pro", "enterprise"] as const) {
      assert.equal(QUOTES_ON_PLAN[plan], quotesIncludedOnPlan(plan), plan);
      assert.equal(QUOTES_ON_PLAN[plan], true);
    }
  });

  test("migration rows (0151 voice, 0156 quote) equal the code defaults", () => {
    const sql = readdirSync("supabase/migrations")
      .filter((f) => /^015[16]_/.test(f))
      .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
      .join("\n");
    const rows = [...sql.matchAll(/\('(trial|starter|growth|pro|enterprise)',\s*'([a-z_]+)',\s*([0-9.]+),\s*([0-9.]+)/g)];
    const seen = new Set<string>();
    for (const [, plan, metric, , hard] of rows) {
      if (!(CAPABILITIES as readonly string[]).includes(metric)) continue;
      seen.add(`${plan}:${metric}`);
      assert.equal(Number(hard), CAPABILITY_DEFAULTS[plan as keyof typeof CAPABILITY_DEFAULTS][metric as keyof (typeof CAPABILITY_DEFAULTS)["trial"]], `${plan} ${metric}`);
    }
    for (const plan of CAPABILITY_PLANS) for (const cap of CAPABILITIES) assert.ok(seen.has(`${plan}:${cap}`), `no migration row for ${plan} ${cap}`);
  });
});
