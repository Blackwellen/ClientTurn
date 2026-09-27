import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertEntitlement, EntitlementError } from "@/lib/billing/entitlements";
import { LIBRARY_VERSION } from "@/lib/sales-library/types";
import { manualRescoreTrigger } from "@/lib/leads/detail-page";
import {
  INTENT_THRESHOLDS,
  QUALIFICATION_POLICY_KIND,
  WORKSPACE_POLICY_KEY,
  parseOfferProfile,
  type FactDimension,
  type QualificationPolicy,
} from "@/lib/qualification-intelligence/types";
import {
  confirmQualificationFact,
  enqueueReassessment,
  rejectQualificationFact,
  writeIntentSignals,
} from "@/lib/qualification-intelligence/service";
import { intentByKey } from "@/lib/qualification-intelligence/question-intents";
import {
  INTENT_STATE_COPY,
  INTENT_COMPONENT_COPY,
  INTENT_OVERRIDE_TRIGGER,
  NBA_ACTION_COPY,
  NBA_OVERRIDE_TRIGGER,
  NBA_RULE_COPY,
  SIGNAL_SOURCE_COPY,
  deriveDimensionStatus,
  dimensionLabel,
  goalLabel,
  manualIntentSignal,
  overrideIntent,
  overrideNextBestAction,
  qualificationStatus,
  qualificationUnknowns,
  signalTypeLabel,
  whyThisQuestion,
  type AssessmentView,
} from "@/lib/qualification-intelligence/explain";
import {
  leadRefSchema,
  overrideIntentSchema,
  overrideNbaSchema,
  policyGetSchema,
  requalifySchema,
  setFactSchema,
  untilProblem,
  type OverrideIntentArgs,
  type OverrideNbaArgs,
  type SetFactArgs,
} from "@/lib/qualification-intelligence/op-schemas";
import {
  readCurrentAssessment,
  readEngineMode,
  readFact,
  readLeadQualificationState,
  readLiveFacts,
  readPolicies,
  readPolicy,
  readSignals,
} from "@/lib/qualification-intelligence/store-reads";
import {
  canSeeEngineMode,
  mergeQualificationPolicy,
  policyChangeProblem,
  policyForRole,
  qualificationPolicyUpdateSchema,
  type QualificationPolicyUpdate,
} from "@/lib/settings/ai-selling";
import { defineOperation, ServiceError, type HandlerInput, type HandlerOutcome } from "../runtime";
import type { ServiceContext } from "../types";

/**
 * Qualification intelligence as service operations (design Â§B.19, brief Â§21).
 *
 * The reads explain the current assessment (`lead_assessments` is_current),
 * the facts and the signals; nothing here recomputes them. The engine that
 * produces them is the assessment service (qualification-intelligence/
 * service.ts) inside the `lead.score` job, so `qualification.requalify` queues
 * that job (`enqueueReassessment`) rather than assessing or scoring inline, and
 * fact and signal writes go through the service's own writers.
 *
 * The writes are corrections a person makes, each audited by the runtime with
 * its before and after:
 *
 *   * `set_fact` confirms, rejects or sets a fact (source MANUAL), then queues a
 *     reassessment so intent, completeness and the next action follow it.
 *   * `override_intent` / `override_nba` store a new assessment through
 *     `record_lead_assessment()` (the one writer of the lead's denormalised
 *     columns, CD-11). An intent override that has a matching signal type also
 *     records that signal, so the next reassessment reaches the same state on
 *     its own rather than silently undoing the person.
 *   * `policy_update` writes the QUALIFICATION_POLICY override, entitlement-
 *     checked, narrow-only outside the app (CD-18).
 *
 * Every read and write is scoped to `context.businessId` and, where it applies,
 * the lead, on the query itself.
 */

/* ----------------------------------------------------------------- helpers */

async function leadOrFail(businessId: string, leadId: string) {
  let lead;
  try {
    lead = await readLeadQualificationState(businessId, leadId);
  } catch {
    throw new ServiceError("UNAVAILABLE", "The lead could not be read.");
  }
  if (!lead) throw new ServiceError("NOT_FOUND", "That lead could not be found.");
  return lead;
}

function writableOrFail(lead: { archived: boolean; anonymised: boolean }) {
  if (lead.anonymised) throw new ServiceError("CONFLICT", "That lead has been anonymised, so nothing more is recorded about it.");
  if (lead.archived) throw new ServiceError("CONFLICT", "That lead is archived. Restore it first.");
}

