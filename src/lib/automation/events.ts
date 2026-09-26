import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AutomationEventType } from "./event-types";

/**
 * The event catalog (§19) lives in ./event-types so tests can hold it to the
 * `automation_events` CHECK. Not every listed event is emitted yet. This is an
 * observability trail, not a source of truth: nothing reads automation_events
 * to make a decision, so a dropped event never breaks the pipeline -- but a
 * dropped event is always logged, never silent.
 */
export type { AutomationEventType } from "./event-types";

export type EmitAutomationEventInput = {
  businessId: string;
  leadId?: string | null;
  automationRunId?: string | null;
  eventType: AutomationEventType;
  payload?: Record<string, unknown>;
};

/**
 * Fire-and-forget by design: a failure here must never mask or block the
 * caller's actual work, so errors are swallowed after being logged.
 */
export async function emitAutomationEvent(input: EmitAutomationEventInput): Promise<void> {
  try {
    const supabase = createAdminClient();
    // The client returns a rejected insert (e.g. a CHECK violation) as
    // `{ error }` rather than throwing, so the catch below alone never sees it.
    const { error } = await supabase.from("automation_events").insert({
      business_id: input.businessId,
      lead_id: input.leadId ?? null,
      automation_run_id: input.automationRunId ?? null,
      event_type: input.eventType,
      payload: (input.payload ?? {}) as never,
    });
    if (error) {
      console.error("emitAutomationEvent insert rejected", {
        eventType: input.eventType,
        businessId: input.businessId,
        leadId: input.leadId ?? null,
        automationRunId: input.automationRunId ?? null,
        code: error.code,
        message: error.message,
      });
    }
  } catch (error) {
    console.error("emitAutomationEvent failed", input.eventType, error);
  }
}
