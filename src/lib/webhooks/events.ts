/**
 * The catalogue of events ClientTurn will send to a customer's own systems.
 *
 * Pure — no `server-only`, no Supabase — so Settings can render it and tests can
 * assert it without a database.
 *
 * The rule this list exists to enforce: **an event appears here only once
 * something actually emits it.** A subscription checkbox for an event that is
 * never sent is worse than a missing feature — the customer builds against it,
 * waits, and concludes the product is broken. Every entry below has a real
 * emit site, named in `emittedBy`, and `tests/developer-platform.test.ts` fails if one
 * loses it.
 */

import type { PlatformScope } from "@/lib/platform/scopes";

export type WebhookEventDefinition = {
  type: string;
  label: string;
  description: string;
  /**
   * The scope a reader would need to see this data in the API. Subscribing is
   * an admin act, but the pairing is what keeps the two surfaces describing the
   * same permission model.
   */
  scope: PlatformScope;
  /** Where in the codebase this event is emitted. Asserted by the tests. */
  emittedBy: string;
};

export const WEBHOOK_EVENTS = [
  {
    type: "lead.created",
    label: "Lead created",
    description:
      "A new lead reached the workspace, from any source — an ad form, an import, or added by hand.",
    scope: "leads:read",
    emittedBy: "lib/jobs/handlers/lead-process.ts",
  },
  {
    type: "lead.qualified",
    label: "Lead qualified",
    description:
      "A lead finished qualification and was scored. Carries the outcome and the answers it was based on.",
    scope: "leads:read",
    emittedBy: "lib/jobs/handlers/qualify.ts",
  },
  {
    type: "lead.status_changed",
    label: "Lead status changed",
    description: "A lead moved to a different status, by a person or by automation.",
    scope: "leads:read",
    emittedBy: "lib/services/operations/leads.ts",
  },
  {
    type: "lead.handover_required",
    label: "Lead needs a person",
    description:
      "Follow-up stopped and a human is needed — the usual trigger for paging someone in your own system.",
    scope: "leads:read",
    emittedBy: "lib/jobs/handlers/shared.ts",
  },
  {
    type: "booking.created",
    label: "Booking created",
    description: "An appointment was booked for a lead.",
    scope: "leads:read",
    emittedBy: "lib/jobs/handlers/booking-sync.ts",
  },
  {
    type: "message.received",
    label: "Message received",
    description: "An inbound message arrived from a lead on any channel.",
    scope: "leads:read",
    emittedBy: "lib/jobs/handlers/message-inbound.ts",
  },

  /* ------------------------------------------------ the domain event outbox
   *
   * Emitted into `domain_events` where the change happens (ingest, scoring,
   * or a database trigger on bookings, suppressions, handoffs and inbound
   * messages) and delivered by the outbox dispatcher, which forwards exactly
   * the types in its WEBHOOK_FORWARDED list. docs/DEVELOPER_PLATFORM.md
   * describes each payload.
   */
  {
    type: "lead.touched",
    label: "Existing lead enquired again",
    description:
      "Someone who is already a lead arrived again through a form, an import or the API. The existing lead was matched and updated rather than duplicated.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "lead.scored",
    label: "Lead scored",
    description:
      "A lead received a new score: the total out of 100, the grade and what triggered the re-score.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "score.changed",
    label: "Lead grade changed",
    description:
      "A new score moved a lead to a different grade (A to D). Carries the previous and the new grade.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "reply.received",
    label: "Reply received",
    description:
      "A lead replied on any channel. Fires once per inbound message, from the stored message itself.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "meeting.booked",
    label: "Meeting booked",
    description:
      "A meeting was confirmed: a calendar accepted it, or a person confirmed a requested time.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "meeting.pending",
    label: "Meeting requested",
    description:
      "A lead chose a time that no connected calendar could confirm. It waits for someone in the workspace to confirm or decline it.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "meeting.cancelled",
    label: "Meeting cancelled",
    description: "A booked or requested meeting was cancelled, by the lead, a calendar or a person.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "meeting.no_show",
    label: "Meeting no-show",
    description: "A booked meeting was marked as a no-show.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "contact.unsubscribed",
    label: "Contact opted out",
    description:
      "A person opted out, on one channel or all of them. Carries the channel so your systems can honour the same scope.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "contact.suppressed",
    label: "Contact suppressed",
    description:
      "An address or number was blocked for a reason other than an opt-out: a bounce, a complaint, an invalid number or a manual block.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "opportunity.created",
    label: "Opportunity created",
    description:
      "A lead became a sales opportunity. Carries the lead, the starting stage and the sales motion.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "opportunity.won",
    label: "Opportunity won",
    description: "An opportunity was closed as won. Carries the lead and the reason given.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "opportunity.lost",
    label: "Opportunity lost",
    description: "An opportunity was closed as lost. Carries the lead and the reason given.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
  {
    type: "ai.escalated",
    label: "Assistant handed over",
    description:
      "The conversation assistant handed a lead to a person. Carries the reason and priority of the handover.",
    scope: "leads:read",
    emittedBy: "lib/events/outbox.ts",
  },
] as const satisfies readonly WebhookEventDefinition[];

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]["type"];

