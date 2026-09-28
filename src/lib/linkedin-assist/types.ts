/**
 * LinkedIn Assist: the rules, with no I/O.
 *
 * Owner decision 2026-09-28, binding: **the AI drafts; a person sends.** No
 * automation of anybody's LinkedIn account, no browser extension, no scraping
 * and no LinkedIn API messaging. What this product does is decide what is
 * worth doing today, write it, pace it well under LinkedIn's own limits, and
 * keep the record straight when the person says it was done.
 *
 * Pure -- no `server-only`, no Supabase -- so the pacing, the state machine and
 * the stop conditions are unit-tested and shown in the UI from the same source
 * the service layer enforces them from. Relative `.ts` imports only, for the
 * node test runner.
 */

import { z } from "zod";
import { MAX_INVITE_NOTE_CHARS, MAX_SOCIAL_MESSAGE_CHARS } from "../outreach/social-limits.ts";

/* ================================================================ vocabulary */

export const LINKEDIN_TASK_KINDS = ["CONNECTION_NOTE", "FOLLOW_UP", "INMAIL", "REPLY"] as const;
export type LinkedInTaskKind = (typeof LINKEDIN_TASK_KINDS)[number];

export const LINKEDIN_TASK_STATUSES = ["OPEN", "SENT", "SKIPPED", "CANCELLED"] as const;
export type LinkedInTaskStatus = (typeof LINKEDIN_TASK_STATUSES)[number];

export const LINKEDIN_CONTACT_STATES = [
  "NOT_STARTED",
  "INVITED",
  "MESSAGED",
  "REPLIED",
  "FINISHED",
  "STOPPED",
] as const;
export type LinkedInContactState = (typeof LINKEDIN_CONTACT_STATES)[number];

export const LINKEDIN_STOP_REASONS = [
  "OPTED_OUT",
  "WON",
  "LOST",
  "REMOVED",
  "SKIPPED",
  "NO_RESPONSE",
  "MOVED_TO_EMAIL",
  "MOVED_TO_SMS",
  "MOVED_TO_CALL",
] as const;
export type LinkedInStopReason = (typeof LINKEDIN_STOP_REASONS)[number];

export const LINKEDIN_ACCOUNT_TIERS = ["FREE", "PREMIUM", "SALES_NAVIGATOR"] as const;
export type LinkedInAccountTier = (typeof LINKEDIN_ACCOUNT_TIERS)[number];

export const LINKEDIN_FIRST_TOUCHES = ["CONNECTION_NOTE", "INMAIL"] as const;
export type LinkedInFirstTouch = (typeof LINKEDIN_FIRST_TOUCHES)[number];

export const TASK_KIND_LABEL: Record<LinkedInTaskKind, string> = {
  CONNECTION_NOTE: "Connection request",
  FOLLOW_UP: "Message",
  INMAIL: "InMail",
  REPLY: "Reply",
};

export const STOP_REASON_LABEL: Record<LinkedInStopReason, string> = {
  OPTED_OUT: "They asked not to be contacted",
  WON: "Marked won",
  LOST: "Marked lost",
  REMOVED: "Removed from LinkedIn Assist",
  SKIPPED: "Skipped",
  NO_RESPONSE: "No reply after the last follow-up",
  MOVED_TO_EMAIL: "Moved to email",
  MOVED_TO_SMS: "Moved to SMS",
  MOVED_TO_CALL: "Moved to a call",
};

/* ==================================================================== limits */

/**
 * The pacing ceilings. Defaults AND maxima: a person may set their own lower,
 * never higher. Well under what LinkedIn tolerates (roughly 100 invitations a
 * week and far more messages), because the cost of being over is the
 * customer's own account being restricted, and the cost of being under is a
 * slightly slower week. Mirrored by the CHECK constraints in 0171.
 */
export const LINKEDIN_ASSIST_LIMITS = {
  dailyConnectionNotes: 15,
  weeklyConnectionRequests: 80,
  dailyMessages: 30,
  followUpAfterDaysMin: 3,
  followUpAfterDaysMax: 30,
  followUpAfterDaysDefault: 4,
  maxFollowUps: 2,
  maxSnoozes: 2,
  /** Personalised invitation notes a Free LinkedIn account gets per month (LinkedIn Help a563153). */
  freeMonthlyNotes: 3,
} as const;

