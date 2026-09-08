import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordSocialAcceptance } from "./social-relationship";
import {
  canInvite,
  canMessage,
  isTerminal,
  limitsFor,
  shouldAttachNote,
  socialCapacity,
  MAX_INVITE_NOTE_CHARS,
  MAX_SOCIAL_MESSAGE_CHARS,
  type SocialAccountTier,
  type SocialCapacity,
  type SocialPlatform,
  type SocialState,
} from "./social-limits";

/**
 * Social outreach: connect, wait, message.
 *
 * The rules this module exists to enforce, in the order they bite:
 *
 *   1. **The platform's gate.** A message before acceptance is impossible on
 *      LinkedIn and invisible on Meta. `canMessage` is checked immediately
 *      before every send, not when the campaign was planned.
 *   2. **The account's limits.** Exceeding them restricts the customer's
 *      personal account, which is a far worse outcome than a slow campaign.
 *      Counted from the append-only action log, so a cap can never disagree
 *      with what actually happened.
 *   3. **Contactability.** A suppressed prospect is suppressed on every
 *      channel. Social is not a way around an opt-out.
 *
 * Note on how the action reaches the platform: an account in `ASSISTED` mode
 * has everything prepared here and a person performs it. That is the default,
 * because automating a personal LinkedIn account without a partner agreement is
 * what gets accounts banned — the product should not do that to a customer
 * silently. `PARTNER_API` mode exists for workspaces that have a compliant
 * integration, and takes the identical path through these checks.
 */

export type SocialAccount = {
  id: string;
  platform: SocialPlatform;
  tier: SocialAccountTier;
  displayName: string;
  handle: string | null;
  status: string;
  sendMode: "ASSISTED" | "PARTNER_API";
  restrictedUntil: string | null;
  restrictedReason: string | null;
  capacity: SocialCapacity;
};

export type SocialProspectState = {
  prospectId: string;
  platform: SocialPlatform;
  state: SocialState;
  profileUrl: string | null;
  noteAttached: boolean;
  inviteSentAt: string | null;
  acceptedAt: string | null;
  messagedAt: string | null;
  /**
   * How long a pending invite has been waiting, in days. Computed here rather
   * than in the component: reading the clock during render is impure, and the
   * value would drift between server and client renders.
   */
  pendingDays: number | null;
};

/* -------------------------------------------------------------- accounts */

export async function listSocialAccounts(businessId: string): Promise<SocialAccount[]> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("social_sending_accounts")
    .select(
      "id, platform, account_tier, display_name, external_handle, status, send_mode, restricted_until, restricted_reason, daily_connect_cap, weekly_connect_cap, monthly_note_cap, daily_message_cap",
    )
    .eq("business_id", businessId)
    .neq("status", "DISCONNECTED")
    .order("created_at", { ascending: true });

  const accounts: SocialAccount[] = [];

  for (const row of data ?? []) {
    const platform = row.platform as SocialPlatform;
    const tier = row.account_tier as SocialAccountTier;

    const defaults = limitsFor(platform, tier);
    if (!defaults) continue;

    // Column overrides win where an admin has set one — an account that has
    // been warmed can safely do more, and one the platform has throttled must
    // do less.
    const limits = {
      dailyConnects: row.daily_connect_cap ?? defaults.dailyConnects,
      weeklyConnects: row.weekly_connect_cap ?? defaults.weeklyConnects,
      monthlyNotes: row.monthly_note_cap ?? defaults.monthlyNotes,
      dailyMessages: row.daily_message_cap ?? defaults.dailyMessages,
      monthlyInMail: defaults.monthlyInMail,
    };

    const { data: usageRows } = await admin.rpc("social_account_usage", {
      p_business_id: businessId,
      p_account_id: row.id,
    });
    const usage = Array.isArray(usageRows) ? usageRows[0] : null;

    const capacity = socialCapacity(limits, {
      connectsToday: usage?.connects_today ?? 0,
      connectsThisWeek: usage?.connects_this_week ?? 0,
      messagesToday: usage?.messages_today ?? 0,
      notesThisMonth: usage?.notes_this_month ?? 0,
    });

    // A platform-imposed restriction outranks every cap. While it stands the
    // account does nothing at all, however much headroom the numbers show.
    const restricted =
      row.restricted_until && new Date(row.restricted_until).getTime() > Date.now();

    accounts.push({
      id: row.id,
      platform,
      tier,
      displayName: row.display_name,
      handle: row.external_handle,
      status: row.status,
      sendMode: row.send_mode as SocialAccount["sendMode"],
      restrictedUntil: row.restricted_until,
      restrictedReason: row.restricted_reason,
      capacity: restricted
        ? {
            ...capacity,
            connectsLeftToday: 0,
            messagesLeftToday: 0,
            blockedReason:
              row.restricted_reason ??
              `${row.display_name} has been restricted by ${platform.toLowerCase()}. Nothing will be sent from it until that lifts.`,
          }
        : capacity,
    });
  }

  return accounts;
}

