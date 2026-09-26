/**
 * LinkedIn InMail credit tracking (Phase 3.5, 01 §3). Pure.
 *
 * LinkedIn stays ASSISTED: a person sends the InMail in LinkedIn and records
 * it in ClientTurn (`inmail_sends`, 0125). The balance is derived, never
 * stored, from LinkedIn's published rules (Help a101030) for Sales Navigator:
 *
 *   * 50 credits are added on the 1st of each month (UTC);
 *   * unused credits roll over, up to a maximum balance of 150;
 *   * a credit comes back when the InMail gets a reply within 90 days.
 */

export const INMAIL_MONTHLY_GRANT = 50;
export const INMAIL_ROLLOVER_CAP = 150;
export const INMAIL_REFUND_WINDOW_DAYS = 90;

export type InMailSend = { sentAt: string; repliedAt: string | null };

export type InMailBalance = {
  balance: number;
  sentThisMonth: number;
  refundedThisMonth: number;
  /** Sends still inside their 90-day window with no reply yet. */
  awaitingReply: number;
  nextGrantAt: string;
};

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

/** True when a reply returns the credit: replied, and within 90 days of sending. */
export function earnsRefund(send: InMailSend): boolean {
  if (!send.repliedAt) return false;
  const sent = Date.parse(send.sentAt);
  const replied = Date.parse(send.repliedAt);
  return (
    Number.isFinite(sent) &&
    Number.isFinite(replied) &&
    replied >= sent &&
    replied - sent <= INMAIL_REFUND_WINDOW_DAYS * 86_400_000
  );
}

/**
 * Replays grants, sends and refunds in time order from `trackingSince` (when
 * the seat started being tracked) to `now`. The balance may go negative if
 * more InMails were recorded than LinkedIn would have allowed; that is shown
 * as it is rather than clamped, because it means the records are wrong.
 */
export function computeInMailBalance(input: {
  sends: InMailSend[];
  trackingSince: string;
  now: Date;
  monthlyGrant?: number;
  rolloverCap?: number;
}): InMailBalance {
  const grant = input.monthlyGrant ?? INMAIL_MONTHLY_GRANT;
  const cap = input.rolloverCap ?? INMAIL_ROLLOVER_CAP;
  const now = input.now;

  type Event = { at: number; delta: number; kind: "send" | "refund" };
  const events: Event[] = [];
  for (const send of input.sends) {
    const sentAt = Date.parse(send.sentAt);
    if (!Number.isFinite(sentAt) || sentAt > now.getTime()) continue;
    events.push({ at: sentAt, delta: -1, kind: "send" });
    if (earnsRefund(send) && Date.parse(send.repliedAt!) <= now.getTime()) {
      events.push({ at: Date.parse(send.repliedAt!), delta: 1, kind: "refund" });
    }
  }
  events.sort((a, b) => a.at - b.at);

  let balance = 0;
  let cursor = monthStart(new Date(input.trackingSince));
  let index = 0;
  while (cursor.getTime() <= now.getTime()) {
    balance = Math.min(cap, balance + grant);
    const end = nextMonth(cursor).getTime();
    while (index < events.length && events[index].at < end) {
      balance = events[index].kind === "refund" ? Math.min(cap, balance + 1) : balance - 1;
      index += 1;
    }
    cursor = nextMonth(cursor);
  }

  const thisMonth = monthStart(now).getTime();
  const sentThisMonth = input.sends.filter((s) => Date.parse(s.sentAt) >= thisMonth && Date.parse(s.sentAt) <= now.getTime()).length;
  const refundedThisMonth = input.sends.filter(
    (s) => earnsRefund(s) && Date.parse(s.repliedAt!) >= thisMonth && Date.parse(s.repliedAt!) <= now.getTime(),
  ).length;
  const awaitingReply = input.sends.filter(
    (s) => !s.repliedAt && now.getTime() - Date.parse(s.sentAt) <= INMAIL_REFUND_WINDOW_DAYS * 86_400_000,
  ).length;

  return {
    balance,
    sentThisMonth,
    refundedThisMonth,
    awaitingReply,
    nextGrantAt: nextMonth(now).toISOString(),
  };
}

/* ------------------------------------------------------------ per tier */

export type InMailTier = "FREE" | "PREMIUM" | "SALES_NAVIGATOR" | "RECRUITER";

export type InMailRules = {
  monthlyGrant: number;
  rolloverCap: number;
  /** Where the figures come from, shown under the balance. */
  basis: string;
};

/**
 * InMail allowances by LinkedIn subscription. The balance used Sales
 * Navigator's rules for every account, so a Free account showed 50 credits it
 * does not have and offered "Mark InMail sent" for a message it cannot send.
 *
 *   * FREE: no InMail at all.
 *   * SALES_NAVIGATOR: 50 a month, rolling over to 150 (Help a101030, verified).
 *   * PREMIUM and RECRUITER: LinkedIn does not publish one figure for every
 *     plan, so the monthly grant is the conservative default in
 *     `social-limits.ts` and rollover is capped at three months of it.
 */
export function inMailRulesForTier(tier: string | null | undefined): InMailRules {
  switch (tier) {
    case "SALES_NAVIGATOR":
      return {
        monthlyGrant: INMAIL_MONTHLY_GRANT,
        rolloverCap: INMAIL_ROLLOVER_CAP,
        basis: "LinkedIn's Sales Navigator rules: 50 a month, rolling over to 150",
      };
    case "PREMIUM":
      return {
        monthlyGrant: 15,
        rolloverCap: 45,
        basis: "a conservative Premium allowance (15 a month); LinkedIn's figure varies by Premium plan",
      };
    case "RECRUITER":
      return {
        monthlyGrant: 150,
        rolloverCap: 450,
        basis: "a Recruiter allowance of 150 a month; check your contract's figure",
      };
    default:
      return { monthlyGrant: 0, rolloverCap: 0, basis: "LinkedIn Free, which includes no InMail" };
  }
}

/** Whether this subscription can send InMail at all. */
export function tierHasInMail(tier: string | null | undefined): boolean {
  return inMailRulesForTier(tier).monthlyGrant > 0;
}

const TIER_RANK: Record<string, number> = { FREE: 0, PREMIUM: 1, SALES_NAVIGATOR: 2, RECRUITER: 3 };

/** The workspace's best LinkedIn subscription among its active accounts. */
export function bestLinkedInTier(tiers: string[]): InMailTier | null {
  let best: InMailTier | null = null;
  for (const tier of tiers) {
    if (!(tier in TIER_RANK)) continue;
    if (best === null || TIER_RANK[tier] > TIER_RANK[best]) best = tier as InMailTier;
  }
  return best;
}
