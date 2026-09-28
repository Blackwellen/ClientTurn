import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  describeTarget,
  offerTargetFields,
  offerTargetFromRow,
  refineOfferTarget,
  type OfferTarget,
} from "@/lib/agents/offer-target";
import {
  competitorSchema,
  competitorTextProblems,
  MAX_COMPETITORS,
  normaliseText,
} from "@/lib/sales-library/competitors";
import { lintStyle } from "@/lib/agent/validate";
import {
  loadCompetitors,
  loadLeadBestFit,
  loadRulesCatalogue,
} from "@/lib/commercial/rules-queries";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * Commercial rules (0174) as service operations: what an agent sells, the
 * competitors a workspace lists with its approved comparison points, and the
 * deterministic best fit for a lead. The Agents page, Settings -> AI &
 * selling, the lead page, Copilot and MCP all run these, so they share one
 * set of checks and one audit trail. Every write is scoped to
 * `context.businessId` on the write itself.
 */

function db(): SupabaseClient {
  // 0174's columns and table post-date the generated types.
  return createAdminClient() as unknown as SupabaseClient;
}

function schemaLag(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "42P01" || error.code === "42703" || error.code === "PGRST204"));
}

/* ---------------------------------------------------------- agent target */

const setTargetSchema = z
  .object({ agentId: z.uuid(), ...offerTargetFields })
  .superRefine(refineOfferTarget);

type SetTargetArgs = z.infer<typeof setTargetSchema>;

defineOperation("agent.set_offer_target", {
  schema: setTargetSchema,
  async run({ args, context }: HandlerInput<SetTargetArgs>) {
    const { data: agent, error: readError } = await db()
      .from("agents")
      .select("id, service_id, offer_scope, target_service_ids, target_catalogue_item_ids")
      .eq("business_id", context.businessId)
      .eq("id", args.agentId)
      .maybeSingle();
    if (schemaLag(readError)) {
      throw new ServiceError("UNAVAILABLE", "Targeting is not available until the latest database update is applied.");
    }
    if (readError) throw new ServiceError("UNAVAILABLE", "The agent could not be read.");
    if (!agent) throw new ServiceError("NOT_FOUND", "That agent could not be found.");

    const before = offerTargetFromRow(agent);
    const catalogue = await loadRulesCatalogue(context.businessId).catch(() => {
      throw new ServiceError("UNAVAILABLE", "The catalogue could not be read.");
    });

    // Only live offers and items of THIS workspace. An id from another
    // workspace or an archived line is refused, not silently kept.
    const serviceIds = [...new Set(args.serviceIds.map((id) => id.toLowerCase()))];
    const itemIds = [...new Set(args.catalogueItemIds.map((id) => id.toLowerCase()))];
    const unknownServices = serviceIds.filter((id) => !catalogue.services.some((s) => s.id.toLowerCase() === id));
    const unknownItems = itemIds.filter((id) => !catalogue.items.some((i) => i.id.toLowerCase() === id));
    if (unknownServices.length + unknownItems.length > 0) {
      throw new ServiceError(
        "INVALID_INPUT",
        "One or more of the chosen products or services is not active in this workspace's catalogue.",
      );
    }

    const next: OfferTarget =
      args.scope === "CATALOGUE"
        ? { scope: "CATALOGUE", serviceIds: [], catalogueItemIds: [] }
        : { scope: "SELECTED", serviceIds, catalogueItemIds: itemIds };

    const { error } = await db()
      .from("agents")
      .update({
        offer_scope: next.scope,
        target_service_ids: next.serviceIds,
        target_catalogue_item_ids: next.catalogueItemIds,
        // The legacy one-offer target (0043) is replaced by this one.
        service_id: null,
      })
      .eq("business_id", context.businessId)
      .eq("id", args.agentId);
    if (error) throw new ServiceError("CONFLICT", "The agent's target could not be saved.");

    const summary = describeTarget(next, catalogue.services, catalogue.items);
    await db()
      .from("agent_activity_events")
      .insert({
        business_id: context.businessId,
        agent_id: args.agentId,
        actor_user_id: context.userId,
        event_type: "UPDATED",
        severity: "INFO",
        title: "What it sells changed",
        detail: `Now sells: ${summary}. Changed via ${context.caller}.`,
      })
      .then(
        () => undefined,
        () => undefined,
      );

    return {
      data: { target: next, summary },
      entityId: args.agentId,
      before: { ...before },
      after: { ...next },
    };
  },
});

/* ------------------------------------------------------------ competitors */