/* ------------------------------------------------------------- decisions */

export type SocialActionPlan =
  | {
      action: "INVITE";
      attachNote: boolean;
      noteReason: string | null;
      accountId: string;
      profileUrl: string;
    }
  | { action: "MESSAGE"; accountId: string; profileUrl: string | null }
  | { action: "WAIT"; reason: string }
  | { action: "BLOCKED"; reason: string };

/**
 * What, if anything, should happen next for this prospect.
 *
 * Returns a plan rather than performing it, so the same decision can be shown
 * in the UI and executed by the scheduler without the two diverging.
 */
export async function planSocialAction(
  businessId: string,
  prospectId: string,
  platform: SocialPlatform,
): Promise<SocialActionPlan> {
  const admin = createAdminClient();

  const [{ data: prospect }, { data: existing }, accounts] = await Promise.all([
    admin
      .from("prospects")
      .select("id, linkedin_url, outreach_eligibility, status, promoted_to_lead_id")
      .eq("business_id", businessId)
      .eq("id", prospectId)
      .maybeSingle(),
    admin
      .from("social_connection_states")
      .select("state, profile_url")
      .eq("business_id", businessId)
      .eq("prospect_id", prospectId)
      .eq("platform", platform)
      .maybeSingle(),
    listSocialAccounts(businessId),
  ]);

  if (!prospect) return { action: "BLOCKED", reason: "That prospect could not be found." };

  // Suppression is channel-agnostic. Social is not a route around an opt-out.
  if (prospect.outreach_eligibility === "SUPPRESSED") {
    return { action: "BLOCKED", reason: "This prospect has opted out of all contact." };
  }
  if (prospect.promoted_to_lead_id) {
    return {
      action: "BLOCKED",
      reason: "This prospect is now a lead. Continue the conversation in Follow-Up.",
    };
  }

  const account = accounts.find(
    (candidate) => candidate.platform === platform && candidate.status === "ACTIVE",
  );
  if (!account) {
    return {
      action: "BLOCKED",
      reason: `No active ${platform.toLowerCase()} account is connected to send from.`,
    };
  }

  const state = (existing?.state as SocialState | undefined) ?? "NOT_CONNECTED";
  if (isTerminal(state)) {
    return {
      action: "BLOCKED",
      reason:
        state === "DECLINED"
          ? "This invite was declined. Sending another is what gets accounts restricted, so it will not be retried."
          : "This person has blocked the account.",
    };
  }

  const profileUrl = existing?.profile_url ?? prospect.linkedin_url ?? null;

  if (canMessage(state)) {
    if (state === "MESSAGED" || state === "REPLIED") {
      return { action: "WAIT", reason: "Already messaged on this channel." };
    }
    if (account.capacity.messagesLeftToday <= 0) {
      return {
        action: "WAIT",
        reason: `${account.displayName} has used its messages for today.`,
      };
    }
    return { action: "MESSAGE", accountId: account.id, profileUrl };
  }

  if (!canInvite(state)) {
    // INVITE_SENT: the wait is the recipient's to end, not ours.
    return {
      action: "WAIT",
      reason: "Invite sent. Nothing can be messaged until it is accepted.",
    };
  }

  if (!profileUrl) {
    return {
      action: "BLOCKED",
      reason: `No ${platform.toLowerCase()} profile is recorded for this prospect.`,
    };
  }

  if (account.capacity.blockedReason) {
    return { action: "WAIT", reason: account.capacity.blockedReason };
  }
  if (account.capacity.connectsLeftToday <= 0) {
    return {
      action: "WAIT",
      reason: `${account.displayName} has used its connection requests for today.`,
    };
  }

  const note = shouldAttachNote(account.capacity, platform);
  return {
    action: "INVITE",
    attachNote: note.attach,
    noteReason: note.reason,
    accountId: account.id,
    profileUrl,
  };
}

