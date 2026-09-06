/**
 * Filter, copy and pure helpers for the merged /app/follow-up page. No
 * `server-only` and no Supabase import, so client components can use these
 * safely. (Server reads live in the sibling `queries.ts`.)
 *
 * The page keeps its view state in the URL (`?view=`) so the active view is
 * linkable, bookmarkable and moves with browser back/forward.
 */

import { z } from "zod";

export const FOLLOW_UP_VIEWS = ["follow-up", "qualification"] as const;
export type FollowUpViewValue = (typeof FOLLOW_UP_VIEWS)[number];

/**
 * The page title is the same in both views — only the subtitle changes, so the
 * switch reads as two views of one module rather than two separate pages.
 */
export const FOLLOW_UP_PAGE_TITLE = "Follow-Up";

export const FOLLOW_UP_VIEW_META: Record<
  FollowUpViewValue,
  { label: string; description: string }
> = {
  "follow-up": {
    label: "Follow-Up",
    description: "Put your day-to-day automation in one understandable place.",
  },
  qualification: {
    label: "Qualification",
    description:
      "Put all day-to-day automation and qualification configuration in one understandable place.",
  },
};

export const followUpFilterSchema = z.object({
  view: z.enum(FOLLOW_UP_VIEWS).default("follow-up").catch("follow-up"),
  /** Which sequence the Follow-Up editor has open. */
  sequence: z.string().trim().max(64).optional().catch(undefined),
  /** Which service the Qualification preview is answering as. */
  service: z.string().trim().max(64).optional().catch(undefined),
});

export type FollowUpFilters = z.infer<typeof followUpFilterSchema>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseFollowUpFilters(
  params: Record<string, string | string[] | undefined>,
): FollowUpFilters {
  return followUpFilterSchema.parse({
    view: first(params.view),
    sequence: first(params.sequence),
    service: first(params.service),
  });
}

/**
 * Builds an `/app/follow-up` href from the raw current search params plus a
 * patch, preserving every param this function does not know about. `null`
 * removes a key.
 */
export function followUpHref(
  current: Record<string, string | string[] | undefined>,
  patch: Record<string, string | null>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    const v = first(value);
    if (v) params.set(key, v);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  // The default view carries no param, keeping the plain URL the linkable one.
  if (params.get("view") === "follow-up") params.delete("view");
  const query = params.toString();
  return query ? `/app/follow-up?${query}` : "/app/follow-up";
}

/* ------------------------------------------------------------------ status */

export type FollowUpPublishState =
  | "published"
  | "draft"
  | "paused"
  | "unconfigured";

export const FOLLOW_UP_STATE_META: Record<
  FollowUpPublishState,
  {
    badge: string;
    tone: "success" | "warning" | "neutral" | "info";
    title: string;
    description: string;
  }
> = {
  published: {
    badge: "Published",
    tone: "success",
    title: "Follow-up automation is active",
    description: "Your follow-up sequence is published and running.",
  },
  paused: {
    badge: "Paused",
    tone: "warning",
    title: "Follow-up automation is paused",
    description:
      "Your sequence is published but held. No further step is sent until you switch it back on.",
  },
  draft: {
    badge: "Draft",
    tone: "info",
    title: "Follow-up automation is not live yet",
    description:
      "Your sequence has never been published, so no lead has entered it.",
  },
  unconfigured: {
    badge: "Not set up",
    tone: "neutral",
    title: "No follow-up sequence yet",
    description:
      "Create a sequence and new leads are chased automatically from the moment they arrive.",
  },
};

/** What the status card renders. Every field is read, never assumed. */
export type FollowUpStatus = {
  state: FollowUpPublishState;
  /** ISO timestamp of the last publish, or the last draft save if never published. */
  updatedAt: string | null;
  /** Initials of whoever last published, e.g. "JT". Null when unknown. */
  updatedByInitials: string | null;
  updatedByName: string | null;
};

/* ------------------------------------------------------- merge field picker */

/**
 * The `{ }` popover only ever offers fields the send pipeline can actually
 * resolve. This list is asserted against `MERGE_FIELDS` in
 * `@/lib/automation/scheduler` by the unit tests, so the picker can never
 * offer a token that would then block publishing.
 */
export const MERGE_FIELD_OPTIONS: {
  token: string;
  label: string;
  hint: string;
}[] = [
  { token: "{{first_name}}", label: "First name", hint: "The lead's first name" },
  {
    token: "{{business_name}}",
    label: "Business name",
    hint: "Your business name",
  },
  {
    token: "{{service_name}}",
    label: "Service",
    hint: "The service the lead asked about",
  },
  {
    token: "{{booking_link}}",
    label: "Booking link",
    hint: "Your configured booking destination",
  },
  {
    token: "{{business_phone}}",
    label: "Business phone",
    hint: "Your business phone number",
  },
];

/* --------------------------------------------------------- delay value/unit */

export const DELAY_UNITS = ["immediate", "minute", "hour", "day"] as const;
export type DelayUnit = (typeof DELAY_UNITS)[number];

export const DELAY_UNIT_META: Record<
  DelayUnit,
  { label: string; plural: string; seconds: number }
> = {
  immediate: { label: "Immediately", plural: "Immediately", seconds: 0 },
  minute: { label: "minute", plural: "minutes", seconds: 60 },
  hour: { label: "hour", plural: "hours", seconds: 3600 },
  day: { label: "day", plural: "days", seconds: 86400 },
};

