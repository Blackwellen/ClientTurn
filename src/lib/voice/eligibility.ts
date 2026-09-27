/**
 * `canCallLead(input)`: may THIS lead be called, now, by this kind of call?
 * Deterministic, exhaustive, pure. Every denial has a reason code; every
 * applicable reason is listed in precedence order, the first is `reason`.
 *
 * The law this encodes (gap map Risk R1):
 *   - PECR reg 19: an automated calling system (an AI voice agent is very
 *     likely one) may only make marketing calls to a subscriber who has given
 *     PRIOR consent. This applies to corporate subscribers too. So an AI call
 *     needs CALL_REQUESTED or FORM_CONSENT_TO_CALL.
 *   - PHONE_NUMBER_PROVIDED alone is NOT that consent. It supports only a
 *     HUMAN call about the enquiry, or a "may we call you?" message on a lawful
 *     text channel (`alternatives`).
 *   - PECR reg 21: live (human) marketing calls must screen TPS (individuals and
 *     sole traders) and CTPS (corporate subscribers). Specific consent to be
 *     called overrides the listing, so screening binds only a human call on the
 *     PHONE_NUMBER_PROVIDED basis. An unscreened number on that basis is refused
 *     rather than assumed clear.
 *   - CLAUDE.md rule 6: a phone number is never taken from an enrichment
 *     provider. Only a number the person gave us (form, message, their own
 *     inbound call) may be dialled.
 */

import { assessDestination, type DestinationClass, type DestinationDenial, type VoiceRoute } from "./destinations.ts";
import {
  isWithinCallingHours,
  nextCallableAt,
  resolveRecipientTimezone,
  type CallingHoursConfig,
  type CallingHoursDenial,
  type TimezoneSource,
  type UkRegion,
} from "./calling-hours.ts";
import type { VoiceEntitlementDecision, VoiceDenialReason } from "./entitlement.ts";

export const CONSENT_BASES = ["CALL_REQUESTED", "FORM_CONSENT_TO_CALL", "PHONE_NUMBER_PROVIDED"] as const;
export type ConsentBasis = (typeof CONSENT_BASES)[number];

export type CallKind = "AI_AUTOMATED" | "HUMAN";

export type PhoneSource = "LEAD_FORM" | "LEAD_MESSAGE" | "INBOUND_CALL" | "MANUAL_BY_LEAD_REQUEST" | "ENRICHMENT" | "IMPORT" | "UNKNOWN";
const LEAD_SUPPLIED: readonly PhoneSource[] = ["LEAD_FORM", "LEAD_MESSAGE", "INBOUND_CALL", "MANUAL_BY_LEAD_REQUEST"];

export type SubscriberType = "CORPORATE" | "SOLE_TRADER" | "PARTNERSHIP" | "INDIVIDUAL" | "UNKNOWN";

export const ELIGIBILITY_DENIALS = [
  "LEAD_ANONYMISED",
  "SUPPRESSED",
  "OPTED_OUT",
  "VOICE_OPTED_OUT",
  "NO_PHONE",
  "INVALID_PHONE",
  "PHONE_NOT_LEAD_SUPPLIED",
  "DESTINATION_BLOCKED",
  "RATE_CAP_EXCEEDED",
  "NO_CONSENT_BASIS",
  "CONSENT_WITHDRAWN",
  "CONSENT_EVIDENCE_MISSING",
  "CONSENT_STALE",
  "CONSENT_INSUFFICIENT_FOR_AUTOMATED_CALL",
  "TPS_LISTED",
  "CTPS_LISTED",
  "TPS_NOT_SCREENED",
  "VOICE_NOT_ENTITLED",
  "TIMEZONE_UNRESOLVED",
  "OUTSIDE_CALLING_HOURS",
  "ATTEMPT_CAP_TOTAL",
  "ATTEMPT_CAP_DAILY",
  "ATTEMPT_TOO_SOON",
  "CALL_ALREADY_ACTIVE",
] as const;
export type EligibilityDenial = (typeof ELIGIBILITY_DENIALS)[number];

export type AttemptCaps = {
  /** Lifetime automated attempts per lead for one request/consent. */
  maxAttemptsTotal: number;
  /** Attempts in any rolling 24 hours. */
  maxAttemptsPer24h: number;
  /** Minimum minutes between two attempts. */
  minGapMinutes: number;
};
export const DEFAULT_ATTEMPT_CAPS: AttemptCaps = { maxAttemptsTotal: 3, maxAttemptsPer24h: 2, minGapMinutes: 120 };

/** A CALL_REQUESTED is a request about a specific enquiry; it goes stale. */
export const DEFAULT_CALL_REQUEST_VALID_DAYS = 30;

