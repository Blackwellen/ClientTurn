import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAudience } from "@/lib/campaigns/queries";
import { DEFAULT_AUDIENCE_FILTER } from "@/lib/campaigns/types";
import { evaluate } from "@/lib/policy/service";
import { enqueue } from "@/lib/jobs/queue";
import { channelUsable } from "@/lib/integrations/platform-channels";
import { platformConfigured } from "@/lib/integrations/queries";
import { closingVerdict } from "./closing-rules";
import { closingGoalsInTarget, resolveTarget } from "./offer-target";
import { loadAgentOfferTargetOrWhole, loadRulesCatalogue } from "@/lib/commercial/rules-queries";
import type { GoalKey } from "@/lib/qualification-intelligence/types";
import {
  runBookingTickCore,
  runReengagementTickCore,
  type AgentRow,
  type BookingTickDeps,
  type QueueInput,
  type ReengagementTickDeps,
  type StalledLead,
  type TickResult,
  OPEN_QUEUE_STATUSES,
} from "./tick-core";

export type { AgentRow, TickResult } from "./tick-core";

/**
 * Booking and re-engagement agent ticks.
 *
 * The governing decision: **these agents orchestrate the engines that already
 * exist, they do not reimplement them.** V3 already owns qualification,
 * follow-up automations, bookings and reactivation campaigns, each with its own
 * guards. An agent that opened a second send path would bypass every one of
 * them, so instead:
 *
 *   * The **booking agent** finds qualified leads that have stalled without a
 *     booking and, when set to run automatically and policy permits, hands them
 *     back to the existing follow-up automation (re-arms it and queues the next
 *     step). The message still goes out through the follow-up engine and its
 *     guards — the agent only decides *that* it should, never *how*. It does not
 *     offer times or confirm bookings; the conversation assistant does that.
 *   * The **re-engagement agent** builds an audience with the same resolver the
 *     Reactivation wizard uses, and drafts a campaign. It never launches one,
 *     whatever its autonomy: `campaign.launch` is closed to agents in the
 *     service registry, because sending to a whole audience is a person's call.
 *
 * Everything either produces is queued work a person can see and stop, and
 * every candidate is checked against ChannelPolicyService before the agent acts.
 */

/* ---------------------------------------------------------------- booking */

/**
 * The closing agent's stalled leads, shared by the follow-up hand-back
 * (runBookingTick) and "Phone leads with AI" (agents/voice-calls-tick.ts), so
 * both chase exactly the same leads toward the same goal.
 */
export async function findStalledLeads(
  agent: AgentRow,
): Promise<{ candidates: { id: string }[]; leads: StalledLead[]; detail: string | null }> {
  const admin = createAdminClient();
  const dayAgo = new Date(Date.now() - 864e5).toISOString();

  let query = admin
    .from("leads")
    .select("id, first_name, last_name, email, phone, opted_out, last_contact_at, automation_active, status, archived_at, booked_at, human_takeover")
    .eq("business_id", agent.business_id)
    .eq("is_test", false)
    .eq("qualification_state", "QUALIFIED")
    .is("won_at", null)
    .is("lost_at", null)
    .eq("opted_out", false)
    .eq("human_takeover", false)
    .or(`last_contact_at.is.null,last_contact_at.lt.${dayAgo}`)
    .limit(agent.daily_prospect_cap);

  // What this agent sells (0174; the legacy service_id is read as a
  // one-offer target). It chases only leads on those offers, toward the goals
  // of those offers' opportunities only.
  const target = await loadAgentOfferTargetOrWhole(agent.business_id, agent.id);
  const items =
    target.scope === "SELECTED"
      ? (await loadRulesCatalogue(agent.business_id).catch(() => ({ items: [] }))).items
      : [];
  const resolved = resolveTarget(target, items);
  if (resolved.serviceIds) {
    if (resolved.serviceIds.size === 0) {
      return { candidates: [], leads: [], detail: "None of the products or services this agent sells is still in the catalogue." };
    }
    query = query.in("service_id", [...resolved.serviceIds]);
  }

  const { data: candidates, error } = await query;
  if (error) throw new Error("Qualified leads could not be read.");

  const verdicts = await closingContext(admin, agent.business_id, (candidates ?? []).map((l) => l.id));
  const leads: StalledLead[] = [];
  for (const lead of candidates ?? []) {
    const verdict = closingVerdict({
      booked: Boolean(lead.booked_at),
      openGoals: closingGoalsInTarget(verdicts.goals.get(lead.id) ?? [], resolved),
      checkoutInFlight: verdicts.checkout.has(lead.id),
      quoteInFlight: verdicts.quote.has(lead.id),
    });
    if (verdict.stalled) leads.push({ ...(lead as Omit<StalledLead, "goal">), goal: verdict.goal });
  }
  return { candidates: candidates ?? [], leads, detail: null };
}

