/**
 * Communication allowance allocation (V4 §27.5-§27.9).
 *
 * Pure — no `server-only`, no Supabase — so the sliders and the server compute
 * identical numbers from identical inputs, and the arithmetic is unit-testable.
 *
 * The single rule that makes this safe to expose: **the provider price book is
 * never rendered.** A customer sees how many sends their allowance buys, not
 * what a send costs us. The conversion below therefore uses relative *weights*
 * — how much of the allowance one message of each channel consumes — which is
 * a product decision, not a wholesale price.
 */

export const ALLOCATION_CHANNELS = ["email", "sms", "whatsapp"] as const;
export type AllocationChannel = (typeof ALLOCATION_CHANNELS)[number];

export const CHANNEL_LABEL: Record<AllocationChannel, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

export type Allocation = Record<AllocationChannel, number>;

export const DEFAULT_ALLOCATION: Allocation = {
  email: 60,
  sms: 25,
  whatsapp: 15,
};

/**
 * Allowance units consumed per message, by channel.
 *
 * Email is the reference at 1. SMS and WhatsApp cost materially more to
 * deliver, and the ratios reflect that — but they are ratios, not prices, and
 * carry no information about what ClientTurn pays a provider.
 */
const UNITS_PER_MESSAGE: Record<AllocationChannel, number> = {
  email: 1,
  sms: 6,
  whatsapp: 10,
};

/* -------------------------------------------------------------- validation */

export type AllocationIssue = { field: string; message: string };

/**
 * Allocation must total exactly 100%.
 *
 * Rejected rather than silently normalised: quietly rescaling someone's numbers
 * means the figure they set is not the figure that applies, and they would only
 * discover that from a bill.
 */
export function validateAllocation(allocation: Allocation): AllocationIssue[] {
  const issues: AllocationIssue[] = [];

  for (const channel of ALLOCATION_CHANNELS) {
    const value = allocation[channel];
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      issues.push({
        field: channel,
        message: `${CHANNEL_LABEL[channel]} must be between 0 and 100%.`,
      });
    }
  }

  const total = allocationTotal(allocation);
  if (issues.length === 0 && total !== 100) {
    issues.push({
      field: "total",
      message: `Allocation must total 100%. It currently totals ${total}%.`,
    });
  }

  return issues;
}

export function allocationTotal(allocation: Allocation): number {
  return ALLOCATION_CHANNELS.reduce(
    (sum, channel) => sum + Math.round(allocation[channel]),
    0,
  );
}

/**
 * Moves one slider and absorbs the difference across the others.
 *
 * Without this, every adjustment leaves the total wrong and the customer has to
 * solve a small simultaneous equation to save. The remainder is distributed in
 * proportion to the other channels' current shares, so moving Email does not
 * silently reorder SMS against WhatsApp.
 */
export function rebalance(
  allocation: Allocation,
  channel: AllocationChannel,
  next: number,
): Allocation {
  const target = Math.max(0, Math.min(100, Math.round(next)));
  const others = ALLOCATION_CHANNELS.filter((key) => key !== channel);
  const remaining = 100 - target;
  const othersTotal = others.reduce((sum, key) => sum + allocation[key], 0);

  const result = { ...allocation, [channel]: target } as Allocation;

  if (othersTotal <= 0) {
    // Nothing to scale against: split the remainder evenly.
    const each = Math.floor(remaining / others.length);
    others.forEach((key, index) => {
      result[key] = index === others.length - 1 ? remaining - each * (others.length - 1) : each;
    });
    return result;
  }

  let assigned = 0;
  others.forEach((key, index) => {
    if (index === others.length - 1) {
      // The last channel takes the rounding remainder, so the total is exactly
      // 100 rather than 99 or 101.
      result[key] = remaining - assigned;
    } else {
      const share = Math.round((allocation[key] / othersTotal) * remaining);
      result[key] = share;
      assigned += share;
    }
  });

  return result;
}

/* ---------------------------------------------------------------- estimates */

export type SendEstimate = {
  channel: AllocationChannel;
  percent: number;
  /** Allowance units this channel's share represents. */
  units: number;
  /** Approximate messages that buys. */
  estimatedSends: number;
};

/**
 * How many sends an allocation buys.
 *
 * Explicitly an estimate, and labelled as one everywhere it appears: actual
 * consumption depends on segmentation, retries and provider behaviour, and the
 * server's usage ledger is always the authority.
 */
export function estimateSends(
  allocation: Allocation,
  monthlyAllowance: number,
): SendEstimate[] {
  return ALLOCATION_CHANNELS.map((channel) => {
    const percent = allocation[channel];
    const units = Math.round((monthlyAllowance * percent) / 100);
    return {
      channel,
      percent,
      units,
      estimatedSends: Math.floor(units / UNITS_PER_MESSAGE[channel]),
    };
  });
}

/* ------------------------------------------------------------- daily caps */

export type DailyCaps = Record<AllocationChannel, number>;

export const PLATFORM_DAILY_CEILING: DailyCaps = {
  email: 2000,
  sms: 1000,
  whatsapp: 1000,
};

/**
 * The cap that actually applies.
 *
 * A customer may lower a cap but never raise it beyond the effective ceiling,
 * which is the lowest of the platform limit, the plan limit and — for email —
 * what the sending identities can healthily support. Clamping here means the
 * UI cannot offer a number the dispatcher would refuse.
 */
export function effectiveDailyCap(input: {
  channel: AllocationChannel;
  requested: number;
  planCap: number;
  /** Combined healthy daily send capacity across verified senders. Email only. */
  senderCapacity?: number;
}): number {
  const ceilings = [
    PLATFORM_DAILY_CEILING[input.channel],
    input.planCap,
    ...(input.channel === "email" && input.senderCapacity !== undefined
      ? [input.senderCapacity]
      : []),
  ].filter((value) => Number.isFinite(value) && value > 0);

  const ceiling = ceilings.length > 0 ? Math.min(...ceilings) : 0;
  return Math.max(0, Math.min(Math.round(input.requested), ceiling));
}

/* ----------------------------------------------------------------- overage */

export const MAX_OVERAGE_CAP_MINOR = 500_000; // £5,000

/**
 * Overage is off by default and stays off until switched on deliberately.
 *
 * A cap of zero with overage enabled is a contradiction — it would permit
 * nothing while implying it permits something — so it is rejected rather than
 * stored.
 */
export function validateOverage(input: {
  enabled: boolean;
  capMinor: number;
  /** The account's own ceiling, set by the platform. */
  accountMaxMinor: number;
}): AllocationIssue[] {
  if (!input.enabled) return [];

  const issues: AllocationIssue[] = [];

  if (!Number.isFinite(input.capMinor) || input.capMinor <= 0) {
    issues.push({
      field: "cap",
      message: "Set a monthly additional spend cap before enabling overage.",
    });
  }

  const ceiling = Math.min(
    input.accountMaxMinor > 0 ? input.accountMaxMinor : MAX_OVERAGE_CAP_MINOR,
    MAX_OVERAGE_CAP_MINOR,
  );

  if (input.capMinor > ceiling) {
    issues.push({
      field: "cap",
      message: `The maximum additional spend for this account is £${(ceiling / 100).toLocaleString("en-GB")}.`,
    });
  }

  return issues;
}
