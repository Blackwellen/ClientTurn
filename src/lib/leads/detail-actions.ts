"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace, type BusinessRole } from "@/lib/auth/session";
import { runOperation, type ServiceResult } from "@/lib/services";
import { OPEN_STAGES } from "@/lib/opportunities/stages";
import { closeOutcomeSchema } from "./detail-page";

/**
 * Server actions for the lead detail page. Each one resolves the actor, then
 * runs the registry operation -- the same one Copilot, MCP and the API call --
 * so permission, validation, audit and the before/after all live behind
 * `runOperation`. `confirmed: true` is passed only where the page showed a
 * confirmation dialog the person clicked through, which is what the runtime
 * requires for a DESTRUCTIVE or EXTERNAL operation.
 */

export type LeadPageActionResult = { ok: true; message: string | null } | { ok: false; error: string };

async function actor(minimum: BusinessRole): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole(minimum);
  } catch {
    return null;
  }
}

function context(workspace: ActiveWorkspace, confirmed = false) {
  return {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI" as const,
    confirmed,
    correlationId: randomUUID(),
  };
}

function outcome(result: ServiceResult, leadId: string, success: string): LeadPageActionResult {
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath(`/app/leads/${leadId}`);
  revalidatePath("/app/leads");
  const warning = result.warnings.find((w) => w.code !== "no_change")?.message ?? null;
  const noChange = result.warnings.find((w) => w.code === "no_change")?.message ?? null;
  return { ok: true, message: noChange ?? warning ?? success };
}

const leadIdSchema = z.object({ leadId: z.uuid() });

/* ------------------------------------------------------------------- note */

