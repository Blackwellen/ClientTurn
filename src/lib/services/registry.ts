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
   * `lead.create` is ingestLead() (src/lib/ingest), the one intake path every
   * source uses: identity resolution, suppression, the permission record, the
   * touch and lead.process all come with it, so nothing is skipped. It is
   * offered to the API only. The UI has the Add Lead wizard (which calls the
   * same function with its own routing), MCP keeps its `create_lead` tool
   * (also ingestLead), and neither Copilot nor an unattended agent creates
   * leads. It never starts follow-up: a lead created over the API is recorded
   * and qualified, and a person chooses to message it.
   */
  {
    name: "lead.create",
    domain: "lead",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Record an inbound lead, deduplicated against existing ones",
    entityType: "lead",
    callers: ["API"],
  },
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
  /*
   * Adds WHATSAPP to the lead's permission scope, which is what lets a
   * template reach them outside the 24-hour window. The date, source and
   * detail are the evidence and land in the audit row. A person's statement
   * about consent: not offered to Copilot or an unattended agent.
   */
  {
    name: "lead.record_whatsapp_opt_in",
    domain: "lead",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Record that a lead opted in to WhatsApp",
    entityType: "lead",
    callers: ["UI", "MCP", "API"],
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

  /* -------------------------------------------------------- data rights
   *
   * Phase 6. Four different acts, deliberately four operations, because the
   * product must never blur them: archive (above) hides and keeps everything;
   * suppress stops contact and keeps everything; anonymise removes the
   * person's details and keeps the record; delete (erase) removes the record
   * and keeps only pseudonymous billing/audit rows and a hashed suppression.
   *
   * None of suppress / anonymise / delete / export is reachable by an
   * autonomous agent or by Copilot. Suppress is DESTRUCTIVE rather
   * than a reversible write because a workspace cannot lift it itself: only
   * ClientTurn support can, with a recorded reason. Export is a READ, but it
   * hands over everything held on a person, so it is admin-only, recorded in
   * data_rights_actions, and not offered to Copilot, whose output lands in a
   * model's context.
   */
  {
    name: "lead.suppress",
    domain: "lead",
    risk: "DESTRUCTIVE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Add a lead's addresses to the do-not-contact list",
    effect:
      "Every address held for this lead is added to the do-not-contact list on the chosen channel and follow-up stops. The lead and its history are kept. Only ClientTurn support can lift the entry. With reason LEGAL it is a restriction of processing on every channel.",
    entityType: "lead",
    // Excludes COPILOT (and AGENT, as every DESTRUCTIVE op does). Copilot holds
    // no authority over the suppression list in either direction -- the
    // standing rule tests/copilot.test.ts and v4-expansion.test.ts enforce.
    // The conversation agent has its own supervised opt-out path.
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "lead.anonymise",
    domain: "lead",
    risk: "DESTRUCTIVE",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Anonymise a lead",
    effect:
      "The lead's name, contact details, notes, message text, qualification answers and AI summaries are removed and follow-up stops. The lead's status, dates and source attribution are kept, billing and audit entries are kept, and any do-not-contact entry is kept as a one-way hash. This cannot be undone.",
    entityType: "lead",
    // Excludes COPILOT for the same reason as lead.delete: an irreversible
    // erasure that also rewrites suppression rows is a person's decision.
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "lead.delete",
    domain: "lead",
    risk: "DESTRUCTIVE",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Erase a lead",
    effect:
      "The lead is anonymised, then its record, conversations, bookings, scores, notes and permissions are removed. Billing, usage and audit records are kept with ids that no longer identify anyone, and any do-not-contact entry is kept as a one-way hash so the person is not contacted again. Optionally also removes the person from a connected CRM. This cannot be undone.",
    entityType: "lead",
    // Owner or admin in a person's hands only. Copilot excluded: erasure is a
    // legal act a person decides on, not a chat suggestion to approve.
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "lead.export",
    domain: "lead",
    risk: "READ",
    minimumRole: "admin",
    scope: "leads:read",
    summary: "Export everything held on a lead",
    entityType: "lead",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "privacy_request.list",
    domain: "privacy_request",
    risk: "READ",
    minimumRole: "admin",
    scope: "business:read",
    summary: "List data-subject requests and their deadlines",
    entityType: "privacy_request",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "privacy_request.create",
    domain: "privacy_request",
    risk: "SAFE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Record a data-subject request the workspace received",
    entityType: "privacy_request",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "privacy_request.update",
    domain: "privacy_request",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Acknowledge, progress or close a data-subject request",
    entityType: "privacy_request",
    callers: ["UI", "COPILOT", "MCP", "API"],
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
  {
    name: "agent.delete",
    domain: "agent",
    risk: "DESTRUCTIVE",
    minimumRole: "admin",
    scope: "agents:write",
    summary: "Delete an agent",
    effect:
      "The agent, its setup, queue, signals and activity timeline are removed. The leads, prospects and sourcing runs it produced are kept; they simply no longer point at an agent. Refused while one of its runs is still in progress. This cannot be undone.",
    entityType: "agent",
    // A person decides; Copilot and the conversation agent never delete.
    callers: ["UI", "MCP", "API"],
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
    callers: ["UI", "MCP", "API", "AUTOMATION"],
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
    summary: "Confirm or decline a requested time, or mark an appointment attended, cancelled or a no-show",
    entityType: "booking",
  },

  /* ----------------------------------------------------- opportunities
   *
   * Decision Q3: WON/LOST, value, stage and reason live on the opportunity,
   * and the lead's status is its projection. Moving an open opportunity is an
   * ordinary reversible write. Closing it is not: it changes the lead's
   * status, feeds every won/lost report, and is pushed to the connected CRM as
   * closed-won or closed-lost -- so it needs a person, and no autonomous agent
   * decides a deal is won or lost.
   */
  {
    name: "opportunity.list",
    domain: "opportunity",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "List opportunities, optionally for one lead or one stage",
    entityType: "opportunity",
  },
  {
    name: "opportunity.get",
    domain: "opportunity",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Read one opportunity: stage, value, outcome and reason",
    entityType: "opportunity",
  },
  {
    // 08 §B.20: a lead can hold several interests, each its own opportunity.
    name: "opportunity.add_interest",
    domain: "opportunity",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Add another service a lead is interested in, as its own opportunity",
    effect:
      "The lead gets a second (or further) interest for that service. The assistant works it toward that service's own goal alongside the others, and it is sent to your connected CRM as its own deal.",
    entityType: "opportunity",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "opportunity.set_stage",
    domain: "opportunity",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Move an open opportunity to a different stage",
    entityType: "opportunity",
    callers: ["UI", "COPILOT", "MCP", "API", "AUTOMATION"],
  },
  {
    name: "opportunity.close",
    domain: "opportunity",
    risk: "EXTERNAL",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Close an opportunity as won or lost, with the reason",
    effect:
      "The opportunity is recorded as won or lost with your reason, the lead's status changes to match, follow-up for the lead stops, and the outcome is sent to your connected CRM.",
    entityType: "opportunity",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },

  /* ---------------------------------------------------------- payments
   *
   * The direct-sale loop (0143). A payment the customer's Stripe or order
   * webhook reported that matched no lead with certainty (an email-only match,
   * or none) waits for a person. Linking it is the same apply a token match
   * gets: the opportunity closes WON with the amount, follow-up stops and the
   * thank-you goes out -- so it is EXTERNAL, confirmed in the UI, and offered
   * to the UI only: no model or client decides who paid.
   */
  {
    name: "payment.link_to_lead",
    domain: "payment",
    risk: "EXTERNAL",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Link a received payment to the lead who paid",
    effect:
      "The payment is recorded against this lead, their open opportunity is closed as won with the amount, their follow-up stops, and the assistant sends them a thank-you with your next steps.",
    entityType: "checkout_payment",
    callers: ["UI"],
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
  {
    name: "campaign.add_lead",
    domain: "campaign",
    // Adding is not sending: the row waits until a person launches or resumes
    // the campaign (both BULK_EXTERNAL and confirmed), and the send loop
    // re-checks suppression and consent before each message.
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "campaigns:write",
    summary: "Add a lead to a draft, scheduled or paused reactivation campaign",
    entityType: "campaign",
    callers: ["UI", "MCP", "AUTOMATION"],
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
  {
    // The customer's own list as prospects: LinkedIn's export of their own
    // 1st-degree connections, or any CSV they own. Nothing here touches
    // LinkedIn. Phone columns are discarded, never stored. UI and API only: an
    // import is a person handing over their own file, not something an agent
    // or a chat assistant does on its own initiative.
    name: "prospect.import_linkedin_list",
    domain: "prospect",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "prospects:write",
    summary: "Import your own list (LinkedIn Connections export or any CSV you own) as prospects",
    entityType: null,
    callers: ["UI", "API"],
  },
  {
    // "Add website" on a prospect whose company has none. Admin, because it
    // runs the email waterfall, which spends the enrichment allowance.
    name: "prospect.set_company_website",
    domain: "prospect",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "prospects:write",
    summary: "Add a company website to a prospect, then look for a work email and buying signals",
    entityType: "prospect",
    callers: ["UI", "MCP", "API"],
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

  /* ------------------------------------------------ revenue engine (Phase 5)
   *
   * Reads of what the engine decided (score, contactability, funnel, AI
   * usage), a draft that is never sent, and the duplicate queue.
   *
   * `message.draft` is the one `message.*` operation that is not EXTERNAL: it
   * writes a DRAFT message row, which the send worker never claims, so nothing
   * leaves the building. Sending that draft is still `message.send`, with its
   * own confirmation. The agent is excluded -- it has its own supervised draft
   * path in lib/agent.
   *
   * `merge_candidate.resolve` is DESTRUCTIVE from the workspace's side: a
   * merge moves one person's conversations onto another record, and only
   * ClientTurn support can undo it (it is recorded with a before-snapshot in
   * merge_events so they can).
   */
  {
    name: "lead.score_explain",
    domain: "lead",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Explain a lead's current score: grade, dimensions, why and what is missing",
    entityType: "lead",
  },
  {
    name: "lead.contactability",
    domain: "lead",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Whether a lead may be contacted on each channel, and why",
    entityType: "lead",
  },
  {
    name: "message.draft",
    domain: "message",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Write a draft message to a lead for a person to review; it is not sent",
    entityType: "message",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "funnel.get",
    domain: "funnel",
    risk: "READ",
    minimumRole: "viewer",
    scope: "analytics:read",
    summary: "The source-to-won funnel for a period, with step rates and sample sizes",
    entityType: null,
  },
  {
    name: "ai_usage.get",
    domain: "ai_usage",
    risk: "READ",
    minimumRole: "member",
    scope: "analytics:read",
    summary: "AI spend this month against the workspace's ceiling, by task",
    entityType: null,
  },
  {
    name: "merge_candidate.list",
    domain: "merge_candidate",
    risk: "READ",
    minimumRole: "member",
    scope: "leads:read",
    summary: "List possible duplicate leads waiting for a decision",
    entityType: "merge_candidate",
  },
  /* ----------------------------------------------- lead page (Phase 5b)
   *
   * The actions the lead detail page offers that had no operation of their
   * own. `lead.rescore` only queues the deterministic scorer, so it is a safe
   * write. Taking a conversation over is the safe direction and is open to
   * every caller. Resuming follow-up restarts automated messages to a person,
   * so it is a person's decision: neither Copilot nor an agent can undo a
   * takeover.
   */
  {
    name: "lead.rescore",
    domain: "lead",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Re-score a lead now from what is currently known about it",
    entityType: "lead",
    callers: ["UI", "COPILOT", "MCP", "API", "AUTOMATION"],
  },
  {
    name: "lead.takeover",
    domain: "lead",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Take a lead's conversation over from automated follow-up",
    entityType: "lead",
  },
  {
    name: "lead.resume_follow_up",
    domain: "lead",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Hand a lead back to automated follow-up after a takeover",
    entityType: "lead",
    callers: ["UI", "MCP", "API"],
  },

  /* ------------------------- qualification intelligence (§B.19, brief §21)
   *
   * What the qualification and intent engine concluded about a lead, and the
   * three ways a person corrects it. The reads answer "is this lead
   * qualified", "what do we still need" and "why are we asking this"; the
   * engine's deterministic verdict stays the answer to the first, with intent,
   * completeness and the next action as context (CLAUDE.md resolved conflict 1).
   *
   * An unattended agent is excluded from every write here: it must not
   * re-label the evidence it acts on. Copilot may re-run an assessment and
   * confirm, reject or set a fact (a member's ordinary correction, audited with
   * before and after), but overriding intent or the next action is a person's
   * call from the app or a supervised MCP client.
   *
   * The policy write is admin-only. From any caller other than the app it may
   * only make the policy stricter (`policyChangeOnlyNarrows`, CD-18): forbid a
   * question, require a dimension, add an escalation condition or a
   * disqualifier, or lower the autonomy cap. Widening, thresholds and the engine
   * mode are changed in Settings.
   */
  {
    name: "qualification.status",
    domain: "qualification",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Say whether a lead is qualified, how much of the picture is known and what happens next",
    entityType: "lead",
  },
  {
    name: "qualification.unknowns",
    domain: "qualification",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "List what is still needed to qualify a lead: required, conflicting and unverified details",
    entityType: "lead",
  },
  {
    name: "qualification.explain",
    domain: "qualification",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Explain why the next question or action was chosen for a lead",
    entityType: "lead",
  },
  {
    name: "qualification.intent",
    domain: "qualification",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Explain a lead's buying intent: state, score, evidence, contradictions and when it decays",
    entityType: "lead",
  },
  {
    name: "qualification.requalify",
    domain: "qualification",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Re-run a lead's qualification and intent assessment now",
    entityType: "lead",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "qualification.set_fact",
    domain: "qualification",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Confirm, reject or set what is known about a lead for one qualification detail",
    entityType: "lead",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "qualification.override_intent",
    domain: "qualification",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Override a lead's buying-intent state, with a reason and an end date",
    entityType: "lead",
    callers: ["UI", "MCP"],
  },
  {
    name: "qualification.override_nba",
    domain: "qualification",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Override a lead's next best action, with a reason",
    entityType: "lead",
    callers: ["UI", "MCP"],
  },
  {
    name: "qualification.policy_get",
    domain: "qualification",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "Read the qualification policy for the workspace and each offer",
    entityType: "business",
  },
  {
    name: "qualification.policy_update",
    domain: "qualification",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Change the qualification policy; outside Settings it can only be made stricter",
    entityType: "business",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },

  /* ------------------------------------------- AI & selling settings (§74)
   *
   * How the workspace sells and how much AI it may spend doing it. None of
   * these is reachable by an unattended agent: an agent that could edit its
   * own budget or risk tolerance could widen the limits it runs under (the
   * same reason as `agent.configure`). Budgets are further closed to Copilot,
   * whose own spend they cap.
   */
  {
    name: "sales_settings.get",
    domain: "sales_settings",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "Read how this workspace sells: classification, motions, methods and brand voice",
    entityType: "business",
  },
  {
    name: "sales_settings.update",
    domain: "sales_settings",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Change how this workspace sells: classification, motions, methods and brand voice",
    entityType: "business",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "sales_objections.list",
    domain: "sales_objections",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "Read the objections this workspace hears most, its own answers and its reassurance facts",
    entityType: "business",
  },
  {
    name: "sales_objections.save",
    domain: "sales_objections",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Add or edit one objection the workspace hears, with its own approved answer",
    entityType: "business",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "sales_objections.remove",
    domain: "sales_objections",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Remove one of the workspace's own objection answers (the library playbook applies again)",
    entityType: "business",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "sales_objections.save_reassurance",
    domain: "sales_objections",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Set the reassurance facts the assistant may use: SLAs, guarantees, case studies, owned testimonials",
    entityType: "business",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "sales_objections.preview",
    domain: "sales_objections",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "Try an objection offline: which playbook fires, the plan and an example reply (no AI spend)",
    entityType: "business",
  },
  {
    name: "ai_budget.update",
    domain: "ai_budget",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Set this workspace's AI spending limits",
    entityType: "business",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "legitimate_interest.save",
    domain: "legitimate_interest",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Record or update a legitimate interests assessment",
    entityType: "legitimate_interest_assessment",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "merge_candidate.resolve",
    domain: "merge_candidate",
    risk: "DESTRUCTIVE",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Merge a possible duplicate pair, or dismiss it",
    effect:
      "On merge, the other lead's touches, conversations and messages move to the kept lead, blank fields are filled, and the other lead is archived. Only ClientTurn support can undo it. Dismiss keeps both.",
    entityType: "merge_candidate",
    callers: ["UI", "COPILOT", "MCP"],
  },
  /* ------------------------------ channels and booking (§29, §43, §45, §57)
   *
   * Configuration writes behind the Settings surfaces. None of them sends
   * anything: switching a CRM pull on records contacts (RECORD_ONLY, never
   * messaged), a template mapping is used only when the WhatsApp window has
   * closed and the policy engine allows the send, and a meeting type changes
   * how a booking is shaped and routed. The agent is excluded from each --
   * these are a person's decisions about how the workspace behaves.
   */
  {
    name: "crm_pull.list",
    domain: "crm_pull",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "Which connected CRMs pull new contacts in, and how the last pull went",
    entityType: "integration",
  },
  {
    name: "crm_pull.set",
    domain: "crm_pull",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Switch importing new contacts from a connected CRM on or off",
    entityType: "integration",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "whatsapp_template.list",
    domain: "whatsapp_template",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "The approved WhatsApp templates and which follow-up steps use them",
    entityType: "whatsapp_template",
  },
  {
    name: "whatsapp_template.sync",
    domain: "whatsapp_template",
    risk: "SAFE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Refresh the WhatsApp template list from the provider",
    entityType: "whatsapp_template",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "whatsapp_template.map_step",
    domain: "whatsapp_template",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Choose the approved template a WhatsApp follow-up step sends after the 24-hour window",
    entityType: "whatsapp_template",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "meeting_type.list",
    domain: "meeting_type",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "The kinds of meeting leads can book, with duration and who takes them",
    entityType: "meeting_type",
  },
  {
    name: "meeting_type.save",
    domain: "meeting_type",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Create or change a meeting type: duration, buffer, calendar and rep routing",
    entityType: "meeting_type",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "meeting_type.archive",
    domain: "meeting_type",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Stop offering a meeting type; existing bookings keep it",
    entityType: "meeting_type",
    callers: ["UI", "MCP", "API"],
  },

  /* ------------------------------------------------------ team (§8.15)
   *
   * Who can reach the workspace, and with what role. The guardrails are the
   * pure rules in src/lib/team/rules.ts: there is always an owner, nobody
   * edits their own role, only the owner manages admins. An unattended agent
   * never touches membership, and Copilot may read the team but not change it
   * -- granting access is a person's decision, made on purpose. Inviting is
   * EXTERNAL because it emails an outside address that then gains access, so
   * an MCP client parks it for a person rather than doing it on its own.
   */
  {
    name: "member.list",
    domain: "member",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "List the workspace's team members, their roles and any open invitations",
    entityType: "business_member",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "member.invite",
    domain: "member",
    risk: "EXTERNAL",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Invite someone to the workspace with a role",
    effect:
      "An invitation is emailed to that address. Once they accept, they can sign in to this workspace with the role you chose, and they take up a seat on your plan.",
    entityType: "business_member",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "member.resend_invite",
    domain: "member",
    risk: "EXTERNAL",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Send an open invitation again and restart its expiry",
    effect: "The invitation email is sent again and stays valid for another 14 days.",
    entityType: "business_member",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "member.set_role",
    domain: "member",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Change a team member's role",
    entityType: "business_member",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "member.remove",
    domain: "member",
    risk: "DESTRUCTIVE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Remove a team member, or revoke an invitation",
    effect:
      "They lose access to this workspace immediately, including any API keys and connected assistants acting as them. Their open leads, conversations and handovers go to the person you chose, or become unassigned. Their history stays on every record.",
    entityType: "business_member",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "member.transfer_ownership",
    domain: "member",
    risk: "DESTRUCTIVE",
    minimumRole: "owner",
    scope: "business:write",
    summary: "Hand ownership of the workspace to another member",
    effect:
      "They become the owner, with control of billing and the team. You become an admin, and only the new owner can give ownership back.",
    entityType: "business_member",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "scoring_weights.update",
    domain: "scoring_weights",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Set or reset how much each dimension counts in this workspace's lead score",
    entityType: "business",
    // A person's decision about how leads are ranked: not Copilot's.
    callers: ["UI", "MCP", "API"],
  },
  // Governed experiments (§§62-63, 0131). Workspace-level only; a result is
  // read by a person, and nothing rewrites copy automatically.
  {
    name: "experiment.list",
    domain: "experiment",
    risk: "READ",
    minimumRole: "member",
    scope: "campaigns:read",
    summary: "List this workspace's follow-up and reactivation experiments",
    entityType: "experiment",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "experiment.results",
    domain: "experiment",
    risk: "READ",
    minimumRole: "member",
    scope: "campaigns:read",
    summary: "Show an experiment's results, with confidence intervals",
    entityType: "experiment",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "experiment.create",
    domain: "experiment",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "campaigns:write",
    summary: "Create a draft A/B experiment for a follow-up sequence or reactivation campaign",
    entityType: "experiment",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "experiment.start",
    domain: "experiment",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "campaigns:write",
    summary: "Start a draft experiment",
    entityType: "experiment",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "experiment.stop",
    domain: "experiment",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "campaigns:write",
    summary: "Stop a running experiment",
    entityType: "experiment",
    callers: ["UI", "MCP", "API"],
  },
  /* ------------------------------------------------------------- billing
   *
   * "Upgrade now" during a card-first trial: ends the Stripe trial today and
   * charges the card already on file (billing/end-trial.ts). It spends the
   * customer's money, so it is FINANCIAL (a person confirms the amount in the
   * modal), owner-only (the one role that controls billing), and offered to
   * the UI alone: no API key, MCP client, Copilot or agent can start a charge.
   * The Stripe call is idempotent per workspace and confirmation nonce.
   */
  {
    name: "billing.end_trial_now",
    domain: "billing",
    risk: "FINANCIAL",
    minimumRole: "owner",
    scope: "business:write",
    summary: "End the free trial now and start the paid plan",
    effect:
      "Your trial ends today and the card on file is charged for the first period of the plan straight away. The plan's full limits switch on immediately.",
    entityType: "subscription",
    callers: ["UI"],
  },

  /* --------------------------------------------------- quote to cash (P2)
   *
   * One implementation per act for the UI, API, MCP and (later) the agent:
   * the logic is lib/quotes/service-core.ts and lib/invoicing/service-core.ts,
   * over stores that only ever change a quote's state through the 0153 RPCs.
   *
   * Roles: the catalogue and the quote settings are prices and legal terms,
   * so owner/admin. Members build, send, revise and withdraw quotes; only an
   * owner or admin approves (and only a person: approve/reject exclude every
   * non-human caller, and the core refuses a non-HUMAN actor as well). Money
   * records (payments, voids, credit notes) are admin.
   *
   * Plan gates are inside each handler through `can()` (billing/capabilities.ts),
   * never here and never by plan name.
   *
   * AGENT: the agent may later use exactly the operations in
   * AGENT_QUOTE_OPERATIONS below (calculate, create a draft, request approval,
   * and send where commercial authority permits and a person confirms). The
   * tools are wired by another phase.
   */
  {
    name: "catalogue.list",
    domain: "catalogue",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "List the priced catalogue: items, price tiers and bundles",
    entityType: "catalogue_item",
  },
  {
    name: "catalogue.upsert_item",
    domain: "catalogue",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Add or change a priced catalogue item",
    entityType: "catalogue_item",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "catalogue.upsert_bundle",
    domain: "catalogue",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Add or change a catalogue bundle",
    entityType: "catalogue_bundle",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "catalogue.archive",
    domain: "catalogue",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Stop selling a catalogue item or bundle (quotes already sent keep it)",
    entityType: "catalogue_item",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "quote_settings.get",
    domain: "quote_settings",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "Read the workspace's quote and invoice settings",
    entityType: "quote_settings",
  },
  {
    name: "quote_settings.update",
    domain: "quote_settings",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Change quote and invoice settings: VAT, terms, numbering, deposits and approvals",
    entityType: "quote_settings",
    callers: ["UI"],
  },
  {
    name: "quote.calculate",
    domain: "quote",
    risk: "READ",
    minimumRole: "member",
    scope: "leads:read",
    summary: "Price quote lines from the catalogue, without saving anything",
    entityType: "quote",
  },
  {
    name: "quote.create",
    domain: "quote",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Create a draft quote for an opportunity from the catalogue",
    entityType: "quote",
    callers: ["UI", "MCP", "API", "AGENT", "AUTOMATION"],
  },
  {
    name: "quote.update_draft",
    domain: "quote",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Change a draft quote's lines, discount, payment terms or note",
    entityType: "quote",
    callers: ["UI", "MCP", "API"],
  },
  {
    // The assistant's discount (brief §74): a whole-quote percentage, decided
    // by the discount policy in the quote core (never by the model). A sent
    // quote gets a new revision; one needing approval is left for a person.
    name: "quote.apply_discount",
    domain: "quote",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Apply the assistant's discount to a quote, within the workspace's discount policy",
    entityType: "quote",
    callers: ["AGENT"],
  },
  {
    name: "quote.submit_for_approval",
    domain: "quote",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Ask an owner or admin to approve a quote",
    entityType: "quote",
    callers: ["UI", "MCP", "API", "AGENT", "AUTOMATION"],
  },
  {
    name: "quote.approve",
    domain: "quote",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Approve a quote so it can be sent",
    entityType: "quote",
    // A person, in the app. Never an agent, Copilot, MCP client or API key.
    callers: ["UI"],
  },
  {
    name: "quote.reject",
    domain: "quote",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Send a quote back to draft instead of approving it",
    entityType: "quote",
    callers: ["UI"],
  },
  {
    name: "quote.send",
    domain: "quote",
    risk: "EXTERNAL",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Send a quote to the customer",
    effect:
      "The quote is frozen as it stands, a private link is created, and it is emailed to the customer (or the link is given to you to share). After this it can only be changed by issuing a new revision.",
    entityType: "quote",
    callers: ["UI", "MCP", "API", "AGENT", "AUTOMATION"],
  },
  {
    name: "quote.revise",
    domain: "quote",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Start a new revision of a quote; the customer's current link stops working",
    entityType: "quote",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "quote.withdraw",
    domain: "quote",
    risk: "DESTRUCTIVE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Withdraw a quote",
    effect: "The quote is withdrawn and the customer's link stops working. A withdrawn quote cannot be reopened; you would create a new one.",
    entityType: "quote",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "quote.get",
    domain: "quote",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Read one quote: its lines, totals, status history and revisions",
    entityType: "quote",
  },
  {
    name: "quote.list",
    domain: "quote",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "List quotes, optionally for one lead or opportunity",
    entityType: "quote",
  },
  {
    name: "invoice.create_from_quote",
    domain: "invoice",
    risk: "EXTERNAL",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Create the invoices for an accepted quote's payment schedule",
    effect:
      "An invoice is drafted for each payment in the quote's schedule. With automatic issue on, each is numbered and emailed to the customer on its date, starting with any payment due on acceptance.",
    entityType: "invoice",
    callers: ["UI", "MCP", "API", "AUTOMATION"],
  },
  {
    name: "invoice.issue",
    domain: "invoice",
    risk: "EXTERNAL",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Issue an invoice: number it and email it to the customer",
    effect:
      "The invoice gets its number and dates and can no longer be edited (only voided or credited). It is emailed to the customer, and payment reminders are scheduled.",
    entityType: "invoice",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "invoice.record_payment",
    domain: "invoice",
    risk: "DESTRUCTIVE",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Record a payment received against an invoice",
    effect: "The payment is added to the invoice permanently. A mistaken payment is corrected with a credit note, not deleted.",
    entityType: "invoice",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "invoice.void",
    domain: "invoice",
    risk: "DESTRUCTIVE",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Void an unpaid invoice",
    effect: "The invoice is cancelled and stops being chased. Its number is kept in the sequence. This cannot be undone.",
    entityType: "invoice",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "invoice.credit_note",
    domain: "invoice",
    risk: "FINANCIAL",
    minimumRole: "admin",
    scope: "leads:write",
    summary: "Issue a credit note against a paid invoice",
    effect: "A numbered credit note is issued for the amount, reducing what the customer has been charged. You refund the money yourself in your payment provider.",
    entityType: "invoice",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "invoice.list",
    domain: "invoice",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "List invoices, optionally for one quote or opportunity",
    entityType: "invoice",
  },
  /* --------------------------------------------------------------- voice
   *
   * The AI voice sales agent (phase P2, docs/VOICE.md). Every operation that
   * can lead to a call runs the entitlement gate (voice/entitlement.ts) and
   * canCallLead server-side, so a trial, demo or free workspace can never
   * dial whoever calls it. Identity, the number and billing are owner/admin
   * only; releasing the number is owner only and destructive. A manual call
   * places a real call and spends minutes, so it is EXTERNAL (a person
   * confirms it). AGENT is deliberately not a caller yet.
   */
  {
    name: "voice.settings_get",
    domain: "voice",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "Read this workspace's voice settings, number and minutes",
    entityType: "voice_settings",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "voice.settings_update",
    domain: "voice",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Change how the AI voice agent calls for this workspace",
    entityType: "voice_settings",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "voice.number_request",
    domain: "voice",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Start setting up this workspace's dedicated calling number",
    entityType: "business_number",
    callers: ["UI"],
  },
  {
    name: "voice.number_status",
    domain: "voice",
    risk: "READ",
    minimumRole: "member",
    scope: "business:read",
    summary: "Show where the dedicated calling number is in its set-up",
    entityType: "business_number",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "voice.number_release",
    domain: "voice",
    risk: "DESTRUCTIVE",
    minimumRole: "owner",
    scope: "business:write",
    summary: "Release this workspace's dedicated calling number",
    effect:
      "Your dedicated number is released and can't be got back. AI calls stop, and texts go from the shared ClientTurn sender. The number is held in quarantine for 90 days so nobody else receives your leads' replies.",
    entityType: "business_number",
    callers: ["UI"],
  },
  {
    name: "voice.request_call",
    domain: "voice",
    risk: "EXTERNAL",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Have the AI voice agent call a lead",
    effect:
      "The AI assistant will phone this lead from your dedicated number, within their calling hours, and uses voice minutes. It says it is an AI calling from your business at the start of the call.",
    entityType: "voice_call",
    callers: ["UI", "MCP", "API", "AUTOMATION"],
  },
  {
    name: "voice.cancel_call",
    domain: "voice",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Cancel an AI call that hasn't started yet",
    entityType: "voice_call",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "voice.calls_list",
    domain: "voice",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "List AI calls, for the workspace or one lead",
    entityType: "voice_call",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "voice.call_get",
    domain: "voice",
    risk: "READ",
    minimumRole: "viewer",
    scope: "leads:read",
    summary: "Read one AI call: outcome, summary and transcript",
    entityType: "voice_call",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  // The platform kill switch for one workspace. Only the admin shell calls
  // it, as SYSTEM, after requirePlatformAdmin and step-up (resolved conflict 4).
  {
    name: "voice.admin_disable_workspace",
    domain: "voice",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Pause or resume all AI calling for a workspace (ClientTurn staff)",
    entityType: "voice_settings",
    callers: ["SYSTEM"],
  },
  /* ------------------------------------------------ P5 insight and ops
   *
   * Appended by the P5 insight/ops change (brief §43, §58). Experiment
   * promotion (0158): advice is a read; promote and rollback are confirmed by
   * a person in the UI (`confirm: true` in the arguments, enforced by the
   * handler), and SYSTEM is the only caller that may promote automatically,
   * which learning/promotion.ts refuses for opener, disclosure or pricing.
   * Not offered to Copilot or an agent: rolling copy out to every lead is a
   * person's decision.
   */
  {
    name: "experiment.promotion_advice",
    domain: "experiment",
    risk: "READ",
    minimumRole: "member",
    scope: "campaigns:read",
    summary: "Show whether an experiment's winning variant can be promoted, and its promotion history",
    entityType: "experiment",
    callers: ["UI", "COPILOT", "MCP", "API"],
  },
  {
    name: "experiment.promote",
    domain: "experiment",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "campaigns:write",
    summary: "Promote an experiment's winning variant to every lead",
    entityType: "experiment",
    callers: ["UI", "MCP", "API", "SYSTEM"],
  },
  {
    name: "experiment.rollback",
    domain: "experiment",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "campaigns:write",
    summary: "Roll a promoted experiment back to the control copy",
    entityType: "experiment",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "experiment.set_auto_promote",
    domain: "experiment",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "campaigns:write",
    summary: "Allow or stop automatic promotion of an experiment's winner",
    entityType: "experiment",
    callers: ["UI", "MCP", "API"],
  },
  // Platform-operator voice controls (0158). Only the admin shell calls
  // them, as SYSTEM, after requirePlatformAdmin and step-up (resolved
  // conflict 4); each also requires `confirm: true` in its arguments.
  {
    name: "admin_voice.pause_outbound",
    domain: "admin_voice",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Pause or resume outbound AI calls for a workspace (ClientTurn staff)",
    entityType: "voice_settings",
    callers: ["SYSTEM"],
  },
  {
    name: "admin_voice.suspend_number",
    domain: "admin_voice",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Suspend or reinstate a workspace's voice number (ClientTurn staff)",
    entityType: "business_number",
    callers: ["SYSTEM"],
  },
  {
    name: "admin_voice.set_spend_limit",
    domain: "admin_voice",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Set a workspace's monthly voice provider spend ceiling (ClientTurn staff)",
    entityType: "voice_settings",
    callers: ["SYSTEM"],
  },
  // Voice phase P3: the voice agent's tools (docs/VOICE.md §16). Retell's
  // hosted LLM calls /api/voice/tools/<tool> during a call; each runs here as
  // caller AGENT, reusing the text agent's own tool functions and gates.
  // Idempotent per (call, tool call id) in voice_tool_calls (0162).
  {
    name: "voice_agent.record_fact",
    domain: "voice_agent",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Record what a lead said on an AI call (a signal; an AI-inferred fact at most)",
    entityType: "voice_call",
    callers: ["AGENT"],
  },
  {
    name: "voice_agent.check_availability",
    domain: "voice_agent",
    risk: "READ",
    minimumRole: "member",
    scope: "leads:read",
    summary: "Read bookable times from the connected calendar during an AI call",
    entityType: "voice_call",
    callers: ["AGENT"],
  },
  {
    name: "voice_agent.book_meeting",
    domain: "voice_agent",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Book a meeting at a time the calendar offered during this AI call",
    entityType: "voice_call",
    callers: ["AGENT"],
  },
  {
    name: "voice_agent.calculate_quote",
    domain: "voice_agent",
    risk: "READ",
    minimumRole: "member",
    scope: "leads:read",
    summary: "Price catalogue items a lead asked for on an AI call, without saving anything",
    entityType: "voice_call",
    callers: ["AGENT"],
  },
  {
    name: "voice_agent.send_quote",
    domain: "voice_agent",
    risk: "EXTERNAL",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Draft and send the quote priced on an AI call",
    effect:
      "The quote priced on the call is created and, where the workspace lets the assistant send quotes, frozen and sent to the lead. Otherwise it waits for a person's approval.",
    entityType: "voice_call",
    callers: ["AGENT"],
  },
  {
    name: "voice_agent.send_checkout_link",
    domain: "voice_agent",
    risk: "EXTERNAL",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Text or email an approved checkout link agreed on an AI call",
    effect: "One approved checkout link, with its approved price wording, is sent to the lead by text or email.",
    entityType: "voice_call",
    callers: ["AGENT"],
  },
  {
    name: "voice_agent.send_booking_link",
    domain: "voice_agent",
    risk: "EXTERNAL",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Text or email the business's booking link when a lead on an AI call asks for details instead",
    effect: "The workspace's own booking link is sent to the lead by text or email, through the ordinary send path.",
    entityType: "voice_call",
    callers: ["AGENT"],
  },
  {
    name: "voice_agent.transfer_to_human",
    domain: "voice_agent",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Hand an AI call to a person, where the workspace's transfer setting allows it",
    entityType: "voice_call",
    callers: ["AGENT"],
  },
  {
    name: "voice_agent.schedule_callback",
    domain: "voice_agent",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Record a call-back a lead asked for on an AI call",
    entityType: "voice_call",
    callers: ["AGENT"],
  },
  {
    name: "voice_agent.opt_out",
    domain: "voice_agent",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Stop calls (or all contact) to a lead who asked on an AI call",
    entityType: "voice_call",
    callers: ["AGENT"],
  },
  {
    name: "voice_agent.log_objection",
    domain: "voice_agent",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Record an objection a lead raised on an AI call",
    entityType: "voice_call",
    callers: ["AGENT"],
  },
  {
    name: "voice_agent.end_call_summary",
    domain: "voice_agent",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Record the assistant's own factual summary of an AI call",
    entityType: "voice_call",
    callers: ["AGENT"],
  },
  /* ------------------------------------------------ automation rules (§45)
   *
   * Event-triggered rules: "when this happens, do that". The rule's actions
   * are not operations of their own: each one runs an existing operation
   * above through runOperation with caller AUTOMATION, so the permission,
   * capability, eligibility and audit rules are the ones every other caller
   * meets (lib/automation/rule-runner.ts). Managing rules is admin work from
   * the app only.
   */
  {
    name: "automation_rule.list",
    domain: "automation_rule",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "List the workspace's automation rules and their recent runs",
    entityType: "automation_rule",
    callers: ["UI"],
  },
  {
    name: "automation_rule.save",
    domain: "automation_rule",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Create or change an automation rule",
    entityType: "automation_rule",
    callers: ["UI"],
  },
  {
    name: "automation_rule.set_enabled",
    domain: "automation_rule",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Turn an automation rule on or off",
    entityType: "automation_rule",
    callers: ["UI"],
  },
  {
    name: "automation_rule.delete",
    domain: "automation_rule",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Delete an automation rule (its run history is kept)",
    entityType: "automation_rule",
    callers: ["UI"],
  },
  {
    // A person-set label on a lead, beside the derived tags the scoring
    // engine manages (lead_tags, 0121). The engine only clears the tags it
    // manages, so a custom tag stays until someone removes it.
    name: "lead.add_tag",
    domain: "lead",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "leads:write",
    summary: "Add a tag to a lead",
    entityType: "lead",
    callers: ["UI", "MCP", "API", "AUTOMATION"],
  },

  {
    // An in-app notification to the workspace (and email per each member's
    // notification settings). The one action a workspace-level automation
    // trigger (a budget threshold, an exhausted allowance) can take.
    name: "team.notify",
    domain: "team",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "business:write",
    summary: "Notify the team",
    entityType: "notification",
    callers: ["AUTOMATION"],
  },

  /* ------------------------------------------- pipeline semantics (§46)
   *
   * How ClientTurn's system events (Quoted, Booking pending, Payment
   * pending, Won...) land on the workspace's own pipeline stages. The map is
   * data; the moves it causes are still forward-only and motion-aware
   * (lib/opportunities/pipeline-semantics.ts).
   */
  {
    name: "pipeline.get_mapping",
    domain: "pipeline",
    risk: "READ",
    minimumRole: "viewer",
    scope: "business:read",
    summary: "Read how system events map onto the pipeline stages",
    entityType: "pipeline_stage_map",
    callers: ["UI", "MCP", "API"],
  },
  {
    name: "pipeline.set_mapping",
    domain: "pipeline",
    risk: "REVERSIBLE_WRITE",
    minimumRole: "admin",
    scope: "business:write",
    summary: "Change how system events map onto the pipeline stages",
    entityType: "pipeline_stage_map",
    callers: ["UI"],
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

/**
 * The quote operations the agent's tools use (agent/tools.ts, brief §7, §74):
 * price, draft, ask for approval, send, and apply its discount. `quote.send`
 * is EXTERNAL: the agent may call it only when the workspace turned on "Send
 * quotes" for the assistant, which is the owner's standing confirmation
 * (recorded as `confirmation_source: standing_permission`); otherwise a
 * person sends it. Asserted against each declaration's `callers` in
 * tests/quote-service.test.ts and tests/agent-quotes.test.ts.
 */
export const AGENT_QUOTE_OPERATIONS = [
  "quote.calculate",
  "quote.create",
  "quote.submit_for_approval",
  "quote.send",
  "quote.apply_discount",
] as const satisfies readonly ServiceOperationName[];

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
