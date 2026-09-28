import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_COGS_GBP_PER_MIN,
  voiceAddonMargin,
  voicePackMargin,
  voiceStripeFeeGbp,
} from "../src/lib/billing/unit-costs.ts";
import { VOICE_ADDON, VOICE_MINUTE_PACKS } from "../src/lib/billing/plans.ts";
import {
  adminVoiceBlocks,
  authorizeAdminVoiceControl,
  gmHealth,
  gmReport,
  margin,
  simulateVoicePackages,
  standingCosts,
  suspiciousUsage,
  voiceMarginAlertFor,
  voiceRevenueLines,
  VOICE_GM_FLOOR,
  type CostRow,
  type UsageWindow,
} from "../src/lib/admin/voice-ops-model.ts";
import { ALL_OPERATIONS as SERVICE_OPERATIONS } from "../src/lib/services/registry.ts";

const quiet: UsageWindow = {
  todayMinutes: 20,
  previousDailyMinutes: [20, 18, 22, 19, 21, 20, 20],
  callsToday: 12,
  shortCallsToday: 1,
  connectedWithDurationToday: 10,
  failedToday: 0,
};

describe("suspicious usage heuristics", () => {
  test("normal usage raises nothing", () => {
    assert.deepEqual(suspiciousUsage(quiet).flags, []);
  });
  test("a spike over 3x the 7-day average is flagged", () => {
    const r = suspiciousUsage({ ...quiet, todayMinutes: 90 });
    assert.deepEqual(r.flags, ["SPIKE"]);
    assert.equal(r.baselineDailyMinutes, 20);
  });
  test("a small absolute spike is not (floor of 30 minutes)", () => {
    assert.deepEqual(suspiciousUsage({ ...quiet, todayMinutes: 25, previousDailyMinutes: [1, 1, 1, 1, 1, 1, 1] }).flags, []);
  });
  test("a new workspace with no baseline is flagged once it passes the floor", () => {
    assert.deepEqual(suspiciousUsage({ ...quiet, todayMinutes: 45, previousDailyMinutes: [] }).flags, ["SPIKE"]);
  });
  test("many very short calls", () => {
    assert.deepEqual(suspiciousUsage({ ...quiet, shortCallsToday: 6, connectedWithDurationToday: 10 }).flags, ["MANY_SHORT_CALLS"]);
    // Too few calls to judge.
    assert.deepEqual(suspiciousUsage({ ...quiet, shortCallsToday: 5, connectedWithDurationToday: 6 }).flags, []);
  });
  test("a high failure rate", () => {
    assert.deepEqual(suspiciousUsage({ ...quiet, failedToday: 4, callsToday: 12 }).flags, ["HIGH_FAILURE_RATE"]);
    assert.deepEqual(suspiciousUsage({ ...quiet, failedToday: 3, callsToday: 12 }).flags, []);
  });
});

