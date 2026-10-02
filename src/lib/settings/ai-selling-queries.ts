import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SALES_MOTIONS, type SalesMotion } from "@/lib/sales-library/types";
import {
  DEFAULT_SELLING_PREFERENCES,
  EDITABLE_BUDGET_SCOPES,
  parseSellingPreferences,
  phrasesFromAvoid,
  type EditableBudgetScope,
  type LiaRow,
  type SalesSettingsView,
  type SellingPreferences,
  defaultScoringWeights,
  parseScoringWeights,
} from "./ai-selling";
import type { DimensionWeights } from "@/lib/sales-library/types";
import { logWriteError } from "@/lib/supabase/write-result";
import { ARCHETYPES } from "@/lib/sales-library/archetypes";
import { QUESTION_INTENTS } from "@/lib/qualification-intelligence/question-intents";
import {
  LIBRARY_INTENT_KEY_PATTERN,
  parseOfferProfile,
  type OfferProfile,
  type QiEngineMode,
  type QualificationPolicy,
} from "@/lib/qualification-intelligence/types";
import { readEngineMode, readPolicies } from "@/lib/qualification-intelligence/store-reads";
import { canSeeEngineMode, policyForRole } from "./ai-selling";
import {
  EMPTY_WORKSPACE_OBJECTIONS,
  parseWorkspaceObjectionRows,
  type WorkspaceObjectionSet,
} from "@/lib/sales-library/workspace-objections";
import { creditLimitFromRow, platformDefaultCredits, type CeilingRow } from "@/lib/ai/credit-limits";

/**
 * Reads behind Settings -> AI & selling and the `sales_settings.get`
 * operation. Service-role, and hard-scoped to the business id the caller
 * resolved from the session: `ai_budgets` platform rows, `industry_codes` and
 * `workspace_sales_overrides` writes are server-side only.
 *
 * A failed read throws. The section shows an error state rather than a form
 * pre-filled with defaults that would silently overwrite real settings on save.
 */

export const SIC_SYSTEM = "uk_sic_2026";

export async function loadSalesSettings(businessId: string): Promise<SalesSettingsView> {
  const db = createAdminClient();
  const [profile, override] = await Promise.all([
    db
      .from("business_profiles")
      .select(
        "primary_industry_system, primary_industry_code, archetype_key, classification_source, sales_motions, library_version, outreach_tone, outreach_value_proposition, outreach_key_messages, outreach_proof_points, outreach_call_to_action, outreach_claim_restrictions, outreach_avoid",
      )
      .eq("business_id", businessId)
      .maybeSingle(),
    db
      .from("workspace_sales_overrides")
      .select("payload")
      .eq("business_id", businessId)
      .eq("kind", "ARCHETYPE_SETTINGS")
      .eq("key", "*")
      .maybeSingle(),
  ]);
  if (profile.error) throw new Error(`business_profiles read: ${profile.error.message}`);
  if (override.error) throw new Error(`workspace_sales_overrides read: ${override.error.message}`);

  const row = profile.data;
  let primaryIndustry: SalesSettingsView["primaryIndustry"] = null;
  if (row?.primary_industry_system && row.primary_industry_code) {
    const { data, error } = await db
      .from("industry_codes")
      .select("title")
      .eq("system", row.primary_industry_system)
      .eq("code", row.primary_industry_code)
      .maybeSingle();
    if (error) throw new Error(`industry_codes read: ${error.message}`);
    primaryIndustry = {
      system: row.primary_industry_system,
      code: row.primary_industry_code,
      title: data?.title ?? null,
    };
  }

  return {
    primaryIndustry,
    archetypeKey: row?.archetype_key ?? null,
    classificationSource: row?.classification_source ?? null,
    salesMotions: (row?.sales_motions ?? []).filter((value): value is SalesMotion =>
      (SALES_MOTIONS as readonly string[]).includes(value),
    ),
    preferences: override.data ? parseSellingPreferences(override.data.payload) : { ...DEFAULT_SELLING_PREFERENCES },
    brand: {
      tone: row?.outreach_tone ?? "",
      valueProposition: row?.outreach_value_proposition ?? "",
      keyMessages: row?.outreach_key_messages ?? "",
      proofPoints: row?.outreach_proof_points ?? "",
      callToAction: row?.outreach_call_to_action ?? "",
      claimRestrictions: row?.outreach_claim_restrictions ?? "",
      forbiddenPhrases: phrasesFromAvoid(row?.outreach_avoid),
    },
    libraryVersion: row?.library_version ?? null,
  };
}

