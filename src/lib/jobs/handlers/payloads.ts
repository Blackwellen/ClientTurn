import { z } from "zod";

/**
 * Every job payload is validated before it is used. A payload is an argument,
 * never a fact: handlers re-read the referenced rows before acting.
 */

const uuid = z.uuid();

export const leadProcessPayload = z.object({
  leadId: uuid,
  serviceName: z.string().trim().max(200).optional(),
  /**
   * The touch that queued this run (ingestLead, design 03 §1). Absent for the
   * callers that still insert directly (onboarding test lead, promotion).
   */
  touchId: uuid.optional(),
  /** False when the touch matched a lead that already existed (a repeat enquiry). */
  newLead: z.boolean().default(true),
  /**
   * FULL runs qualification, metering and follow-up. RECORD_ONLY attributes,
   * records permission, notifies integrations and scores, and starts nothing:
   * a merged repeat enquiry, a suppressed or review lead, a social DM, or an
   * import the operator did not ask to message (ingest/plan.ts processModeFor).
   */
  mode: z.enum(["FULL", "RECORD_ONLY"]).default("FULL"),
  source: z
    .object({
      provider: z
        .enum([
          "meta",
          "csv",
          "manual",
          "test",
          "webform",
          "google_ads",
          "tiktok_ads",
          "linkedin_ads",
          "api",
          "mcp",
          "meta_dm",
          "connector",
        ])
        .default("meta"),
      pageId: z.string().max(120).optional(),
      pageName: z.string().max(200).optional(),
      formId: z.string().max(120).optional(),
      formName: z.string().max(200).optional(),
      campaignId: z.string().max(120).optional(),
      campaignName: z.string().max(200).optional(),
      adsetId: z.string().max(120).optional(),
      adsetName: z.string().max(200).optional(),
      adId: z.string().max(120).optional(),
      adName: z.string().max(200).optional(),
      sourceName: z.string().max(200).optional(),
    })
    .optional(),
});

export const messageSendPayload = z.object({
  messageId: uuid,
  leadId: uuid.optional(),
  sendKey: z.string().max(200).optional(),
});

export const messageInboundPayload = z.object({
  webhookEventId: uuid.optional(),
  provider: z.string().max(40).default("twilio"),
  externalEventId: z.string().max(200).optional(),
});

export const automationAdvancePayload = z.object({
  leadId: uuid,
  runId: uuid.optional(),
  automationType: z
    .enum(["new_lead", "booking_reminder", "unresponsive"])
    .default("new_lead"),
});

export const emailPollPayload = z.object({ businessId: uuid });

export const campaignExpandPayload = z.object({ campaignId: uuid });

export const campaignSendPayload = z.object({
  campaignId: uuid,
  contactIds: z.array(uuid).max(200).optional(),
});

export const bookingSyncPayload = z.object({
  webhookEventId: uuid.optional(),
  businessId: uuid,
  provider: z.enum(["calendly", "google_calendar", "manual"]).default("manual"),
  externalEventId: z.string().max(200).optional(),
  leadId: uuid.optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(40).optional(),
  serviceId: uuid.optional(),
  startsAt: z.string().max(40).optional(),
  endsAt: z.string().max(40).optional(),
  location: z.string().max(400).optional(),
  bookingUrl: z.string().max(2000).optional(),
  rescheduleUrl: z.string().max(2000).optional(),
  cancelUrl: z.string().max(2000).optional(),
  status: z
    .enum(["scheduled", "completed", "cancelled", "no_show"])
    .default("scheduled"),
  notes: z.string().max(2000).optional(),
  /**
   * Phase 3.1, Calendly reschedules. On `cancelled`: this cancellation is the
   * old half of a reschedule (Calendly's `rescheduled: true`). On `scheduled`:
   * `previousExternalEventId` names the event this one replaces (parsed from
   * Calendly's `old_invitee`), so the existing row moves instead of a second
   * booking appearing.
   */
  rescheduled: z.boolean().optional(),
  previousExternalEventId: z.string().max(200).optional(),
});

export const integrationHealthPayload = z.object({
  businessId: uuid,
  integrationId: uuid.optional(),
  requestedBy: z.string().max(60).optional(),
});

