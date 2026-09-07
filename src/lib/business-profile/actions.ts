"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canOverwrite, type FactSourceType } from "./precedence";
import { recordAudit } from "@/lib/audit";
import { CONVERSION_GOAL_TYPES } from "./types";

/**
 * Business Profile mutations.
 *
 * The rule §54.2 exists to protect: an inference may propose, but only a person
 * confirms. `setFactVerified` and `lockFact` are how a customer pins a fact, and
 * `upsertFact` refuses to overwrite a locked one — the check lives here rather
 * than in whatever writes a fact next.
 */

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

/* ------------------------------------------------------------------ facts */

const factSchema = z.object({
  factKey: z.string().trim().min(1).max(120),
  value: z.string().trim().max(2000),
  /** Who is asserting this. Defaults to the person typing it. */
  source: z
    .enum(["USER", "WEBSITE", "INTEGRATION", "PERFORMANCE", "AI"])
    .default("USER"),
  /** Optional temporal validity, for seasonal offers and temporary areas. */
  validFrom: z.string().datetime().nullable().optional(),
  validTo: z.string().datetime().nullable().optional(),
});

/**
 * Writes a fact, subject to precedence (V4 §26.20).
 *
 * A fact a person types is USER-sourced, verified and locked by definition —
 * they just said it, and nothing inferred may then overwrite it. Anything not
 * typed by a person (a website read, an integration, a performance insight, or
 * Copilot) must win on precedence before it is allowed to replace what is
 * already recorded, and is *never* allowed to replace a locked fact.
 */
export async function saveFact(input: unknown): Promise<ActionResult> {
  const parsed = factSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give the fact a name and a value." };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const byPerson = parsed.data.source === "USER";

  const { data: existing } = await db
    .from("business_memory_facts")
    .select("id, source_type, verified_by_user, locked, confidence, last_verified_at")
    .eq("business_id", workspace.businessId)
    .eq("fact_key", parsed.data.factKey)
    .maybeSingle();

  if (existing) {
    const verdict = canOverwrite(
      {
        sourceType: existing.source_type as FactSourceType,
        verifiedByUser: existing.verified_by_user,
        locked: existing.locked,
        confidence: Number(existing.confidence),
        lastVerifiedAt: existing.last_verified_at,
      },
      {
        sourceType: parsed.data.source as FactSourceType,
        verifiedByUser: byPerson,
        locked: byPerson,
        // A person's own statement is certain; anything else arrives with the
        // confidence its source earned.
        confidence: byPerson ? 1 : 0.8,
      },
    );

    if (!verdict.allowed) return { ok: false, error: verdict.reason };
  }

  const { error } = await db.from("business_memory_facts").upsert(
    {
      business_id: workspace.businessId,
      fact_key: parsed.data.factKey,
      value_json: { value: parsed.data.value } as never,
      source_type: parsed.data.source,
      confidence: byPerson ? 1 : 0.8,
      verified_by_user: byPerson,
      locked: byPerson,
      valid_from: parsed.data.validFrom ?? null,
      valid_to: parsed.data.validTo ?? null,
      last_verified_at: byPerson ? new Date().toISOString() : null,
    },
    { onConflict: "business_id,fact_key" },
  );

  if (error) return { ok: false, error: "That fact could not be saved." };

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "business_fact.saved",
    entityType: "business_memory_fact",
    metadata: { fact_key: parsed.data.factKey, source: parsed.data.source },
  });

  revalidatePath("/app/settings");
  return { ok: true };
}

/**
 * Marks a fact as confirmed by a person without changing its value.
 *
 * This is the cheap, common action: "yes, that is still right". It refreshes
 * the freshness clock and promotes the fact above anything inferred.
 */
export async function verifyFact(id: unknown): Promise<ActionResult> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { error } = await db
    .from("business_memory_facts")
    .update({
      verified_by_user: true,
      last_verified_at: new Date().toISOString(),
    })
    .eq("id", parsed.data)
    .eq("business_id", workspace.businessId);

  if (error) return { ok: false, error: "That fact could not be verified." };

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "business_fact.verified",
    entityType: "business_memory_fact",
    entityId: parsed.data,
  });

  revalidatePath("/app/settings");
  return { ok: true };
}

