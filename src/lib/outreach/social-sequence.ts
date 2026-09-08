/**
 * What the social sequencer should do next, and when.
 *
 * Pure -- no `server-only`, no Supabase, no clock of its own -- for the same
 * reason `social-limits.ts` is pure: this is the logic that decides whether a
 * customer's LinkedIn account performs an action, and it has to be provable
 * without standing up a database. `now` is a parameter rather than a call to
 * `Date.now()` so "is the follow-up due" is a deterministic question.
 *
 * ## The shape of the problem
 *
 * `social-limits.ts` answers *may* we act -- the platform's gate and the
 * account's caps. `social-outreach.ts` answers *what* is the next action for
 * one prospect right now. Neither answers *when*, and that is what stopped the
 * whole channel from running unattended: the state machine had no clock, so
 * every advance needed a person to click. Everything here is about the clock.
 *
 * ## The rules, in the order they bite
 *
 *   1. **A reply ends the sequence.** Not pauses -- ends. The moment somebody
 *      answers, the conversation is a conversation, and continuing to fire
 *      scheduled follow-ups at them is the single most damaging thing an
 *      outreach tool does. Any composed-but-unsent message is discarded.
 *   2. **A declined or withdrawn invite is never retried.** LinkedIn hides
 *      "ignore" from the sender, so a withdraw-and-resend looks harmless from
 *      our side and is exactly the pattern that gets accounts restricted.
 *   3. **Acceptance is the only door to messaging.** Enforced in
 *      `social-limits.canMessage`; repeated here as a refusal rather than
 *      trusted, because this module is what sets the clock that would fire it.
 *   4. **Two follow-ups, then stop.** `lead-routes.ts` promises this to the
 *      customer. Without a counter it was prose; `sequence_step` makes it a
 *      rule, and the ceiling is the workspace's, capped at two.
 *
 * ## What this deliberately does not decide
 *
 * Capacity, suppression and quiet hours. Those are re-checked immediately
 * before the action is performed, against live rows, by the code that performs
 * it -- a decision made here could be minutes or hours stale by the time a
 * person in ASSISTED mode actually clicks send.
 */

import {
  canInvite,
  canMessage,
  isTerminal,
  type SocialState,
} from "./social-limits.ts";

/** The workspace's autonomy settings, as stored on `business_data_controls`. */
export type SocialSequenceSettings = {
  /**
   * Days a pending invite may sit before it is withdrawn to free the
   * allowance. Null disables withdrawal entirely, which some workspaces want:
   * a withdrawn invite is a prospect you have spent and cannot re-approach.
   */
  withdrawAfterDays: number | null;
  /**
   * Days to wait for an acceptance before falling back to email.
   *
   * Deliberately much shorter than the withdrawal window. Acceptance rates
   * decay quickly, and silence on LinkedIn is not silence from the person --
   * a prospect with a good work email should be emailed rather than abandoned
   * because a connection request went unanswered. Null disables the fallback,
   * for a workspace running LinkedIn only.
   */
  skipToEmailAfterDays: number | null;
  /** Hours between the opening message and each follow-up. */
  followUpGapHours: number;
  /** Follow-ups after the opener. 0, 1 or 2. */
  maxFollowUps: number;
  /**
   * View the profile before asking to connect.
   *
   * A connection request from somebody who has never looked at your profile is
   * the coldest possible approach. Viewing first produces a "someone viewed
   * your profile" notification -- a real, permitted, no-cost touch -- so the
   * invite that follows lands on somebody who has already seen the name.
   *
   * Off by default: it spends one of the account's own rate-limited actions,
   * and that should be a choice.
   */
  warmBeforeInvite: boolean;
  /** Hours between the view and the invite. */
  warmDelayHours: number;
};

export const DEFAULT_SEQUENCE_SETTINGS: SocialSequenceSettings = {
  withdrawAfterDays: 30,
  // A week. Long enough that a genuine acceptance usually lands first, short
  // enough that a good prospect is not parked for a month.
  skipToEmailAfterDays: 7,
  followUpGapHours: 96,
  maxFollowUps: 2,
  warmBeforeInvite: false,
  // A day. Short enough that the view is still recent when the invite lands,
  // long enough that the two do not arrive together and read as a script.
  warmDelayHours: 24,
};