/**
 * Qualified leads that have gone quiet short of their goal (the closing agent;
 * the stored type is still BOOKING).
 *
 * "Stalled" is deliberately conservative: qualified, not won or lost, not
 * opted out, no human handling it, nothing sent for at least a day, and the
 * goal not reached (`closingVerdict`: a meeting booked for meeting goals, a
 * sale for direct-sale and sign-up goals). Leads the checkout or quote
 * follow-up is already working are left to that loop.
 */
export async function runBookingTick(agent: AgentRow, calledLeadIds: ReadonlySet<string> = new Set()): Promise<TickResult> {
  return runBookingTickCore(bookingDeps(), agent, calledLeadIds);
}

/** The closing tick's server wiring: Supabase, ChannelPolicyService and the job queue. */
function bookingDeps(): BookingTickDeps {
  const admin = createAdminClient();
  return {
    now: () => new Date(),
    stalled: (agent) => findStalledLeads(agent),
    async policy(agent, lead) {
      // Policy first. A lead who cannot be contacted is queued as BLOCKED with
      // the reason, so the person reading the queue learns why rather than
      // finding an agent that silently did nothing.
      const decision = await evaluate({
        businessId: agent.business_id,
        subject: { type: "LEAD", id: lead.id, email: lead.email, phone: lead.phone, optedOut: lead.opted_out },
        channel: lead.email ? "EMAIL" : "SMS",
        campaignType: "WARM",
        permissionOnly: true,
        record: true,
      });
      return { permitted: decision.outcome === "ALLOWED" || decision.outcome === "REQUIRE_TEMPLATE", message: decision.message };
    },
    queue: (agent, item) => upsertQueueItem(admin, agent, item),
    async rearm(agent, leadId) {
      const { error } = await admin.from("leads").update({ automation_active: true }).eq("id", leadId).eq("business_id", agent.business_id);
      if (error) throw new Error("Follow-up could not be restarted for a lead.");
    },
    async enqueueAdvance(agent, leadId, idempotencyKey) {
      // Re-arming alone did nothing: the engine only moves when an advance job runs.
      await enqueue("automation.advance", { leadId }, { businessId: agent.business_id, idempotencyKey });
    },
  };
}

/**
 * Goals of each lead's open opportunities, and which leads a checkout or quote
 * loop is already working. Read in three batched queries, never per lead.
 */
async function closingContext(
  admin: ReturnType<typeof createAdminClient>,
  businessId: string,
  leadIds: string[],
): Promise<{
  goals: Map<string, { serviceId: string | null; goal: GoalKey | null }[]>;
  checkout: Set<string>;
  quote: Set<string>;
}> {
  const goals = new Map<string, { serviceId: string | null; goal: GoalKey | null }[]>();
  const checkout = new Set<string>();
  const quote = new Set<string>();
  if (leadIds.length === 0) return { goals, checkout, quote };

  const { data: opps, error: oppError } = await admin
    .from("opportunities")
    .select("id, lead_id, goal, service_id")
    .eq("business_id", businessId)
    .eq("outcome", "OPEN")
    .in("lead_id", leadIds);
  if (oppError) throw new Error("Open opportunities could not be read.");
  const leadByOpp = new Map<string, string>();
  for (const opp of opps ?? []) {
    if (!opp.lead_id) continue;
    leadByOpp.set(opp.id, opp.lead_id);
    goals.set(opp.lead_id, [
      ...(goals.get(opp.lead_id) ?? []),
      { serviceId: opp.service_id ?? null, goal: (opp.goal as GoalKey | null) ?? null },
    ]);
  }

  const { data: attempts, error: attemptError } = await admin
    .from("checkout_attempts")
    .select("lead_id")
    .eq("business_id", businessId)
    .eq("status", "SENT")
    .in("lead_id", leadIds);
  if (attemptError) throw new Error("Checkout attempts could not be read.");
  for (const attempt of attempts ?? []) checkout.add(attempt.lead_id);

  const oppIds = [...leadByOpp.keys()];
  if (oppIds.length > 0) {
    const { data: quotes, error: quoteError } = await admin
      .from("quotes")
      .select("opportunity_id")
      .eq("business_id", businessId)
      .in("status", ["PENDING_APPROVAL", "APPROVED", "SENT", "VIEWED", "ACCEPTED"])
      .in("opportunity_id", oppIds);
    if (quoteError) throw new Error("Quotes could not be read.");
    for (const q of quotes ?? []) {
      const leadId = leadByOpp.get(q.opportunity_id);
      if (leadId) quote.add(leadId);
    }
  }
  return { goals, checkout, quote };
}

/* --------------------------------------------------------- re-engagement */

/**
 * Drafts a reactivation campaign over eligible older leads.
 *
 * Uses the same `resolveAudience` the Reactivation wizard uses, so eligibility,
 * suppression and cooldown are decided in exactly one place. The agent chooses
 * the criteria and the moment; it does not re-derive who is contactable.
 */
export async function runReengagementTick(agent: AgentRow): Promise<TickResult> {
  return runReengagementTickCore(reengagementDeps(), agent);
}