export type CanCallLeadInput = {
  now: Date;
  callKind: CallKind;
  lead: {
    phone: string | null | undefined;
    phoneSource: PhoneSource;
    timezone?: string | null;
    ukRegion?: UkRegion | null;
    anonymised: boolean;
    suppressed: boolean;
    /** Opted out of all contact. */
    optedOut: boolean;
    /** Opted out of calls only (per-channel opt-out). */
    voiceOptedOut: boolean;
    subscriberType: SubscriberType;
    /** null = not screened. */
    tpsListed: boolean | null;
    ctpsListed: boolean | null;
  };
  consent: {
    basis: ConsentBasis | null;
    capturedAt?: Date | null;
    withdrawn?: boolean;
    /** The consent wording the lead saw (FORM_CONSENT_TO_CALL needs it). */
    evidenceText?: string | null;
  };
  attempts: { total: number; last24h: number; lastAttemptAt?: Date | null };
  caps?: Partial<AttemptCaps>;
  /** From `assertVoiceAllowed`. Required for AI calls; ignored for HUMAN. */
  entitlement?: VoiceEntitlementDecision | null;
  workspace: { timezone?: string | null; callingHours?: CallingHoursConfig };
  activeCall: boolean;
  destination?: { route?: VoiceRoute; capUsdPerMin?: number; providerRate?: number | null };
  callRequestValidDays?: number;
};

export type CanCallLeadResult =
  | {
      allowed: true;
      reason: null;
      basis: ConsentBasis;
      e164: string;
      destinationClass: DestinationClass;
      timezone: string;
      timezoneSource: TimezoneSource;
    }
  | {
      allowed: false;
      reason: EligibilityDenial;
      reasons: EligibilityDenial[];
      basis: ConsentBasis | null;
      detail: {
        destination?: DestinationDenial;
        entitlement?: VoiceDenialReason;
        callingHours?: CallingHoursDenial;
        nextEligibleAt?: Date | null;
      };
      /** Lawful alternatives when an AI call is refused on consent grounds. */
      alternatives: ("HUMAN_CALL" | "ASK_PERMISSION_MESSAGE")[];
    };

const DAY_MS = 86400000;