/**
 * The stored selling preferences, for the runtime paths that act on them
 * (qualification depth, preferred methods, risk tolerance, research depth,
 * example messages). Unlike `loadSalesSettings` this never throws: a failed
 * read is logged and the defaults apply, which is exactly the behaviour a
 * workspace that never saved the section gets.
 */
export async function loadSellingPreferencesOrDefault(businessId: string): Promise<SellingPreferences> {
  try {
    const result = await createAdminClient()
      .from("workspace_sales_overrides")
      .select("payload")
      .eq("business_id", businessId)
      .eq("kind", "ARCHETYPE_SETTINGS")
      .eq("key", "*")
      .maybeSingle();
    logWriteError(result, "workspace_sales_overrides.preferences read", { businessId });
    return result.data ? parseSellingPreferences(result.data.payload) : { ...DEFAULT_SELLING_PREFERENCES };
  } catch (error) {
    console.error("[selling-preferences] read threw; defaults apply", { businessId, error });
    return { ...DEFAULT_SELLING_PREFERENCES };
  }
}

/** Settings -> AI & selling -> Scoring weights: the override and the library default. */
export type ScoringWeightsView = {
  current: DimensionWeights;
  defaults: DimensionWeights;
  overridden: boolean;
};

export async function loadScoringWeightsView(
  businessId: string,
  archetypeKey: string | null,
  motion: SalesMotion | null,
): Promise<ScoringWeightsView> {
  const { data, error } = await createAdminClient()
    .from("workspace_sales_overrides")
    .select("payload")
    .eq("business_id", businessId)
    .eq("kind", "SCORING_WEIGHTS")
    .eq("key", "*")
    .maybeSingle();
  if (error) throw new Error(`workspace_sales_overrides read: ${error.message}`);
  const defaults = defaultScoringWeights(archetypeKey, motion);
  const stored = data ? parseScoringWeights(data.payload) : null;
  return { current: stored ?? defaults, defaults, overridden: stored !== null };
}

/* ---------------------------------------------------- qualification policy */

export type QualificationPolicyOffer = {
  id: string;
  name: string;
  active: boolean;
  policy: QualificationPolicy;
  /** services.offer_profile, read with parseOfferProfile (invalid => defaults). */
  offerProfile: OfferProfile;
  offerProfileValid: boolean;
};

export type QualificationPolicyView = {
  workspace: QualificationPolicy;
  offers: QualificationPolicyOffer[];
  invalidScopes: string[];
  /** Owners and admins only (CD-9). */
  engineMode: { mode: QiEngineMode; stored: boolean } | null;
  archetypes: { key: string; name: string }[];
  /** The question-intent library, for the Never ask / Also ask pickers. */
  intentOptions: QuestionIntentOption[];
};

export type QuestionIntentOption = { key: string; dimension: string; label: string };

/** The library question intents a policy or a mapping may name (A2's question-intents.ts). */
export function questionIntentOptions(): QuestionIntentOption[] {
  return QUESTION_INTENTS.filter((intent) => LIBRARY_INTENT_KEY_PATTERN.test(intent.key)).map((intent) => ({
    key: intent.key,
    dimension: intent.dimension,
    label: intent.renderings.default,
  }));
}

/**
 * Settings -> AI & selling -> Qualification policy: the QUALIFICATION_POLICY
 * rows ('*' and one per offer), each offer's profile, and the engine mode for
 * the roles allowed to see it. Throws on a failed read (the card shows its
 * error state rather than a blank form that would overwrite real settings).
 */
