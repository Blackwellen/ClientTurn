import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { isReplyTrigger } from "@/lib/agent/qi-turn";
import type { AgentEventType } from "@/lib/agent/types";
import type { PolicyGate } from "@/lib/jobs/send-core";
import {
  clampFrequencyCaps,
  classifyTouch,
  evaluateFrequency,
  inEnquiryWindow,
  touchesSinceEngagement,
  type FrequencyCaps,
  type FrequencyVerdict,
  type TouchClass,
} from "./frequency";
import type { LoopKey } from "./triggers";

/**
 * The I/O half of the contact-frequency guard (./frequency.ts is the rules).
 *
 * `frequencyGateForMessage` is what the send gate calls for every message,
 * immediately before dispatch. `checkAutomatedTouchAllowed` is the same
 * verdict for a caller that wants to know BEFORE it queues anything: the
 * intent triggers use it, and so must the direct-sale agent's abandoned-
 * checkout nudges (queue them with origin "automation" and a
 * `checkout-nudge:` send key and the send gate enforces it again anyway).
 */

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/* ----------------------------------------------------------- settings --- */

export type ReengagementSettings = {
  caps: FrequencyCaps;
  notNowEnabled: boolean;
  noShowEnabled: boolean;
  winBackEnabled: boolean;
};

export const DEFAULT_REENGAGEMENT_SETTINGS: ReengagementSettings = {
  caps: clampFrequencyCaps(null),
  notNowEnabled: true,
  noShowEnabled: true,
  winBackEnabled: true,
};

/**
 * The workspace's caps and trigger switches. Read with `*` so a database that
 * has not yet run the migration (the columns are absent) gets the defaults,
 * which are the owner's defaults, rather than an error.
 */