export const webhookReplayPayload = z.object({
  webhookEventId: uuid,
  provider: z.string().max(40).optional(),
  externalEventId: z.string().max(200).optional(),
});

export const notificationSendPayload = z.object({
  businessId: uuid,
  userId: uuid.nullish(),
  kind: z.string().max(60).optional(),
  type: z
    .enum([
      "handover",
      "booking",
      "integration_failure",
      "message_failed",
      "campaign_complete",
      "campaign_paused",
      "billing",
      "usage_limit",
      "lead_attention",
    ])
    .optional(),
  severity: z.enum(["info", "warning", "error"]).default("info"),
  title: z.string().max(200).optional(),
  body: z.string().max(2000).optional(),
  linkUrl: z.string().max(2000).optional(),
  entityType: z.string().max(60).optional(),
  entityId: uuid.optional(),
});

export const usageAggregatePayload = z.object({
  businessId: uuid.optional(),
});

export const retentionCleanupPayload = z.object({
  businessId: uuid.optional(),
  /** Overrides the default window; bounded so a typo cannot wipe live data. */
  retentionDays: z.number().int().min(30).max(3650).optional(),
});

export const costRollupDailyPayload = z.object({
  businessId: uuid.optional(),
  /** YYYY-MM-DD, UTC. Defaults to yesterday when omitted. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const costRollupMonthlyPayload = z.object({
  businessId: uuid.optional(),
  /** YYYY-MM-01, UTC. Defaults to last calendar month when omitted. */
  billingPeriod: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
});

/* --------------------------------------------------------- social outreach */

/**
 * One workspace's due social rows.
 *
 * `businessId` is required rather than optional, unlike the maintenance
 * payloads above. Those legitimately mean "every workspace" when omitted; this
 * one never does, and an omitted id here would mean a bug had queued a job
 * that silently did nothing.
 */
export const socialAdvancePayload = z.object({
  businessId: uuid,
});

/**
 * Perform one prepared social action against a partner API.
 *
 * Deliberately addresses the *prospect and platform* rather than the outbound
 * message id. The message a retry should send is whichever is currently in
 * DRAFT for that pair -- if the original was discarded because the prospect
 * replied in the meantime, there is nothing to send, and a job keyed on the
 * message id would happily send it anyway.
 */
export const socialExecutePayload = z.object({
  businessId: uuid,
  prospectId: uuid,
  platform: z.enum(["LINKEDIN", "FACEBOOK", "INSTAGRAM", "TIKTOK"]),
});

/** Points at the recorded webhook_events row; the handler re-reads it rather than trusting a repeated copy. */
export const slackInteractionPayload = z.object({
  externalEventId: z.string().min(1).max(200),
});

/* ------------------------------------------------------------ lead scoring */

/**
 * Re-score one lead (design doc 04 §2). `triggerEvent` names what changed
 * (`lead.processed`, `reply.classified:<messageId>`, `booking.no_show:<id>`) and
 * is half of the idempotency key: the same event is scored once per engine
 * version, however many times the job runs.
 */
export const leadScorePayload = z.object({
  leadId: uuid,
  triggerEvent: z
    .string()
    .min(1)
    .max(200)
    // Up to two id segments: `reply.classified:<id>`, and a person's
    // re-score from the lead page, `manual:<userId>:<epoch ms>` (lead.rescore).
    .regex(/^[a-z_]+(\.[a-z_]+)*(:[A-Za-z0-9_-]+){0,2}$/),
  /** The domain event that asked for this score (event outbox, design 03 §4). */
  causationId: uuid.optional(),
  causationDepth: z.number().int().min(0).max(100).optional(),
});

/* ---------------------------------------------------------------- ingest */

/**
 * A verified inbound lead webhook, recorded in `webhook_events` by its route
 * and ingested here (CLAUDE.md: verify, record, acknowledge, queue). The
 * handler re-reads the stored row rather than trusting the payload.
 */
export const ingestWebhookPayload = z.object({
  webhookEventId: uuid,
  provider: z.enum(["google_ads"]),
});
