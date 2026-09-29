/**
 * The closing and re-engagement agent ticks, as pure cores over injected
 * dependencies (background-agent QA, 2026-09-29). `ticks.ts` supplies the
 * Supabase, policy-service and job-queue wiring; tests supply fakes, so who a
 * tick picks, what it does, its stop conditions, caps, approvals and the "no
 * double contact" rule are proved without a database (tests/agent-ticks.test.ts).
 *
 * The governing decision is unchanged (ticks.ts): these agents orchestrate
 * the engines that already exist. The closing agent hands a stalled lead back
 * to the guarded follow-up engine; the re-engagement agent drafts a campaign
 * and never launches one.
 *
 * Pure: no `server-only`, no Supabase, relative imports with `.ts`.
 */

import type { GoalKey } from "../qualification-intelligence/types.ts";
import { resumeFollowUpBlock } from "../leads/resume-rule.ts";
import { leadsForFollowUp } from "./voice-calls.ts";
import { AgentBlocked, chooseReengagementChannel, type ReengagementChannel } from "./policy.ts";

export type TickResult = {
  examined: number;
  actioned: number;
  blocked: number;
  detail: string;
};

export type AgentRow = {
  id: string;
  business_id: string;
  autonomy: string;
  daily_prospect_cap: number;
  service_id: string | null;
  conversion_goal_id: string | null;
};

export type StalledLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  opted_out: boolean;
  last_contact_at: string | null;
  automation_active: boolean;
  status: string;
  archived_at: string | null;
  booked_at: string | null;
  human_takeover: boolean;
  /** The goal the lead has not reached (closingVerdict). */
  goal: GoalKey;
};

export type QueueInput = {
  itemType: string;
  subjectId: string;
  subjectLabel: string;
  status: string;
  blockedReason: string | null;
  subjectType?: string;
};

/** Queue rows a person has not dealt with yet. */
export const OPEN_QUEUE_STATUSES = ["PENDING", "BLOCKED"] as const;

/**
 * Whether queueing `item` replaces an existing row: the same subject, the
 * same item type, still open. A different type (a call approval beside a
 * closing nudge) is a different piece of work and is never touched.
 */
export function replacesOpenQueueItem(row: { subject_id: string | null; item_type: string; status: string }, item: Pick<QueueInput, "subjectId" | "itemType">): boolean {
  return row.subject_id === item.subjectId && row.item_type === item.itemType && (OPEN_QUEUE_STATUSES as readonly string[]).includes(row.status);
}

export function displayName(lead: { first_name: string | null; last_name: string | null; email: string | null }): string {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  return name || lead.email || "Lead";
}

/* ---------------------------------------------------------------- closing */

export type BookingTickDeps = {
  now(): Date;
  /** The agent's stalled qualified leads (ticks.ts findStalledLeads), or why there are none. */
  stalled(agent: AgentRow): Promise<{ candidates: { id: string }[]; leads: StalledLead[]; detail: string | null }>;
  /** ChannelPolicyService, permission only, recorded. */
  policy(agent: AgentRow, lead: StalledLead): Promise<{ permitted: boolean; message: string }>;
  /** One open queue row per (agent, subject): replaces an open one. */
  queue(agent: AgentRow, item: QueueInput): Promise<void>;
  /** Turn the lead's follow-up automation back on. */
  rearm(agent: AgentRow, leadId: string): Promise<void>;
  /** Queue the follow-up engine's next step; an identical key is one job. */
  enqueueAdvance(agent: AgentRow, leadId: string, idempotencyKey: string): Promise<void>;
};

/** One nudge per lead per agent per UTC day, however often the tick runs. */
export function bookingNudgeKey(agentId: string, leadId: string, now: Date): string {
  return `agent-booking:${agentId}:${leadId}:${now.toISOString().slice(0, 10)}`;
}

/**
 * Qualified leads that have gone quiet short of their goal: listed for a
 * person (review levels) or handed back to follow-up (AUTO). A lead this
 * run's AI call covers is left alone (the call is the touch). A lead policy
 * refuses, or one that is booked, closed or archived, is queued BLOCKED with
 * the reason, never nudged.
 */
