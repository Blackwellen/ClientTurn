"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace, type BusinessRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { runOperation, type ServiceResult } from "@/lib/services";
import {
  EDITABLE_BUDGET_SCOPES,
  liaSchema,
  parseBudgetForm,
  qualificationPolicyUpdateSchema,
  salesSettingsUpdateSchema,
  scoringWeightsSchema,
  type EditableBudgetScope,
} from "./ai-selling";
import { SIC_SYSTEM } from "./ai-selling-queries";
import type { ObjectionPreview } from "@/lib/agent/objection-preview";

/**
 * Server actions for Settings -> AI & selling. Every write runs a registry
 * operation (`sales_settings.update`, `ai_budget.update`,
 * `legitimate_interest.save`), so the settings page, Copilot and MCP change the
 * same rows with the same validation and the same audit trail. The role is
 * checked here for a clear message and again by the runtime.
 */

export type SettingsActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

async function admin(): Promise<ActiveWorkspace | null> {
  return actor("admin");
}

async function actor(minimum: BusinessRole): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole(minimum);
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

function finish(result: ServiceResult, success: string): SettingsActionResult {
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath("/app/settings");
  const warning = result.warnings[0]?.message;
  return { ok: true, message: warning ? `${success} ${warning}` : success };
}

const DENIED = "Only an owner or admin can change these settings.";

/* ------------------------------------------------------------- strategy */

// The automation level (agent mode) has no action here: its one editor is
// Settings -> Workspace -> AI assistant (`saveAiBehaviour`), which writes it
// through the same `ai_settings.update` operation. AI & selling shows it
// read-only.

/* -------------------------------------------------------- sales settings */

export async function saveSalesSettingsAction(input: unknown): Promise<SettingsActionResult> {
  const parsed = salesSettingsUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the settings and try again." };
  }
  const workspace = await admin();
  if (!workspace) return { ok: false, error: DENIED };
  const result = await runOperation("sales_settings.update", parsed.data, context(workspace));
  return finish(result, "Saved.");
}

/* ----------------------------------------------------------------- budgets */

const budgetFormSchema = z.object(
  Object.fromEntries(EDITABLE_BUDGET_SCOPES.map((scope) => [scope, z.string().max(20)])) as Record<
    EditableBudgetScope,
    z.ZodString
  >,
);

export async function saveBudgetsAction(input: unknown): Promise<SettingsActionResult> {
  const shape = budgetFormSchema.safeParse(input);
  if (!shape.success) return { ok: false, error: "Check the amounts and try again." };
  const parsed = parseBudgetForm(shape.data);
  if (!parsed.ok) {
    return { ok: false, error: "Some amounts are not valid.", fieldErrors: parsed.errors };
  }
  const workspace = await admin();
  if (!workspace) return { ok: false, error: DENIED };
  const result = await runOperation("ai_budget.update", parsed.values, context(workspace));
  if (!result.success && result.code === "INVALID_INPUT") {
    // The operation names the field first ("LEAD: ..."), so it can be shown
    // against the right input.
    const match = /^([A-Z_]+): (.+)$/.exec(result.message);
    if (match && (EDITABLE_BUDGET_SCOPES as readonly string[]).includes(match[1])) {
      return { ok: false, error: match[2], fieldErrors: { [match[1]]: match[2] } };
    }
  }
  return finish(result, "AI limits saved.");
}

/* --------------------------------------------------------------------- LIA */

export async function saveLiaAction(input: unknown): Promise<SettingsActionResult> {
  const parsed = liaSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, error: "Some fields need attention.", fieldErrors };
  }
  const workspace = await admin();
  if (!workspace) return { ok: false, error: DENIED };
  const result = await runOperation("legitimate_interest.save", parsed.data, context(workspace));
  return finish(result, "Assessment saved.");
}

/* ------------------------------------------------------- industry search */

export type IndustryCodeOption = { code: string; title: string; level: string };

/**
 * Searches UK SIC 2026 by code, title or plain-language alias. A read of
 * platform reference data (no business_id), so any member of a workspace may
 * search; saving the choice is the admin-only operation above.
 */
