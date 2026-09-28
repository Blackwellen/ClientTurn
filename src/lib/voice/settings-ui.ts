/**
 * Display helpers for Settings -> Voice. Pure and client-safe: no
 * `server-only`, and deliberately no value import from settings-model.ts,
 * which reaches `node:crypto` through provisioning-details.ts. Only types are
 * imported from there (erased at build), so the browser bundle stays clean.
 */

import type { TransferMode, VoiceSettingsSection } from "./settings-model.ts";
import { buildLockedPreamble, validateEditableSuffix } from "./opener.ts";

export const VOICE_PANELS: readonly { key: VoiceSettingsSection; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "identity", label: "Business identity" },
  { key: "number", label: "Number" },
  { key: "agent", label: "Agent" },
  { key: "hours", label: "Calling hours" },
  { key: "routes", label: "Routes" },
  { key: "transfer", label: "Human transfer" },
  { key: "voicemail", label: "Voicemail and retries" },
  { key: "recording", label: "Recording" },
  { key: "budget", label: "Budget and usage" },
];

export function parseVoicePanel(value: unknown): VoiceSettingsSection {
  return typeof value === "string" && VOICE_PANELS.some((p) => p.key === value) ? (value as VoiceSettingsSection) : "overview";
}

export const TRANSFER_MODE_LABEL: Readonly<Record<TransferMode, string>> = {
  ON_REQUEST: "Only when the lead asks for a person",
  ON_REQUEST_OR_ESCALATION: "When the lead asks, or the AI can't help",
  NEVER: "Never transfer",
};

export type VoiceStatusKey = "ON" | "NOT_READY" | "OFF" | "PAUSED" | "INTEGRATION_REQUIRED" | "LOCKED";

/** The one status line on the Overview, most fundamental first. */
export function voiceStatus(input: {
  locked: boolean;
  adminKillSwitch: boolean;
  integrationReady: boolean;
  voiceEnabled: boolean;
  allowed: boolean;
}): VoiceStatusKey {
  if (input.locked) return "LOCKED";
  if (input.adminKillSwitch) return "PAUSED";
  if (!input.integrationReady) return "INTEGRATION_REQUIRED";
  if (!input.voiceEnabled) return "OFF";
  return input.allowed ? "ON" : "NOT_READY";
}

const IDENTITY_FIELD: Record<string, string> = {
  callingAsName: "The name you call as",
  legalEntityName: "Your legal entity",
  identificationContact: "The contact address or freephone number",
  personaName: "The assistant's name",
};

const IDENTITY_PROBLEM: Record<string, string> = {
  MISSING: "is missing",
  TOO_LONG: "is too long",
  PHONE_NOT_FREEPHONE: "must be a UK freephone (0800 or 0808) number, or a postal address",
  ADDRESS_TOO_SHORT: "looks too short for a postal address",
  CONTAINS_LINE_BREAK: "must be on one line",
};

/** "callingAsName:MISSING" -> "The name you call as is missing". */
export function identityProblemText(code: string): string {
  const [field, problem] = code.split(":");
  return `${IDENTITY_FIELD[field] ?? field} ${IDENTITY_PROBLEM[problem] ?? "needs checking"}`;
}

const REGULATORY_FIELD: Record<string, string> = {
  companyNumber: "Companies House number",
  websiteUrl: "Website",
  registeredAddress: "Business address",
  "registeredAddress.line1": "Address line 1",
  "registeredAddress.city": "Town or city",
  "registeredAddress.postcode": "Postcode",
  representative: "Authorised representative",
  "representative.firstName": "Representative first name",
  "representative.lastName": "Representative last name",
  "representative.phone": "Representative phone",
  "representative.workEmail": "Representative work email",
  notificationEmail: "Representative work email",
};

export function regulatoryProblemText(code: string): string {
  const [field] = code.split(":");
  return REGULATORY_FIELD[field] ?? identityProblemText(code);
}

const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/** Quote settings keep the address as lines; the number bundle needs its parts. */
export function addressFromLines(lines: string[]): { line1: string; line2: string; city: string; postcode: string } {
  const rest = lines.map((l) => l.trim()).filter(Boolean);
  let postcode = "";
  if (rest.length && UK_POSTCODE.test(rest[rest.length - 1])) postcode = rest.pop()!;
  const city = rest.length > 1 ? rest.pop()! : "";
  const [line1 = "", ...more] = rest;
  return { line1, line2: more.join(", "), city, postcode };
}

/** Display order Monday first; the config is indexed Sunday = 0. */
export const WEEK_DISPLAY: readonly { index: number; label: string }[] = [
  { index: 1, label: "Monday" },
  { index: 2, label: "Tuesday" },
  { index: 3, label: "Wednesday" },
  { index: 4, label: "Thursday" },
  { index: 5, label: "Friday" },
  { index: 6, label: "Saturday" },
  { index: 0, label: "Sunday" },
];

export const HOURS_BOUNDS = { earliest: "08:00", latest: "21:00" } as const;

/** Mirrors the server's window rule, so the form can say what is wrong before saving. */
export function windowProblem(w: { start: string; end: string }): string | null {
  if (!/^\d{2}:\d{2}$/.test(w.start) || !/^\d{2}:\d{2}$/.test(w.end)) return "Enter both times.";
  if (w.start < HOURS_BOUNDS.earliest) return `No earlier than ${HOURS_BOUNDS.earliest}.`;
  if (w.end > HOURS_BOUNDS.latest) return `No later than ${HOURS_BOUNDS.latest}.`;
  if (w.start >= w.end) return "The start must be before the end.";
  return null;
}

export const STYLE_VIOLATION_TEXT: Readonly<Record<string, string>> = {
  EMOJI: "Remove the emoji.",
  DASH: "Use a comma or full stop instead of a dash.",
  CLAIMS_HUMAN: "It can't claim to be a person.",
  RESTATES_LOCKED_TEXT: "Don't repeat the fixed opening.",
  TOO_LONG: "Keep it to 240 characters.",
  EMPTY: "",
};

/**
 * The locked OD-1 opener as the lead will hear it, for the Agent panel's live
 * preview. Same inputs and fixed "yesterday" enquiry day as settings-model's
 * `openerPreview`, built from the pure opener module directly so the browser
 * never loads settings-model's server-side dependencies.
 */
export function lockedOpenerPreview(callingAsName: string | null, recordingEnabled: boolean): string | null {
  const name = (callingAsName ?? "").trim();
  if (!name) return null;
  const now = new Date("2026-09-28T10:00:00Z");
  return buildLockedPreamble({
    callingAsName: name,
    enquiryAt: new Date(now.getTime() - 86_400_000),
    now,
    timezone: "Europe/London",
    recordingEnabled,
  }).text;
}

export { validateEditableSuffix };
