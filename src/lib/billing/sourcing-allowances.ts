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
  /** Whether verified prospects may run past the included allowance, if the
   *  workspace has explicitly turned automatic overage on. */
  prospectOverageAvailable: boolean;
};

export const SOURCING_ALLOWANCES: Record<
  Exclude<PlanId, "trial"> | "trial",
  SourcingAllowance
> = {
  trial: {
    verifiedProspects: 18,
    searchRuns: 1,
    savedSearches: 1,
    intentMonitors: 1,
    senderIdentities: 1,
    emailSends: 40,
    prospectOverageAvailable: false,
  },
  starter: {
    verifiedProspects: 90,
    searchRuns: 8,
    savedSearches: 2,
    intentMonitors: 2,
    senderIdentities: 1,
    emailSends: 1_800,
    prospectOverageAvailable: true,
  },
  growth: {
    verifiedProspects: 450,
    searchRuns: 40,
    savedSearches: 10,
    intentMonitors: 13,
    senderIdentities: 3,
    emailSends: 7_000,
    prospectOverageAvailable: true,
  },
  pro: {
    verifiedProspects: 1_800,
    searchRuns: 160,
    savedSearches: 30,
    intentMonitors: 45,
    senderIdentities: 10,
    emailSends: 22_000,
    prospectOverageAvailable: true,
  },
  enterprise: {
    verifiedProspects: 9_000,
    searchRuns: 800,
    savedSearches: 100,
    intentMonitors: 180,
    senderIdentities: 50,
    emailSends: 90_000,
    prospectOverageAvailable: true,
  },
};

/**
 * Automatic overage is off until a workspace turns it on (V4 §97). The pricing
 * page says so; if this ever stops being true the copy must change with it.
 */
export const AUTOMATIC_OVERAGE_DEFAULT_ON = false;

const NUMBER = new Intl.NumberFormat("en-GB");

/** Enterprise allowances are a starting point, not a ceiling — they are set per contract. */
export function allowanceLabel(plan: PlanId, value: number): string {
  if (plan === "enterprise") return "Custom";
  return NUMBER.format(value);
}

export function formatAllowance(value: number): string {
  return NUMBER.format(value);
}
