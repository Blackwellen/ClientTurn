/**
 * Quote follow-up (brief §72). Pure: when and whether each automated touch
 * after a quote is sent happens. The jobs (jobs/handlers/quote-jobs.ts) re-read
 * live state and ask these; every touch they then make goes through
 * `checkAutomatedTouchAllowed` and the send gate.
 *
 *   sent, not viewed after NOT_VIEWED_REMINDER_DAYS  -> a reminder (nudge step 1)
 *   viewed QUOTE_VIEW_INTENT_THRESHOLD+ times        -> a HIGH buying-intent signal
 *   viewed, and the lead asks questions              -> the agent answers from the quote
 *                                                       (agent/quote-flow.ts ANSWER_FROM_QUOTE)
 *   expiry approaching (EXPIRY_REMINDER_DAYS before) -> a reminder (nudge step 2)
 *   expired                                          -> the re-engagement route
 *                                                       (reengagement/triggers.ts QUOTE_EXPIRED)
 *   accepted                                         -> the signature and payment step
 *   paid (deposit or in full)                        -> every sales chase stops at once
 *
 * The existing `quote.nudge` job (quote-P2) is the one reminder job; this
 * module only decides what each of its runs does, so there is no second
 * reminder loop.
 */

export const NOT_VIEWED_REMINDER_DAYS = 3;
export const EXPIRY_REMINDER_DAYS_BEFORE = 2;
/** A reminder this close to expiry is not worth sending (the quote-P2 rule). */
export const EXPIRY_TOO_CLOSE_HOURS = 12;
/** Total views across the revision's links that count as strong buying intent. */
export const QUOTE_VIEW_INTENT_THRESHOLD = 3;
/** The signal's strength: HIGH on the engine's scale (≥ 0.8). */
export const QUOTE_VIEW_SIGNAL_STRENGTH = 0.85;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export type ReminderKind = "NOT_VIEWED" | "EXPIRY";

export type NudgeInput = {
  step: number;
  status: string;
  sentAt: string | null;
  firstViewedAt: string | null;
  validUntil: string | null;
  now: Date;
  nudgesEnabled: boolean;
  /** The lead has written since the quote was sent: the conversation is live, the agent answers them. */
  leadRepliedSinceSent: boolean;
};

export type NudgeDecision =
  | { action: "SEND"; kind: ReminderKind }
  | { action: "RESCHEDULE"; step: number; at: Date; reason: string }
  | { action: "SKIP"; reason: "disabled" | "not_live" | "replied" | "too_close_to_expiry" | "expired" | "viewed" };

function at(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** When the expiry reminder is due for a revision (null when there is no validity or it would be too late). */
export function expiryReminderAt(validUntil: string | null, now: Date): Date | null {
  const until = at(validUntil);
  if (until === null) return null;
  if (until - now.getTime() < EXPIRY_TOO_CLOSE_HOURS * HOUR_MS) return null;
  const due = until - EXPIRY_REMINDER_DAYS_BEFORE * DAY_MS;
  return new Date(Math.max(due, now.getTime()));
}

/**
 * What one run of the quote.nudge job does.
 *
 *   step 1 (NOT_VIEWED_REMINDER_DAYS after sending): only a quote that is
 *     still unopened gets the "have you seen it?" reminder. A viewed one skips
 *     straight to the expiry reminder.
 *   step 2 (EXPIRY_REMINDER_DAYS before it expires): any quote still open.
 *
 * A lead who has replied since the quote went out is in a live conversation:
 * the agent answers them and no automated reminder is sent.
 */
export function quoteNudgeDecision(input: NudgeInput): NudgeDecision {
  if (!input.nudgesEnabled) return { action: "SKIP", reason: "disabled" };
  if (input.status !== "SENT" && input.status !== "VIEWED") return { action: "SKIP", reason: "not_live" };
  const until = at(input.validUntil);
  const now = input.now.getTime();
  if (until !== null && until <= now) return { action: "SKIP", reason: "expired" };
  if (until !== null && until - now < EXPIRY_TOO_CLOSE_HOURS * HOUR_MS) return { action: "SKIP", reason: "too_close_to_expiry" };
  if (input.leadRepliedSinceSent) return { action: "SKIP", reason: "replied" };

  if (input.step <= 1) {
    const viewed = input.status === "VIEWED" || at(input.firstViewedAt) !== null;
    if (viewed) {
      const next = expiryReminderAt(input.validUntil, input.now);
      if (next && next.getTime() > now + HOUR_MS) {
        return { action: "RESCHEDULE", step: 2, at: next, reason: "Viewed already: the next reminder is the expiry one." };
      }
      return { action: "SKIP", reason: "viewed" };
    }
    return { action: "SEND", kind: "NOT_VIEWED" };
  }
  return { action: "SEND", kind: "EXPIRY" };
}

/** Views across every link of the revision reach the threshold, and the signal is not already recorded. */
export function viewIntentReached(totalViews: number, alreadyRecorded: boolean): boolean {
  return !alreadyRecorded && Number.isFinite(totalViews) && totalViews >= QUOTE_VIEW_INTENT_THRESHOLD;
}

/** The source_ref that makes the signal once per revision. */
export function viewSignalSourceRef(revisionId: string): string {
  return `quote-revision:${revisionId}#views`;
}

/* --------------------------------------------------------- stop chasing */

/** A quote status that means the lead has paid: every sales chase stops. */
export const PAID_STATES = ["DEPOSIT_PAID", "PAID", "WON"] as const;

/** Job types that chase a sale, cancelled for the lead the moment a quote is paid. */
export const SALES_CHASE_JOB_TYPES = ["quote.nudge", "checkout.nudge", "reengage.trigger"] as const;

export type ChaseStopPlan =
  | { stop: false }
  | { stop: true; reason: "quote_paid"; stopAutomation: true; cancelJobTypes: readonly string[] };

/**
 * Paid (a deposit or in full) -> stop immediately: the lead's follow-up
 * automation is switched off and its runs stopped, and any queued quote
 * reminder, abandoned-checkout nudge or re-engagement trigger is cancelled.
 * Invoice reminders are billing, not selling, and are unaffected.
 */
export function chaseStopPlan(quoteStatus: string | null | undefined): ChaseStopPlan {
  if (!quoteStatus || !(PAID_STATES as readonly string[]).includes(quoteStatus)) return { stop: false };
  return { stop: true, reason: "quote_paid", stopAutomation: true, cancelJobTypes: SALES_CHASE_JOB_TYPES };
}

/** The step after acceptance, for the agent and the lead page. */
export function nextStepAfter(status: string): "SIGN" | "PAY" | "NONE" {
  if (status === "ACCEPTED") return "SIGN";
  if (status === "SIGNED" || status === "DEPOSIT_PAID") return "PAY";
  return "NONE";
}
