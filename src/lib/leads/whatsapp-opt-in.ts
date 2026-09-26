/**
 * Recording that a person opted in to WhatsApp.
 *
 * The policy engine sends WhatsApp outside the 24-hour window only to a lead
 * whose permission record has "WHATSAPP" in `consent_scope` (B25). This is the
 * vocabulary and the checks for the person-recorded version of that fact: when
 * they opted in and how, so the scope entry has evidence behind it. The date,
 * source and detail are written to the audit row by `lead.record_whatsapp_opt_in`.
 *
 * Pure: no React, no `server-only`.
 */

export const WHATSAPP_OPT_IN_SOURCES = [
  "LEAD_FORM",
  "WHATSAPP_MESSAGE",
  "PHONE_CALL",
  "IN_PERSON",
  "EMAIL",
  "OTHER",
] as const;

export type WhatsAppOptInSource = (typeof WHATSAPP_OPT_IN_SOURCES)[number];

export const WHATSAPP_OPT_IN_SOURCE_LABELS: Record<WhatsAppOptInSource, string> = {
  LEAD_FORM: "Ticked a box on a form",
  WHATSAPP_MESSAGE: "Asked us on WhatsApp",
  PHONE_CALL: "Agreed on a phone call",
  IN_PERSON: "Agreed in person",
  EMAIL: "Agreed by email",
  OTHER: "Other",
};

export const MAX_OPT_IN_DETAIL = 300;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function scopeList(scope: unknown): string[] {
  return Array.isArray(scope) ? scope.map((value) => String(value)) : [];
}

/** Whether a stored `consent_scope` already holds the WhatsApp opt-in. */
export function hasWhatsAppOptIn(scope: unknown): boolean {
  return scopeList(scope).some((value) => value.toUpperCase() === "WHATSAPP");
}

/** The scope with WhatsApp added. Never narrows: every existing entry is kept. */
export function withWhatsAppScope(scope: unknown): string[] {
  const list = scopeList(scope);
  return hasWhatsAppOptIn(list) ? list : [...list, "WHATSAPP"];
}

/** Today as YYYY-MM-DD in UTC, for the date input's default and upper bound. */
export function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Why an opt-in record is not acceptable, or null when it is.
 *
 * The date may not be in the future. "Future" allows 14 hours past UTC
 * midnight, so someone ahead of UTC recording today's date is not refused.
 * "Other" needs a sentence saying what happened, or it is not evidence.
 */
export function optInProblem(
  input: { optedInOn: string; source: string; detail?: string | null },
  now: Date = new Date(),
): string | null {
  if (!DATE.test(input.optedInOn) || Number.isNaN(Date.parse(`${input.optedInOn}T00:00:00Z`))) {
    return "Enter the date they opted in.";
  }
  if (isoDate(new Date(`${input.optedInOn}T00:00:00Z`)) !== input.optedInOn) {
    return "Enter the date they opted in.";
  }
  if (input.optedInOn > isoDate(new Date(now.getTime() + 14 * 3_600_000))) {
    return "The opt-in date cannot be in the future.";
  }
  if (!(WHATSAPP_OPT_IN_SOURCES as readonly string[]).includes(input.source)) {
    return "Choose how they opted in.";
  }
  const detail = (input.detail ?? "").trim();
  if (detail.length > MAX_OPT_IN_DETAIL) {
    return `Keep the detail under ${MAX_OPT_IN_DETAIL} characters.`;
  }
  if (input.source === "OTHER" && detail.length < 3) {
    return "Say how they opted in.";
  }
  return null;
}
