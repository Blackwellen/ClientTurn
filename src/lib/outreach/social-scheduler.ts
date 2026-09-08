import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  dueForPrivateReply,
  sendOnePrivateReply,
} from "@/lib/social/private-replies";
import { enqueue } from "@/lib/jobs/queue";
import { evaluate } from "@/lib/policy/service";
import { composeSocialMessage } from "./social-composer";
import {
  DEFAULT_SEQUENCE_SETTINGS,
  MAX_SEQUENCE_ATTEMPTS,
  decideSocialSequence,
  nextActionAtFor,
  nextActionFor,
  type SocialSequenceDecision,
  type SocialSequenceSettings,
} from "./social-sequence";
import {
  listSocialAccounts,
  planSocialAction,
  recordSocialAction,
  type SocialAccount,
} from "./social-outreach";
import {
  marketingGateApplies,
  shouldAttachNote,
  type SocialPlatform,
} from "./social-limits";

/**
 * The thing that was missing: something that advances social outreach without
 * anybody clicking.
 *
 * 0067 built a correct state machine and 0072 gave it a clock. This is the
 * sweeper that reads the clock. It runs from `social.tick`, which the worker
 * queues on the same five-minute bucket as `outreach.tick`.
 *
 * ## Two layers, on purpose
 *
 *   * `sweepDueSocialWork()` finds *which workspaces* have due rows and fans
 *     out one job each. One job holding every workspace's caps would mean a
 *     single restricted LinkedIn account stalling every other customer.
 *   * `advanceSocialWorkspace()` does one workspace's due rows, oldest first,
 *     bounded. Every action re-reads live state immediately before performing
 *     it, because in ASSISTED mode hours pass between a decision and its
 *     execution.
 *
 * ## What "performing" means here
 *
 * This module never touches a social platform. In `ASSISTED` mode -- the
 * default, and the only mode that is unambiguously within every platform's
 * terms -- performing means *composing the message and putting it in the
 * queue a person works from*. That is the honest reading of "runs 24/7": the
 * deciding, the drafting, the timing, the cap arithmetic and the stop
 * conditions all run unattended around the clock, and a human performs the
 * final click. `PARTNER_API` accounts in a workspace that has opted into
 * `social_autonomous_sending` have that last step performed for them, through
 * exactly the same checks.
 *
 * Being clear about that boundary is the whole point. A product that claimed
 * to send LinkedIn messages autonomously from a personal account would be
 * describing something that gets the customer's account restricted.
 */

/** How many workspaces one sweep fans out to. */
const MAX_WORKSPACES_PER_SWEEP = 200;

/** How many prospects one workspace job advances. Bounded so a backlog drains
 *  over several ticks rather than one job running until the worker is killed. */
const MAX_ROWS_PER_WORKSPACE = 40;

/* --------------------------------------------------------------- the sweep */

export async function sweepDueSocialWork(): Promise<{ workspaces: number }> {
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("social_businesses_with_due_work", {
    p_limit: MAX_WORKSPACES_PER_SWEEP,
  });

  if (error || !data) return { workspaces: 0 };

  let queued = 0;
  for (const row of data) {
    // Bucketed by minute: a sweep that runs more often than necessary queues
    // nothing extra, matching `scheduleOutreachTick`.
    const bucket = Math.floor(Date.now() / 60_000);
    const id = await enqueue(
      "social.advance",
      { businessId: row.business_id },
      {
        businessId: row.business_id,
        priority: 60,
        maxAttempts: 3,
        idempotencyKey: `social.advance:${row.business_id}:${bucket}`,
      },
    );
    if (id) queued += 1;
  }

  return { workspaces: queued };
}

/* ------------------------------------------------------------- one workspace */

type DueRow = {
  id: string;
  prospect_id: string;
  platform: string;
  state: string;
  sequence_step: number;
  attempts: number;
  autopilot: boolean;
  invite_sent_at: string | null;
  accepted_at: string | null;
  last_outbound_at: string | null;
  replied_at: string | null;
  email_fallback_at: string | null;
  warmed_at: string | null;
};