async function read<T>(what: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch {
    throw new ServiceError("UNAVAILABLE", `The ${what} could not be read.`);
  }
}

/**
 * Queues the engine's own reassessment (the `lead.score` job) through the
 * assessment service. Never scores inline: a direct call would bypass the
 * engine that writes the assessment.
 */
async function queueReassessment(context: ServiceContext, leadId: string): Promise<string> {
  const triggerEvent = manualRescoreTrigger(context.userId);
  try {
    await enqueueReassessment(context.businessId, leadId, triggerEvent);
  } catch {
    throw new ServiceError("UNAVAILABLE", "The reassessment could not be queued. Try again.");
  }
  return triggerEvent;
}

async function engineModeFor(context: ServiceContext) {
  if (!canSeeEngineMode(context.role)) return undefined;
  return read("engine mode", () => readEngineMode(context.businessId));
}

const NOT_ASSESSED =
  "This lead has not been assessed yet. The assessment runs when the lead arrives or replies; re-run qualification to assess it now.";

/* ------------------------------------------------------------------- reads */

defineOperation("qualification.status", {
  schema: leadRefSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof leadRefSchema>>) {
    const lead = await leadOrFail(context.businessId, args.leadId);
    const view = await read("assessment", () => readCurrentAssessment(context.businessId, lead.id));
    const summary = qualificationStatus(lead.qualificationState, view);
    return {
      data: {
        ...summary,
        goal: view ? { key: view.goal, label: goalLabel(view.goal) } : null,
        intentLabel: view ? INTENT_STATE_COPY[view.intentState].label : null,
        nextActionLabel: view?.nba ? NBA_ACTION_COPY[view.nba.next_action].label : null,
        qualificationScore: view?.nba?.qualification_score ?? null,
        assessedAt: view?.createdAt ?? null,
        engineMode: await engineModeFor(context),
        note: view ? null : NOT_ASSESSED,
      },
      entityId: lead.id,
    };
  },
});

defineOperation("qualification.unknowns", {
  schema: leadRefSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof leadRefSchema>>) {
    const lead = await leadOrFail(context.businessId, args.leadId);
    const [view, facts] = await Promise.all([
      read("assessment", () => readCurrentAssessment(context.businessId, lead.id)),
      read("facts", () => readLiveFacts(context.businessId, lead.id)),
    ]);
    const derived = view ? [] : deriveDimensionStatus(facts);
    const unknowns = qualificationUnknowns(view, derived);
    const dimensions = view?.dimensions ?? derived;
    const byDimension = new Map(facts.filter((f) => f.state !== "REJECTED").map((f) => [f.dimension, f]));
    return {
      data: {
        assessed: Boolean(view),
        ...unknowns,
        known: dimensions
          .filter((d) => d.status === "CONFIRMED" || d.status === "INFERRED")
          .map((d) => ({
            dimension: d.dimension,
            label: dimensionLabel(d.dimension),
            status: d.status,
            value: byDimension.get(d.dimension)?.value ?? null,
          })),
        note: view ? null : NOT_ASSESSED,
      },
      entityId: lead.id,
    };
  },
});

function nbaSummary(view: AssessmentView) {
  const nba = view.nba;
  if (!nba) return null;
  return {
    action: nba.next_action,
    label: NBA_ACTION_COPY[nba.next_action].label,
    family: NBA_ACTION_COPY[nba.next_action].family,
    reason: nba.reason,
    rule: nba.rule,
    ruleExplained: NBA_RULE_COPY[nba.rule],
    confidence: nba.confidence,
    handoverReason: nba.handover_reason,
    resumeAt: nba.resume_at,
    engineVersion: nba.engine_version,
  };
}

