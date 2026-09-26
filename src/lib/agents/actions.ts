"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runOperation } from "@/lib/services";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { AGENT_TYPES, SOURCE_DEFINITIONS, type SourceKey } from "./types";

/**
 * Agent mutations.
 *
 * Every write checks `requireRole("admin")` and then runs the matching agent
 * registry operation (`agent.create`, `agent.configure`, `agent.start`, ...),
 * so the wizard, the Settings form, Copilot, MCP and the API share one
 * implementation and one set of checks.
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
  autonomy: z.enum(["REVIEW_ALL", "REVIEW_NEW", "AUTO"]).default("REVIEW_ALL"),
});

type Workspace = Awaited<ReturnType<typeof requireRole>>;

function uiContext(workspace: Workspace) {
  return {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI" as const,
    // The person pressed the button that asks for exactly this act.
    confirmed: true,
    correlationId: randomUUID(),
  };
}

async function adminOrError(): Promise<Workspace | null> {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

/**
 * Creates an agent through `agent.create`, so the wizard, Copilot, MCP and the
 * API share one implementation and one set of checks.
 */
export async function saveAgent(input: unknown): Promise<{ id?: string; error?: string }> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Check the agent name, sources and limits, then try again." };
  }

  const workspace = await adminOrError();
  if (!workspace) return { error: "You need workspace admin access to create an agent." };
  const value = parsed.data;

  const result = await runOperation(
    "agent.create",
    {
      name: value.name,
      description: value.description || undefined,
      type: value.type,
      cadence: value.cadence,
      dailyCap: value.dailyCap,
      monthlyCap: value.monthlyCap,
      sources: value.sources,
      autonomy: value.autonomy,
      ...(value.strategyId ? { searchPlanId: value.strategyId } : {}),
    },
    uiContext(workspace),
  );
  if (!result.success) return { error: result.message };

  revalidatePath("/app/agents");
  const data = result.data as { agent: { id: string } };
  return { id: data.agent.id };
}

const updateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(""),
  strategyId: z.union([z.uuid(), z.literal("")]).default(""),
  cadence: z.enum(["MANUAL", "HOURLY", "DAILY", "WEEKLY"]),
  dailyCap: z.coerce.number().int().min(1).max(500),
  monthlyCap: z.coerce.number().int().min(1).max(10000),
  sources: z.array(z.enum(SOURCE_KEYS)).max(SOURCE_KEYS.length).optional(),
  autonomy: z.enum(["REVIEW_ALL", "REVIEW_NEW", "AUTO"]),
});

/** Edits an agent's setup through `agent.configure` (the Settings tab form). */
export async function updateAgent(
  input: unknown,
): Promise<{ ok: true; warnings: string[] } | { ok: false; error: string }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the agent name, sources and limits, then try again." };
  }
  if (parsed.data.monthlyCap < parsed.data.dailyCap) {
    return { ok: false, error: "The monthly limit must be at least the daily limit." };
  }

  const workspace = await adminOrError();
  if (!workspace) return { ok: false, error: "You need workspace admin access to change this agent." };
  const value = parsed.data;

  const result = await runOperation(
    "agent.configure",
    {
      agentId: value.id,
      name: value.name,
      description: value.description || null,
      cadence: value.cadence,
      dailyCap: value.dailyCap,
      monthlyCap: value.monthlyCap,
      autonomy: value.autonomy,
      ...(value.sources ? { sources: value.sources } : {}),
      ...(value.strategyId ? { searchPlanId: value.strategyId } : {}),
    },
    uiContext(workspace),
  );
  if (!result.success) return { ok: false, error: result.message };

  revalidatePath("/app/agents", "layout");
  return { ok: true, warnings: (result.warnings ?? []).map((w) => w.message) };
}

/**
 * Start, run now, pause and stop, through the agent lifecycle operations — so
 * the readiness, entitlement and plan checks live in one place.
 *
 * "run" is "Run now" / "Run once": on an agent that is not running it starts
 * it (the same as "start"), on a running one it brings the next run forward.
 */
export async function controlAgent(id: unknown, command: unknown) {
  const parsed = z
    .object({ id: z.uuid(), command: z.enum(["start", "pause", "stop", "run"]) })
    .safeParse({ id, command });
  if (!parsed.success) return { error: "Invalid agent control." };

  const workspace = await adminOrError();
  if (!workspace) return { error: "You need workspace admin access to change this agent." };

  const db = createAdminClient();
  const { data: agent, error: readError } = await db
    .from("agents")
    .select("id, status")
    .eq("business_id", workspace.businessId)
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (readError) return { error: "The agent could not be read. Please retry." };
  if (!agent) return { error: "Agent not found." };

  const operation =
    parsed.data.command === "pause"
      ? "agent.pause"
      : parsed.data.command === "stop"
        ? "agent.stop"
        : parsed.data.command === "run" && agent.status === "ACTIVE"
          ? "agent.run_now"
          : "agent.start";

  const result = await runOperation(operation, { agentId: agent.id }, uiContext(workspace));
  if (!result.success) return { error: result.message };

  revalidatePath("/app/agents", "layout");
  return { ok: true };
}

/**
 * Deletes an agent through the registry operation, so the UI, MCP and the API
 * share one implementation, one audit row and one refusal rule (a run in
 * progress blocks it). `confirmed: true` is sent only from the confirmation
 * dialog the person clicked through.
 */
export async function deleteAgent(
  id: unknown,
): Promise<
  | { ok: true; kept: { leads: number; prospects: number; sourcingRuns: number } }
  | { ok: false; error: string }
> {
  const parsed = z.object({ id: z.uuid() }).safeParse({ id });
  if (!parsed.success) return { ok: false, error: "Invalid agent." };

  let workspace;
  try {
    workspace = await requireRole("admin");
  } catch {
    return { ok: false, error: "You need workspace admin access to delete this agent." };
  }

  const result = await runOperation(
    "agent.delete",
    { agentId: parsed.data.id },
    {
      businessId: workspace.businessId,
      userId: workspace.userId,
      role: workspace.role,
      caller: "UI",
      confirmed: true,
      correlationId: randomUUID(),
    },
  );
  if (!result.success) return { ok: false, error: result.message };

  revalidatePath("/app/agents");
  const data = result.data as { kept: { leads: number; prospects: number; sourcingRuns: number } };
  return { ok: true, kept: data.kept };
}
