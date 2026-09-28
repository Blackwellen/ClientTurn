/**
 * The webhook inbox rule (CLAUDE.md), with the one failure it used to miss:
 *
 *   verify -> insert `webhook_events` (unique on provider + external id)
 *          -> enqueue the job -> acknowledge
 *
 * If the insert succeeded but the enqueue threw (a database blip), the route
 * returned 5xx, the provider redelivered, the insert hit the unique index and
 * the redelivery was acknowledged as a "duplicate": the event was recorded
 * and never processed. An inbound SMS carrying STOP, a WhatsApp message, a
 * voice CALL_ENDED (which frees the lead and the held minutes) or a booking
 * was lost that way (backend QA 2026-09-28).
 *
 * Now a redelivery whose row is still `received` is queued again. The job's
 * idempotency key makes that a no-op when the first enqueue did land. Pure:
 * the route passes the three I/O steps in.
 */

export type InboxInsertError = { code?: string | null; message?: string } | null | undefined;

export type InboxOutcome =
  /** First delivery: recorded and queued. */
  | "QUEUED"
  /** A redelivery of an event already queued or processed: acknowledge. */
  | "DUPLICATE"
  /** A redelivery of an event recorded but never queued: queued now. */
  | "REQUEUED"
  /** Nothing safe to acknowledge: answer 5xx so the provider retries. */
  | "FAILED";

export async function recordThenQueue(io: {
  insert(): Promise<InboxInsertError>;
  /** The stored row's status; throws when it cannot be read. */
  status(): Promise<string | null>;
  queue(): Promise<unknown>;
}): Promise<InboxOutcome> {
  const error = await io.insert();
  let redelivery = false;
  if (error) {
    if (error.code !== "23505") return "FAILED";
    let status: string | null;
    try {
      status = await io.status();
    } catch {
      return "FAILED";
    }
    // Processed, failed (the job ran and recorded why), ignored: nothing to queue.
    if (status !== "received") return "DUPLICATE";
    redelivery = true;
  }
  try {
    await io.queue();
  } catch {
    return "FAILED";
  }
  return redelivery ? "REQUEUED" : "QUEUED";
}

/** Whether the provider should get a success status. */
export function acknowledged(outcome: InboxOutcome): boolean {
  return outcome !== "FAILED";
}