/** InMail credits per month by tier: the most a person may tell us they have. */
export const INMAIL_CREDIT_CEILING: Record<LinkedInAccountTier, number> = {
  FREE: 0,
  PREMIUM: 15,
  SALES_NAVIGATOR: 50,
};

export const CONNECTION_NOTE_MAX_CHARS = MAX_INVITE_NOTE_CHARS; // 300
export const LINKEDIN_MESSAGE_MAX_CHARS = MAX_SOCIAL_MESSAGE_CHARS; // 1900
export const LOGGED_REPLY_MAX_CHARS = 4000;

export type LinkedInAssistSettings = {
  accountTier: LinkedInAccountTier;
  dailyConnectionNotes: number;
  weeklyConnectionRequests: number;
  dailyMessages: number;
  monthlyInMailCredits: number;
  followUpAfterDays: number;
  maxFollowUps: number;
  paused: boolean;
};

export const DEFAULT_LINKEDIN_ASSIST_SETTINGS: LinkedInAssistSettings = {
  accountTier: "FREE",
  dailyConnectionNotes: LINKEDIN_ASSIST_LIMITS.dailyConnectionNotes,
  weeklyConnectionRequests: LINKEDIN_ASSIST_LIMITS.weeklyConnectionRequests,
  dailyMessages: LINKEDIN_ASSIST_LIMITS.dailyMessages,
  monthlyInMailCredits: 0,
  followUpAfterDays: LINKEDIN_ASSIST_LIMITS.followUpAfterDaysDefault,
  maxFollowUps: LINKEDIN_ASSIST_LIMITS.maxFollowUps,
  paused: false,
};

/** The settings form. Every ceiling is the default: configurable lower only. */
export const linkedInAssistSettingsSchema = z
  .object({
    accountTier: z.enum(LINKEDIN_ACCOUNT_TIERS),
    dailyConnectionNotes: z.number().int().min(0).max(LINKEDIN_ASSIST_LIMITS.dailyConnectionNotes),
    weeklyConnectionRequests: z
      .number()
      .int()
      .min(0)
      .max(LINKEDIN_ASSIST_LIMITS.weeklyConnectionRequests),
    dailyMessages: z.number().int().min(0).max(LINKEDIN_ASSIST_LIMITS.dailyMessages),
    monthlyInMailCredits: z.number().int().min(0).max(INMAIL_CREDIT_CEILING.SALES_NAVIGATOR),
    followUpAfterDays: z
      .number()
      .int()
      .min(LINKEDIN_ASSIST_LIMITS.followUpAfterDaysMin)
      .max(LINKEDIN_ASSIST_LIMITS.followUpAfterDaysMax),
    maxFollowUps: z.number().int().min(0).max(LINKEDIN_ASSIST_LIMITS.maxFollowUps),
    paused: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.monthlyInMailCredits > INMAIL_CREDIT_CEILING[value.accountTier]) {
      ctx.addIssue({
        code: "custom",
        path: ["monthlyInMailCredits"],
        message:
          value.accountTier === "FREE"
            ? "A free LinkedIn account has no InMail credits."
            : `A ${value.accountTier === "PREMIUM" ? "Premium" : "Sales Navigator"} account gets at most ${INMAIL_CREDIT_CEILING[value.accountTier]} a month.`,
      });
    }
  });