/* -------------------------------------------------------------- recording */

export type RecordActionInput = {
  businessId: string;
  prospectId: string;
  platform: SocialPlatform;
  accountId: string;
  action: "INVITE" | "MESSAGE" | "FOLLOW" | "WITHDRAW";
  noteBody?: string | null;
  performedBy: "ASSISTED" | "PARTNER_API";
  actorUserId: string | null;
  profileUrl?: string | null;
};

/**
 * Records that an action happened, and advances the state machine.
 *
 * Re-checks the plan first. In `ASSISTED` mode there is a human between the
 * decision and this call, and they may have taken minutes — in which case the
 * cap may have been consumed by a colleague, or the prospect suppressed.
 */
export async function recordSocialAction(
  input: RecordActionInput,
): Promise<{ ok: true; state: SocialState } | { ok: false; error: string }> {
  const plan = await planSocialAction(input.businessId, input.prospectId, input.platform);

  if (plan.action === "BLOCKED") return { ok: false, error: plan.reason };
  if (input.action === "INVITE" || input.action === "FOLLOW") {
    if (plan.action !== "INVITE") {
      return { ok: false, error: plan.action === "WAIT" ? plan.reason : "Not ready to invite." };
    }
  }
  if (input.action === "MESSAGE" && plan.action !== "MESSAGE") {
    return {
      ok: false,
      error:
        plan.action === "WAIT"
          ? plan.reason
          : "This prospect has not accepted the connection yet, so a message cannot be sent.",
    };
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const attachNote =
    input.action === "INVITE" &&
    plan.action === "INVITE" &&
    plan.attachNote &&
    Boolean(input.noteBody?.trim());

  const nextState: SocialState =
    input.action === "MESSAGE"
      ? "MESSAGED"
      : input.action === "WITHDRAW"
        ? "WITHDRAWN"
        : "INVITE_SENT";

  const { error } = await admin.from("social_connection_states").upsert(
    {
      business_id: input.businessId,
      prospect_id: input.prospectId,
      platform: input.platform,
      account_id: input.accountId,
      state: nextState,
      profile_url:
        input.profileUrl ?? (plan.action !== "WAIT" ? (plan as { profileUrl?: string }).profileUrl : null),
      note_attached: attachNote,
      note_body: attachNote ? (input.noteBody ?? "").slice(0, MAX_INVITE_NOTE_CHARS) : null,
      ...(input.action === "MESSAGE" ? { messaged_at: now } : {}),
      ...(input.action === "INVITE" || input.action === "FOLLOW"
        ? { invite_sent_at: now }
        : {}),
    },
    { onConflict: "prospect_id,platform" },
  );

  if (error) return { ok: false, error: "That could not be recorded." };

  // The log is what the caps are counted from, so it is written last and
  // always — a state change with no log row would let the account exceed its
  // limit on the next check.
  await admin.from("social_action_log").insert({
    business_id: input.businessId,
    account_id: input.accountId,
    prospect_id: input.prospectId,
    platform: input.platform,
    action:
      input.action === "INVITE" && attachNote
        ? "INVITE_WITH_NOTE"
        : input.action === "INVITE"
          ? "INVITE"
          : input.action,
    performed_by: input.performedBy,
    actor_user_id: input.actorUserId,
  });

  return { ok: true, state: nextState };
}

/**
 * Marks an invite as accepted.
 *
 * Called by whatever observes acceptance — a partner webhook, a poll, or a
 * person confirming it. This is the moment messaging becomes possible, which is
 * why the stream trigger fires on it.
 */
export async function markSocialAccepted(
  businessId: string,
  prospectId: string,
  platform: SocialPlatform,
): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: before } = await admin
    .from("social_connection_states")
    .select("profile_url")
    .eq("business_id", businessId)
    .eq("prospect_id", prospectId)
    .eq("platform", platform)
    .in("state", ["INVITE_SENT", "INVITE_QUEUED"])
    .maybeSingle();

  await admin
    .from("social_connection_states")
    .update({
      state: "ACCEPTED",
      accepted_at: now,
      // Due immediately. The acceptance is itself the warmest signal this
      // channel produces, and a gap after it wastes the one moment the person
      // actually remembers who you are -- so the opener is composed on the
      // next sweep rather than on a schedule.
      next_action: "MESSAGE",
      next_action_at: now,
      // A row that had been parked or halted while awaiting acceptance is
      // revived by it. Leaving these set would mean the sweeper skipped the
      // very rows the gate had just opened for.
      attempts: 0,
      parked_reason: null,
      halted_reason: null,
    })
    .eq("business_id", businessId)
    .eq("prospect_id", prospectId)
    .eq("platform", platform)
    .in("state", ["INVITE_SENT", "INVITE_QUEUED"]);

  // Only when this call is the one that observed the transition. `before` is
  // null on a repeat report -- a poller and a person can both notice the same
  // acceptance -- and re-recording it would rewrite the evidence date on a
  // relationship that was already established.
  if (!before) return;

  // The acceptance is what makes the next message lawful: it is the recorded
  // relationship the warm rules require, and without this row the policy engine
  // would refuse every message on a prospect the platform was perfectly willing
  // to deliver to. Deliberately not fatal -- the state transition above is the
  // one that must not be lost, and a permissions write that fails leaves the
  // prospect uncontactable rather than wrongly contactable.
  await recordSocialAcceptance({
    businessId,
    prospectId,
    platform,
    profileUrl: before.profile_url,
  });
}

