/**
 * Admin voice operations and voice gross-margin monitoring (brief §58-59). Pure.
 *
 * Everything the admin Voice ops view computes from rows lives here, tested by
 * tests/voice-ops-model.test.ts:
 *   * suspicious-usage heuristics;
 *   * voice revenue from the minute ledger (only rows that record a sale);
 *   * GM by workspace, package, provider, country, route and month;
 *   * the below-75% alert rule, in the economics_alerts shape (0145 pattern);
 *   * the price / provider-change simulator;
 *   * the authorisation rule for the emergency controls.
 *
 * GM uses unit-costs.ts, never a second copy of it: Stripe fees come from
 * `voiceStripeFeeGbp`, and the per-minute COGS assumption from
 * `VOICE_COGS_GBP_PER_MIN`, so a pack sold and fully used at base COGS gives
 * exactly `voicePackMargin(pack, "base").margin`.
 */

import { VOICE_ADDON, VOICE_MINUTE_PACKS } from "../billing/plans.ts";
import {
  VOICE_COGS_GBP_PER_MIN,
  VOICE_NUMBER_COST_GBP_MONTH,
  voiceStripeFeeGbp,
  type VoiceChargeMode,
} from "../billing/unit-costs.ts";

/** The voice gross-margin floor (task brief; the platform-wide margin alert uses the same 75%). */
export const VOICE_GM_FLOOR = 0.75;

/* ======================================================== suspicious usage */

export const SUSPICION_THRESHOLDS = {
  /** Today's minutes above this multiple of the 7-day daily average. */
  spikeMultiple: 3,
  /** ...and above this many minutes, so a quiet workspace's 2 -> 7 is not a spike. */
  spikeFloorMinutes: 30,
  /** A connected call shorter than this is "short". */
  shortCallSec: 15,
  /** Share of short calls that is suspicious... */
  shortShare: 0.5,
  /** Share of failed calls that is suspicious... */
  failureShare: 0.3,
  /** ...once at least this many calls have been made. */
  minCalls: 10,
} as const;

export type SuspicionFlag = "SPIKE" | "MANY_SHORT_CALLS" | "HIGH_FAILURE_RATE";

export const SUSPICION_LABEL: Record<SuspicionFlag, string> = {
  SPIKE: "Minutes spike vs 7-day baseline",
  MANY_SHORT_CALLS: "Many very short calls",
  HIGH_FAILURE_RATE: "High failure rate",
};

export type UsageWindow = {
  /** Billed minutes today. */
  todayMinutes: number;
  /** Billed minutes on each of the previous 7 days (missing days = 0). */
  previousDailyMinutes: readonly number[];
  /** Calls attempted today (outcome set, not cancelled). */
  callsToday: number;
  /** Of those, connected calls with an ACTUAL duration under shortCallSec. */
  shortCallsToday: number;
  /** Connected calls today with a recorded duration. */
  connectedWithDurationToday: number;
  /** Calls today whose outcome is FAILED. */
  failedToday: number;
};

export type SuspicionResult = {
  flags: SuspicionFlag[];
  baselineDailyMinutes: number;
  detail: string[];
};

export function suspiciousUsage(window: UsageWindow, t = SUSPICION_THRESHOLDS): SuspicionResult {
  const days = window.previousDailyMinutes.slice(0, 7);
  const baseline = days.length ? days.reduce((s, v) => s + Math.max(0, v), 0) / 7 : 0;
  const flags: SuspicionFlag[] = [];
  const detail: string[] = [];

  if (window.todayMinutes >= t.spikeFloorMinutes && window.todayMinutes > t.spikeMultiple * baseline) {
    flags.push("SPIKE");
    detail.push(
      `${Math.round(window.todayMinutes)} min today vs a ${Math.round(baseline * 10) / 10} min/day 7-day average` +
        (baseline > 0 ? ` (${Math.round((window.todayMinutes / baseline) * 10) / 10}x).` : " (no baseline)."),
    );
  }
  if (window.connectedWithDurationToday >= t.minCalls && window.shortCallsToday / window.connectedWithDurationToday >= t.shortShare) {
    flags.push("MANY_SHORT_CALLS");
    detail.push(`${window.shortCallsToday} of ${window.connectedWithDurationToday} connected calls under ${t.shortCallSec}s.`);
  }
  if (window.callsToday >= t.minCalls && window.failedToday / window.callsToday >= t.failureShare) {
    flags.push("HIGH_FAILURE_RATE");
    detail.push(`${window.failedToday} of ${window.callsToday} calls failed today.`);
  }
  return { flags, baselineDailyMinutes: Math.round(baseline * 100) / 100, detail };
}

