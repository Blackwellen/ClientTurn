import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_STEP_DELAYS_DAYS,
  MAX_SEQUENCE_STEPS,
  emptyDraft,
  parseDraft,
  type CampaignDraft,
  type SequenceStep,
  type WizardStepKey,
} from "../campaign-draft";
import type { CampaignStatus } from "../types";

/**
 * Draft persistence for the acquisition campaign wizard (V4 section 17.2).
 *
 * The draft is a real `outreach_campaigns` row in DRAFT status, not a blob in
 * session storage. Two reasons: someone who configures a campaign on a laptop
 * and finishes it on a phone should not lose it, and the launch gate has to
 * validate what is actually stored rather than what the browser last claimed.
 *
 * A DRAFT reserves nothing. `loadCommittedSpend` only counts READY and above,
 * so an abandoned draft never holds anyone's allowance hostage.
 */

const SECONDS = 1000;

export type DraftMeta = {
  id: string;
  status: CampaignStatus;
  step: WizardStepKey | null;
  updatedAt: string | null;
  createdBy: string | null;
};

export type LoadedDraft = { draft: CampaignDraft; meta: DraftMeta };

/** Creates an empty draft. Called the first time the wizard saves anything. */
export async function createDraft(input: {
  businessId: string;
  userId: string;
}): Promise<{ id: string } | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("outreach_campaigns")
    .insert({
      business_id: input.businessId,
      name: "Untitled campaign",
      status: "DRAFT",
      created_by: input.userId,
      draft_step: "goal",
      // Safety defaults, restated at insert rather than relied on from the
      // column defaults, so a schema change cannot quietly flip them.
      review_before_outreach: true,
      auto_optimize: false,
      auto_overage: false,
    })
    .select("id")
    .single();

  return data ? { id: data.id } : null;
}

/** Reads a stored campaign back into the wizard's shape. */
export async function loadDraft(
  businessId: string,
  campaignId: string,
): Promise<LoadedDraft | null> {
  const admin = createAdminClient();

  // `select("*")` rather than a column list, because PostgREST's generated
  // types reject the whole row when it names a column the last type generation
  // did not know about — and the send-window columns arrive with 0054. One row
  // is being read here, so the extra columns cost nothing, and reading
  // `max_cost_minor` from the same row saves a second round trip.
  const { data: row } = await admin
    .from("outreach_campaigns")
    .select("*")
    .eq("business_id", businessId)
    .eq("id", campaignId)
    .maybeSingle();

  if (!row) return null;

  // The send-window columns arrive with 0054, which post-dates the last
  // `database.types.ts` regeneration, so the generated row type does not know
  // about them yet. Read through a narrow view rather than casting the whole
  // row to `any`: everything else keeps its generated typing.
  const scheduling = row as unknown as {
    send_timezone: string | null;
    send_window_start: string | null;
    send_window_end: string | null;
    min_gap_days: number | null;
  };

  const steps = await loadSequenceSteps(businessId, campaignId);
  const blank = emptyDraft();
  const audience = (row.audience_json ?? {}) as Record<string, unknown>;
  const exclusions = (row.exclusions_json ?? {}) as Record<string, unknown>;
  const intentFilter = (row.intent_filter_json ?? {}) as Record<string, unknown>;

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

  const draft = parseDraft({
    goal: {
      campaignName: row.name === "Untitled campaign" ? "" : row.name,
      conversionGoal: row.conversion_goal_type,
      primaryServiceId: row.service_id,
      successEvent: row.success_event,
    },
    audience: {
      savedSearchId: row.search_session_id,
      icpProfileId: row.icp_profile_id,
      locations: strings(audience.locations),
      radiusMiles:
        typeof audience.radiusMiles === "number" ? audience.radiusMiles : null,
      industries: strings(audience.industries),
      companySizes: strings(audience.companySizes),
      roles: strings(audience.roles),
      source: row.prospect_source,
      exclusions: {
        // Always true on read. A stored `false` would not parse, and honouring
        // it would be worse than refusing it.
        globalSuppression: true,
        existingCustomers: exclusions.existingCustomers !== false,
        existingLeads: exclusions.existingLeads !== false,
        companies: strings(exclusions.companies),
      },
      namedCompanies: strings(row.named_companies),
    },
    intentScore: {
      minimumGrade: row.minimum_grade,
      intentCategoryIds: strings(intentFilter.categoryIds),
      intentRequired: row.intent_required,
      maxIntentAgeDays: row.max_intent_age_days ?? 30,
      reviewThreshold: row.review_threshold,
    },
    outreach: {
      senderIdentityId: row.sender_identity_id,
      timezone: scheduling.send_timezone ?? blank.outreach.timezone,
      sendWindow:
        scheduling.send_window_start && scheduling.send_window_end
          ? `${clock(scheduling.send_window_start)}-${clock(scheduling.send_window_end)}`
          : "",
      minGapDays: scheduling.min_gap_days ?? blank.outreach.minGapDays,
      steps: steps.length > 0 ? steps : blank.outreach.steps,
      variantsEnabled: row.variants_enabled,
      variantsPerStep: row.variants_per_step,
      replyRules: (row.reply_rules_json ?? {}) as Record<string, string>,
      promotionRule: row.promotion_rule,
      startMode: row.launch_mode,
    },
    budget: {
      prospectsPerRun: row.prospects_per_run,
      dailyContacts: row.daily_contact_cap,
      monthlyContacts: row.monthly_contact_cap,
      // `max_cost_minor` is withheld from the browser role; this module runs
      // as the service role, so it reads the column directly.
      providerCostCeilingMinor: Number(row.max_cost_minor ?? 0),
      communicationAllowance: row.communication_allowance,
      autoOverage: row.auto_overage,
      autoOptimize: row.auto_optimize,
    },
  });

  return {
    draft,
    meta: {
      id: row.id,
      status: row.status as CampaignStatus,
      step: (row.draft_step ?? null) as WizardStepKey | null,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
    },
  };
}

