"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { assertCapability } from "@/lib/billing/v4-entitlements";
import { EntitlementError } from "@/lib/billing/entitlements";
import {
  markSocialAccepted,
  planSocialAction,
  recordSocialAction,
} from "./social-outreach";
import {
  MAX_INVITE_NOTE_CHARS,
  MAX_SOCIAL_MESSAGE_CHARS,
  SOCIAL_ACCOUNT_TIERS,
  SOCIAL_PLATFORMS,
} from "./social-limits";
import { ingestSocialReply } from "@/lib/social/replies";
import type { ActionResult } from "@/lib/find-leads/actions";

/**
 * Social outreach mutations (V4 §16, social channels).
 *
 * Every one of these re-derives the plan server-side before it acts. That is
 * not belt-and-braces: in `ASSISTED` mode a person sits between the screen and
 * this call, and minutes may pass — long enough for a colleague to consume the
 * account's daily allowance, or for the prospect to be suppressed. The state the
 * button was rendered with is a courtesy, never the authorisation.
 */

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

function refresh() {
  revalidatePath("/app/find-leads");
}

/** Contacting a stranger on any channel is an admin act. */
async function requireOutreachAdmin(): Promise<
  { ok: true; workspace: ActiveWorkspace } | { ok: false; error: string }
> {
  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("admin");
  } catch {
    return fail("Only owners and admins can send outreach.");
  }
  try {
    await assertCapability(workspace.businessId, "sourcing");
  } catch (error) {
    if (error instanceof EntitlementError) return fail(error.message);
    return fail("Find Leads is unavailable right now.");
  }
  return { ok: true, workspace };
}

const platformSchema = z.enum(SOCIAL_PLATFORMS);

/* --------------------------------------------------------------- accounts */

const accountSchema = z.object({
  platform: platformSchema,
  tier: z.enum(SOCIAL_ACCOUNT_TIERS),
  displayName: z.string().trim().min(1).max(120),
  handle: z.string().trim().max(200).optional(),
  /**
   * Assisted by default. Automating a personal account without a partner
   * agreement is what gets it banned, so switching to API sending is a
   * deliberate choice rather than something that happens by omission.
   */
  sendMode: z.enum(["ASSISTED", "PARTNER_API"]).default("ASSISTED"),
});

export async function saveSocialAccountAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return fail("Check the account details and try again.");

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  const value = parsed.data;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("social_sending_accounts")
    .upsert(
      {
        business_id: access.workspace.businessId,
        platform: value.platform,
        account_tier: value.tier,
        display_name: value.displayName,
        external_handle: value.handle || null,
        send_mode: value.sendMode,
        status: "ACTIVE",
        created_by: access.workspace.userId,
      },
      { onConflict: "business_id,platform,external_handle" },
    )
    .select("id")
    .single();

  if (error || !data) return fail("That account could not be saved.");

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "social_account.saved",
    entityType: "social_sending_account",
    entityId: data.id,
    metadata: { platform: value.platform, tier: value.tier, sendMode: value.sendMode },
  });

  refresh();
  return ok({ id: data.id });
}

export async function setSocialAccountStatusAction(
  accountId: unknown,
  status: unknown,
): Promise<ActionResult<{ status: string }>> {
  const parsed = z
    .object({ accountId: z.uuid(), status: z.enum(["ACTIVE", "PAUSED", "DISCONNECTED"]) })
    .safeParse({ accountId, status });
  if (!parsed.success) return fail("That account could not be updated.");

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { error } = await admin
    .from("social_sending_accounts")
    .update({ status: parsed.data.status })
    .eq("business_id", access.workspace.businessId)
    .eq("id", parsed.data.accountId);

  if (error) return fail("That account could not be updated.");

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "social_account.status_changed",
    entityType: "social_sending_account",
    entityId: parsed.data.accountId,
    metadata: { status: parsed.data.status },
  });

  refresh();
  return ok({ status: parsed.data.status });
}

/* ------------------------------------------------------------ the actions */

/**
 * What should happen next for this prospect on this platform.
 *
 * Read-only, and safe to call on render — it is the same function the send path
 * uses, so the button can never offer an action the send would refuse.
 */
export async function socialPlanAction(
  prospectId: unknown,
  platform: unknown,
): Promise<
  ActionResult<{ action: string; reason: string | null; attachNote: boolean }>
> {
  const parsed = z
    .object({ prospectId: z.uuid(), platform: platformSchema })
    .safeParse({ prospectId, platform });
  if (!parsed.success) return fail("That prospect could not be found.");

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  const plan = await planSocialAction(
    access.workspace.businessId,
    parsed.data.prospectId,
    parsed.data.platform,
  );

  return ok({
    action: plan.action,
    reason:
      plan.action === "WAIT" || plan.action === "BLOCKED"
        ? plan.reason
        : plan.action === "INVITE"
          ? plan.noteReason
          : null,
    attachNote: plan.action === "INVITE" ? plan.attachNote : false,
  });
}

