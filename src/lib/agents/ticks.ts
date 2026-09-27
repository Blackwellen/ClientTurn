import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAudience } from "@/lib/campaigns/queries";
import { DEFAULT_AUDIENCE_FILTER } from "@/lib/campaigns/types";
import { evaluate } from "@/lib/policy/service";
import { enqueue } from "@/lib/jobs/queue";
import { resumeFollowUpBlock } from "@/lib/leads/resume-rule";
import { AgentBlocked, chooseReengagementChannel } from "./policy";
import { channelUsable } from "@/lib/integrations/platform-channels";
import { platformConfigured } from "@/lib/integrations/queries";

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

export type TickResult = {
  examined: number;
  actioned: number;
  blocked: number;
  detail: string;
};

type AgentRow = {
  id: string;
  business_id: string;
  autonomy: string;
  daily_prospect_cap: number;
  service_id: string | null;
  conversion_goal_id: string | null;
};

/* ---------------------------------------------------------------- booking */

/**
 * Qualified leads that have gone quiet without booking.
 *
 * "Stalled" is deliberately conservative: qualified, no booking, not won or
 * lost, not opted out, no human handling it, and nothing sent for at least a
 * day. A lead being actively worked is left alone.
 */
export async function runBookingTick(agent: AgentRow): Promise<TickResult> {
  const admin = createAdminClient();
  const dayAgo = new Date(Date.now() - 864e5).toISOString();

  let query = admin
    .from("leads")
    .select("id, first_name, last_name, email, phone, opted_out, last_contact_at, automation_active, status, archived_at")
    .eq("business_id", agent.business_id)
    .eq("is_test", false)
    .eq("qualification_state", "QUALIFIED")
    .is("booked_at", null)
    .is("won_at", null)
    .is("lost_at", null)
    .eq("opted_out", false)
    .eq("human_takeover", false)
    .or(`last_contact_at.is.null,last_contact_at.lt.${dayAgo}`)
    .limit(agent.daily_prospect_cap);

  if (agent.service_id) query = query.eq("service_id", agent.service_id);

  const { data: leads, error } = await query;
  if (error) throw new Error("Qualified leads could not be read.");

  let actioned = 0;
  let blocked = 0;

  for (const lead of leads ?? []) {
    // Policy first. A lead who cannot be contacted is queued as BLOCKED with
    // the reason, so the person reading the queue learns why rather than
    // finding an agent that silently did nothing.
    const decision = await evaluate({
      businessId: agent.business_id,
      subject: {
        type: "LEAD",
        id: lead.id,
        email: lead.email,
        phone: lead.phone,
        optedOut: lead.opted_out,
      },
      channel: lead.email ? "EMAIL" : "SMS",
      campaignType: "WARM",
      permissionOnly: true,
      record: true,
    });

    const permitted =
      decision.outcome === "ALLOWED" || decision.outcome === "REQUIRE_TEMPLATE";
    // The same rule "Hand back" uses: no follow-up for a booked, closed or
    // archived lead.
    const resumeBlock = resumeFollowUpBlock({
      status: lead.status,
      optedOut: lead.opted_out,
      archived: Boolean(lead.archived_at),
    });

    if (!permitted || resumeBlock) {
      blocked += 1;
      await upsertQueueItem(admin, agent, {
        itemType: "BOOKING",
        subjectId: lead.id,
        subjectLabel: displayName(lead),
        status: "BLOCKED",
        blockedReason: resumeBlock?.message ?? decision.message,
      });
      continue;
    }

    await upsertQueueItem(admin, agent, {
      itemType: "BOOKING",
      subjectId: lead.id,
      subjectLabel: displayName(lead),
      status: agent.autonomy === "AUTO" ? "DONE" : "PENDING",
      blockedReason: null,
    });

    // Only an AUTO agent changes anything. Re-arming the automation and
    // queueing its next step hands the work to the existing guarded follow-up
    // engine rather than sending here. Re-arming alone did nothing: the engine
    // only moves when an advance job runs.
    if (agent.autonomy === "AUTO") {
      if (!lead.automation_active) {
        const { error: armError } = await admin
          .from("leads")
          .update({ automation_active: true })
          .eq("id", lead.id)
          .eq("business_id", agent.business_id);
        if (armError) throw new Error("Follow-up could not be restarted for a lead.");
      }
      await enqueue(
        "automation.advance",
        { leadId: lead.id },
        {
          businessId: agent.business_id,
          // One nudge per lead per agent per day, however often the tick runs.
          idempotencyKey: `agent-booking:${agent.id}:${lead.id}:${new Date().toISOString().slice(0, 10)}`,
        },
      );
    }

    actioned += 1;
  }

  return {
    examined: leads?.length ?? 0,
    actioned,
    blocked,
    detail:
      agent.autonomy === "AUTO"
        ? `Handed ${actioned} qualified lead(s) with no booking back to follow-up.`
        : `Listed ${actioned} qualified lead(s) with no booking for you to chase.`,
  };
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
  const admin = createAdminClient();

  // An open campaign this agent drafted already covers this work; a second one
  // would double-contact. Campaigns people made themselves are theirs and do
  // not stop the agent -- the audience resolver's cooldown already keeps a
  // lead from being picked twice in quick succession.
  const { data: drafted, error: draftedError } = await admin
    .from("agent_queue_items")
    .select("subject_id")
    .eq("business_id", agent.business_id)
    .eq("agent_id", agent.id)
    .eq("item_type", "REENGAGE")
    .eq("subject_type", "CAMPAIGN");
  if (draftedError) throw new Error("The agent's earlier campaigns could not be read.");

  const ownIds = (drafted ?? [])
    .map((row) => row.subject_id)
    .filter((id): id is string => Boolean(id));

  if (ownIds.length > 0) {
    const { data: open, error: openError } = await admin
      .from("campaigns")
      .select("id")
      .eq("business_id", agent.business_id)
      .in("id", ownIds)
      .in("status", ["DRAFT", "SCHEDULED", "RUNNING"])
      .limit(1)
      .maybeSingle();
    if (openError) throw new Error("The agent's earlier campaigns could not be read.");

    if (open) {
      return {
        examined: 0,
        actioned: 0,
        blocked: 0,
        detail: "This agent's last reactivation campaign is still open. Nothing new was drafted.",
      };
    }
  }

  // The channel follows what is connected. A draft on a channel that cannot
  // send would only fail at launch.
  const { data: integrations, error: integrationError } = await admin
    .from("integrations")
    .select("provider_type, status")
    .eq("business_id", agent.business_id)
    .in("provider_type", ["imap_smtp", "twilio_sms"]);
  if (integrationError) throw new Error("Connections could not be read.");

  const healthy = (provider: string) =>
    (integrations ?? []).some(
      (row) =>
        row.provider_type === provider &&
        row.status !== "DISCONNECTED" &&
        row.status !== "ACTION_REQUIRED",
    );
  const channel = chooseReengagementChannel({
    mailbox: healthy("imap_smtp"),
    sms: channelUsable(integrations ?? [], ["twilio_sms"], platformConfigured("twilio_sms")),
  });

  if (!channel) {
    throw new AgentBlocked(
      "Connect a mailbox or Twilio SMS in Settings → Connections so the agent has a channel to draft a campaign on.",
    );
  }

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
    // The cron tick has no user session: without the service-role client the
    // resolver's reads would run as nobody and match nothing.
    admin,
  );

  const capped = eligibleLeadIds.slice(0, agent.daily_prospect_cap);

  if (capped.length === 0) {
    return {
      examined: preview.matched,
      actioned: 0,
      blocked: 0,
      detail: "No leads currently meet the re-engagement criteria.",
    };
  }

  const { data: campaign, error } = await admin
    .from("campaigns")
    .insert({
      business_id: agent.business_id,
      name: `Re-engagement · ${new Date().toLocaleDateString("en-GB")}`,
      description: "Drafted automatically by a re-engagement agent.",
      channel,
      status: "DRAFT",
      audience_label: "Quiet leads over 60 days old",
      estimated_audience_size: capped.length,
      filter_config: {
        olderThanDays: 60,
        noReply: true,
        notBooked: true,
        lastContactedBeforeDays: 30,
      } as never,
    })
    .select("id")
    .single();

  if (error || !campaign) throw new Error("The reactivation campaign could not be drafted.");

  await upsertQueueItem(admin, agent, {
    itemType: "REENGAGE",
    subjectId: campaign.id,
    subjectLabel: `${capped.length} leads ready to re-engage`,
    status: "PENDING",
    blockedReason: null,
    subjectType: "CAMPAIGN",
  });

  return {
    examined: preview.matched,
    actioned: capped.length,
    blocked: 0,
    // Deliberately says "draft": launching is a person's decision unless the
    // workspace has explicitly chosen otherwise in the Reactivation surface.
    detail: `Drafted a reactivation campaign for ${capped.length} lead(s). Review and launch it in Reactivation.`,
  };
}

/* ------------------------------------------------------------------ shared */

type QueueInput = {
  itemType: string;
  subjectId: string;
  subjectLabel: string;
  status: string;
  blockedReason: string | null;
  subjectType?: string;
};

/**
 * One queue row per (agent, subject) per open cycle.
 *
 * Deletes any prior open row for the same subject first, so an agent that runs
 * daily does not accumulate a duplicate item every day for the same stalled
 * lead. Completed rows are kept as history.
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
    .in("status", ["PENDING", "BLOCKED"]);

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

function displayName(lead: {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}): string {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  return name || lead.email || "Lead";
}
