/**
 * Finer-grained team permissions (enterprise readiness, 2026-09-28).
 *
 * Pure: no `server-only`, no Supabase. The same rules are asserted in tests,
 * enforced server-side (`requireCapability` in `./permissions.ts` and the
 * service runtime) and mirrored by Settings -> Team.
 *
 * ## The model
 *
 * The four workspace roles are unchanged: owner, admin, member, viewer. The
 * viewer role is the read-only (analyst) seat: it can read every screen and
 * change nothing.
 *
 * On top of the role, three capabilities can be set per person:
 *
 *   send_outbound        send messages, launch campaigns, send quotes/invoices,
 *                        request voice calls
 *   manage_integrations  connect, disconnect and configure integrations
 *   manage_billing       plans, checkout, the billing portal, purchases
 *
 * Each person's value is either "role default" (null, the stored state for
 * everyone until someone changes it) or an explicit allow/deny. With every
 * override null the effective permissions are exactly the pre-existing role
 * checks, so nothing changes for a workspace that never touches this.
 *
 * Invariants:
 *   * The owner always holds every capability; it cannot be taken away (a
 *     workspace must never lock its own owner out of billing).
 *   * A viewer holds none; it cannot be granted any (read-only means
 *     read-only).
 *   * Billing can be delegated to an admin, never to a member.
 *   * Overrides that do not apply to a role are ignored, and the database
 *     clears them whenever the role changes (0172 trigger).
 */

export type TeamRoleName = "owner" | "admin" | "member" | "viewer";

export type Capability = "send_outbound" | "manage_integrations" | "manage_billing";

export type CapabilityOverrides = Partial<Record<Capability, boolean | null>>;

export const CAPABILITIES: readonly {
  key: Capability;
  label: string;
  description: string;
  /** The `business_members` column holding the override. */
  column: "can_send_outbound" | "can_manage_integrations" | "can_manage_billing";
}[] = [
  {
    key: "send_outbound",
    label: "Send outbound",
    description:
      "Send messages and booking links, launch campaigns, send quotes and invoices, and request AI calls.",
    column: "can_send_outbound",
  },
  {
    key: "manage_integrations",
    label: "Manage integrations",
    description: "Connect, disconnect and configure CRMs, calendars, lead sources and channels.",
    column: "can_manage_integrations",
  },
  {
    key: "manage_billing",
    label: "Manage billing",
    description: "Change the plan, buy credits, minutes and numbers, and open the billing portal.",
    column: "can_manage_billing",
  },
] as const;

export const CAPABILITY_KEYS: readonly Capability[] = CAPABILITIES.map((c) => c.key);

export const CAPABILITY_COLUMNS = CAPABILITIES.map((c) => c.column).join(", ");

/**
 * What each role holds with no override. This table IS the pre-existing
 * behaviour: outbound sends needed a member, integration screens an admin,
 * billing purchases the owner.
 */
const ROLE_DEFAULTS: Record<TeamRoleName, Record<Capability, boolean>> = {
  owner: { send_outbound: true, manage_integrations: true, manage_billing: true },
  admin: { send_outbound: true, manage_integrations: true, manage_billing: false },
  member: { send_outbound: true, manage_integrations: false, manage_billing: false },
  viewer: { send_outbound: false, manage_integrations: false, manage_billing: false },
};

/** Which capabilities may be overridden for a person holding `role`. */
const OVERRIDABLE: Record<TeamRoleName, readonly Capability[]> = {
  owner: [],
  admin: ["send_outbound", "manage_integrations", "manage_billing"],
  member: ["send_outbound", "manage_integrations"],
  viewer: [],
};

function knownRole(role: string): role is TeamRoleName {
  return role === "owner" || role === "admin" || role === "member" || role === "viewer";
}

export function roleDefault(role: string, capability: Capability): boolean {
  if (!knownRole(role)) return false;
  return ROLE_DEFAULTS[role][capability];
}

export function canOverride(role: string, capability: Capability): boolean {
  if (!knownRole(role)) return false;
  return OVERRIDABLE[role].includes(capability);
}

/** The effective answer for one capability. Unknown roles hold nothing. */
export function capabilityAllowed(
  role: string,
  capability: Capability,
  overrides: CapabilityOverrides | null | undefined,
): boolean {
  if (!knownRole(role)) return false;
  const value = overrides?.[capability];
  if (typeof value === "boolean" && canOverride(role, capability)) return value;
  return roleDefault(role, capability);
}

export function effectiveCapabilities(
  role: string,
  overrides: CapabilityOverrides | null | undefined,
): Record<Capability, boolean> {
  return {
    send_outbound: capabilityAllowed(role, "send_outbound", overrides),
    manage_integrations: capabilityAllowed(role, "manage_integrations", overrides),
    manage_billing: capabilityAllowed(role, "manage_billing", overrides),
  };
}