export function canCallLead(input: CanCallLeadInput): CanCallLeadResult {
  const reasons: EligibilityDenial[] = [];
  const detail: Extract<CanCallLeadResult, { allowed: false }>["detail"] = {};
  const alternatives: ("HUMAN_CALL" | "ASK_PERMISSION_MESSAGE")[] = [];
  const { lead, consent, now } = input;
  const caps: AttemptCaps = { ...DEFAULT_ATTEMPT_CAPS, ...(input.caps ?? {}) };
  const ai = input.callKind === "AI_AUTOMATED";

  // 1. Stop conditions.
  if (lead.anonymised) reasons.push("LEAD_ANONYMISED");
  if (lead.suppressed) reasons.push("SUPPRESSED");
  if (lead.optedOut) reasons.push("OPTED_OUT");
  if (lead.voiceOptedOut) reasons.push("VOICE_OPTED_OUT");

  // 2. The number.
  let e164: string | null = null;
  let cls: DestinationClass | null = null;
  if (lead.phone == null || String(lead.phone).trim() === "") {
    reasons.push("NO_PHONE");
  } else {
    const d = assessDestination(lead.phone, input.destination ?? {});
    e164 = d.e164;
    cls = d.cls;
    if (!d.dialable) {
      if (d.reason === "INVALID_NUMBER") reasons.push("INVALID_PHONE");
      else if (d.reason === "RATE_ABOVE_CAP" || d.reason === "UNPRICED") reasons.push("RATE_CAP_EXCEEDED");
      else reasons.push("DESTINATION_BLOCKED");
      detail.destination = d.reason;
    }
  }
  if (!LEAD_SUPPLIED.includes(lead.phoneSource)) reasons.push("PHONE_NOT_LEAD_SUPPLIED");

  // 3. Consent basis.
  const basis = consent.basis;
  if (!basis) {
    reasons.push("NO_CONSENT_BASIS");
  } else {
    if (consent.withdrawn) reasons.push("CONSENT_WITHDRAWN");
    if (basis === "FORM_CONSENT_TO_CALL" && !(consent.evidenceText && consent.evidenceText.trim())) {
      reasons.push("CONSENT_EVIDENCE_MISSING");
    }
    if (basis === "CALL_REQUESTED") {
      const validDays = input.callRequestValidDays ?? DEFAULT_CALL_REQUEST_VALID_DAYS;
      if (!consent.capturedAt) reasons.push("CONSENT_EVIDENCE_MISSING");
      else if (now.getTime() - consent.capturedAt.getTime() > validDays * DAY_MS) reasons.push("CONSENT_STALE");
    }
    if (ai && basis === "PHONE_NUMBER_PROVIDED") {
      reasons.push("CONSENT_INSUFFICIENT_FOR_AUTOMATED_CALL");
      alternatives.push("HUMAN_CALL", "ASK_PERMISSION_MESSAGE");
    }
  }

  // 4. TPS / CTPS. Consent to be called overrides; only a human call on the
  //    number-provided basis must screen.
  if (!ai && basis === "PHONE_NUMBER_PROVIDED") {
    const corporate = lead.subscriberType === "CORPORATE";
    const listed = corporate ? lead.ctpsListed : lead.tpsListed;
    if (listed === null) reasons.push("TPS_NOT_SCREENED");
    else if (listed) reasons.push(corporate ? "CTPS_LISTED" : "TPS_LISTED");
  }

  // 5. Entitlement and OD-1 identity (AI calls only; a person dialling from
  //    their own phone is not a ClientTurn voice call).
  if (ai) {
    const ent = input.entitlement;
    if (!ent) {
      reasons.push("VOICE_NOT_ENTITLED");
      detail.entitlement = "CAPABILITY_MISSING";
    } else if (!ent.allowed) {
      reasons.push("VOICE_NOT_ENTITLED");
      detail.entitlement = ent.reason;
    }
  }

  // 6. Calling hours in the recipient's local time.
  const tz = resolveRecipientTimezone({
    leadTimezone: lead.timezone,
    phoneE164: e164,
    workspaceTimezone: input.workspace.timezone,
  });
  if (tz.timezone === null) {
    reasons.push("TIMEZONE_UNRESOLVED");
  } else {
    const ukRecipient = e164 ? e164.startsWith("+44") : true;
    const h = isWithinCallingHours({
      at: now,
      timezone: tz.timezone,
      config: input.workspace.callingHours,
      region: lead.ukRegion ?? null,
      applyUkBankHolidays: ukRecipient,
    });
    if (!h.allowed) {
      reasons.push("OUTSIDE_CALLING_HOURS");
      detail.callingHours = h.reason;
      detail.nextEligibleAt = nextCallableAt({
        at: now,
        timezone: tz.timezone,
        config: input.workspace.callingHours,
        region: lead.ukRegion ?? null,
        applyUkBankHolidays: ukRecipient,
      });
    }
  }

  // 7. Attempt caps.
  if (input.attempts.total >= caps.maxAttemptsTotal) reasons.push("ATTEMPT_CAP_TOTAL");
  if (input.attempts.last24h >= caps.maxAttemptsPer24h) reasons.push("ATTEMPT_CAP_DAILY");
  if (input.attempts.lastAttemptAt) {
    const earliest = input.attempts.lastAttemptAt.getTime() + caps.minGapMinutes * 60000;
    if (now.getTime() < earliest) {
      reasons.push("ATTEMPT_TOO_SOON");
      if (!detail.nextEligibleAt || detail.nextEligibleAt.getTime() < earliest) detail.nextEligibleAt = new Date(earliest);
    }
  }

  // 8. One live call per lead.
  if (input.activeCall) reasons.push("CALL_ALREADY_ACTIVE");

  if (reasons.length === 0 && basis && e164 && cls && tz.timezone) {
    return {
      allowed: true,
      reason: null,
      basis,
      e164,
      destinationClass: cls,
      timezone: tz.timezone,
      timezoneSource: tz.source as TimezoneSource,
    };
  }
  const ordered = ELIGIBILITY_DENIALS.filter((r) => reasons.includes(r));
  return { allowed: false, reason: ordered[0], reasons: ordered, basis, detail, alternatives };
}

// ------------------------------------------------------------------ locks

/**
 * The lock/idempotency keys the dial path uses. `voiceLeadLockKey` backs the
 * "one active call per lead" rule (a partial unique index on voice_calls in
 * the schema draft, plus an advisory lock around the dial); `voiceCallKey`
 * makes a dial idempotent per lead, route and attempt (gap map §73).
 */
export function voiceLeadLockKey(businessId: string, leadId: string): string {
  return `voice:lead:${businessId}:${leadId}`;
}

export function voiceCallKey(businessId: string, leadId: string, route: string, attemptNumber: number): string {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new Error("attemptNumber must be a positive integer");
  return `voice:call:${businessId}:${leadId}:${route}:${attemptNumber}`;
}

/** A stable 32-bit key for `pg_advisory_xact_lock(int)` from the lock key. */
export function advisoryLockId(key: string): number {
  // FNV-1a 32-bit, folded to a signed int as Postgres expects.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}
