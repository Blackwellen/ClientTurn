import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The event catalog (§19). Not every listed event is emitted yet — only the
 * ones wired into a handler below actually fire. This is an observability
 * trail, not a source of truth: nothing reads automation_events to make a
 * decision, so a dropped event never breaks the pipeline.
 */
export type AutomationEventType =
  | "lead.created"
  | "lead.updated"
  | "lead.replied"
  | "lead.opted_out"
  | "lead.human_takeover"
  | "message.queued"
  | "message.sent"
  | "message.delivered"
  | "message.failed"
  | "message.received"
  | "automation.started"
  | "automation.step_due"
  | "automation.step_completed"
  // A step whose channel is not permitted for this lead and has no fallback.
  // Recorded rather than silently retried, because the resolution is a human
  // decision (V4 §19.6).
  | "automation.step_blocked"
  | "automation.stopped"
  | "automation.failed"
  | "qualification.answer_received"
  | "qualification.updated"
  | "qualification.qualified"
  | "qualification.review"
  | "qualification.not_qualified"
  | "booking.link_sent"
  | "booking.created"
  | "booking.cancelled"
  | "booking.completed"
  | "campaign.created"
  | "campaign.scheduled"
  | "campaign.started"
  | "campaign.contact_due"
  | "campaign.completed";

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
    await supabase.from("automation_events").insert({
      business_id: input.businessId,
      lead_id: input.leadId ?? null,
      automation_run_id: input.automationRunId ?? null,
      event_type: input.eventType,
      payload: (input.payload ?? {}) as never,
    });
  } catch (error) {
    console.error("emitAutomationEvent failed", input.eventType, error);
  }
}