export { MAX_INVITE_NOTE_CHARS, MAX_SOCIAL_MESSAGE_CHARS };

/* ------------------------------------------------------------------ reads */

/**
 * The social state for one prospect, across every platform it has one on.
 *
 * Returned as a list rather than a single row because a prospect can legitimately
 * be mid-invite on LinkedIn and already messaged on Instagram, and collapsing
 * that to one status would hide whichever channel is further along.
 */
export async function socialStatesForProspect(
  businessId: string,
  prospectId: string,
): Promise<SocialProspectState[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("social_connection_states")
    .select(
      "prospect_id, platform, state, profile_url, note_attached, invite_sent_at, accepted_at, messaged_at",
    )
    .eq("business_id", businessId)
    .eq("prospect_id", prospectId);

  const now = Date.now();

  return (data ?? []).map((row) => ({
    prospectId: row.prospect_id,
    platform: row.platform as SocialPlatform,
    state: row.state as SocialState,
    profileUrl: row.profile_url,
    noteAttached: row.note_attached,
    inviteSentAt: row.invite_sent_at,
    acceptedAt: row.accepted_at,
    messagedAt: row.messaged_at,
    pendingDays:
      row.invite_sent_at && row.state === "INVITE_SENT"
        ? Math.floor((now - new Date(row.invite_sent_at).getTime()) / 864e5)
        : null,
  }));
}

export type SocialQueueRow = {
  prospectId: string;
  name: string;
  companyName: string | null;
  platform: SocialPlatform;
  state: SocialState;
  profileUrl: string | null;
  grade: string | null;
  score: number | null;
  inviteSentAt: string | null;
  acceptedAt: string | null;
  /** Days a pending invite has been sitting. Null unless it is pending. */
  pendingDays: number | null;
};

/**
 * A message the sequencer composed, waiting for somebody to send it.
 *
 * The unit of work in ASSISTED mode. Everything upstream -- deciding it was
 * due, checking the caps, checking contactability, writing the words -- has
 * already happened; what is left is a person opening the platform and sending
 * it. That is why the row carries the body rather than a link to it: the
 * fewest possible clicks between seeing the work and doing it.
 */
export type SocialDraft = {
  id: string;
  prospectId: string;
  /** The account it was composed for. Sent back on "mark sent" so the action
   *  cannot attribute the send to a different account than the one the caps
   *  were checked against. */
  accountId: string | null;
  name: string;
  companyName: string | null;
  platform: SocialPlatform;
  profileUrl: string | null;
  kind: "INVITE_NOTE" | "OPENER" | "FOLLOW_UP";
  sequenceStep: number;
  body: string;
  /** TEMPLATE or AI. Shown, because a customer is entitled to know which. */
  composedBy: string;
  /** Why the model's version was not used, when it was not. */
  fallbackReason: string | null;
  composedAt: string;
};

