/**
 * Capability entitlements: the pure rules behind `can(business, capability)`
 * (gap map §60). Pure: no `server-only`, no I/O, so the plan defaults, the
 * migration rows and the resolver are asserted in tests without a database.
 * The server read lives in the sibling `capabilities.ts`.
 *
 * One enforcement path: a capability is a `plan_entitlements` row
 * (unit 'boolean' is 1/0, a numeric capability is its allowance) plus any live
 * `business_entitlement_grants` row for the workspace. A grant only ever
 * raises a value, exactly as in `v4-entitlements.ts`. No caller checks a plan
 * NAME for these capabilities; that is what this module replaces.
 *
 * ## Plan defaults (owner decision 2026-09-27, matching the public site)
 *
 * The same table is in docs/revenue-engine/14-quote-to-cash-capabilities.md
 * and migration 0156 writes it as rows; `tests/capabilities.test.ts` holds all
 * three together, and `marketing/voice-offer.ts` QUOTES_ON_PLAN reads it.
 *
 *   quote_builder_enabled     every paid plan ON, trial OFF.
 *   esign_enabled             every paid plan ON, trial OFF.
 *   invoicing_enabled         every paid plan ON, trial OFF.
 *                             Why: a quote has almost no marginal cost to us
 *                             (a PDF, a few rows and one stored object), and
 *                             quoting, signing and invoicing are what turn a
 *                             qualified lead into revenue. It is a
 *                             differentiator on every plan, not an upsell. The
 *                             trial is off because a public, signable quote in
 *                             a workspace that has not paid is an abuse vector
 *                             (branded documents sent from an unverified
 *                             account) for no evaluation benefit.
 *   quote_approval_enabled    growth+ ON (plans with more than one user). An
 *                             approval chain needs a second person to approve.
 *   quote_ai_enabled          every paid plan ON at the plan level; it also
 *                             follows the existing AI-assistant entitlement
 *                             (`aiAssistAllowed`, applied in capabilities.ts)
 *                             and the workspace's own AI toggle (checked by the
 *                             agent runtime before it calls a quote tool).
 *   direct_close_enabled      trial and every paid plan ON. Direct close (0125)
 *                             is already available to every workspace; the key
 *                             exists so later gates go through `can()`, and
 *                             turning it on here changes nothing that exists.
 *   voice_sales_enabled       0 on every plan (0151): granted by the voice item
 *   voice_minutes_included    or a minute pack, never by the plan (OD-2).
 *   white_label_public_pages  OFF everywhere. "White label": OD-1's
 *                             "Powered by ClientTurn" badge on the public
 *                             pages AND (owner decision 2026-09-28) the call's
 *                             closing attribution line stay unless a grant row
 *                             adds this (a future paid add-on). The key keeps
 *                             its original name so stored grants still match.
 */

