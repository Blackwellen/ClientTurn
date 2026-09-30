import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  INVITE_TTL_DAYS,
  assignableRolesFor,
  existingAccountInviteEmail,
  inviteProblem,
  inviteExpired,
  inviteExpiresAt,
  memberActions,
  reassignmentProblem,
  removalProblem,
  roleChangeProblem,
  seatsInUse,
  transferProblem,
  type Actor,
  type MemberFacts,
} from "../src/lib/team/rules.ts";
import {
  operationsForCaller,
  registryProblems,
  serviceOperation,
} from "../src/lib/services/registry.ts";
import { requiresConfirmation } from "../src/lib/services/types.ts";

const NOW = new Date("2026-09-26T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const owner: Actor = { userId: "u-owner", role: "owner" };
const admin: Actor = { userId: "u-admin", role: "admin" };
const memberActor: Actor = { userId: "u-member", role: "member" };

const facts = (over: Partial<MemberFacts>): MemberFacts => ({
  userId: "u-target",
  role: "member",
  status: "active",
  invitedAt: null,
  ...over,
});

function source(relative: string) {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("invitation expiry", () => {
  test("an invitation lapses after the TTL, not before", () => {
    assert.equal(inviteExpired(daysAgo(INVITE_TTL_DAYS - 1), NOW), false);
    assert.equal(inviteExpired(daysAgo(INVITE_TTL_DAYS), NOW), true);
  });

  test("an invite with no timestamp predates the rule and stays usable", () => {
    assert.equal(inviteExpired(null, NOW), false);
    assert.equal(inviteExpired("not a date", NOW), false);
  });

  test("the expiry date is the send date plus the TTL", () => {
    const sent = "2026-09-01T00:00:00.000Z";
    assert.equal(inviteExpiresAt(sent)?.toISOString(), "2026-09-15T00:00:00.000Z");
    assert.equal(inviteExpiresAt(null), null);
  });
});

describe("existing-account invitation email", () => {
  test("names the workspace and role, links to sign-in and states the expiry", () => {
    const email = existingAccountInviteEmail({
      workspaceName: "Northwind Studio",
      role: "admin",
      invitedAt: new Date("2026-09-01T09:00:00Z"),
      siteUrl: "https://app.clientturn.com/",
    });
    assert.equal(email.link, "https://app.clientturn.com/login");
    assert.match(email.subject, /Northwind Studio/);
    assert.match(email.text, /as an admin/);
    assert.match(email.text, /expires on 15 September 2026/);
  });

  test("the service sends it when Supabase cannot invite a confirmed account", () => {
    const team = source("src/lib/services/operations/team.ts");
    assert.ok(team.includes("sendExistingAccountInvite("));
    assert.ok(team.includes("hasAccount: Boolean(profile)"));
  });

  test("a new address the Supabase mailer refused gets its one-time link through Resend", () => {
    const email = existingAccountInviteEmail({
      workspaceName: "Northwind Studio",
      role: "member",
      invitedAt: new Date("2026-09-01T09:00:00Z"),
      siteUrl: "https://app.clientturn.com/",
      acceptLink: "https://project.supabase.co/auth/v1/verify?token=abc&type=invite",
    });
    assert.equal(email.link, "https://project.supabase.co/auth/v1/verify?token=abc&type=invite");
    assert.match(email.text, /open this link and choose a password/);
    assert.doesNotMatch(email.text, /sign in with this email address/);

    const team = source("src/lib/services/operations/team.ts");
    assert.ok(team.includes('generateLink({\n      type: "invite"'), "falls back to generateLink for a new address");
    assert.ok(team.includes("acceptLink,"), "passes the link to the Resend email");
  });
});

describe("seat counting", () => {
  test("active, suspended and open invitations hold seats; lapsed and removed do not", () => {
    const members: MemberFacts[] = [
      facts({ status: "active" }),
      facts({ status: "suspended" }),
      facts({ status: "invited", invitedAt: daysAgo(1) }),
      facts({ status: "invited", invitedAt: daysAgo(30) }),
      facts({ status: "removed" }),
    ];
    assert.equal(seatsInUse(members, NOW), 3);
  });
});

describe("role changes", () => {
  test("ownership is never assigned through a role change", () => {
    assert.match(
      roleChangeProblem({ actor: owner, target: facts({}), nextRole: "owner" }) ?? "",
      /transferred/,
    );
  });

  test("nobody changes their own role", () => {
    assert.ok(roleChangeProblem({ actor: admin, target: facts({ userId: admin.userId, role: "admin" }), nextRole: "member" }));
  });

  test("the owner's role cannot be changed, so the last owner cannot be demoted", () => {
    assert.ok(roleChangeProblem({ actor: admin, target: facts({ role: "owner" }), nextRole: "admin" }));
    assert.ok(roleChangeProblem({ actor: owner, target: facts({ userId: owner.userId, role: "owner" }), nextRole: "admin" }));
  });

  test("only the owner changes an admin's role", () => {
    assert.ok(roleChangeProblem({ actor: admin, target: facts({ role: "admin" }), nextRole: "member" }));
    assert.equal(roleChangeProblem({ actor: owner, target: facts({ role: "admin" }), nextRole: "member" }), null);
  });

  test("an admin can move people between member and viewer", () => {
    assert.equal(roleChangeProblem({ actor: admin, target: facts({ role: "member" }), nextRole: "viewer" }), null);
    assert.equal(roleChangeProblem({ actor: admin, target: facts({ role: "viewer" }), nextRole: "member" }), null);
  });

  test("only the owner makes someone an admin: nobody creates what they cannot manage", () => {
    assert.match(
      roleChangeProblem({ actor: admin, target: facts({ role: "viewer" }), nextRole: "admin" }) ?? "",
      /Only the owner/,
    );
    assert.equal(roleChangeProblem({ actor: owner, target: facts({ role: "member" }), nextRole: "admin" }), null);
  });

  test("only the owner invites an admin", () => {
    assert.match(inviteProblem({ actor: admin, role: "admin" }) ?? "", /Only the owner/);
    assert.equal(inviteProblem({ actor: admin, role: "member" }), null);
    assert.equal(inviteProblem({ actor: admin, role: "viewer" }), null);
    assert.equal(inviteProblem({ actor: owner, role: "admin" }), null);
    assert.ok(inviteProblem({ actor: owner, role: "owner" }));
    assert.ok(inviteProblem({ actor: memberActor, role: "viewer" }));
    assert.deepEqual(assignableRolesFor(owner), ["admin", "member", "viewer"]);
    assert.deepEqual(assignableRolesFor(admin), ["member", "viewer"]);
    assert.deepEqual(assignableRolesFor(memberActor), []);
  });

  test("members and viewers manage nobody", () => {
    assert.ok(roleChangeProblem({ actor: memberActor, target: facts({ role: "viewer" }), nextRole: "member" }));
  });

  test("an unknown role and a no-op are refused", () => {
    assert.ok(roleChangeProblem({ actor: owner, target: facts({}), nextRole: "superuser" }));
    assert.match(roleChangeProblem({ actor: owner, target: facts({ role: "member" }), nextRole: "member" }) ?? "", /already/);
  });
});

describe("removal and reassignment", () => {
  test("the owner, yourself and (for admins) other admins cannot be removed", () => {
    assert.ok(removalProblem({ actor: owner, target: facts({ role: "owner" }) }));
    assert.ok(removalProblem({ actor: admin, target: facts({ userId: admin.userId, role: "admin" }) }));
    assert.ok(removalProblem({ actor: admin, target: facts({ role: "admin" }) }));
    assert.equal(removalProblem({ actor: owner, target: facts({ role: "admin" }) }), null);
    assert.equal(removalProblem({ actor: admin, target: facts({ role: "member" }) }), null);
  });

  test("work only goes to an active person who can work leads, other than the leaver", () => {
    assert.equal(reassignmentProblem({ removedUserId: "u-target", recipient: facts({ userId: "u-2" }) }), null);
    assert.ok(reassignmentProblem({ removedUserId: "u-target", recipient: null }));
    assert.ok(reassignmentProblem({ removedUserId: "u-target", recipient: facts({ userId: "u-2", role: "viewer" }) }));
    assert.ok(reassignmentProblem({ removedUserId: "u-target", recipient: facts({ userId: "u-2", status: "invited" }) }));
    assert.ok(reassignmentProblem({ removedUserId: "u-target", recipient: facts({ userId: "u-target" }) }));
  });
});

describe("ownership transfer", () => {
  const target = facts({ role: "admin" });

  test("needs the owner, an active non-viewer target and the typed email", () => {
    assert.equal(
      transferProblem({ actor: owner, target, targetEmail: "Sam@Example.com", confirmEmail: " sam@example.com " }),
      null,
    );
    assert.ok(transferProblem({ actor: admin, target, targetEmail: "sam@example.com", confirmEmail: "sam@example.com" }));
    assert.ok(transferProblem({ actor: owner, target, targetEmail: "sam@example.com", confirmEmail: "sam@example.co" }));
    assert.ok(transferProblem({ actor: owner, target: facts({ status: "invited" }), targetEmail: "a@b.co", confirmEmail: "a@b.co" }));
    assert.ok(transferProblem({ actor: owner, target: facts({ role: "viewer" }), targetEmail: "a@b.co", confirmEmail: "a@b.co" }));
    assert.ok(transferProblem({ actor: owner, target: facts({ userId: owner.userId }), targetEmail: "a@b.co", confirmEmail: "a@b.co" }));
  });
});

describe("row actions mirror the rules", () => {
  test("an open invite offers resend and revoke, not remove", () => {
    const actions = memberActions({ actor: admin, target: facts({ status: "invited", invitedAt: daysAgo(1) }) });
    assert.deepEqual(
      { resend: actions.resend, revoke: actions.revoke, remove: actions.remove },
      { resend: true, revoke: true, remove: false },
    );
  });

  test("only the owner sees Make owner, and never on their own row", () => {
    assert.equal(memberActions({ actor: owner, target: facts({}) }).transfer, true);
    assert.equal(memberActions({ actor: admin, target: facts({}) }).transfer, false);
    assert.equal(memberActions({ actor: owner, target: facts({ userId: owner.userId, role: "owner" }) }).transfer, false);
  });

  test("an admin's row is read-only to another admin", () => {
    const actions = memberActions({ actor: admin, target: facts({ role: "admin" }) });
    assert.equal(actions.changeRole || actions.remove, false);
  });
});

describe("member operations in the service registry", () => {
  const names = [
    "member.list",
    "member.invite",
    "member.resend_invite",
    "member.set_role",
    "member.remove",
    "member.transfer_ownership",
  ];

  test("every team operation is declared and the catalogue stays well formed", () => {
    for (const name of names) assert.ok(serviceOperation(name), `${name} is not declared`);
    assert.deepEqual(registryProblems(), []);
  });

  test("no unattended agent touches membership; Copilot may only read it", () => {
    const agent = new Set(operationsForCaller("AGENT").map((op) => op.name as string));
    const copilot = new Set(operationsForCaller("COPILOT").map((op) => op.name as string));
    for (const name of names) assert.equal(agent.has(name), false, `${name} reachable by an agent`);
    assert.equal(copilot.has("member.list"), true);
    for (const name of names.filter((n) => n !== "member.list")) {
      assert.equal(copilot.has(name), false, `${name} reachable by Copilot`);
    }
  });

  test("MCP and the API share the writes, and the risky ones need a person", () => {
    const mcp = new Set(operationsForCaller("MCP").map((op) => op.name as string));
    for (const name of names) assert.ok(mcp.has(name), `${name} missing for MCP`);
    for (const name of ["member.invite", "member.resend_invite", "member.remove", "member.transfer_ownership"]) {
      assert.equal(requiresConfirmation(serviceOperation(name)!.risk), true, `${name} runs unconfirmed`);
    }
    assert.equal(serviceOperation("member.transfer_ownership")!.minimumRole, "owner");
  });

  test("the Team UI goes through the service operations, not direct writes", () => {
    const actions = source("src/lib/settings/team-actions.ts");
    for (const name of names.filter((n) => n !== "member.list")) {
      assert.match(actions, new RegExp(`runOperation(<[^>]*>)?\\(\\s*"${name.replace(".", "\\.")}"`), `${name} not called`);
    }
    assert.doesNotMatch(actions, /from\("business_members"\)/);
    const settingsActions = source("src/lib/settings/actions.ts");
    assert.doesNotMatch(settingsActions, /export async function (inviteMember|changeMemberRole|removeMember)\b/);
  });

  test("an expired invitation cannot be accepted", () => {
    assert.match(source("src/lib/auth/invites.ts"), /!inviteExpired\(row\.invited_at\)/);
  });

  test("read policies admit only active members", () => {
    const sql = source("supabase/migrations/0130_member_status_in_read_policies.sql");
    for (const table of ["social_connection_states", "workspace_stream_events", "sourcing_signals"]) {
      assert.match(sql, new RegExp(`'${table}'`));
    }
    assert.match(sql, /public\.is_business_member\(business_id\)/);
  });
});
