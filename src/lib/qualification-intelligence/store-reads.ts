import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadEngineMode } from "./service";
import {
  QUALIFICATION_POLICY_KIND,
  WORKSPACE_POLICY_KEY,
  type IntentState,
  type NbaAction,
  type QiEngineMode,
  type QualificationFact,
  type QualificationPolicy,
  type SignalCategory,
  type SignalPolarity,
  type SignalSource,
  type SignalType,
} from "./types";
import {
  QUALIFICATION_AUDIT_ACTIONS,
  historyRow,
  isEngineMode,
  parseAssessmentRow,
  toFact,
  type AssessmentRow,
  type AssessmentView,
  type FactRow,
  type OverrideHistoryRow,
} from "./explain";
import { parseQualificationPolicy } from "@/lib/settings/ai-selling";

/**
 * The thin read layer over the 0134 tables that the Lead page, the
 * `qualification.*` registry operations and Settings share.
 *
 * Service role, and every query is hard-scoped to the business id the caller
 * resolved (from the session, an API key or an MCP grant) and, where it applies,
 * to the lead. The tables are also member-readable under RLS; the service role
 * is used so an MCP or API caller, which has no browser session, reads exactly
 * what the page reads.
 *
 * Writes are not here: signals, facts and assessments are written by the
 * assessment service and by the registry operations, the latter only through
 * `record_lead_assessment()` for assessments.
 *
 * A failed read throws. A surface shows its error state rather than turning a
 * failed read into "not assessed", which would be a fabricated answer.
 */

function fail(what: string, error: { message: string }): never {
  throw new Error(`qualification intelligence: ${what}: ${error.message}`);
}

const ASSESSMENT_COLUMNS =
  "id, lead_id, intent_state, intent_score, intent_categories, intent_evidence, intent_contradictions, intent_confidence, valid_until, goal, qualification_completeness, dimension_status, nba, engine_version, engine_mode, legacy_decision, trigger_event, created_at";

export async function readCurrentAssessment(businessId: string, leadId: string): Promise<AssessmentView | null> {
  const { data, error } = await createAdminClient()
    .from("lead_assessments")
    .select(ASSESSMENT_COLUMNS)
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) fail("current assessment", error);
  return data ? parseAssessmentRow(data as unknown as AssessmentRow) : null;
}

export type AssessmentHistoryRow = {
  id: string;
  createdAt: string;
  intentState: IntentState;
  intentScore: number;
  completeness: number;
  nextAction: NbaAction | null;
  trigger: string;
  engineMode: string;
  manual: boolean;
};

export async function readAssessmentHistory(businessId: string, leadId: string, limit = 20): Promise<AssessmentHistoryRow[]> {
  const { data, error } = await createAdminClient()
    .from("lead_assessments")
    .select(ASSESSMENT_COLUMNS)
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail("assessment history", error);
  const out: AssessmentHistoryRow[] = [];
  for (const row of (data ?? []) as unknown as AssessmentRow[]) {
    const view = parseAssessmentRow(row);
    if (!view) continue;
    out.push({
      id: view.id,
      createdAt: view.createdAt,
      intentState: view.intentState,
      intentScore: view.intentScore,
      completeness: view.completeness,
      nextAction: view.nba?.next_action ?? null,
      trigger: view.triggerEvent,
      engineMode: view.engineMode,
      manual: view.manualOverride !== null,
    });
  }
  return out;
}

const FACT_COLUMNS =
  "id, lead_id, service_id, dimension, value, value_normalised, state, source, source_ref, question_id, question_intent_key, confidence, observed_at, valid_until, verified_at, set_by, superseded_at";

/** Every fact not superseded, REJECTED included (a person's "no" is shown, and not re-made). */
export async function readLiveFacts(businessId: string, leadId: string): Promise<QualificationFact[]> {
  const { data, error } = await createAdminClient()
    .from("lead_qualification_facts")
    .select(FACT_COLUMNS)
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .is("superseded_at", null)
    .order("observed_at", { ascending: false })
    .limit(200);
  if (error) fail("facts", error);
  return ((data ?? []) as unknown as FactRow[]).map(toFact);
}

/** One fact by id, inside this workspace and lead. */
export async function readFact(businessId: string, leadId: string, factId: string): Promise<QualificationFact | null> {
  const { data, error } = await createAdminClient()
    .from("lead_qualification_facts")
    .select(FACT_COLUMNS)
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .eq("id", factId)
    .maybeSingle();
  if (error) fail("fact", error);
  return data ? toFact(data as unknown as FactRow) : null;
}

export type SignalView = {
  id: string;
  type: SignalType;
  category: SignalCategory;
  polarity: SignalPolarity;
  strength: number;
  confidence: number;
  source: SignalSource;
  observedAt: string;
  expiresAt: string | null;
  resumeAt: string | null;
  reason: string;
  /** Verbatim, capped. Personal data: shown on the Lead page, not returned to Copilot. */
  excerpt: string | null;
  retracted: boolean;
};