export async function runBookingTickCore(deps: BookingTickDeps, agent: AgentRow, calledLeadIds: ReadonlySet<string> = new Set()): Promise<TickResult> {
  const stalled = await deps.stalled(agent);
  if (stalled.detail) return { examined: 0, actioned: 0, blocked: 0, detail: stalled.detail };
  const { leads, covered } = leadsForFollowUp(stalled.leads, calledLeadIds);

  let actioned = 0;
  let blocked = 0;
  let metNotBought = 0;
  for (const lead of leads) {
    const decision = await deps.policy(agent, lead);
    const resumeBlock = resumeFollowUpBlock({ status: lead.status, optedOut: lead.opted_out, archived: Boolean(lead.archived_at) });
    // A sale or sign-up lead who booked a meeting (a demo) but has not bought
    // is exactly who the closing agent chases (closingVerdict), yet follow-up
    // stops at a booking (automation/scheduler.ts "booked"), so handing them
    // back would do nothing. Background-agent QA 2026-09-29: they were filed
    // BLOCKED "follow-up has done its job", which is false. They are listed
    // for a person instead; an AI call (DIRECT_CLOSE) may still reach them.
    if (decision.permitted && resumeBlock?.code === "booked" && (lead.goal === "C_DIRECT_SALE" || lead.goal === "D_SIGNUP_TRIAL")) {
      metNotBought += 1;
      await deps.queue(agent, {
        itemType: "BOOKING",
        subjectId: lead.id,
        subjectLabel: `${displayName(lead)} (booked, not bought yet)`,
        status: "PENDING",
        blockedReason: null,
      });
      continue;
    }
    if (!decision.permitted || resumeBlock) {
      blocked += 1;
      await deps.queue(agent, {
        itemType: "BOOKING",
        subjectId: lead.id,
        subjectLabel: displayName(lead),
        status: "BLOCKED",
        blockedReason: resumeBlock?.message ?? decision.message,
      });
      continue;
    }
    await deps.queue(agent, {
      itemType: "BOOKING",
      subjectId: lead.id,
      subjectLabel: displayName(lead),
      status: agent.autonomy === "AUTO" ? "DONE" : "PENDING",
      blockedReason: null,
    });
    // Only an AUTO agent changes anything: re-arm and queue the engine's next
    // step, so the message goes out through the follow-up engine's guards.
    if (agent.autonomy === "AUTO") {
      if (!lead.automation_active) await deps.rearm(agent, lead.id);
      await deps.enqueueAdvance(agent, lead.id, bookingNudgeKey(agent.id, lead.id, deps.now()));
    }
    actioned += 1;
  }

  return {
    examined: stalled.candidates.length,
    actioned,
    blocked,
    detail:
      (agent.autonomy === "AUTO"
        ? `Handed ${actioned} qualified lead(s) that have not reached their goal back to follow-up.`
        : `Listed ${actioned} qualified lead(s) that have not reached their goal for you to chase.`) +
      (metNotBought > 0 ? ` ${metNotBought} booked a meeting but have not bought yet: listed for you to follow up.` : "") +
      (covered > 0 ? ` ${covered} left alone because an AI call covers them this run.` : ""),
  };
}

/* --------------------------------------------------------- re-engagement */

export type ReengagementTickDeps = {
  /** An open (draft, scheduled or running) campaign this agent drafted. */
  ownOpenCampaign(agent: AgentRow): Promise<boolean>;
  /** Which sending channels are connected and healthy. */
  channels(agent: AgentRow): Promise<{ mailbox: boolean; sms: boolean }>;
  /** The Reactivation wizard's own resolver: eligibility, suppression and cooldown in one place. */
  audience(agent: AgentRow, channel: ReengagementChannel): Promise<{ matched: number; eligibleLeadIds: string[] }>;
  /** Insert a DRAFT campaign; returns its id. Never launches. */
  draftCampaign(agent: AgentRow, input: { channel: ReengagementChannel; size: number }): Promise<string>;
  queue(agent: AgentRow, item: QueueInput): Promise<void>;
};

/**
 * Drafts one reactivation campaign over quiet older leads, capped at the
 * agent's daily limit. Never a second while its last is open (no double
 * contact), never on a channel that cannot send, never launched.
 */
export async function runReengagementTickCore(deps: ReengagementTickDeps, agent: AgentRow): Promise<TickResult> {
  if (await deps.ownOpenCampaign(agent)) {
    return { examined: 0, actioned: 0, blocked: 0, detail: "This agent's last reactivation campaign is still open. Nothing new was drafted." };
  }
  const channel = chooseReengagementChannel(await deps.channels(agent));
  if (!channel) {
    throw new AgentBlocked("Connect a mailbox or Twilio SMS in Settings → Connections so the agent has a channel to draft a campaign on.");
  }
  const { matched, eligibleLeadIds } = await deps.audience(agent, channel);
  const capped = eligibleLeadIds.slice(0, Math.max(0, agent.daily_prospect_cap));
  if (capped.length === 0) {
    return { examined: matched, actioned: 0, blocked: 0, detail: "No leads currently meet the re-engagement criteria." };
  }
  const campaignId = await deps.draftCampaign(agent, { channel, size: capped.length });
  await deps.queue(agent, {
    itemType: "REENGAGE",
    subjectId: campaignId,
    subjectLabel: `${capped.length} leads ready to re-engage`,
    status: "PENDING",
    blockedReason: null,
    subjectType: "CAMPAIGN",
  });
  return {
    examined: matched,
    actioned: capped.length,
    blocked: 0,
    detail: `Drafted a reactivation campaign for ${capped.length} lead(s). Review and launch it in Reactivation.`,
  };
}