const sendSchema = z.object({
  prospectId: z.uuid(),
  platform: platformSchema,
  /**
   * Nullable because a draft composed by the sequencer may outlive the account
   * it was composed for -- `social_outbound_messages.account_id` is
   * `on delete set null`. Rather than refusing the send, the action resolves
   * the workspace's active account for that platform, which is the only one it
   * could legitimately go out from anyway.
   */
  accountId: z.uuid().nullish(),
  noteBody: z.string().trim().max(MAX_INVITE_NOTE_CHARS).optional(),
  messageBody: z.string().trim().max(MAX_SOCIAL_MESSAGE_CHARS).optional(),
});

/**
 * Records that a connection request or follow was sent.
 *
 * In `ASSISTED` mode the person has just done it in the platform's own UI and
 * is telling us; in `PARTNER_API` mode the integration did it. Either way the
 * caps and the state machine are checked first, and the append-only log is
 * written so the next capacity check sees it.
 */
export async function sendSocialInviteAction(
  input: unknown,
): Promise<ActionResult<{ state: string }>> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return fail("Check the invite and try again.");

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();

  // The fallback the schema promises. A draft composed days ago may name an
  // account that has since been removed (`account_id` is `on delete set null`),
  // and refusing the send would strand a message a person is looking at. The
  // workspace's active account for that platform is the only one it could
  // legitimately go out from, so it is resolved rather than demanded.
  const accountQuery = admin
    .from("social_sending_accounts")
    .select("id, send_mode")
    .eq("business_id", access.workspace.businessId);

  const { data: account } = parsed.data.accountId
    ? await accountQuery.eq("id", parsed.data.accountId).maybeSingle()
    : await accountQuery
        .eq("platform", parsed.data.platform)
        .eq("status", "ACTIVE")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

  if (!account) {
    return fail(
      parsed.data.accountId
        ? "That sending account could not be found."
        : `No active ${parsed.data.platform.toLowerCase()} account is connected to send from.`,
    );
  }

  const result = await recordSocialAction({
    businessId: access.workspace.businessId,
    prospectId: parsed.data.prospectId,
    platform: parsed.data.platform,
    accountId: account.id,
    action: parsed.data.platform === "LINKEDIN" ? "INVITE" : "FOLLOW",
    noteBody: parsed.data.noteBody ?? null,
    performedBy: account.send_mode as "ASSISTED" | "PARTNER_API",
    actorUserId: access.workspace.userId,
  });

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "social_outreach.invited",
    entityType: "prospect",
    entityId: parsed.data.prospectId,
    metadata: {
      platform: parsed.data.platform,
      ok: result.ok,
      noteAttached: Boolean(parsed.data.noteBody),
    },
  });

  if (!result.ok) return fail(result.error);

  refresh();
  return ok({ state: result.state });
}

/**
 * Records a message. Refuses unless the connection was accepted — a message
 * before that is impossible on LinkedIn and invisible on Meta, so attempting it
 * wastes the one shot the customer has at that person.
 */
