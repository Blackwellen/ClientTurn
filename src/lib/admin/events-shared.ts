/**
 * The rules that decide what an operational event *is* and whether replaying
 * it is safe. Deliberately free of `server-only`, Supabase and I/O: these are
 * the security-critical decisions behind Safe retry, so they are pure,
 * inspectable and directly unit-testable.
 *
 * The server re-applies every rule here against freshly-read state before it
 * enqueues anything — the UI's opinion is never trusted.
 */

import type { EventSource, EventStatus } from "./types";

/** Hard ceiling on operator-initiated replays, independent of job max_attempts. */
export const MAX_SAFE_RETRIES = 8;

const WEBHOOK_STATUS: Record<string, EventStatus> = {
  received: "RECEIVED",
  processing: "PROCESSING",
  processed: "PROCESSED",
  failed: "FAILED",
  ignored: "IGNORED",
};

export function webhookEventStatus(status: string): EventStatus {
  return WEBHOOK_STATUS[status] ?? "RECEIVED";
}

export function jobEventStatus(
  state: string,
  attempts: number,
  maxAttempts: number,
): EventStatus {
  if (state === "pending") return attempts > 0 ? "RETRYING" : "RECEIVED";
  if (state === "running") return "PROCESSING";
  if (state === "completed") return "PROCESSED";
  if (state === "dead") return "DEAD_LETTERED";
  // A failed job with retries left is genuinely still in flight.
  return attempts < maxAttempts ? "RETRYING" : "FAILED";
}

export function messageEventStatus(status: string): EventStatus {
  if (status === "FAILED") return "FAILED";
  if (status === "QUEUED") return "RECEIVED";
  if (status === "SENT") return "PROCESSING";
  return "PROCESSED";
}

/**
 * A replay is only safe when the event actually failed and the operator
 * ceiling has not been reached. Messages are never replayable from here: the
 * follow-up engine owns re-delivery, and a manual resend could deliver the
 * same text to a lead twice.
 */
export function isRetryable(input: {
  source: EventSource;
  status: EventStatus;
  attempts: number;
}): boolean {
  if (input.source === "message") return false;
  if (input.attempts >= MAX_SAFE_RETRIES) return false;
  if (input.source === "webhook") return input.status === "FAILED";
  return input.status === "FAILED" || input.status === "DEAD_LETTERED";
}

/** Operator-facing explanation for a retry that is not offered. */
export function retryBlockedReason(input: {
  source: EventSource;
  status: EventStatus;
  attempts: number;
}): string | null {
  if (isRetryable(input)) return null;
  if (input.source === "message") {
    return "Message delivery is re-driven by the follow-up engine. Replaying a send from here could deliver the same message to a lead twice.";
  }
  if (input.status === "PROCESSED") {
    return input.source === "webhook"
      ? "This event was already applied. Replaying it would apply the same state change twice."
      : "This job already completed.";
  }
  if (
    input.status === "RECEIVED" ||
    input.status === "PROCESSING" ||
    input.status === "RETRYING"
  ) {
    return "This event is still in flight and will be retried automatically.";
  }
  if (input.attempts >= MAX_SAFE_RETRIES) {
    return `This event has reached the replay limit of ${MAX_SAFE_RETRIES} operator-initiated attempts.`;
  }
  return "Only a failed delivery can be safely replayed.";
}

/**
 * Event ids are opaque to the client and carry their own source, so the retry
 * path always knows which table it would touch. Anything malformed is
 * rejected before it can reach a query.
 */
export function parseEventId(
  id: string,
): { source: EventSource; rowId: string } | null {
  const separator = id.indexOf(":");
  if (separator < 0) return null;
  const source = id.slice(0, separator);
  const rowId = id.slice(separator + 1);
  if (source !== "webhook" && source !== "message" && source !== "job") {
    return null;
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rowId)
  ) {
    return null;
  }
  return { source, rowId };
}

export function formatEventId(source: EventSource, rowId: string): string {
  return `${source}:${rowId}`;
}
