import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { archetypeFor } from "@/lib/sales-library/archetypes";
import { stagesForMotion } from "@/lib/opportunities/stages";
import { getWorkspaceMembers } from "./queries";
import type { WorkspaceMember } from "./types";
import { hasWhatsAppOptIn } from "./whatsapp-opt-in";
import {
  firstAndLastTouch,
  parseScoreDimensions,
  parseScoreMissing,
  qualificationBuckets,
  type DimensionView,
  type QualificationBuckets,
} from "./detail-page";

/**
 * Reads for the lead detail page (`/app/leads/[id]`).
 *
 * Tables a member may read under RLS (leads, lead_scores, lead_tags,
 * opportunities, lead_touches, qualification_*) are read with the member's own
 * session. The audit trail, the event outbox and the AI run logs are not
 * browser-readable, so those use the service role, always filtered by the
 * business id the page resolved from the session and by this lead's id.
 *
 * Every loader throws on a failed read. A tab shows its error state; it never
 * turns a failed read into "no history", which would be a fabricated answer.
 */

function fail(what: string, error: { message: string }): never {
  throw new Error(`lead page: ${what}: ${error.message}`);
}

/* ------------------------------------------------------------------ header */

export type LeadPageLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  status: string;
  qualification_state: string;
  assigned_user_id: string | null;
  human_takeover: boolean;
  automation_active: boolean;
  opted_out: boolean;
  needs_attention: boolean;
  attention_reason: string | null;
  archived_at: string | null;
  anonymised_at: string | null;
  created_at: string;
  estimated_value: number | null;
};

export type CurrentScore = {
  total: number;
  grade: string;
  confidence: number;
  why: string;
  dimensions: DimensionView[];
  missing: { dimension: string; label: string }[];
  motion: string | null;
  scoredAt: string;
  trigger: string;
};

export type LeadTagView = { tag: string; reason: string; confidence: number; setAt: string };

export type LeadOpportunityView = {
  id: string;
  name: string;
  stage: string;
  outcome: string;
  outcomeReason: string | null;
  value: number | null;
  currency: string;
  motion: string | null;
  stagesAvailable: string[];
};

export type LeadPageHeader = {
  lead: LeadPageLead;
  owner: WorkspaceMember | null;
  members: WorkspaceMember[];
  score: CurrentScore | null;
  archetype: { key: string; name: string } | null;
  tags: LeadTagView[];
  opportunity: LeadOpportunityView | null;
};

/**
 * The header, or null when the lead does not exist in this workspace. Cached
 * per request: the page and its metadata both ask for it.
 */
export const loadLeadPageHeader = cache(async function loadLeadPageHeader(
  businessId: string,
  leadId: string,
): Promise<LeadPageHeader | null> {
  const supabase = await createClient();

  const { data: lead, error } = await supabase
    .from("leads")
    .select(
      "id, first_name, last_name, email, phone, company_name, status, qualification_state, assigned_user_id, human_takeover, automation_active, opted_out, needs_attention, attention_reason, archived_at, anonymised_at, created_at, estimated_value",
    )
    .eq("business_id", businessId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) fail("lead", error);
  if (!lead) return null;

  const [score, tags, opportunity, members] = await Promise.all([
    supabase
      .from("lead_scores")
      .select("total, grade, confidence, why, dimensions, missing, archetype_key, motion, created_at, trigger_event")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .eq("is_current", true)
      .maybeSingle(),
    supabase
      .from("lead_tags")
      .select("tag, reason, confidence, set_at")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .is("cleared_at", null)
      .order("set_at", { ascending: false }),
    supabase
      .from("opportunities")
      .select("id, name, stage, outcome, outcome_reason, value, currency, motion")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getWorkspaceMembers(businessId),
  ]);
  if (score.error) fail("current score", score.error);
  if (tags.error) fail("tags", tags.error);
  if (opportunity.error) fail("opportunity", opportunity.error);

  const s = score.data;
  const archetypeKey = s?.archetype_key ?? null;
  const archetype = archetypeKey
    ? { key: archetypeKey, name: archetypeFor(archetypeKey)?.name ?? archetypeKey }
    : null;
  const o = opportunity.data;

  return {
    lead,
    owner: members.find((member) => member.userId === lead.assigned_user_id) ?? null,
    members,
    score: s
      ? {
          total: Number(s.total),
          grade: s.grade,
          confidence: Number(s.confidence),
          why: s.why,
          dimensions: parseScoreDimensions(s.dimensions),
          missing: parseScoreMissing(s.missing),
          motion: s.motion,
          scoredAt: s.created_at,
          trigger: s.trigger_event,
        }
      : null,
    archetype,
    tags: (tags.data ?? []).map((row) => ({
      tag: row.tag,
      reason: row.reason,
      confidence: Number(row.confidence),
      setAt: row.set_at,
    })),
    opportunity: o
      ? {
          id: o.id,
          name: o.name,
          stage: o.stage,
          outcome: o.outcome,
          outcomeReason: o.outcome_reason,
          value: o.value === null ? null : Number(o.value),
          currency: o.currency,
          motion: o.motion,
          stagesAvailable: [...stagesForMotion(o.motion)],
        }
      : null,
  };
});