export async function sendSocialMessageAction(
  input: unknown,
): Promise<ActionResult<{ state: string }>> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return fail("Check the message and try again.");
  if (!parsed.data.messageBody?.trim()) return fail("The message is empty.");

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();

  // Named account where the caller has one, otherwise the workspace's active
  // account for this platform. Scoped by `business_id` in both branches, so an
  // id from another workspace resolves to nothing rather than to a send.
  const accountQuery = admin
    .from("social_sending_accounts")
    .select("id, send_mode")
    .eq("business_id", access.workspace.businessId)
    .eq("platform", parsed.data.platform);

  const { data: account } = parsed.data.accountId
    ? await accountQuery.eq("id", parsed.data.accountId).maybeSingle()
    : await accountQuery.eq("status", "ACTIVE").limit(1).maybeSingle();

  if (!account) return fail("That sending account could not be found.");

  const result = await recordSocialAction({
    businessId: access.workspace.businessId,
    prospectId: parsed.data.prospectId,
    platform: parsed.data.platform,
    accountId: account.id,
    action: "MESSAGE",
    performedBy: account.send_mode as "ASSISTED" | "PARTNER_API",
    actorUserId: access.workspace.userId,
  });

  if (!result.ok) return fail(result.error);

  // The message itself is stored on the prospect's conversation, so it survives
  // promotion to a Lead exactly as an email would.
  const { data: prospect } = await admin
    .from("prospects")
    .select("conversation_id")
    .eq("business_id", access.workspace.businessId)
    .eq("id", parsed.data.prospectId)
    .maybeSingle();

  let conversationId = prospect?.conversation_id ?? null;
  if (!conversationId) {
    const { data: created } = await admin
      .from("conversations")
      .insert({
        business_id: access.workspace.businessId,
        prospect_id: parsed.data.prospectId,
        channel: parsed.data.platform === "LINKEDIN" ? "linkedin" : "messenger",
      })
      .select("id")
      .single();

    conversationId = created?.id ?? null;
    if (conversationId) {
      await admin
        .from("prospects")
        .update({ conversation_id: conversationId })
        .eq("business_id", access.workspace.businessId)
        .eq("id", parsed.data.prospectId);
    }
  }

  if (conversationId) {
    await admin.from("messages").insert({
      business_id: access.workspace.businessId,
      conversation_id: conversationId,
      prospect_id: parsed.data.prospectId,
      direction: "outbound",
      channel: parsed.data.platform === "LINKEDIN" ? "linkedin" : "messenger",
      body: parsed.data.messageBody,
      status: "SENT",
      sent_at: new Date().toISOString(),
    });
  }

  await admin
    .from("prospects")
    .update({
      status: "OUTREACH_ACTIVE",
      last_contacted_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    })
    .eq("business_id", access.workspace.businessId)
    .eq("id", parsed.data.prospectId)
    .in("status", ["READY", "APPROVED"]);

  // Advance the sequencer's clock.
  //
  // Without this the assisted path is a dead end: a person sends the opener,
  // `sequence_step` stays at 0, `last_outbound_at` stays null, and the sweeper
  // either composes a second opener or -- because `next_action_at` was left at
  // its six-hour re-check -- concludes there is nothing to do and never fires a
  // follow-up at all. The autonomous path does this in `social-execute.ts`;
  // this is its counterpart, and the two must agree.
  //
  // `next_action_at` is set to now rather than to the computed due time: the
  // sweeper recomputes the gap from `last_outbound_at` on its next pass, so a
  // workspace that changes its follow-up spacing takes effect immediately
  // rather than being frozen at the moment somebody clicked send.
  const sentAt = new Date().toISOString();
  const { data: current } = await admin
    .from("social_connection_states")
    .select("sequence_step")
    .eq("business_id", access.workspace.businessId)
    .eq("prospect_id", parsed.data.prospectId)
    .eq("platform", parsed.data.platform)
    .maybeSingle();

  await admin
    .from("social_connection_states")
    .update({
      sequence_step: Math.min(3, (current?.sequence_step ?? 0) + 1),
      last_outbound_at: sentAt,
      next_action: null,
      next_action_at: sentAt,
      attempts: 0,
      halted_reason: null,
    })
    .eq("business_id", access.workspace.businessId)
    .eq("prospect_id", parsed.data.prospectId)
    .eq("platform", parsed.data.platform);

  // Whatever the sequencer composed for this step has now been performed. It
  // is marked sent rather than left in DRAFT, because a DRAFT row is what
  // stops the next step being composed at all.
  await admin
    .from("social_outbound_messages")
    .update({
      status: "SENT",
      sent_at: sentAt,
      sent_by: access.workspace.userId,
      performed_by: account.send_mode,
    })
    .eq("business_id", access.workspace.businessId)
    .eq("prospect_id", parsed.data.prospectId)
    .eq("platform", parsed.data.platform)
    .eq("status", "DRAFT");

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "social_outreach.messaged",
    entityType: "prospect",
    entityId: parsed.data.prospectId,
    metadata: { platform: parsed.data.platform },
  });

  refresh();
  return ok({ state: result.state });
}

/**
 * Marks an invite accepted.
 *
 * The moment messaging becomes possible. Reported by a person in assisted mode,
 * or by a partner webhook where one exists.
 */
export async function markSocialAcceptedAction(
  prospectId: unknown,
  platform: unknown,
): Promise<ActionResult<{ accepted: true }>> {
  const parsed = z
    .object({ prospectId: z.uuid(), platform: platformSchema })
    .safeParse({ prospectId, platform });
  if (!parsed.success) return fail("That prospect could not be found.");

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  await markSocialAccepted(
    access.workspace.businessId,
    parsed.data.prospectId,
    parsed.data.platform,
  );

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "social_outreach.accepted",
    entityType: "prospect",
    entityId: parsed.data.prospectId,
    metadata: { platform: parsed.data.platform },
  });

  refresh();
  return ok({ accepted: true });
}

/**
 * Withdraws a pending invite.
 *
 * Worth doing rather than leaving: a pending invite keeps consuming the weekly
 * allowance for as long as it sits there, so withdrawing stale ones is how a
 * campaign keeps moving.
 */