defineOperation("qualification.explain", {
  schema: leadRefSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof leadRefSchema>>): Promise<HandlerOutcome<unknown>> {
    const lead = await leadOrFail(context.businessId, args.leadId);
    const view = await read("assessment", () => readCurrentAssessment(context.businessId, lead.id));
    if (!view) {
      return { data: { assessed: false, note: NOT_ASSESSED }, entityId: lead.id };
    }
    const why = whyThisQuestion(view.nba);
    return {
      data: {
        assessed: true,
        goal: { key: view.goal, label: goalLabel(view.goal) },
        intent: { state: view.intentState, label: INTENT_STATE_COPY[view.intentState].label, score: view.intentScore },
        completeness: view.completeness,
        nextAction: nbaSummary(view),
        whyThisQuestion: why
          ? {
              intentKey: why.intentKey,
              dimension: why.dimension,
              dimensionLabel: why.dimensionLabel,
              purpose: why.purpose,
              question: why.rendering,
              value: why.total,
              askFloor: why.askFloor,
              summary: why.summary,
              terms: why.terms.map((t) => ({ term: t.term, label: t.label, value: t.value, effect: t.direction, sentence: t.sentence })),
            }
          : null,
        noQuestionBecause: why ? null : (view.nba?.reason ?? null),
        alternatives: (view.nba?.alternatives ?? []).map((a) => ({
          action: a.action,
          label: NBA_ACTION_COPY[a.action].label,
          intentKey: a.intent,
          value: a.value,
        })),
        manualOverride: view.manualOverride,
        engineMode: view.engineMode,
        assessedAt: view.createdAt,
      },
      entityId: lead.id,
    };
  },
});

defineOperation("qualification.intent", {
  schema: leadRefSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof leadRefSchema>>): Promise<HandlerOutcome<unknown>> {
    const lead = await leadOrFail(context.businessId, args.leadId);
    const [view, signals] = await Promise.all([
      read("assessment", () => readCurrentAssessment(context.businessId, lead.id)),
      read("signals", () => readSignals(context.businessId, lead.id, 10)),
    ]);
    // The verbatim excerpt stays on the Lead page: this result lands in a
    // model's context, and the reason already says what was observed.
    const latestSignals = signals.map((s) => ({
      type: s.type,
      label: signalTypeLabel(s.type),
      polarity: s.polarity,
      source: SIGNAL_SOURCE_COPY[s.source] ?? s.source,
      observedAt: s.observedAt,
      expiresAt: s.expiresAt,
      resumeAt: s.resumeAt,
      reason: s.reason,
      retracted: s.retracted,
    }));
    if (!view) {
      return { data: { assessed: false, latestSignals, note: NOT_ASSESSED }, entityId: lead.id };
    }
    return {
      data: {
        assessed: true,
        state: view.intentState,
        label: INTENT_STATE_COPY[view.intentState].label,
        description: INTENT_STATE_COPY[view.intentState].description,
        score: view.intentScore,
        categories: Object.entries(view.categories).map(([component, points]) => ({
          component,
          label: INTENT_COMPONENT_COPY[component as keyof typeof INTENT_COMPONENT_COPY].label,
          points,
        })),
        evidence: view.evidence.map((e) => ({
          type: e.signal_type,
          label: signalTypeLabel(e.signal_type),
          reason: e.reason,
          observedAt: e.observed_at,
          decayedStrength: e.decayed_strength,
        })),
        contradictions: view.contradictions.map((e) => ({
          type: e.signal_type,
          label: signalTypeLabel(e.signal_type),
          reason: e.reason,
          observedAt: e.observed_at,
        })),
        confidence: view.confidence,
        validUntil: view.validUntil,
        latestSignals,
        manualOverride: view.manualOverride === "INTENT",
        assessedAt: view.createdAt,
      },
      entityId: lead.id,
    };
  },
});

/* ------------------------------------------------------------ requalify */

defineOperation("qualification.requalify", {
  schema: requalifySchema,
  async run({ args, context }: HandlerInput<z.infer<typeof requalifySchema>>) {
    const lead = await leadOrFail(context.businessId, args.leadId);
    writableOrFail(lead);
    const triggerEvent = await queueReassessment(context, lead.id);
    return {
      data: { queued: true, triggerEvent },
      entityId: lead.id,
      before: null,
      after: { requalify_requested: triggerEvent, reason: args.reason ?? null },
      warnings: [
        {
          code: "requalify_queued",
          message: "Qualification is being re-run. The new assessment appears in a few seconds.",
        },
      ],
    };
  },
});

/* ------------------------------------------------------------- set_fact */