/* ----------------------------------------------------------- score history */

export type ScoreHistoryRow = {
  id: string;
  total: number;
  grade: string;
  confidence: number;
  why: string;
  trigger: string;
  isCurrent: boolean;
  scoringVersion: string;
  createdAt: string;
};

export async function loadScoreHistory(businessId: string, leadId: string): Promise<ScoreHistoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_scores")
    .select("id, total, grade, confidence, why, trigger_event, is_current, scoring_version, created_at")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) fail("score history", error);
  return (data ?? []).map((row) => ({
    id: row.id,
    total: Number(row.total),
    grade: row.grade,
    confidence: Number(row.confidence),
    why: row.why,
    trigger: row.trigger_event,
    isCurrent: row.is_current,
    scoringVersion: row.scoring_version,
    createdAt: row.created_at,
  }));
}

/* ----------------------------------------------------------- qualification */

export async function loadQualification(businessId: string, leadId: string): Promise<QualificationBuckets> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const [questions, answers, extractions] = await Promise.all([
    supabase
      .from("qualification_questions")
      .select("id, question_text, required, active, position")
      .eq("business_id", businessId)
      .order("position"),
    supabase
      .from("qualification_answers")
      .select("question_id, answer_text, answer_value, evaluation, source, confidence, answered_at")
      .eq("business_id", businessId)
      .eq("lead_id", leadId),
    admin
      .from("conversation_agent_extractions")
      .select("field, value_json, confidence, created_at")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .eq("accepted", true)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (questions.error) fail("questions", questions.error);
  if (answers.error) fail("answers", answers.error);
  if (extractions.error) fail("extractions", extractions.error);

  // The newest accepted extraction per field is what the assistant holds now.
  const seen = new Set<string>();
  const latest = (extractions.data ?? []).filter((row) => {
    if (seen.has(row.field)) return false;
    seen.add(row.field);
    return true;
  });

  return qualificationBuckets(
    (questions.data ?? []).map((q) => ({
      id: q.id,
      question: q.question_text,
      required: q.required,
      active: q.active,
    })),
    (answers.data ?? []).map((a) => ({
      questionId: a.question_id,
      value: a.answer_text ?? a.answer_value,
      evaluation: a.evaluation,
      source: a.source,
      confidence: a.confidence === null ? null : Number(a.confidence),
      answeredAt: a.answered_at,
    })),
    latest.map((e) => ({
      field: e.field,
      value: e.value_json,
      confidence: e.confidence === null ? null : Number(e.confidence),
      createdAt: e.created_at,
    })),
  );
}

/* ------------------------------------------------------------- attribution */

export type TouchView = {
  id: string;
  occurredAt: string;
  receivedAt: string;
  sourceType: string;
  provider: string;
  campaign: string | null;
  form: string | null;
  ad: string | null;
  utm: string | null;
  landingUrl: string | null;
  referrer: string | null;
  outcome: string;
};

export type AttributionView = { touches: TouchView[]; first: TouchView | null; last: TouchView | null };

export async function loadAttribution(businessId: string, leadId: string): Promise<AttributionView> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_touches")
    .select(
      "id, occurred_at, received_at, source_type, provider, campaign_name, form_name, ad_name, utm_source, utm_medium, utm_campaign, landing_url, referrer, ingest_outcome",
    )
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .order("occurred_at", { ascending: true })
    .limit(200);
  if (error) fail("touches", error);

  const touches: TouchView[] = (data ?? []).map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    sourceType: row.source_type,
    provider: row.provider,
    campaign: row.campaign_name,
    form: row.form_name,
    ad: row.ad_name,
    utm: [row.utm_source, row.utm_medium, row.utm_campaign].filter(Boolean).join(" / ") || null,
    landingUrl: row.landing_url,
    referrer: row.referrer,
    outcome: row.ingest_outcome,
  }));
  return { touches, ...firstAndLastTouch(touches) };
}