export const CAPABILITIES = [
  "quote_builder_enabled",
  "quote_ai_enabled",
  "quote_approval_enabled",
  "esign_enabled",
  "invoicing_enabled",
  "direct_close_enabled",
  "voice_sales_enabled",
  "voice_minutes_included",
  "white_label_public_pages",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Capabilities whose value is an allowance rather than an on/off switch. */
export const NUMERIC_CAPABILITIES: readonly Capability[] = ["voice_minutes_included"];

export const CAPABILITY_PLANS = ["trial", "starter", "growth", "pro", "enterprise"] as const;
export type CapabilityPlan = (typeof CAPABILITY_PLANS)[number];

/** The paid plans in upgrade order, for "which plan unlocks this". */
const UPGRADE_ORDER: readonly CapabilityPlan[] = ["starter", "growth", "pro", "enterprise"];

export const CAPABILITY_LABEL: Readonly<Record<Capability, string>> = {
  quote_builder_enabled: "Quotes",
  quote_ai_enabled: "AI quote drafting",
  quote_approval_enabled: "Quote approvals",
  esign_enabled: "E-signatures",
  invoicing_enabled: "Invoicing",
  direct_close_enabled: "Direct close",
  voice_sales_enabled: "Voice sales agent",
  voice_minutes_included: "Included voice minutes",
  white_label_public_pages: "White label (public pages and call attribution)",
};

/**
 * The plan default of every capability. Migration 0156 writes these as
 * `plan_entitlements` rows; while a row is absent (before the migration is
 * applied) the resolver falls back to this value, so the two must agree
 * (asserted by tests/capabilities.test.ts).
 */
export const CAPABILITY_DEFAULTS: Readonly<Record<CapabilityPlan, Readonly<Record<Capability, number>>>> = {
  trial: {
    quote_builder_enabled: 0,
    quote_ai_enabled: 0,
    quote_approval_enabled: 0,
    esign_enabled: 0,
    invoicing_enabled: 0,
    direct_close_enabled: 1,
    voice_sales_enabled: 0,
    voice_minutes_included: 0,
    white_label_public_pages: 0,
  },
  starter: {
    quote_builder_enabled: 1,
    quote_ai_enabled: 1,
    quote_approval_enabled: 0,
    esign_enabled: 1,
    invoicing_enabled: 1,
    direct_close_enabled: 1,
    voice_sales_enabled: 0,
    voice_minutes_included: 0,
    white_label_public_pages: 0,
  },
  growth: {
    quote_builder_enabled: 1,
    quote_ai_enabled: 1,
    quote_approval_enabled: 1,
    esign_enabled: 1,
    invoicing_enabled: 1,
    direct_close_enabled: 1,
    voice_sales_enabled: 0,
    voice_minutes_included: 0,
    white_label_public_pages: 0,
  },
  pro: {
    quote_builder_enabled: 1,
    quote_ai_enabled: 1,
    quote_approval_enabled: 1,
    esign_enabled: 1,
    invoicing_enabled: 1,
    direct_close_enabled: 1,
    voice_sales_enabled: 0,
    voice_minutes_included: 0,
    white_label_public_pages: 0,
  },
  enterprise: {
    quote_builder_enabled: 1,
    quote_ai_enabled: 1,
    quote_approval_enabled: 1,
    esign_enabled: 1,
    invoicing_enabled: 1,
    direct_close_enabled: 1,
    voice_sales_enabled: 0,
    voice_minutes_included: 0,
    white_label_public_pages: 0,
  },
};

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

export type PlanCapabilityRow = { metric: string; hard_limit: number | string | null };

export type CapabilityGrantRow = {
  entitlement_key: string;
  numeric_value: number | string | null;
  boolean_value: boolean | null;
  expires_at: string | null;
  revoked_at: string | null;
};

export type CapabilityDenial = "SUBSCRIPTION_INACTIVE" | "NOT_IN_PLAN";

export type CapabilityDecision = {
  capability: Capability;
  allowed: boolean;
  /** 1/0 for a switch; the allowance for a numeric capability. */
  value: number;
  /** Where the value came from. */
  source: "plan" | "grant" | "default";
  reason: CapabilityDenial | null;
  /** The cheapest paid plan whose default turns it on; null when none does (grant-only). */
  unlockingPlan: CapabilityPlan | null;
  /** A sentence a person can act on when it is locked. */
  message: string | null;
};

export function unlockingPlanFor(capability: Capability): CapabilityPlan | null {
  return UPGRADE_ORDER.find((plan) => CAPABILITY_DEFAULTS[plan][capability] > 0) ?? null;
}

function planDefault(plan: string, capability: Capability): number {
  return (CAPABILITY_DEFAULTS as Record<string, Record<Capability, number>>)[plan]?.[capability] ?? 0;
}

const PLAN_LABEL: Record<CapabilityPlan, string> = {
  trial: "Trial",
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
  enterprise: "Enterprise",
};

function lockedMessage(capability: Capability, plan: string, unlocking: CapabilityPlan | null): string {
  const label = CAPABILITY_LABEL[capability];
  if (!unlocking) return `${label} is an add-on. Contact us to add it to this workspace.`;
  if (plan === "trial") return `${label} switches on when your trial converts to the ${PLAN_LABEL[unlocking]} plan or above.`;
  return `${label} is included from the ${PLAN_LABEL[unlocking]} plan. Upgrade to use it.`;
}

/**
 * Resolve one capability for one workspace from its plan key, its
 * subscription state, the plan's rows and the workspace's grants.
 *
 * - An inactive subscription allows nothing (reads still work elsewhere;
 *   this answers "may it do the thing").
 * - The plan row's `hard_limit` wins; with no row, the documented default.
 * - A live grant (not revoked, not expired) replaces the value when higher.
 */
export function resolveCapability(
  capability: Capability,
  input: {
    plan: string;
    active: boolean;
    planRows: readonly PlanCapabilityRow[];
    grants: readonly CapabilityGrantRow[];
    now: Date;
  },
): CapabilityDecision {
  const unlockingPlan = unlockingPlanFor(capability);
  const row = input.planRows.find((candidate) => candidate.metric === capability);
  let value = row && row.hard_limit !== null && Number.isFinite(Number(row.hard_limit)) ? Number(row.hard_limit) : planDefault(input.plan, capability);
  let source: CapabilityDecision["source"] = row ? "plan" : "default";

  for (const grant of input.grants) {
    if (grant.entitlement_key !== capability || grant.revoked_at) continue;
    if (grant.expires_at && Date.parse(grant.expires_at) <= input.now.getTime()) continue;
    const granted = grant.numeric_value !== null && grant.numeric_value !== undefined
      ? Number(grant.numeric_value)
      : grant.boolean_value
        ? 1
        : 0;
    if (Number.isFinite(granted) && granted > value) {
      value = granted;
      source = "grant";
    }
  }

  if (!input.active) {
    return {
      capability,
      allowed: false,
      value,
      source,
      reason: "SUBSCRIPTION_INACTIVE",
      unlockingPlan,
      message: "This workspace does not have an active subscription.",
    };
  }
  const allowed = value > 0;
  return {
    capability,
    allowed,
    value,
    source,
    reason: allowed ? null : "NOT_IN_PLAN",
    unlockingPlan,
    message: allowed ? null : lockedMessage(capability, input.plan, unlockingPlan),
  };
}

export function resolveCapabilities(input: Parameters<typeof resolveCapability>[1]): Record<Capability, CapabilityDecision> {
  return Object.fromEntries(CAPABILITIES.map((capability) => [capability, resolveCapability(capability, input)])) as Record<
    Capability,
    CapabilityDecision
  >;
}

/**
 * Whether a plan's default includes quote-to-cash (builder, e-signature and
 * invoicing together). The marketing site reads this (marketing/voice-offer.ts
 * QUOTES_ON_PLAN), so the site and `can()` cannot disagree.
 */
export function quotesIncludedOnPlan(plan: CapabilityPlan): boolean {
  const row = CAPABILITY_DEFAULTS[plan];
  return row.quote_builder_enabled > 0 && row.esign_enabled > 0 && row.invoicing_enabled > 0;
}
