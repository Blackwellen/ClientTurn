/**
 * Campaign shapes, schemas and pure helpers. Deliberately free of
 * `server-only` and of any Supabase import so the wizard client components can
 * share them with the server actions.
 */

import { z } from "zod";
import { LEAD_STATUSES } from "@/lib/leads/filters";
import {
  findUnknownMergeFields,
  renderTemplate,
} from "@/lib/automation/scheduler";

export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CONTACT_STATES = [
  "pending",
  "scheduled",
  "sent",
  "delivered",
  "replied",
  "failed",
  "suppressed",
  "stopped",
] as const;

export type ContactState = (typeof CONTACT_STATES)[number];

export const CONTACT_STATE_LABELS: Record<ContactState, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  sent: "Sent",
  delivered: "Delivered",
  replied: "Replied",
  failed: "Failed",
  suppressed: "Suppressed",
  stopped: "Stopped",
};

/** Hard ceiling on one campaign, independent of plan allowance. */
export const MAX_CAMPAIGN_AUDIENCE = 5000;
export const DEFAULT_COOLDOWN_DAYS = 30;
export const MAX_MESSAGE_LENGTH = 640;

export const SUPPRESSION_LABELS: Record<string, string> = {
  opted_out: "Opted out of messages",
  invalid_number: "No usable mobile number",
  suppressed: "Number is on the suppression list",
  already_booked: "Already booked or won",
  contacted_recently: "Contacted too recently",
  active_conversation: "Conversation already in progress",
};

export { findUnknownMergeFields, renderTemplate };

export function suppressionLabel(reason: string) {
  return (
    SUPPRESSION_LABELS[reason] ??
    reason.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}

/* ------------------------------------------------------------- schemas --- */

const uuid = z.uuid();

export const audienceFilterSchema = z.object({
  serviceId: uuid.optional(),
  sourceId: uuid.optional(),
  statuses: z.array(z.enum(LEAD_STATUSES)).max(7).default([]),
  createdAfter: z.iso.date().optional(),
  createdBefore: z.iso.date().optional(),
  lastContactedBeforeDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(3650)
    .default(DEFAULT_COOLDOWN_DAYS),
});

export type AudienceFilter = z.infer<typeof audienceFilterSchema>;

export const DEFAULT_AUDIENCE_FILTER: AudienceFilter = {
  statuses: [],
  lastContactedBeforeDays: DEFAULT_COOLDOWN_DAYS,
};

export const campaignDraftSchema = z.object({
  name: z.string().trim().min(2).max(80),
  /** Card/list/drawer copy — one line on what the campaign is for. */
  description: z.string().trim().max(280).optional(),
  /** Human name for the audience; `audience` below stays the definition. */
  audienceLabel: z.string().trim().max(160).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  channel: z.enum(["sms", "whatsapp"]).default("sms"),
  audience: audienceFilterSchema,
  message: z.string().trim().min(10).max(MAX_MESSAGE_LENGTH),
  followup: z.string().trim().max(MAX_MESSAGE_LENGTH).optional(),
  followupDelayHours: z.coerce.number().int().min(1).max(336).default(48),
  sendMode: z.enum(["now", "schedule"]).default("now"),
  scheduledAt: z.string().trim().max(40).optional(),
  sendRatePerMinute: z.coerce.number().int().min(1).max(60).default(20),
  aiPersonalize: z.boolean().default(false),
});

export type CampaignDraft = z.infer<typeof campaignDraftSchema>;

export const campaignContactsParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25).catch(25),
  state: z.enum(["all", ...CONTACT_STATES]).default("all").catch("all"),
});

export type CampaignContactsParams = z.infer<
  typeof campaignContactsParamsSchema
>;

export function parseCampaignContactsParams(
  params: Record<string, string | string[] | undefined>,
): CampaignContactsParams {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  return campaignContactsParamsSchema.parse({
    page: first(params.page),
    pageSize: first(params.pageSize),
    state: first(params.state),
  });
}

/* ------------------------------------------------------- merge fields --- */

export const MERGE_FIELDS = [
  { token: "{{first_name}}", label: "First name", sample: "Sarah" },
  { token: "{{business_name}}", label: "Your business", sample: "Your business" },
  { token: "{{service_name}}", label: "Service", sample: "Boiler service" },
  { token: "{{business_phone}}", label: "Your phone", sample: "0161 000 0000" },
  { token: "{{booking_link}}", label: "Booking link", sample: "your booking link" },
] as const;