async function loadSettings(businessId: string): Promise<SocialSequenceSettings & {
  autonomous: boolean;
}> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("business_data_controls")
    .select(
      "social_autonomous_sending, social_withdraw_after_days, social_skip_to_email_after_days, social_follow_up_gap_hours, social_max_follow_ups, social_warm_before_invite, social_warm_delay_hours",
    )
    .eq("business_id", businessId)
    .maybeSingle();

  return {
    withdrawAfterDays:
      data?.social_withdraw_after_days ?? DEFAULT_SEQUENCE_SETTINGS.withdrawAfterDays,
    skipToEmailAfterDays:
      data?.social_skip_to_email_after_days ??
      DEFAULT_SEQUENCE_SETTINGS.skipToEmailAfterDays,
    followUpGapHours:
      data?.social_follow_up_gap_hours ?? DEFAULT_SEQUENCE_SETTINGS.followUpGapHours,
    maxFollowUps: data?.social_max_follow_ups ?? DEFAULT_SEQUENCE_SETTINGS.maxFollowUps,
    warmBeforeInvite:
      data?.social_warm_before_invite ?? DEFAULT_SEQUENCE_SETTINGS.warmBeforeInvite,
    warmDelayHours:
      data?.social_warm_delay_hours ?? DEFAULT_SEQUENCE_SETTINGS.warmDelayHours,
    autonomous: Boolean(data?.social_autonomous_sending),
  };
}

export type AdvanceOutcome = {
  examined: number;
  composed: number;
  withdrawn: number;
  halted: number;
  waiting: number;
  parked: number;
  /** Private replies actually delivered to commenters this pass. */
  privateReplies: number;
  /** Invites that gave up on LinkedIn and moved to email. */
  handedToEmail: number;
  /** Profiles viewed as a warming touch before an invite. */
  visited: number;
};

export async function advanceSocialWorkspace(
  businessId: string,
): Promise<AdvanceOutcome> {
  const admin = createAdminClient();
  const outcome: AdvanceOutcome = {
    examined: 0,
    composed: 0,
    withdrawn: 0,
    halted: 0,
    waiting: 0,
    parked: 0,
    privateReplies: 0,
    handedToEmail: 0,
    visited: 0,
  };

  const [settings, accounts] = await Promise.all([
    loadSettings(businessId),
    listSocialAccounts(businessId),
  ]);

  const { data: rows, error } = await admin
    .from("social_connection_states")
    .select(
      "id, prospect_id, platform, state, sequence_step, attempts, autopilot, invite_sent_at, accepted_at, last_outbound_at, replied_at, email_fallback_at, warmed_at",
    )
    .eq("business_id", businessId)
    .not("next_action_at", "is", null)
    .lte("next_action_at", new Date().toISOString())
    .is("parked_reason", null)
    .not("state", "in", "(DECLINED,BLOCKED)")
    .order("next_action_at", { ascending: true })
    .limit(MAX_ROWS_PER_WORKSPACE);

  /**
   * A failed due-work query must throw, never read as "nothing to do".
   *
   * This is not defensive tidying — it is the fix for a bug that had the whole
   * channel silently dead. A column named here that does not exist in the
   * database (a migration written but not applied, which is exactly what
   * happened with `warmed_at`) makes PostgREST return an error and no rows.
   * Destructuring only `data` turned that into an empty list, the loop ran zero
   * times, and the job reported `completed`. Every signal said healthy while
   * nothing was being sent.
   *
   * Throwing puts it in `jobs.last_error` where the worker records failures and
   * the Admin → System page shows them, which is the difference between a
   * broken deploy that announces itself and one nobody notices for a week.
   */
  if (error) {
    throw new Error(
      `Could not read due social work for ${businessId}: ${error.message}`,
    );
  }

  for (const row of (rows ?? []) as DueRow[]) {
    outcome.examined += 1;
    try {
      const result = await advanceOne({ businessId, row, settings, accounts });
      // `AdvanceResult` is exactly the set of counter names, so this is total
      // by construction -- adding an outcome without a counter fails to
      // compile rather than silently going uncounted.
      outcome[result] += 1;
    } catch {
      // One bad row must never stop the rest of the workspace's queue. The
      // attempt counter is what eventually parks it, so the failure is
      // recorded rather than merely swallowed.
      await recordFailure(businessId, row);
      outcome.parked += 1;
    }
  }

  // Meta commenters, which are not a state machine at all.
  //
  // Kept as a separate pass rather than folded into the loop above because
  // they share none of its mechanics: no invitation, no acceptance to wait
  // for, no follow-up, and a limit of one message per comment rather than a
  // daily allowance. Bending `social_connection_states` around them would make
  // both harder to reason about, and this is the pass that has a deadline —
  // the seven-day window is the only clock in the product that expires
  // silently.
  outcome.privateReplies = await advancePrivateReplies(businessId);

  return outcome;
}

