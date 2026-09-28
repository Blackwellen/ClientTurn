import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutomationEventType } from "./event-types";
import { derivedFromAutomationEvent } from "./derived-events";
import { EVENT_SEMANTIC } from "@/lib/opportunities/pipeline-semantics";

/**
 * The event catalog (§19) lives in ./event-types so tests can hold it to the
 * `automation_events` CHECK. Not every listed event is emitted yet. This is an
 * observability trail first; since gap map §45 it is also what automation
 * rules and the pipeline mapping react to, through one `automation.dispatch`
 * job per event (lib/automation/rule-runner.ts). The job is queued, never run
 * inline, so an emit stays cheap and a slow rule never delays its source --
 * and a dropped event is always logged, never silent.
 */
export type { AutomationEventType } from "./event-types";

export type EmitAutomationEventInput = {
  businessId: string;
  leadId?: string | null;
  automationRunId?: string | null;
  eventType: AutomationEventType;
  payload?: Record<string, unknown>;
};

/** Events the dispatcher derives follow-on triggers from (reactivation success). */
const DERIVING_EVENTS = new Set<string>(["lead.replied", "booking.created"]);

function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/** True when the workspace has an enabled rule for this trigger. Missing table (0163 unapplied): false. */
async function hasRuleFor(businessId: string, eventType: string): Promise<boolean> {
  const { data, error } = await db()
    .from("automation_rules")
    .select("id")
    .eq("business_id", businessId)
    .eq("trigger_event", eventType)
    .eq("enabled", true)
    .is("deleted_at", null)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

async function queueDispatch(businessId: string, eventId: string, eventType: string): Promise<void> {
  const wanted =
    eventType in EVENT_SEMANTIC || DERIVING_EVENTS.has(eventType) || (await hasRuleFor(businessId, eventType));
  if (!wanted) return;
  const { enqueue } = await import("@/lib/jobs/queue");
  await enqueue(
    "automation.dispatch",
    { eventId },
    { businessId, priority: 90, idempotencyKey: `automation.dispatch:${eventId}` },
  );
}

/**
 * Fire-and-forget by design: a failure here must never mask or block the
 * caller's actual work, so errors are swallowed after being logged.
 */
export async function emitAutomationEvent(input: EmitAutomationEventInput): Promise<void> {
  try {
    const supabase = createAdminClient();
    // The client returns a rejected insert (e.g. a CHECK violation) as
    // `{ error }` rather than throwing, so the catch below alone never sees it.
    const { data, error } = await supabase
      .from("automation_events")
      .insert({
        business_id: input.businessId,
        lead_id: input.leadId ?? null,
        automation_run_id: input.automationRunId ?? null,
        event_type: input.eventType,
        payload: (input.payload ?? {}) as never,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("emitAutomationEvent insert rejected", {
        eventType: input.eventType,
        businessId: input.businessId,
        leadId: input.leadId ?? null,
        automationRunId: input.automationRunId ?? null,
        code: error.code,
        message: error.message,
      });
      return;
    }
    const eventId = (data as { id: string } | null)?.id;
    if (eventId) await queueDispatch(input.businessId, eventId, input.eventType);
  } catch (error) {
    console.error("emitAutomationEvent failed", input.eventType, error);
  }

  // Follow-on triggers read off this one (a hand-over the lead asked for).
  for (const derived of derivedFromAutomationEvent({
    eventType: input.eventType,
    leadId: input.leadId ?? null,
    payload: input.payload ?? {},
  })) {
    await emitAutomationEvent({ businessId: input.businessId, leadId: derived.leadId, eventType: derived.eventType, payload: derived.payload });
  }
}
