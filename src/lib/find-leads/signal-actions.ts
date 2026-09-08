"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { assertCapability } from "@/lib/billing/v4-entitlements";
import { EntitlementError } from "@/lib/billing/entitlements";
import { createRun } from "./server/runs";
import { parsePlan } from "./plan";
import type { ActionResult } from "./actions";

/**
 * Pausing and launching individual signals.
 *
 * Both are admin acts for the same reason: a signal is a search that spends
 * provider money, and "run this now" is a spend decision rather than a view
 * preference. Pausing is the cheaper direction and is still restricted, because
 * silently switching off the search that produces a workspace's pipeline is not
 * something a member should be able to do unnoticed.
 */

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

async function requireSignalAdmin() {
  try {
    const workspace = await requireRole("admin");
    await assertCapability(workspace.businessId, "sourcing");
    return { ok: true as const, workspace };
  } catch (error) {
    if (error instanceof EntitlementError) return fail(error.message);
    return fail("Only owners and admins can change lead sources.");
  }
}

export async function setSignalActiveAction(
  signalId: unknown,
  active: unknown,
): Promise<ActionResult<{ active: boolean }>> {
  const parsed = z
    .object({ signalId: z.uuid(), active: z.boolean() })
    .safeParse({ signalId, active });
  if (!parsed.success) return fail("That signal could not be updated.");

  const access = await requireSignalAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("sourcing_signals")
    .update({
      active: parsed.data.active,
      // A paused signal has no next run. Leaving the timestamp behind would
      // show "runs in 3 hours" beside a signal that will not run at all.
      ...(parsed.data.active ? {} : { next_run_at: null }),
    })
    .eq("business_id", access.workspace.businessId)
    .eq("id", parsed.data.signalId)
    .select("id, name")
    .maybeSingle();

  if (error || !data) return fail("That signal could not be found.");

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: parsed.data.active ? "signal.resumed" : "signal.paused",
    entityType: "sourcing_signal",
    entityId: data.id,
    metadata: { name: data.name },
  });

  revalidatePath("/app/find-leads");
  return ok({ active: parsed.data.active });
}

/**
 * Runs one signal now rather than on its schedule.
 *
 * Goes through `createRun` -- the same function the recurring scheduler and the
 * manual launch both use -- rather than queueing a job directly. That matters
 * more than it looks: `createRun` is where the budget clamp, the entitlement
 * check and the auto-contact permission live, and a second path to a run is a
 * second path that has to remember all three. An earlier version of this
 * function enqueued `sourcing.run` with its own payload shape, which the
 * handler could not even parse.
 *
 * Only an APPROVED strategy may run. A draft or superseded plan means the
 * customer changed the targeting and has not re-approved it, and running the
 * old one would spend money on a search they have already rejected.
 */
export async function launchSignalAction(
  signalId: unknown,
): Promise<ActionResult<{ runId: string }>> {
  const parsed = z.uuid().safeParse(signalId);
  if (!parsed.success) return fail("That signal could not be found.");

  const access = await requireSignalAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data: signal } = await admin
    .from("sourcing_signals")
    .select("id, name, active, search_strategy_id, session_id")
    .eq("business_id", access.workspace.businessId)
    .eq("id", parsed.data)
    .maybeSingle();

  if (!signal) return fail("That signal could not be found.");
  if (!signal.active) {
    return fail("This signal is paused. Resume it before running it.");
  }
  if (!signal.search_strategy_id) {
    return fail(
      "This signal has no approved search behind it yet, so there is nothing to run.",
    );
  }

  const { data: strategy } = await admin
    .from("search_strategies")
    .select("id, strategy_json, status")
    .eq("business_id", access.workspace.businessId)
    .eq("id", signal.search_strategy_id)
    .maybeSingle();

  if (strategy?.status !== "APPROVED") {
    return fail(
      "The search behind this signal has been edited and not re-approved, so it cannot run yet.",
    );
  }

  // `parsePlan` returns null for a strategy whose stored JSON no longer matches
  // the schema -- an older plan shape, or a hand-edited row. Refused rather than
  // coerced: running a half-understood plan spends real money on targeting
  // nobody approved.
  const plan = parsePlan(strategy.strategy_json);
  if (!plan) {
    return fail(
      "The saved search behind this signal could not be read. Open it and approve it again.",
    );
  }

  const result = await createRun({
    businessId: access.workspace.businessId,
    userId: access.workspace.userId,
    sessionId: signal.session_id,
    strategyId: signal.search_strategy_id,
    plan,
    triggerSource: "MANUAL",
  });

  // `createRun` refuses for real reasons -- no budget, no entitlement, a plan
  // that is not ready -- and each carries its own sentence. Passing it through
  // is what makes "why did nothing happen" answerable from the button.
  if (!result.ok) return fail(result.message);

  await admin
    .from("sourcing_signals")
    .update({ last_run_id: result.runId })
    .eq("business_id", access.workspace.businessId)
    .eq("id", signal.id);

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "signal.launched",
    entityType: "sourcing_signal",
    entityId: signal.id,
    metadata: { name: signal.name, runId: result.runId, manual: true },
  });

  revalidatePath("/app/find-leads");
  return ok({ runId: result.runId });
}