/**
 * Answers the commenters whose window is still open.
 *
 * Bounded per pass rather than draining the backlog: the sweep runs every five
 * minutes, so a workspace with a large backlog works through it steadily
 * instead of one job spending minutes inside Meta's API and holding up every
 * other workspace behind it.
 */
async function advancePrivateReplies(businessId: string): Promise<number> {
  const business = await loadBusinessName(businessId);
  if (!business) return 0;

  const candidates = await dueForPrivateReply(businessId, PRIVATE_REPLIES_PER_PASS);
  let sent = 0;

  for (const candidate of candidates) {
    try {
      const result = await sendOnePrivateReply({
        businessId,
        businessName: business.name,
        candidate,
      });
      if (result.status === "SENT") sent += 1;
    } catch {
      // A refusal is already reported as SKIPPED or FAILED without throwing, so
      // reaching here means something unexpected. The one permitted reply has
      // been claimed either way, which is the safe direction: a message nobody
      // sent is recoverable, a second attempt against the same comment is not.
      continue;
    }
  }

  return sent;
}

/** How many commenters one pass will answer. See `advancePrivateReplies`. */
const PRIVATE_REPLIES_PER_PASS = 10;

async function loadBusinessName(
  businessId: string,
): Promise<{ name: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .maybeSingle();
  return data ?? null;
}

async function recordFailure(businessId: string, row: DueRow): Promise<void> {
  const admin = createAdminClient();
  const attempts = row.attempts + 1;
  const parked = attempts >= MAX_SEQUENCE_ATTEMPTS;

  await admin
    .from("social_connection_states")
    .update({
      attempts,
      // Backed off rather than retried immediately: whatever failed is
      // unlikely to be fixed within seconds, and a tight retry loop burns the
      // sweep's row budget on one broken prospect.
      next_action_at: parked
        ? null
        : new Date(Date.now() + attempts * 3600_000).toISOString(),
      parked_reason: parked
        ? `Stopped after ${attempts} failed attempts. Nothing further will be tried on this prospect until someone looks at it.`
        : null,
    })
    .eq("business_id", businessId)
    .eq("id", row.id);
}

/* ------------------------------------------------------------- one prospect */

type AdvanceContext = {
  businessId: string;
  row: DueRow;
  settings: SocialSequenceSettings & { autonomous: boolean };
  accounts: SocialAccount[];
};

type AdvanceResult =
  | "composed"
  | "withdrawn"
  | "halted"
  | "waiting"
  | "parked"
  | "handedToEmail"
  | "visited";