describe("GM matches unit-costs.ts", () => {
  test("a pack sold and fully used at base COGS gives voicePackMargin's margin", () => {
    for (const pack of VOICE_MINUTE_PACKS) {
      const { lines } = voiceRevenueLines([
        { business_id: "b1", kind: "PACK_PURCHASE", pack_delta_sec: pack.minutes * 60, included_delta_sec: 0, created_at: "2026-09-02T00:00:00Z" },
      ]);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].stripeFeeGbp, voiceStripeFeeGbp(pack.priceGbp, "one_off"));
      const cost: CostRow = {
        id: "c1",
        business_id: "b1",
        voice_call_id: null,
        provider: "retell",
        metric: "VOICE_AI_MINUTE",
        total_cost: pack.minutes * VOICE_COGS_GBP_PER_MIN.base,
        currency: "GBP",
        reconciles_id: null,
        occurred_at: "2026-09-10T00:00:00Z",
      };
      const report = gmReport({ revenue: lines, costs: [cost], calls: [], usdToGbp: 0.7549 });
      const expected = voicePackMargin(pack, "base").margin;
      assert.ok(Math.abs((report.total.gm ?? 0) - expected) < 0.001, `${pack.key}: ${report.total.gm} vs ${expected}`);
    }
  });

  test("the Pro voice item grant is priced at the add-on and matches voiceAddonMargin without the number", () => {
    const { lines } = voiceRevenueLines([
      { business_id: "b1", kind: "PERIOD_GRANT", pack_delta_sec: 0, included_delta_sec: VOICE_ADDON.includedMinutes * 60, created_at: "2026-09-01T00:00:00Z" },
    ]);
    assert.equal(lines[0].priceGbp, VOICE_ADDON.monthlyPriceGbp);
    const minutesCost = VOICE_ADDON.includedMinutes * VOICE_COGS_GBP_PER_MIN.base;
    const report = gmReport({
      revenue: lines,
      costs: [{ id: "c", business_id: "b1", voice_call_id: null, provider: "retell", metric: "VOICE_AI_MINUTE", total_cost: minutesCost, currency: "GBP", reconciles_id: null, occurred_at: "2026-09-02T00:00:00Z" }],
      calls: [],
      usdToGbp: 0.7549,
    });
    const fullItem = voiceAddonMargin("base");
    // The item's margin includes the number's cost; ours does not (no number cost row), so ours is higher by exactly that.
    assert.ok((report.total.gm ?? 0) > fullItem.margin);
    const fee = voiceStripeFeeGbp(VOICE_ADDON.monthlyPriceGbp, "invoice_line");
    const expected = (VOICE_ADDON.monthlyPriceGbp - minutesCost - fee) / VOICE_ADDON.monthlyPriceGbp;
    assert.ok(Math.abs((report.total.gm ?? 0) - expected) < 0.001);
  });

  test("a negative period grant (unused minutes expiring) is not revenue; unknown pack sizes are not guessed", () => {
    const { lines, unpriced } = voiceRevenueLines([
      { business_id: "b1", kind: "PERIOD_GRANT", pack_delta_sec: 0, included_delta_sec: -600, created_at: "2026-09-01T00:00:00Z" },
      { business_id: "b1", kind: "PACK_PURCHASE", pack_delta_sec: 777 * 60, included_delta_sec: 0, created_at: "2026-09-01T00:00:00Z" },
    ]);
    assert.equal(lines.length, 0);
    assert.equal(unpriced, 1);
  });

  test("a provider figure replaces its estimate (reconciled row dropped)", () => {
    const rows: CostRow[] = [
      { id: "est", business_id: "b1", voice_call_id: "call1", provider: "retell", metric: "VOICE_AI_MINUTE", total_cost: 1, currency: "USD", reconciles_id: null, occurred_at: "2026-09-02T00:00:00Z" },
      { id: "real", business_id: "b1", voice_call_id: "call1", provider: "retell", metric: "VOICE_AI_MINUTE", total_cost: 0.8, currency: "USD", reconciles_id: "est", occurred_at: "2026-09-02T00:01:00Z" },
    ];
    assert.deepEqual(standingCosts(rows).map((r) => r.id), ["real"]);
  });

  test("no revenue means no GM (null), not 0% or 100%", () => {
    assert.equal(margin(0, 5).gm, null);
    assert.equal(gmHealth(null), "NO_REVENUE");
  });

  test("route and country revenue is allocated by billed minutes and marked so", () => {
    const { lines } = voiceRevenueLines([
      { business_id: "b1", kind: "PACK_PURCHASE", pack_delta_sec: 100 * 60, included_delta_sec: 0, created_at: "2026-09-02T00:00:00Z" },
    ]);
    const report = gmReport({
      revenue: lines,
      costs: [],
      calls: [
        { callId: "c1", businessId: "b1", route: "QUALIFICATION", country: "GB", billedSec: 60 * 30 },
        { callId: "c2", businessId: "b1", route: "BOOKING_CLOSE", country: "GB", billedSec: 60 * 10 },
      ],
      usdToGbp: 0.7549,
    });
    const q = report.route.find((r) => r.key === "QUALIFICATION");
    assert.equal(q?.allocated, true);
    assert.ok(Math.abs((q?.revenueGbp ?? 0) - 49 * 0.75) < 0.01);
    assert.ok(Math.abs((report.country.find((r) => r.key === "GB")?.revenueGbp ?? 0) - 49) < 0.01);
  });
});

describe("the below-75% alert", () => {
  const row = (revenue: number, cogs: number) => ({ businessId: "b1", name: "Acme", margin: margin(revenue, cogs) });
  test("raised below the floor, once per workspace per month, in the 0145 alert shape", () => {
    const alert = voiceMarginAlertFor(row(100, 30), "2026-09", new Set());
    assert.ok(alert);
    assert.equal(alert?.severity, "WARNING");
    assert.equal(alert?.metrics.period, "2026-09:voice");
    assert.equal(alert?.metrics.scope, "voice");
    assert.equal(voiceMarginAlertFor(row(100, 30), "2026-09", new Set(["b1:2026-09"])), null);
  });
  test("not raised at or above the floor, or with no revenue", () => {
    assert.equal(voiceMarginAlertFor(row(100, 25), "2026-09", new Set()), null);
    assert.equal(voiceMarginAlertFor(row(0, 25), "2026-09", new Set()), null);
  });
  test("critical under 50%", () => {
    assert.equal(voiceMarginAlertFor(row(100, 60), "2026-09", new Set())?.severity, "CRITICAL");
  });
  test("health bands: green, amber near the floor, red below", () => {
    assert.equal(gmHealth(0.9), "HEALTHY");
    assert.equal(gmHealth(0.77), "WATCH");
    assert.equal(gmHealth(VOICE_GM_FLOOR - 0.001), "BELOW_FLOOR");
  });
});