export async function withdrawSocialInviteAction(
  input: unknown,
): Promise<ActionResult<{ state: string }>> {
  const parsed = z
    .object({ prospectId: z.uuid(), platform: platformSchema, accountId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return fail("That invite could not be withdrawn.");

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { error } = await admin
    .from("social_connection_states")
    .update({ state: "WITHDRAWN" })
    .eq("business_id", access.workspace.businessId)
    .eq("prospect_id", parsed.data.prospectId)
    .eq("platform", parsed.data.platform)
    .in("state", ["INVITE_SENT", "INVITE_QUEUED"]);

  if (error) return fail("That invite could not be withdrawn.");

  await admin.from("social_action_log").insert({
    business_id: access.workspace.businessId,
    account_id: parsed.data.accountId,
    prospect_id: parsed.data.prospectId,
    platform: parsed.data.platform,
    action: "WITHDRAW",
    performed_by: "ASSISTED",
    actor_user_id: access.workspace.userId,
  });

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "social_outreach.withdrawn",
    entityType: "prospect",
    entityId: parsed.data.prospectId,
    metadata: { platform: parsed.data.platform },
  });

  refresh();
  return ok({ state: "WITHDRAWN" });
}

/**
 * Records the person declining, or blocking.
 *
 * Terminal. The product does not retry either — re-inviting somebody who
 * refused is precisely what gets an account restricted.
 */
export async function markSocialDeclinedAction(
  prospectId: unknown,
  platform: unknown,
  blocked: unknown,
): Promise<ActionResult<{ state: string }>> {
  const parsed = z
    .object({
      prospectId: z.uuid(),
      platform: platformSchema,
      blocked: z.boolean().default(false),
    })
    .safeParse({ prospectId, platform, blocked });
  if (!parsed.success) return fail("That could not be recorded.");

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  const state = parsed.data.blocked ? "BLOCKED" : "DECLINED";
  const admin = createAdminClient();

  await admin
    .from("social_connection_states")
    .update({ state, declined_at: new Date().toISOString() })
    .eq("business_id", access.workspace.businessId)
    .eq("prospect_id", parsed.data.prospectId)
    .eq("platform", parsed.data.platform);

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "social_outreach.declined",
    entityType: "prospect",
    entityId: parsed.data.prospectId,
    metadata: { platform: parsed.data.platform, blocked: parsed.data.blocked },
  });

  refresh();
  return ok({ state });
}

/* ---------------------------------------------------------------- replies */

const replySchema = z.object({
  prospectId: z.uuid(),
  platform: platformSchema,
  body: z.string().trim().min(1).max(4000),
  receivedAt: z.string().optional(),
});

/**
 * Records that a prospect replied.
 *
 * The ASSISTED counterpart of a partner webhook: on LinkedIn there is no API
 * that can tell us somebody answered, so a person reads the reply and enters
 * it. That is not a lesser path — it is the only path the platform permits for
 * a personal account, and everything downstream is identical either way.
 *
 * What happens next is deliberately a lot for one button: the sequence stops,
 * any composed-but-unsent follow-up is discarded, the reply is classified, an
 * opt-out suppresses globally, and a promotable reply may create the Lead and
 * hand the conversation to the agent. All of it lives in `social/replies.ts`
 * rather than here, so the webhook path cannot drift from the human one.
 */
export async function recordSocialReplyAction(
  input: unknown,
): Promise<
  ActionResult<{
    classification: string | null;
    leadId: string | null;
    suppressed: boolean;
    alreadyRecorded: boolean;
  }>
> {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return fail("Enter the reply you received.");

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  // Ownership, before anything is written. A prospect id from another
  // workspace must not reach the ingest path, which runs as the service role
  // and would otherwise happily record a reply against it.
  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("prospects")
    .select("id")
    .eq("business_id", access.workspace.businessId)
    .eq("id", parsed.data.prospectId)
    .maybeSingle();

  if (!prospect) return fail("That prospect could not be found.");

  const result = await ingestSocialReply({
    businessId: access.workspace.businessId,
    prospectId: parsed.data.prospectId,
    platform: parsed.data.platform,
    body: parsed.data.body,
    receivedAt: parsed.data.receivedAt,
    ingestedBy: "ASSISTED",
    ingestedByUserId: access.workspace.userId,
  });

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "social_outreach.reply_recorded",
    entityType: "prospect",
    entityId: parsed.data.prospectId,
    metadata: {
      platform: parsed.data.platform,
      classification: result.classification,
      promoted: Boolean(result.leadId),
    },
  });

  refresh();
  if (result.leadId) revalidatePath("/app/leads");

  return ok({
    classification: result.classification,
    leadId: result.leadId,
    suppressed: result.suppressed,
    alreadyRecorded: !result.recorded,
  });
}
