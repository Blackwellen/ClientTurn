/**
 * Team membership rules (coverage tracker 8.15).
 *
 * Pure — no `server-only`, no Supabase — so the same guardrails are asserted in
 * tests, enforced by the `member.*` service operations and mirrored by the Team
 * settings UI. The UI only hides what these rules would refuse; the service
 * layer is what refuses it.
 *
 * The invariants:
 *   * There is always an owner. The owner role is never assigned, invited or
 *     removed — it only moves, by the owner transferring it.
 *   * Nobody changes their own role or removes themselves.
 *   * Admins manage members and viewers; only the owner manages admins, and
 *     so only the owner creates one (by invitation or promotion). Nobody can
 *     make what they could not then manage.
 *   * An invitation lapses after INVITE_TTL_DAYS and stops holding a seat.
 */

export type TeamRole = "owner" | "admin" | "member" | "viewer";
export type AssignableRole = Exclude<TeamRole, "owner">;

export const ASSIGNABLE_TEAM_ROLES: readonly AssignableRole[] = ["admin", "member", "viewer"];

/** How long an invitation stays usable. Resending restarts the clock. */
export const INVITE_TTL_DAYS = 14;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 86_400_000;

export type MemberFacts = {
  userId: string | null;
  role: TeamRole;
  status: string;
  invitedAt: string | null;
};

export type Actor = { userId: string; role: TeamRole };

/**
 * Whether an invitation has lapsed. An invite with no timestamp predates this
 * rule and is left usable rather than silently expired.
 */
export function inviteExpired(invitedAt: string | null, now: Date = new Date()): boolean {
  if (!invitedAt) return false;
  const sent = Date.parse(invitedAt);
  if (!Number.isFinite(sent)) return false;
  return now.getTime() - sent >= INVITE_TTL_MS;
}

/** When an invitation lapses, or null when it has no timestamp. */
export function inviteExpiresAt(invitedAt: string | null): Date | null {
  if (!invitedAt) return null;
  const sent = Date.parse(invitedAt);
  return Number.isFinite(sent) ? new Date(sent + INVITE_TTL_MS) : null;
}

/**
 * Seats a workspace is using: everyone who can sign in (active), everyone who
 * could be reinstated (suspended) and every invitation still open. A lapsed
 * invitation holds no seat — it cannot be accepted.
 */
export function seatsInUse(members: MemberFacts[], now: Date = new Date()): number {
  return members.filter((member) => {
    if (member.status === "active" || member.status === "suspended") return true;
    if (member.status === "invited") return !inviteExpired(member.invitedAt, now);
    return false;
  }).length;
}

export function seatLimitMessage(limit: number, planName: string): string {
  return `Your ${planName} plan includes ${limit} ${limit === 1 ? "seat" : "seats"}, and every one is in use. Upgrade your plan, or remove someone or revoke an invitation, to add another person.`;
}

function manages(actor: Pick<Actor, "role">): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

/** The roles `actor` may give by invitation or role change. */
export function assignableRolesFor(actor: Pick<Actor, "role">): AssignableRole[] {
  if (actor.role === "owner") return [...ASSIGNABLE_TEAM_ROLES];
  if (actor.role === "admin") return ASSIGNABLE_TEAM_ROLES.filter((role) => role !== "admin");
  return [];
}

/** Why `actor` may not invite someone as `role`, or null when they may. */
export function inviteProblem(input: { actor: Pick<Actor, "role">; role: string }): string | null {
  const { actor, role } = input;
  if (!manages(actor)) return "Only an owner or admin can invite people.";
  if (role === "owner") {
    return "Ownership cannot be granted by invitation. The owner can transfer it once they have joined.";
  }
  if (!(ASSIGNABLE_TEAM_ROLES as readonly string[]).includes(role)) return "That role is not valid.";
  if (role === "admin" && actor.role !== "owner") return "Only the owner can invite an admin.";
  return null;
}

/** Why `actor` may not change `target` to `nextRole`, or null when they may. */
export function roleChangeProblem(input: {
  actor: Actor;
  target: MemberFacts;
  nextRole: string;
}): string | null {
  const { actor, target, nextRole } = input;
  if (!manages(actor)) return "Only an owner or admin can change roles.";
  if (target.status === "removed") return "That person is no longer part of this workspace.";
  if (nextRole === "owner") {
    return "Ownership is transferred, not assigned. The owner can transfer it from the member's menu.";
  }
  if (!(ASSIGNABLE_TEAM_ROLES as readonly string[]).includes(nextRole)) {
    return "That role is not valid.";
  }
  if (target.userId === actor.userId) return "You cannot change your own role.";
  if (target.role === "owner") return "The owner's role cannot be changed. The owner can transfer ownership instead.";
  if (target.role === "admin" && actor.role !== "owner") {
    return "Only the owner can change an admin's role.";
  }
  if (nextRole === "admin" && actor.role !== "owner") {
    return "Only the owner can make someone an admin.";
  }
  if (target.role === nextRole) return `They are already ${nextRole === "admin" ? "an" : "a"} ${nextRole}.`;
  return null;
}

