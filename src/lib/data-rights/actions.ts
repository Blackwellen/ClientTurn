"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace, type BusinessRole } from "@/lib/auth/session";
import { runOperation, type ServiceResult } from "@/lib/services";
import { crmSystemsFor } from "./executor";
import type { CrmErasureReport } from "./executor";
import type { Outcome } from "./wording";
import { PRIVACY_REQUEST_STATUSES, PRIVACY_REQUEST_TYPES } from "./types";

/**
 * Server actions for the lead drawer and Settings -> Data controls.
 *
 * Thin by design: each resolves the actor, then runs the service operation
 * with `confirmed: true` -- the dialog the person just clicked through *is*
 * the confirmation. Permission, validation, audit and the executor all live
 * behind `runOperation`, the same path Copilot, MCP and the API take.
 */

export type DataRightsActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; error: string };

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
    confirmed: true,
    correlationId: randomUUID(),
  };
}

function failure(result: ServiceResult): { ok: false; error: string } {
  return { ok: false, error: result.success ? "That did not work." : result.message };
}

const leadId = z.object({ leadId: z.uuid() });

/* ---------------------------------------------------------------- suppress */

export async function suppressLeadAction(input: {
  leadId: string;
  channel: string;
  reason: string;
}): Promise<DataRightsActionResult> {
  const parsed = leadId
    .extend({
      channel: z.enum(["ALL", "EMAIL", "SMS", "WHATSAPP", "SOCIAL"]),
      reason: z.enum(["MANUAL", "OPT_OUT", "LEGAL"]),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a channel and a reason." };

  const workspace = await actor("member");
  if (!workspace) return { ok: false, error: "You do not have permission to suppress leads." };

  const result = await runOperation<{ message: string }>("lead.suppress", parsed.data, context(workspace));
  if (!result.success) return failure(result);

  revalidatePath("/app/leads");
  return { ok: true, message: result.data.message };
}

/* --------------------------------------------------------------- erasure */

export type ErasureActionData = {
  outcome: Outcome;
  crm: CrmErasureReport[];
};

export async function anonymiseLeadAction(input: {
  leadId: string;
  alsoRemoveFromCrm?: boolean;
}): Promise<DataRightsActionResult<ErasureActionData>> {
  const parsed = leadId.extend({ alsoRemoveFromCrm: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That lead could not be found." };

  const workspace = await actor("admin");
  if (!workspace) return { ok: false, error: "Only owners and admins can anonymise a lead." };

  const result = await runOperation<ErasureActionData>("lead.anonymise", parsed.data, context(workspace));
  if (!result.success) return failure(result);

  revalidatePath("/app/leads");
  revalidatePath("/app");
  return {
    ok: true,
    message: result.data.outcome.headline,
    data: { outcome: result.data.outcome, crm: result.data.crm },
  };
}

/**
 * Erase. Deliberately does not revalidate: the drawer shows the outcome first
 * and refreshes the list when it is dismissed, because a refresh here would
 * unmount the drawer (the lead no longer exists) before anyone read what was
 * kept.
 */
export async function deleteLeadAction(input: {
  leadId: string;
  alsoRemoveFromCrm?: boolean;
}): Promise<DataRightsActionResult<ErasureActionData>> {
  const parsed = leadId.extend({ alsoRemoveFromCrm: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That lead could not be found." };

  const workspace = await actor("admin");
  if (!workspace) return { ok: false, error: "Only owners and admins can erase a lead." };

  const result = await runOperation<ErasureActionData>("lead.delete", parsed.data, context(workspace));
  if (!result.success) return failure(result);

  return {
    ok: true,
    message: result.data.outcome.headline,
    data: { outcome: result.data.outcome, crm: result.data.crm },
  };
}

/** Connected CRMs this lead was pushed to, for the erase/anonymise dialog. */
export async function leadCrmSystemsAction(input: { leadId: string }): Promise<string[]> {
  const parsed = leadId.safeParse(input);
  if (!parsed.success) return [];
  const workspace = await actor("admin");
  if (!workspace) return [];
  try {
    return await crmSystemsFor(workspace.businessId, parsed.data.leadId);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ export */

export async function exportLeadAction(input: {
  leadId: string;
}): Promise<DataRightsActionResult<{ filename: string; json: string }>> {
  const parsed = leadId.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That lead could not be found." };

  const workspace = await actor("admin");
  if (!workspace) return { ok: false, error: "Only owners and admins can export a lead's data." };

  const result = await runOperation<{ export: unknown }>("lead.export", parsed.data, context(workspace));
  if (!result.success) return failure(result);

  const date = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    message: "Export ready.",
    data: {
      filename: `lead-${parsed.data.leadId.slice(0, 8)}-export-${date}.json`,
      json: JSON.stringify(result.data.export, null, 2),
    },
  };
}

/* -------------------------------------------------------- privacy requests */

const createSchema = z.object({
  type: z.enum(PRIVACY_REQUEST_TYPES),
  subjectName: z.string().trim().max(200).optional(),
  subjectEmail: z.string().trim().max(320).optional(),
  details: z.string().trim().max(4000).optional(),
  identityVerified: z.boolean(),
  receivedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function createPrivacyRequestAction(
  input: z.input<typeof createSchema>,
): Promise<DataRightsActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the request details and try again." };

  const workspace = await actor("admin");
  if (!workspace) return { ok: false, error: "Only owners and admins can record privacy requests." };

  const { receivedOn, subjectEmail, ...rest } = parsed.data;
  const result = await runOperation<{ request: { reference: string } }>(
    "privacy_request.create",
    {
      ...rest,
      ...(subjectEmail ? { subjectEmail } : {}),
      ...(receivedOn ? { receivedAt: `${receivedOn}T09:00:00Z` } : {}),
    },
    context(workspace),
  );
  if (!result.success) return failure(result);

  revalidatePath("/app/settings");
  return { ok: true, message: `${result.data.request.reference} recorded. The 30-day clock has started.` };
}

const updateSchema = z.object({
  requestId: z.uuid(),
  status: z.enum(PRIVACY_REQUEST_STATUSES).optional(),
  acknowledged: z.boolean().optional(),
  identityVerified: z.boolean().optional(),
  note: z.string().trim().max(1000).optional(),
});

export async function updatePrivacyRequestAction(
  input: z.input<typeof updateSchema>,
): Promise<DataRightsActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That request could not be updated." };

  const workspace = await actor("admin");
  if (!workspace) return { ok: false, error: "Only owners and admins can update privacy requests." };

  const result = await runOperation("privacy_request.update", parsed.data, context(workspace));
  if (!result.success) return failure(result);

  revalidatePath("/app/settings");
  return { ok: true, message: "Request updated." };
}