describe("simulator", () => {
  test("with no change it reproduces unit-costs' stress margins", () => {
    const rows = simulateVoicePackages({ priceMultiplier: 1, cogsMultiplier: 1, numberCostMultiplier: 1, scenario: "stress" });
    for (const pack of VOICE_MINUTE_PACKS) {
      const row = rows.find((r) => r.item === `${pack.minutes} minute pack`);
      assert.ok(Math.abs((row?.gm ?? 0) - voicePackMargin(pack, "stress").margin) < 1e-9);
    }
    const item = rows.find((r) => r.item === "Pro voice item");
    assert.ok(Math.abs((item?.gm ?? 0) - voiceAddonMargin("stress").margin) < 1e-9);
  });
  test("a big provider price rise pushes packs below the floor", () => {
    const rows = simulateVoicePackages({ priceMultiplier: 1, cogsMultiplier: 3, numberCostMultiplier: 1, scenario: "base" });
    assert.ok(rows.every((r) => r.belowFloor));
  });
});

describe("admin op RBAC", () => {
  const ok = { platformRole: "platform_admin", stepUpRemainingMs: 60_000, confirmed: true, reason: "Fraud reported" };
  test("a platform admin with step-up, confirmation and a reason is allowed", () => {
    assert.deepEqual(authorizeAdminVoiceControl(ok), { ok: true });
  });
  test("anyone else is refused, in order", () => {
    assert.deepEqual(authorizeAdminVoiceControl({ ...ok, platformRole: null }), { ok: false, code: "forbidden" });
    assert.deepEqual(authorizeAdminVoiceControl({ ...ok, platformRole: "owner" }), { ok: false, code: "forbidden" });
    assert.deepEqual(authorizeAdminVoiceControl({ ...ok, stepUpRemainingMs: 0 }), { ok: false, code: "step_up_required" });
    assert.deepEqual(authorizeAdminVoiceControl({ ...ok, confirmed: false }), { ok: false, code: "confirmation_required" });
    assert.deepEqual(authorizeAdminVoiceControl({ ...ok, reason: "  " }), { ok: false, code: "reason_required" });
  });
  test("the admin voice operations are reachable by SYSTEM only (never a workspace user, API key, MCP, Copilot or agent)", () => {
    const ops = SERVICE_OPERATIONS.filter((op) => op.name.startsWith("admin_voice."));
    assert.deepEqual(ops.map((op) => op.name).sort(), ["admin_voice.pause_outbound", "admin_voice.set_spend_limit", "admin_voice.suspend_number"]);
    for (const op of ops) assert.deepEqual([...(op.callers ?? [])], ["SYSTEM"], op.name);
    const kill = SERVICE_OPERATIONS.find((op) => op.name === "voice.admin_disable_workspace");
    assert.deepEqual([...(kill?.callers ?? [])], ["SYSTEM"]);
  });
  test("experiment promotion is a person's decision: never Copilot or an agent", () => {
    for (const name of ["experiment.promote", "experiment.rollback", "experiment.set_auto_promote"]) {
      const op = SERVICE_OPERATIONS.find((o) => o.name === name);
      assert.ok(op, name);
      assert.equal(op?.minimumRole, "admin");
      assert.ok(!(op?.callers ?? []).includes("COPILOT" as never));
      assert.ok(!(op?.callers ?? []).includes("AGENT" as never));
    }
  });
});

describe("runtime blocks", () => {
  const base = { direction: "OUTBOUND" as const, killSwitch: false, outboundPaused: false, numberSuspended: false, spendLimitGbpMonth: null, spentGbpThisMonth: 0 };
  test("each control blocks what it should", () => {
    assert.deepEqual(adminVoiceBlocks(base), []);
    assert.deepEqual(adminVoiceBlocks({ ...base, killSwitch: true }), ["ADMIN_KILL_SWITCH"]);
    assert.deepEqual(adminVoiceBlocks({ ...base, outboundPaused: true }), ["ADMIN_OUTBOUND_PAUSED"]);
    assert.deepEqual(adminVoiceBlocks({ ...base, direction: "INBOUND", outboundPaused: true }), []);
    assert.deepEqual(adminVoiceBlocks({ ...base, numberSuspended: true, direction: "INBOUND" }), ["ADMIN_NUMBER_SUSPENDED"]);
    assert.deepEqual(adminVoiceBlocks({ ...base, spendLimitGbpMonth: 50, spentGbpThisMonth: 50 }), ["ADMIN_SPEND_LIMIT_REACHED"]);
    assert.deepEqual(adminVoiceBlocks({ ...base, spendLimitGbpMonth: 50, spentGbpThisMonth: 49.99 }), []);
  });
});
