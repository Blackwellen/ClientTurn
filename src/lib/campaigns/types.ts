/**
 * Campaign shapes, schemas and pure helpers. Deliberately free of
 * `server-only` and of any Supabase import so the wizard client components can
 * share them with the server actions.
 */

import { z } from "zod";
import { htmlToPlainText, sanitizeEmailHtml } from "../email/rich-text.ts";
import { LEAD_STATUSES } from "../leads/filters.ts";
import {
  findUnknownMergeFields,
  renderTemplate,
} from "../automation/scheduler.ts";
import {
  SUPPRESSION_REASONS,
  suppressionReasonLabel,
  type AudienceBreakdowns,
  type SuppressionReason,
} from "./reactivation-audience.ts";

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

/**
 * Email is not billed per segment, so the body limit exists only to keep a
 * campaign message a message rather than a newsletter. The subject limit is
 * the point past which every major client truncates in the inbox list.
 */
export const MAX_EMAIL_BODY_LENGTH = 5000;
export const MAX_SUBJECT_LENGTH = 150;

export { findUnknownMergeFields, renderTemplate };

/**
 * Suppression labels live in `reactivation-audience.ts` alongside the rules
 * that produce them, so a reason can never be renamed in one place and not
 * the other. This wrapper keeps the older call sites (drawer, campaign
 * detail) working with a plain string reason.
 */
export function suppressionLabel(reason: string, cooldownDays?: number) {
  return (SUPPRESSION_REASONS as readonly string[]).includes(reason)
    ? suppressionReasonLabel(reason as SuppressionReason, cooldownDays)
    : reason.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------- schemas --- */

const uuid = z.uuid();

/** Wizard default: leads that have gone quiet for a full quarter. */
export const DEFAULT_OLDER_THAN_DAYS = 90;
export const MAX_OLDER_THAN_DAYS = 3650;

export const audienceFilterSchema = z.object({
  serviceId: uuid.optional(),
  sourceId: uuid.optional(),
  statuses: z.array(z.enum(LEAD_STATUSES)).max(7).default([]),
  createdAfter: z.iso.date().optional(),
  createdBefore: z.iso.date().optional(),
  /** Lead age: only leads first received longer ago than this are considered. */
  olderThanDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_OLDER_THAN_DAYS)
    .default(DEFAULT_OLDER_THAN_DAYS),
  /** Only leads that have never replied to anything. */
  noReply: z.boolean().default(false),
  /** Only leads explicitly marked lost. */
  markedLost: z.boolean().default(false),
  /** Exclude anyone who has ever reached a booking. */
  notBooked: z.boolean().default(true),
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
  olderThanDays: DEFAULT_OLDER_THAN_DAYS,
  noReply: true,
  markedLost: false,
  notBooked: true,
  lastContactedBeforeDays: DEFAULT_COOLDOWN_DAYS,
};

const campaignDraftShape = z.object({
  name: z.string().trim().min(2).max(80),
  /** Card/list/drawer copy — one line on what the campaign is for. */
  description: z.string().trim().max(280).optional(),
  /** Human name for the audience; `audience` below stays the definition. */
  audienceLabel: z.string().trim().max(160).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  channel: z.enum(["sms", "whatsapp", "email"]).default("sms"),
  audience: audienceFilterSchema,
  /** Required on an email campaign; rejected on SMS/WhatsApp by the refine below. */
  subject: z.string().trim().max(MAX_SUBJECT_LENGTH).optional(),
  followupSubject: z.string().trim().max(MAX_SUBJECT_LENGTH).optional(),
  message: z.string().trim().min(10).max(MAX_EMAIL_BODY_LENGTH),
  followup: z.string().trim().max(MAX_EMAIL_BODY_LENGTH).optional(),
  followupDelayHours: z.coerce.number().int().min(1).max(336).default(48),
  sendMode: z.enum(["now", "schedule"]).default("now"),
  scheduledAt: z.string().trim().max(40).optional(),
  sendRatePerMinute: z.coerce.number().int().min(1).max(60).default(20),
  aiPersonalize: z.boolean().default(false),
});

/**
 * The body limit and the subject requirement both depend on the channel, so
 * they are enforced here rather than on the individual fields. This is the
 * schema the server action parses, so neither rule can be skipped by calling
 * the action directly.
 */
export const campaignDraftSchema = campaignDraftShape
  .transform((value) => {
    // An email body is markup and is reduced to the allowlist here, at the
    // single point every write passes through, so nothing downstream has to
    // trust what the browser sent. SMS and WhatsApp bodies are plain text and
    // are left exactly as written.
    if (value.channel !== "email") return value;
    return {
      ...value,
      message: sanitizeEmailHtml(value.message),
      followup: value.followup ? sanitizeEmailHtml(value.followup) : value.followup,
    };
  })
  .superRefine((value, ctx) => {
  const limit = value.channel === "email" ? MAX_EMAIL_BODY_LENGTH : MAX_MESSAGE_LENGTH;

  const measure = (body: string) =>
    value.channel === "email" ? htmlToPlainText(body).length : body.length;

  for (const [field, body] of [
    ["message", value.message],
    ["followup", value.followup],
  ] as const) {
    if (body && measure(body) > limit) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `Keep the ${field === "message" ? "message" : "follow-up"} under ${limit} characters.`,
      });
    }
  }

  if (value.channel === "email") {
    if (!value.subject || value.subject.trim().length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["subject"],
        message: "An email campaign needs a subject line.",
      });
    }
    if (value.followup && !value.followupSubject) {
      ctx.addIssue({
        code: "custom",
        path: ["followupSubject"],
        message: "An email follow-up needs its own subject line.",
      });
    }
  }
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

