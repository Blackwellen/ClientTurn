import "server-only";
import { PermanentJobError } from "@/lib/jobs/registry";
import type { ClaimedJob } from "@/lib/jobs/queue";
import { performSend, type SendOutcome } from "@/lib/jobs/send-core";
import { getMessagingProvider } from "@/lib/messaging/registry";
import { createSendStore } from "./send-store";
import { parsePayload } from "./parse";
import { messageSendPayload } from "./payloads";

/**
 * The critical handler. It performs no decision of its own: `performSend`
 * re-reads the message, the lead, the subscription, the channel health and the
 * suppression list, and only a message still QUEUED is ever dispatched.
 */
export async function handleMessageSend(job: ClaimedJob) {
  const payload = parsePayload(messageSendPayload, job.payload);

  const outcome = await performSend({
    store: createSendStore(),
    provider: getMessagingProvider(),
    messageId: payload.messageId,
    finalAttempt: job.attempts >= job.max_attempts,
  });

  settle(outcome, payload.messageId);
}

export function settle(outcome: SendOutcome, messageId: string) {
  if (outcome.outcome === "missing") {
    throw new PermanentJobError(
      `Message ${messageId} no longer exists or has no reachable number.`,
    );
  }

  if (outcome.outcome === "failed") {
    if (outcome.permanent) {
      throw new PermanentJobError(
        `Provider rejected message ${messageId}: ${outcome.errorCode} ${outcome.errorMessage}`,
      );
    }
    throw new Error(
      `Provider send failed for message ${messageId}: ${outcome.errorCode} ${outcome.errorMessage}`,
    );
  }
}
