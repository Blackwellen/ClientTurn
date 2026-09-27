"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { runOperation, type ServiceResult } from "@/lib/services";
import {
  overrideIntentSchema,
  overrideNbaSchema,
  requalifySchema,
  setFactSchema,
} from "@/lib/qualification-intelligence/op-schemas";

/**
 * Server actions behind the Lead page's qualification controls: re-run,
 * confirm / reject / set a fact, override intent, override the next action.
 * Each runs the registry operation Copilot and MCP call, so permission,
 * validation, audit (with before and after) and the tenant boundary all live
 * behind `runOperation`. The role is checked here for a clear message and
 * again by the runtime.
 */

export type QualificationActionResult = { ok: true; message: string } | { ok: false; error: string };

async function member(): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole("member");
  } catch {
    return null;
  }
}

function context(workspace: ActiveWorkspace) {
  return {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI" as const,
    correlationId: randomUUID(),
  };
}

function finish(result: ServiceResult, leadId: string, success: string): QualificationActionResult {
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath(`/app/leads/${leadId}`);
  revalidatePath("/app/leads");
  const noChange = result.warnings.find((w) => w.code === "no_change")?.message;
  const warning = result.warnings.find((w) => w.code !== "no_change")?.message;
  return { ok: true, message: noChange ?? warning ?? success };
}

const DENIED = "Your role can view this lead's qualification but not change it.";

function invalid(error: { issues: { message: string }[] }): QualificationActionResult {
  return { ok: false, error: error.issues[0]?.message ?? "Check the details and try again." };
}

export async function requalifyLeadAction(input: unknown): Promise<QualificationActionResult> {
  const parsed = requalifySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const workspace = await member();
  if (!workspace) return { ok: false, error: DENIED };
  const result = await runOperation("qualification.requalify", parsed.data, context(workspace));
  return finish(result, parsed.data.leadId, "Qualification re-run.");
}

export async function setQualificationFactAction(input: unknown): Promise<QualificationActionResult> {
  const parsed = setFactSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const workspace = await member();
  if (!workspace) return { ok: false, error: DENIED };
  const result = await runOperation("qualification.set_fact", parsed.data, context(workspace));
  return finish(result, parsed.data.leadId, "Saved.");
}

export async function overrideIntentAction(input: unknown): Promise<QualificationActionResult> {
  const parsed = overrideIntentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const workspace = await member();
  if (!workspace) return { ok: false, error: DENIED };
  const result = await runOperation("qualification.override_intent", parsed.data, context(workspace));
  return finish(result, parsed.data.leadId, "Intent overridden.");
}

export async function overrideNextActionAction(input: unknown): Promise<QualificationActionResult> {
  const parsed = overrideNbaSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const workspace = await member();
  if (!workspace) return { ok: false, error: DENIED };
  const result = await runOperation("qualification.override_nba", parsed.data, context(workspace));
  return finish(result, parsed.data.leadId, "Next action overridden.");
}
