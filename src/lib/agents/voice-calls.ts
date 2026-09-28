/**
 * AI phone calls placed by an agent ("Phone leads with AI", migration 0176).
 *
 * The governing rule is the one the booking and re-engagement ticks follow:
 * **an agent orchestrates an engine that already exists, it never opens a
 * second path.** An agent that wants a lead phoned asks `voice.request_call`
 * (caller AGENT) exactly as the "Call with AI" button does, so every call goes
 * through `requestCall -> decideDial` (entitlement, minutes, consent basis,
 * lead-supplied number, TPS/CTPS, calling hours, attempt caps and gap,
 * opt-outs, suppression, one live call, maintenance hold) and is re-checked
 * by the dial job immediately before dialling.
 *
 * What this module adds is only what is specific to an agent:
 *
 *   * which agent types may phone at all, and on which route;
 *   * the refusal the service handler applies to an AGENT caller (agent
 *     running, option on, the workspace's "Phone leads" permission on, the
 *     per-agent daily cap), shared with the tick so both say the same thing;
 *   * choosing candidates: never a lead with a call already queued or live,
 *     and only the FIRST call on a route (retries belong to the voice retry
 *     policy, which respects the configured attempts);
 *   * the tick itself, over injected dependencies so it is testable with fakes.
 *
 * Pure: no `server-only`, no Supabase. Client components import the labels.
 */

import type { GoalKey } from "../qualification-intelligence/types.ts";

export const AGENT_VOICE_DEFAULT_DAILY_CAP = 20;
export const AGENT_VOICE_MAX_DAILY_CAP = 100;

export type AgentVoiceRoute = "QUALIFICATION" | "BOOKING_CLOSE" | "DIRECT_CLOSE";
export type AgentVoiceWork = "QUALIFICATION" | "CLOSING";

/** Where Settings -> Voice lives; the link every disabled state offers admins. */
export const VOICE_SETTINGS_HREF = "/app/settings?section=voice&panel=overview";
/** Where "What the AI may do" lives. */
export const AI_PERMISSIONS_HREF = "/app/settings?section=ai-selling";

/* ------------------------------------------------------------ who may call */

export type AgentCallingScope =
  | { applies: true; work: AgentVoiceWork[]; routes: AgentVoiceRoute[] }
  | { applies: false; reason: string };

/**
 * Which agent types phone leads, and on which routes.
 *
 *   * Closing (stored BOOKING): stalled qualified leads, on the route the
 *     lead's goal needs (a meeting -> BOOKING_CLOSE, a sale or sign-up ->
 *     DIRECT_CLOSE).
 *   * Combined: that, plus new leads on QUALIFICATION.
 *   * Sourcing never collects a phone number, and re-engagement only drafts
 *     campaigns for a person to launch, so neither phones anyone.
 */
export function agentCallingScope(type: string): AgentCallingScope {
  switch (type) {
    case "BOOKING":
      return { applies: true, work: ["CLOSING"], routes: ["BOOKING_CLOSE", "DIRECT_CLOSE"] };
    case "COMBINED":
      return { applies: true, work: ["CLOSING", "QUALIFICATION"], routes: ["QUALIFICATION", "BOOKING_CLOSE", "DIRECT_CLOSE"] };
    case "SOURCING":
      return { applies: false, reason: "A sourcing agent never collects phone numbers, so there is nobody it may phone." };
    case "REENGAGEMENT":
      return { applies: false, reason: "A re-engagement agent drafts campaigns for you to launch. It doesn't phone leads." };
    default:
      return { applies: false, reason: "This agent can't phone leads." };
  }
}

/** The route a closing call runs on, from the goal the lead has not reached. */
export function closingRouteForGoal(goal: GoalKey | null | undefined): "BOOKING_CLOSE" | "DIRECT_CLOSE" {
  return goal === "C_DIRECT_SALE" || goal === "D_SIGNUP_TRIAL" ? "DIRECT_CLOSE" : "BOOKING_CLOSE";
}

/* --------------------------------------------------- the option in the UI */

/** What the wizard and the agent's settings need to render the option. */
export type AgentVoiceAvailability = {
  /** The 0176 columns exist; before that the option cannot be saved. */
  schemaReady: boolean;
  /** `assertVoiceAllowed` passes and calling is connected on this environment. */
  voiceUsable: boolean;
  /** Why voice is not usable (the same wording the lead page shows). */
  voiceReason: string | null;
  /** A trial, demo, free or unpaid workspace: link to plans rather than Voice. */
  voiceLocked: boolean;
  /** The workspace's "What the AI may do -> Phone leads" is on. */
  aiMayCall: boolean;
  /** The viewer may change the option (owner or admin). */
  canManage: boolean;
};

