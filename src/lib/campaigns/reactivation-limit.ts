/**
 * The plan's reactivation contact allowance (plans.ts `reactivationContactLimit`,
 * `plan_entitlements.reactivation_contact`): how many contacts a workspace may
 * put into reactivation campaigns in one billing period. A contact counts once
 * per campaign, when it is added to that campaign's audience.
 *
 * Checked on the server wherever an audience grows: launch, the expand job
 * that writes the audience, and adding a single lead. The wizard shows the
 * same numbers, but that is a courtesy.
 *
 * Pure: no React, no `server-only`.
 */

export type ReactivationAllowance = {
  limit: number;
  used: number;
  remaining: number;
};

export function reactivationAllowance(limit: number, used: number): ReactivationAllowance {
  const safeLimit = Math.max(0, Math.floor(limit));
  const safeUsed = Math.max(0, Math.floor(used));
  return { limit: safeLimit, used: safeUsed, remaining: Math.max(0, safeLimit - safeUsed) };
}

const NUMBER = new Intl.NumberFormat("en-GB");

/**
 * Why adding `adding` contacts would break the allowance, or null when it
 * fits. Worded for the plan-limit-reached state: what the limit is, what is
 * left, and what the person can do about it.
 */
export function reactivationLimitProblem(
  allowance: ReactivationAllowance,
  adding: number,
): string | null {
  if (adding <= allowance.remaining) return null;
  if (allowance.limit === 0) {
    return "Your plan does not include reactivation contacts. Upgrade to run a reactivation campaign.";
  }
  const left =
    allowance.remaining === 0
      ? "none are left this billing period"
      : `${NUMBER.format(allowance.remaining)} ${allowance.remaining === 1 ? "is" : "are"} left this billing period`;
  return (
    `Your plan includes ${NUMBER.format(allowance.limit)} reactivation contacts a billing period, and ${left}. ` +
    `This would add ${NUMBER.format(adding)}. Narrow the audience, wait for your next billing period, or upgrade your plan.`
  );
}