/* ------------------------------------------------------- outreach guidance */

const guidanceSchema = z.object({
  tone: z.string().trim().max(400).nullable().optional(),
  keyMessages: z.string().trim().max(1200).nullable().optional(),
  valueProposition: z.string().trim().max(1200).nullable().optional(),
  proofPoints: z.string().trim().max(1200).nullable().optional(),
  avoid: z.string().trim().max(1200).nullable().optional(),
  callToAction: z.string().trim().max(400).nullable().optional(),
  claimRestrictions: z.string().trim().max(1200).nullable().optional(),
});

/**
 * The structured guidance campaign and message generators read (V4 §26.19).
 *
 * Authored by the customer and stored as its own row rather than as an
 * inferred memory fact: this is an instruction about how to represent the
 * business, and it must never be something the product decided for itself.
 */
export async function saveOutreachGuidance(input: unknown): Promise<ActionResult> {
  const parsed = guidanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That guidance could not be saved." };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { error } = await db.from("business_profiles").upsert(
    {
      business_id: workspace.businessId,
      outreach_tone: parsed.data.tone ?? null,
      outreach_key_messages: parsed.data.keyMessages ?? null,
      outreach_value_proposition: parsed.data.valueProposition ?? null,
      outreach_proof_points: parsed.data.proofPoints ?? null,
      outreach_avoid: parsed.data.avoid ?? null,
      outreach_call_to_action: parsed.data.callToAction ?? null,
      outreach_claim_restrictions: parsed.data.claimRestrictions ?? null,
      outreach_guidance_updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" },
  );

  if (error) return { ok: false, error: "That guidance could not be saved." };

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "outreach_guidance.updated",
    entityType: "business_profile",
  });

  revalidatePath("/app/settings");
  return { ok: true };
}

export async function setFactLocked(id: unknown, locked: unknown): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid(), locked: z.boolean() }).safeParse({ id, locked });
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { error } = await db
    .from("business_memory_facts")
    .update({
      locked: parsed.data.locked,
      // Locking is an act of confirmation, so it also marks the fact verified.
      verified_by_user: parsed.data.locked ? true : undefined,
      last_verified_at: parsed.data.locked ? new Date().toISOString() : undefined,
    })
    .eq("id", parsed.data.id)
    .eq("business_id", workspace.businessId);

  if (error) return { ok: false, error: "That fact could not be updated." };

  revalidatePath("/app/settings");
  return { ok: true };
}

export async function deleteFact(id: unknown): Promise<ActionResult> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  await db
    .from("business_memory_facts")
    .delete()
    .eq("id", parsed.data)
    .eq("business_id", workspace.businessId);

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "business_fact.deleted",
    entityType: "business_memory_fact",
    entityId: parsed.data,
  });

  revalidatePath("/app/settings");
  return { ok: true };
}

/* ------------------------------------------------------------------- ICPs */

const icpSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]).optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).default(""),
  industries: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  locations: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  roles: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  employeeMin: z.coerce.number().int().min(0).max(1_000_000).nullable().default(null),
  employeeMax: z.coerce.number().int().min(0).max(1_000_000).nullable().default(null),
});

export async function saveIcpProfile(input: unknown): Promise<ActionResult> {
  const parsed = icpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Give the profile a name and at least one industry or location." };
  }

  const workspace = await requireRole("admin");
  const value = parsed.data;

  if (value.industries.length === 0 && value.locations.length === 0) {
    return {
      ok: false,
      error: "A profile with no industry and no location would match everyone. Add at least one.",
    };
  }
  if (
    value.employeeMin !== null &&
    value.employeeMax !== null &&
    value.employeeMin > value.employeeMax
  ) {
    return { ok: false, error: "The smallest company size cannot exceed the largest." };
  }

  const db = createAdminClient();
  const row = {
    business_id: workspace.businessId,
    name: value.name,
    description: value.description || null,
    industries: value.industries as never,
    locations: value.locations as never,
    roles: value.roles as never,
    company_filters: {
      ...(value.employeeMin !== null ? { employeeMin: value.employeeMin } : {}),
      ...(value.employeeMax !== null ? { employeeMax: value.employeeMax } : {}),
    } as never,
    source: "USER" as const,
  };

  if (value.id) {
    const { error } = await db
      .from("icp_profiles")
      .update(row)
      .eq("id", value.id)
      .eq("business_id", workspace.businessId);
    if (error) return { ok: false, error: "That profile could not be saved." };
    revalidatePath("/app/settings");
    return { ok: true, id: value.id };
  }

  const { data, error } = await db.from("icp_profiles").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: "That profile could not be created." };

  revalidatePath("/app/settings");
  return { ok: true, id: data.id };
}