/**
 * Only tokens the send worker's `mergeValues` can actually resolve appear
 * here — an unresolvable token would ship as literal `{{...}}` to a customer.
 */
export const MERGE_FIELDS = [
  { token: "{{first_name}}", label: "First name", sample: "Jamie" },
  { token: "{{last_name}}", label: "Last name", sample: "Bell" },
  { token: "{{full_name}}", label: "Full name", sample: "Jamie Bell" },
  { token: "{{service_name}}", label: "Service", sample: "roof repair" },
  { token: "{{business_name}}", label: "Your business", sample: "Your business" },
  { token: "{{booking_link}}", label: "Booking link", sample: "https://yourbookinglink.com" },
  { token: "{{business_phone}}", label: "Your phone", sample: "0161 000 0000" },
] as const;

/** Preview uses the same renderer the worker uses, so what you see is sent. */
export function previewTemplate(
  template: string,
  businessName: string,
  overrides?: { serviceName?: string },
) {
  return renderTemplate(template, {
    first_name: "Jamie",
    last_name: "Bell",
    full_name: "Jamie Bell",
    business_name: businessName,
    service_name: overrides?.serviceName ?? "roof repair",
    business_phone: "0161 000 0000",
    booking_link: "https://yourbookinglink.com",
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

/** Every reason, in engine order, including the ones that matched nobody. */
export function fullSuppressionBreakdown(
  groups: readonly SuppressionGroup[],
  cooldownDays: number,
): SuppressionGroup[] {
  const byReason = new Map(groups.map((group) => [group.reason, group.count]));
  return SUPPRESSION_REASONS.map((reason) => ({
    reason,
    label: suppressionReasonLabel(reason, cooldownDays),
    count: byReason.get(reason) ?? 0,
  }));
}

export type AudienceSampleRow = {
  id: string;
  name: string;
  phone: string | null;
  service: string | null;
  lastContactAt: string | null;
};

export type AudiencePreview = {
  /** Every non-test lead in the workspace, before any filter. */
  totalLeads: number;
  /** Leads left after the Step 1 filters, before suppression. */
  matched: number;
  eligible: number;
  /**
   * Unique leads excluded by suppression. Per-reason counts in `suppressed`
   * are mutually exclusive (first matching rule wins) and sum to this.
   */
  suppressedTotal: number;
  suppressed: SuppressionGroup[];
  breakdowns: AudienceBreakdowns;
  /** The cooldown window the suppression run used, for labelling. */
  cooldownDays: number;
  sample: AudienceSampleRow[];
  excludedSample: (AudienceSampleRow & { reason: string })[];
  cappedAt: number | null;
  truncated: boolean;
};

export const EMPTY_AUDIENCE_PREVIEW: AudiencePreview = {
  totalLeads: 0,
  matched: 0,
  eligible: 0,
  suppressedTotal: 0,
  suppressed: [],
  breakdowns: { service: [], source: [], status: [], age: [] },
  cooldownDays: DEFAULT_COOLDOWN_DAYS,
  sample: [],
  excludedSample: [],
  cappedAt: null,
  truncated: false,
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
