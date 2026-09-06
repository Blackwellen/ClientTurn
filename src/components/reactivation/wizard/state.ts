/**
 * Wizard state model. One object holds every answer across all three steps,
 * so Back never destroys a value and Step 3 reviews exactly what Steps 1 and
 * 2 configured. Free of React and of any server import so the validation
 * helpers can be unit tested directly.
 */

import {
  DEFAULT_AUDIENCE_FILTER,
  MAX_EMAIL_BODY_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_SUBJECT_LENGTH,
  findUnknownMergeFields,
  type AudienceFilter,
} from "../../../lib/campaigns/types.ts";
import { htmlToPlainText, isEmptyHtml, plainTextToHtml } from "../../../lib/email/rich-text.ts";

export type AudienceSourceKind = "existing" | "csv";
export type WizardChannel = "sms" | "whatsapp" | "email";

/** One place for the customer-facing name of each channel. */
export const CHANNEL_LABELS: Record<WizardChannel, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
};

/**
 * Email is not billed per segment and is not read on a phone keyboard, so it
 * gets a far larger allowance than a text. Everything else about the step —
 * merge fields, follow-up, scheduling — behaves identically.
 */
export function bodyLimitFor(channel: WizardChannel): number {
  return channel === "email" ? MAX_EMAIL_BODY_LENGTH : MAX_MESSAGE_LENGTH;
}
export type SendMode = "now" | "schedule";

export type CsvUploadState = {
  sourceId: string;
  label: string;
  imported: number;
};

export type WizardState = {
  campaignName: string;
  /** One line shown on the campaign card, in the list and in the drawer. */
  description: string;
  /** Human name for the audience; the filters below stay the definition. */
  audienceLabel: string;
  /** Free-text, comma separated in the UI, normalised on submit. */
  tags: string;
  audienceSource: AudienceSourceKind;
  audienceFilters: AudienceFilter;
  csvUpload: CsvUploadState | null;
  channel: WizardChannel;
  subject: string;
  initialMessage: string;
  followUpEnabled: boolean;
  followUpChannel: WizardChannel;
  /** Email only. Blank reuses the initial subject, prefixed by the client. */
  followUpSubject: string;
  followUpDelayDays: number;
  followUpMessage: string;
  sendMode: SendMode;
  scheduledDate: string;
  scheduledTime: string;
};

export const FOLLOW_UP_DELAY_OPTIONS = [1, 2, 3, 5, 7, 14] as const;

export function initialWizardState(channel: WizardChannel): WizardState {
  return {
    campaignName: "",
    description: "",
    audienceLabel: "",
    tags: "",
    audienceSource: "existing",
    audienceFilters: { ...DEFAULT_AUDIENCE_FILTER },
    csvUpload: null,
    channel,
    subject: "",
    initialMessage: "",
    followUpEnabled: false,
    followUpChannel: channel,
    followUpSubject: "",
    followUpDelayDays: 3,
    followUpMessage: "",
    sendMode: "now",
    scheduledDate: "",
    scheduledTime: "10:00",
  };
}

/**
 * Moving between a texting channel and email converts the bodies rather than
 * leaving markup on show in a plain textarea, or a wall of text with no
 * paragraphs in the rich editor. The conversion is lossy in one direction —
 * formatting cannot survive a move to SMS — which is why it only runs when the
 * channel actually changes.
 */
export function changeChannel(
  state: WizardState,
  channel: WizardChannel,
): Partial<WizardState> {
  if (channel === state.channel) return {};

  const toEmail = channel === "email";
  const fromEmail = state.channel === "email";
  if (toEmail === fromEmail) return { channel, followUpChannel: channel };

  const convert = toEmail ? plainTextToHtml : htmlToPlainText;

  return {
    channel,
    followUpChannel: channel,
    initialMessage: convert(state.initialMessage),
    followUpMessage: convert(state.followUpMessage),
    // A subject is meaningless off email, but it is kept rather than deleted
    // so switching away and back does not lose what was written.
  };
}