/** Reads a stored row defensively: anything out of range falls back to the safe side. */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): LinkedInAssistSettings {
  if (!row) return { ...DEFAULT_LINKEDIN_ASSIST_SETTINGS };
  const tier = (LINKEDIN_ACCOUNT_TIERS as readonly string[]).includes(String(row.account_tier))
    ? (row.account_tier as LinkedInAccountTier)
    : "FREE";
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    accountTier: tier,
    dailyConnectionNotes: clamp(row.daily_connection_notes, 0, LINKEDIN_ASSIST_LIMITS.dailyConnectionNotes, LINKEDIN_ASSIST_LIMITS.dailyConnectionNotes),
    weeklyConnectionRequests: clamp(row.weekly_connection_requests, 0, LINKEDIN_ASSIST_LIMITS.weeklyConnectionRequests, LINKEDIN_ASSIST_LIMITS.weeklyConnectionRequests),
    dailyMessages: clamp(row.daily_messages, 0, LINKEDIN_ASSIST_LIMITS.dailyMessages, LINKEDIN_ASSIST_LIMITS.dailyMessages),
    monthlyInMailCredits: clamp(row.monthly_inmail_credits, 0, INMAIL_CREDIT_CEILING[tier], 0),
    followUpAfterDays: clamp(row.follow_up_after_days, LINKEDIN_ASSIST_LIMITS.followUpAfterDaysMin, LINKEDIN_ASSIST_LIMITS.followUpAfterDaysMax, LINKEDIN_ASSIST_LIMITS.followUpAfterDaysDefault),
    maxFollowUps: clamp(row.max_follow_ups, 0, LINKEDIN_ASSIST_LIMITS.maxFollowUps, LINKEDIN_ASSIST_LIMITS.maxFollowUps),
    paused: row.paused === true,
  };
}

/* ============================================================= profile URLs */

/**
 * A public LinkedIn profile URL, normalised to `https://www.linkedin.com/in/<slug>/`.
 *
 * Only `/in/` profiles. A Sales Navigator lead URL, a company page or a search
 * result is refused: "Open profile" has to open the person, and the stored
 * form has to be one value per person so the same profile cannot be added
 * twice under two spellings. Returns null for anything else.
 */
