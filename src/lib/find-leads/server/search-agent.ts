import "server-only";
import { runTask } from "@/lib/ai/model-router";
import type { SearchPlanningResult } from "@/lib/ai/schemas";
import { estimateRunCost } from "../cost-model";
import {
  checkPlanReadiness,
  parsePlan,
  repairPlan,
  searchPlanSchema,
  type SearchPlan,
} from "../plan";
import type { PlanSummaryLine } from "../types";
import { resolveBudget } from "./budget";
import { readAcquisitionProfile } from "./profile";
import { resolvePlanLocations } from "./locations";

/**
 * The Search Agent (V4 §10.6).
 *
 * Bounded on purpose. It has exactly one job — turn plain English into a
 * proposed change to the structured plan — and no authority beyond that:
 *
 *   * it cannot call a sourcing provider;
 *   * it cannot start, resume or re-target a run;
 *   * it cannot relax an exclusion, a budget or a compliance rule;
 *   * its output is merged into the current plan and re-validated before the
 *     customer ever sees it, so a malformed suggestion becomes a clarifying
 *     question instead of a plan.
 *
 * `create_sourcing_run` is deliberately absent from this module. Starting a
 * run is a server action a person triggers, never something a model turn can
 * reach.
 */

export type AgentTurn = {
  /** The sentence(s) shown in the chat bubble. */
  reply: string;
  /** The plan after merging the agent's patch. Unchanged when it proposed none. */
  plan: SearchPlan;
  /** True when the merge actually changed something. */
  planChanged: boolean;
  summaryLines: PlanSummaryLine[];
  clarifyingQuestion: string | null;
  breadth: "TOO_BROAD" | "GOOD" | "TOO_NARROW" | "UNKNOWN";
  /** True when AI is unavailable or its output could not be salvaged. */
  degraded: boolean;
};

/**
 * Fields the agent may never set, whatever it returns.
 *
 * These are not "hard to get right" — they are decisions that are not the
 * model's to make. Suppression and opt-out exclusion are absolute; the spend
 * ceiling belongs to the budget engine; review mode is a policy choice a
 * person makes with their own accountability.
 */
const AGENT_FORBIDDEN_FIELDS = new Set([
  "maxProviderCostMinor",
  "reviewMode",
  "version",
]);

const FORBIDDEN_EXCLUSION_KEYS = new Set(["optedOut", "suppressed"]);

/**
 * Merges a model patch onto the current plan under the field rules above.
 *
 * Unknown keys are dropped rather than passed through: a model that invents a
 * field name must not have it silently persisted into `strategy_json`, where a
 * later schema change might start honouring it.
 */
export function mergePlanPatch(
  current: SearchPlan,
  patch: Record<string, unknown>,
): { plan: SearchPlan; changed: boolean } {
  const shape = searchPlanSchema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown } }>;
  const next: Record<string, unknown> = { ...current };
  let changed = false;

  for (const [key, value] of Object.entries(patch)) {
    if (AGENT_FORBIDDEN_FIELDS.has(key)) continue;
    if (!(key in shape)) continue;

    let candidate = value;

    // Exclusions merge rather than replace, so a patch that mentions
    // competitors cannot drop the opt-out and suppression guarantees.
    if (key === "exclusions" && value && typeof value === "object") {
      const supplied = { ...(value as Record<string, unknown>) };
      for (const forbidden of FORBIDDEN_EXCLUSION_KEYS) delete supplied[forbidden];
      candidate = { ...current.exclusions, ...supplied, optedOut: true, suppressed: true };
    }

    if (key === "company" && value && typeof value === "object") {
      candidate = { ...current.company, ...(value as Record<string, unknown>) };
    }

    if (key === "intent" && value && typeof value === "object") {
      candidate = { ...current.intent, ...(value as Record<string, unknown>) };
    }

    const parsed = shape[key].safeParse(candidate);
    if (!parsed.success) continue;

    if (JSON.stringify(next[key]) !== JSON.stringify(parsed.data)) {
      next[key] = parsed.data;
      changed = true;
    }
  }

  const plan = parsePlan(next) ?? current;
  return { plan, changed };
}

/** The label/value list the plan panel and the chat bubble both render. */
export function planSummaryLines(plan: SearchPlan): PlanSummaryLine[] {
  const lines: PlanSummaryLine[] = [];

  if (plan.industries.length) {
    lines.push({ label: "Industry", value: plan.industries.join(", ") });
  }
  if (plan.locations.length) {
    lines.push({
      label: "Location",
      value: plan.locations
        .map((location) =>
          location.radiusKm
            ? `${location.city ?? location.region ?? location.country} + ${Math.round(location.radiusKm / 1.609344)} miles`
            : (location.city ?? location.region ?? location.country),
        )
        .join(", "),
    });
  }
  const { minEmployees, maxEmployees } = plan.company;
  if (minEmployees !== null || maxEmployees !== null) {
    lines.push({
      label: "Company size",
      value:
        minEmployees !== null && maxEmployees !== null
          ? `${minEmployees}–${maxEmployees} employees`
          : minEmployees !== null
            ? `${minEmployees}+ employees`
            : `Up to ${maxEmployees} employees`,
    });
  }
  if (plan.decisionMakerRoles.length) {
    lines.push({ label: "Roles", value: plan.decisionMakerRoles.join(", ") });
  }
  if (plan.intent.categories.length) {
    lines.push({ label: "Intent", value: plan.intent.categories.join(", ") });
  }
  lines.push({ label: "Exclusions", value: "Existing customers, competitors, opt-outs" });
  lines.push({ label: "Target", value: `${plan.targetVerifiedProspects} verified prospects` });

  return lines;
}

