/**
 * The automation event catalog (§19), as a value so it can be checked against
 * the `automation_events.event_type` CHECK constraint (tests/write-integrity).
 * Pure: no `server-only`, no I/O. Adding a type here means adding it to the
 * CHECK in a new migration too, or every insert of it is rejected.
 */
export const AUTOMATION_EVENT_TYPES = [
  "lead.created",
  "lead.updated",
  "lead.replied",
  "lead.opted_out",
  "lead.human_takeover",
  "message.queued",
  "message.sent",
  "message.delivered",
  "message.failed",
  "message.received",
  "automation.started",
  "automation.step_due",
  "automation.step_completed",
  // A step whose channel is not permitted for this lead and has no fallback.
  // Recorded rather than silently retried, because the resolution is a human
  // decision (V4 §19.6).
  "automation.step_blocked",
  "automation.stopped",
  "automation.failed",
  "qualification.answer_received",
  "qualification.updated",
  "qualification.qualified",
  "qualification.review",
  "qualification.not_qualified",
  "booking.link_sent",
  "booking.created",
  "booking.cancelled",
  "booking.completed",
  "campaign.created",
  "campaign.scheduled",
  "campaign.started",
  "campaign.contact_due",
  "campaign.completed",
  // Quote-to-cash (P2, gap map §45; CHECK in migration 0156). Emitted by
  // lib/quotes/events.ts from the quote, signature and invoice paths.
  "quote.created",
  "quote.approval_requested",
  "quote.approved",
  "quote.approval_rejected",
  "quote.sent",
  "quote.viewed",
  "quote.accepted",
  "quote.declined",
  "quote.expired",
  "quote.revised",
  "quote.withdrawn",
  "quote.reminded",
  "signature.completed",
  "invoice.issued",
  "invoice.paid",
  "invoice.overdue",
  "invoice.voided",
  "invoice.credited",
  // Voice, quote, payment and signal triggers (gap map §45; CHECK in migration
  // 0163). Voice events come from lib/automation/voice-events.ts, which wraps
  // the voice repo; the rest from their source paths.
  "call.requested",
  "call.started",
  "call.answered",
  "call.missed",
  "call.voicemail",
  "call.qualified",
  "voice.lead_eligible",
  "voice.budget_threshold",
  "intent.threshold_exceeded",
  "quote.requested",
  "invoice.created",
  "payment.direct_sale",
  "human.requested",
  "objection.detected",
  "reactivation.succeeded",
  "usage.exhausted",
] as const;

export type AutomationEventType = (typeof AUTOMATION_EVENT_TYPES)[number];