defineOperation("qualification.set_fact", {
  schema: setFactSchema,
  async run({ args, context }: HandlerInput<SetFactArgs>): Promise<HandlerOutcome<unknown>> {
    const lead = await leadOrFail(context.businessId, args.leadId);
    writableOrFail(lead);

    // Every write goes through the fact store (service.ts), whose merge rules
    // are the one path by which a fact enters lead_qualification_facts.
    if (args.action === "REJECT") {
      const fact = await read("fact", () => readFact(context.businessId, lead.id, args.factId!));
      if (!fact || fact.supersededAt) throw new ServiceError("NOT_FOUND", "That fact could not be found, or has since been replaced.");
      if (fact.state === "REJECTED") {
        return {
          data: { factId: fact.id, unchanged: true },
          entityId: lead.id,
          warnings: [{ code: "no_change", message: "That value was already rejected." }],
        };
      }
      if (fact.source === "MANUAL") {
        throw new ServiceError("CONFLICT", "A value a person set cannot be rejected. Set the right value instead.");
      }
      let rejected: boolean;
      try {
        rejected = await rejectQualificationFact(context.businessId, lead.id, fact.id, context.userId);
      } catch {
        throw new ServiceError("UNAVAILABLE", "That value could not be rejected. Try again.");
      }
      if (!rejected) throw new ServiceError("CONFLICT", "That value has changed since it was shown. Reload and try again.");
      const triggerEvent = await queueReassessment(context, lead.id);
      return {
        data: { factId: fact.id, state: "REJECTED", reassessment: triggerEvent },
        entityId: lead.id,
        before: { fact_id: fact.id, dimension: fact.dimension, value: fact.value, state: fact.state, source: fact.source },
        after: { fact_action: "REJECT", fact_id: fact.id, dimension: fact.dimension, value: fact.value, state: "REJECTED", reason: args.reason ?? null },
        warnings: [{ code: "reassessing", message: "Rejected. It will not be inferred again, and the lead is being reassessed." }],
      };
    }

    // CONFIRM and SET both end in one CONFIRMED, MANUAL fact for the dimension
    // that supersedes every other live value, which also resolves a conflict.
    let dimension: FactDimension;
    let value: string;
    let questionIntentKey: string | null = null;
    let before: Record<string, unknown> | null = null;

    if (args.action === "CONFIRM") {
      const fact = await read("fact", () => readFact(context.businessId, lead.id, args.factId!));
      if (!fact || fact.supersededAt) throw new ServiceError("NOT_FOUND", "That fact could not be found, or has since been replaced.");
      if (fact.state === "REJECTED") throw new ServiceError("CONFLICT", "That value was rejected. Set the value instead if it is right after all.");
      if (fact.state === "CONFIRMED" && fact.source === "MANUAL") {
        return {
          data: { factId: fact.id, unchanged: true },
          entityId: lead.id,
          warnings: [{ code: "no_change", message: "That value is already confirmed." }],
        };
      }
      dimension = fact.dimension;
      value = fact.value;
      questionIntentKey = fact.questionIntentKey;
      before = { fact_id: fact.id, dimension: fact.dimension, value: fact.value, state: fact.state, source: fact.source };
    } else {
      dimension = args.dimension!;
      value = args.value!;
      const live = await read("facts", () => readLiveFacts(context.businessId, lead.id));
      const current = live.filter((f) => f.dimension === dimension && f.state !== "REJECTED");
      if (current.length > 0) {
        before = { dimension, values: current.map((f) => ({ fact_id: f.id, value: f.value, state: f.state, source: f.source })) };
      }
    }

    let outcome;
    try {
      outcome = await confirmQualificationFact({
        businessId: context.businessId,
        leadId: lead.id,
        dimension,
        value,
        userId: context.userId,
        questionIntentKey,
        correlationId: context.correlationId,
      });
    } catch {
      throw new ServiceError("INVALID_INPUT", "That value cannot be recorded for this detail.");
    }
    if (outcome.decision.action === "SKIP" || !outcome.factId) {
      return {
        data: { unchanged: true, reason: outcome.decision.reason },
        entityId: lead.id,
        warnings: [{ code: "no_change", message: "Nothing changed: that value is already recorded." }],
      };
    }

    const triggerEvent = await queueReassessment(context, lead.id);
    return {
      data: { factId: outcome.factId, dimension, value, state: outcome.decision.state, reassessment: triggerEvent },
      entityId: lead.id,
      before,
      after: {
        fact_action: args.action,
        fact_id: outcome.factId,
        dimension,
        value: value.trim(),
        state: outcome.decision.state,
        reason: args.reason ?? null,
      },
      warnings: [
        {
          code: "reassessing",
          message:
            "Saved as confirmed. The lead is being reassessed. Your rules' qualified or not-qualified result still comes only from the configured questions.",
        },
      ],
    };
  },
});
/* ------------------------------------------------------------- overrides */

