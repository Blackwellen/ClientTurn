/**
 * The service operation catalogue (Programme §2, §21 step 1).
 *
 * Pure data. This is the one list of things ClientTurn can be asked to do, and
 * every caller — the UI, Copilot, an autonomous agent, an MCP client — reads it
 * rather than keeping a list of its own. A capability absent from here does not
 * exist for any of them, which is why the tool surfaces cannot drift apart.
 *
 * Deliberately absent, and not by oversight: there is no SQL operation, no HTTP
 * operation, and no "run arbitrary action". Those are outside the layer's
 * authority entirely, so there is no argument shape that could express them.
 */

import {
  callerAllowed,
  declarationProblems,
  type CallerKind,
  type ServiceDeclaration,
} from "./types.ts";

export const SERVICE_OPERATIONS = [
  /* -------------------------------------------------------------- leads
   *
   * `lead.create` is deliberately absent. Creating a lead means deduplication,
   * capturing a relationship for the contactability engine, and starting
   * follow-up — the Add Lead wizard does all three, and declaring a thinner
   * version here would offer callers a capability that quietly skips them.
   * It joins the catalogue when it is ported whole.
   */
  {
    name: "lead.get",
    domain: "lead",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Read one lead and its recent activity",
    entityType: "lead",
  },
  {
    name: "lead.search",
    domain: "lead",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Find leads matching a description",
    entityType: "lead",
  },
  {
    name: "lead.update",
    domain: "lead",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Change a lead's details",
    entityType: "lead",
  },
  {
    name: "lead.assign",
    domain: "lead",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Assign a lead to someone",
    entityType: "lead",
  },
  {
    name: "lead.set_status",
    domain: "lead",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Move a lead to a different status",
    entityType: "lead",
  },
  {
    name: "lead.add_note",
    domain: "lead",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Add a note to a lead",
    entityType: "lead",
  },
  {
    name: "lead.flag_attention",
    domain: "lead",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Flag a lead for attention",
    entityType: "lead",
  },
  {
    name: "lead.archive",
    domain: "lead",
    risk: "DESTRUCTIVE",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Archive a lead",
    effect:
      "The lead stops appearing in your lists and all follow-up for it stops. Its history is kept and an admin can restore it.",
    entityType: "lead",
    // An autonomous agent does not get to decide a lead is finished with.
    callers: ["UI", "COPILOT", "MCP"],
  },
  {
    name: "lead.restore",
    domain: "lead",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Restore an archived lead",
    entityType: "lead",
    callers: ["UI", "COPILOT", "MCP"],
  },

  /* ------------------------------------------------------------- agents
   *
   * The customer-facing Agents: configured background workers a workspace
   * switches on and leaves running.
   *
   * The split of risk classes here is the whole point of putting them in the
   * catalogue rather than exposing the server actions directly. Reading and
   * configuring an agent are ordinary writes — a DRAFT agent does nothing, so
   * getting its setup wrong costs nothing and can be corrected. *Starting* one
   * is a different act entirely: a sourcing agent spends real money on provider
   * lookups on a schedule, without anyone watching. So `agent.start` and
   * `agent.run_now` are FINANCIAL, which means an assistant asking for one gets
   * it parked for a person rather than executed.
   *
   * An agent that is running can always be stopped, and stopping is never
   * gated — the safe direction is always available immediately.
   */
  {
    name: "agent.list",
    domain: "agent",
    risk: "READ",
    minimumRole: "viewer",
    scope: "agents:read",
    summary: "List this workspace's AI agents and their status",
    entityType: "agent",
  },
  {
    name: "agent.get",
    domain: "agent",
    risk: "READ",
    minimumRole: "viewer",
    scope: "agents:read",
    summary: "Read one agent's full configuration and recent activity",
    entityType: "agent",
  },
  {
    name: "agent.create",
    domain: "agent",
    // Safe because it cannot run. An agent is always created in DRAFT and is
    // never started by its own creation, so this changes nothing outside the
    // workspace and needs no confirmation.
    risk: "SAFE_WRITE",
    minimumRole: "admin",
    scope: "agents:write",
    summary: "Create an AI agent as a draft, with its sources, schedule and limits",
    entityType: "agent",
    // Excludes AGENT. An unattended agent that could create agents is a loop,
    // and each new one is another schedule spending the plan's budget.
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "agent.configure",
    domain: "agent",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "agents:write",
    summary: "Change an agent's schedule, limits, sources or autonomy",
    entityType: "agent",
    // Excludes AGENT, and this is the important one: an agent that could
    // configure an agent could raise its own daily and monthly spend caps, or
    // set its own autonomy to AUTO and stop routing its work for review. A
    // process must not be able to widen the limits it is running under.
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "agent.start",
    domain: "agent",
    // Spends money on a schedule, unattended. Over MCP this parks for a person.
    risk: "FINANCIAL",
    minimumRole: "admin",
    scope: "agents:write",
    summary: "Start an agent running in the background",
    effect:
      "The agent begins working on its schedule without anyone watching. A sourcing agent spends your plan's provider budget on every run, up to the daily and monthly limits set on it.",
    entityType: "agent",
    // An agent that could start another agent is a loop nobody asked for, and
    // one that spends money on a schedule.
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "agent.run_now",
    domain: "agent",
    risk: "FINANCIAL",
    minimumRole: "admin",
    scope: "agents:write",
    summary: "Run an agent once, immediately",
    effect:
      "The agent does a full run now rather than waiting for its schedule. A sourcing agent spends your plan's provider budget doing it.",
    entityType: "agent",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "agent.pause",
    domain: "agent",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "agents:write",
    summary: "Pause an agent, keeping its setup and queue",
    entityType: "agent",
  },
  {
    name: "agent.stop",
    domain: "agent",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "agents:write",
    summary: "Stop an agent",
    entityType: "agent",
  },

  /* --------------------------------------------------- conversation agent
   *
   * Distinct from the Agents above: this is the assistant that answers a
   * lead's messages. Its settings are read and written here so an MCP client
   * can set one up end to end, but note what is *not* declared — there is no
   * operation that sets a model, a temperature, a token budget or a system
   * prompt. Those stay internal, because a caller that could set them could
   * talk the agent out of its own guardrails.
   */
  {
    name: "ai_settings.get",
    domain: "ai_settings",
    risk: "READ",
    minimumRole: "viewer",
    scope: "agents:read",
    summary: "Read how the conversation assistant is set up",
    entityType: "business",
  },
  {
    name: "ai_settings.update",
    domain: "ai_settings",
    // Reversible, but it changes who answers a customer's leads, so it is an
    // admin act and it is audited with the full before/after.
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "agents:write",
    summary: "Change how the conversation assistant behaves",
    entityType: "business",
    // Excludes AGENT for the same reason as `agent.configure`, and more
    // sharply: these settings are the conversation assistant's own guardrails.
    // An agent able to write here could switch itself from drafting replies to
    // sending them, or turn off handover-on-review — removing the supervision
    // it exists under.
    callers: ["UI", "COPILOT", "MCP", "API"],
  },

  /* -------------------------------------------------------- connectors
   *
   * The systems a workspace has plugged in. Reading is `business:read`
   * because a connection's health is part of "is my workspace working",
   * which is the question that scope answers.
   *
   * The writes are graded by what they break. Replaying or dismissing a failed
   * event is ordinary. Rotating a signing secret or disconnecting a provider
   * silently breaks the customer's own system until they act, which is why both
   * are DESTRUCTIVE and neither can be done by an assistant without a person
   * agreeing first.
   */
  {
    name: "connector.list",
    domain: "connector",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "List connected systems and whether each is healthy",
    entityType: "integration",
  },
  {
    name: "connector.get",
    domain: "connector",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "Read one connection, its recent activity and its last error",
    entityType: "integration",
  },
  {
    name: "connector.replay_event",
    domain: "connector",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Retry a failed inbound event from a connected system",
    entityType: "webhook_event",
    // Excludes AGENT. Replaying an inbound event re-runs the full processing
    // path, which can start follow-up and send messages — so it is not a
    // bookkeeping action an unattended process should take.
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "connector.dismiss_event",
    domain: "connector",
    risk: "SAFE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Dismiss a failed event without retrying it",
    entityType: "webhook_event",
    // Excludes AGENT. Dismissing a failed event is how a person says "I have
    // looked at this". An agent doing it silently would clear the evidence that
    // an integration is broken.
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "connector.disconnect",
    domain: "connector",
    risk: "DESTRUCTIVE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Disconnect a system from this workspace",
    effect:
      "Leads, bookings and messages stop flowing from that system immediately, and reconnecting means signing in to it again. Nothing already received is deleted.",
    entityType: "integration",
    // An autonomous agent runs with nobody watching and cannot set `confirmed`,
    // so a destructive operation it could reach would be one nobody agreed to.
    callers: ["UI", "COPILOT", "MCP", "API"],
  },

  /* --------------------------------------------------------- messaging
   *
   * The most consequential single action in the product: it puts words in the
   * customer's name in front of a real person. EXTERNAL, so it never runs
   * without someone agreeing to this specific message — and over MCP that means
   * it parks with the text visible for a person to read before it goes.
   *
   * The guards are not optional extras and are all re-checked here, not
   * inherited: opt-out, the shared suppression list, and the plan's messaging
   * entitlement.
   */
  {
    name: "message.send",
    domain: "message",
    risk: "EXTERNAL",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Send a message to a lead",
    effect:
      "The message is sent to the lead on the channel you choose. It cannot be recalled once it has gone.",
    entityType: "message",
    // Deliberately excludes COPILOT and AGENT. The agent has its own supervised
    // reply path in `lib/agent` with its own guardrails, and Copilot's authority
    // stops short of sending outreach at all — putting words in the customer's
    // name in front of a real person is not something a chat assistant in the
    // corner of the screen should be able to do. This is the human-initiated
    // door; both of those would be ways round the guardrails, not through them.
    callers: ["UI", "MCP", "API"],
  },

  /* ---------------------------------------------------------- bookings */
  {
    name: "booking.list",
    domain: "booking",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "List appointments, optionally within a date range",
    entityType: "booking",
  },
  {
    name: "booking.get",
    domain: "booking",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Read one appointment and the lead it belongs to",
    entityType: "booking",
  },
  {
    name: "booking.set_status",
    domain: "booking",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Mark an appointment attended, cancelled or a no-show",
    entityType: "booking",
  },

  /* --------------------------------------------------------- campaigns
   *
   * Launching sends real messages to real people, in bulk. It is the single
   * most consequential thing in the product, so it is BULK_EXTERNAL and can
   * never run without a person agreeing on that specific request. Pausing is
   * always available immediately — the safe direction never waits.
   */
  {
    name: "campaign.list",
    domain: "campaign",
    risk: "READ",
    minimumRole: "viewer",
    scope: "campaigns:read",
    summary: "List reactivation campaigns and their progress",
    entityType: "campaign",
  },
  {
    name: "campaign.get",
    domain: "campaign",
    risk: "READ",
    minimumRole: "viewer",
    scope: "campaigns:read",
    summary: "Read one campaign, its audience size and its results",
    entityType: "campaign",
  },
  {
    name: "campaign.pause",
    domain: "campaign",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "campaigns:write",
    summary: "Pause a running campaign",
    entityType: "campaign",
  },
  {
    name: "campaign.resume",
    domain: "campaign",
    // BULK_EXTERNAL, like launching. Resuming restarts sending to everyone left
    // in the audience — it is the same act as a launch, differing only in
    // having happened before. Grading it as an ordinary reversible write made
    // "pause then resume" a way to send a campaign without anyone confirming
    // it, which is precisely the gate `campaign.launch` exists to be.
    risk: "BULK_EXTERNAL",
    minimumRole: "admin",
    scope: "campaigns:write",
    summary: "Resume a paused campaign",
    effect:
      "Sending restarts to everyone still in the audience who is contactable. Suppression and quiet hours are re-checked before each message, but sending cannot be recalled.",
    entityType: "campaign",
    callers: ["UI", "MCP"],
  },
  {
    name: "campaign.launch",
    domain: "campaign",
    risk: "BULK_EXTERNAL",
    minimumRole: "admin",
    scope: "campaigns:write",
    summary: "Launch a campaign",
    effect:
      "Messages are sent to everyone in the audience who is still contactable, at the configured rate. Suppression and quiet hours are re-checked before each send, but the sending itself cannot be recalled.",
    entityType: "campaign",
    // Sending to an entire audience is the most consequential act in the
    // product, and it is outreach by any definition — so neither an autonomous
    // agent nor Copilot is the thing that starts it.
    callers: ["UI", "MCP"],
  },

  /* --------------------------------------------------------- prospects */
  {
    name: "prospect.search",
    domain: "prospect",
    risk: "READ",
    minimumRole: "viewer",
    scope: "prospects:read",
    summary: "Find sourced prospects by name, company, grade or status",
    entityType: "prospect",
  },
  {
    name: "prospect.get",
    domain: "prospect",
    risk: "READ",
    minimumRole: "viewer",
    scope: "prospects:read",
    summary: "Read one prospect, its score and the evidence behind it",
    entityType: "prospect",
  },
  {
    name: "prospect.approve",
    domain: "prospect",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "prospects:write",
    summary: "Approve a prospect for outreach",
    entityType: "prospect",
    // Excludes AGENT. A sourcing agent's autonomy setting is a promise that a
    // person reviews what it found before anyone is contacted; an agent that
    // could approve prospects would be approving its own output and quietly
    // making REVIEW_ALL mean nothing.
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "prospect.reject",
    domain: "prospect",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "prospects:write",
    summary: "Reject a prospect so it is not contacted",
    entityType: "prospect",
  },

  /* ------------------------------------------------ business and metrics */
  {
    name: "business.get_profile",
    domain: "business",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "Read the business profile: services, hours, area and booking setup",
    entityType: "business",
  },
  {
    name: "business.get_status",
    domain: "business",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "Whether this workspace's integrations, sending and background work are healthy",
    entityType: "business",
  },
  {
    name: "analytics.summary",
    domain: "analytics",
    risk: "READ",
    minimumRole: "viewer",
    scope: "analytics:read",
    summary: "Headline numbers for a period: leads, qualified, booked, won",
    entityType: null,
  },
  {
    name: "qualification.list_questions",
    domain: "qualification",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "Read the qualification questions and rules this workspace applies",
    entityType: null,
  },
] as const satisfies readonly ServiceDeclaration[];