/** Largest whole unit that divides the delay, so 7200s reads as "2 hours". */
export function splitDelay(seconds: number): { value: number; unit: DelayUnit } {
  if (seconds <= 0) return { value: 0, unit: "immediate" };
  if (seconds % 86400 === 0) return { value: seconds / 86400, unit: "day" };
  if (seconds % 3600 === 0) return { value: seconds / 3600, unit: "hour" };
  return { value: Math.max(1, Math.round(seconds / 60)), unit: "minute" };
}

export function joinDelay(value: number, unit: DelayUnit): number {
  if (unit === "immediate") return 0;
  return Math.max(0, Math.round(value)) * DELAY_UNIT_META[unit].seconds;
}

/** "Immediately", "+ 10 minutes", "+ 2 hours" — the sequence row heading. */
export function formatStepDelay(seconds: number): string {
  const { value, unit } = splitDelay(seconds);
  if (unit === "immediate") return "Immediately";
  const meta = DELAY_UNIT_META[unit];
  return `+ ${value} ${value === 1 ? meta.label : meta.plural}`;
}

export const MAX_SEQUENCE_STEPS = 12;
/** 30 days, matching `stepInputSchema` in @/lib/automations/types. */
export const MAX_DELAY_SECONDS = 2_592_000;

/* ------------------------------------------------------- booking reminders */

export const REMINDER_OFFSETS = [
  { minutes: 15, label: "15 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 120, label: "2 hours before" },
  { minutes: 720, label: "12 hours before" },
  { minutes: 1440, label: "24 hours before" },
  { minutes: 2880, label: "48 hours before" },
] as const;

export const DEFAULT_REMINDER_MINUTES = 1440;

export function reminderOffsetLabel(minutes: number): string {
  return (
    REMINDER_OFFSETS.find((option) => option.minutes === minutes)?.label ??
    `${minutes} minutes before`
  );
}

/** Snaps an arbitrary stored offset onto the nearest offered option. */
export function nearestReminderOffset(minutes: number): number {
  let best: { minutes: number; label: string } = REMINDER_OFFSETS[0];
  for (const option of REMINDER_OFFSETS) {
    if (Math.abs(option.minutes - minutes) < Math.abs(best.minutes - minutes)) {
      best = option;
    }
  }
  return best.minutes;
}

/* -------------------------------------------------------------- test sends */

/**
 * A test send. Email tests take an address rather than a number, so the
 * destination is validated against the channel rather than assuming a phone.
 */
export const testSendSchema = z
  .object({
    channel: z.enum(["sms", "whatsapp", "email"]),
    to: z.string().trim().min(3).max(120),
    body: z.string().trim().min(1, "Write the message you want to test.").max(1200),
  })
  .refine(
    (value) =>
      value.channel === "email"
        ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.to)
        : /^[+0-9 ()-]{7,30}$/.test(value.to),
    {
      path: ["to"],
      message: "Enter a valid destination for this channel.",
    },
  );

export type TestSendInput = z.infer<typeof testSendSchema>;

export const DEFAULT_TEST_MESSAGE =
  "Hi! This is a test of your follow-up sequence from {{business_name}}.";

/* ------------------------------------------------------ sequence validation */

export type SequenceIssue = { key: string; message: string };

/**
 * The single source of truth for whether the green "Sequence looks good!"
 * footer may appear. Pure, so the same rules run in the editor and in the
 * tests; the server re-validates independently before publishing.
 */
export function validateSequence(
  steps: {
    key: string;
    delaySeconds: number;
    template: string;
    enabled: boolean;
    channel: string;
  }[],
  options: {
    unknownTokensFor: (template: string) => string[];
    whatsappEnabled: boolean;
  },
): SequenceIssue[] {
  const issues: SequenceIssue[] = [];

  if (steps.length === 0) {
    issues.push({ key: "empty", message: "Add at least one step." });
    return issues;
  }

  steps.forEach((step, index) => {
    const label = `Step ${index + 1}`;
    if (step.template.trim().length === 0) {
      issues.push({ key: `${step.key}-body`, message: `${label} has no message.` });
    }
    if (step.delaySeconds < 0 || step.delaySeconds > MAX_DELAY_SECONDS) {
      issues.push({
        key: `${step.key}-delay`,
        message: `${label} has a delay outside the permitted range.`,
      });
    }
    if (index > 0 && step.delaySeconds === 0) {
      issues.push({
        key: `${step.key}-immediate`,
        message: `${label} sends at the same moment as the step before it.`,
      });
    }
    const unknown = options.unknownTokensFor(step.template);
    if (unknown.length > 0) {
      issues.push({
        key: `${step.key}-tokens`,
        message: `${label} uses ${unknown
          .map((token) => `{{${token}}}`)
          .join(", ")}, which cannot be filled in.`,
      });
    }
    if (step.channel === "whatsapp" && !options.whatsappEnabled) {
      issues.push({
        key: `${step.key}-channel`,
        message: `${label} uses WhatsApp, which is not on your plan.`,
      });
    }
  });

  if (!steps.some((step) => step.enabled)) {
    issues.push({
      key: "none-enabled",
      message: "Every step is switched off, so nothing would send.",
    });
  }

  return issues;
}