/* ============================================================ voice revenue */

export type LedgerSaleRow = {
  business_id: string;
  kind: string;
  pack_delta_sec: number;
  included_delta_sec: number;
  created_at: string;
};

export type RevenueLine = {
  businessId: string;
  month: string;
  /** "voice_100"... for packs, "pro_voice_item" for the included-minutes item. */
  packageKey: string;
  priceGbp: number;
  mode: VoiceChargeMode;
  stripeFeeGbp: number;
  /** Refunds are negative lines. */
  sign: 1 | -1;
};

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Revenue lines from the minute ledger. Only rows that record a sale count:
 *   PACK_PURCHASE  -> the pack price for that many minutes (VOICE_MINUTE_PACKS);
 *   PACK_REFUND    -> the same, negative;
 *   PERIOD_GRANT   -> one Pro voice item month (VOICE_ADDON price), and only
 *                     when the grant SETS the allowance (a positive delta; the
 *                     item's first grant of a period).
 * A pack of an unknown size is reported in `unpriced`, never guessed.
 */
export function voiceRevenueLines(rows: readonly LedgerSaleRow[]): { lines: RevenueLine[]; unpriced: number } {
  const lines: RevenueLine[] = [];
  let unpriced = 0;
  for (const row of rows) {
    if (row.kind === "PACK_PURCHASE" || row.kind === "PACK_REFUND") {
      const minutes = Math.round(Math.abs(row.pack_delta_sec) / 60);
      const pack = VOICE_MINUTE_PACKS.find((p) => p.minutes === minutes);
      if (!pack) {
        unpriced += 1;
        continue;
      }
      lines.push({
        businessId: row.business_id,
        month: monthOf(row.created_at),
        packageKey: pack.key,
        priceGbp: pack.priceGbp,
        mode: "one_off",
        stripeFeeGbp: voiceStripeFeeGbp(pack.priceGbp, "one_off"),
        sign: row.kind === "PACK_REFUND" ? -1 : 1,
      });
    } else if (row.kind === "PERIOD_GRANT" && row.included_delta_sec > 0) {
      lines.push({
        businessId: row.business_id,
        month: monthOf(row.created_at),
        packageKey: "pro_voice_item",
        priceGbp: VOICE_ADDON.monthlyPriceGbp,
        mode: "invoice_line",
        stripeFeeGbp: voiceStripeFeeGbp(VOICE_ADDON.monthlyPriceGbp, "invoice_line"),
        sign: 1,
      });
    }
  }
  return { lines, unpriced };
}

/* ================================================================ COGS */

export type CostRow = {
  id: string;
  business_id: string | null;
  voice_call_id: string | null;
  provider: string;
  metric: string;
  total_cost: number | string;
  currency: string;
  reconciles_id: string | null;
  occurred_at: string;
};

/**
 * Cost ledger rows that stand: a row that a later row reconciles (corrects)
 * is dropped, so an estimate followed by the provider's own figure counts
 * once, at the provider figure.
 */
export function standingCosts(rows: readonly CostRow[]): CostRow[] {
  const superseded = new Set(rows.map((r) => r.reconciles_id).filter((id): id is string => Boolean(id)));
  return rows.filter((r) => !superseded.has(r.id));
}

export function costGbp(row: Pick<CostRow, "total_cost" | "currency">, usdToGbp: number): number {
  const amount = Number(row.total_cost);
  if (!Number.isFinite(amount)) return 0;
  return row.currency === "GBP" ? amount : row.currency === "USD" ? amount * usdToGbp : amount * usdToGbp;
}

/* ================================================================== GM */

export type Margin = {
  revenueGbp: number;
  /** Provider COGS plus payment fees. */
  cogsGbp: number;
  grossProfitGbp: number;
  /** Null when there is no revenue: a margin of nothing is not 0% or 100%. */
  gm: number | null;
};

export function margin(revenueGbp: number, cogsGbp: number): Margin {
  const r = round2(revenueGbp);
  const c = round2(cogsGbp);
  return { revenueGbp: r, cogsGbp: c, grossProfitGbp: round2(r - c), gm: r > 0 ? (r - c) / r : null };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CallDimension = {
  callId: string;
  businessId: string;
  route: string;
  /** Country code derived from the destination class, "GB" for UK classes. */
  country: string;
  billedSec: number;
};

export type GmDimension = "workspace" | "package" | "provider" | "country" | "route" | "month";

export type GmRow = Margin & {
  key: string;
  /** Billed minutes behind this row, where it is minute-based. */
  minutes: number | null;
  /** True when revenue was allocated by minute share rather than recorded against the key. */
  allocated: boolean;
};

export type GmReport = Record<GmDimension, GmRow[]> & {
  total: Margin;
  unpricedLedgerRows: number;
  /** Rows whose GM is below the floor (by workspace), for the alert. */
  belowFloor: GmRow[];
};

/**
 * GM across every dimension. Revenue is recorded by workspace, package and
 * month; provider, country and route have no revenue of their own, so a
 * workspace's revenue is allocated to them by billed-minute share (and the
 * row says `allocated: true`). Payment fees are part of COGS on the revenue
 * side (workspace / package / month).
 */
export function gmReport(input: {
  revenue: readonly RevenueLine[];
  costs: readonly CostRow[];
  calls: readonly CallDimension[];
  usdToGbp: number;
  unpricedLedgerRows?: number;
  names?: Readonly<Record<string, string>>;
}): GmReport {
  const costs = standingCosts(input.costs);
  const callById = new Map(input.calls.map((c) => [c.callId, c]));

  const bucket = () => new Map<string, { revenue: number; cogs: number; minutes: number; allocated: boolean }>();
  const dims: Record<GmDimension, ReturnType<typeof bucket>> = {
    workspace: bucket(),
    package: bucket(),
    provider: bucket(),
    country: bucket(),
    route: bucket(),
    month: bucket(),
  };
  const add = (dim: GmDimension, key: string, revenue: number, cogs: number, minutes = 0, allocated = false) => {
    const entry = dims[dim].get(key) ?? { revenue: 0, cogs: 0, minutes: 0, allocated: false };
    entry.revenue += revenue;
    entry.cogs += cogs;
    entry.minutes += minutes;
    entry.allocated ||= allocated;
    dims[dim].set(key, entry);
  };

  const revenueByWorkspace = new Map<string, number>();
  for (const line of input.revenue) {
    const revenue = line.sign * line.priceGbp;
    const fee = line.sign * line.stripeFeeGbp;
    add("workspace", line.businessId, revenue, fee);
    add("package", line.packageKey, revenue, fee);
    add("month", line.month, revenue, fee);
    revenueByWorkspace.set(line.businessId, (revenueByWorkspace.get(line.businessId) ?? 0) + revenue);
  }

  // Billed minutes per workspace, for the allocation.
  const minutesByWorkspace = new Map<string, number>();
  for (const call of input.calls) {
    minutesByWorkspace.set(call.businessId, (minutesByWorkspace.get(call.businessId) ?? 0) + call.billedSec / 60);
  }
  for (const call of input.calls) {
    const total = minutesByWorkspace.get(call.businessId) ?? 0;
    const share = total > 0 ? call.billedSec / 60 / total : 0;
    const allocatedRevenue = (revenueByWorkspace.get(call.businessId) ?? 0) * share;
    add("route", call.route, allocatedRevenue, 0, call.billedSec / 60, true);
    add("country", call.country, allocatedRevenue, 0, call.billedSec / 60, true);
  }

  let totalCost = 0;
  for (const row of costs) {
    const gbp = costGbp(row, input.usdToGbp);
    totalCost += gbp;
    const workspace = row.business_id ?? "platform";
    add("workspace", workspace, 0, gbp);
    add("month", monthOf(row.occurred_at), 0, gbp);
    add("provider", row.provider, 0, gbp);
    // Package COGS: a number's monthly cost belongs to the number item;
    // minute costs are the minutes' (reported under "minutes").
    add("package", row.metric === "NUMBER_MONTHLY" ? "number_item" : "minutes (all packages)", 0, gbp);
    const call = row.voice_call_id ? callById.get(row.voice_call_id) : undefined;
    if (call) {
      add("route", call.route, 0, gbp);
      add("country", call.country, 0, gbp);
    }
  }

  const rows = (dim: GmDimension): GmRow[] =>
    [...dims[dim].entries()]
      .map(([key, v]) => ({
        key: dim === "workspace" ? (input.names?.[key] ?? key) : key,
        ...margin(v.revenue, v.cogs),
        minutes: v.minutes > 0 ? Math.round(v.minutes * 10) / 10 : null,
        allocated: v.allocated,
      }))
      .sort((a, b) => b.revenueGbp - a.revenueGbp || b.cogsGbp - a.cogsGbp || a.key.localeCompare(b.key));

  const totalRevenue = input.revenue.reduce((s, l) => s + l.sign * l.priceGbp, 0);
  const totalFees = input.revenue.reduce((s, l) => s + l.sign * l.stripeFeeGbp, 0);
  const workspaceRows = rows("workspace");
  return {
    workspace: workspaceRows,
    package: rows("package"),
    provider: rows("provider"),
    country: rows("country"),
    route: rows("route"),
    month: rows("month"),
    total: margin(totalRevenue, totalCost + totalFees),
    unpricedLedgerRows: input.unpricedLedgerRows ?? 0,
    belowFloor: workspaceRows.filter((r) => r.gm !== null && r.gm < VOICE_GM_FLOOR),
  };
}

/** Destination class (destinations.ts) -> ISO country for the country dimension. */
export function countryOfDestination(destinationClass: string | null): string {
  if (!destinationClass) return "Unknown";
  // Every class except NON_UK is a UK number range (destinations.ts).
  if (destinationClass === "NON_UK") return "Outside UK";
  return "GB";
}

export type GmHealth = "HEALTHY" | "WATCH" | "BELOW_FLOOR" | "NO_REVENUE";

/** Green at 80%+, amber between the floor and 80%, red below the 75% floor. */
export function gmHealth(gm: number | null): GmHealth {
  if (gm === null) return "NO_REVENUE";
  if (gm < VOICE_GM_FLOOR) return "BELOW_FLOOR";
  if (gm < VOICE_GM_FLOOR + 0.05) return "WATCH";
  return "HEALTHY";
}

/* ============================================================== the alert */

export type VoiceMarginAlert = {
  businessId: string;
  severity: "WARNING" | "CRITICAL";
  title: string;
  detail: string;
  metrics: { period: string; scope: "voice"; gm: number; revenue_gbp: number; cogs_gbp: number; floor: number };
};

/**
 * The economics_alerts row for a workspace whose voice GM is below the floor
 * this month, or null. Same table, alert type (MARGIN_BELOW_THRESHOLD) and
 * once-per-month rule as the platform margin alert (economics-alerts.ts /
 * 0145), so it shows in the admin bell and on Admin -> Economics with no
 * schema change. Its period key is `YYYY-MM:voice`, so the 0145 unique index
 * (business, type, period) keeps it apart from the whole-plan alert. The
 * caller passes the keys it already raised (`${businessId}:${month}`).
 */
export function voiceMarginAlertFor(
  row: { businessId: string; name: string; margin: Margin },
  month: string,
  alreadyRaised: ReadonlySet<string>,
): VoiceMarginAlert | null {
  const gm = row.margin.gm;
  if (gm === null || gm >= VOICE_GM_FLOOR) return null;
  if (alreadyRaised.has(`${row.businessId}:${month}`)) return null;
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  return {
    businessId: row.businessId,
    severity: gm < 0.5 ? "CRITICAL" : "WARNING",
    title: `Voice margin ${pct(gm)} for ${row.name}`,
    detail: `Voice gross margin this month is ${pct(gm)}, below the ${pct(VOICE_GM_FLOOR)} floor: revenue £${row.margin.revenueGbp.toFixed(2)}, cost £${row.margin.cogsGbp.toFixed(2)}.`,
    metrics: {
      period: `${month}:voice`,
      scope: "voice",
      gm,
      revenue_gbp: row.margin.revenueGbp,
      cogs_gbp: row.margin.cogsGbp,
      floor: VOICE_GM_FLOOR,
    },
  };
}

/* ============================================================ simulator */

export type SimulatorInput = {
  /** Multiplier on every voice price (1 = unchanged, 1.1 = +10%). */
  priceMultiplier: number;
  /** Multiplier on per-minute COGS (a provider change: 0.8 = 20% cheaper). */
  cogsMultiplier: number;
  /** Multiplier on the number's monthly cost. */
  numberCostMultiplier: number;
  scenario: "base" | "stress";
};

export type SimulatedRow = {
  item: string;
  priceGbp: number;
  cogsGbp: number;
  feeGbp: number;
  gm: number;
  belowFloor: boolean;
};

/** Every package at the simulated prices and costs, worst case (every minute used). */
export function simulateVoicePackages(input: SimulatorInput): SimulatedRow[] {
  const perMin = VOICE_COGS_GBP_PER_MIN[input.scenario] * input.cogsMultiplier;
  const numberCost = VOICE_NUMBER_COST_GBP_MONTH[input.scenario] * input.numberCostMultiplier;
  const row = (item: string, price: number, cogs: number, mode: VoiceChargeMode): SimulatedRow => {
    const fee = voiceStripeFeeGbp(price, mode);
    const gm = price > 0 ? (price - cogs - fee) / price : 0;
    return { item, priceGbp: round2(price), cogsGbp: round2(cogs), feeGbp: round2(fee), gm, belowFloor: gm < VOICE_GM_FLOOR };
  };
  return [
    ...VOICE_MINUTE_PACKS.map((pack) =>
      row(`${pack.minutes} minute pack`, pack.priceGbp * input.priceMultiplier, pack.minutes * perMin, "one_off"),
    ),
    row(
      "Pro voice item",
      VOICE_ADDON.monthlyPriceGbp * input.priceMultiplier,
      VOICE_ADDON.includedMinutes * perMin + (VOICE_ADDON.includesNumber ? numberCost : 0),
      "invoice_line",
    ),
  ];
}

/* ============================================================ admin RBAC */

export type AdminControlCheck = {
  /** profiles.platform_role, read server-side from the database. */
  platformRole: string | null;
  stepUpRemainingMs: number;
  confirmed: boolean;
  reason: string;
};

export type AdminControlVerdict =
  | { ok: true }
  | { ok: false; code: "forbidden" | "step_up_required" | "confirmation_required" | "reason_required" };

/**
 * The emergency controls' authorisation, in the order the admin shell applies
 * it: platform admin (database role only), step-up in the last 30 minutes, an
 * explicit confirmation, and a reason for the audit row.
 */
export function authorizeAdminVoiceControl(check: AdminControlCheck): AdminControlVerdict {
  if (check.platformRole !== "platform_admin") return { ok: false, code: "forbidden" };
  if (!(check.stepUpRemainingMs > 0)) return { ok: false, code: "step_up_required" };
  if (!check.confirmed) return { ok: false, code: "confirmation_required" };
  if (check.reason.trim().length < 4) return { ok: false, code: "reason_required" };
  return { ok: true };
}

/* ======================================================= runtime blocks */

export type AdminVoiceBlockReason = "ADMIN_KILL_SWITCH" | "ADMIN_OUTBOUND_PAUSED" | "ADMIN_NUMBER_SUSPENDED" | "ADMIN_SPEND_LIMIT_REACHED";

/**
 * What the platform operator's controls forbid for one call. The voice
 * runtime (voice-P2: eligibility / dial) should call this right before
 * dialling, beside its own checks: 0150's kill switch is already honoured
 * there; the 0158 controls (outbound pause, number suspension, spend limit)
 * take effect for dialling once the runtime reads them through this.
 */
export function adminVoiceBlocks(input: {
  direction: "OUTBOUND" | "INBOUND";
  killSwitch: boolean;
  outboundPaused: boolean;
  numberSuspended: boolean;
  spendLimitGbpMonth: number | null;
  spentGbpThisMonth: number;
}): AdminVoiceBlockReason[] {
  const reasons: AdminVoiceBlockReason[] = [];
  if (input.killSwitch) reasons.push("ADMIN_KILL_SWITCH");
  if (input.direction === "OUTBOUND" && input.outboundPaused) reasons.push("ADMIN_OUTBOUND_PAUSED");
  if (input.numberSuspended) reasons.push("ADMIN_NUMBER_SUSPENDED");
  if (input.direction === "OUTBOUND" && input.spendLimitGbpMonth !== null && input.spentGbpThisMonth >= input.spendLimitGbpMonth) {
    reasons.push("ADMIN_SPEND_LIMIT_REACHED");
  }
  return reasons;
}
