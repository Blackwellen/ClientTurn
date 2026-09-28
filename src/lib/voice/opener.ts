/**
 * The locked OD-1 opener and recording notice. Pure and versioned.
 *
 * Owner decision OD-1 (2026-09-27): every call starts with
 *
 *   "This is an AI assistant calling from {calling_as_name} about the enquiry
 *    you sent us on {day}. Is now an OK time for a couple of minutes?"
 *
 * followed immediately by the recording notice when recording is on. The turn
 * adapter speaks this before any model output, and `validateFirstUtterance`
 * rejects a first utterance that differs. The wording is pending legal review
 * (Risk R15): a lawyer's change is an edit here plus a bump of
 * `OPENER_VERSION`, which is stored on every call.
 *
 * {day} is rendered relative and human in the recipient's time zone:
 * "earlier today", "yesterday", "on Tuesday" (within the last week), else
 * "on 3 September". The "on" belongs to the rendered phrase, so the template
 * reads "the enquiry you sent us {day}".
 *
 * House style for spoken copy: no emoji, no dashes.
 */

import { localParts } from "./calling-hours.ts";

export const OPENER_VERSION = "od1.2026-09-27.v1";

export const OPENER_TEMPLATE =
  "This is an AI assistant calling from {calling_as_name} about the enquiry you sent us {day}. Is now an OK time for a couple of minutes?";

export const RECORDING_NOTICE =
  "Just so you know, this call is recorded so we have an accurate note of what we discuss.";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * The relative day phrase, in the recipient's zone. An enquiry time in the
 * future (clock skew between systems) reads as "earlier today".
 */
export function renderEnquiryDay(enquiryAt: Date, now: Date, timezone: string): string {
  const e = localParts(enquiryAt, timezone);
  const n = localParts(now, timezone);
  const diff = dayNumber(n.date) - dayNumber(e.date);
  if (diff <= 0) return "earlier today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `on ${WEEKDAYS[e.weekday]}`;
  const [, m, d] = e.date.split("-").map(Number);
  return `on ${d} ${MONTHS[m - 1]}`;
}

export type OpenerInput = {
  callingAsName: string;
  enquiryAt: Date;
  now: Date;
  timezone: string;
  recordingEnabled: boolean;
};

export type LockedPreamble = {
  version: string;
  opener: string;
  recordingNotice: string | null;
  /** What the turn adapter speaks, exactly. */
  text: string;
};

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function renderOpener(input: Omit<OpenerInput, "recordingEnabled">): string {
  const name = cleanName(input.callingAsName);
  if (!name) throw new Error("callingAsName is required for the OD-1 opener");
  return OPENER_TEMPLATE.replace("{calling_as_name}", name).replace(
    "{day}",
    renderEnquiryDay(input.enquiryAt, input.now, input.timezone),
  );
}

export function buildLockedPreamble(input: OpenerInput): LockedPreamble {
  const opener = renderOpener(input);
  const recordingNotice = input.recordingEnabled ? RECORDING_NOTICE : null;
  return {
    version: OPENER_VERSION,
    opener,
    recordingNotice,
    text: recordingNotice ? `${opener} ${recordingNotice}` : opener,
  };
}

// --------------------------------------------------------------- validator

export type FirstUtteranceCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "EMPTY" | "MISSING_OPENER" | "MISSING_RECORDING_NOTICE" | "UNEXPECTED_RECORDING_NOTICE" | "TEXT_DIFFERS";
    };