export async function setIcpActive(id: unknown, active: unknown): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid(), active: z.boolean() }).safeParse({ id, active });
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  const { error } = await db
    .from("icp_profiles")
    .update({ active: parsed.data.active })
    .eq("id", parsed.data.id)
    .eq("business_id", workspace.businessId);

  if (error) return { ok: false, error: "That profile could not be updated." };

  revalidatePath("/app/settings");
  return { ok: true };
}

/* -------------------------------------------------------- conversion goals */

const goalSchema = z.object({
  id: z.union([z.uuid(), z.literal("")]).optional(),
  name: z.string().trim().min(2).max(80),
  type: z.enum(CONVERSION_GOAL_TYPES),
  destinationType: z.enum([
    "CALENDLY",
    "GOOGLE_CALENDAR",
    "URL",
    "WEBHOOK",
    "PHONE",
    "TEAM_HANDOVER",
  ]),
  destinationValue: z.string().trim().max(500).default(""),
  qualificationRequired: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

export async function saveConversionGoal(input: unknown): Promise<ActionResult> {
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the goal name and destination." };

  const workspace = await requireRole("admin");
  const value = parsed.data;

  // A URL destination that is not a URL would fail silently at send time.
  if (value.destinationType === "URL" || value.destinationType === "WEBHOOK") {
    if (!/^https:\/\/\S+$/i.test(value.destinationValue)) {
      return { ok: false, error: "Enter a full https:// address for this destination." };
    }
  }

  const db = createAdminClient();

  // Exactly one default per workspace: the partial unique index enforces it, so
  // the previous default is cleared first rather than colliding.
  if (value.isDefault) {
    await db
      .from("conversion_goals")
      .update({ is_default: false })
      .eq("business_id", workspace.businessId)
      .eq("is_default", true);
  }

  const row = {
    business_id: workspace.businessId,
    name: value.name,
    type: value.type,
    destination_type: value.destinationType,
    destination_config: { value: value.destinationValue } as never,
    qualification_required: value.qualificationRequired,
    is_default: value.isDefault,
  };

  if (value.id) {
    const { error } = await db
      .from("conversion_goals")
      .update(row)
      .eq("id", value.id)
      .eq("business_id", workspace.businessId);
    if (error) return { ok: false, error: "That goal could not be saved." };
    revalidatePath("/app/settings");
    return { ok: true, id: value.id };
  }

  const { data, error } = await db.from("conversion_goals").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: "That goal could not be created." };

  revalidatePath("/app/settings");
  return { ok: true, id: data.id };
}

/* --------------------------------------------------------------- analysis */

export async function analyseWebsite(url: unknown): Promise<ActionResult> {
  const parsed = z.string().trim().url().max(300).safeParse(url);
  if (!parsed.success) return { ok: false, error: "Enter the full address of your website." };

  const workspace = await requireRole("admin");
  const db = createAdminClient();

  await db.from("business_profiles").upsert(
    {
      business_id: workspace.businessId,
      website_url: parsed.data,
      analysis_status: "QUEUED",
      analysis_error: null,
    },
    { onConflict: "business_id" },
  );

  // The fetch happens on the queue, never in this request: reading a website
  // is slow and a server action that blocked on it would time out.
  const { enqueue } = await import("@/lib/jobs/queue");
  await enqueue(
    "business.analyse",
    { businessId: workspace.businessId, url: parsed.data },
    {
      businessId: workspace.businessId,
      idempotencyKey: `business.analyse:${workspace.businessId}:${parsed.data}`,
    },
  );

  revalidatePath("/app/settings");
  return { ok: true };
}