async function storeAssessment(context: ServiceContext, leadId: string, assessment: unknown): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc("record_lead_assessment", {
    p_business_id: context.businessId,
    p_lead_id: leadId,
    p_assessment: assessment as never,
  });
  if (error) throw new ServiceError("CONFLICT", "The override could not be saved.");
  const result = (data ?? {}) as { assessment_id?: string | null; reason?: string };
  if (result.reason === "anonymised") {
    throw new ServiceError("CONFLICT", "That lead has been anonymised, so nothing more is recorded about it.");
  }
  return result.assessment_id ?? null;
}

const DAY = 86_400_000;

defineOperation("qualification.override_intent", {
  schema: overrideIntentSchema,
  async run({ args, context }: HandlerInput<OverrideIntentArgs>) {
    const problem = untilProblem(args.until);
    if (problem) throw new ServiceError("INVALID_INPUT", `until: ${problem}`);
    const lead = await leadOrFail(context.businessId, args.leadId);
    writableOrFail(lead);
    const now = new Date();
    const until =
      args.until ??
      (args.state === "NOT_NOW" ? new Date(now.getTime() + INTENT_THRESHOLDS.NOT_NOW_DEFAULT_DAYS * DAY).toISOString() : null);

    const view = await read("assessment", () => readCurrentAssessment(context.businessId, lead.id));
    const signal = manualIntentSignal({
      leadId: lead.id,
      state: args.state,
      reason: args.reason,
      until,
      now,
      correlationId: context.correlationId,
    });
    if (!view && !signal) {
      throw new ServiceError("CONFLICT", `${NOT_ASSESSED} Then set its intent.`);
    }

    // Prepare the assessment before writing anything, so an inconsistent
    // override writes nothing at all.
    const triggerEvent = `${INTENT_OVERRIDE_TRIGGER}:${context.correlationId}`.slice(0, 200);
    const write = view ? overrideIntent(view, { state: args.state, reason: args.reason, until, triggerEvent }) : null;
    if (write && !write.ok) throw new ServiceError("INVALID_INPUT", write.message);

    if (signal) {
      try {
        await writeIntentSignals(context.businessId, [signal]);
      } catch {
        throw new ServiceError("CONFLICT", "The override could not be recorded.");
      }
    }

    let assessmentId: string | null = null;
    let reassessment: string | null = null;
    if (write?.ok) assessmentId = await storeAssessment(context, lead.id, write.value);
    else reassessment = await queueReassessment(context, lead.id);

    return {
      data: { assessmentId, intentState: args.state, until, reassessment },
      entityId: lead.id,
      before: view ? { intent_state: view.intentState, intent_score: view.intentScore } : null,
      after: {
        intent_state: args.state,
        intent_score: write?.ok ? write.value.intent_score : null,
        next_action: write?.ok ? write.value.nba.next_action : null,
        until,
        reason: args.reason,
        evidence_recorded: signal?.signal_type ?? null,
      },
      warnings: [
        {
          code: "override_holds",
          message: signal
            ? "Intent overridden and recorded as evidence, so reassessment keeps it until the date you set."
            : "Intent overridden. It holds until the lead does something new or the date you set passes.",
        },
      ],
    };
  },
});

defineOperation("qualification.override_nba", {
  schema: overrideNbaSchema,
  async run({ args, context }: HandlerInput<OverrideNbaArgs>) {
    const problem = untilProblem(args.until);
    if (problem) throw new ServiceError("INVALID_INPUT", `until: ${problem}`);
    const lead = await leadOrFail(context.businessId, args.leadId);
    writableOrFail(lead);
    const view = await read("assessment", () => readCurrentAssessment(context.businessId, lead.id));
    if (!view) throw new ServiceError("CONFLICT", NOT_ASSESSED);

    const triggerEvent = `${NBA_OVERRIDE_TRIGGER}:${context.correlationId}`.slice(0, 200);
    const write = overrideNextBestAction(view, {
      action: args.action,
      reason: args.reason,
      until: args.until ?? null,
      handoverReason: args.handoverReason ?? null,
      triggerEvent,
    });
    if (!write.ok) throw new ServiceError("INVALID_INPUT", write.message);
    const assessmentId = await storeAssessment(context, lead.id, write.value);

    return {
      data: { assessmentId, nextAction: args.action },
      entityId: lead.id,
      before: { next_action: view.nba?.next_action ?? null, rule: view.nba?.rule ?? null },
      after: {
        next_action: args.action,
        until: args.until ?? null,
        handover_reason: write.value.nba.handover_reason,
        reason: args.reason,
      },
      warnings: [
        {
          code: "override_holds",
          message:
            view.engineMode === "LIVE"
              ? "Next action overridden. It holds until the lead does something new, which triggers a fresh assessment."
              : "Next action overridden and recorded. The engine is in shadow mode, so the assistant is not acting on it yet.",
        },
      ],
    };
  },
});

