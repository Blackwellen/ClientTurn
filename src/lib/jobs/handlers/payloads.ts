import { z } from "zod";

/**
 * Every job payload is validated before it is used. A payload is an argument,
 * never a fact: handlers re-read the referenced rows before acting.
 */

const uuid = z.uuid();

export const leadProcessPayload = z.object({
  leadId: uuid,
  serviceName: z.string().trim().max(200).optional(),
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
          "microsoft_ads",
          "tiktok_ads",
          "linkedin_ads",
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