async function advanceOne(context: AdvanceContext): Promise<AdvanceResult> {
  const { businessId, row, settings } = context;
  const admin = createAdminClient();
  const platform = row.platform as SocialPlatform;
  const now = new Date();

  // Is a composed message already sitting unsent? Read live rather than joined
  // into the due query: in ASSISTED mode a colleague may have sent or
  // discarded it since the sweep started.
  const [{ data: pending }, { data: prospect }] = await Promise.all([
    admin
      .from("social_outbound_messages")
      .select("id")
      .eq("business_id", businessId)
      .eq("prospect_id", row.prospect_id)
      .eq("platform", platform)
      .eq("status", "DRAFT")
      .maybeSingle(),
    admin
      .from("prospects")
      .select("id, promoted_to_lead_id, outreach_eligibility")
      .eq("business_id", businessId)
      .eq("id", row.prospect_id)
      .maybeSingle(),
  ]);

  const decision = decideSocialSequence({
    state: row.state as never,
    sequenceStep: row.sequence_step,
    inviteSentAt: row.invite_sent_at,
    acceptedAt: row.accepted_at,
    lastOutboundAt: row.last_outbound_at,
    repliedAt: row.replied_at,
    hasPendingDraft: Boolean(pending),
    promoted: Boolean(prospect?.promoted_to_lead_id),
    emailFallbackStarted: Boolean(row.email_fallback_at),
    warmedAt: row.warmed_at,
    settings,
    now,
  });

  // Suppression outranks the sequence entirely, and is checked here rather
  // than inside `decideSocialSequence` because it is a live database fact, not
  // a property of the state machine. A prospect suppressed since the last
  // sweep must halt even if the sequence says a follow-up is due.
  if (prospect?.outreach_eligibility === "SUPPRESSED") {
    return halt(
      businessId,
      row,
      "This prospect has opted out of all contact. Social is not a route around an opt-out.",
    );
  }

  switch (decision.action) {
    case "HALT":
      return halt(businessId, row, decision.reason);

    case "WAIT":
      await admin
        .from("social_connection_states")
        .update({
          next_action_at: nextActionAtFor(decision, now)?.toISOString() ?? null,
          attempts: 0,
        })
        .eq("business_id", businessId)
        .eq("id", row.id);
      return "waiting";

    case "WITHDRAW":
      return withdraw(context, decision);

    case "FALL_BACK_TO_EMAIL":
      return fallBackToEmail(context, decision);

    case "VISIT":
      return visitProfile(context);

    case "INVITE":
    case "COMPOSE":
      return compose(context, decision);
  }
}

async function halt(
  businessId: string,
  row: DueRow,
  reason: string,
): Promise<AdvanceResult> {
  const admin = createAdminClient();

  await admin
    .from("social_connection_states")
    .update({ next_action_at: null, next_action: null, halted_reason: reason })
    .eq("business_id", businessId)
    .eq("id", row.id);

  // A halt while a message is still composed means that message must not be
  // sent. This is the branch that stops a follow-up reaching somebody who
  // replied an hour ago, and it is the single most important write in the file.
  await admin
    .from("social_outbound_messages")
    .update({ status: "DISCARDED", discarded_reason: reason })
    .eq("business_id", businessId)
    .eq("prospect_id", row.prospect_id)
    .eq("status", "DRAFT");

  return "halted";
}

async function withdraw(
  context: AdvanceContext,
  decision: SocialSequenceDecision & { action: "WITHDRAW" },
): Promise<AdvanceResult> {
  const { businessId, row } = context;
  const admin = createAdminClient();
  const platform = row.platform as SocialPlatform;

  const account = context.accounts.find(
    (candidate) => candidate.platform === platform && candidate.status === "ACTIVE",
  );

  // A withdrawal is bookkeeping on our side and a click on the platform's. It
  // is recorded either way: the allowance it frees is counted from our log, and
  // an invite we have stopped chasing must not keep occupying the queue merely
  // because nobody has performed the click yet.
  await admin
    .from("social_connection_states")
    .update({
      state: "WITHDRAWN",
      withdrawn_at: new Date().toISOString(),
      next_action_at: null,
      next_action: null,
      halted_reason: decision.reason,
    })
    .eq("business_id", businessId)
    .eq("id", row.id);

  if (account) {
    await admin.from("social_action_log").insert({
      business_id: businessId,
      account_id: account.id,
      prospect_id: row.prospect_id,
      platform,
      action: "WITHDRAW",
      performed_by: account.sendMode,
      actor_user_id: null,
    });
  }

  return "withdrawn";
}

/**
 * Stop waiting for LinkedIn; work this prospect by email instead.
 *
 * The invite is deliberately **left standing**. It may still be accepted -- late
 * acceptances are common -- and withdrawing early would spend the prospect for
 * nothing. `markSocialAccepted` still fires if they accept, and the row picks
 * the LinkedIn sequence back up from there.
 *
 * What changes is only that the sequencer stops treating an unanswered invite
 * as a dead end. The email side is the existing cold-outreach path, which
 * re-checks contactability, caps and the Article 14 disclosure itself -- so
 * this marks the prospect as available to it rather than sending anything.
 */
/**
 * Views the prospect's profile, as the warming touch before an invite.
 *
 * In ASSISTED mode this is queued like everything else -- the person opens the
 * profile from the queue, which is the visit. There is nothing to compose, so
 * it records the intent and the timestamp and lets the invite follow on the
 * next sweep once the delay has passed.
 */