export async function loadReengagementSettings(businessId: string): Promise<ReengagementSettings> {
  const { data, error } = await db().from("business_settings").select("*").eq("business_id", businessId).maybeSingle();
  if (error) {
    if (!isSchemaLag(error)) console.error("[reengagement] settings read failed", { businessId, message: error.message });
    return DEFAULT_REENGAGEMENT_SETTINGS;
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const flag = (key: string) => (typeof row[key] === "boolean" ? (row[key] as boolean) : true);
  return {
    caps: clampFrequencyCaps({
      perDay: row.contact_cap_daily,
      perWeek: row.contact_cap_weekly,
      per30Days: row.contact_cap_30d,
      deadAfter: row.dead_lead_after_touches,
    }),
    notNowEnabled: flag("reengage_not_now_enabled"),
    noShowEnabled: flag("reengage_no_show_enabled"),
    winBackEnabled: flag("win_back_enabled"),
  };
}

/* ------------------------------------------------------------ history --- */

const UUID_TAIL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The agent run a message came from: its column, else the run id every agent send key ends with. */
export function agentRunIdOf(row: { agent_run_id?: string | null; send_key?: string | null }): string | null {
  if (row.agent_run_id) return row.agent_run_id;
  const match = row.send_key ? UUID_TAIL.exec(row.send_key) : null;
  return match ? match[1] : null;
}

type OutboundRow = {
  id: string;
  origin: string;
  send_key: string | null;
  agent_run_id: string | null;
  campaign_id: string | null;
  sent_at: string | null;
  opened_at: string | null;
  read_at: string | null;
};

type RunRow = { id: string; trigger_event_type: string | null; idempotency_key: string | null };

async function agentRuns(runIds: string[]): Promise<Map<string, RunRow>> {
  const out = new Map<string, RunRow>();
  if (runIds.length === 0) return out;
  const { data, error } = await db()
    .from("conversation_agent_runs")
    .select("id, trigger_event_type, idempotency_key")
    .in("id", runIds.slice(0, 500));
  if (error) {
    console.error("[reengagement] agent runs read failed", { message: error.message });
    return out;
  }
  for (const row of (data ?? []) as RunRow[]) out.set(row.id, row);
  return out;
}

/** Campaign ids the re-engagement agent drafted (its REENGAGE queue items). */
export async function agentDraftedCampaignIds(businessId: string, campaignIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(campaignIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const { data, error } = await db()
    .from("agent_queue_items")
    .select("subject_id")
    .eq("business_id", businessId)
    .eq("item_type", "REENGAGE")
    .eq("subject_type", "CAMPAIGN")
    .in("subject_id", ids.slice(0, 500));
  if (error) return new Set();
  return new Set(((data ?? []) as { subject_id: string | null }[]).map((row) => row.subject_id ?? "").filter(Boolean));
}

/** Classifies outbound rows as automated touches (or not), resolving agent runs and agent-drafted campaigns. */
export async function classifyRows(
  businessId: string,
  rows: readonly Pick<OutboundRow, "origin" | "send_key" | "agent_run_id" | "campaign_id">[],
): Promise<TouchClass[]> {
  const runIds = [
    ...new Set(rows.filter((row) => row.origin === "agent").map((row) => agentRunIdOf(row)).filter((id): id is string => Boolean(id))),
  ];
  const [runs, drafted] = await Promise.all([
    agentRuns(runIds),
    agentDraftedCampaignIds(
      businessId,
      rows.filter((row) => row.origin === "campaign" && row.campaign_id).map((row) => row.campaign_id as string),
    ),
  ]);
  return rows.map((row) => {
    const runId = row.origin === "agent" ? agentRunIdOf(row) : null;
    const run = runId ? runs.get(runId) : undefined;
    return classifyTouch({
      origin: row.origin,
      sendKey: row.send_key,
      agentTriggerIsReply: run?.trigger_event_type ? isReplyTrigger(run.trigger_event_type as AgentEventType) : null,
      agentRunKey: run?.idempotency_key ?? null,
      agentDraftedCampaign: Boolean(row.campaign_id && drafted.has(row.campaign_id)),
    });
  });
}

export type ContactHistory = {
  /** Automated touches in the last 30 days, oldest first. */
  automatedSentAt: string[];
  touchesSinceEngagement: number;
  intentState: string | null;
  leadCreatedAt: string | null;
  lastInboundAt: string | null;
};

const LOOKBACK_MS = 180 * 86_400_000;
const MONTH_MS = 30 * 86_400_000;

/**
 * Everything the guard needs about one lead, read fresh. A failed read throws:
 * the send gate treats a throw as a refusal, never as permission.
 */
export async function loadContactHistory(input: {
  businessId: string;
  leadId: string;
  now: Date;
  /** The message being judged is never part of its own history. */
  excludeMessageId?: string | null;
  /**
   * Also count automated messages already queued and due (not yet sent). For
   * a caller deciding whether to queue another (`checkAutomatedTouchAllowed`):
   * a rebook queued a second ago is a touch. Never for the send gate itself,
   * where two queued messages would otherwise hold each other back forever.
   */
  includeQueued?: boolean;
}): Promise<ContactHistory> {
  const since = new Date(input.now.getTime() - LOOKBACK_MS).toISOString();
  const [outbound, inbound, lead] = await Promise.all([
    db()
      .from("messages")
      .select("id, origin, send_key, agent_run_id, campaign_id, sent_at, opened_at, read_at, status, scheduled_for, created_at")
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .eq("direction", "outbound")
      .in("status", input.includeQueued ? ["SENT", "DELIVERED", "SENDING", "QUEUED"] : ["SENT", "DELIVERED", "SENDING"])
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(500),
    db()
      .from("messages")
      .select("created_at")
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1),
    db().from("leads").select("intent_state, created_at").eq("business_id", input.businessId).eq("id", input.leadId).maybeSingle(),
  ]);
  if (outbound.error) throw new Error(`contact history: outbound read failed: ${outbound.error.message}`);
  if (inbound.error) throw new Error(`contact history: inbound read failed: ${inbound.error.message}`);
  if (lead.error) throw new Error(`contact history: lead read failed: ${lead.error.message}`);

  const nowIso = input.now.toISOString();
  const rows = ((outbound.data ?? []) as (OutboundRow & { status: string; scheduled_for: string | null; created_at: string })[])
    .filter((row) => row.id !== input.excludeMessageId)
    // A queued message counts from when it is due, and only once it is due.
    .map((row) => (row.sent_at ? row : { ...row, sent_at: row.status === "QUEUED" ? (row.scheduled_for ?? row.created_at) : null }))
    .filter((row) => row.sent_at && row.sent_at <= nowIso);
  const classes = await classifyRows(input.businessId, rows);

  const automated: OutboundRow[] = rows.filter((_, index) => classes[index].automated);
  const lastInboundAt = ((inbound.data ?? []) as { created_at: string }[])[0]?.created_at ?? null;
  // Engagement where it is known: a reply, or an open / read receipt on any message.
  const opens = rows
    .map((row) => row.opened_at ?? row.read_at)
    .filter((at): at is string => Boolean(at))
    .sort();
  const lastOpen = opens.length ? opens[opens.length - 1] : null;
  const lastEngagedAt = [lastInboundAt, lastOpen].filter((at): at is string => Boolean(at)).sort().pop() ?? null;

  const leadRow = (lead.data ?? null) as { intent_state: string | null; created_at: string | null } | null;
  const monthAgo = input.now.getTime() - MONTH_MS;
  return {
    automatedSentAt: automated.map((row) => row.sent_at as string).filter((at) => Date.parse(at) >= monthAgo),
    touchesSinceEngagement: touchesSinceEngagement({
      automatedSentAt: automated.map((row) => row.sent_at as string),
      lastEngagedAt,
    }),
    intentState: leadRow?.intent_state ?? null,
    leadCreatedAt: leadRow?.created_at ?? null,
    lastInboundAt,
  };
}

/* ------------------------------------------------------------ verdicts --- */

/**
 * The frequency verdict for one prospective automated touch to a lead, taken
 * now. Exported for the direct-sale agent's abandoned-checkout nudges and for
 * any future loop: call it before queueing, act on `defer` by scheduling for
 * `at`, on `skip` by not sending and recording `reason`. The send gate
 * re-checks it at the moment of sending, so calling it is courtesy, not the
 * enforcement.
 */
export async function checkAutomatedTouchAllowed(input: {
  businessId: string;
  leadId: string;
  /** Which loop the touch belongs to; `sequence` steps get the enquiry window. */
  loop?: LoopKey;
  at?: Date;
  /** Already-loaded settings, to save a read in a loop. */
  settings?: ReengagementSettings;
}): Promise<FrequencyVerdict> {
  const now = input.at ?? new Date();
  const [settings, history] = await Promise.all([
    input.settings ? Promise.resolve(input.settings) : loadReengagementSettings(input.businessId),
    loadContactHistory({ businessId: input.businessId, leadId: input.leadId, now, includeQueued: true }),
  ]);
  return evaluateFrequency({
    now,
    automatedSentAt: history.automatedSentAt,
    caps: settings.caps,
    touchesSinceEngagement: history.touchesSinceEngagement,
    intentState: history.intentState,
    inEnquiryWindow: inEnquiryWindow({ loop: input.loop ?? "sequence", leadCreatedAt: history.leadCreatedAt, now }),
  });
}

/**
 * The send gate's frequency check for one queued message. Null = not an
 * automated touch, or within the caps: carry on to the policy engine.
 */
export async function frequencyGateForMessage(input: {
  message: {
    id: string;
    businessId: string;
    leadId: string;
    origin: string;
    sendKey: string;
  };
  at: Date;
}): Promise<{ gate: Exclude<PolicyGate, { action: "allow" }>; loop: LoopKey; deadLead: boolean } | null> {
  const { message, at } = input;
  // Cheap exits first: a person's message, a system message or a handover
  // acknowledgement never needs the history read.
  if (message.origin === "manual" || message.origin === "system" || message.origin === "agent_handover") return null;

  const { data: row, error } = await db()
    .from("messages")
    .select("origin, send_key, agent_run_id, campaign_id")
    .eq("id", message.id)
    .maybeSingle();
  if (error) throw new Error(`frequency gate: message read failed: ${error.message}`);
  const [touch] = await classifyRows(message.businessId, [
    (row as OutboundRow | null) ?? { origin: message.origin, send_key: message.sendKey, agent_run_id: null, campaign_id: null },
  ]);
  if (!touch.automated) return null;

  const [settings, history] = await Promise.all([
    loadReengagementSettings(message.businessId),
    loadContactHistory({ businessId: message.businessId, leadId: message.leadId, now: at, excludeMessageId: message.id }),
  ]);
  const verdict = evaluateFrequency({
    now: at,
    automatedSentAt: history.automatedSentAt,
    caps: settings.caps,
    touchesSinceEngagement: history.touchesSinceEngagement,
    intentState: history.intentState,
    inEnquiryWindow: inEnquiryWindow({ loop: touch.loop, leadCreatedAt: history.leadCreatedAt, now: at }),
  });

  if (verdict.action === "allow") return null;
  if (verdict.action === "defer") {
    return {
      gate: { action: "defer", at: verdict.at, reasonCode: "BLOCKED_CONTACT_FREQUENCY" },
      loop: touch.loop,
      deadLead: false,
    };
  }
  return {
    gate: {
      action: "block",
      reasonCode: verdict.reason === "dead_lead" ? "BLOCKED_DEAD_LEAD" : "BLOCKED_CONTACT_FREQUENCY",
      message: verdict.message,
    },
    loop: touch.loop,
    deadLead: verdict.reason === "dead_lead",
  };
}
