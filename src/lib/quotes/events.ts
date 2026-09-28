import "server-only";
import { emitAutomationEvent } from "@/lib/automation/events";
import type { AutomationEventType } from "@/lib/automation/event-types";
import { emitWebhookEvent } from "@/lib/webhooks/emit";

/**
 * Quote-to-cash events (gap map §45): every quote, signature and invoice
 * event goes to the automation trail (`automation_events`, 0156 CHECK) and the
 * customer-facing ones also go to the workspace's outgoing webhooks
 * (webhooks/events.ts lists this file as their emit site).
 *
 * Never throws: an event is a notification about work that already happened.
 */

/** Quote timeline type -> automation event type. `quote.signed` is `signature.completed`. */
const AUTOMATION_TYPE: Record<string, AutomationEventType> = {
  "quote.requested": "quote.requested",
  "quote.created": "quote.created",
  "quote.approval_requested": "quote.approval_requested",
  "quote.approved": "quote.approved",
  "quote.approval_rejected": "quote.approval_rejected",
  "quote.sent": "quote.sent",
  "quote.viewed": "quote.viewed",
  "quote.accepted": "quote.accepted",
  "quote.declined": "quote.declined",
  "quote.expired": "quote.expired",
  "quote.revised": "quote.revised",
  "quote.withdrawn": "quote.withdrawn",
  "quote.reminded": "quote.reminded",
  "quote.signed": "signature.completed",
  "signature.completed": "signature.completed",
  "invoice.created": "invoice.created",
  "invoice.issued": "invoice.issued",
  "invoice.paid": "invoice.paid",
  "invoice.overdue": "invoice.overdue",
  "invoice.voided": "invoice.voided",
  "invoice.credited": "invoice.credited",
};

/**
 * The events a customer's own systems receive. Each literal here is what
 * tests/developer-platform.test.ts looks for in this file.
 */
const WEBHOOK_TYPE: Record<string, string> = {
  "quote.sent": "quote.sent",
  "quote.viewed": "quote.viewed",
  "quote.accepted": "quote.accepted",
  "quote.declined": "quote.declined",
  "quote.expired": "quote.expired",
  "quote.signed": "signature.completed",
  "signature.completed": "signature.completed",
  "invoice.issued": "invoice.issued",
  "invoice.paid": "invoice.paid",
  "invoice.overdue": "invoice.overdue",
};

export async function emitQuoteEvent(
  businessId: string,
  type: string,
  payload: Record<string, unknown>,
  options: { leadId?: string | null; eventId?: string } = {},
): Promise<void> {
  const automationType = AUTOMATION_TYPE[type];
  if (automationType) {
    await emitAutomationEvent({
      businessId,
      leadId: options.leadId ?? (typeof payload.leadId === "string" ? payload.leadId : null),
      eventType: automationType,
      payload,
    });
  }
  const webhookType = WEBHOOK_TYPE[type];
  if (webhookType) {
    await emitWebhookEvent({ businessId, type: webhookType, data: payload, eventId: options.eventId });
  }
}