async function visitProfile(context: AdvanceContext): Promise<AdvanceResult> {
  const { businessId, row } = context;
  const admin = createAdminClient();
  const now = new Date();
  const platform = row.platform as SocialPlatform;

  const account = context.accounts.find(
    (candidate) => candidate.platform === platform && candidate.status === "ACTIVE",
  );

  await admin
    .from("social_connection_states")
    .update({
      warmed_at: now.toISOString(),
      next_action: "INVITE",
      // The invite becomes due once the delay has passed, not immediately.
      next_action_at: new Date(
        now.getTime() + context.settings.warmDelayHours * 3_600_000,
      ).toISOString(),
      attempts: 0,
    })
    .eq("business_id", businessId)
    .eq("id", row.id);

  // Logged like any other action: LinkedIn rate-limits profile views too, and a
  // limit counted from anything other than what happened is not a limit.
  if (account) {
    await admin.from("social_action_log").insert({
      business_id: businessId,
      account_id: account.id,
      prospect_id: row.prospect_id,
      platform,
      action: "VISIT",
      performed_by: account.sendMode,
      actor_user_id: null,
    });
  }

  return "visited";
}

async function fallBackToEmail(
  context: AdvanceContext,
  decision: SocialSequenceDecision & { action: "FALL_BACK_TO_EMAIL" },
): Promise<AdvanceResult> {
  const { businessId, row } = context;
  const admin = createAdminClient();
  const now = new Date().toISOString();

  await admin
    .from("social_connection_states")
    .update({
      email_fallback_at: now,
      halted_reason: decision.reason,
      // Still on the clock: the withdrawal window has not passed, and a late
      // acceptance is worth acting on. Cleared only by a withdraw or a halt.
      next_action_at: context.settings.withdrawAfterDays
        ? new Date(
            new Date(row.invite_sent_at ?? now).getTime() +
              context.settings.withdrawAfterDays * 86_400_000,
          ).toISOString()
        : null,
    })
    .eq("business_id", businessId)
    .eq("id", row.id);

  // Eligible for the email path. The dispatcher decides whether it may
  // actually send -- this only says LinkedIn is no longer the thing being
  // waited on.
  await admin
    .from("prospects")
    .update({ last_activity_at: now })
    .eq("business_id", businessId)
    .eq("id", row.prospect_id);

  return "handedToEmail";
}