/** Preview uses the same renderer the worker uses, so what you see is sent. */
export function previewTemplate(template: string, businessName: string) {
  return renderTemplate(template, {
    first_name: "Sarah",
    business_name: businessName,
    service_name: "Boiler service",
    business_phone: "0161 000 0000",
    booking_link: "your booking link",
  });
}

const GSM_CHARS =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€";

export type SegmentInfo = {
  characters: number;
  segments: number;
  encoding: "GSM-7" | "Unicode";
  perSegment: number;
};

/** Mirrors how a carrier bills an SMS, so the cost of a word is visible. */
export function segmentInfo(body: string): SegmentInfo {
  let unicode = false;
  let units = 0;

  for (const char of body) {
    if (GSM_EXTENDED.includes(char)) units += 2;
    else if (GSM_CHARS.includes(char)) units += 1;
    else {
      unicode = true;
      units += char.codePointAt(0)! > 0xffff ? 2 : 1;
    }
  }

  if (unicode) {
    units = [...body].reduce(
      (total, char) => total + (char.codePointAt(0)! > 0xffff ? 2 : 1),
      0,
    );
    const single = 70;
    const multi = 67;
    return {
      characters: units,
      segments: units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi),
      encoding: "Unicode",
      perSegment: units <= single ? single : multi,
    };
  }

  const single = 160;
  const multi = 153;
  return {
    characters: units,
    segments: units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi),
    encoding: "GSM-7",
    perSegment: units <= single ? single : multi,
  };
}

/* --------------------------------------------------------------- rows --- */

export type CampaignListRow = {
  id: string;
  name: string;
  status: string;
  channel: string;
  audience: number;
  sent: number;
  replied: number;
  booked: number;
  createdAt: string;
  scheduledAt: string | null;
};

export type SuppressionGroup = {
  reason: string;
  label: string;
  count: number;
};

export type AudienceSampleRow = {
  id: string;
  name: string;
  phone: string | null;
  service: string | null;
  lastContactAt: string | null;
};

export type AudiencePreview = {
  matched: number;
  eligible: number;
  suppressed: SuppressionGroup[];
  sample: AudienceSampleRow[];
  excludedSample: (AudienceSampleRow & { reason: string })[];
  cappedAt: number | null;
  truncated: boolean;
};

export type CampaignContactRow = {
  id: string;
  leadId: string;
  name: string;
  phone: string | null;
  state: string;
  stoppedReason: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  repliedAt: string | null;
  booked: boolean;
};

export type CampaignDetail = {
  id: string;
  name: string;
  status: string;
  channel: string;
  messageTemplate: string | null;
  followupTemplate: string | null;
  scheduledAt: string | null;
  launchedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  sendRatePerMinute: number;
  filterConfig: unknown;
  suppressionSummary: SuppressionGroup[];
  totals: {
    audience: number;
    sent: number;
    delivered: number;
    replied: number;
    failed: number;
    stopped: number;
    pending: number;
    booked: number;
  };
  contacts: CampaignContactRow[];
  contactsTotal: number;
};

/* ------------------------------------------------------------- import --- */

export const IMPORT_FIELDS = [
  { key: "first_name", label: "First name", required: false },
  { key: "last_name", label: "Last name", required: false },
  { key: "phone", label: "Mobile number", required: true },
  { key: "email", label: "Email", required: false },
  { key: "service", label: "Service", required: false },
  { key: "postcode", label: "Postcode", required: false },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

export const importMappingSchema = z.object({
  first_name: z.string().max(120).optional(),
  last_name: z.string().max(120).optional(),
  phone: z.string().min(1).max(120),
  email: z.string().max(120).optional(),
  service: z.string().max(120).optional(),
  postcode: z.string().max(120).optional(),
});

export type ImportMapping = z.infer<typeof importMappingSchema>;

export type ImportRowError = { row: number; field: string; message: string };

export type ImportPreview = {
  headers: string[];
  rowCount: number;
  validCount: number;
  invalidCount: number;
  errors: ImportRowError[];
  sample: {
    row: number;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    service: string;
    postcode: string;
  }[];
};

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };
