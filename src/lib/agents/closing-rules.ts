/**
 * Whether a qualified lead has stalled short of its goal, for the closing
 * agent (stored type BOOKING, shown as "Closing agent").
 *
 * The agent used to mean "qualified with no booking", which was wrong for any
 * lead whose goal is a direct sale, a subscription or a trial sign-up: a lead
 * who booked a demo but never paid was never chased, and one who had just been
 * sent a checkout link was chased twice. Goals now come from the lead's open
 * opportunities (one per interest, 0144), and leads another loop is already
 * working (abandoned-checkout nudges, quote follow-up) are left to that loop.
 *
 * Pure, so it is testable without the database.
 */
import type { GoalKey } from "@/lib/qualification-intelligence/types";

export type ClosingInput = {
  /** The lead has a booking (leads.booked_at). */
  booked: boolean;
  /** Goals of the lead's OPEN opportunities; empty when none is recorded. */
  openGoals: readonly (GoalKey | null)[];
  /** A checkout link sent and not yet paid, abandoned or expired. */
  checkoutInFlight: boolean;
  /** A quote awaiting approval, sent, viewed or accepted but unpaid. */
  quoteInFlight: boolean;
};

export type ClosingVerdict =
  | { stalled: true; goal: GoalKey; label: string }
  | { stalled: false; reason: string };

/** What "reaching the goal" means, in the queue's words. */
export const CLOSING_GOAL_LABEL: Partial<Record<GoalKey, string>> = {
  B_BOOK_MEETING: "no meeting booked",
  E_HUMAN_CLOSER: "no call with your team booked",
  C_DIRECT_SALE: "not bought yet",
  D_SIGNUP_TRIAL: "not signed up yet",
};

/** Goals met by a booking; the others are met only by a sale (won_at). */
const MET_BY_BOOKING = new Set<GoalKey>(["B_BOOK_MEETING", "E_HUMAN_CLOSER"]);
/** Goals this agent chases, in priority order. */
const CHASED: readonly GoalKey[] = ["C_DIRECT_SALE", "D_SIGNUP_TRIAL", "B_BOOK_MEETING", "E_HUMAN_CLOSER"];

export function closingVerdict(input: ClosingInput): ClosingVerdict {
  if (input.checkoutInFlight) return { stalled: false, reason: "The checkout follow-up is already chasing this lead." };
  if (input.quoteInFlight) return { stalled: false, reason: "The quote follow-up is already chasing this lead." };

  // No recorded goal: the long-standing default, a meeting.
  const goals = input.openGoals.filter((g): g is GoalKey => g !== null);
  const effective = goals.length > 0 ? goals : (["B_BOOK_MEETING"] as GoalKey[]);

  for (const goal of CHASED) {
    if (!effective.includes(goal)) continue;
    if (MET_BY_BOOKING.has(goal) && input.booked) continue;
    return { stalled: true, goal, label: CLOSING_GOAL_LABEL[goal] ?? "goal not reached" };
  }
  return { stalled: false, reason: "The lead has reached its goal or has nothing for this agent to chase." };
}