export function normaliseLinkedInProfileUrl(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw || raw.length > 300) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !/^([a-z]{2,3}|www)\.linkedin\.com$/.test(host)) return null;

  const match = /^\/(?:in|pub)\/([^/?#]+)\/?/i.exec(url.pathname);
  if (!match) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]).trim();
  } catch {
    return null;
  }
  if (!slug || slug.length > 100 || /[\s/?#]/.test(slug)) return null;
  return `https://www.linkedin.com/in/${encodeURIComponent(slug).toLowerCase()}/`;
}

/** The stable per-person key for a LinkedIn thread address (`li_urn:` prefix in messaging/types). */
export function linkedInThreadKey(profileUrl: string): string {
  const match = /\/in\/([^/]+)\/$/.exec(profileUrl);
  return `profile:${match ? match[1] : profileUrl}`;
}

/* ================================================================== dates */

/** YYYY-MM-DD in the workspace's timezone. Falls back to UTC for an unknown zone. */
export function localDate(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1) + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

/* ============================================================== stop rules */

export type StopSnapshot = {
  contactState: LinkedInContactState;
  /** The lead's own flag or a prospect's SUPPRESSED eligibility. */
  optedOut: boolean;
  /** leads.status, when the contact is a lead. */
  leadStatus: string | null;
};

/**
 * Why a task may no longer be acted on, or null if it may.
 *
 * Re-evaluated on every read of the list and immediately before every action,
 * never cached from when the task was planned: a lead can opt out on email or
 * be marked lost between breakfast and the moment somebody taps "Copy".
 *
 * An opt-out stops everything, replies included. A reply stops outreach but
 * not the answer to it; won or lost stops outreach but not a reply to a
 * customer who wrote.
 */
export function stopReasonFor(
  kind: LinkedInTaskKind,
  snapshot: StopSnapshot,
): LinkedInStopReason | "REPLIED" | "FINISHED" | null {
  if (snapshot.optedOut) return "OPTED_OUT";
  if (kind === "REPLY") return null;
  if (snapshot.contactState === "STOPPED") return "REMOVED";
  if (snapshot.contactState === "FINISHED") return "FINISHED";
  if (snapshot.leadStatus === "WON") return "WON";
  if (snapshot.leadStatus === "LOST") return "LOST";
  if (snapshot.contactState === "REPLIED") return "REPLIED";
  return null;
}

/* ============================================================ state machine */

export type ScheduledTask = {
  kind: LinkedInTaskKind;
  step: number;
  dueOn: string;
  dedupeKey: string;
};

export type MarkSentOutcome = {
  nextState: LinkedInContactState;
  /** The follow-up this send schedules, if any. */
  next: ScheduledTask | null;
  /** Set when the sequence has run out with no reply. */
  finished: boolean;
};

/**
 * What marking a task sent means.
 *
 *   * A connection request -> INVITED, and the first message is scheduled N
 *     days on (it is only sendable once they accept; the card says so, and
 *     "Not accepted yet" snoozes it).
 *   * The first message, or a follow-up -> MESSAGED, and the next follow-up is
 *     scheduled until `maxFollowUps` have gone. After the last one the contact
 *     is FINISHED rather than chased again.
 *   * An InMail -> MESSAGED, and nothing is scheduled: another InMail costs a
 *     credit and a second unsolicited one reads as pressure.
 *   * A reply -> the state stays REPLIED; the conversation is theirs to lead.
 */
export function onMarkSent(input: {
  contactId: string;
  kind: LinkedInTaskKind;
  step: number;
  today: string;
  settings: Pick<LinkedInAssistSettings, "followUpAfterDays" | "maxFollowUps">;
  currentState: LinkedInContactState;
}): MarkSentOutcome {
  const due = addDays(input.today, input.settings.followUpAfterDays);
  const key = (step: number) => `followup:${input.contactId}:${step}`;

  switch (input.kind) {
    case "CONNECTION_NOTE":
      return {
        nextState: "INVITED",
        next: { kind: "FOLLOW_UP", step: 1, dueOn: due, dedupeKey: key(1) },
        finished: false,
      };
    case "FOLLOW_UP": {
      // Step 1 is the opener after acceptance; steps 2..(1 + maxFollowUps) chase.
      const lastStep = 1 + input.settings.maxFollowUps;
      if (input.step < lastStep) {
        return {
          nextState: "MESSAGED",
          next: { kind: "FOLLOW_UP", step: input.step + 1, dueOn: due, dedupeKey: key(input.step + 1) },
          finished: false,
        };
      }
      return { nextState: "MESSAGED", next: null, finished: true };
    }
    case "INMAIL":
      return { nextState: "MESSAGED", next: null, finished: false };
    case "REPLY":
      return { nextState: input.currentState === "STOPPED" ? "STOPPED" : "REPLIED", next: null, finished: false };
  }
}

/**
 * What skipping means: this step is not going to happen. A skipped follow-up
 * still lets the next one be scheduled (skipping a nudge is not giving up on
 * the person); skipping the first touch, or the last step, ends it.
 */
export function onSkip(input: {
  contactId: string;
  kind: LinkedInTaskKind;
  step: number;
  today: string;
  settings: Pick<LinkedInAssistSettings, "followUpAfterDays" | "maxFollowUps">;
}): { next: ScheduledTask | null; stop: LinkedInStopReason | null } {
  if (input.kind === "REPLY") return { next: null, stop: null };
  if (input.kind === "CONNECTION_NOTE" || input.kind === "INMAIL") return { next: null, stop: "SKIPPED" };
  const lastStep = 1 + input.settings.maxFollowUps;
  // Step 1 skipped means they never accepted; there is nobody to chase.
  if (input.step === 1 || input.step >= lastStep) return { next: null, stop: "NO_RESPONSE" };
  return {
    next: {
      kind: "FOLLOW_UP",
      step: input.step + 1,
      dueOn: addDays(input.today, input.settings.followUpAfterDays),
      dedupeKey: `followup:${input.contactId}:${input.step + 1}`,
    },
    stop: null,
  };
}

/** Only the first message after an invitation can be snoozed ("not accepted yet"), twice. */
export function canSnooze(kind: LinkedInTaskKind, step: number, snoozeCount: number): boolean {
  return kind === "FOLLOW_UP" && step === 1 && snoozeCount < LINKEDIN_ASSIST_LIMITS.maxSnoozes;
}

/* ================================================================== pacing */

export type PaceableTask = {
  id: string;
  kind: LinkedInTaskKind;
  dueOn: string;
  createdAt: string;
};

export type PaceUsage = {
  connectionsToday: number;
  connectionsThisWeek: number;
  messagesToday: number;
  notesThisMonth: number;
  inmailsThisMonth: number;
};

export type PaceResult<T extends PaceableTask> = {
  visible: T[];
  held: { connections: number; messages: number; inmails: number };
  remaining: { connections: number; messages: number; inmails: number };
  /**
   * A Free account out of personalised notes this month: connection requests
   * still go, without a note (LinkedIn allows that and does not count it
   * against the note allowance).
   */
  notesExhausted: boolean;
  paused: boolean;
};

const KIND_ORDER: Record<LinkedInTaskKind, number> = {
  REPLY: 0,
  FOLLOW_UP: 1,
  INMAIL: 2,
  CONNECTION_NOTE: 3,
};

/**
 * Which of today's due tasks are shown, and which are held for another day.
 *
 * Deterministic and applied at read time, so the list is always the truth
 * about the caps whatever was scheduled when. Replies come first and are never
 * held: answering somebody who wrote is not outreach, and making them wait
 * for a quota would be the wrong way round. Everything else is capped by the
 * person's own daily, weekly and monthly numbers. A paused list shows replies
 * only.
 */
export function paceToday<T extends PaceableTask>(
  due: readonly T[],
  usage: PaceUsage,
  settings: LinkedInAssistSettings,
): PaceResult<T> {
  const sorted = [...due].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.dueOn.localeCompare(b.dueOn) ||
      a.createdAt.localeCompare(b.createdAt),
  );

  let connections = settings.paused
    ? 0
    : Math.max(
        0,
        Math.min(
          settings.dailyConnectionNotes - usage.connectionsToday,
          settings.weeklyConnectionRequests - usage.connectionsThisWeek,
        ),
      );
  let messages = settings.paused ? 0 : Math.max(0, settings.dailyMessages - usage.messagesToday);
  let inmails = settings.paused
    ? 0
    : Math.max(
        0,
        Math.min(settings.monthlyInMailCredits, INMAIL_CREDIT_CEILING[settings.accountTier]) -
          usage.inmailsThisMonth,
      );

  const visible: T[] = [];
  const held = { connections: 0, messages: 0, inmails: 0 };

  for (const task of sorted) {
    if (task.kind === "REPLY") {
      visible.push(task);
    } else if (task.kind === "CONNECTION_NOTE") {
      if (connections > 0) {
        connections -= 1;
        visible.push(task);
      } else held.connections += 1;
    } else if (task.kind === "INMAIL") {
      if (inmails > 0 && messages > 0) {
        inmails -= 1;
        messages -= 1;
        visible.push(task);
      } else held.inmails += 1;
    } else if (messages > 0) {
      messages -= 1;
      visible.push(task);
    } else held.messages += 1;
  }

  return {
    visible,
    held,
    remaining: { connections, messages, inmails },
    notesExhausted:
      settings.accountTier === "FREE" && usage.notesThisMonth >= LINKEDIN_ASSIST_LIMITS.freeMonthlyNotes,
    paused: settings.paused,
  };
}