async function loadSequenceSteps(
  businessId: string,
  campaignId: string,
): Promise<SequenceStep[]> {
  const admin = createAdminClient();

  // The draft sequence is the one being edited. A published one belongs to
  // messages already sent and is never rewritten in place.
  const { data: sequence } = await admin
    .from("outreach_sequences")
    .select("id")
    .eq("business_id", businessId)
    .eq("campaign_id", campaignId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sequence) return [];

  const { data: steps } = await admin
    .from("outreach_steps")
    .select("position, delay_seconds, subject_template, body_template, enabled")
    .eq("business_id", businessId)
    .eq("sequence_id", sequence.id)
    .order("position", { ascending: true });

  return (steps ?? []).slice(0, MAX_SEQUENCE_STEPS).map((step) => ({
    position: step.position,
    delayDays: Math.round(Number(step.delay_seconds) / 86400),
    subject: step.subject_template ?? "",
    body: step.body_template ?? "",
    enabled: step.enabled,
  }));
}

/* ------------------------------------------------------------------ save */

export type SaveDraftResult =
  | { ok: true; id: string; savedAt: string }
  | { ok: false; error: string };

/**
 * Persists the whole draft.
 *
 * Written as one update plus a sequence rewrite rather than per-step patches,
 * because the wizard autosaves the entire object and a partial write is how a
 * campaign ends up with step 4's messages and step 2's audience from different
 * edits.
 */