export type SocialQueue = {
  accounts: SocialAccount[];
  /**
   * Composed and waiting to be sent. Listed first in the UI because it is the
   * only bucket where the work is already done and merely needs performing.
   */
  drafts: SocialDraft[];
  /** Approved prospects with a profile and no invite yet. */
  readyToInvite: SocialQueueRow[];
  /** Accepted, not yet messaged. The most valuable list on the page. */
  readyToMessage: SocialQueueRow[];
  /** Invites out, waiting on the recipient. */
  awaitingAcceptance: SocialQueueRow[];
  /** Pending long enough to be worth withdrawing to free up the allowance. */
  staleInvites: SocialQueueRow[];
};

/** After this long, a pending invite is costing more than it is likely worth. */
export const STALE_INVITE_DAYS = 21;

/**
 * The social work queue.
 *
 * Ordered by score within each bucket, because the account's daily allowance is
 * the scarce resource — if only three invites are left today they should go to
 * the three best prospects, not the three oldest rows.
 */
export async function loadSocialQueue(businessId: string): Promise<SocialQueue> {
  const admin = createAdminClient();
  const accounts = await listSocialAccounts(businessId);

  const [{ data: states }, { data: candidates }, { data: draftRows }] = await Promise.all([
    admin
      .from("social_connection_states")
      .select("prospect_id, platform, state, profile_url, invite_sent_at, accepted_at")
      .eq("business_id", businessId)
      .not("state", "in", "(DECLINED,BLOCKED,MESSAGED,REPLIED)")
      .limit(500),
    admin
      .from("prospects")
      .select(
        "id, first_name, last_name, grade, score, linkedin_url, status, outreach_eligibility, prospect_companies ( name )",
      )
      .eq("business_id", businessId)
      .eq("is_test", false)
      .is("promoted_to_lead_id", null)
      .eq("outreach_eligibility", "ELIGIBLE")
      .in("status", ["READY", "APPROVED", "OUTREACH_ACTIVE"])
      .not("linkedin_url", "is", null)
      .limit(500),
    admin
      .from("social_outbound_messages")
      .select(
        "id, prospect_id, account_id, platform, kind, sequence_step, body, composed_by, last_error, created_at, prospects ( first_name, last_name, linkedin_url, prospect_companies ( name ) )",
      )
      .eq("business_id", businessId)
      .eq("status", "DRAFT")
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  type StateRow = NonNullable<typeof states>[number];
  const stateByProspect = new Map<string, StateRow>();
  for (const row of states ?? []) {
    stateByProspect.set(`${row.prospect_id}:${row.platform}`, row);
  }

  const now = Date.now();
  const readyToInvite: SocialQueueRow[] = [];
  const readyToMessage: SocialQueueRow[] = [];
  const awaitingAcceptance: SocialQueueRow[] = [];
  const staleInvites: SocialQueueRow[] = [];

  for (const prospect of candidates ?? []) {
    const company = prospect.prospect_companies as unknown as { name: string } | null;
    const existing = stateByProspect.get(`${prospect.id}:LINKEDIN`);
    const state = (existing?.state as SocialState | undefined) ?? "NOT_CONNECTED";

    const pendingDays =
      existing?.invite_sent_at && state === "INVITE_SENT"
        ? Math.floor((now - new Date(existing.invite_sent_at).getTime()) / 864e5)
        : null;

    const row: SocialQueueRow = {
      prospectId: prospect.id,
      name:
        [prospect.first_name, prospect.last_name].filter(Boolean).join(" ").trim() ||
        "Unnamed prospect",
      companyName: company?.name ?? null,
      platform: "LINKEDIN",
      state,
      profileUrl: existing?.profile_url ?? prospect.linkedin_url,
      grade: prospect.grade,
      score: prospect.score === null ? null : Number(prospect.score),
      inviteSentAt: existing?.invite_sent_at ?? null,
      acceptedAt: existing?.accepted_at ?? null,
      pendingDays,
    };

    if (state === "ACCEPTED") readyToMessage.push(row);
    else if (state === "INVITE_SENT") {
      awaitingAcceptance.push(row);
      if ((pendingDays ?? 0) >= STALE_INVITE_DAYS) staleInvites.push(row);
    } else if (canInvite(state)) readyToInvite.push(row);
  }

  // Best first. The allowance is the scarce thing, not the rows.
  const byScore = (a: SocialQueueRow, b: SocialQueueRow) => (b.score ?? 0) - (a.score ?? 0);
  readyToInvite.sort(byScore);
  readyToMessage.sort(byScore);
  awaitingAcceptance.sort(
    (a, b) => (b.pendingDays ?? 0) - (a.pendingDays ?? 0) || byScore(a, b),
  );
  staleInvites.sort((a, b) => (b.pendingDays ?? 0) - (a.pendingDays ?? 0));

  const drafts: SocialDraft[] = (draftRows ?? []).map((row) => {
    const prospect = row.prospects as unknown as {
      first_name: string | null;
      last_name: string | null;
      linkedin_url: string | null;
      prospect_companies: { name: string } | null;
    } | null;

    return {
      id: row.id,
      prospectId: row.prospect_id,
      accountId: row.account_id,
      name:
        [prospect?.first_name, prospect?.last_name].filter(Boolean).join(" ").trim() ||
        "Unnamed prospect",
      companyName: prospect?.prospect_companies?.name ?? null,
      platform: row.platform as SocialPlatform,
      profileUrl: prospect?.linkedin_url ?? null,
      kind: row.kind as SocialDraft["kind"],
      sequenceStep: row.sequence_step,
      body: row.body,
      composedBy: row.composed_by,
      fallbackReason: row.last_error,
      composedAt: row.created_at,
    };
  });

  return {
    accounts,
    drafts,
    readyToInvite,
    readyToMessage,
    awaitingAcceptance,
    staleInvites,
  };
}

/* ------------------------------------------------------------- enrolment */

/**
 * Puts approved prospects onto the social sequencer's clock.
 *
 * This is the join between approval and the 24/7 sweeper, and its absence is
 * what made the whole channel human-pull: `social_connection_states` rows were
 * only ever created when somebody clicked, so the sweeper's due-work query --
 * however correct -- had nothing to find.
 *
 * Enrolment is deliberately narrow. A prospect qualifies only if it is
 * approved, eligible, not already a lead, and has a profile URL to act on;
 * anything else is left alone rather than enrolled optimistically, because a
 * row on the clock with nothing to do is a row the sweeper examines forever.
 *
 * Idempotent by the `(prospect_id, platform)` unique constraint, and it never
 * disturbs a row that already exists -- re-approving a prospect whose invite
 * was declined must not put it back in the queue.
 */
export async function enrolProspectsInSocialSequence(input: {
  businessId: string;
  prospectIds: string[];
  platform?: SocialPlatform;
}): Promise<{ enrolled: number }> {
  const platform = input.platform ?? "LINKEDIN";
  if (input.prospectIds.length === 0) return { enrolled: 0 };

  const admin = createAdminClient();

  // Only an active account for this platform makes enrolment meaningful.
  // Without one the sequencer would compose an invite it has nowhere to send
  // from, and halt on the next sweep having already spent the tokens.
  const accounts = await listSocialAccounts(input.businessId);
  const account = accounts.find(
    (candidate) => candidate.platform === platform && candidate.status === "ACTIVE",
  );
  if (!account) return { enrolled: 0 };

  const { data: eligible } = await admin
    .from("prospects")
    .select("id, linkedin_url")
    .eq("business_id", input.businessId)
    .in("id", input.prospectIds)
    .eq("outreach_eligibility", "ELIGIBLE")
    .in("status", ["APPROVED", "OUTREACH_ACTIVE"])
    .is("promoted_to_lead_id", null)
    .not("linkedin_url", "is", null);

  const rows = (eligible ?? [])
    .filter((prospect) => Boolean(prospect.linkedin_url))
    .map((prospect) => ({
      business_id: input.businessId,
      prospect_id: prospect.id,
      account_id: account.id,
      platform,
      state: "NOT_CONNECTED" as const,
      profile_url: prospect.linkedin_url,
      next_action: "INVITE" as const,
      next_action_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return { enrolled: 0 };

  // `ignoreDuplicates` rather than a merge: an existing row has a history --
  // an invite sent, a decline, a withdrawal -- and overwriting it with a fresh
  // NOT_CONNECTED would re-invite somebody who already said no.
  const { data: inserted } = await admin
    .from("social_connection_states")
    .upsert(rows, { onConflict: "prospect_id,platform", ignoreDuplicates: true })
    .select("id");

  return { enrolled: inserted?.length ?? 0 };
}