/**
 * Every operation name, as a literal union.
 *
 * This is what lets the audit vocabulary stay strict: `audit_log.action` accepts
 * an operation name only because the compiler can prove it is one of these, so
 * a typo becomes a build failure rather than an audit row nobody can search for.
 */
export type ServiceOperationName = (typeof SERVICE_OPERATIONS)[number]["name"];

/**
 * A declaration known to be in the catalogue. Its `name` is the literal union
 * rather than `string`, so anything derived from it — most importantly the
 * audit action — stays checkable by the compiler.
 */
export type RegisteredOperation = ServiceDeclaration & { name: ServiceOperationName };

/**
 * The catalogue as a plain list.
 *
 * `SERVICE_OPERATIONS` is declared `as const` so operation names form a literal
 * union — which is what keeps the audit vocabulary checkable. The cost is that
 * iterating it yields nine unrelated literal shapes rather than one type, so
 * anything that walks the catalogue uses this widened view instead.
 */
export const ALL_OPERATIONS: readonly RegisteredOperation[] = SERVICE_OPERATIONS;

/* ------------------------------------------------------------- accessors */

const BY_NAME = new Map<string, RegisteredOperation>(
  SERVICE_OPERATIONS.map((op) => [op.name, op]),
);

export function serviceOperation(name: string): RegisteredOperation | undefined {
  return BY_NAME.get(name);
}

export function operationsForScopes(scopes: string[]): RegisteredOperation[] {
  const granted = new Set(scopes);
  return SERVICE_OPERATIONS.filter((op) => granted.has(op.scope));
}

export function operationsForCaller(caller: CallerKind): RegisteredOperation[] {
  return SERVICE_OPERATIONS.filter((op) => callerAllowed(op, caller));
}

export function operationsInDomain(domain: string): RegisteredOperation[] {
  return SERVICE_OPERATIONS.filter((op) => op.domain === domain);
}

/** Every scope the catalogue actually uses. The MCP scope list is derived from
 *  this rather than maintained beside it. */
export function declaredScopes(): string[] {
  return [...new Set(SERVICE_OPERATIONS.map((op) => op.scope))].sort();
}

/**
 * Structural problems across the whole catalogue. Asserted by a test rather
 * than thrown at import: a malformed declaration should fail the build, not a
 * customer's request.
 */
export function registryProblems(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const declaration of SERVICE_OPERATIONS) {
    if (seen.has(declaration.name)) {
      problems.push(`${declaration.name}: declared more than once`);
    }
    seen.add(declaration.name);
    problems.push(...declarationProblems(declaration));
  }

  return problems;
}