/**
 * Counts what a person has already sent, by their workspace's calendar: today,
 * the last seven days (today included) and this calendar month. Read from the
 * SENT tasks themselves, so a cap can never disagree with what was recorded.
 */
export function usageFrom(
  sent: readonly { kind: LinkedInTaskKind; completedAt: string; withNote: boolean }[],
  now: Date,
  timeZone: string,
): PaceUsage {
  const today = localDate(now, timeZone);
  const weekStart = addDays(today, -6);
  const month = today.slice(0, 7);
  const usage: PaceUsage = {
    connectionsToday: 0,
    connectionsThisWeek: 0,
    messagesToday: 0,
    notesThisMonth: 0,
    inmailsThisMonth: 0,
  };
  for (const row of sent) {
    const day = localDate(new Date(row.completedAt), timeZone);
    if (row.kind === "CONNECTION_NOTE") {
      if (day === today) usage.connectionsToday += 1;
      if (day >= weekStart && day <= today) usage.connectionsThisWeek += 1;
      if (row.withNote && day.slice(0, 7) === month) usage.notesThisMonth += 1;
    } else if (countsAsMessage(row.kind)) {
      if (day === today) usage.messagesToday += 1;
      if (row.kind === "INMAIL" && day.slice(0, 7) === month) usage.inmailsThisMonth += 1;
    }
  }
  return usage;
}

