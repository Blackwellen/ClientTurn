"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCapacity, getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { EntitlementError } from "@/lib/billing/entitlements";
import { recordAudit } from "@/lib/audit";
import { SIGNAL_SOURCES, clampFreshness, clampScoreImpact } from "./types";

/**
 * Intent mutations.
 *
 * Every write is `requireRole("admin")` then the service role, scoped to the
 * caller's workspace — the pattern used throughout this codebase.
 *
 * Two bounds are enforced here rather than trusted from the form: a category's
 * score impact is clamped to §15.4's ceiling, and the number of ACTIVE monitors
 * is checked against the plan before one can be started. Both are ceilings a
 * customer cannot raise for themselves.
 */

const SOURCE_KEYS = Object.keys(SIGNAL_SOURCES) as [string, ...string[]];

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const categorySchema = z.object({
  id: z.union([z.uuid(), z.literal("")]).optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).default(""),
  signalTypes: z.array(z.enum(SOURCE_KEYS)).min(1).max(SOURCE_KEYS.length),
  freshnessDays: z.coerce.number().int(),
  scoreImpact: z.coerce.number(),
  autoAddToSearch: z.boolean().default(false),
});

export async function saveIntentCategory(input: unknown): Promise<ActionResult> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Give the category a name and at least one signal source." };
  }

  const workspace = await requireRole("admin");
  const value = parsed.data;
  const db = createAdminClient();

  const row = {
    business_id: workspace.businessId,
    name: value.name,
    description: value.description || null,
    signal_types: value.signalTypes as never,
    // Clamped, not validated-and-rejected: a form that offers 0-25 should not
    // fail because someone typed 30, it should record 25.
    freshness_days: clampFreshness(value.freshnessDays),
    score_impact: clampScoreImpact(value.scoreImpact),
    auto_add_to_search: value.autoAddToSearch,
  };

  if (value.id) {
    const { error } = await db
      .from("intent_categories")
      .update(row)
      .eq("id", value.id)
      .eq("business_id", workspace.businessId);
    if (error) return { ok: false, error: "That category could not be saved." };

    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "intent_category.updated",
      entityType: "intent_category",
      entityId: value.id,
      metadata: { name: value.name },
    });

    revalidatePath("/app/find-leads");
    return { ok: true, id: value.id };
  }

  const { data, error } = await db
    .from("intent_categories")
    .insert(row)
    .select("id")
    .single();

  // A duplicate name inside one workspace is a user error, not a crash.
  if (error?.code === "23505") {
    return { ok: false, error: "You already have a category with that name." };
  }
  if (error || !data) return { ok: false, error: "That category could not be created." };

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "intent_category.created",
    entityType: "intent_category",
    entityId: data.id,
    metadata: { name: value.name },
  });

  revalidatePath("/app/find-leads");
  return { ok: true, id: data.id };
}

export async function setIntentCategoryActive(
  id: unknown,
  active: unknown,
): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid(), active: z.boolean() }).safeParse({ id, active });
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { error } = await db
    .from("intent_categories")
    .update({ active: parsed.data.active })
    .eq("id", parsed.data.id)
    .eq("business_id", workspace.businessId);

  if (error) return { ok: false, error: "That category could not be updated." };

  // Pausing a category pauses its monitors: leaving them running would keep
  // spending on signals the category no longer scores.
  if (!parsed.data.active) {
    await db
      .from("intent_monitors")
      .update({ status: "PAUSED", next_run_at: null })
      .eq("business_id", workspace.businessId)
      .eq("intent_category_id", parsed.data.id)
      .eq("status", "ACTIVE");
  }

  revalidatePath("/app/find-leads");
  return { ok: true };
}

const monitorSchema = z.object({
  categoryId: z.uuid(),
  name: z.string().trim().max(80).default(""),
  monitorType: z.enum(["ICP", "NAMED_COMPANIES", "FIRST_PARTY"]),
  cadence: z.enum(["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY"]),
  icpProfileIds: z.array(z.uuid()).max(20).default([]),
  companies: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
});

export async function createIntentMonitor(input: unknown): Promise<ActionResult> {
  const parsed = monitorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the monitor settings and try again." };

  const workspace = await requireRole("admin");
  const value = parsed.data;

  // A monitor costs money every time it runs, so the plan limit is checked
  // before one can exist — not when it first fires.
  try {
    await assertCapacity(workspace.businessId, "intent_monitor");
  } catch (error) {
    if (error instanceof EntitlementError) return { ok: false, error: error.message };
    return { ok: false, error: "Monitor capacity could not be confirmed." };
  }

  const db = createAdminClient();

  const { data: category } = await db
    .from("intent_categories")
    .select("id")
    .eq("id", value.categoryId)
    .eq("business_id", workspace.businessId)
    .maybeSingle();
  if (!category) return { ok: false, error: "That intent category no longer exists." };

  if (value.monitorType === "ICP" && value.icpProfileIds.length === 0) {
    return { ok: false, error: "Choose at least one customer profile to watch." };
  }
  if (value.monitorType === "NAMED_COMPANIES" && value.companies.length === 0) {
    return { ok: false, error: "Add at least one company to watch." };
  }

  const { data, error } = await db
    .from("intent_monitors")
    .insert({
      business_id: workspace.businessId,
      intent_category_id: value.categoryId,
      name: value.name || null,
      monitor_type: value.monitorType,
      cadence: value.cadence,
      target_json: {
        icpProfileIds: value.icpProfileIds,
        companies: value.companies,
      } as never,
      status: "ACTIVE",
      // Due immediately: a monitor someone just created should show a result
      // rather than waiting a full cadence to prove it works.
      next_run_at: new Date().toISOString(),
      period_started_on: new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: "That monitor could not be created." };

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "intent_monitor.created",
    entityType: "intent_monitor",
    entityId: data.id,
    metadata: { monitorType: value.monitorType, cadence: value.cadence },
  });

  revalidatePath("/app/find-leads");
  return { ok: true, id: data.id };
}

export async function controlIntentMonitor(
  id: unknown,
  command: unknown,
): Promise<ActionResult> {
  const parsed = z
    .object({ id: z.uuid(), command: z.enum(["pause", "resume", "stop"]) })
    .safeParse({ id, command });
  if (!parsed.success) return { ok: false, error: "Invalid monitor control." };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  if (parsed.data.command === "resume") {
    const entitlements = await getV4Entitlements(workspace.businessId);
    const { count } = await db
      .from("intent_monitors")
      .select("id", { count: "exact", head: true })
      .eq("business_id", workspace.businessId)
      .eq("status", "ACTIVE");

    if ((count ?? 0) >= entitlements.allowances.intent_monitor.hardLimit) {
      return {
        ok: false,
        error: "You have as many active monitors as your plan allows. Pause one first.",
      };
    }
  }

  const status =
    parsed.data.command === "resume"
      ? "ACTIVE"
      : parsed.data.command === "pause"
        ? "PAUSED"
        : "STOPPED";

  const { error } = await db
    .from("intent_monitors")
    .update({
      status,
      next_run_at: status === "ACTIVE" ? new Date().toISOString() : null,
      last_error: null,
    })
    .eq("id", parsed.data.id)
    .eq("business_id", workspace.businessId);

  if (error) return { ok: false, error: "That monitor could not be updated." };

  revalidatePath("/app/find-leads");
  return { ok: true };
}