export type AgentVoiceOption = {
  /** The checkbox may be switched ON (it may always be switched off). */
  selectable: boolean;
  /** Shown beside a disabled checkbox. */
  reason: string | null;
  /** Where the reason's fix lives, for admins. */
  fixHref: string | null;
  fixLabel: string | null;
  /** On, but the "Phone leads" permission is off: the agent will not call yet. */
  needsCallPermission: boolean;
};

export function agentVoiceOption(type: string, a: AgentVoiceAvailability): AgentVoiceOption {
  const scope = agentCallingScope(type);
  const off = (reason: string, fixHref: string | null = null, fixLabel: string | null = null): AgentVoiceOption => ({
    selectable: false,
    reason,
    fixHref: a.canManage ? fixHref : null,
    fixLabel: a.canManage ? fixLabel : null,
    needsCallPermission: false,
  });
  if (!scope.applies) return off(scope.reason);
  if (!a.canManage) return off("Only an owner or admin can change this.");
  if (!a.schemaReady) return off("AI calling from agents needs database update 0176 before it can be switched on.");
  if (!a.voiceUsable) {
    return a.voiceLocked
      ? off(a.voiceReason ?? "Voice is a paid feature and isn't on this plan.", "/app/settings?section=billing", "See plans with AI calling")
      : off(a.voiceReason ?? "Voice isn't ready on this workspace yet.", VOICE_SETTINGS_HREF, "Open voice settings");
  }
  return { selectable: true, reason: null, fixHref: null, fixLabel: null, needsCallPermission: !a.aiMayCall };
}

/* ------------------------------------------- the server-side refusal (AGENT) */

export type AgentCallFacts = {
  agent: {
    status: string;
    agentType: string;
    voiceCallsEnabled: boolean;
    dailyCallCap: number;
  } | null;
  /** aiMay(authority, "call"), read fresh by the handler. */
  aiMayCall: boolean;
  /** Calls this agent requested since the start of the UTC day. */
  callsToday: number;
  route: string;
};

export type AgentCallRefusal = {
  code: "NOT_FOUND" | "POLICY_BLOCKED";
  reason:
    | "AGENT_NOT_FOUND"
    | "AGENT_NOT_RUNNING"
    | "AGENT_VOICE_OFF"
    | "AGENT_TYPE_CANNOT_CALL"
    | "ROUTE_NOT_ALLOWED"
    | "AI_CALL_PERMISSION_OFF"
    | "AGENT_DAILY_CALL_CAP";
  message: string;
};

/**
 * Why an agent may NOT ask for this call, or null when it may. Checked by the
 * `voice.request_call` handler for every AGENT caller (the authority), and by
 * the tick before it asks (so the timeline says why without a refused call).
 * The lead's own eligibility is not here: `decideDial` owns it.
 */
export function agentCallRefusal(f: AgentCallFacts): AgentCallRefusal | null {
  if (!f.agent) return { code: "NOT_FOUND", reason: "AGENT_NOT_FOUND", message: "That agent could not be found." };
  if (f.agent.status !== "ACTIVE") {
    return { code: "POLICY_BLOCKED", reason: "AGENT_NOT_RUNNING", message: "The agent isn't running, so it can't ask for calls." };
  }
  if (!f.agent.voiceCallsEnabled) {
    return { code: "POLICY_BLOCKED", reason: "AGENT_VOICE_OFF", message: "Phone leads with AI is off for this agent." };
  }
  const scope = agentCallingScope(f.agent.agentType);
  if (!scope.applies) return { code: "POLICY_BLOCKED", reason: "AGENT_TYPE_CANNOT_CALL", message: scope.reason };
  if (!(scope.routes as string[]).includes(f.route)) {
    return { code: "POLICY_BLOCKED", reason: "ROUTE_NOT_ALLOWED", message: "This agent doesn't make that kind of call." };
  }
  // Never widened implicitly: the agent's option is not the workspace's
  // permission. Both must be on.
  if (!f.aiMayCall) {
    return {
      code: "POLICY_BLOCKED",
      reason: "AI_CALL_PERMISSION_OFF",
      message: "Phone leads is off in Settings, AI & selling, What the AI may do, so agents don't call.",
    };
  }
  const cap = clampDailyCap(f.agent.dailyCallCap);
  if (f.callsToday >= cap) {
    return { code: "POLICY_BLOCKED", reason: "AGENT_DAILY_CALL_CAP", message: `This agent has asked for its ${cap} calls for today.` };
  }
  return null;
}