export async function saveDraft(input: {
  businessId: string;
  campaignId: string;
  draft: CampaignDraft;
  step: WizardStepKey;
}): Promise<SaveDraftResult> {
  const admin = createAdminClient();
  const { draft } = input;

  const { data: existing } = await admin
    .from("outreach_campaigns")
    .select("id, status")
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .maybeSingle();

  if (!existing) return { ok: false, error: "That campaign could not be found." };
  if (existing.status !== "DRAFT") {
    return {
      ok: false,
      error: "This campaign has already been launched. Edit it from the campaign page.",
    };
  }

  // Cross-tenant safety: every referenced record is confirmed to belong to
  // this workspace before it is written, never trusted from the browser.
  const references = await resolveReferences(input.businessId, draft);
  if (!references.ok) return { ok: false, error: references.error };

  const { error } = await admin
    .from("outreach_campaigns")
    .update({
      name: draft.goal.campaignName.trim() || "Untitled campaign",
      conversion_goal_type: draft.goal.conversionGoal,
      conversion_goal_id: references.conversionGoalId,
      service_id: references.serviceId,
      success_event: draft.goal.successEvent,
      icp_profile_id: references.icpProfileId,
      search_session_id: references.savedSearchId,
      prospect_source: draft.audience.source,
      audience_json: {
        locations: draft.audience.locations,
        radiusMiles: draft.audience.radiusMiles,
        industries: draft.audience.industries,
        companySizes: draft.audience.companySizes,
        roles: draft.audience.roles,
        // Read by the Campaigns list card, which shows one line of targeting.
        segment: draft.audience.industries[0] ?? null,
      },
      exclusions_json: {
        globalSuppression: true,
        existingCustomers: draft.audience.exclusions.existingCustomers,
        existingLeads: draft.audience.exclusions.existingLeads,
        companies: draft.audience.exclusions.companies,
      },
      named_companies: draft.audience.namedCompanies,
      minimum_grade: draft.intentScore.minimumGrade,
      intent_filter_json: { categoryIds: references.intentCategoryIds },
      intent_required: draft.intentScore.intentRequired,
      max_intent_age_days: draft.intentScore.maxIntentAgeDays,
      review_threshold: draft.intentScore.reviewThreshold,
      sender_identity_id: references.senderIdentityId,
      send_timezone: draft.outreach.timezone,
      send_window_start: windowBounds(draft.outreach.sendWindow).start,
      send_window_end: windowBounds(draft.outreach.sendWindow).end,
      min_gap_days: draft.outreach.minGapDays,
      variants_enabled: draft.outreach.variantsEnabled,
      variants_per_step: draft.outreach.variantsEnabled
        ? draft.outreach.variantsPerStep
        : 1,
      reply_rules_json: draft.outreach.replyRules,
      promotion_rule: draft.outreach.promotionRule,
      launch_mode: draft.outreach.startMode,
      review_before_outreach: draft.outreach.startMode === "MANUAL_REVIEW",
      prospects_per_run: draft.budget.prospectsPerRun,
      daily_contact_cap: draft.budget.dailyContacts,
      monthly_contact_cap: draft.budget.monthlyContacts,
      max_cost_minor: draft.budget.providerCostCeilingMinor,
      communication_allowance: draft.budget.communicationAllowance,
      auto_overage: draft.budget.autoOverage,
      auto_optimize: draft.budget.autoOptimize,
      draft_step: input.step,
    })
    .eq("business_id", input.businessId)
    .eq("id", input.campaignId)
    .eq("status", "DRAFT");

  if (error) return { ok: false, error: "That campaign could not be saved." };

  const sequence = await writeDraftSequence(
    input.businessId,
    input.campaignId,
    draft.outreach.steps,
  );
  if (!sequence.ok) return sequence;

  return { ok: true, id: input.campaignId, savedAt: new Date().toISOString() };
}

type ResolvedReferences =
  | {
      ok: true;
      serviceId: string | null;
      conversionGoalId: string | null;
      icpProfileId: string | null;
      savedSearchId: string | null;
      senderIdentityId: string | null;
      intentCategoryIds: string[];
    }
  | { ok: false; error: string };

/**
 * Confirms every id the browser sent belongs to this workspace.
 *
 * An id that does not resolve is dropped rather than written, so a crafted
 * request cannot attach another tenant's sender, ICP or intent category to a
 * campaign — and cannot use a 404 here to probe whether one exists.
 */
