import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { getEntitlements } from "@/lib/billing/entitlements";
import { planLabel } from "@/lib/settings/types";
import { sendExistingAccountInvite } from "@/lib/team/invite-email";
import {
  ASSIGNABLE_TEAM_ROLES,
  inviteExpired,
  inviteProblem,
  removalProblem,
  reassignmentProblem,
  roleChangeProblem,
  seatLimitMessage,
  seatsInUse,
  transferProblem,
  type Actor,
  type AssignableRole,
  type MemberFacts,
  type TeamRole,
} from "@/lib/team/rules";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAPABILITIES, choiceToValue, permissionChangeProblem } from "@/lib/auth/capabilities";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";
import type { ServiceContext } from "../types";

/**
 * Team membership operations (coverage tracker 8.15).
 *
 * One implementation of invite / resend / role change / remove / transfer for
 * the Team settings page, MCP and the API. The guardrails are the pure rules in
 * `@/lib/team/rules`; this file only reads the facts they need, applies them,
 * and writes. The runtime audits every write with its before and after.
 *
 * Membership is not browser-writable (0010: no insert/update policy on
 * business_members), so every write here uses the service role, hard-scoped to
 * `context.businessId`.
 */

const MEMBER_FIELDS = "id, user_id, role, status, invited_email, invited_at, accepted_at, created_at";

type MemberRow = {
  id: string;
  user_id: string;
  role: string;
  status: string;
  invited_email: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  created_at: string;
};

function facts(row: MemberRow): MemberFacts {
  return {
    userId: row.user_id,
    role: row.role as TeamRole,
    status: row.status,
    invitedAt: row.invited_at,
  };
}

function actorOf(context: ServiceContext): Actor {
  if (!context.userId) throw new ServiceError("FORBIDDEN_ROLE", "Team changes need a signed-in person.");
  return { userId: context.userId, role: context.role };
}

async function workspaceMembers(businessId: string): Promise<MemberRow[]> {
  const { data, error } = await createAdminClient()
    .from("business_members")
    .select(MEMBER_FIELDS)
    .eq("business_id", businessId)
    .neq("status", "removed")
    .order("created_at", { ascending: true });
  if (error) throw new ServiceError("UNAVAILABLE", "The team could not be read.");
  return (data ?? []) as MemberRow[];
}

async function loadMember(businessId: string, membershipId: string): Promise<MemberRow> {
  const { data, error } = await createAdminClient()
    .from("business_members")
    .select(MEMBER_FIELDS)
    .eq("business_id", businessId)
    .eq("id", membershipId)
    .maybeSingle();
  if (error) throw new ServiceError("UNAVAILABLE", "That team member could not be read.");
  if (!data || data.status === "removed") {
    throw new ServiceError("NOT_FOUND", "That person is not part of this workspace.");
  }
  return data as MemberRow;
}

/** Throws PLAN_LIMIT when one more seat would exceed the plan. */
async function assertSeatAvailable(businessId: string, members: MemberRow[]): Promise<void> {
  const entitlements = await getEntitlements(businessId);
  if (!entitlements.active) {
    throw new ServiceError("PLAN_LIMIT", "This workspace does not have an active subscription.");
  }
  if (seatsInUse(members.map(facts)) >= entitlements.userLimit) {
    throw new ServiceError(
      "PLAN_LIMIT",
      seatLimitMessage(entitlements.userLimit, planLabel(entitlements.plan)),
    );
  }
}

/**
 * Emails the invitation. A new or not-yet-confirmed address gets Supabase
 * Auth's invite, which creates the account (and re-sends on a resend). An
 * address that already has a confirmed account cannot be sent that, so it gets
 * our own invitation email instead — accepting is signing in, and the pending
 * membership activates against their verified address until it lapses.
 */
