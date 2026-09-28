import "server-only";
import { z } from "zod";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { parsePayload } from "./parse";
import { draftTask } from "@/lib/linkedin-assist/store";

/**
 * `linkedin_assist.draft` -- the AI draft of one LinkedIn Assist task.
 *
 * Retry-safe: `draftTask` re-reads the task and writes only while it is still
 * OPEN, is not a reply, and has not already been drafted by the model or
 * rewritten by the person. The AI call is keyed on the task id, so a retried
 * job is billed once. AI off, out of tokens or rejected by the copy guard
 * leaves the template that was written when the task was created. Nothing
 * here sends anything: a person sends it from their own LinkedIn account.
 */

export const linkedInAssistDraftPayload = z.object({ taskId: z.uuid() });

export async function handleLinkedInAssistDraft(job: ClaimedJob): Promise<void> {
  const payload = parsePayload(linkedInAssistDraftPayload, job.payload);
  if (!job.business_id) return;
  await draftTask(job.business_id, payload.taskId);
}