async function compose(
  context: AdvanceContext,
  decision: SocialSequenceDecision & { action: "INVITE" | "COMPOSE" },
): Promise<AdvanceResult> {
  const { businessId, row } = context;
  const admin = createAdminClient();
  const platform = row.platform as SocialPlatform;

  // Re-plan against live rows. `decideSocialSequence` knows about time;
  // `planSocialAction` knows about caps, account health and suppression, and
  // both have to agree before anything is composed.
  const plan = await planSocialAction(businessId, row.prospect_id, platform);

  if (plan.action === "BLOCKED") {
    return halt(businessId, row, plan.reason);
  }

  if (plan.action === "WAIT") {
    // Out of allowance, almost always. Try again after the cap window turns
    // over rather than burning the next sweep on the same refusal.
    await admin
      .from("social_connection_states")
      .update({
        next_action_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
        halted_reason: null,
      })
      .eq("business_id", businessId)
      .eq("id", row.id);
    return "waiting";
  }

  // Contactability, one last time, through the same engine every other channel
  // uses. `SOCIAL` is a first-class policy channel, so a prospect blocked for
  // an unpermitted source or an unstated lawful basis is blocked here too.
  //
  // `permissionOnly` because the caps that matter on this channel are the
  // platform's, and those were just checked by `planSocialAction` against the
  // account's own allowance. Asking the email-shaped cap logic as well would
  // block a LinkedIn invite because a mailbox was at its daily limit.
  const isInvite = decision.action === "INVITE";

  /**
   * Which regime applies, and it is not the same for both halves of this
   * channel.
   *
   * The **connection or follow request** is unsolicited contact with somebody
   * who has not asked for it, so it is judged as COLD.
   *
   * The **message after acceptance** is not. The schema will not let a message
   * exist until `state` reaches ACCEPTED, so by this point the recipient has
   * been asked to connect and has said yes, and `markSocialAccepted` has
   * recorded that as an ACCEPTED_SOCIAL_CONNECTION relationship. Calling that
   * cold would be inaccurate in the direction that breaks the product: the warm
   * rules still demand a recorded relationship, which is exactly the check that
   * should be governing here.
   */
  const verdict = await evaluate({
    businessId,
    subject: { type: "PROSPECT", id: row.prospect_id, social: plan.profileUrl },
    channel: "SOCIAL",
    campaignType: isInvite ? "COLD" : "WARM",
    permissionOnly: true,
  });

  /**
   * A bare connection request is not a marketing communication.
   *
   * This exemption is narrow and it is the only one in the file, so it is worth
   * stating exactly what it does and why it is not a way round the rules.
   *
   * `BLOCKED_COLD_CHANNEL` means "this channel may not carry cold marketing".
   * No pack lists SOCIAL as a cold channel and none should: a cold DM to a
   * stranger is precisely what the gate exists to refuse. But a *follow* on
   * TikTok, or a connection request with no note on LinkedIn, transmits no
   * content at all — the recipient gets "X started following you". There is
   * nothing in it to be marketing. Judging it by the rules for a marketing
   * message is a category error, and one that makes the channel impossible:
   * the invite is the only route to the acceptance that makes a lawful message
   * possible, so refusing every invite refuses the whole channel.
   *
   * The codebase already draws this line elsewhere — `visitProfile` performs a
   * profile view without consulting the engine at all, for the same reason.
   * This is the same principle, applied to the same kind of action, but kept
   * inside the engine so the decision is still evaluated and recorded.
   *
   * The moment an invite carries a note it is content, it is marketing, and
   * this exemption does not apply — `carriesNote` is what separates them.
   * Everything else the engine refuses still refuses: suppression, opt-out,
   * withdrawn consent, an unpermitted source, a blocked subscriber type. Only
   * this one reason code, and only for a contentless request.
   */
  const carriesNote = plan.action === "INVITE" && plan.attachNote;
  const contentlessRequest = !marketingGateApplies({
    action: isInvite ? "INVITE" : "MESSAGE",
    carriesNote,
  });
  const coldChannelOnly =
    verdict.outcome === "BLOCKED" && verdict.reasonCode === "BLOCKED_COLD_CHANNEL";

  const permitted =
    verdict.outcome === "ALLOWED" ||
    verdict.outcome === "REVIEW_REQUIRED" ||
    (contentlessRequest && coldChannelOnly);

  // REVIEW_REQUIRED is not a refusal, but it is not a licence to act
  // unattended either: the message is still composed and queued for a person,
  // and only the autonomous path is stopped. Anything else non-ALLOWED halts.
  if (!permitted) {
    return halt(businessId, row, verdict.message);
  }
  const needsReview = verdict.outcome === "REVIEW_REQUIRED";

  const account = context.accounts.find(
    (candidate) => candidate.platform === platform && candidate.status === "ACTIVE",
  );
  if (!account) {
    return halt(
      businessId,
      row,
      `No active ${platform.toLowerCase()} account is connected to send from.`,
    );
  }

  const step = isInvite ? 0 : decision.step;
  const kind = isInvite
    ? "INVITE_NOTE"
    : decision.kind === "OPENER"
      ? "OPENER"
      : "FOLLOW_UP";

  // An invite only carries a note when the account still has one to spend.
  // Composing a note that cannot be attached would put words in the queue that
  // the person sending it has nowhere to paste.
  const note = isInvite ? shouldAttachNote(account.capacity, platform) : null;
  if (isInvite && note && !note.attach) {
    /**
     * Only a *lost* capability is worth telling the operator about.
     *
     * `shouldAttachNote` answers two different questions with the same field.
     * On LinkedIn a refusal means "you have run out of invitation notes this
     * month", which changes what the invite will achieve and is worth saying.
     * Everywhere else it means "this platform has no such thing as an
     * invitation note" — true, permanent, and not news to anybody looking at a
     * TikTok queue.
     *
     * Passing the second one through put "This platform has no invitation
     * note." in the queue where the operator needed "go and send the follow",
     * and because it is never null on those platforms it displaced that
     * sentence entirely rather than sitting alongside it.
     */
    const worthSaying = platform === "LINKEDIN" ? note.reason : null;
    return performBareInvite(context, account, worthSaying);
  }

  const composed = await composeSocialMessage({
    businessId,
    prospectId: row.prospect_id,
    platform,
    kind,
    step: Math.max(1, step),
    // Stable across retries: the same prospect at the same step is the same
    // message, and a retried job must not be billed for it twice.
    idempotencyKey: `social:${row.prospect_id}:${platform}:${kind}:${step}`,
  });

  if (!composed) {
    return halt(
      businessId,
      row,
      "The prospect record could not be read, so no message was composed.",
    );
  }

  const { error } = await admin.from("social_outbound_messages").insert({
    business_id: businessId,
    prospect_id: row.prospect_id,
    account_id: account.id,
    platform,
    kind,
    sequence_step: step,
    body: composed.body,
    status: "DRAFT",
    composed_by: composed.composedBy,
    model_ref: composed.modelRef,
    last_error: composed.fallbackReason,
    performed_by: account.sendMode,
  });

  // A unique violation means a concurrent sweep composed it first, which is
  // the outcome the index exists to produce. Not an error.
  if (error && error.code !== "23505") throw error;

  await admin
    .from("social_connection_states")
    .update({
      next_action: nextActionFor(decision),
      // Re-examined in six hours. In ASSISTED mode that is when we check
      // whether a person actually performed it; in autonomous mode the
      // executor will have moved the row on long before then.
      next_action_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
      attempts: 0,
      halted_reason: null,
    })
    .eq("business_id", businessId)
    .eq("id", row.id);

  // Autonomous workspaces with a partner integration have the send performed
  // for them. Everyone else has it performed by a person from the queue, which
  // is why nothing further happens here.
  if (
    context.settings.autonomous &&
    account.sendMode === "PARTNER_API" &&
    !needsReview
  ) {
    await enqueue(
      "social.execute",
      { businessId, prospectId: row.prospect_id, platform },
      {
        businessId,
        priority: 55,
        maxAttempts: 3,
        idempotencyKey: `social.execute:${row.prospect_id}:${platform}:${step}`,
      },
    );
  }

  return "composed";
}