export const WEBHOOK_EVENT_TYPES = WEBHOOK_EVENTS.map(
  (event) => event.type,
) as WebhookEventType[];

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as string[]).includes(value);
}

export function webhookEvent(type: string): WebhookEventDefinition | null {
  return WEBHOOK_EVENTS.find((event) => event.type === type) ?? null;
}

/**
 * A test event, sent by the "Send test" button.
 *
 * Deliberately its own type rather than a fake `lead.created`: a customer's
 * handler must be able to tell a drill from the real thing, or testing an
 * endpoint means creating a phantom lead in their CRM.
 */
export const WEBHOOK_TEST_EVENT = "endpoint.test";

export type WebhookEndpointStatus = "ACTIVE" | "PAUSED" | "DISABLED";

export const ENDPOINT_STATUS_LABELS: Record<WebhookEndpointStatus, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  DISABLED: "Disabled",
};

export const ENDPOINT_STATUS_TONES: Record<
  WebhookEndpointStatus,
  "success" | "warning" | "danger"
> = {
  ACTIVE: "success",
  PAUSED: "warning",
  DISABLED: "danger",
};

export type WebhookDeliveryStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "EXHAUSTED"
  | "CANCELLED";

export const DELIVERY_STATUS_LABELS: Record<WebhookDeliveryStatus, string> = {
  PENDING: "Queued",
  SUCCEEDED: "Delivered",
  FAILED: "Retrying",
  EXHAUSTED: "Gave up",
  CANCELLED: "Cancelled",
};

/**
 * The label a delivery row shows.
 *
 * A failed attempt is written back as PENDING with a later `next_attempt_at`
 * (the dispatcher claims PENDING rows), so FAILED is never stored and
 * "Retrying" never appeared: a delivery that had failed five times read
 * "Queued". A PENDING row with attempts behind it is retrying, and says so.
 */
export function deliveryStatusLabel(delivery: {
  status: WebhookDeliveryStatus;
  attempts: number;
}): string {
  if (delivery.status === "PENDING" && delivery.attempts > 0) return "Retrying";
  return DELIVERY_STATUS_LABELS[delivery.status];
}

/**
 * Retry schedule, in seconds from the previous attempt.
 *
 * Seven attempts in all -- the first, then six retries -- spread over about
 * 22.6 hours (30s, 5m, 30m, 2h, 8h, 12h). Long enough that an endpoint down
 * for an evening still receives its events, short enough that a customer is
 * not surprised by a day-old event arriving as if it were new. After the last
 * one the delivery is EXHAUSTED and visible in Settings rather than retried
 * forever.
 */
export const WEBHOOK_RETRY_BACKOFF_SECONDS = [30, 300, 1800, 7200, 28800, 43200];

export function nextAttemptDelaySeconds(attempt: number): number | null {
  return WEBHOOK_RETRY_BACKOFF_SECONDS[attempt - 1] ?? null;
}

/**
 * How many consecutive failures before we stop an endpoint ourselves.
 *
 * An endpoint that has failed this many times in a row is not having a bad
 * minute — it has been decommissioned, or its certificate expired, and every
 * further attempt is us hammering a stranger's server. Disabling is visible and
 * reversible; silently continuing is neither.
 */
export const ENDPOINT_FAILURE_LIMIT = 20;
