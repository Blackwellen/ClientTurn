"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { assertEntitlement, EntitlementError } from "@/lib/billing/entitlements";
import { findUnknownMergeFields } from "@/lib/automation/scheduler";
import {
  AUTOMATION_TYPE_META,
  AUTOMATION_TYPES,
  quietHoursSchema,
  saveDraftSchema,
  type AutomationType,
  type StepInput,
} from "./types";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/**
 * Automations are configured only on /app/follow-up — the standalone
 * /app/automations surface was removed by the V3 IA consolidation.
 */
function refresh() {
  revalidatePath("/app/follow-up");
}

async function admin(): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

async function loadDefinition(workspace: ActiveWorkspace, automationId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("automation_definitions")
    .select("id, type, name, enabled")
    .eq("business_id", workspace.businessId)
    .eq("id", automationId)
    .maybeSingle();
  return data;
}

async function nextVersionNumber(automationId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("automation_versions")
    .select("version_number")
    .eq("automation_id", automationId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.version_number ?? 0) + 1;
}

export async function createAutomation(input: {
  type: string;
}): Promise<ActionResult> {
  const parsed = z
    .object({ type: z.enum(AUTOMATION_TYPES) })
    .safeParse(input);
  if (!parsed.success) return fail("That automation type is not available.");

  const workspace = await admin();
  if (!workspace) {
    return fail("You do not have permission to create automations.");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("automation_definitions").insert({
    business_id: workspace.businessId,
    type: parsed.data.type,
    name: AUTOMATION_TYPE_META[parsed.data.type as AutomationType].label,
    enabled: false,
  });

  if (error) {
    if (error.code === "23505") return fail("That automation already exists.");
    return fail("Could not create the automation.");
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "automation.created",
    entityType: "automation",
    metadata: { type: parsed.data.type },
  });

  refresh();
  return { ok: true };
}

/**
 * Writes the working draft. A published version is never edited in place —
 * a draft is opened alongside it so in-flight leads keep the sequence they
 * started on.
 */
export async function saveAutomationDraft(input: {
  automationId: string;
  name: string;
  steps: StepInput[];
}): Promise<ActionResult> {
  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Every step needs a delay, a channel and a message.");
  }

  const workspace = await admin();
  if (!workspace) {
    return fail("You do not have permission to edit automations.");
  }

  const definition = await loadDefinition(workspace, parsed.data.automationId);
  if (!definition) return fail("Automation not found.");

  const usesWhatsapp = parsed.data.steps.some(
    (step) => step.channel === "whatsapp",
  );
  if (usesWhatsapp) {
    try {
      await assertEntitlement(workspace.businessId, "whatsapp");
    } catch (error) {
      if (error instanceof EntitlementError) return fail(error.message);
      return fail("WhatsApp is unavailable right now.");
    }
  }

  const supabase = createAdminClient();

  const { data: existingDraft } = await supabase
    .from("automation_versions")
    .select("id")
    .eq("business_id", workspace.businessId)
    .eq("automation_id", definition.id)
    .eq("status", "DRAFT")
    .maybeSingle();

  let versionId = existingDraft?.id ?? null;

  if (!versionId) {
    const { data: created, error } = await supabase
      .from("automation_versions")
      .insert({
        business_id: workspace.businessId,
        automation_id: definition.id,
        version_number: await nextVersionNumber(definition.id),
        status: "DRAFT",
      })
      .select("id")
      .single();
    if (error || !created) return fail("Could not open a draft version.");
    versionId = created.id;
  }

  await supabase.from("automation_steps").delete().eq("version_id", versionId);

  const { error: stepError } = await supabase.from("automation_steps").insert(
    parsed.data.steps.map((step, index) => ({
      business_id: workspace.businessId,
      version_id: versionId,
      position: index + 1,
      delay_seconds: step.delaySeconds,
      channel: step.channel,
      template: step.template,
      enabled: step.enabled,
    })),
  );

  if (stepError) return fail("Could not save the steps.");

  await supabase
    .from("automation_definitions")
    .update({ name: parsed.data.name })
    .eq("id", definition.id)
    .eq("business_id", workspace.businessId);

  await supabase
    .from("automation_versions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", versionId);

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "automation.draft_saved",
    entityType: "automation_version",
    entityId: versionId,
    metadata: { automation_id: definition.id, steps: parsed.data.steps.length },
  });

  refresh();
  return { ok: true };
}