/** Reads the three nullable columns off a `business_members` row. */
export function overridesFromRow(row: Record<string, unknown> | null | undefined): CapabilityOverrides {
  const out: CapabilityOverrides = {};
  if (!row) return out;
  for (const { key, column } of CAPABILITIES) {
    const value = row[column];
    out[key] = typeof value === "boolean" ? value : null;
  }
  return out;
}

/* ------------------------------------------------ service-layer mapping */

/**
 * How a capability applies to a service operation.
 *
 * `additional`: the operation's own `minimumRole` still applies, and the
 * capability is a further gate (a member told "no outbound" cannot send even
 * though members normally can).
 *
 * `replaces_role`: the capability is the gate. With default overrides it
 * reproduces the operation's `minimumRole` exactly (asserted in tests), so the
 * only change is that an owner can now delegate or withhold it.
 */
export type OperationCapability = { capability: Capability; mode: "additional" | "replaces_role" };

const OPERATION_CAPABILITIES: Record<string, OperationCapability> = {
  "message.send": { capability: "send_outbound", mode: "additional" },
  "campaign.launch": { capability: "send_outbound", mode: "additional" },
  "quote.send": { capability: "send_outbound", mode: "additional" },
  "invoice.issue": { capability: "send_outbound", mode: "additional" },
  "voice.request_call": { capability: "send_outbound", mode: "additional" },
  // Approving an agent's AI call places it: the same capability as pressing Call with AI.
  "agent.decide_call": { capability: "send_outbound", mode: "additional" },

  "connector.replay_event": { capability: "manage_integrations", mode: "replaces_role" },
  "connector.dismiss_event": { capability: "manage_integrations", mode: "replaces_role" },
  "connector.disconnect": { capability: "manage_integrations", mode: "replaces_role" },
  "crm_pull.set": { capability: "manage_integrations", mode: "replaces_role" },
  "whatsapp_template.sync": { capability: "manage_integrations", mode: "replaces_role" },
  "whatsapp_template.map_step": { capability: "manage_integrations", mode: "replaces_role" },
  "pipeline.set_mapping": { capability: "manage_integrations", mode: "replaces_role" },

  "billing.end_trial_now": { capability: "manage_billing", mode: "replaces_role" },
};

export function operationCapability(name: string): OperationCapability | null {
  return OPERATION_CAPABILITIES[name] ?? null;
}

export function operationsWithCapabilities(): string[] {
  return Object.keys(OPERATION_CAPABILITIES).sort();
}

/**
 * Callers acting as a signed-in person, whose own permissions apply. The
 * conversation AGENT and SYSTEM jobs act under the workspace's own settings
 * (the agent's sending is governed by its policy and stop conditions), so
 * per-person capabilities do not apply to them.
 */
export const PERSON_CALLERS: ReadonlySet<string> = new Set([
  "UI",
  "COPILOT",
  "MCP",
  "API",
  "AUTOMATION",
]);

/* ------------------------------------------------- who may change them */

export type PermissionActor = { userId: string; role: string };
export type PermissionTarget = { userId: string | null; role: string; status: string };

/**
 * Why `actor` may not set `capability` for `target`, or null when they may.
 * Mirrors the role-change rules in `@/lib/team/rules`: admins manage members
 * and viewers, only the owner manages admins, nobody edits themselves. Billing
 * is only ever delegated by the owner.
 */
export function permissionChangeProblem(input: {
  actor: PermissionActor;
  target: PermissionTarget;
  capability: Capability;
}): string | null {
  const { actor, target, capability } = input;
  if (actor.role !== "owner" && actor.role !== "admin") {
    return "Only an owner or admin can change permissions.";
  }
  if (target.status === "removed") return "That person is no longer part of this workspace.";
  if (target.userId && target.userId === actor.userId) return "You cannot change your own permissions.";
  if (target.role === "owner") return "The owner always has every permission.";
  if (target.role === "viewer") {
    return "Viewers are read-only. Change their role to member first.";
  }
  if (target.role === "admin" && actor.role !== "owner") {
    return "Only the owner can change an admin's permissions.";
  }
  if (capability === "manage_billing" && actor.role !== "owner") {
    return "Only the owner can delegate billing.";
  }
  if (!canOverride(target.role, capability)) {
    return capability === "manage_billing"
      ? "Billing can only be delegated to an admin."
      : "That permission cannot be changed for this role.";
  }
  return null;
}

/** "default" | "allow" | "deny" as stored: null | true | false. */
export type OverrideChoice = "default" | "allow" | "deny";

export function choiceToValue(choice: OverrideChoice): boolean | null {
  return choice === "default" ? null : choice === "allow";
}

export function valueToChoice(value: boolean | null | undefined): OverrideChoice {
  return value === true ? "allow" : value === false ? "deny" : "default";
}
