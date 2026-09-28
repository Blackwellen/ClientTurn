/**
 * Count-based allowances and the downgrade-over-limit rule (gap audit 15,
 * batch 2). Pure: server gates, the billing banner and
 * `tests/entitlement-holes.test.ts` all read the same verdicts.
 *
 * ## Downgrading while over the new plan's limits
 *
 * A downgrade is ALLOWED even when the workspace is over the lower plan's
 * limits: refusing it would trap a customer on a price they chose to leave,
 * and deleting their people, mailboxes or schedules for them would destroy
 * work. Instead, once the lower plan applies:
 *
 *   * nothing that already exists is removed or switched off by us;
 *   * creating MORE of anything that is over its limit is refused, server-side,
 *     until the workspace is back under it (a new seat or invitation, a new
 *     sender identity, a new or resumed saved search);
 *   * sending from a sender identity beyond the limit is refused at campaign
 *     launch, so an over-limit workspace cannot run more mailboxes than it pays
 *     for;
 *   * a banner in the app and the Billing page list exactly what to reduce, and
 *     by how much.
 *
 * Period allowances (new leads, prospects, runs, email, SMS) need no special
 * case: they reset each period and the lower plan's number simply applies
 * from the next one.
 *
 * The same rule covers any other way usage can exceed a limit (an admin
 * lowered a grant, a trial converted to a smaller tier).
 */

/** Plans whose analytics page is available. Trials see the Dashboard only (nav rule, app layout). */
export function analyticsAllowed(plan: string): boolean {
  return plan !== "trial";
}

export type CountGateDecision =
  | { allowed: true; used: number; limit: number }
  | { allowed: false; used: number; limit: number; overBy: number };

/**
 * Whether `adding` more of a count-based allowance fits. `used` is what exists
 * now, `limit` the hard limit. Over the limit already means refused, whatever
 * `adding` is (the downgrade rule above).
 */
export function countGate(input: { used: number; limit: number; adding?: number }): CountGateDecision {
  const used = Math.max(0, Math.floor(input.used));
  const limit = Math.max(0, Math.floor(input.limit));
  const adding = Math.max(0, Math.floor(input.adding ?? 1));
  if (used + adding <= limit) return { allowed: true, used, limit };
  return { allowed: false, used, limit, overBy: Math.max(0, used - limit) };
}

/**
 * Saved searches (`plan_entitlements.saved_search`, 2/10/30/100) count
 * schedules that can run: ACTIVE ones. A PAUSED schedule holds no slot, so
 * pausing is how a customer gets back under the limit without losing the
 * schedule, and resuming one needs a free slot like creating one does.
 */
export function savedSearchGate(input: { activeSchedules: number; limit: number }): CountGateDecision {
  return countGate({ used: input.activeSchedules, limit: input.limit, adding: 1 });
}

/**
 * Sender identities (`plan_entitlements.sender_identity`, 1/3/10/50) count
 * ACTIVE identities with a different address. Re-saving an identity that
 * already exists (same address) is an update, never a new slot.
 */
export function senderIdentityGate(input: { activeEmails: readonly string[]; email: string; limit: number }): CountGateDecision {
  const normalised = input.email.trim().toLowerCase();
  const existing = new Set(input.activeEmails.map((e) => e.trim().toLowerCase()));
  if (existing.has(normalised)) {
    // An update: allowed, unless the workspace is already over the limit, in
    // which case it is still allowed (editing never adds a slot).
    return { allowed: true, used: existing.size, limit: Math.max(0, Math.floor(input.limit)) };
  }
  return countGate({ used: existing.size, limit: input.limit, adding: 1 });
}

/** A campaign may launch only while active sender identities fit the plan. */
export function sendersWithinLimit(input: { activeSenders: number; limit: number }): boolean {
  return Math.max(0, input.activeSenders) <= Math.max(0, input.limit);
}

/* ------------------------------------------------------------ over-limit report */

export type OverLimitKey = "seats" | "sender_identities" | "saved_searches" | "intent_monitors";

export type OverLimitItem = {
  key: OverLimitKey;
  label: string;
  used: number;
  limit: number;
  /** How many to remove (or pause) to be back within the plan. */
  reduceBy: number;
  /** What to do, in words. */
  action: string;
  /** What is refused until then. */
  blocked: string;
  href: string;
};

export type CountUsage = {
  seats: number;
  senderIdentities: number;
  savedSearches: number;
  intentMonitors: number;
};

export type CountLimits = {
  seats: number;
  senderIdentities: number;
  savedSearches: number;
  intentMonitors: number;
};

const ITEMS: Record<OverLimitKey, { label: string; usageKey: keyof CountUsage; action: (n: number) => string; blocked: string; href: string }> = {
  seats: {
    label: "Team members",
    usageKey: "seats",
    action: (n) => `Remove ${n} team member${n === 1 ? "" : "s"} or revoke ${n === 1 ? "an invitation" : "invitations"}.`,
    blocked: "New invitations",
    href: "/app/settings?section=team",
  },
  sender_identities: {
    label: "Sender identities",
    usageKey: "senderIdentities",
    action: (n) => `Deactivate ${n} sender identit${n === 1 ? "y" : "ies"}.`,
    blocked: "New sender identities and campaign launches",
    href: "/app/find-leads",
  },
  saved_searches: {
    label: "Saved searches",
    usageKey: "savedSearches",
    action: (n) => `Pause or stop ${n} saved search${n === 1 ? "" : "es"}.`,
    blocked: "New or resumed saved searches",
    href: "/app/find-leads",
  },
  intent_monitors: {
    label: "Intent monitors",
    usageKey: "intentMonitors",
    action: (n) => `Switch off ${n} intent monitor${n === 1 ? "" : "s"}.`,
    blocked: "New intent monitors",
    href: "/app/find-leads",
  },
};

const LIMIT_KEY: Record<OverLimitKey, keyof CountLimits> = {
  seats: "seats",
  sender_identities: "senderIdentities",
  saved_searches: "savedSearches",
  intent_monitors: "intentMonitors",
};

/** Everything the workspace holds more of than `limits` allow, in a fixed order. */
export function overLimitReport(usage: CountUsage, limits: CountLimits): OverLimitItem[] {
  const out: OverLimitItem[] = [];
  for (const key of Object.keys(ITEMS) as OverLimitKey[]) {
    const spec = ITEMS[key];
    const used = Math.max(0, Math.floor(usage[spec.usageKey]));
    const limit = Math.max(0, Math.floor(limits[LIMIT_KEY[key]]));
    if (used <= limit) continue;
    const reduceBy = used - limit;
    out.push({ key, label: spec.label, used, limit, reduceBy, action: spec.action(reduceBy), blocked: spec.blocked, href: spec.href });
  }
  return out;
}

/** The banner for an over-limit workspace (null when within every limit). */
export function overLimitNotice(items: readonly OverLimitItem[], planName: string): { title: string; body: string } | null {
  if (items.length === 0) return null;
  const list = items.map((item) => `${item.label}: ${item.used} of ${item.limit}. ${item.action}`).join(" ");
  return {
    title: `Your workspace is over the ${planName} plan's limits`,
    body: `Nothing has been removed. Until you are back within the plan, ${items
      .map((i) => i.blocked.toLowerCase())
      .join(", ")} are refused. ${list}`,
  };
}