async function deliverInvite(input: {
  businessId: string;
  email: string;
  role: AssignableRole;
  hasAccount: boolean;
  invitedAt: Date;
}): Promise<{ userId: string | null; emailed: boolean }> {
  const admin = createAdminClient();
  const redirectTo = `${serverEnv.siteUrl}/login`;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, { redirectTo });
  if (!error && data?.user) return { userId: data.user.id, emailed: true };

  // Supabase's own mailer refused (its rate limit, or the address). For a new
  // address, create the same one-time invite link without sending anything and
  // email it through Resend instead, so the invite still arrives.
  let userId: string | null = null;
  let acceptLink: string | undefined;
  if (!input.hasAccount) {
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "invite",
      email: input.email,
      options: { redirectTo },
    });
    if (linkError || !link?.user || !link.properties?.action_link) return { userId: null, emailed: false };
    userId = link.user.id;
    acceptLink = link.properties.action_link;
  }

  const { data: business, error: businessError } = await admin
    .from("businesses")
    .select("name")
    .eq("id", input.businessId)
    .maybeSingle();
  if (businessError) return { userId, emailed: false };
  const emailed = await sendExistingAccountInvite({
    to: input.email,
    workspaceName: business?.name ?? "a workspace",
    role: input.role,
    invitedAt: input.invitedAt,
    acceptLink,
  });
  return { userId, emailed };
}

const NOT_EMAILED_WARNING = {
  code: "invite_not_emailed",
  message:
    "The invitation is saved, but the email could not be sent. Resend it from their row, or ask them to sign in with that address.",
};

function present(row: MemberRow, profile?: { name: string; email: string | null }) {
  return {
    membershipId: row.id,
    userId: row.user_id,
    name: profile?.name ?? "",
    email: profile?.email ?? row.invited_email ?? "",
    role: row.role,
    status: row.status,
    invitedAt: row.invited_at,
    inviteExpired: row.status === "invited" && inviteExpired(row.invited_at),
    joinedAt: row.accepted_at ?? row.created_at,
  };
}

/* ------------------------------------------------------------------- list */

defineOperation("member.list", {
  schema: z.object({}).strict(),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const rows = await workspaceMembers(context.businessId);
    const userIds = rows.map((row) => row.user_id);
    const profiles = new Map<string, { name: string; email: string | null }>();
    if (userIds.length) {
      const { data, error } = await createAdminClient()
        .from("profiles")
        .select("id, first_name, last_name, email")
        .in("id", userIds);
      if (error) throw new ServiceError("UNAVAILABLE", "The team could not be read.");
      for (const profile of data ?? []) {
        profiles.set(profile.id, {
          name: [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim(),
          email: profile.email,
        });
      }
    }
    const members = rows.map((row) => present(row, profiles.get(row.user_id)));
    return { data: { members, count: members.length } };
  },
});

/* ----------------------------------------------------------------- invite */

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address")),
  role: z.enum(ASSIGNABLE_TEAM_ROLES as [Exclude<TeamRole, "owner">, ...Exclude<TeamRole, "owner">[]]),
});

defineOperation("member.invite", {
  schema: inviteSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof inviteSchema>>) {
    const actor = actorOf(context);
    // Only the owner creates an admin: an admin could not manage one after.
    const refused = inviteProblem({ actor, role: args.role });
    if (refused) throw new ServiceError("FORBIDDEN_ROLE", refused);
    const admin = createAdminClient();
    const members = await workspaceMembers(context.businessId);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .eq("email", args.email)
      .maybeSingle();
    if (profileError) throw new ServiceError("UNAVAILABLE", "The invitation could not be checked.");

    const existing = profile ? members.find((row) => row.user_id === profile.id) : undefined;
    if (existing && !(existing.status === "invited" && inviteExpired(existing.invited_at))) {
      throw new ServiceError(
        "CONFLICT",
        existing.status === "invited"
          ? "That person already has an open invitation. Resend it from their row instead."
          : "That person is already part of this workspace.",
      );
    }

    // A lapsed invite holds no seat, so re-inviting that person needs one.
    await assertSeatAvailable(context.businessId, members);

    const invitedAt = new Date();
    let userId = profile?.id ?? null;
    const delivered = await deliverInvite({
      businessId: context.businessId,
      email: args.email,
      role: args.role,
      hasAccount: Boolean(profile),
      invitedAt,
    });
    const emailed = delivered.emailed;
    if (delivered.userId) {
      userId = delivered.userId;
    } else if (!userId) {
      throw new ServiceError(
        "PROVIDER_FAILED",
        "Could not send that invitation. Check the email address and try again.",
      );
    }

    if (!profile) {
      const { error } = await admin
        .from("profiles")
        .upsert({ id: userId, email: args.email }, { onConflict: "id" });
      if (error) throw new ServiceError("UNAVAILABLE", "Could not add that person to the workspace.");
    }

    const { data, error } = await admin
      .from("business_members")
      .upsert(
        {
          business_id: context.businessId,
          user_id: userId,
          role: args.role,
          status: "invited",
          invited_email: args.email,
          invited_at: invitedAt.toISOString(),
          accepted_at: null,
        },
        { onConflict: "business_id,user_id" },
      )
      .select(MEMBER_FIELDS)
      .single();
    if (error || !data) throw new ServiceError("UNAVAILABLE", "Could not add that person to the workspace.");

    return {
      data: { member: present(data as MemberRow), emailed },
      entityId: data.id,
      after: { email: args.email, role: args.role, status: "invited" },
      warnings: emailed ? [] : [NOT_EMAILED_WARNING],
    };
  },
});

