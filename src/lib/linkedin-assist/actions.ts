"use server";

import { randomUUID } from "node:crypto";
import { friendlyIssue } from "@/lib/validation/friendly-issue";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { runOperation } from "@/lib/services";
import {
  addContactSchema,
  linkedInAssistSettingsSchema,
  logReplySchema,
  markSentSchema,
  moveChannelSchema,
  taskIdSchema,
} from "./types";

/**
 * LinkedIn Assist from the Follow-Up page. Every write is the registry
 * operation (`linkedin_assist.*`): role check, validation, audit and the stop
 * conditions all live there. Zod runs here too so a malformed request is
 * turned away before a service call is made.
 */

export type LinkedInActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

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

async function run<T>(
  operation: string,
  schema: z.ZodType,
  input: unknown,
): Promise<LinkedInActionResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: friendlyIssue(parsed.error, "That request is not valid.") };
  }
  const workspace = await member();
  if (!workspace) return { ok: false, error: "You do not have permission to do that." };
  const result = await runOperation<T>(operation, parsed.data, context(workspace));
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath("/app/follow-up");
  return { ok: true, data: result.data };
}

export async function addLinkedInContact(input: unknown) {
  return run<{ contactId: string; taskId: string | null }>("linkedin_assist.add_contact", addContactSchema, input);
}

export async function redraftLinkedInTask(input: unknown) {
  return run("linkedin_assist.redraft", taskIdSchema, input);
}

export async function markLinkedInTaskSent(input: unknown) {
  return run<{ nextDueOn: string | null; finished: boolean }>("linkedin_assist.mark_sent", markSentSchema, input);
}

export async function skipLinkedInTask(input: unknown) {
  return run("linkedin_assist.skip", taskIdSchema, input);
}

export async function snoozeLinkedInTask(input: unknown) {
  return run<{ dueOn: string }>("linkedin_assist.snooze", taskIdSchema, input);
}

export async function logLinkedInReply(input: unknown) {
  return run<{ optedOut: boolean; replyTaskId: string | null; agentDrafting?: boolean }>(
    "linkedin_assist.log_reply",
    logReplySchema,
    input,
  );
}

export async function moveLinkedInContact(input: unknown) {
  return run<{ href: string }>("linkedin_assist.move_channel", moveChannelSchema, input);
}

export async function saveLinkedInAssistSettings(input: unknown) {
  return run("linkedin_assist.update_settings", linkedInAssistSettingsSchema, input);
}