/**
 * The context block sent to the model.
 *
 * Assembled here rather than interpolated into the system prompt, following
 * the same rule the conversation agent uses: untrusted text (the customer's
 * own message) never becomes policy.
 */
function buildContext(input: {
  profileSummary: string;
  plan: SearchPlan;
  history: { role: string; content: string }[];
  message: string;
}): string {
  const recent = input.history
    .slice(-8)
    .map((turn) => `${turn.role === "USER" ? "Customer" : "You"}: ${turn.content}`)
    .join("\n");

  return [
    "BUSINESS PROFILE",
    input.profileSummary,
    "",
    "CURRENT SEARCH PLAN (JSON)",
    JSON.stringify(input.plan),
    "",
    "PLAN FIELD NAMES YOU MAY PATCH",
    "industries, locations, company, decisionMakerRoles, intent, exclusions, minimumGrade, targetVerifiedProspects, conversionGoal",
    "",
    recent ? `CONVERSATION SO FAR\n${recent}\n` : "",
    "CUSTOMER MESSAGE",
    input.message,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Runs one agent turn.
 *
 * Never throws: an unavailable model degrades to a plainly-worded reply that
 * says the plan can still be edited by hand, which is true — the structured
 * panel is fully usable without AI.
 */
export async function runSearchAgentTurn(input: {
  businessId: string;
  plan: SearchPlan;
  history: { role: string; content: string }[];
  message: string;
}): Promise<AgentTurn> {
  const profile = await readAcquisitionProfile(input.businessId);

  const profileSummary = [
    profile.businessType ? `Business type: ${profile.businessType}` : null,
    profile.services.length ? `Services: ${profile.services.join(", ")}` : null,
    profile.locations.length ? `Territories: ${profile.locations.join(", ")}` : null,
    profile.targetCustomers.length
      ? `Target customers: ${profile.targetCustomers.join(", ")}`
      : null,
    profile.conversionGoal ? `Conversion goal: ${profile.conversionGoal}` : null,
  ]
    .filter(Boolean)
    .join("\n") || "No business profile has been set up yet.";

  const result = await runTask<SearchPlanningResult>({
    taskType: "search_planning",
    businessId: input.businessId,
    context: buildContext({ profileSummary, plan: input.plan, history: input.history, message: input.message }),
    maxOutputTokens: 900,
  });

  if (!result.data) {
    return {
      reply:
        "I could not work that out just now. You can still edit the search plan on the right by hand, and nothing will be spent until you start a sourcing run.",
      plan: input.plan,
      planChanged: false,
      summaryLines: planSummaryLines(input.plan),
      clarifyingQuestion: null,
      breadth: "UNKNOWN",
      degraded: true,
    };
  }

  // One repair attempt, then give up on the patch rather than the turn: a bad
  // patch loses the plan change, never the conversation.
  const patch = result.data.plan_patch ?? {};
  let { plan, changed } = mergePlanPatch(input.plan, patch);

  if (!changed && Object.keys(patch).length > 0) {
    const repaired = repairPlan({ ...input.plan, ...patch });
    if (repaired) {
      const merged = mergePlanPatch(input.plan, repaired as unknown as Record<string, unknown>);
      plan = merged.plan;
      changed = merged.changed;
    }
  }

  // Any location the agent introduced is resolved server-side before it can be
  // shown as part of a runnable plan. An unresolved place is what "40 miles of
  // Bournemouth" turning into a text match on a provider field looks like.
  if (changed) plan = await resolvePlanLocations(plan);

  return {
    reply: result.data.reply,
    plan,
    planChanged: changed,
    summaryLines: result.data.summary_lines.length
      ? result.data.summary_lines
      : planSummaryLines(plan),
    clarifyingQuestion: result.data.clarifying_question,
    breadth: result.data.breadth,
    degraded: false,
  };
}

/**
 * `estimate_search_cost` as the agent-facing read tool: a band and a target,
 * never a provider price. Used by the sourcing-controls panel to keep the
 * displayed estimate honest as the customer moves the sliders.
 */
export async function estimateForPlan(
  businessId: string,
  plan: SearchPlan,
): Promise<{
  band: string;
  maxTarget: number;
  maxProviderCostMinor: number;
  allowed: boolean;
  reason: string;
  readiness: ReturnType<typeof checkPlanReadiness>;
}> {
  const verdict = await resolveBudget({
    businessId,
    requestedTarget: plan.targetVerifiedProspects,
    requestedCostCapMinor: plan.maxProviderCostMinor,
    intentEnabled: plan.intent.categories.length > 0,
  });

  // Recomputed here rather than read off the verdict so the panel's arithmetic
  // and the worker's reservation come from one function.
  estimateRunCost(verdict.maxTarget, verdict.unitCosts, {
    intentEnabled: plan.intent.categories.length > 0,
  });

  return {
    band: verdict.band,
    maxTarget: verdict.maxTarget,
    maxProviderCostMinor: verdict.maxProviderCostMinor,
    allowed: verdict.allowed,
    reason: verdict.reason,
    readiness: checkPlanReadiness(plan),
  };
}