/* ------------------------------------------------------ activity and audit */

export type ActivityRow = {
  id: string;
  at: string;
  kind: "AUDIT" | "EVENT" | "NOTE";
  label: string;
  actor: string | null;
  detail: string | null;
};

function humanise(code: string): string {
  const text = code.replace(/[._]/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export async function loadActivity(businessId: string, leadId: string): Promise<ActivityRow[]> {
  const admin = createAdminClient();
  const supabase = await createClient();
  const [audit, events, notes, members] = await Promise.all([
    admin
      .from("audit_log")
      .select("id, action, actor_type, actor_user_id, created_at, metadata")
      .eq("business_id", businessId)
      .or(`entity_id.eq.${leadId},metadata->>lead_id.eq.${leadId}`)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("domain_events")
      .select("id, type, occurred_at, payload")
      .eq("business_id", businessId)
      .or(`subject_id.eq.${leadId},payload->>lead_id.eq.${leadId}`)
      .order("occurred_at", { ascending: false })
      .limit(100),
    supabase
      .from("lead_notes")
      .select("id, body, author_user_id, author_kind, created_at")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(100),
    getWorkspaceMembers(businessId),
  ]);
  if (audit.error) fail("audit", audit.error);
  if (events.error) fail("events", events.error);
  if (notes.error) fail("notes", notes.error);

  const nameOf = (userId: string | null) =>
    userId ? (members.find((m) => m.userId === userId)?.name ?? "A former member") : null;

  const rows: ActivityRow[] = [
    ...(audit.data ?? []).map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const via = typeof meta.caller === "string" && meta.caller !== "UI" ? meta.caller : null;
      const who = nameOf(row.actor_user_id) ?? (row.actor_type === "system" ? "ClientTurn" : null);
      return {
        id: `audit:${row.id}`,
        at: row.created_at,
        kind: "AUDIT" as const,
        label: humanise(row.action),
        actor: who && via ? `${who} via ${via}` : (who ?? (via ? `Via ${via}` : null)),
        detail: null,
      };
    }),
    ...(events.data ?? []).map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const reason = typeof payload.reason === "string" ? payload.reason : null;
      return {
        id: `event:${row.id}`,
        at: row.occurred_at,
        kind: "EVENT" as const,
        label: humanise(row.type),
        actor: null,
        detail: reason,
      };
    }),
    ...(notes.data ?? []).map((row) => ({
      id: `note:${row.id}`,
      at: row.created_at,
      kind: "NOTE" as const,
      label: "Note added",
      actor:
        nameOf(row.author_user_id) ??
        (row.author_kind && row.author_kind !== "UI" ? humanise(row.author_kind) : null),
      detail: row.body,
    })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/* ---------------------------------------------------------------------- AI */

export type AgentRunView = {
  id: string;
  at: string;
  status: string;
  outcome: string | null;
  intent: string | null;
  model: string | null;
  costUsd: number;
  method: string | null;
  methodReason: string | null;
  evidenceGrade: string | null;
};

export type AiRunView = {
  id: string;
  at: string;
  task: string;
  status: string;
  tokens: number;
  costUsd: number;
};

export type LeadAiView = {
  agentRuns: AgentRunView[];
  aiRuns: AiRunView[];
  /** Sum of every recorded AI call for this lead, in USD as metered. */
  totalCostUsd: number;
};

function strategyOf(decision: unknown): { method: string | null; reason: string | null; grade: string | null } {
  const strategy =
    decision && typeof decision === "object" ? (decision as { strategy?: unknown }).strategy : null;
  if (!strategy || typeof strategy !== "object") return { method: null, reason: null, grade: null };
  const s = strategy as Record<string, unknown>;
  return {
    method: typeof s.method === "string" ? s.method : null,
    reason: typeof s.reason === "string" ? s.reason : null,
    grade: typeof s.evidenceGrade === "string" ? s.evidenceGrade : null,
  };
}

export async function loadLeadAi(businessId: string, leadId: string): Promise<LeadAiView> {
  const admin = createAdminClient();
  const [agentRuns, aiRuns] = await Promise.all([
    admin
      .from("conversation_agent_runs")
      .select("id, created_at, status, outcome, detected_intent, model_name, estimated_cost_usd, decision_json")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("ai_runs")
      .select("id, created_at, task_type, status, input_tokens, output_tokens, estimated_cost_usd")
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (agentRuns.error) fail("agent runs", agentRuns.error);
  if (aiRuns.error) fail("ai runs", aiRuns.error);

  const ai = (aiRuns.data ?? []).map((row) => ({
    id: row.id,
    at: row.created_at,
    task: row.task_type,
    status: row.status,
    tokens: (row.input_tokens ?? 0) + (row.output_tokens ?? 0),
    costUsd: Number(row.estimated_cost_usd) || 0,
  }));

  return {
    agentRuns: (agentRuns.data ?? []).map((row) => {
      const strategy = strategyOf(row.decision_json);
      return {
        id: row.id,
        at: row.created_at,
        status: row.status,
        outcome: row.outcome,
        intent: row.detected_intent,
        model: row.model_name,
        costUsd: Number(row.estimated_cost_usd) || 0,
        method: strategy.method,
        methodReason: strategy.reason,
        evidenceGrade: strategy.grade,
      };
    }),
    aiRuns: ai,
    totalCostUsd: ai.reduce((sum, row) => sum + row.costUsd, 0),
  };
}

/* ------------------------------------------------------------- data rights */

export type DataRightsHistoryRow = {
  id: string;
  action: string;
  at: string;
  reason: string | null;
  caller: string | null;
  by: string | null;
};

export async function loadDataRightsHistory(
  businessId: string,
  leadId: string,
): Promise<DataRightsHistoryRow[]> {
  const admin = createAdminClient();
  const [{ data, error }, members] = await Promise.all([
    admin
      .from("data_rights_actions")
      .select("id, action, performed_at, reason, caller, requested_by")
      .eq("business_id", businessId)
      .eq("subject_type", "LEAD")
      .eq("subject_id", leadId)
      .order("performed_at", { ascending: false })
      .limit(50),
    getWorkspaceMembers(businessId),
  ]);
  if (error) fail("data rights history", error);
  return (data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    at: row.performed_at,
    reason: row.reason,
    caller: row.caller,
    by: row.requested_by ? (members.find((m) => m.userId === row.requested_by)?.name ?? null) : null,
  }));
}

/* ------------------------------------------------------ whatsapp opt-in */

export type WhatsAppOptInView = {
  /** WhatsApp only goes to a mobile the person gave; no mobile, no control. */
  hasMobile: boolean;
  optedIn: boolean;
  /** From the latest recorded opt-in, when a person recorded one. */
  optedInOn: string | null;
  source: string | null;
};

/**
 * The lead's WhatsApp opt-in: whether the permission scope holds it, and the
 * date and source of the latest one a person recorded (the audit row of
 * `lead.record_whatsapp_opt_in` is where that evidence lives).
 */
export async function loadWhatsAppOptIn(businessId: string, leadId: string): Promise<WhatsAppOptInView> {
  const admin = createAdminClient();
  const [lead, permission, audit] = await Promise.all([
    admin.from("leads").select("phone").eq("business_id", businessId).eq("id", leadId).maybeSingle(),
    admin
      .from("contact_permissions")
      .select("consent_scope")
      .eq("business_id", businessId)
      .eq("subject_type", "LEAD")
      .eq("subject_id", leadId)
      .maybeSingle(),
    admin
      .from("audit_log")
      .select("metadata")
      .eq("business_id", businessId)
      .eq("entity_id", leadId)
      .eq("action", "lead.record_whatsapp_opt_in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (lead.error) throw new Error(`lead read failed: ${lead.error.message}`);
  if (permission.error) throw new Error(`permission read failed: ${permission.error.message}`);
  if (audit.error) throw new Error(`audit read failed: ${audit.error.message}`);

  const after = ((audit.data?.metadata ?? {}) as { after?: { opted_in_on?: unknown; source?: unknown } }).after;
  return {
    hasMobile: Boolean(lead.data?.phone),
    optedIn: hasWhatsAppOptIn(permission.data?.consent_scope),
    optedInOn: typeof after?.opted_in_on === "string" ? after.opted_in_on : null,
    source: typeof after?.source === "string" ? after.source : null,
  };
}
