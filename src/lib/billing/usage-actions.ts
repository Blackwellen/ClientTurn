"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { loadSenderHealth } from "@/lib/outreach/campaigns/sender";
import {
  ALLOCATION_CHANNELS,
  MAX_OVERAGE_CAP_MINOR,
  effectiveDailyCap,
  validateAllocation,
  validateOverage,
  type Allocation,
  type AllocationChannel,
} from "./usage-allocation";

/**
 * Billing & Usage writes (V4 §27).
 *
 * Every value the browser sends is treated as a *request*, not a setting. The
 * server re-derives the ceiling from plan entitlements and sender health and
 * clamps to it, so a hand-crafted request cannot raise a daily cap, exceed the
 * account's overage maximum, or store an allocation that does not total 100%.
 *
 * Billing is owner-and-admin territory; a member cannot change what the
 * workspace spends.
 */

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function fail(error: string): Result<never> {
  return { ok: false, error };
}

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

async function requireBillingAdmin() {
  const workspace = await requireWorkspace();
  if (!hasRole(workspace.role, "admin")) return null;
  return workspace;
}

/** Ensures the period row exists so every write is a simple update. */
async function upsertPeriodRow(businessId: string, userId: string) {
  const admin = createAdminClient();
  const period = currentPeriod();

  const { data } = await admin
    .from("customer_usage_allocations")
    .select("id")
    .eq("business_id", businessId)
    .eq("billing_period", period)
    .maybeSingle();

  if (data) return { id: data.id, period };

  const { data: created } = await admin
    .from("customer_usage_allocations")
    .insert({
      business_id: businessId,
      billing_period: period,
      updated_by: userId,
    })
    .select("id")
    .single();

  return created ? { id: created.id, period } : null;
}

/* ------------------------------------------------------------- allocation */

const allocationSchema = z.object({
  email: z.number().min(0).max(100),
  sms: z.number().min(0).max(100),
  whatsapp: z.number().min(0).max(100),
});