/** Whether a kind of task counts against the daily message cap. */
export function countsAsMessage(kind: LinkedInTaskKind): boolean {
  return kind === "FOLLOW_UP" || kind === "INMAIL";
}

/* ============================================================ channel moves */

export type ChannelMoveTarget = "email" | "sms" | "call";

export type ChannelMoveLead = {
  email: string | null;
  emailOrigin: string | null;
  phone: string | null;
  phoneSource: string | null;
  phoneType: string | null;
  optedOut: boolean;
};

export type ChannelMove = {
  channel: ChannelMoveTarget;
  allowed: boolean;
  reason: string;
};

/**
 * Sources of a phone number the person gave us themselves (CLAUDE.md resolved
 * conflict 6). A number from anywhere else -- an import, an enrichment, a
 * company website -- is never texted or rung from here.
 */
const SELF_PROVIDED_PHONE = new Set(["LEAD_FORM", "LEAD_MESSAGE", "MANUAL_BY_LEAD_REQUEST"]);
const BLOCKED_PHONE_TYPE = /^BLOCKED_/;

/**
 * Where a LinkedIn conversation may move to, and why not where it may not.
 *
 * Only a lead (somebody who contacted the business or was promoted after they
 * engaged) can move; a prospect has given no channel at all. Email must be an
 * address that was not guessed from a pattern. SMS needs a UK mobile the
 * person typed themselves; a call needs a number they gave us or rang us from.
 * Suppression is re-checked server-side at the moment of the move.
 */
export function channelMoves(lead: ChannelMoveLead | null): ChannelMove[] {
  if (!lead) {
    const reason = "Only a lead who gave you their details can be moved off LinkedIn.";
    return (["email", "sms", "call"] as const).map((channel) => ({ channel, allowed: false, reason }));
  }
  if (lead.optedOut) {
    const reason = "They asked not to be contacted.";
    return (["email", "sms", "call"] as const).map((channel) => ({ channel, allowed: false, reason }));
  }

  const email: ChannelMove = !lead.email
    ? { channel: "email", allowed: false, reason: "No email address on this lead." }
    : lead.emailOrigin === "PATTERN_INFERRED"
      ? { channel: "email", allowed: false, reason: "The email address was guessed, not given or published." }
      : { channel: "email", allowed: true, reason: "They have an email address on record." };

  const phoneGiven = Boolean(lead.phone) && SELF_PROVIDED_PHONE.has(lead.phoneSource ?? "");
  const blocked = BLOCKED_PHONE_TYPE.test(lead.phoneType ?? "");
  const mobile = isUkMobile(lead.phone, lead.phoneType);

  const sms: ChannelMove = !lead.phone
    ? { channel: "sms", allowed: false, reason: "No phone number on this lead." }
    : !phoneGiven
      ? { channel: "sms", allowed: false, reason: "Texts only go to a mobile the person gave you themselves." }
      : !mobile
        ? { channel: "sms", allowed: false, reason: "The number they gave is not a UK mobile." }
        : { channel: "sms", allowed: true, reason: "They gave you this mobile themselves." };

  const callGiven = Boolean(lead.phone) && (SELF_PROVIDED_PHONE.has(lead.phoneSource ?? "") || lead.phoneSource === "INBOUND_CALL");
  const call: ChannelMove = !lead.phone
    ? { channel: "call", allowed: false, reason: "No phone number on this lead." }
    : blocked
      ? { channel: "call", allowed: false, reason: "That number is a premium or personal-numbering range." }
      : !callGiven
        ? { channel: "call", allowed: false, reason: "Calls only go to a number the person gave you or rang you from." }
        : { channel: "call", allowed: true, reason: "They gave you this number themselves." };

  return [email, sms, call];
}