/* ----------------------------------------------------------------- resend */

defineOperation("member.resend_invite", {
  schema: z.object({ membershipId: z.uuid() }),
  async run({ args, context }: HandlerInput<{ membershipId: string }>) {
    const actor = actorOf(context);
    const row = await loadMember(context.businessId, args.membershipId);
    if (row.status !== "invited") {
      throw new ServiceError("CONFLICT", "Only an open invitation can be resent.");
    }
    const problem = removalProblem({ actor, target: facts(row) });
    if (problem) throw new ServiceError("FORBIDDEN_ROLE", problem);
    if (!row.invited_email) {
      throw new ServiceError("CONFLICT", "That invitation has no email address. Revoke it and invite them again.");
    }

    if (inviteExpired(row.invited_at)) {
      const members = await workspaceMembers(context.businessId);
      await assertSeatAvailable(context.businessId, members);
    }

    const renewedAt = new Date();
    const delivered = await deliverInvite({
      businessId: context.businessId,
      email: row.invited_email,
      role: row.role as AssignableRole,
      hasAccount: true,
      invitedAt: renewedAt,
    });
    const invitedAt = renewedAt.toISOString();
    const { error } = await createAdminClient()
      .from("business_members")
      .update({ invited_at: invitedAt })
      .eq("id", row.id)
      .eq("business_id", context.businessId)
      .eq("status", "invited");
    if (error) throw new ServiceError("UNAVAILABLE", "The invitation could not be renewed.");

    return {
      data: { membershipId: row.id, emailed: delivered.emailed, invitedAt },
      entityId: row.id,
      before: { invited_at: row.invited_at },
      after: { invited_at: invitedAt },
      warnings: delivered.emailed ? [] : [NOT_EMAILED_WARNING],
    };
  },
});

/* ------------------------------------------------------------------- role */

defineOperation("member.set_role", {
  schema: z.object({ membershipId: z.uuid(), role: z.string().trim().min(1).max(20) }),
  async run({ args, context }: HandlerInput<{ membershipId: string; role: string }>) {
    const actor = actorOf(context);
    const row = await loadMember(context.businessId, args.membershipId);
    const problem = roleChangeProblem({ actor, target: facts(row), nextRole: args.role });
    if (problem) {
      throw new ServiceError(args.role === row.role ? "CONFLICT" : "FORBIDDEN_ROLE", problem);
    }

    const { data, error } = await createAdminClient()
      .from("business_members")
      .update({ role: args.role })
      .eq("id", row.id)
      .eq("business_id", context.businessId)
      // Compare-and-set: two admins changing the same row cannot both win.
      .eq("role", row.role)
      .select("id");
    if (error) throw new ServiceError("UNAVAILABLE", "Could not update that role.");
    if (!data?.length) {
      throw new ServiceError("CONFLICT", "Their role changed while you were editing it. Refresh and try again.");
    }

    return {
      data: { membershipId: row.id, role: args.role },
      entityId: row.id,
      before: { role: row.role },
      after: { role: args.role },
    };
  },
});