export type SocialSequenceInput = {
  state: SocialState;
  /** 0 = nothing sent since acceptance, 1 = opener sent, 2-3 = follow-ups. */
  sequenceStep: number;
  inviteSentAt: string | null;
  acceptedAt: string | null;
  /** When the last outbound message on this thread was actually sent. */
  lastOutboundAt: string | null;
  repliedAt: string | null;
  /**
   * Whether a composed message is already sitting unsent. In ASSISTED mode
   * this is the normal state for hours at a time, and composing a second one
   * on top of it is how a prospect receives two openers.
   */
  hasPendingDraft: boolean;
  /** True once the prospect has become a Lead; the agent owns it from there. */
  promoted: boolean;
  /**
   * Whether the email fallback has already been started for this prospect.
   *
   * Without it the decision would fire on every sweep between the skip window
   * and the withdrawal window, re-enrolling the prospect in email daily.
   */
  emailFallbackStarted: boolean;
  /** When the profile was viewed as a warming step, if it was. */
  warmedAt: string | null;
  settings: SocialSequenceSettings;
  now: Date;
};

export type SocialSequenceDecision =
  /**
   * View the profile, as a warming touch before the invite.
   *
   * Deliberately not a state change: a visit neither opens nor closes the
   * messaging gate, which is `ACCEPTED`'s job alone. It changes only the order
   * of the steps and whether the invite is the first thing the person sees.
   */
  | { action: "VISIT"; reason: string }
  /** Send a connection request. The note is decided by `shouldAttachNote`. */
  | { action: "INVITE"; reason: string }
  /** Withdraw a pending invite that has gone unanswered too long. */
  | { action: "WITHDRAW"; reason: string }
  /**
   * Stop waiting for LinkedIn and work this prospect by email instead.
   *
   * The invite is left standing -- it may still be accepted, and withdrawing
   * early would throw away that chance for nothing. This only says the sequence
   * should stop *waiting* on it.
   */
  | { action: "FALL_BACK_TO_EMAIL"; reason: string }
  /** Compose a message. `step` is what `sequence_step` becomes once sent. */
  | { action: "COMPOSE"; kind: "OPENER" | "FOLLOW_UP"; step: number; reason: string }
  /** Nothing to do yet. `nextActionAt` is when to look again. */
  | { action: "WAIT"; reason: string; nextActionAt: Date }
  /** Nothing more will ever be done. `next_action_at` is cleared. */
  | { action: "HALT"; reason: string };

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function parse(at: string | null): number | null {
  if (!at) return null;
  const ms = new Date(at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The highest `sequence_step` this workspace will ever reach.
 *
 * Step 1 is the opener, so two follow-ups means step 3. Clamped to the column's
 * own 0..3 check: a settings row edited past the ceiling must not produce a
 * decision the database will reject.
 */
export function finalStep(settings: SocialSequenceSettings): number {
  return Math.min(3, 1 + Math.max(0, Math.min(2, settings.maxFollowUps)));
}

export function decideSocialSequence(
  input: SocialSequenceInput,
): SocialSequenceDecision {
  const { state, settings, now } = input;
  const nowMs = now.getTime();

  // 1. Terminal platform states. Nothing here is recoverable, and retrying is
  //    what gets the account restricted rather than what wins the prospect.
  if (isTerminal(state)) {
    return {
      action: "HALT",
      reason:
        state === "DECLINED"
          ? "The invite was declined. Sending another is what gets accounts restricted, so this prospect is not approached again on this channel."
          : "This person has blocked the account.",
    };
  }

  // 2. A reply ends the sequence, whatever step it had reached. This is
  //    checked before anything about timing, because a follow-up that is
  //    technically due to someone who answered yesterday is the worst message
  //    the product can send.
  if (state === "REPLIED" || input.repliedAt) {
    return {
      action: "HALT",
      reason: "They replied. The conversation is owned by the agent from here, not by a schedule.",
    };
  }

  if (input.promoted) {
    return {
      action: "HALT",
      reason: "This prospect is now a Lead. Follow-Up owns the conversation.",
    };
  }

  // 3. One composed message at a time. In ASSISTED mode a draft waits for a
  //    person, and that wait is not a reason to compose another.
  if (input.hasPendingDraft) {
    return {
      action: "WAIT",
      reason: "A message is already composed and waiting to be sent.",
      nextActionAt: new Date(nowMs + 6 * HOUR_MS),
    };
  }

  // 4. A withdrawn invite is spent. `canInvite` allows re-inviting after a
  //    withdrawal because the platform does; the product does not, because we
  //    withdrew it precisely because they ignored us.
  if (state === "WITHDRAWN") {
    return {
      action: "HALT",
      reason:
        "The invite was withdrawn after going unanswered. Re-inviting someone who ignored the first request is what restricts an account.",
    };
  }

  // 5. Nothing sent yet: the connection request is the only way in.
  if (canInvite(state)) {
    if (settings.warmBeforeInvite) {
      const warmedAt = parse(input.warmedAt);

      if (warmedAt === null) {
        return {
          action: "VISIT",
          reason:
            "Viewing the profile first means the connection request arrives from a name they have already seen, rather than from a stranger.",
        };
      }

      // Viewed, but not long enough ago. A view and an invite landing in the
      // same minute is the pattern that reads as a script rather than a person.
      const inviteDueMs = warmedAt + settings.warmDelayHours * HOUR_MS;
      if (nowMs < inviteDueMs) {
        return {
          action: "WAIT",
          reason: "Profile viewed. The connection request follows shortly, rather than in the same moment.",
          nextActionAt: new Date(inviteDueMs),
        };
      }
    }

    return {
      action: "INVITE",
      reason: "No connection request has been sent yet, and a message is impossible before one is accepted.",
    };
  }

  // 6. Invite out, waiting on them.
  //
  // Two clocks run here, and conflating them was the design error this branch
  // used to contain. An unanswered invite raises two separate questions:
  //
  //   * **"Should we stop waiting for LinkedIn?"** -- answered by
  //     `skipToEmailAfterDays`, and the answer is soon. Acceptance rates decay
  //     fast; a fortnight of silence is a no. But a no *on LinkedIn* is not a
  //     no from the person, and the previous version treated it as one: the row
  //     sat untouched until the withdrawal window and then died, so a prospect
  //     with a perfectly good work email was never emailed because a connection
  //     request went unanswered.
  //   * **"Should we take the invite back?"** -- answered by
  //     `withdrawAfterDays`, and the answer is later. LinkedIn caps *outstanding*
  //     invitations, so a pending one costs something even while it waits.
  //
  // Splitting them is what lets the sequence fall back to email early while
  // still letting the invite stand a while longer in case it is accepted late.
  if (state === "INVITE_SENT" || state === "INVITE_QUEUED") {
    const sentAt = parse(input.inviteSentAt);

    // An INVITE_SENT row with no timestamp cannot be aged. Treating it as
    // stale would withdraw a request sent an hour ago; treating it as fresh
    // leaks the allowance forever. Look again tomorrow -- by then whatever
    // writes the timestamp will have.
    if (sentAt === null) {
      return {
        action: "WAIT",
        reason: "Invite sent, but with no recorded time, so its age cannot be judged yet.",
        nextActionAt: new Date(nowMs + DAY_MS),
      };
    }

    const skipMs =
      settings.skipToEmailAfterDays === null
        ? null
        : sentAt + settings.skipToEmailAfterDays * DAY_MS;

    const withdrawMs =
      settings.withdrawAfterDays === null
        ? null
        : sentAt + settings.withdrawAfterDays * DAY_MS;

    // Withdrawal first when both are due: taking the invite back is the more
    // consequential of the two, and a row that reaches both at once should not
    // sit pending for another cycle.
    if (withdrawMs !== null && nowMs >= withdrawMs) {
      return {
        action: "WITHDRAW",
        reason: `Unanswered for ${settings.withdrawAfterDays} days. Withdrawing frees one of the outstanding invitations LinkedIn allows the account to have open.`,
      };
    }

    if (skipMs !== null && nowMs >= skipMs && !input.emailFallbackStarted) {
      return {
        action: "FALL_BACK_TO_EMAIL",
        reason: `No answer to the connection request after ${settings.skipToEmailAfterDays} days. LinkedIn messaging stays shut, so this prospect moves to email instead of stopping here.`,
      };
    }

    // Whichever clock is next. Null means that clock is disabled, and both
    // being disabled means nothing is scheduled -- the invite stands until the
    // recipient acts or somebody intervenes.
    const next = [skipMs, withdrawMs]
      .filter((at): at is number => at !== null && at > nowMs)
      .sort((a, b) => a - b)[0];

    if (next === undefined) {
      return {
        action: "WAIT",
        reason: "Invite sent. Nothing further is scheduled for this prospect on LinkedIn.",
        nextActionAt: new Date(nowMs + 7 * DAY_MS),
      };
    }

    return {
      action: "WAIT",
      reason: "Invite sent. Nothing can be messaged on LinkedIn until it is accepted.",
      nextActionAt: new Date(next),
    };
  }

  // 7. Past the gate. Everything from here is messaging.
  if (!canMessage(state)) {
    // Unreachable given the states above, and left as a refusal rather than a
    // fallthrough: a new state added to SOCIAL_STATES must not silently
    // acquire permission to message.
    return {
      action: "HALT",
      reason: `No rule covers the state ${state}, so nothing is sent.`,
    };
  }

  const ceiling = finalStep(settings);

  if (input.sequenceStep >= ceiling) {
    return {
      action: "HALT",
      reason:
        ceiling === 1
          ? "The opening message was sent and this workspace sends no follow-ups."
          : `The opening message and ${ceiling - 1} follow-up${ceiling - 1 === 1 ? "" : "s"} went unanswered. The sequence stops here rather than continuing to chase.`,
    };
  }

  // 8. The opener. Due as soon as the invite is accepted -- the acceptance is
  //    itself a signal, and a gap after it wastes the only warm moment the
  //    channel offers.
  if (input.sequenceStep === 0) {
    return {
      action: "COMPOSE",
      kind: "OPENER",
      step: 1,
      reason: "They accepted the connection request, so a message will now actually arrive.",
    };
  }

  // 9. A follow-up, spaced from the last thing they were actually sent.
  //    Measured from `lastOutboundAt` rather than acceptance so a delayed
  //    ASSISTED send does not collapse two messages into the same afternoon.
  const lastOut = parse(input.lastOutboundAt) ?? parse(input.acceptedAt);
  if (lastOut === null) {
    return {
      action: "WAIT",
      reason: "Nothing recorded about when the last message went, so the gap cannot be measured.",
      nextActionAt: new Date(nowMs + DAY_MS),
    };
  }

  const dueMs = lastOut + settings.followUpGapHours * HOUR_MS;
  if (nowMs < dueMs) {
    return {
      action: "WAIT",
      reason: `Follow-up ${input.sequenceStep} of ${ceiling - 1} is not due yet.`,
      nextActionAt: new Date(dueMs),
    };
  }

  return {
    action: "COMPOSE",
    kind: "FOLLOW_UP",
    step: input.sequenceStep + 1,
    reason: `No reply to the previous message after ${settings.followUpGapHours} hours.`,
  };
}

/**
 * How many consecutive failures a row may accumulate before it is parked.
 *
 * A row that keeps failing is not merely noisy: each attempt consumes a slot
 * in the sweep and, if it fails *after* the cap was decremented, an invite the
 * account will never get back. Parking is recoverable -- `parked_reason` is
 * cleared by a person or by the row changing state -- which is why the ceiling
 * is low.
 */
export const MAX_SEQUENCE_ATTEMPTS = 5;

/**
 * The `next_action` value the database column takes for a decision.
 *
 * Kept as an explicit mapping rather than reusing `decision.action` directly,
 * because the two vocabularies answer different questions. The decision says
 * what the sequencer concluded, including conclusions that are not actions at
 * all (WAIT, HALT); the column says what the sweeper will attempt when the
 * clock next fires, and its check constraint refuses anything that is not one
 * of four verbs. `MESSAGE` and `FOLLOW_UP` are separate values there because
 * `social_connection_states_message_needs_acceptance` gates both on the state,
 * and the queue shown to a customer distinguishes an opener from a chase.
 */
export function nextActionFor(
  decision: SocialSequenceDecision,
): "INVITE" | "MESSAGE" | "FOLLOW_UP" | "WITHDRAW" | "VISIT" | null {
  switch (decision.action) {
    case "VISIT":
      return "VISIT";
    case "INVITE":
      return "INVITE";
    case "WITHDRAW":
      return "WITHDRAW";
    // Not a LinkedIn action at all, so the column that describes what the
    // sweeper will do on this platform has nothing to record.
    case "FALL_BACK_TO_EMAIL":
      return null;
    case "COMPOSE":
      return decision.kind === "OPENER" ? "MESSAGE" : "FOLLOW_UP";
    // A wait keeps whatever intent it is waiting for; the caller preserves the
    // existing column rather than clearing it, so a paused queue still shows
    // what it intends to do. A halt clears it.
    case "WAIT":
    case "HALT":
      return null;
  }
}

/**
 * Where the row's clock should be set to after a decision.
 *
 * `HALT` clears it, which is what keeps the due-work index small: a finished
 * or dead thread stops being swept forever rather than being re-examined
 * nightly for the life of the workspace. Actions that need performing keep the
 * clock at now, so a failed attempt is retried on the next sweep rather than
 * being dropped.
 */
export function nextActionAtFor(decision: SocialSequenceDecision, now: Date): Date | null {
  switch (decision.action) {
    case "HALT":
      return null;
    case "WAIT":
      return decision.nextActionAt;
    default:
      return now;
  }
}