function canonical(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The first thing said on a call must be the locked preamble, exactly (only
 * whitespace and typographic quotes are normalised). Nothing may precede it
 * and nothing may follow it in the same utterance: the editable remainder is
 * spoken as the next turn.
 */
export function validateFirstUtterance(utterance: string | null | undefined, expected: LockedPreamble): FirstUtteranceCheck {
  const said = canonical(utterance ?? "");
  if (!said) return { ok: false, reason: "EMPTY" };
  if (said === canonical(expected.text)) return { ok: true };
  const opener = canonical(expected.opener);
  if (!said.startsWith(opener)) return { ok: false, reason: "MISSING_OPENER" };
  const rest = said.slice(opener.length).trim();
  if (expected.recordingNotice && !rest.startsWith(canonical(expected.recordingNotice))) {
    return { ok: false, reason: "MISSING_RECORDING_NOTICE" };
  }
  if (!expected.recordingNotice && rest.startsWith(canonical(RECORDING_NOTICE))) {
    return { ok: false, reason: "UNEXPECTED_RECORDING_NOTICE" };
  }
  return { ok: false, reason: "TEXT_DIFFERS" };
}

// ------------------------------------------------------------- house style

export type StyleViolation = "EMOJI" | "DASH" | "CLAIMS_HUMAN" | "RESTATES_LOCKED_TEXT" | "TOO_LONG" | "EMPTY";

// Extended pictographs and the common emoji ranges.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/u;
// En dash, em dash, figure dash, horizontal bar, minus, and a spaced hyphen
// used as a dash. A hyphen inside a word ("follow-up") is not a dash.
const DASH = /[‒–—―−]|\s-\s|\s--?\s|^-|\s-$/;

export function houseStyleViolations(text: string): StyleViolation[] {
  const out: StyleViolation[] = [];
  if (EMOJI.test(text)) out.push("EMOJI");
  if (DASH.test(text)) out.push("DASH");
  return out;
}

/**
 * The customer-editable remainder (reason line, persona phrasing, route
 * sentence). It may not restate the locked text, claim to be human, or break
 * house style.
 */
export function validateEditableSuffix(text: string, maxLength = 240): StyleViolation[] {
  const t = text.trim();
  if (!t) return ["EMPTY"];
  const out = houseStyleViolations(t);
  if (t.length > maxLength) out.push("TOO_LONG");
  if (/\b(i am|i'm|this is)\s+(a\s+)?(real\s+)?(human|person)\b/i.test(t) || /\bnot an? (ai|bot|robot)\b/i.test(t)) {
    out.push("CLAIMS_HUMAN");
  }
  if (/this is an ai assistant calling from/i.test(t) || /this call is recorded/i.test(t)) {
    out.push("RESTATES_LOCKED_TEXT");
  }
  return out;
}

// ------------------------------------------------------------ closing line

/**
 * Owner decision 2026-09-28 (amends OD-1): every call ends with a fixed
 * attribution line, spoken as the call wraps up (after the next step is
 * agreed, or on a polite end). Factual attribution, never a pitch: no link,
 * no offer. Removed only with the white-label capability
 * (`white_label_public_pages`), off by default. Not spoken when the lead opted
 * out or the call dropped. Versioned like the opener; `attribution_spoken` is
 * stored on the call's outcome (0162).
 */
export const CLOSING_VERSION = "close.2026-09-28.v1";

export const CLOSING_TEMPLATE = "Thanks for your time. You've been speaking with {calling_as_name}'s AI assistant, powered by ClientTurn.";

/** The white-label closing: thanks only, no attribution. */
export const WHITE_LABEL_CLOSING = "Thanks for your time.";

export function renderClosingLine(input: { callingAsName: string; whiteLabel: boolean }): { version: string; text: string; attribution: boolean } {
  if (input.whiteLabel) return { version: CLOSING_VERSION, text: WHITE_LABEL_CLOSING, attribution: false };
  const name = cleanName(input.callingAsName);
  if (!name) throw new Error("callingAsName is required for the closing line");
  return { version: CLOSING_VERSION, text: CLOSING_TEMPLATE.replace("{calling_as_name}", name), attribution: true };
}

/**
 * Whether the attribution was actually spoken: the closing line, exactly
 * (typographic quotes and whitespace normalised), in an agent turn. Read from
 * the transcript, never from the model's say-so.
 */
export function attributionSpoken(agentTurns: readonly string[], closing: { text: string; attribution: boolean }): boolean {
  if (!closing.attribution) return false;
  const want = canonical(closing.text).toLowerCase();
  return agentTurns.some((turn) => canonical(turn).toLowerCase().includes(want));
}