export async function loadQualificationPolicyView(businessId: string, role: string): Promise<QualificationPolicyView> {
  const db = createAdminClient();
  const [policies, services, engineMode] = await Promise.all([
    readPolicies(businessId),
    db.from("services").select("id, name, active, offer_profile").eq("business_id", businessId).order("name"),
    canSeeEngineMode(role) ? readEngineMode(businessId) : Promise.resolve(null),
  ]);
  if (services.error) throw new Error(`services read: ${services.error.message}`);
  return {
    workspace: policyForRole(policies.workspace, role),
    offers: (services.data ?? []).map((service) => {
      const offer = parseOfferProfile(service.offer_profile);
      return {
        id: service.id,
        name: service.name,
        active: service.active,
        policy: policies.services[service.id] ?? {},
        offerProfile: offer.profile,
        offerProfileValid: offer.valid,
      };
    }),
    invalidScopes: policies.invalidKeys,
    engineMode,
    archetypes: ARCHETYPES.map((a) => ({ key: a.key, name: a.name })),
    intentOptions: questionIntentOptions(),
  };
}

/* ----------------------------------------------------------------- budgets */

export type BudgetRowView = {
  scope: EditableBudgetScope;
  /** The workspace's own limit in AI credits; null = none set (default applies). */
  workspaceCredits: number | null;
  /** The platform default for this scope in AI credits; null = no default. */
  platformCredits: number | null;
};

/**
 * The customer's AI limits, in AI credits only. The plan's £ ceiling and the
 * platform's £ hard stop are admin-only (owner decision, 2026-09-30) and are
 * not part of this view.
 */
export type BudgetView = { rows: BudgetRowView[] };

type BudgetDbRow = {
  scope: string;
  business_id: string | null;
  ceiling_minor: number | null;
  ceiling_tokens: number | null;
  enabled: boolean;
};

function ceiling(row: BudgetDbRow | undefined): CeilingRow | null {
  return row ? { ceilingMinor: num(row.ceiling_minor), ceilingTokens: num(row.ceiling_tokens) } : null;
}

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

async function readEditableBudgetRows(businessId: string | null): Promise<BudgetDbRow[]> {
  const db = createAdminClient();
  let query = db
    .from("ai_budgets")
    .select("scope, business_id, ceiling_minor, ceiling_tokens, enabled")
    .in("scope", [...EDITABLE_BUDGET_SCOPES]);
  query = businessId === null ? query.is("business_id", null) : query.or(`business_id.is.null,business_id.eq.${businessId}`);
  const { data, error } = await query;
  if (error) throw new Error(`ai_budgets read: ${error.message}`);
  return ((data ?? []) as BudgetDbRow[]).filter((row) => row.enabled);
}

export async function loadBudgetView(businessId: string): Promise<BudgetView> {
  const rows = await readEditableBudgetRows(businessId);
  return {
    rows: EDITABLE_BUDGET_SCOPES.map((scope) => ({
      scope,
      // A row saved in pounds before credits existed reads back as credits.
      workspaceCredits: creditLimitFromRow(
        ceiling(rows.find((row) => row.business_id === businessId && row.scope === scope)),
      ),
      platformCredits: platformDefaultCredits(
        scope,
        ceiling(rows.find((row) => row.business_id === null && row.scope === scope)),
      ),
    })),
  };
}

/**
 * The platform default per editable scope, for the limit operation's checks:
 * in credits, plus the raw £ default the per-lead rows keep as a backstop.
 */
export async function platformBudgetDefaults(): Promise<{
  credits: Partial<Record<EditableBudgetScope, number | null>>;
  minor: Partial<Record<EditableBudgetScope, number | null>>;
}> {
  const rows = await readEditableBudgetRows(null);
  const credits: Partial<Record<EditableBudgetScope, number | null>> = {};
  const minor: Partial<Record<EditableBudgetScope, number | null>> = {};
  for (const scope of EDITABLE_BUDGET_SCOPES) {
    const row = rows.find((r) => r.scope === scope);
    credits[scope] = platformDefaultCredits(scope, ceiling(row));
    minor[scope] = row ? num(row.ceiling_minor) : null;
  }
  return { credits, minor };
}

/* --------------------------------------------------------------------- LIA */

