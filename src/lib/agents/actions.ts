"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { AGENT_TYPES, SOURCE_DEFINITIONS, type SourceKey } from "./types";

/**
 * Agent mutations.
 *
 * Every write goes through `requireRole("admin")` and then the service role,
 * scoped explicitly to the caller's workspace — the pattern the rest of the
 * codebase uses, with RLS as the backstop rather than the only guard.
 *
 * An agent is always created in DRAFT and is never started by its own creation.
 * Starting is a separate, separately-validated action.
 */

const SOURCE_KEYS = Object.keys(SOURCE_DEFINITIONS) as [SourceKey, ...SourceKey[]];

const saveSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(""),
  type: z.enum(AGENT_TYPES),
  strategyId: z.union([z.uuid(), z.literal("")]).default(""),
  cadence: z.enum(["MANUAL", "HOURLY", "DAILY", "WEEKLY"]),
  dailyCap: z.coerce.number().int().min(1).max(500),
  monthlyCap: z.coerce.number().int().min(1).max(10000),
  sources: z.array(z.enum(SOURCE_KEYS)).max(SOURCE_KEYS.length).default([]),
  enrichEmail: z.boolean().default(true),
  enrichPhone: z.boolean().default(false),
  autonomy: z.enum(["REVIEW_ALL", "REVIEW_NEW", "AUTO"]).default("REVIEW_ALL"),
});

export async function saveAgent(input: unknown) {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Check the agent name, sources and limits, then try again." };
  }

  const workspace = await requireRole("admin");
  const value = parsed.data;

  const entitlements = await getV4Entitlements(workspace.businessId);
  if (!entitlements.active) {
    return { error: "This workspace does not have an active subscription." };
  }
  if (
    (value.type === "SOURCING" || value.type === "COMBINED") &&
    !entitlements.sourcingEnabled
  ) {
    return { error: "Your plan does not include sourcing agents. Review Billing & Usage." };
  }

  // Re-checked server-side: the wizard also validates this, but the wizard is
  // not the authority on anything.
  if (value.monthlyCap < value.dailyCap) {
    return { error: "The monthly limit must be at least the daily limit." };
  }

  // A source the agent type cannot use is dropped rather than rejected, so a
  // stale browser tab cannot fail the whole submission.
  const permitted = value.sources.filter((key) =>
    SOURCE_DEFINITIONS[key]?.types.includes(value.type),
  );

  const db = createAdminClient();

  if (value.strategyId) {
    const { data: plan } = await db
      .from("search_strategies")
      .select("id")
      .eq("id", value.strategyId)
      .eq("business_id", workspace.businessId)
      .eq("status", "APPROVED")
      .maybeSingle();
    if (!plan) {
      return { error: "Choose an approved search plan from this workspace." };
    }
  }

  const { data: agent, error } = await db
    .from("agents")
    .insert({
      business_id: workspace.businessId,
      created_by: workspace.userId,
      name: value.name,
      description: value.description || null,
      agent_type: value.type,
      cadence: value.cadence,
      search_strategy_id: value.strategyId || null,
      daily_prospect_cap: value.dailyCap,
      monthly_prospect_cap: value.monthlyCap,
      timezone: workspace.timezone,
      status: "DRAFT",
      autonomy: value.autonomy,
      enrich_email: value.enrichEmail,
      enrich_phone: value.enrichPhone,
      // Never enabled at creation. Promotion into Leads is a deliberate,
      // separately-granted behaviour.
      auto_promote_to_leads: false,
    })
    .select("id")
    .single();

  if (error || !agent) return { error: "The agent could not be saved. Please retry." };

  if (permitted.length > 0) {
    await db.from("agent_sources").insert(
      permitted.map((key) => ({
        business_id: workspace.businessId,
        agent_id: agent.id,
        source_key: key,
        enabled: true,
        // Real availability is resolved when the agent first runs; recording
        // REQUIRES_SETUP up front would be a guess.
        status: "AVAILABLE" as const,
      })),
    );
  }

  await db.from("agent_activity_events").insert({
    business_id: workspace.businessId,
    agent_id: agent.id,
    actor_user_id: workspace.userId,
    event_type: "CREATED",
    severity: "INFO",
    title: "Agent created",
    detail: "Saved as a draft. Review the setup before starting background work.",
  });

  revalidatePath("/app/agents");
  return { id: agent.id };
}

export async function controlAgent(id: unknown, command: unknown) {
  const parsed = z
    .object({ id: z.uuid(), command: z.enum(["start", "pause", "stop", "run"]) })
    .safeParse({ id, command });
  if (!parsed.success) return { error: "Invalid agent control." };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { data: agent } = await db
    .from("agents")
    .select("id, agent_type, search_strategy_id, cadence")
    .eq("business_id", workspace.businessId)
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (!agent) return { error: "Agent not found." };

  const starting = parsed.data.command === "start" || parsed.data.command === "run";

  if (starting) {
    const entitlements = await getV4Entitlements(workspace.businessId);
    if (!entitlements.active || !entitlements.sourcingEnabled) {
      return { error: "An active plan that includes sourcing is required." };
    }

    // Only sourcing is orchestrated independently today. Saying so is better
    // than starting an agent that would sit idle and look broken.
    if (agent.agent_type !== "SOURCING") {
      return {
        error:
          "Booking is configured in Follow-Up and re-engagement in Reactivation. Independent background running for this agent type is not connected yet.",
      };
    }

    if (!agent.search_strategy_id) {
      return {
        error: "This agent needs an approved Find Leads search plan before it can run.",
      };
    }

    const { data: plan } = await db
      .from("search_strategies")
      .select("status")
      .eq("id", agent.search_strategy_id)
      .eq("business_id", workspace.businessId)
      .maybeSingle();

    if (plan?.status !== "APPROVED") {
      return { error: "Approve the search plan in Find Leads before running this agent." };
    }
  }

  const status = starting
    ? "ACTIVE"
    : parsed.data.command === "pause"
      ? "PAUSED"
      : "STOPPED";

  const { error } = await db
    .from("agents")
    .update({
      status,
      status_reason: null,
      next_run_at: starting ? new Date().toISOString() : null,
      activated_at: starting ? new Date().toISOString() : undefined,
      paused_at: status === "PAUSED" ? new Date().toISOString() : undefined,
    })
    .eq("id", agent.id)
    .eq("business_id", workspace.businessId);

  if (error) return { error: "The agent could not be updated." };

  await db.from("agent_activity_events").insert({
    business_id: workspace.businessId,
    agent_id: agent.id,
    actor_user_id: workspace.userId,
    event_type: status,
    severity: starting ? "SUCCESS" : "INFO",
    title: starting ? "Background run requested" : `Agent ${status.toLowerCase()}`,
  });

  revalidatePath("/app/agents", "layout");
  return { ok: true };
}