export function clampDailyCap(value: number | null | undefined): number {
  const n = Number.isFinite(value) ? Math.trunc(value as number) : AGENT_VOICE_DEFAULT_DAILY_CAP;
  return Math.min(AGENT_VOICE_MAX_DAILY_CAP, Math.max(1, n));
}

/** Start of the UTC day the daily cap counts from. */
export function utcDayStart(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** The idempotency key for one agent asking for one first call on a route. */
export function agentCallIdempotencyKey(agentId: string, leadId: string, route: string): string {
  return `agent-voice:${agentId}:${leadId}:${route}`;
}

/* ---------------------------------------------------- choosing who to call */

export type VoiceCandidate = {
  leadId: string;
  label: string;
  route: AgentVoiceRoute;
  phone: string | null;
  optedOut: boolean;
  humanTakeover: boolean;
  /** A call to this lead is queued or live (any route). */
  openCall: boolean;
  /** Any call on this route already exists for the lead. */
  calledOnRoute: boolean;
  /** A call request from this agent is waiting for a person's approval. */
  approvalPending?: boolean;
};

export type CandidateSkip = { leadId: string; label: string; reason: string };

/**
 * The leads to ask for, at most `remaining`, in the order given (closing
 * before qualification). A lead appears once. The lead's full eligibility is
 * decided by `decideDial`; this only avoids asking for calls that could never
 * be placed or would duplicate one.
 */
export function selectCallCandidates(candidates: readonly VoiceCandidate[], remaining: number): { toCall: VoiceCandidate[]; skipped: CandidateSkip[] } {
  const toCall: VoiceCandidate[] = [];
  const skipped: CandidateSkip[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.leadId)) continue;
    seen.add(c.leadId);
    const reason = !c.phone
      ? "No phone number."
      : c.optedOut
        ? "Opted out of contact."
        : c.humanTakeover
          ? "A person has taken this lead over."
          : c.openCall
            ? "A call to this lead is already queued or in progress."
            : c.approvalPending
              ? "A call to this lead is waiting for your approval."
              : c.calledOnRoute
              ? "Already called for this. Any retry follows your Voice attempt settings."
              : null;
    if (reason) {
      skipped.push({ leadId: c.leadId, label: c.label, reason });
      continue;
    }
    if (toCall.length >= Math.max(0, remaining)) continue;
    toCall.push(c);
  }
  return { toCall, skipped };
}

/* ------------------------------------------------------------------ tick */

export type AgentVoiceAgent = {
  id: string;
  businessId: string;
  name: string;
  agentType: string;
  status: string;
  /** The agent's approval level: only AUTO dials without a person approving. */
  autonomy: string;
  voiceCallsEnabled: boolean;
  dailyCallCap: number;
};

export type AgentCallRequestResult =
  | { ok: true; callId: string; existing: boolean; deferredReason: string | null }
  | { ok: false; code: string; message: string };

export type AgentVoiceEvent = {
  eventType: "VOICE_CALL_REQUESTED" | "VOICE_CALLS_BLOCKED" | "VOICE_CALL_REFUSED" | "VOICE_CALL_APPROVAL_REQUESTED";
  severity: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  title: string;
  detail: string | null;
  leadId?: string | null;
  callId?: string | null;
};

export type AgentVoiceDeps = {
  now(): Date;
  /** Until when platform maintenance holds outbound calls (null = not held). */
  maintenancePausedUntil(): Promise<Date | null>;
  /** Is voice usable for the workspace at all, and why not. */
  voiceStatus(businessId: string): Promise<{ usable: boolean; reason: string | null }>;
  aiMayCall(businessId: string): Promise<boolean>;
  callsSince(businessId: string, agentId: string, since: Date): Promise<number>;
  /** Call approvals this agent opened since `since` that are still waiting (they count toward the cap). */
  approvalsSince(businessId: string, agentId: string, since: Date): Promise<number>;
  /**
   * An agent on a review level: open (or find) the queue item a person
   * approves before the call is asked for. Never dials.
   */
  requestApproval(agent: AgentVoiceAgent, candidate: VoiceCandidate): Promise<{ ok: true; existing: boolean } | { ok: false; message: string }>;
  candidates(agent: AgentVoiceAgent, work: AgentVoiceWork, limit: number): Promise<VoiceCandidate[]>;
  /** voice.request_call as caller AGENT: the one calling path. */
  requestCall(agent: AgentVoiceAgent, leadId: string, route: AgentVoiceRoute): Promise<AgentCallRequestResult>;
  record(agent: AgentVoiceAgent, event: AgentVoiceEvent): Promise<void>;
};