/** The re-engagement tick's server wiring. */
function reengagementDeps(): ReengagementTickDeps {
  const admin = createAdminClient();
  return {
    async ownOpenCampaign(agent) {
      // An open campaign this agent drafted already covers this work; a second
      // one would double-contact. Campaigns people made themselves are theirs
      // and do not stop the agent -- the audience resolver's cooldown already
      // keeps a lead from being picked twice in quick succession.
      const { data: drafted, error: draftedError } = await admin
        .from("agent_queue_items")
        .select("subject_id")
        .eq("business_id", agent.business_id)
        .eq("agent_id", agent.id)
        .eq("item_type", "REENGAGE")
        .eq("subject_type", "CAMPAIGN");
      if (draftedError) throw new Error("The agent's earlier campaigns could not be read.");
      const ownIds = (drafted ?? []).map((row) => row.subject_id).filter((id): id is string => Boolean(id));
      if (ownIds.length === 0) return false;
      const { data: open, error: openError } = await admin
        .from("campaigns")
        .select("id")
        .eq("business_id", agent.business_id)
        .in("id", ownIds)
        .in("status", ["DRAFT", "SCHEDULED", "RUNNING"])
        .limit(1)
        .maybeSingle();
      if (openError) throw new Error("The agent's earlier campaigns could not be read.");
      return Boolean(open);
    },
    async channels(agent) {
      // The channel follows what is connected. A draft on a channel that
      // cannot send would only fail at launch.
      const { data: integrations, error } = await admin
        .from("integrations")
        .select("provider_type, status")
        .eq("business_id", agent.business_id)
        .in("provider_type", ["imap_smtp", "twilio_sms"]);
      if (error) throw new Error("Connections could not be read.");
      const healthy = (provider: string) =>
        (integrations ?? []).some((row) => row.provider_type === provider && row.status !== "DISCONNECTED" && row.status !== "ACTION_REQUIRED");
      return { mailbox: healthy("imap_smtp"), sms: channelUsable(integrations ?? [], ["twilio_sms"], platformConfigured("twilio_sms")) };
    },
    async audience(agent, channel) {
      const { preview, eligibleLeadIds } = await resolveAudience(
        agent.business_id,
        {
          ...DEFAULT_AUDIENCE_FILTER,
          // Leads older than 60 days that never replied and never booked.
          olderThanDays: 60,
          noReply: true,
          markedLost: false,
          notBooked: true,
          lastContactedBeforeDays: 30,
          ...(agent.service_id ? { serviceId: agent.service_id } : {}),
        },
        channel,
        // The cron tick has no user session: without the service-role client
        // the resolver's reads would run as nobody and match nothing.
        admin,
      );
      return { matched: preview.matched, eligibleLeadIds };
    },
    async draftCampaign(agent, { channel, size }) {
      const { data: campaign, error } = await admin
        .from("campaigns")
        .insert({
          business_id: agent.business_id,
          name: `Re-engagement · ${new Date().toLocaleDateString("en-GB")}`,
          description: "Drafted automatically by a re-engagement agent.",
          channel,
          status: "DRAFT",
          audience_label: "Quiet leads over 60 days old",
          estimated_audience_size: size,
          filter_config: { olderThanDays: 60, noReply: true, notBooked: true, lastContactedBeforeDays: 30 } as never,
        })
        .select("id")
        .single();
      if (error || !campaign) throw new Error("The reactivation campaign could not be drafted.");
      return campaign.id;
    },
    queue: (agent, item) => upsertQueueItem(admin, agent, item),
  };
}

/* ------------------------------------------------------------------ shared */

/**
 * One queue row per (agent, subject, item type) per open cycle
 * (tick-core.ts replacesOpenQueueItem).
 *
 * Deletes any prior open row of the same type for the same subject first, so
 * an agent that runs daily does not accumulate a duplicate item every day for
 * the same stalled lead. Completed rows are kept as history. Background-agent
 * QA 2026-09-29: without the type, a closing nudge deleted the same lead's
 * open call approval ("Approve call"), silently, whenever that run's voice
 * tick had not covered the lead (maintenance, voice unusable, option off).
 */
async function upsertQueueItem(
  admin: ReturnType<typeof createAdminClient>,
  agent: AgentRow,
  input: QueueInput,
): Promise<void> {
  await admin
    .from("agent_queue_items")
    .delete()
    .eq("business_id", agent.business_id)
    .eq("agent_id", agent.id)
    .eq("subject_id", input.subjectId)
    .eq("item_type", input.itemType)
    .in("status", [...OPEN_QUEUE_STATUSES]);

  await admin.from("agent_queue_items").insert({
    business_id: agent.business_id,
    agent_id: agent.id,
    item_type: input.itemType,
    status: input.status,
    subject_type: input.subjectType ?? "LEAD",
    subject_id: input.subjectId,
    subject_label: input.subjectLabel,
    blocked_reason: input.blockedReason,
    completed_at: input.status === "DONE" ? new Date().toISOString() : null,
  });
}