/**
 * "Update sequence" from the Follow-Up editor: one press writes the draft and
 * publishes it. Both halves keep their own validation and their own audit
 * entry — this only removes the two-step dance from the UI, never a check.
 *
 * If the save succeeds but the publish is rejected the draft is left in place
 * deliberately, so the user's work is not lost and the reason is reportable.
 */
export async function updateFollowUpSequence(input: {
  automationId: string;
  name: string;
  steps: StepInput[];
}): Promise<ActionResult> {
  const saved = await saveAutomationDraft(input);
  if (!saved.ok) return saved;
  return publishAutomation({ automationId: input.automationId });
}

export async function publishAutomation(input: {
  automationId: string;
}): Promise<ActionResult> {
  const parsed = z.object({ automationId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Automation not found.");

  const workspace = await admin();
  if (!workspace) {
    return fail("You do not have permission to publish automations.");
  }

  const definition = await loadDefinition(workspace, parsed.data.automationId);
  if (!definition) return fail("Automation not found.");

  const supabase = createAdminClient();

  const { data: draft } = await supabase
    .from("automation_versions")
    .select("id, version_number")
    .eq("business_id", workspace.businessId)
    .eq("automation_id", definition.id)
    .eq("status", "DRAFT")
    .maybeSingle();

  if (!draft) return fail("There is no draft to publish.");

  const { data: steps } = await supabase
    .from("automation_steps")
    .select("template, channel, enabled")
    .eq("version_id", draft.id)
    .order("position");

  if (!steps || steps.length === 0) {
    return fail("Add at least one step before publishing.");
  }
  if (!steps.some((step) => step.enabled)) {
    return fail("At least one step must be switched on before publishing.");
  }

  const unknown = [
    ...new Set(steps.flatMap((step) => findUnknownMergeFields(step.template))),
  ];
  if (unknown.length > 0) {
    return fail(
      `Unknown merge ${unknown.length === 1 ? "field" : "fields"}: ${unknown
        .map((token) => `{{${token}}}`)
        .join(", ")}. Publishing is blocked until they are removed.`,
    );
  }

  if (steps.some((step) => step.channel === "whatsapp")) {
    try {
      await assertEntitlement(workspace.businessId, "whatsapp");
    } catch (error) {
      if (error instanceof EntitlementError) return fail(error.message);
      return fail("WhatsApp is unavailable right now.");
    }
  }

  // The partial unique index allows one PUBLISHED version, so archive first.
  await supabase
    .from("automation_versions")
    .update({ status: "ARCHIVED" })
    .eq("business_id", workspace.businessId)
    .eq("automation_id", definition.id)
    .eq("status", "PUBLISHED");

  const { error } = await supabase
    .from("automation_versions")
    .update({
      status: "PUBLISHED",
      published_at: new Date().toISOString(),
      published_by: workspace.userId,
    })
    .eq("id", draft.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not publish this version.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "automation.published",
    entityType: "automation_version",
    entityId: draft.id,
    metadata: {
      automation_id: definition.id,
      version_number: draft.version_number,
    },
  });

  refresh();
  return { ok: true };
}

export async function discardAutomationDraft(input: {
  automationId: string;
}): Promise<ActionResult> {
  const parsed = z.object({ automationId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Automation not found.");

  const workspace = await admin();
  if (!workspace) {
    return fail("You do not have permission to edit automations.");
  }

  const definition = await loadDefinition(workspace, parsed.data.automationId);
  if (!definition) return fail("Automation not found.");

  const supabase = createAdminClient();
  const { data: draft } = await supabase
    .from("automation_versions")
    .select("id")
    .eq("business_id", workspace.businessId)
    .eq("automation_id", definition.id)
    .eq("status", "DRAFT")
    .maybeSingle();

  if (!draft) return fail("There is no draft to discard.");

  const { count } = await supabase
    .from("automation_runs")
    .select("id", { count: "exact", head: true })
    .eq("business_id", workspace.businessId)
    .eq("version_id", draft.id);

  if ((count ?? 0) > 0) {
    return fail("Leads have already run on this version. It cannot be discarded.");
  }

  await supabase
    .from("automation_versions")
    .delete()
    .eq("id", draft.id)
    .eq("business_id", workspace.businessId);

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "automation.draft_discarded",
    entityType: "automation",
    entityId: definition.id,
  });

  refresh();
  return { ok: true };
}

export async function setAutomationEnabled(input: {
  automationId: string;
  enabled: boolean;
}): Promise<ActionResult> {
  const parsed = z
    .object({ automationId: z.uuid(), enabled: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return fail("That request is not valid.");

  const workspace = await admin();
  if (!workspace) {
    return fail("You do not have permission to change automations.");
  }

  const definition = await loadDefinition(workspace, parsed.data.automationId);
  if (!definition) return fail("Automation not found.");

  const supabase = createAdminClient();

  if (parsed.data.enabled) {
    const { data: published } = await supabase
      .from("automation_versions")
      .select("id")
      .eq("business_id", workspace.businessId)
      .eq("automation_id", definition.id)
      .eq("status", "PUBLISHED")
      .maybeSingle();
    if (!published) {
      return fail("Publish a version before activating this automation.");
    }
    try {
      await assertEntitlement(workspace.businessId);
    } catch (error) {
      if (error instanceof EntitlementError) return fail(error.message);
      return fail("Automations are unavailable right now.");
    }
  }

  const { error } = await supabase
    .from("automation_definitions")
    .update({ enabled: parsed.data.enabled })
    .eq("id", definition.id)
    .eq("business_id", workspace.businessId);

  if (error) return fail("Could not update the automation.");

  const { data: versions } = await supabase
    .from("automation_versions")
    .select("id")
    .eq("business_id", workspace.businessId)
    .eq("automation_id", definition.id);

  const ids = (versions ?? []).map((row) => row.id);
  if (ids.length > 0) {
    // In-flight runs keep their step and their version; only the state moves.
    // The worker re-checks every stop condition before the next send.
    await supabase
      .from("automation_runs")
      .update({ state: parsed.data.enabled ? "ACTIVE" : "PAUSED" })
      .eq("business_id", workspace.businessId)
      .eq("state", parsed.data.enabled ? "PAUSED" : "ACTIVE")
      .in("version_id", ids);
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: parsed.data.enabled ? "automation.activated" : "automation.paused",
    entityType: "automation",
    entityId: definition.id,
  });

  refresh();
  return { ok: true };
}

export async function saveQuietHours(input: {
  enabled: boolean;
  start: string;
  end: string;
}): Promise<ActionResult> {
  const parsed = quietHoursSchema.safeParse(input);
  if (!parsed.success) return fail("Enter quiet hours as HH:MM.");

  const workspace = await admin();
  if (!workspace) {
    return fail("You do not have permission to change quiet hours.");
  }

  if (parsed.data.enabled && parsed.data.start === parsed.data.end) {
    return fail("Quiet hours cannot start and end at the same time.");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("business_settings").upsert(
    {
      business_id: workspace.businessId,
      quiet_hours_enabled: parsed.data.enabled,
      quiet_hours_start: parsed.data.start,
      quiet_hours_end: parsed.data.end,
    },
    { onConflict: "business_id" },
  );

  if (error) return fail("Could not save quiet hours.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "automation.quiet_hours_changed",
    entityType: "business_settings",
    entityId: workspace.businessId,
    metadata: { ...parsed.data },
  });

  refresh();
  return { ok: true };
}
