/**
 * What happens after a call that did not become a conversation. Pure.
 *
 *   - Voicemail is left only when allowed: the workspace switched it on, the
 *     consent basis supports an automated message (a voicemail spoken by the AI
 *     is itself an automated call under PECR reg 19, so CALL_REQUESTED or
 *     FORM_CONSENT_TO_CALL), and no voicemail was left for this request yet.
 *     The script is fixed and versioned: AI disclosure, who is calling, why, and
 *     what happens next. No price, no deadline, no pressure.
 *   - Retry spacing: BUSY 20 minutes, NO_ANSWER 2 hours, then the next day.
 *     FAILED retries once after 30 minutes when the failure is transient.
 *     Every retry time is moved into the recipient's calling hours.
 *   - Max attempts (default 3). After the last attempt, or when a retry is not
 *     allowed, the fallback is the first LAWFUL text channel in the order
 *     SMS, WhatsApp, email; SMS only to a mobile.
 */

import { nextCallableAt, type CallingHoursConfig, type UkRegion } from "./calling-hours.ts";
import { renderEnquiryDay } from "./opener.ts";
import type { ConsentBasis } from "./eligibility.ts";

export type DialOutcome = "NO_ANSWER" | "BUSY" | "VOICEMAIL" | "FAILED_TRANSIENT" | "FAILED_PERMANENT";
export type FallbackChannel = "SMS" | "WHATSAPP" | "EMAIL";

export const DEFAULT_FALLBACK_ORDER: readonly FallbackChannel[] = ["SMS", "WHATSAPP", "EMAIL"];

export type RetrySpacing = {
  busyMinutes: number;
  noAnswerMinutes: number;
  voicemailMinutes: number;
  failedTransientMinutes: number;
  /** From the second retry on, wait at least this long (next day). */
  laterAttemptMinutes: number;
};
export const DEFAULT_RETRY_SPACING: RetrySpacing = {
  busyMinutes: 20,
  noAnswerMinutes: 120,
  voicemailMinutes: 24 * 60,
  failedTransientMinutes: 30,
  laterAttemptMinutes: 24 * 60,
};
export const DEFAULT_MAX_ATTEMPTS = 3;

export const VOICEMAIL_SCRIPT_VERSION = "vm.2026-09-27.v1";

export type ChannelLegality = { lawful: boolean; reason?: string };

export type RetryInput = {
  now: Date;
  outcome: DialOutcome;
  /** The attempt that just finished, 1-based. */
  attemptNumber: number;
  maxAttempts?: number;
  spacing?: Partial<RetrySpacing>;
  consentBasis: ConsentBasis;
  voicemail: { enabled: boolean; alreadyLeftForThisRequest: boolean };
  /** For the voicemail script. */
  callingAsName: string;
  enquiryAt: Date;
  recipient: { timezone: string; region?: UkRegion | null; isMobile: boolean; isUk: boolean };
  callingHours?: CallingHoursConfig;
  /** Per-channel legality for THIS lead, from the channel policy. */
  channels: Partial<Record<FallbackChannel, ChannelLegality>>;
  fallbackOrder?: readonly FallbackChannel[];
};

export type RetryPlan = {
  leaveVoicemail: boolean;
  voicemailScript: string | null;
  voicemailScriptVersion: string | null;
  next:
    | { action: "RETRY_CALL"; at: Date; attemptNumber: number }
    | { action: "FALLBACK"; channel: FallbackChannel; reason: "MAX_ATTEMPTS" | "PERMANENT_FAILURE" | "NO_CALLING_WINDOW" }
    | { action: "STOP"; reason: "NO_LAWFUL_FALLBACK" };
  /** The fallback order after legality filtering, for the follow-up engine. */
  lawfulFallbacks: FallbackChannel[];
};

export function lawfulFallbacks(
  channels: Partial<Record<FallbackChannel, ChannelLegality>>,
  recipientIsMobile: boolean,
  order: readonly FallbackChannel[] = DEFAULT_FALLBACK_ORDER,
): FallbackChannel[] {
  return order.filter((c) => {
    if (!channels[c]?.lawful) return false;
    if (c === "SMS" && !recipientIsMobile) return false;
    return true;
  });
}