export async function searchIndustryCodesAction(query: unknown): Promise<IndustryCodeOption[]> {
  const parsed = z.string().trim().min(2).max(60).safeParse(query);
  if (!parsed.success) return [];
  const workspace = await actor("viewer");
  if (!workspace) return [];

  // PostgREST filter syntax is comma- and paren-delimited, so those are
  // stripped rather than escaped: this is a search box, not a query language.
  const term = parsed.data.replace(/[%,()\\*]/g, " ").trim();
  if (!term) return [];
  const db = createAdminClient();

  const [codes, aliases] = await Promise.all([
    db
      .from("industry_codes")
      .select("code, title, level")
      .eq("system", SIC_SYSTEM)
      .in("level", ["CLASS", "SUBCLASS"])
      .or(`code.ilike.${term}%,title.ilike.%${term}%,numeric_code.ilike.${term}%`)
      .order("code")
      .limit(20),
    db.from("industry_aliases").select("code").eq("system", SIC_SYSTEM).ilike("alias", `%${term}%`).limit(20),
  ]);
  if (codes.error || aliases.error) return [];

  const found = new Map<string, IndustryCodeOption>();
  for (const row of codes.data ?? []) found.set(row.code, row);

  const aliasCodes = [...new Set((aliases.data ?? []).map((row) => row.code))].filter((code) => !found.has(code));
  if (aliasCodes.length > 0) {
    const { data, error } = await db
      .from("industry_codes")
      .select("code, title, level")
      .eq("system", SIC_SYSTEM)
      .in("code", aliasCodes);
    if (!error) for (const row of data ?? []) found.set(row.code, row);
  }

  return [...found.values()].slice(0, 25);
}

/* ------------------------------------------------- qualification policy */

/**
 * Saves one scope of the qualification policy (the workspace, or one offer)
 * exactly as the form shows it. From Settings the policy may be widened as
 * well as narrowed; the operation still validates, checks the subscription
 * and audits the before and after.
 */
export async function saveQualificationPolicyAction(input: unknown): Promise<SettingsActionResult> {
  const parsed = qualificationPolicyUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue ? `${issue.path.join(".") || "policy"}: ${issue.message}` : "Check the policy and try again." };
  }
  const workspace = await admin();
  if (!workspace) return { ok: false, error: DENIED };
  const result = await runOperation(
    "qualification.policy_update",
    { ...parsed.data, mode: "replace" },
    context(workspace),
  );
  return finish(result, "Qualification policy saved.");
}

/* ------------------------------------------------------ scoring weights */

export async function saveScoringWeightsAction(input: unknown): Promise<SettingsActionResult> {
  const parsed = z.object({ weights: scoringWeightsSchema.nullable() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the weights and try again." };
  }
  const workspace = await admin();
  if (!workspace) return { ok: false, error: DENIED };
  const result = await runOperation("scoring_weights.update", parsed.data, context(workspace));
  return finish(result, parsed.data.weights ? "Scoring weights saved." : "Scoring weights reset to the default.");
}

/* -------------------------------------------------------------- objections */

// Settings -> AI & selling -> Objections. Each write runs a registry
// operation (`sales_objections.*`), so Copilot and MCP change the same rows
// with the same checks (no emojis, dashes or pressure in the business's own
// words) and the same audit trail.

export async function saveObjectionAction(input: unknown): Promise<SettingsActionResult> {
  const workspace = await admin();
  if (!workspace) return { ok: false, error: DENIED };
  const result = await runOperation("sales_objections.save", input, context(workspace));
  return finish(result, "Objection saved.");
}

export async function removeObjectionAction(input: unknown): Promise<SettingsActionResult> {
  const workspace = await admin();
  if (!workspace) return { ok: false, error: DENIED };
  const result = await runOperation("sales_objections.remove", input, context(workspace));
  return finish(result, "Objection removed. The library playbook applies again.");
}

export async function saveReassuranceAction(input: unknown): Promise<SettingsActionResult> {
  const workspace = await admin();
  if (!workspace) return { ok: false, error: DENIED };
  const result = await runOperation("sales_objections.save_reassurance", input, context(workspace));
  return finish(result, "Reassurance saved.");
}

/** "Try it": offline, no AI spend. Anyone who can see the settings may try it. */
export async function previewObjectionAction(input: unknown): Promise<SettingsActionResult<ObjectionPreview>> {
  const workspace = await actor("viewer");
  if (!workspace) return { ok: false, error: "Sign in to try an objection." };
  const result = await runOperation<ObjectionPreview>("sales_objections.preview", input, context(workspace));
  if (!result.success) return { ok: false, error: result.message };
  return { ok: true, message: "Preview ready.", data: result.data };
}