/* ------------------------------------------------------------ permissions */

const permissionsSchema = z.object({
  membershipId: z.uuid(),
  capability: z.enum(["send_outbound", "manage_integrations", "manage_billing"]),
  choice: z.enum(["default", "allow", "deny"]),
});

defineOperation("member.set_permissions", {
  schema: permissionsSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof permissionsSchema>>) {
    const actor = actorOf(context);
    const row = await loadMember(context.businessId, args.membershipId);
    const problem = permissionChangeProblem({
      actor,
      target: { userId: row.user_id, role: row.role, status: row.status },
      capability: args.capability,
    });
    if (problem) throw new ServiceError("FORBIDDEN_ROLE", problem);

    const column = CAPABILITIES.find((c) => c.key === args.capability)!.column;
    const client = createAdminClient() as unknown as SupabaseClient;
    const { data: current, error: readError } = await client
      .from("business_members")
      .select(column)
      .eq("id", row.id)
      .eq("business_id", context.businessId)
      .maybeSingle();
    if (readError) {
      throw new ServiceError(
        "UNAVAILABLE",
        readError.code === "42703"
          ? "Per-person permissions are not switched on yet (database update pending)."
          : "Could not read their permissions.",
      );
    }
    const before = ((current as Record<string, unknown> | null)?.[column] ?? null) as boolean | null;
    const next = choiceToValue(args.choice);

    const { data, error } = await client
      .from("business_members")
      .update({ [column]: next })
      .eq("id", row.id)
      .eq("business_id", context.businessId)
      // Compare-and-set on the role: a role change in between clears overrides
      // (0172 trigger), so a stale screen cannot re-apply one to a new role.
      .eq("role", row.role)
      .select("id");
    if (error) throw new ServiceError("UNAVAILABLE", "Could not update their permissions.");
    if (!data?.length) {
      throw new ServiceError("CONFLICT", "Their role changed while you were editing. Refresh and try again.");
    }

    return {
      data: { membershipId: row.id, capability: args.capability, choice: args.choice },
      entityId: row.id,
      before: { [args.capability]: before },
      after: { [args.capability]: next },
    };
  },
});

/* ----------------------------------------------------------------- remove */

/** Tables holding work a person owns, and which of their rows are still open. */
async function reassignOpenWork(
  businessId: string,
  fromUserId: string,
  toUserId: string | null,
): Promise<{ leads: number; conversations: number; handoffs: number }> {
  const admin = createAdminClient();

  const leads = await admin
    .from("leads")
    .update({ assigned_user_id: toUserId })
    .eq("business_id", businessId)
    .eq("assigned_user_id", fromUserId)
    .is("archived_at", null)
    .select("id");
  if (leads.error) throw new ServiceError("UNAVAILABLE", "Their leads could not be reassigned.");

  const conversations = await admin
    .from("conversations")
    .update({ assigned_user_id: toUserId })
    .eq("business_id", businessId)
    .eq("assigned_user_id", fromUserId)
    .eq("is_archived", false)
    .select("id");
  if (conversations.error) {
    throw new ServiceError("UNAVAILABLE", "Their conversations could not be reassigned.");
  }

  const handoffs = await admin
    .from("agent_handoffs")
    .update({ assigned_user_id: toUserId })
    .eq("business_id", businessId)
    .eq("assigned_user_id", fromUserId)
    .is("resolved_at", null)
    .select("id");
  if (handoffs.error) throw new ServiceError("UNAVAILABLE", "Their handovers could not be reassigned.");

  return {
    leads: leads.data?.length ?? 0,
    conversations: conversations.data?.length ?? 0,
    handoffs: handoffs.data?.length ?? 0,
  };
}