/* ---------------------------------------------------------------- tags --- */

/** Comma separated in the box, an array on the wire. Empties are dropped. */
export function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * The audience name shown on the card. Falls back to the CSV filename or a
 * neutral label so a campaign is never listed with a blank audience.
 */
export function resolvedAudienceLabel(state: WizardState): string {
  const typed = state.audienceLabel.trim();
  if (typed) return typed;
  if (state.audienceSource === "csv") {
    return state.csvUpload?.label ?? "Imported list";
  }
  return "Dormant leads " + state.audienceFilters.olderThanDays + "+ days";
}

/* ------------------------------------------------------------ schedule --- */

/**
 * Local wall-clock date + time to an instant. Kept here rather than inline so
 * the preview, the validation and the payload all read the same value.
 */
export function scheduledInstant(state: WizardState): Date | null {
  if (state.sendMode !== "schedule") return null;
  if (!state.scheduledDate || !state.scheduledTime) return null;
  const at = new Date(`${state.scheduledDate}T${state.scheduledTime}`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/* ---------------------------------------------------------- validation --- */

export type StepIssues = {
  /** Field-level messages, keyed by input id, for inline errors. */
  fields: Record<string, string>;
  /** True when the step may be left. */
  valid: boolean;
};

export function validateAudienceStep(
  state: WizardState,
  context: { eligible: number; audienceReady: boolean; csvBusy: boolean },
): StepIssues {
  const fields: Record<string, string> = {};

  if (state.campaignName.trim().length < 2) {
    fields.campaignName = "Give the campaign a name of at least 2 characters.";
  }
  if (state.description.trim().length > 280) {
    fields.description = "Keep the description under 280 characters.";
  }
  if (state.audienceLabel.trim().length > 160) {
    fields.audienceLabel = "Keep the audience name under 160 characters.";
  }
  if (splitTags(state.tags).length > 8) {
    fields.tags = "Use at most eight tags.";
  }
  if (
    state.audienceFilters.olderThanDays < 1 ||
    !Number.isInteger(state.audienceFilters.olderThanDays)
  ) {
    fields.olderThanDays = "Enter a whole number of days, 1 or more.";
  }
  if (state.audienceSource === "csv" && !state.csvUpload) {
    fields.csv = "Import a CSV file to use as your audience.";
  }
  if (context.audienceReady && context.eligible === 0) {
    fields.audience = "No eligible contacts match this audience.";
  }

  return {
    fields,
    valid:
      Object.keys(fields).length === 0 &&
      context.audienceReady &&
      !context.csvBusy &&
      context.eligible > 0,
  };
}

export function validateMessageStep(
  state: WizardState,
  context: { providerConnected: boolean; now: number },
): StepIssues {
  const fields: Record<string, string> = {};

  if (!context.providerConnected) {
    fields.channel =
      "Connect a messaging provider in Settings before you launch a campaign.";
  }

  const limit = bodyLimitFor(state.channel);

  // A subject is what an email is opened on, and the database refuses an email
  // campaign without one, so it is required here rather than at launch.
  if (state.channel === "email") {
    const subject = state.subject.trim();
    if (subject.length < 3) {
      fields.subject = "Write a subject line of at least 3 characters.";
    } else if (subject.length > MAX_SUBJECT_LENGTH) {
      fields.subject = `Keep the subject under ${MAX_SUBJECT_LENGTH} characters.`;
    } else {
      const unknown = findUnknownMergeFields(subject);
      if (unknown.length > 0) {
        fields.subject = `These variables cannot be filled in: ${unknown.join(", ")}.`;
      }
    }
  }

  // An email body is markup: it is measured, and checked for merge fields, by
  // the words in it rather than by its tags.
  const message =
    state.channel === "email"
      ? htmlToPlainText(state.initialMessage)
      : state.initialMessage.trim();
  if (state.channel === "email" && isEmptyHtml(state.initialMessage)) {
    fields.initialMessage = "Write a message of at least 10 characters.";
  } else if (message.length < 10) {
    fields.initialMessage = "Write a message of at least 10 characters.";
  } else if (message.length > limit) {
    fields.initialMessage = `Keep the message under ${limit} characters.`;
  } else {
    const unknown = findUnknownMergeFields(message);
    if (unknown.length > 0) {
      fields.initialMessage = `These variables cannot be filled in: ${unknown.join(", ")}.`;
    }
  }

  if (state.followUpEnabled) {
    const followUp =
      state.channel === "email"
        ? htmlToPlainText(state.followUpMessage)
        : state.followUpMessage.trim();
    if (followUp.length < 10) {
      fields.followUpMessage = "Write a follow-up of at least 10 characters.";
    } else if (followUp.length > limit) {
      fields.followUpMessage = `Keep the follow-up under ${limit} characters.`;
    } else {
      const unknown = findUnknownMergeFields(followUp);
      if (unknown.length > 0) {
        fields.followUpMessage = `These variables cannot be filled in: ${unknown.join(", ")}.`;
      }
    }
    if (state.channel === "email") {
      const followUpSubject = state.followUpSubject.trim();
      if (followUpSubject.length > MAX_SUBJECT_LENGTH) {
        fields.followUpSubject = `Keep the subject under ${MAX_SUBJECT_LENGTH} characters.`;
      } else if (followUpSubject.length > 0) {
        const unknown = findUnknownMergeFields(followUpSubject);
        if (unknown.length > 0) {
          fields.followUpSubject = `These variables cannot be filled in: ${unknown.join(", ")}.`;
        }
      }
    }

    if (state.followUpDelayDays < 1) {
      fields.followUpDelay = "A follow-up must come after the initial message.";
    }
  }

  if (state.sendMode === "schedule") {
    const at = scheduledInstant(state);
    if (!at) {
      fields.schedule = "Choose a valid date and time.";
    } else if (at.getTime() < context.now - 60_000) {
      fields.schedule = "Choose a time in the future.";
    }
  }

  return { fields, valid: Object.keys(fields).length === 0 };
}

/* ----------------------------------------------------------- checklist --- */

export type ChecklistItem = { label: string; done: boolean };

/** Step 3's launch checklist, derived from state — never hand-maintained. */
export function launchChecklist(
  state: WizardState,
  context: {
    eligible: number;
    providerConnected: boolean;
    messageValid: boolean;
    timingValid: boolean;
  },
): ChecklistItem[] {
  const items: ChecklistItem[] = [
    { label: "Audience has eligible contacts", done: context.eligible > 0 },
    { label: "Suppression rules applied", done: true },
    { label: "Message content completed", done: context.messageValid },
    { label: "Timing configured", done: context.timingValid },
  ];

  // A disabled follow-up is not an outstanding requirement, so it is simply
  // absent rather than shown as an unticked item.
  if (state.followUpEnabled) {
    items.push({
      label: "1 optional follow-up enabled",
      done: state.followUpMessage.trim().length >= 10,
    });
  }

  if (!context.providerConnected) {
    items.push({ label: "Messaging provider connected", done: false });
  }

  return items;
}

/* ------------------------------------------------------------- persist --- */

export const DRAFT_STORAGE_KEY = "clientturn:reactivation-wizard-draft";

/**
 * There is no server-side draft model for an unlaunched wizard, and adding
 * one would duplicate the DRAFT campaign the launch flow already creates. A
 * refresh therefore restores from session storage — scoped to this tab, gone
 * when the tab closes, and never a source of truth for anything sent.
 */
export function readDraft(channel: WizardChannel): WizardState | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardState>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      ...initialWizardState(channel),
      ...parsed,
      audienceFilters: {
        ...DEFAULT_AUDIENCE_FILTER,
        ...(parsed.audienceFilters ?? {}),
      },
    };
  } catch {
    return null;
  }
}

export function writeDraft(state: WizardState) {
  try {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private mode, quota). Losing the draft is
    // not worth breaking the wizard for.
  }
}

export function clearDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    /* see writeDraft */
  }
}
