/**
 * Public-facing Find Leads (V4) allowances, per plan.
 *
 * `plan_entitlements` is the runtime authority — see `v4-entitlements.ts`, and
 * the seed in `supabase/migrations/0038_v4_core_extensions.sql`. Nothing on a
 * public page can read that table without a workspace, so this module mirrors
 * the seeded **soft limits** (the number a customer is told they have, and
 * where the product starts warning them) for the pricing page.
 *
 * These two must agree. `tests/public-pages.test.ts` pins them against the
 * migration text so a repricing that edits one and not the other fails CI
 * rather than shipping a public page that advertises the wrong allowance.
 */

import type { PlanId } from "./plans";

export type SourcingAllowance = {
  /** Verified sourced prospects included each month. */
  verifiedProspects: number;
  /** Sourcing runs (searches executed) each month. */
  searchRuns: number;
  /** Saved or recurring searches held concurrently. */
  savedSearches: number;
  /** Active intent monitors. */
  intentMonitors: number;
  /** Connected sending identities. */
  senderIdentities: number;
  /** Outbound emails included each month. */
  emailSends: number;
  /** Mirrors the seeded `sourcing_enabled` capability. When false the plan
   *  has no sourcing at all, and every sourcing figure above is 0. */
  sourcingIncluded: boolean;
  /** Mirrors the seeded `cold_email_enabled` capability. When false
   *  `emailSends` is 0: outbound (cold) email is not available. */
  coldEmailIncluded: boolean;
};

export const SOURCING_ALLOWANCES: Record<
  Exclude<PlanId, "trial"> | "trial",
  SourcingAllowance
> = {
  // The trial seeds soft limits for these metrics (0038), but also seeds
  // `sourcing_enabled` and `cold_email_enabled` to 0, so none of them can be
  // used. The honest allowance is therefore 0 -- "Not included in trial" --
  // not the dormant soft limits.
  trial: {
    verifiedProspects: 0,
    searchRuns: 0,
    savedSearches: 0,
    intentMonitors: 0,
    senderIdentities: 0,
    emailSends: 0,
    sourcingIncluded: false,
    coldEmailIncluded: false,
  },
  starter: {
    verifiedProspects: 90,
    searchRuns: 8,
    savedSearches: 2,
    intentMonitors: 2,
    senderIdentities: 1,
    emailSends: 1_800,
    sourcingIncluded: true,
    coldEmailIncluded: true,
  },
  growth: {
    verifiedProspects: 450,
    searchRuns: 40,
    savedSearches: 10,
    intentMonitors: 13,
    senderIdentities: 3,
    emailSends: 7_000,
    sourcingIncluded: true,
    coldEmailIncluded: true,
  },
  pro: {
    verifiedProspects: 900,
    searchRuns: 160,
    savedSearches: 30,
    intentMonitors: 45,
    senderIdentities: 10,
    emailSends: 22_000,
    sourcingIncluded: true,
    coldEmailIncluded: true,
  },
  enterprise: {
    verifiedProspects: 9_000,
    searchRuns: 800,
    savedSearches: 100,
    intentMonitors: 180,
    senderIdentities: 50,
    emailSends: 90_000,
    sourcingIncluded: true,
    coldEmailIncluded: true,
  },
};

const NUMBER = new Intl.NumberFormat("en-GB");

/** Enterprise allowances are a starting point, not a ceiling — they are set per contract. */
export const NOT_INCLUDED_IN_TRIAL = "Not included in trial";

export function allowanceLabel(plan: PlanId, value: number): string {
  if (plan === "enterprise") return "Custom";
  if (plan === "trial" && value === 0) return NOT_INCLUDED_IN_TRIAL;
  return NUMBER.format(value);
}

export function formatAllowance(value: number): string {
  return NUMBER.format(value);
}
