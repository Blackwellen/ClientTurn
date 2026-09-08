/**
 * The sequence a workspace has configured, as a list of steps it can look at.
 *
 * Pure -- no `server-only`, no Supabase -- because it is a projection of
 * settings, not a query. The same function feeds the campaign diagram and any
 * test that asserts what a given configuration actually does.
 *
 * ## Why this exists
 *
 * The sequence was real but invisible. It lived as five columns on
 * `business_data_controls` -- warm before invite, skip to email after, follow-up
 * gap, max follow-ups, withdraw after -- and a customer had no way to see what
 * those combined into. "Two follow-ups, 96 hours apart, falling back to email
 * after a week" is four numbers on a settings screen and one legible diagram,
 * and only the second lets somebody notice their sequence is wrong before it
 * runs at three hundred people.
 *
 * Derived rather than stored, deliberately. A stored copy of the plan is a
 * second source of truth that drifts the moment a setting changes, and the
 * failure is silent: the picture keeps showing the old sequence while the
 * scheduler runs the new one.
 */

import {
  type SocialSequenceSettings,
} from "./social-sequence.ts";

export type PlanChannel = "LINKEDIN" | "EMAIL";

export type PlanStep = {
  /** 1-based position, for display. */
  position: number;
  channel: PlanChannel;
  title: string;
  /** What happens, written for a customer. */
  detail: string;
  /** When it happens relative to the step before it. Null for the first. */
  after: string | null;
  /**
   * True when the step waits on the recipient rather than on a timer. These
   * are the ones a customer most often misreads as a delay we chose.
   */
  waitsOnRecipient?: boolean;
  /** True when the step only happens on one branch of the sequence. */
  conditional?: boolean;
};

/** Hours rendered the way somebody would say them aloud. */
function gapLabel(hours: number): string {
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} later`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} later`;
}

function dayLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"} later`;
}

/**
 * The steps this configuration produces, in order.
 *
 * The email branch is included as `conditional` rather than shown as a separate
 * diagram: it is the same sequence, and splitting it into two pictures hides
 * the thing worth seeing -- that a prospect who never accepts still gets
 * contacted.
 */
export function socialPlanSteps(settings: SocialSequenceSettings): PlanStep[] {
  const steps: PlanStep[] = [];
  let position = 1;

  if (settings.warmBeforeInvite) {
    steps.push({
      position: position++,
      channel: "LINKEDIN",
      title: "View their profile",
      detail:
        "They get a notification that someone looked at their profile, so the connection request arrives from a name they have already seen rather than from a stranger.",
      after: null,
    });
  }

  steps.push({
    position: position++,
    channel: "LINKEDIN",
    title: "Send a connection request",
    detail:
      "With a personalised note while the account still has notes left this month, and without one when it does not — an invite without a note still works and is capped far less tightly.",
    after: settings.warmBeforeInvite ? gapLabel(settings.warmDelayHours) : null,
  });

  steps.push({
    position: position++,
    channel: "LINKEDIN",
    title: "They accept",
    detail:
      "Nothing can be sent on LinkedIn until they do. This wait is the platform's gate rather than a delay we chose, so it has no timer.",
    after: null,
    waitsOnRecipient: true,
  });

  steps.push({
    position: position++,
    channel: "LINKEDIN",
    title: "Send the first message",
    detail:
      "Composed for this person from what their company publishes. Suppression, quiet hours and the account's daily cap are re-checked in the moment before it goes.",
    after: "as soon as they accept",
  });

  const followUps = Math.max(0, Math.min(2, settings.maxFollowUps));
  for (let index = 0; index < followUps; index += 1) {
    steps.push({
      position: position++,
      channel: "LINKEDIN",
      title: index === followUps - 1 ? "Final follow-up" : "Follow up",
      detail:
        index === followUps - 1
          ? "Says it is the last one, and means it. Saying so and then stopping is what keeps a sequence from reading as harassment."
          : "Only while they have not replied. The moment they do, everything scheduled is discarded.",
      after: gapLabel(settings.followUpGapHours),
    });
  }

  // The branch that matters. A prospect who never accepts is not a dead end.
  if (settings.skipToEmailAfterDays !== null) {
    steps.push({
      position: position++,
      channel: "EMAIL",
      title: "If they never accept, email them instead",
      detail: `After ${dayLabel(settings.skipToEmailAfterDays).replace(" later", "")} with no answer, LinkedIn messaging stays shut — so the prospect moves to the email sequence rather than stopping here. The invitation is left standing in case they accept late.`,
      after: `${settings.skipToEmailAfterDays} days after the request`,
      conditional: true,
    });
  }

  if (settings.withdrawAfterDays !== null) {
    steps.push({
      position: position++,
      channel: "LINKEDIN",
      title: "Withdraw the invitation",
      detail:
        "LinkedIn limits how many invitations an account may have outstanding, so one that has clearly gone unanswered is taken back. They are not invited again.",
      after: `${settings.withdrawAfterDays} days after the request`,
      conditional: true,
    });
  }

  return steps;
}

/**
 * The one-line summary shown above the diagram.
 *
 * Written from the same settings rather than hand-maintained, so it cannot
 * describe a sequence the workspace does not have.
 */
export function socialPlanSummary(settings: SocialSequenceSettings): string {
  const followUps = Math.max(0, Math.min(2, settings.maxFollowUps));
  const parts = [
    settings.warmBeforeInvite ? "a profile view" : null,
    "a connection request",
    "a message once they accept",
    followUps === 0
      ? null
      : `${followUps} follow-up${followUps === 1 ? "" : "s"} ${gapLabel(settings.followUpGapHours)}`,
    settings.skipToEmailAfterDays === null
      ? null
      : `and email instead if they never accept`,
  ].filter(Boolean);

  return `${parts.join(", ").replace(/, and /, " and ")}.`;
}
