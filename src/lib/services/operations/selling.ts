import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { LIBRARY_VERSION } from "@/lib/sales-library/types";
import {
  avoidTextFromPhrases,
  budgetProblems,
  budgetUpdateSchema,
  DEFAULT_SELLING_PREFERENCES,
  EDITABLE_BUDGET_SCOPES,
  liaProblems,
  liaSchema,
  normaliseSicCode,
  parseScoringWeights,
  parseSellingPreferences,
  salesSettingsUpdateSchema,
  scoringWeightsSchema,
  type EditableBudgetScope,
  type LiaInput,
  type SalesSettingsUpdate,
} from "@/lib/settings/ai-selling";
import {
  loadSalesSettings,
  platformBudgetDefaults,
  SIC_SYSTEM,
} from "@/lib/settings/ai-selling-queries";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * Settings -> AI & selling (brief §74) as service operations, so the settings
 * page, Copilot and an MCP client change the same rows the same way, audited
 * with the before and after.
 *
 * Every write is scoped to `context.businessId` on the write itself. The
 * validation schemas are the pure ones in lib/settings/ai-selling.ts, which
 * the form also runs, so a value the form accepts is a value this accepts.
 */

/* ---------------------------------------------------------- sales settings */

defineOperation("sales_settings.get", {
  schema: z.object({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    try {
      const settings = await loadSalesSettings(context.businessId);
      return { data: { settings }, entityId: context.businessId };
    } catch {
      throw new ServiceError("UNAVAILABLE", "The selling settings could not be read.");
    }
  },
});

defineOperation("sales_settings.update", {
  schema: salesSettingsUpdateSchema,
  async run({ args, context }: HandlerInput<SalesSettingsUpdate>) {
    const db = createAdminClient();
    let before;
    try {
      before = await loadSalesSettings(context.businessId);
    } catch {
      throw new ServiceError("UNAVAILABLE", "The selling settings could not be read.");
    }

    const profilePatch: Record<string, unknown> = {};

    if (args.classification) {
      const raw = args.classification.primaryIndustryCode;
      const code = raw ? normaliseSicCode(raw) : null;
      if (raw && !code) throw new ServiceError("INVALID_INPUT", "That is not a SIC code.");
      if (code) {
        // Only a code that exists in the canonical taxonomy may be stored.
        const { data, error } = await db
          .from("industry_codes")
          .select("code")
          .eq("system", SIC_SYSTEM)
          .eq("code", code)
          .maybeSingle();
        if (error) throw new ServiceError("UNAVAILABLE", "The industry list could not be read.");
        if (!data) throw new ServiceError("INVALID_INPUT", "That SIC 2026 code is not in the taxonomy.");
      }
      profilePatch.primary_industry_system = code ? SIC_SYSTEM : null;
      profilePatch.primary_industry_code = code;
      profilePatch.archetype_key = args.classification.archetypeKey;
      // A person chose it, so it is binding and says so.
      profilePatch.classification_source =
        code || args.classification.archetypeKey ? "USER" : null;
      profilePatch.classification_confidence = code || args.classification.archetypeKey ? 1 : null;
      profilePatch.library_version = LIBRARY_VERSION;
    }

    if (args.salesMotions) profilePatch.sales_motions = args.salesMotions;

    if (args.brand) {
      const b = args.brand;
      const text = (value: string | undefined) => (value === undefined ? undefined : value.trim() || null);
      const map: Record<string, unknown> = {
        outreach_tone: text(b.tone),
        outreach_value_proposition: text(b.valueProposition),
        outreach_key_messages: text(b.keyMessages),
        outreach_proof_points: text(b.proofPoints),
        outreach_call_to_action: text(b.callToAction),
        outreach_claim_restrictions: text(b.claimRestrictions),
        outreach_avoid: b.forbiddenPhrases === undefined ? undefined : avoidTextFromPhrases(b.forbiddenPhrases),
      };
      for (const [column, value] of Object.entries(map)) {
        if (value !== undefined) profilePatch[column] = value;
      }
      profilePatch.outreach_guidance_updated_at = new Date().toISOString();
    }

    if (Object.keys(profilePatch).length > 0) {
      const { error } = await db
        .from("business_profiles")
        .upsert({ business_id: context.businessId, ...profilePatch } as never, { onConflict: "business_id" });
      if (error) throw new ServiceError("CONFLICT", "Those settings could not be saved.");
    }

    if (args.preferences && Object.keys(args.preferences).length > 0) {
      const { data: existing, error: readError } = await db
        .from("workspace_sales_overrides")
        .select("payload")
        .eq("business_id", context.businessId)
        .eq("kind", "ARCHETYPE_SETTINGS")
        .eq("key", "*")
        .maybeSingle();
      if (readError) throw new ServiceError("UNAVAILABLE", "The selling settings could not be read.");
      const merged = {
        ...(existing ? parseSellingPreferences(existing.payload) : DEFAULT_SELLING_PREFERENCES),
        ...args.preferences,
      };
      const { error } = await db.from("workspace_sales_overrides").upsert(
        {
          business_id: context.businessId,
          kind: "ARCHETYPE_SETTINGS",
          key: "*",
          payload: merged,
          library_version: LIBRARY_VERSION,
          updated_by: context.userId,
        },
        { onConflict: "business_id,kind,key" },
      );
      if (error) throw new ServiceError("CONFLICT", "Those settings could not be saved.");
    }

    const after = await loadSalesSettings(context.businessId).catch(() => null);
    if (!after) throw new ServiceError("UNAVAILABLE", "The settings were saved but could not be read back.");

    return {
      data: { settings: after },
      entityId: context.businessId,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
    };
  },
});

/* ------------------------------------------------------------------ budget */

type BudgetArgs = Partial<Record<EditableBudgetScope, number | null>>;

defineOperation("ai_budget.update", {
  schema: budgetUpdateSchema,
  async run({ args, context }: HandlerInput<BudgetArgs>) {
    const db = createAdminClient();

    let defaults;
    try {
      defaults = await platformBudgetDefaults();
    } catch {
      throw new ServiceError("UNAVAILABLE", "The platform limits could not be read.");
    }

    const { data: current, error: readError } = await db
      .from("ai_budgets")
      .select("id, scope, ceiling_minor")
      .eq("business_id", context.businessId)
      .in("scope", [...EDITABLE_BUDGET_SCOPES]);
    if (readError) throw new ServiceError("UNAVAILABLE", "The current limits could not be read.");

    const before: Partial<Record<EditableBudgetScope, number | null>> = {};
    for (const row of current ?? []) before[row.scope as EditableBudgetScope] = row.ceiling_minor;

    // Checked against the values that will be in force afterwards, so a change
    // to one field cannot slip past a rule that relates it to another.
    const next = { ...before, ...args };
    const problems = budgetProblems(next, defaults);
    const first = Object.entries(problems)[0];
    if (first) throw new ServiceError("INVALID_INPUT", `${first[0]}: ${first[1]}`);

    for (const scope of EDITABLE_BUDGET_SCOPES) {
      if (!(scope in args)) continue;
      const value = args[scope] ?? null;
      const existing = (current ?? []).find((row) => row.scope === scope);

      if (value === null) {
        // Clearing removes the workspace row, so the platform default applies
        // again. A row with a null ceiling would mean "no limit" instead.
        if (existing) {
          const { error } = await db
            .from("ai_budgets")
            .delete()
            .eq("id", existing.id)
            .eq("business_id", context.businessId);
          if (error) throw new ServiceError("CONFLICT", "That limit could not be cleared.");
        }
        continue;
      }

      if (existing) {
        const { error } = await db
          .from("ai_budgets")
          .update({ ceiling_minor: value, enabled: true, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .eq("business_id", context.businessId);
        if (error) throw new ServiceError("CONFLICT", "That limit could not be saved.");
      } else {
        const { error } = await db.from("ai_budgets").insert({
          business_id: context.businessId,
          scope,
          ceiling_minor: value,
          budget_window: scope === "WORKSPACE_MONTH" ? "MONTH" : "LIFETIME",
          currency: "GBP",
          enabled: true,
        });
        if (error) throw new ServiceError("CONFLICT", "That limit could not be saved.");
      }
    }

    const after = Object.fromEntries(
      EDITABLE_BUDGET_SCOPES.map((scope) => [scope, next[scope] ?? null]),
    );
    return {
      data: { budgets: after },
      entityId: context.businessId,
      before: before as Record<string, unknown>,
      after,
    };
  },
});

/* --------------------------------------------------------------------- LIA */

defineOperation("legitimate_interest.save", {
  schema: liaSchema,
  async run({ args, context }: HandlerInput<LiaInput>) {
    const problems = liaProblems(args);
    if (problems.length > 0) throw new ServiceError("INVALID_INPUT", problems[0]);

    const db = createAdminClient();
    const now = new Date().toISOString();
    const row = {
      purpose: args.purpose,
      necessity: args.necessity,
      balancing: args.balancing,
      safeguards: args.safeguards?.trim() || null,
      channels: args.channels,
      status: args.status,
      next_review_at: args.nextReviewOn ? `${args.nextReviewOn}T00:00:00Z` : null,
      reviewer_id: context.userId,
      reviewed_at: now,
    };

    if (args.id) {
      const { data: existing, error: readError } = await db
        .from("legitimate_interest_assessments")
        .select("id, status, purpose, channels, next_review_at")
        .eq("id", args.id)
        .eq("business_id", context.businessId)
        .maybeSingle();
      if (readError) throw new ServiceError("UNAVAILABLE", "That assessment could not be read.");
      if (!existing) throw new ServiceError("NOT_FOUND", "That assessment could not be found.");

      const { error } = await db
        .from("legitimate_interest_assessments")
        .update(row)
        .eq("id", args.id)
        .eq("business_id", context.businessId);
      if (error) throw new ServiceError("CONFLICT", "That assessment could not be saved.");

      return {
        data: { id: args.id, status: args.status },
        entityId: args.id,
        before: existing as unknown as Record<string, unknown>,
        after: { status: row.status, purpose: row.purpose, channels: row.channels, next_review_at: row.next_review_at },
      };
    }

    const { data, error } = await db
      .from("legitimate_interest_assessments")
      .insert({ business_id: context.businessId, ...row })
      .select("id")
      .single();
    if (error || !data) throw new ServiceError("CONFLICT", "That assessment could not be saved.");

    return {
      data: { id: data.id, status: args.status },
      entityId: data.id,
      before: null,
      after: { status: row.status, purpose: row.purpose, channels: row.channels, next_review_at: row.next_review_at },
    };
  },
});

/* -------------------------------------------------------- scoring weights */

/**
 * Workspace scoring weights (brief §17): the SCORING_WEIGHTS '*' override that
 * scoring/service.ts reads. `weights: null` resets to the library profile.
 * Scores change on each lead's next re-score (every scoring trigger reads the
 * override afresh); nothing is re-scored in bulk here.
 */
defineOperation("scoring_weights.update", {
  schema: z.object({ weights: scoringWeightsSchema.nullable() }),
  async run({ args, context }: HandlerInput<{ weights: Record<string, number> | null }>) {
    const db = createAdminClient();
    const { data: existing, error: readError } = await db
      .from("workspace_sales_overrides")
      .select("payload")
      .eq("business_id", context.businessId)
      .eq("kind", "SCORING_WEIGHTS")
      .eq("key", "*")
      .maybeSingle();
    if (readError) throw new ServiceError("UNAVAILABLE", "The scoring weights could not be read.");
    const before = { weights: existing ? parseScoringWeights(existing.payload) : null };

    if (args.weights === null) {
      const { error } = await db
        .from("workspace_sales_overrides")
        .delete()
        .eq("business_id", context.businessId)
        .eq("kind", "SCORING_WEIGHTS")
        .eq("key", "*");
      if (error) throw new ServiceError("CONFLICT", "The scoring weights could not be reset.");
    } else {
      const { error } = await db.from("workspace_sales_overrides").upsert(
        {
          business_id: context.businessId,
          kind: "SCORING_WEIGHTS",
          key: "*",
          payload: args.weights,
          library_version: LIBRARY_VERSION,
          updated_by: context.userId,
        },
        { onConflict: "business_id,kind,key" },
      );
      if (error) throw new ServiceError("CONFLICT", "The scoring weights could not be saved.");
    }
    const after = { weights: args.weights };
    return { data: after, entityId: context.businessId, before, after };
  },
});