export async function addLeadNoteAction(input: { leadId: string; body: string }): Promise<LeadPageActionResult> {
  const parsed = leadIdSchema.extend({ body: z.string().trim().min(1).max(4000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Write a note before saving it." };
  const workspace = await actor("member");
  if (!workspace) return { ok: false, error: "You do not have permission to add notes." };
  const result = await runOperation("lead.add_note", parsed.data, context(workspace));
  return outcome(result, parsed.data.leadId, "Note added.");
}

/* ----------------------------------------------------------------- assign */

export async function assignLeadAction(input: { leadId: string; userId: string | null }): Promise<LeadPageActionResult> {
  const parsed = leadIdSchema.extend({ userId: z.uuid().nullable() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That assignment is not valid." };
  const workspace = await actor("member");
  if (!workspace) return { ok: false, error: "You do not have permission to assign leads." };
  const result = await runOperation("lead.assign", parsed.data, context(workspace));
  return outcome(result, parsed.data.leadId, parsed.data.userId ? "Lead assigned." : "Lead unassigned.");
}

/* ------------------------------------------------------------ opportunity */

export async function setOpportunityStageAction(input: {
  leadId: string;
  opportunityId: string;
  stage: string;
}): Promise<LeadPageActionResult> {
  const parsed = leadIdSchema
    .extend({ opportunityId: z.uuid(), stage: z.enum(OPEN_STAGES as [string, ...string[]]) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a stage." };
  const workspace = await actor("member");
  if (!workspace) return { ok: false, error: "You do not have permission to move opportunities." };
  const result = await runOperation(
    "opportunity.set_stage",
    { opportunityId: parsed.data.opportunityId, stage: parsed.data.stage },
    context(workspace),
  );
  return outcome(result, parsed.data.leadId, "Stage updated.");
}

/**
 * Won or lost, with the reason. The lead's open opportunity is closed through
 * `opportunity.close`; a lead with no open opportunity is closed through
 * `lead.set_status`, which opens one first (closeLeadOpportunity) so the deal
 * is still recorded. Either way the reason lands on the opportunity.
 */
export async function closeLeadOutcomeAction(input: {
  leadId: string;
  outcome: "WON" | "LOST";
  reason: string;
}): Promise<LeadPageActionResult> {
  const parsed = closeOutcomeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Say why before closing the lead." };
  }
  const workspace = await actor("member");
  if (!workspace) return { ok: false, error: "You do not have permission to close leads." };

  const open = await runOperation<{ opportunities: { id: string }[] }>(
    "opportunity.list",
    { leadId: parsed.data.leadId, outcome: "OPEN", limit: 1 },
    context(workspace),
  );
  if (!open.success) return { ok: false, error: open.message };

  const opportunityId = open.data.opportunities[0]?.id;
  const result = opportunityId
    ? await runOperation(
        "opportunity.close",
        { opportunityId, outcome: parsed.data.outcome, reason: parsed.data.reason },
        // The reason dialog is the confirmation this EXTERNAL operation needs.
        context(workspace, true),
      )
    : await runOperation(
        "lead.set_status",
        { leadId: parsed.data.leadId, status: parsed.data.outcome, reason: parsed.data.reason },
        context(workspace),
      );
  revalidatePath("/app");
  return outcome(result, parsed.data.leadId, parsed.data.outcome === "WON" ? "Marked as won." : "Marked as lost.");
}

/* ------------------------------------------------------ follow-up control */

export async function rescoreLeadAction(input: { leadId: string }): Promise<LeadPageActionResult> {
  const parsed = leadIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That lead could not be found." };
  const workspace = await actor("member");
  if (!workspace) return { ok: false, error: "You do not have permission to re-score leads." };
  const result = await runOperation("lead.rescore", parsed.data, context(workspace));
  return outcome(result, parsed.data.leadId, "Re-score queued.");
}

export async function takeoverLeadAction(input: { leadId: string }): Promise<LeadPageActionResult> {
  const parsed = leadIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That lead could not be found." };
  const workspace = await actor("member");
  if (!workspace) return { ok: false, error: "You do not have permission to take over conversations." };
  const result = await runOperation("lead.takeover", parsed.data, context(workspace));
  return outcome(result, parsed.data.leadId, "You have taken over this conversation.");
}

export async function resumeLeadAction(input: { leadId: string }): Promise<LeadPageActionResult> {
  const parsed = leadIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That lead could not be found." };
  const workspace = await actor("member");
  if (!workspace) return { ok: false, error: "You do not have permission to resume follow-up." };
  const result = await runOperation("lead.resume_follow_up", parsed.data, context(workspace));
  return outcome(result, parsed.data.leadId, "Automated follow-up resumed.");
}

/* ------------------------------------------------------------- lifecycle */

export async function archiveLeadAction(input: { leadId: string }): Promise<LeadPageActionResult> {
  const parsed = leadIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That lead could not be found." };
  const workspace = await actor("admin");
  if (!workspace) return { ok: false, error: "Only owners and admins can archive a lead." };
  // DESTRUCTIVE: confirmed by the dialog the person just clicked through.
  const result = await runOperation("lead.archive", parsed.data, context(workspace, true));
  return outcome(result, parsed.data.leadId, "Lead archived. Its history is kept.");
}

export async function restoreLeadAction(input: { leadId: string }): Promise<LeadPageActionResult> {
  const parsed = leadIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That lead could not be found." };
  const workspace = await actor("admin");
  if (!workspace) return { ok: false, error: "Only owners and admins can restore a lead." };
  const result = await runOperation("lead.restore", parsed.data, context(workspace));
  return outcome(result, parsed.data.leadId, "Lead restored.");
}

/* ------------------------------------------------------ whatsapp opt-in */

export async function recordWhatsAppOptInAction(input: {
  leadId: string;
  optedInOn: string;
  source: string;
  detail?: string;
}): Promise<LeadPageActionResult> {
  const parsed = leadIdSchema
    .extend({
      optedInOn: z.string().trim().max(10),
      source: z.string().trim().max(40),
      detail: z.string().trim().max(300).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter the date and how they opted in." };
  const workspace = await actor("member");
  if (!workspace) return { ok: false, error: "You do not have permission to record consent." };
  // The operation re-validates the date and source; it is the authority.
  const result = await runOperation("lead.record_whatsapp_opt_in", parsed.data, context(workspace));
  return outcome(result, parsed.data.leadId, "WhatsApp opt-in recorded.");
}