/* --------------------------------------------------------------- policy */

defineOperation("qualification.policy_get", {
  schema: policyGetSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof policyGetSchema>>) {
    const db = createAdminClient();
    const [policies, services, engine] = await Promise.all([
      read("qualification policy", () => readPolicies(context.businessId)),
      read("offers", async () => {
        const { data, error } = await db
          .from("services")
          .select("id, name, active, offer_profile")
          .eq("business_id", context.businessId)
          .order("name");
        if (error) throw error;
        return data ?? [];
      }),
      engineModeFor(context),
    ]);
    const scoped = args.scope?.startsWith("service:") ? args.scope.slice("service:".length) : null;
    return {
      data: {
        workspace: policyForRole(policies.workspace, context.role),
        offers: services
          .filter((s) => !scoped || s.id === scoped)
          .map((s) => {
            const offer = parseOfferProfile(s.offer_profile);
            return {
              serviceId: s.id,
              name: s.name,
              active: s.active,
              policy: policies.services[s.id] ?? {},
              offerProfile: offer.profile,
              offerProfileValid: offer.valid,
            };
          }),
        invalidScopes: policies.invalidKeys,
        engineMode: engine,
      },
      entityId: context.businessId,
    };
  },
});

async function entitledOrFail(businessId: string) {
  try {
    await assertEntitlement(businessId);
  } catch (error) {
    if (error instanceof EntitlementError) throw new ServiceError("PLAN_LIMIT", error.message);
    throw new ServiceError("UNAVAILABLE", "The subscription could not be checked.");
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

defineOperation("qualification.policy_update", {
  schema: qualificationPolicyUpdateSchema,
  async run({ args, context }: HandlerInput<QualificationPolicyUpdate>): Promise<HandlerOutcome<unknown>> {
    const db = createAdminClient();
    const scope = args.scope;

    if (scope !== WORKSPACE_POLICY_KEY) {
      const serviceId = scope.slice("service:".length);
      const { data, error } = await db
        .from("services")
        .select("id")
        .eq("business_id", context.businessId)
        .eq("id", serviceId)
        .maybeSingle();
      if (error) throw new ServiceError("UNAVAILABLE", "The offer could not be read.");
      if (!data) throw new ServiceError("NOT_FOUND", "That offer is not in this workspace.");
    }

    // A key the library does not know would be stored and silently ignored.
    for (const key of [...(args.policy.forbiddenQuestionIntents ?? []), ...(args.policy.customQuestionIntents ?? [])]) {
      if (!intentByKey(key)) throw new ServiceError("INVALID_INPUT", `"${key}" is not in the question library.`);
    }

    await entitledOrFail(context.businessId);

    const { policy: before, exists } = await read("qualification policy", () => readPolicy(context.businessId, scope));
    const after: QualificationPolicy = mergeQualificationPolicy(before, args.policy, args.mode);

    const problem = policyChangeProblem({ scope, before, after, caller: context.caller });
    if (problem) throw new ServiceError(problem.code, problem.message);

    if (sameJson(before, after)) {
      return {
        data: { scope, policy: after, unchanged: true },
        entityId: context.businessId,
        warnings: [{ code: "no_change", message: "The qualification policy already says that." }],
      };
    }

    if (Object.keys(after).length === 0) {
      if (exists) {
        const { error } = await db
          .from("workspace_sales_overrides")
          .delete()
          .eq("business_id", context.businessId)
          .eq("kind", QUALIFICATION_POLICY_KIND)
          .eq("key", scope);
        if (error) throw new ServiceError("CONFLICT", "The qualification policy could not be cleared.");
      }
    } else {
      const { error } = await db.from("workspace_sales_overrides").upsert(
        {
          business_id: context.businessId,
          kind: QUALIFICATION_POLICY_KIND,
          key: scope,
          payload: after as never,
          library_version: LIBRARY_VERSION,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_id,kind,key" },
      );
      if (error) throw new ServiceError("CONFLICT", "The qualification policy could not be saved.");
    }

    return {
      data: { scope, policy: after },
      entityId: context.businessId,
      before: { scope, policy: before },
      after: { scope, policy: after },
      warnings: [
        {
          code: "applies_on_next_assessment",
          message: "Saved. Each lead picks this up the next time it is assessed.",
        },
      ],
    };
  },
});