/**
 * An invite with no note.
 *
 * Worth its own path rather than an empty-bodied message row: there is nothing
 * for a person to paste, so putting it in the message queue would show them a
 * blank card. `recordSocialAction` re-checks the caps itself, which is why the
 * state write is left entirely to it.
 */
async function performBareInvite(
  context: AdvanceContext,
  account: SocialAccount,
  reason: string | null,
): Promise<AdvanceResult> {
  const { businessId, row } = context;
  const admin = createAdminClient();

  // Only an account that sends through a partner integration can perform this
  // unattended. An ASSISTED account has the invite waiting in its queue, where
  // `loadSocialQueue` already lists it.
  if (!(context.settings.autonomous && account.sendMode === "PARTNER_API")) {
    await admin
      .from("social_connection_states")
      .update({
        next_action: "INVITE",
        next_action_at: new Date(Date.now() + 12 * 3600_000).toISOString(),
        // The instruction always leads. A note constraint, where there is one,
        // is added to it rather than replacing it — the operator needs to know
        // what to do before they need to know what it will not carry.
        halted_reason: reason
          ? `Waiting for someone to send the connection request from the connected account. ${reason}`
          : "Waiting for someone to send the connection request from the connected account.",
      })
      .eq("business_id", businessId)
      .eq("id", row.id);
    return "waiting";
  }

  const recorded = await recordSocialAction({
    businessId,
    prospectId: row.prospect_id,
    platform: row.platform as SocialPlatform,
    accountId: account.id,
    action: "INVITE",
    noteBody: null,
    performedBy: "PARTNER_API",
    actorUserId: null,
  });

  if (!recorded.ok) return halt(businessId, row, recorded.error);

  await admin
    .from("social_connection_states")
    .update({ next_action: null, next_action_at: null, attempts: 0 })
    .eq("business_id", businessId)
    .eq("id", row.id);

  return "composed";
}