defineOperation("member.remove", {
  schema: z.object({
    membershipId: z.uuid(),
    /** Who inherits their open work. Omitted or null leaves it unassigned. */
    reassignToUserId: z.uuid().nullable().optional(),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{ membershipId: string; reassignToUserId?: string | null }>) {
    const actor = actorOf(context);
    const row = await loadMember(context.businessId, args.membershipId);
    const problem = removalProblem({ actor, target: facts(row) });
    if (problem) throw new ServiceError("FORBIDDEN_ROLE", problem);

    const revoking = row.status === "invited";
    const recipientId = revoking ? null : (args.reassignToUserId ?? null);

    if (recipientId) {
      const { data, error } = await createAdminClient()
        .from("business_members")
        .select(MEMBER_FIELDS)
        .eq("business_id", context.businessId)
        .eq("user_id", recipientId)
        .maybeSingle();
      if (error) throw new ServiceError("UNAVAILABLE", "The new owner of their work could not be checked.");
      const reason = reassignmentProblem({
        removedUserId: row.user_id,
        recipient: data ? facts(data as MemberRow) : null,
      });
      if (reason) throw new ServiceError("INVALID_INPUT", reason);
    }

    // Hand their work on first: if that fails they still have access and
    // nothing is orphaned. Removing first could leave leads with an owner
    // nobody can reach.
    const moved = revoking
      ? { leads: 0, conversations: 0, handoffs: 0 }
      : await reassignOpenWork(context.businessId, row.user_id, recipientId);

    const { error } = await createAdminClient()
      .from("business_members")
      .update({ status: "removed" })
      .eq("id", row.id)
      .eq("business_id", context.businessId);
    if (error) throw new ServiceError("UNAVAILABLE", "Could not remove that person.");

    return {
      data: { membershipId: row.id, revoked: revoking, reassignedTo: recipientId, moved },
      entityId: row.id,
      before: { status: row.status, role: row.role },
      after: { status: "removed", reassigned_to: recipientId, moved },
    };
  },
});

/* --------------------------------------------------------------- transfer */

defineOperation("member.transfer_ownership", {
  schema: z.object({
    membershipId: z.uuid(),
    /** The new owner's email, typed by the current owner to confirm. */
    confirmEmail: z.string().trim().max(254),
  }),
  async run({ args, context }: HandlerInput<{ membershipId: string; confirmEmail: string }>) {
    const actor = actorOf(context);
    const admin = createAdminClient();
    const target = await loadMember(context.businessId, args.membershipId);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("email")
      .eq("id", target.user_id)
      .maybeSingle();
    if (profileError) throw new ServiceError("UNAVAILABLE", "The new owner could not be checked.");
    const targetEmail = profile?.email ?? target.invited_email ?? "";

    const problem = transferProblem({
      actor,
      target: facts(target),
      targetEmail,
      confirmEmail: args.confirmEmail,
    });
    if (problem) throw new ServiceError("INVALID_INPUT", problem);

    // Promote first, then step down. If the second write fails the workspace
    // has two owners for a moment — recoverable — rather than none.
    const { data: promoted, error: promoteError } = await admin
      .from("business_members")
      .update({ role: "owner" })
      .eq("id", target.id)
      .eq("business_id", context.businessId)
      .eq("status", "active")
      .select("id");
    if (promoteError) throw new ServiceError("UNAVAILABLE", "Ownership could not be transferred.");
    if (!promoted?.length) {
      throw new ServiceError("CONFLICT", "They are no longer an active member. Refresh and try again.");
    }

    const { error: demoteError } = await admin
      .from("business_members")
      .update({ role: "admin" })
      .eq("business_id", context.businessId)
      .eq("user_id", actor.userId)
      .eq("role", "owner");

    return {
      data: { newOwnerMembershipId: target.id, previousOwnerUserId: actor.userId },
      entityId: target.id,
      before: { new_owner_role: target.role, previous_owner_role: "owner" },
      after: { new_owner_role: "owner", previous_owner_role: demoteError ? "owner" : "admin" },
      warnings: demoteError
        ? [
            {
              code: "still_owner",
              message: "They are now an owner, but your own role could not be changed. You are both owners until you try again.",
            },
          ]
        : [],
    };
  },
});
