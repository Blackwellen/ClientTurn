/**
 * Automation shapes and pure helpers. No `server-only` import and no Supabase
 * import, so client components can use these safely.
 */

import { z } from "zod";

export const AUTOMATION_TYPES = [
  "new_lead",
  "booking_reminder",
  "unresponsive",
] as const;

export type AutomationType = (typeof AUTOMATION_TYPES)[number];

export const AUTOMATION_TYPE_META: Record<
  AutomationType,
  { label: string; trigger: string; description: string }
> = {
  new_lead: {
    label: "New lead follow-up",
    trigger: "A new lead arrives from a connected source",
    description:
      "The first contact sequence. It runs from the moment a lead is created until they reply, book, or the sequence ends.",
  },
  booking_reminder: {
    label: "Booking reminder",
    trigger: "A lead has a scheduled booking",
    description:
      "Reminders sent ahead of a confirmed appointment to reduce no-shows.",
  },
  unresponsive: {
    label: "Unresponsive lead follow-up",
    trigger: "A lead has been contacted but has not replied",
    description:
      "A slower cadence for leads who went quiet after the first sequence finished.",
  },
};

export const CHANNELS = ["sms", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABEL: Record<Channel, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
};

export type AutomationStatus = "active" | "paused" | "draft";

export const AUTOMATION_STATUS_META: Record<
  AutomationStatus,
  { label: string; tone: "success" | "warning" | "neutral" }
> = {
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  draft: { label: "Draft", tone: "neutral" },
};

export type AutomationStep = {
  id: string;
  position: number;
  delaySeconds: number;
  channel: Channel;
  template: string;
  enabled: boolean;
};

export type AutomationVersionSummary = {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt: string | null;
  updatedAt: string;
  stepCount: number;
  leadsInSequence: number;
};

export type AutomationListItem = {
  id: string;
  type: AutomationType;
  name: string;
  enabled: boolean;
  status: AutomationStatus;
  stepCount: number;
  cadence: string;
  channels: Channel[];
  hasDraft: boolean;
  leadsInSequence: number;
  updatedAt: string;
};

export type AutomationDetail = {
  id: string;
  type: AutomationType;
  name: string;
  enabled: boolean;
  status: AutomationStatus;
  versions: AutomationVersionSummary[];
  publishedVersionNumber: number | null;
  /** The version the editor writes to. Always a draft once anything is saved. */
  editingVersionId: string | null;
  editingVersionNumber: number;
  editingIsDraft: boolean;
  steps: AutomationStep[];
  leadsInSequence: number;
  leadsOnOlderVersions: number;
  updatedAt: string;
};

export type QuietHoursSettings = {
  enabled: boolean;
  /** "HH:MM" local to the business timezone. */
  start: string;
  end: string;
  timezone: string;
};

export const DELAY_PRESETS: { seconds: number; label: string }[] = [
  { seconds: 0, label: "Immediately" },
  { seconds: 300, label: "5 minutes" },
  { seconds: 600, label: "10 minutes" },
  { seconds: 1800, label: "30 minutes" },
  { seconds: 3600, label: "1 hour" },
  { seconds: 7200, label: "2 hours" },
  { seconds: 21600, label: "6 hours" },
  { seconds: 86400, label: "1 day" },
  { seconds: 172800, label: "2 days" },
  { seconds: 259200, label: "3 days" },
  { seconds: 604800, label: "7 days" },
];

export function formatDelay(seconds: number): string {
  if (seconds <= 0) return "Immediately";
  const preset = DELAY_PRESETS.find((option) => option.seconds === seconds);
  if (preset) return preset.label;
  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function cadenceSummary(steps: { delaySeconds: number }[]): string {
  if (steps.length === 0) return "No steps yet";
  return steps.map((step) => formatDelay(step.delaySeconds)).join(" → ");
}

/**
 * Always enforced, never editable. Mirrors evaluateStopConditions in
 * @/lib/automation/scheduler — the two must stay in step.
 */
export const STOP_CONDITIONS: { label: string; detail: string }[] = [
  {
    label: "The lead replies",
    detail:
      "Any inbound message ends the sequence. Qualification, or a person, takes it from there.",
  },
  {
    label: "The lead opts out",
    detail:
      "A stop word or opt-out ends the sequence permanently and suppresses the contact.",
  },
  {
    label: "The lead books",
    detail: "A booking moves the lead to Booked and no further step is sent.",
  },
  {
    label: "The lead is marked won or lost",
    detail: "Either outcome closes the lead and ends the sequence.",
  },
  {
    label: "A person takes over",
    detail:
      "Human takeover stops automated follow-up until someone resumes it.",
  },
  {
    label: "Follow-up is paused",
    detail:
      "Pausing this automation, or pausing follow-up on the individual lead, stops the next send.",
  },
  {
    label: "The subscription is inactive",
    detail: "No automated message is sent without an active subscription.",
  },
  {
    label: "The messaging channel is unavailable",
    detail:
      "If the messaging integration is unhealthy or the number is suppressed, the send stops rather than retrying blindly.",
  },
];

export const STOP_CONDITION_NOTE =
  "These are re-checked against live lead state immediately before every single send. A step that was scheduled hours ago can never bypass what is true now.";

export const QUIET_HOURS_NOTE =
  "Quiet hours never drop a message. A send that falls inside the window is moved forward to the next permitted minute.";

export const VERSIONING_NOTE =
  "Editing a published automation creates a new draft version. Publishing it archives the old one. Leads already part-way through the sequence finish on the version they started, so nobody receives a half-old, half-new sequence.";

export const SEQUENCE_SCOPE_NOTE =
  "Every step sends one message on one channel after a delay. Qualification questions are asked by the qualification rules, not by a step here, and the booking link is inserted with the {{booking_link}} merge field.";

// ------------------------------------------------------------------ schemas

export const stepInputSchema = z.object({
  delaySeconds: z.coerce.number().int().min(0).max(2_592_000),
  channel: z.enum(CHANNELS),
  template: z.string().trim().min(1).max(1200),
  enabled: z.boolean(),
});

export type StepInput = z.infer<typeof stepInputSchema>;

export const saveDraftSchema = z.object({
  automationId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  steps: z.array(stepInputSchema).min(1).max(12),
});

export const quietHoursSchema = z.object({
  enabled: z.boolean(),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