/** Why `actor` may not remove (or, for an invite, revoke) `target`. */
export function removalProblem(input: { actor: Actor; target: MemberFacts }): string | null {
  const { actor, target } = input;
  if (!manages(actor)) return "Only an owner or admin can remove people.";
  if (target.status === "removed") return "That person is no longer part of this workspace.";
  if (target.role === "owner") return "The owner cannot be removed. Transfer ownership first.";
  if (target.userId === actor.userId) return "You cannot remove yourself from the workspace.";
  if (target.role === "admin" && actor.role !== "owner") {
    return "Only the owner can remove an admin.";
  }
  return null;
}

/**
 * Who a leaving member's open work may be handed to: an active person who can
 * work leads. A viewer cannot act on what they would inherit.
 */
export function reassignmentProblem(input: {
  removedUserId: string | null;
  recipient: MemberFacts | null;
}): string | null {
  const { removedUserId, recipient } = input;
  if (!recipient) return "Choose someone who is an active member of this workspace.";
  if (recipient.status !== "active") return "Their work can only go to an active member.";
  if (recipient.userId && recipient.userId === removedUserId) {
    return "Choose someone other than the person being removed.";
  }
  if (recipient.role === "viewer") return "A viewer cannot work leads. Choose a member, admin or the owner.";
  return null;
}

/**
 * Why ownership may not pass to `target`. The owner confirms by typing the new
 * owner's email address — a deliberate act that a mis-click cannot complete.
 */
export function transferProblem(input: {
  actor: Actor;
  target: MemberFacts;
  targetEmail: string;
  confirmEmail: string;
}): string | null {
  const { actor, target, targetEmail, confirmEmail } = input;
  if (actor.role !== "owner") return "Only the owner can transfer ownership.";
  if (target.userId === actor.userId) return "You already own this workspace.";
  if (target.status !== "active") return "Ownership can only pass to someone who has accepted their invitation.";
  if (target.role === "viewer") return "Make them a member or admin before handing them ownership.";
  if (!targetEmail || confirmEmail.trim().toLowerCase() !== targetEmail.trim().toLowerCase()) {
    return "Type the new owner's email address exactly to confirm.";
  }
  return null;
}

/**
 * The invitation email for someone who already has a ClientTurn account.
 * (A brand-new address gets Supabase Auth's own invite, which also creates
 * the account.) Accepting is signing in: the pending membership activates
 * against their verified email, until the invitation lapses.
 */
export function existingAccountInviteEmail(input: {
  workspaceName: string;
  role: AssignableRole;
  invitedAt: Date;
  siteUrl: string;
}): { subject: string; text: string; link: string } {
  const link = `${input.siteUrl.replace(/\/$/, "")}/login`;
  const expires = new Date(input.invitedAt.getTime() + INVITE_TTL_MS).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const article = input.role === "admin" ? "an" : "a";
  return {
    subject: `You've been invited to ${input.workspaceName} on ClientTurn`,
    link,
    text: [
      "Hello,",
      "",
      `You've been invited to join ${input.workspaceName} on ClientTurn as ${article} ${input.role}.`,
      "",
      "To accept, sign in with this email address:",
      link,
      "",
      `The invitation expires on ${expires}. If you weren't expecting it, you can ignore this email.`,
      "",
      "ClientTurn",
    ].join("\n"),
  };
}

/** What a member's row offers the current actor. Mirrors the rules above. */
export function memberActions(input: {
  actor: Actor;
  target: MemberFacts;
  now?: Date;
}): { changeRole: boolean; remove: boolean; resend: boolean; revoke: boolean; transfer: boolean } {
  const { actor, target } = input;
  const invited = target.status === "invited";
  const canRemove = removalProblem({ actor, target }) === null;
  return {
    changeRole:
      manages(actor) &&
      target.userId !== actor.userId &&
      target.role !== "owner" &&
      target.status !== "removed" &&
      (target.role !== "admin" || actor.role === "owner"),
    remove: !invited && canRemove,
    resend: invited && canRemove,
    revoke: invited && canRemove,
    transfer:
      actor.role === "owner" &&
      target.userId !== actor.userId &&
      target.status === "active" &&
      target.role !== "viewer",
  };
}