function isUkMobile(phone: string | null, phoneType: string | null): boolean {
  if (phoneType) return phoneType === "UK_MOBILE";
  const digits = (phone ?? "").replace(/[^\d+]/g, "").replace(/^\+44/, "0").replace(/^0044/, "0");
  return /^07\d{9}$/.test(digits) && !/^070|^076(?!24)/.test(digits);
}

export const MOVE_STOP_REASON: Record<ChannelMoveTarget, LinkedInStopReason> = {
  email: "MOVED_TO_EMAIL",
  sms: "MOVED_TO_SMS",
  call: "MOVED_TO_CALL",
};

/* ======================================================== action schemas */

export const addContactSchema = z
  .object({
    leadId: z.uuid().optional(),
    prospectId: z.uuid().optional(),
    profileUrl: z.string().trim().min(1, "Paste their LinkedIn profile link.").max(300),
    firstTouch: z.enum(LINKEDIN_FIRST_TOUCHES).default("CONNECTION_NOTE"),
  })
  .refine((value) => Boolean(value.leadId) !== Boolean(value.prospectId), {
    message: "Choose one lead or one prospect.",
  })
  .refine((value) => normaliseLinkedInProfileUrl(value.profileUrl) !== null, {
    message: "That is not a LinkedIn profile link. It should look like linkedin.com/in/their-name.",
    path: ["profileUrl"],
  });

export const taskIdSchema = z.object({ taskId: z.uuid() });

export const markSentSchema = z.object({
  taskId: z.uuid(),
  /** The words actually sent, when the person edited the draft first. */
  body: z.string().trim().max(LINKEDIN_MESSAGE_MAX_CHARS).optional(),
  /** A connection request sent with no note (a Free account out of notes). */
  withoutNote: z.boolean().optional(),
});

export const logReplySchema = z.object({
  taskId: z.uuid(),
  body: z
    .string()
    .trim()
    .min(1, "Paste their reply first.")
    .max(LOGGED_REPLY_MAX_CHARS, `Keep it under ${LOGGED_REPLY_MAX_CHARS} characters.`),
});

export const moveChannelSchema = z.object({
  taskId: z.uuid(),
  channel: z.enum(["email", "sms", "call"]),
});

/* ================================================================= views */

export type LinkedInTaskView = {
  id: string;
  contactId: string;
  kind: LinkedInTaskKind;
  step: number;
  dueOn: string;
  createdAt: string;
  body: string | null;
  bodySource: "TEMPLATE" | "AI" | "AGENT" | "PERSON" | null;
  fallbackReason: string | null;
  inboundBody: string | null;
  snoozeCount: number;
  profileUrl: string;
  name: string;
  subtitle: string | null;
  leadId: string | null;
  prospectId: string | null;
  contactState: LinkedInContactState;
  moves: ChannelMove[];
  /** Why this task may not be acted on right now (a stop condition), if so. */
  blocked: string | null;
  /** True while a REPLY task's AI draft is still being written. */
  drafting: boolean;
};

export type LinkedInCandidate = {
  kind: "lead" | "prospect";
  id: string;
  name: string;
  subtitle: string | null;
  profileUrl: string | null;
};

/** The character limit for a kind of task body. */
export function bodyLimitFor(kind: LinkedInTaskKind): number {
  return kind === "CONNECTION_NOTE" ? CONNECTION_NOTE_MAX_CHARS : LINKEDIN_MESSAGE_MAX_CHARS;
}

/** A short instruction shown on the card, per kind and step. */
export function taskInstruction(kind: LinkedInTaskKind, step: number, notesExhausted: boolean): string {
  switch (kind) {
    case "CONNECTION_NOTE":
      return notesExhausted
        ? "Send the connection request without a note: your free LinkedIn account has used this month's personalised notes."
        : "Open their profile, tap Connect, then Add a note and paste this.";
    case "FOLLOW_UP":
      return step === 1
        ? "Only if they have accepted your request: open their profile, tap Message and paste this."
        : "Open your conversation with them on LinkedIn and paste this follow-up.";
    case "INMAIL":
      return "Open their profile, tap Message (InMail uses one credit) and paste this.";
    case "REPLY":
      return "They replied. Check the suggested answer, then send it from your LinkedIn conversation.";
  }
}