export async function readSignals(businessId: string, leadId: string, limit = 15): Promise<SignalView[]> {
  const { data, error } = await createAdminClient()
    .from("lead_intent_signals")
    .select("id, signal_type, category, polarity, strength, confidence, source, observed_at, expires_at, resume_at, reason, evidence_excerpt, retracted_at")
    .eq("business_id", businessId)
    .eq("lead_id", leadId)
    .order("observed_at", { ascending: false })
    .limit(limit);
  if (error) fail("signals", error);
  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.signal_type as SignalType,
    category: row.category as SignalCategory,
    polarity: row.polarity as SignalPolarity,
    strength: Number(row.strength) || 0,
    confidence: Number(row.confidence) || 0,
    source: row.source as SignalSource,
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
    resumeAt: row.resume_at,
    reason: row.reason,
    excerpt: row.evidence_excerpt,
    retracted: row.retracted_at !== null,
  }));
}

/* ------------------------------------------------------------------ policy */

export type PolicySet = {
  workspace: QualificationPolicy;
  /** Keyed by service id. */
  services: Record<string, QualificationPolicy>;
  /** Stored payloads that did not validate (read as empty; shown as a warning). */
  invalidKeys: string[];
  updatedAt: Record<string, string>;
};

export async function readPolicies(businessId: string): Promise<PolicySet> {
  const { data, error } = await createAdminClient()
    .from("workspace_sales_overrides")
    .select("key, payload, updated_at")
    .eq("business_id", businessId)
    .eq("kind", QUALIFICATION_POLICY_KIND);
  if (error) fail("qualification policy", error);
  const set: PolicySet = { workspace: {}, services: {}, invalidKeys: [], updatedAt: {} };
  for (const row of data ?? []) {
    const policy = parseQualificationPolicy(row.payload);
    const empty = Object.keys(policy).length === 0;
    const raw = row.payload && typeof row.payload === "object" ? Object.keys(row.payload as object).length : 0;
    if (empty && raw > 0) set.invalidKeys.push(row.key);
    set.updatedAt[row.key] = row.updated_at;
    if (row.key === WORKSPACE_POLICY_KEY) set.workspace = policy;
    else if (row.key.startsWith("service:")) set.services[row.key.slice("service:".length)] = policy;
  }
  return set;
}

export async function readPolicy(businessId: string, scope: string): Promise<{ policy: QualificationPolicy; exists: boolean }> {
  const { data, error } = await createAdminClient()
    .from("workspace_sales_overrides")
    .select("payload")
    .eq("business_id", businessId)
    .eq("kind", QUALIFICATION_POLICY_KIND)
    .eq("key", scope)
    .maybeSingle();
  if (error) fail("qualification policy", error);
  return { policy: data ? parseQualificationPolicy(data.payload) : {}, exists: Boolean(data) };
}

/**
 * The workspace's effective engine mode (CD-9), resolved by the assessment
 * service exactly as the engine resolves it, plus whether a value is stored
 * (so Settings can say "default").
 */
export async function readEngineMode(businessId: string): Promise<{ mode: QiEngineMode; stored: boolean }> {
  const [mode, { policy }] = await Promise.all([
    loadEngineMode(businessId),
    readPolicy(businessId, WORKSPACE_POLICY_KEY),
  ]);
  return { mode, stored: isEngineMode(policy.engineMode) };
}

/* ----------------------------------------------------------------- history */

/**
 * The lead's qualification history: every `qualification.*` write the runtime
 * audited against this lead (requalify, fact changes, overrides), with who did
 * it and through which caller.
 */
export async function readQualificationHistory(
  businessId: string,
  leadId: string,
  nameOf: (userId: string | null) => string | null,
): Promise<OverrideHistoryRow[]> {
  const { data, error } = await createAdminClient()
    .from("audit_log")
    .select("id, action, actor_type, actor_user_id, created_at, metadata")
    .eq("business_id", businessId)
    .eq("entity_id", leadId)
    .in("action", [...QUALIFICATION_AUDIT_ACTIONS])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) fail("qualification history", error);
  return (data ?? []).map((row) =>
    historyRow({
      id: row.id,
      action: row.action,
      created_at: row.created_at,
      actor: nameOf(row.actor_user_id) ?? (row.actor_type === "system" ? "ClientTurn" : null),
      metadata: row.metadata,
    }),
  );
}

/** The lead's engine verdict and service, for the status read. */
export async function readLeadQualificationState(
  businessId: string,
  leadId: string,
): Promise<{ id: string; qualificationState: string; serviceId: string | null; archived: boolean; anonymised: boolean } | null> {
  const { data, error } = await createAdminClient()
    .from("leads")
    .select("id, qualification_state, service_id, archived_at, anonymised_at")
    .eq("business_id", businessId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) fail("lead", error);
  if (!data) return null;
  return {
    id: data.id,
    qualificationState: data.qualification_state,
    serviceId: data.service_id,
    archived: data.archived_at !== null,
    anonymised: data.anonymised_at !== null,
  };
}