export async function listLias(businessId: string): Promise<LiaRow[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("legitimate_interest_assessments")
    .select("id, purpose, necessity, balancing, safeguards, channels, status, reviewed_at, next_review_at")
    .eq("business_id", businessId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`legitimate_interest_assessments read: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    purpose: row.purpose,
    necessity: row.necessity,
    balancing: row.balancing,
    safeguards: row.safeguards,
    channels: row.channels,
    status: row.status,
    reviewedAt: row.reviewed_at,
    nextReviewAt: row.next_review_at,
  }));
}

/* ------------------------------------------------------------ send limits */

export type SenderLimitRow = {
  id: string;
  email: string;
  domain: string | null;
  status: string;
  dailySendCap: number;
  /** Sent today, or 0 when the counter belongs to an earlier day. */
  sentToday: number;
  pausedUntil: string | null;
  /** Paused now (pausedUntil is still ahead). */
  paused: boolean;
};

export type DomainHealthRow = {
  domain: string;
  spf: string;
  dkim: string;
  dmarc: string;
  dmarcPolicy: string | null;
  healthState: string;
  bounceRate: number;
  complaintRate: number;
  snapshotDate: string;
};

export type SenderHealth = { senders: SenderLimitRow[]; domains: DomainHealthRow[] };

/**
 * Sending identities with their daily caps, and the latest DNS/deliverability
 * snapshot per sending domain (domain_health_snapshots, written daily by the
 * domain-health job). A domain with no snapshot is simply absent: the UI says
 * "not checked yet" rather than inventing a pass.
 */
export async function loadSenderHealth(businessId: string, now: Date = new Date()): Promise<SenderHealth> {
  const db = createAdminClient();
  const [senders, snapshots] = await Promise.all([
    db
      .from("sender_identities")
      .select("id, email, domain, status, daily_send_cap, sent_today, sent_today_on, paused_until, active")
      .eq("business_id", businessId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(50),
    db
      .from("domain_health_snapshots")
      .select(
        "domain, spf_state, dkim_state, dmarc_state, dmarc_policy, health_state, bounce_rate, complaint_rate, snapshot_date",
      )
      .eq("business_id", businessId)
      .order("snapshot_date", { ascending: false })
      .limit(200),
  ]);
  if (senders.error) throw new Error(`sender_identities read: ${senders.error.message}`);
  if (snapshots.error) throw new Error(`domain_health_snapshots read: ${snapshots.error.message}`);

  const today = now.toISOString().slice(0, 10);
  const latest = new Map<string, DomainHealthRow>();
  for (const row of snapshots.data ?? []) {
    if (latest.has(row.domain)) continue;
    latest.set(row.domain, {
      domain: row.domain,
      spf: row.spf_state,
      dkim: row.dkim_state,
      dmarc: row.dmarc_state,
      dmarcPolicy: row.dmarc_policy,
      healthState: row.health_state,
      bounceRate: Number(row.bounce_rate) || 0,
      complaintRate: Number(row.complaint_rate) || 0,
      snapshotDate: row.snapshot_date,
    });
  }

  return {
    senders: (senders.data ?? [])
      .filter((row) => row.active)
      .map((row) => ({
        id: row.id,
        email: row.email,
        domain: row.domain,
        status: row.status,
        dailySendCap: row.daily_send_cap,
        sentToday: row.sent_today_on === today ? row.sent_today : 0,
        pausedUntil: row.paused_until,
        paused: row.paused_until !== null && Date.parse(row.paused_until) > now.getTime(),
      })),
    domains: [...latest.values()],
  };
}

/* -------------------------------------------------------------- objections */

/**
 * Settings -> AI & selling -> Objections: the workspace's own objections and
 * reassurance assets (`workspace_sales_overrides` kind OBJECTION). Throws on
 * a failed read, so the card shows its error state rather than an empty
 * editor that would look like nothing was saved.
 */
export async function loadWorkspaceObjections(businessId: string): Promise<WorkspaceObjectionSet> {
  const { data, error } = await createAdminClient()
    .from("workspace_sales_overrides")
    .select("key, payload")
    .eq("business_id", businessId)
    .eq("kind", "OBJECTION");
  if (error) throw new Error(`workspace_sales_overrides objections read: ${error.message}`);
  return parseWorkspaceObjectionRows(data ?? []);
}

/**
 * The same, for the conversation runtime. Never throws: a failed read is
 * logged and the generic library applies, exactly as for a workspace that
 * never entered any.
 */
export async function loadWorkspaceObjectionsOrEmpty(businessId: string): Promise<WorkspaceObjectionSet> {
  try {
    return await loadWorkspaceObjections(businessId);
  } catch (error) {
    console.error("[workspace-objections] read failed; the library applies", { businessId, error });
    return EMPTY_WORKSPACE_OBJECTIONS;
  }
}