async function resolveReferences(
  businessId: string,
  draft: CampaignDraft,
): Promise<ResolvedReferences> {
  const admin = createAdminClient();

  const [service, goal, icp, search, sender, categories] = await Promise.all([
    draft.goal.primaryServiceId
      ? admin
          .from("services")
          .select("id")
          .eq("business_id", businessId)
          .eq("id", draft.goal.primaryServiceId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    draft.goal.conversionGoal
      ? admin
          .from("conversion_goals")
          .select("id")
          .eq("business_id", businessId)
          .eq("type", draft.goal.conversionGoal)
          .eq("active", true)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    draft.audience.icpProfileId
      ? admin
          .from("icp_profiles")
          .select("id")
          .eq("business_id", businessId)
          .eq("id", draft.audience.icpProfileId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    draft.audience.savedSearchId
      ? admin
          .from("search_sessions")
          .select("id")
          .eq("business_id", businessId)
          .eq("id", draft.audience.savedSearchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    draft.outreach.senderIdentityId
      ? admin
          .from("sender_identities")
          .select("id")
          .eq("business_id", businessId)
          .eq("id", draft.outreach.senderIdentityId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    draft.intentScore.intentCategoryIds.length > 0
      ? admin
          .from("intent_categories")
          .select("id")
          .eq("business_id", businessId)
          .in("id", draft.intentScore.intentCategoryIds)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    ok: true,
    serviceId: service.data?.id ?? null,
    conversionGoalId: goal.data?.id ?? null,
    icpProfileId: icp.data?.id ?? null,
    savedSearchId: search.data?.id ?? null,
    senderIdentityId: sender.data?.id ?? null,
    intentCategoryIds: (categories.data ?? []).map((row) => row.id),
  };
}

/**
 * Rewrites the campaign's draft sequence.
 *
 * Only ever touches a DRAFT sequence. A PUBLISHED one is the content of
 * messages already sent, and editing it in place would change history.
 */
async function writeDraftSequence(
  businessId: string,
  campaignId: string,
  steps: SequenceStep[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("outreach_sequences")
    .select("id, status, version")
    .eq("business_id", businessId)
    .eq("campaign_id", campaignId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  let sequenceId = existing?.id ?? null;

  if (!sequenceId || existing?.status !== "DRAFT") {
    const { data: created, error } = await admin
      .from("outreach_sequences")
      .insert({
        business_id: businessId,
        campaign_id: campaignId,
        version: (existing?.version ?? 0) + 1,
        status: "DRAFT",
      })
      .select("id")
      .single();

    if (error || !created) return { ok: false, error: "That sequence could not be saved." };
    sequenceId = created.id;
  }

  await admin
    .from("outreach_steps")
    .delete()
    .eq("business_id", businessId)
    .eq("sequence_id", sequenceId);

  const rows = steps.slice(0, MAX_SEQUENCE_STEPS).map((step, index) => ({
    business_id: businessId,
    sequence_id: sequenceId,
    position: index + 1,
    delay_seconds: Math.max(0, step.delayDays) * 86400,
    // Cold outreach is email-first by policy. Nothing in this wizard can write
    // another channel here, and the dispatcher refuses one anyway.
    channel: "EMAIL" as const,
    subject_template: step.subject,
    body_template: step.body,
    enabled: step.enabled,
  }));

  if (rows.length > 0) {
    const { error } = await admin.from("outreach_steps").insert(rows);
    if (error) return { ok: false, error: "Those email steps could not be saved." };
  }

  return { ok: true };
}

/**
 * The newest draft this person left unfinished, so "New campaign" resumes
 * rather than silently starting again and abandoning yesterday's work.
 */
export async function findResumableDraft(
  businessId: string,
  userId: string,
): Promise<{ id: string; name: string; step: WizardStepKey | null } | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("outreach_campaigns")
    .select("id, name, draft_step, updated_at")
    .eq("business_id", businessId)
    .eq("status", "DRAFT")
    .eq("created_by", userId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  // A draft nobody has touched for a fortnight is not what someone clicking
  // "New campaign" means to continue.
  if (data.updated_at && Date.now() - Date.parse(data.updated_at) > 14 * 86400 * SECONDS) {
    return null;
  }

  return {
    id: data.id,
    name: data.name,
    step: (data.draft_step ?? null) as WizardStepKey | null,
  };
}

/** The default cadence a brand-new campaign starts from. */
export function defaultSteps(): SequenceStep[] {
  return DEFAULT_STEP_DELAYS_DAYS.map((delayDays, index) => ({
    position: index + 1,
    delayDays,
    subject: "",
    body: "",
    enabled: true,
  }));
}

/** Postgres `time` comes back as "HH:MM:SS"; the wizard speaks "HH:MM". */
function clock(value: string): string {
  return value.slice(0, 5);
}

/** Splits a stored "HH:MM-HH:MM" window. An empty window means "any time the
 *  policy permits", which is stored as two nulls rather than as 00:00-23:59 —
 *  those are different statements, and only one of them is true. */
function windowBounds(window: string): { start: string | null; end: string | null } {
  const [start, end] = window.split("-");
  if (!start || !end) return { start: null, end: null };
  return { start, end };
}