export async function saveAllocation(input: unknown): Promise<Result<undefined>> {
  const parsed = allocationSchema.safeParse(input);
  if (!parsed.success) return fail("That allocation is not valid.");

  const workspace = await requireBillingAdmin();
  if (!workspace) return fail("Only an owner or admin can change billing settings.");

  const allocation: Allocation = {
    email: Math.round(parsed.data.email),
    sms: Math.round(parsed.data.sms),
    whatsapp: Math.round(parsed.data.whatsapp),
  };

  // Rejected rather than silently normalised: quietly rescaling someone's
  // numbers means the figure they set is not the figure that applies.
  const issues = validateAllocation(allocation);
  if (issues.length > 0) return fail(issues[0].message);

  const row = await upsertPeriodRow(workspace.businessId, workspace.userId);
  if (!row) return fail("That change could not be saved.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("customer_usage_allocations")
    .update({
      email_percent: allocation.email,
      sms_percent: allocation.sms,
      whatsapp_percent: allocation.whatsapp,
      updated_by: workspace.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("That change could not be saved.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "billing.allocation_changed",
    entityType: "customer_usage_allocation",
    entityId: row.id,
    metadata: { ...allocation, period: row.period },
  });

  revalidatePath("/app/settings");
  return ok(undefined);
}

/* ------------------------------------------------------------ daily caps */

const capsSchema = z.object({
  email: z.number().int().min(0).max(100000),
  sms: z.number().int().min(0).max(100000),
  whatsapp: z.number().int().min(0).max(100000),
});

/**
 * Daily sending caps.
 *
 * A customer may lower a cap; they may never raise it above the effective
 * ceiling. Whatever they send is clamped here, and the clamped value is what is
 * stored — so the number they see afterwards is the number that applies.
 */
export async function saveDailyCaps(input: unknown): Promise<Result<undefined>> {
  const parsed = capsSchema.safeParse(input);
  if (!parsed.success) return fail("Those limits are not valid.");

  const workspace = await requireBillingAdmin();
  if (!workspace) return fail("Only an owner or admin can change billing settings.");

  const [v4, senders] = await Promise.all([
    getV4Entitlements(workspace.businessId),
    loadSenderHealth(workspace.businessId),
  ]);

  const monthlyAllowance = v4.allowances.email_sent.hardLimit || 0;
  const senderCapacity = senders
    .filter((sender) => sender.warmState !== "BLOCKED")
    .reduce((sum, sender) => sum + sender.dailySendCap, 0);

  const planCaps: Record<AllocationChannel, number> = {
    email: Math.max(50, Math.round(monthlyAllowance / 20)),
    sms: Math.max(20, Math.round(monthlyAllowance / 80)),
    whatsapp: Math.max(20, Math.round(monthlyAllowance / 80)),
  };

  const clamped: Record<string, number> = {};
  for (const channel of ALLOCATION_CHANNELS) {
    clamped[channel] = effectiveDailyCap({
      channel,
      requested: parsed.data[channel],
      planCap: planCaps[channel],
      senderCapacity: channel === "email" ? senderCapacity : undefined,
    });
  }

  const row = await upsertPeriodRow(workspace.businessId, workspace.userId);
  if (!row) return fail("That change could not be saved.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("customer_usage_allocations")
    .update({
      daily_caps_json: clamped,
      updated_by: workspace.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("That change could not be saved.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "billing.allocation_changed",
    entityType: "customer_usage_allocation",
    entityId: row.id,
    metadata: { daily_caps: clamped, requested: parsed.data },
  });

  revalidatePath("/app/settings");
  return ok(undefined);
}

/* ---------------------------------------------------------------- overage */

const overageSchema = z.object({
  enabled: z.boolean(),
  capMinor: z.number().int().min(0).max(MAX_OVERAGE_CAP_MINOR),
  /** The customer typed the confirmation phrase in the dialog. */
  confirmed: z.boolean(),
});

/**
 * Automatic overage.
 *
 * Off by default and only ever switched on by an explicit, confirmed action:
 * this is the one setting on the page that can increase what the customer is
 * charged, so it is never a silent toggle.
 */
export async function saveOverage(input: unknown): Promise<Result<undefined>> {
  const parsed = overageSchema.safeParse(input);
  if (!parsed.success) return fail("That overage setting is not valid.");

  const workspace = await requireBillingAdmin();
  if (!workspace) return fail("Only an owner or admin can change billing settings.");

  if (parsed.data.enabled && !parsed.data.confirmed) {
    return fail("Confirm that you understand overage charges before enabling it.");
  }

  const v4 = await getV4Entitlements(workspace.businessId);
  const accountMaxMinor = v4.allowances.email_sent.overageAllowed ? 500_00 : 0;

  if (parsed.data.enabled && accountMaxMinor === 0) {
    return fail("Overage is not available on your current plan.");
  }

  const issues = validateOverage({
    enabled: parsed.data.enabled,
    capMinor: parsed.data.capMinor,
    accountMaxMinor,
  });
  if (issues.length > 0) return fail(issues[0].message);

  const row = await upsertPeriodRow(workspace.businessId, workspace.userId);
  if (!row) return fail("That change could not be saved.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("customer_usage_allocations")
    .update({
      overage_enabled: parsed.data.enabled,
      // Turning overage off zeroes the cap, so re-enabling it is a fresh,
      // deliberate decision rather than a resurrected old number.
      overage_cap_minor: parsed.data.enabled ? parsed.data.capMinor : 0,
      updated_by: workspace.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("That change could not be saved.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: parsed.data.enabled
      ? "billing.overage_changed"
      : "billing.spend_cap_changed",
    entityType: "customer_usage_allocation",
    entityId: row.id,
    metadata: {
      enabled: parsed.data.enabled,
      cap_minor: parsed.data.enabled ? parsed.data.capMinor : 0,
    },
  });

  revalidatePath("/app/settings");
  return ok(undefined);
}