defineOperation("competitor.list", {
  schema: z.object({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const set = await loadCompetitors(context.businessId).catch(() => {
      throw new ServiceError("UNAVAILABLE", "The competitors could not be read.");
    });
    return { data: set, entityId: context.businessId };
  },
});

/** The house rules on the business's own words: no emojis, dashes or pressure. */
function styleProblem(texts: string[]): string | null {
  for (const text of texts) {
    const failures = lintStyle(text).filter((f) =>
      ["STYLE_EMOJI", "STYLE_EM_DASHES", "STYLE_PRESSURE"].includes(f.code),
    );
    if (failures.length > 0) return `"${text.slice(0, 60)}": ${failures.map((f) => f.detail).join(" ")} ${failures[0].correction}`;
  }
  return null;
}

const saveSchema = z.object({ competitor: competitorSchema });

defineOperation("competitor.save", {
  schema: saveSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof saveSchema>>) {
    const competitor = args.competitor;
    const problem = competitorTextProblems(competitor) ?? styleProblem(competitor.approvedPoints);
    if (problem) throw new ServiceError("INVALID_INPUT", problem);

    const before = await loadCompetitors(context.businessId).catch(() => {
      throw new ServiceError("UNAVAILABLE", "The competitors could not be read.");
    });
    if (!before.schemaReady) {
      throw new ServiceError("UNAVAILABLE", "Competitors are not available until the latest database update is applied.");
    }
    const existing = before.competitors.find((c) => c.id === competitor.id) ?? null;
    if (!existing && before.competitors.length >= MAX_COMPETITORS) {
      throw new ServiceError("INVALID_INPUT", `A workspace can list up to ${MAX_COMPETITORS} competitors.`);
    }
    // Two competitors answering to the same name would make detection ambiguous.
    const names = [competitor.name, ...competitor.aliases].map(normaliseText);
    const clash = before.competitors.find(
      (c) => c.id !== competitor.id && [c.name, ...c.aliases].map(normaliseText).some((n) => names.includes(n)),
    );
    if (clash) throw new ServiceError("INVALID_INPUT", `${clash.name} already uses one of these names.`);

    const { error } = await db()
      .from("workspace_competitors")
      .upsert(
        {
          business_id: context.businessId,
          slug: competitor.id,
          name: competitor.name,
          aliases: competitor.aliases,
          approved_points: competitor.approvedPoints,
          never_say: competitor.neverSay,
          enabled: competitor.enabled,
          updated_by: context.userId,
        },
        { onConflict: "business_id,slug" },
      );
    if (error) throw new ServiceError("CONFLICT", "That competitor could not be saved.");

    return {
      data: await loadCompetitors(context.businessId),
      entityId: context.businessId,
      before: existing ? { ...existing } : null,
      after: { ...competitor },
    };
  },
});

const removeSchema = z.object({ id: competitorSchema.shape.id });

defineOperation("competitor.remove", {
  schema: removeSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof removeSchema>>) {
    const before = await loadCompetitors(context.businessId).catch(() => {
      throw new ServiceError("UNAVAILABLE", "The competitors could not be read.");
    });
    const existing = before.competitors.find((c) => c.id === args.id);
    if (!existing) throw new ServiceError("NOT_FOUND", "That competitor could not be found.");
    const { error } = await db()
      .from("workspace_competitors")
      .delete()
      .eq("business_id", context.businessId)
      .eq("slug", args.id);
    if (error) throw new ServiceError("CONFLICT", "That competitor could not be removed.");
    return {
      data: await loadCompetitors(context.businessId),
      entityId: context.businessId,
      before: { ...existing },
      after: null,
    };
  },
});

/* --------------------------------------------------------------- best fit */

const bestFitSchema = z.object({ leadId: z.uuid() });

defineOperation("lead.best_fit", {
  schema: bestFitSchema,
  async run({ args, context }: HandlerInput<z.infer<typeof bestFitSchema>>) {
    const result = await loadLeadBestFit(context.businessId, args.leadId).catch(() => {
      throw new ServiceError("UNAVAILABLE", "The best fit could not be worked out right now.");
    });
    if (!result) throw new ServiceError("NOT_FOUND", "That lead could not be found.");
    const { fit } = result;
    // Reason codes and names only: no price leaves this operation.
    return {
      data:
        fit.status === "RECOMMENDED"
          ? {
              status: fit.status,
              version: fit.version,
              top: { kind: fit.top.kind, id: fit.top.id, name: fit.top.name, score: fit.top.score },
              reasons: fit.reasons,
              leadNotes: fit.leadNotes,
              ranked: fit.ranked.map((c) => ({ kind: c.kind, id: c.id, name: c.name, score: c.score, eligible: c.eligible, reasons: c.reasons })),
            }
          : {
              status: fit.status,
              version: fit.version,
              reason: fit.reason,
              leadNotes: fit.leadNotes,
              ranked: fit.ranked.map((c) => ({ kind: c.kind, id: c.id, name: c.name, score: c.score, eligible: c.eligible, reasons: c.reasons })),
            },
      entityId: args.leadId,
    };
  },
});