export function voicemailAllowed(input: {
  enabled: boolean;
  alreadyLeftForThisRequest: boolean;
  consentBasis: ConsentBasis;
}): boolean {
  if (!input.enabled || input.alreadyLeftForThisRequest) return false;
  return input.consentBasis === "CALL_REQUESTED" || input.consentBasis === "FORM_CONSENT_TO_CALL";
}

/** The fixed voicemail. `followUp` names what happens next, truthfully. */
export function renderVoicemailScript(input: {
  callingAsName: string;
  enquiryAt: Date;
  now: Date;
  timezone: string;
  followUp: FallbackChannel | "CALL_AGAIN" | null;
}): string {
  const name = input.callingAsName.replace(/\s+/g, " ").trim();
  const day = renderEnquiryDay(input.enquiryAt, input.now, input.timezone);
  const next =
    input.followUp === "SMS" || input.followUp === "WHATSAPP"
      ? "We will send you a message so you can reply when it suits you."
      : input.followUp === "EMAIL"
        ? "We will send you an email so you can reply when it suits you."
        : input.followUp === "CALL_AGAIN"
          ? "We will try you again at another time."
          : "You are welcome to get back in touch whenever it suits you.";
  return `Hello, this is an AI assistant calling from ${name} about the enquiry you sent us ${day}. Sorry we missed you. ${next} Thank you, and goodbye.`;
}

export function planRetry(input: RetryInput): RetryPlan {
  const max = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const spacing: RetrySpacing = { ...DEFAULT_RETRY_SPACING, ...(input.spacing ?? {}) };
  const fallbacks = lawfulFallbacks(input.channels, input.recipient.isMobile, input.fallbackOrder);

  const fallbackOrStop = (reason: "MAX_ATTEMPTS" | "PERMANENT_FAILURE" | "NO_CALLING_WINDOW"): RetryPlan["next"] =>
    fallbacks.length ? { action: "FALLBACK", channel: fallbacks[0], reason } : { action: "STOP", reason: "NO_LAWFUL_FALLBACK" };

  let next: RetryPlan["next"];
  if (input.outcome === "FAILED_PERMANENT") {
    next = fallbackOrStop("PERMANENT_FAILURE");
  } else if (input.attemptNumber >= max) {
    next = fallbackOrStop("MAX_ATTEMPTS");
  } else {
    let minutes: number;
    switch (input.outcome) {
      case "BUSY":
        minutes = spacing.busyMinutes;
        break;
      case "NO_ANSWER":
        minutes = spacing.noAnswerMinutes;
        break;
      case "VOICEMAIL":
        minutes = spacing.voicemailMinutes;
        break;
      case "FAILED_TRANSIENT":
        minutes = spacing.failedTransientMinutes;
        break;
    }
    if (input.attemptNumber >= 2) minutes = Math.max(minutes, spacing.laterAttemptMinutes);
    const earliest = new Date(input.now.getTime() + minutes * 60000);
    const at = nextCallableAt({
      at: earliest,
      timezone: input.recipient.timezone,
      config: input.callingHours,
      region: input.recipient.region ?? null,
      applyUkBankHolidays: input.recipient.isUk,
    });
    next = at ? { action: "RETRY_CALL", at, attemptNumber: input.attemptNumber + 1 } : fallbackOrStop("NO_CALLING_WINDOW");
  }

  const leave =
    input.outcome === "VOICEMAIL" &&
    voicemailAllowed({
      enabled: input.voicemail.enabled,
      alreadyLeftForThisRequest: input.voicemail.alreadyLeftForThisRequest,
      consentBasis: input.consentBasis,
    });
  const followUp: FallbackChannel | "CALL_AGAIN" | null =
    next.action === "FALLBACK" ? next.channel : next.action === "RETRY_CALL" ? "CALL_AGAIN" : null;
  return {
    leaveVoicemail: leave,
    voicemailScript: leave
      ? renderVoicemailScript({
          callingAsName: input.callingAsName,
          enquiryAt: input.enquiryAt,
          now: input.now,
          timezone: input.recipient.timezone,
          followUp,
        })
      : null,
    voicemailScriptVersion: leave ? VOICEMAIL_SCRIPT_VERSION : null,
    next,
    lawfulFallbacks: fallbacks,
  };
}