export type AgentVoiceTickResult = {
  ran: boolean;
  examined: number;
  requested: number;
  /** Call requests left waiting for a person (review approval levels). */
  awaitingApproval: number;
  blocked: number;
  detail: string;
  /**
   * Leads this run's call covers (asked for, already queued or live, or
   * waiting for approval). The same run sends them no text follow-up: the call
   * is the touch. A cancelled or refused call leaves them to follow-up on the
   * next run.
   */
  touchedLeadIds: string[];
};

/**
 * The agent queue item a person approves before a review-level agent's call
 * (the existing "Waiting for review" item). Nothing else queues a REVIEW item
 * about a LEAD, so the pair identifies it.
 */
export const CALL_APPROVAL_ITEM = { itemType: "REVIEW", subjectType: "LEAD" } as const;
export const CALL_APPROVAL_OPEN_STATUSES = ["PENDING", "BLOCKED"] as const;

export function isCallApprovalItem(item: { itemType: string; subjectType: string | null; status: string }): boolean {
  return (
    item.itemType === CALL_APPROVAL_ITEM.itemType &&
    item.subjectType === CALL_APPROVAL_ITEM.subjectType &&
    (CALL_APPROVAL_OPEN_STATUSES as readonly string[]).includes(item.status)
  );
}

/**
 * No double contact (owner decision 2026-09-28): the leads a run's text
 * follow-up may nudge, leaving out every lead that run's AI call covers.
 */
export function leadsForFollowUp<T extends { id: string }>(leads: readonly T[], calledLeadIds: ReadonlySet<string>): { leads: T[]; covered: number } {
  const kept = leads.filter((lead) => !calledLeadIds.has(lead.id));
  return { leads: kept, covered: leads.length - kept.length };
}

/** Only a fully autonomous agent dials without a person approving each call. */
export function agentCallNeedsApproval(autonomy: string): boolean {
  return autonomy !== "AUTO";
}

/**
 * The route an approved call runs on, worked out when the person approves
 * (the lead may have moved on since the request): a qualified lead is called
 * toward the goal it has not reached, or not at all once it has; a lead not
 * yet qualified is called to qualify; a disqualified lead is not called.
 */
export function routeForApproval(input: {
  qualificationState: string | null;
  /** closingVerdict for a qualified lead: the goal not reached, or null when none is. */
  stalledGoal: GoalKey | null;
}): AgentVoiceRoute | null {
  if (input.qualificationState === "QUALIFIED") return input.stalledGoal ? closingRouteForGoal(input.stalledGoal) : null;
  if (input.qualificationState === "NOT_QUALIFIED") return null;
  return "QUALIFICATION";
}

/** Refusals that are about the workspace, not the lead: stop asking this tick. */
const WORKSPACE_WIDE = new Set(["PLAN_LIMIT", "UNAVAILABLE", "FORBIDDEN_SCOPE", "FORBIDDEN_ROLE", "NEEDS_CONFIRMATION"]);

export async function runAgentVoiceCalls(deps: AgentVoiceDeps, agent: AgentVoiceAgent): Promise<AgentVoiceTickResult> {
  const none = (detail: string, ran = false): AgentVoiceTickResult => ({
    ran,
    examined: 0,
    requested: 0,
    awaitingApproval: 0,
    blocked: 0,
    detail,
    touchedLeadIds: [],
  });
  const scope = agentCallingScope(agent.agentType);
  if (!scope.applies || !agent.voiceCallsEnabled) return none("Phone leads with AI is off.");
  if (agent.status !== "ACTIVE") return none("The agent isn't running.");

  const held = await deps.maintenancePausedUntil().catch(() => null);
  if (held && held.getTime() > deps.now().getTime()) {
    return none(`AI calls are held for platform maintenance until ${held.toISOString()}. Nothing was asked for.`, true);
  }

  const voice = await deps.voiceStatus(agent.businessId);
  if (!voice.usable) {
    const detail = voice.reason ?? "Voice isn't ready on this workspace.";
    await deps.record(agent, { eventType: "VOICE_CALLS_BLOCKED", severity: "WARNING", title: "AI calls couldn't be placed", detail });
    return none(detail, true);
  }

  const aiMayCall = await deps.aiMayCall(agent.businessId);
  const since = utcDayStart(deps.now());
  const approvals = agentCallNeedsApproval(agent.autonomy);
  const [callsToday, approvalsToday] = await Promise.all([
    deps.callsSince(agent.businessId, agent.id, since),
    approvals ? deps.approvalsSince(agent.businessId, agent.id, since) : Promise.resolve(0),
  ]);
  const cap = clampDailyCap(agent.dailyCallCap);
  const used = callsToday + approvalsToday;

  // The same refusal the handler applies, asked once for the agent as a whole
  // (route is checked per call by the handler).
  const refusal = agentCallRefusal({
    agent: { status: agent.status, agentType: agent.agentType, voiceCallsEnabled: agent.voiceCallsEnabled, dailyCallCap: cap },
    aiMayCall,
    callsToday: used,
    route: scope.routes[0],
  });
  if (refusal) {
    if (refusal.reason === "AI_CALL_PERMISSION_OFF") {
      await deps.record(agent, { eventType: "VOICE_CALLS_BLOCKED", severity: "WARNING", title: "AI calls are waiting for permission", detail: refusal.message });
    }
    return none(refusal.message, true);
  }

  const remaining = cap - used;
  const candidates: VoiceCandidate[] = [];
  for (const work of scope.work) {
    candidates.push(...(await deps.candidates(agent, work, remaining * 3)));
  }
  const { toCall } = selectCallCandidates(candidates, remaining);

  // A call already queued, live or waiting for approval is this run's touch too.
  const touched = new Set<string>(candidates.filter((c) => c.openCall || c.approvalPending).map((c) => c.leadId));
  let requested = 0;
  let awaitingApproval = 0;
  let blocked = 0;
  for (const c of toCall) {
    if (approvals) {
      // A review level never dials: a person approves each call first.
      const r = await deps.requestApproval(agent, c);
      if (r.ok) {
        touched.add(c.leadId);
        if (!r.existing) {
          awaitingApproval += 1;
          await deps.record(agent, {
            eventType: "VOICE_CALL_APPROVAL_REQUESTED",
            severity: "INFO",
            title: `Waiting for approval to call ${c.label}`,
            detail: "This agent's approval setting asks a person before each call. Approve it in the agent's Queue.",
            leadId: c.leadId,
          });
        }
      } else {
        blocked += 1;
        await deps.record(agent, { eventType: "VOICE_CALL_REFUSED", severity: "WARNING", title: `Didn't ask to call ${c.label}`, detail: r.message, leadId: c.leadId });
      }
      continue;
    }

    const result = await deps.requestCall(agent, c.leadId, c.route);
    if (result.ok) {
      touched.add(c.leadId);
      if (!result.existing) {
        requested += 1;
        await deps.record(agent, {
          eventType: "VOICE_CALL_REQUESTED",
          severity: "SUCCESS",
          title: `Asked the AI to call ${c.label}`,
          detail:
            result.deferredReason === "OUTSIDE_CALLING_HOURS"
              ? "Booked for when their calling hours open."
              : result.deferredReason === "MAINTENANCE_WINDOW"
                ? "Held until platform maintenance ends."
                : "Queued. Everything is re-checked just before it dials.",
          leadId: c.leadId,
          callId: result.callId,
        });
      }
      continue;
    }
    blocked += 1;
    await deps.record(agent, {
      eventType: "VOICE_CALL_REFUSED",
      severity: "WARNING",
      title: `Didn't call ${c.label}`,
      detail: result.message,
      leadId: c.leadId,
    });
    if (WORKSPACE_WIDE.has(result.code)) break;
  }

  const parts: string[] = [];
  if (requested) parts.push(`Asked the AI to call ${requested} lead(s)`);
  if (awaitingApproval) parts.push(`${awaitingApproval} call(s) waiting for your approval`);
  if (blocked) parts.push(`${blocked} couldn't be called`);
  const detail = parts.length ? `${parts.join("; ")}.` : "No leads needed an AI call.";
  return { ran: true, examined: candidates.length, requested, awaitingApproval, blocked, detail, touchedLeadIds: [...touched] };
}
