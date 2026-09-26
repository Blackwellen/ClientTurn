/**
 * Normalisation for ingest (design 03 §1). Pure.
 *
 * - Email: trimmed and lower-cased; anything that is not plausibly an address
 *   fails rather than being stored as an identity key.
 * - Phone: E.164, GB by default. A number that cannot be placed fails.
 * - Names: trimmed, internal whitespace collapsed.
 * - UTM values: lower-cased.
 *
 * A failed email or phone is *dropped with a reason*, not fatal, when another
 * usable contact point arrived with it: a form lead with a typo in the email
 * but a good mobile is still an enquiry, and losing it is the worst outcome
 * for this route. Only "no usable contact at all" is INVALID.
 */

import type { ParsedIngestInput } from "./types.ts";

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;

export function normaliseEmail(
  value: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; reason: "email_invalid" } {
  if (value === null || value === undefined) return { ok: true, value: null };
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > 320 || !EMAIL.test(trimmed)) return { ok: false, reason: "email_invalid" };
  return { ok: true, value: trimmed };
}

/**
 * E.164 with GB as the default region.
 *
 *   07700 900123        -> +447700900123
 *   +44 (0)7700 900123  -> +447700900123  (the "(0)" trunk digit is dropped)
 *   0044 7700 900123    -> +447700900123
 *   447700900123        -> +447700900123
 *   +1 415 555 0100     -> +14155550100
 *
 * Fails on fewer than 8 or more than 15 digits, which is E.164's own range.
 */
export function normalisePhoneE164(
  value: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; reason: "phone_invalid" } {
  if (value === null || value === undefined) return { ok: true, value: null };
  const raw = value.trim();
  if (raw === "") return { ok: true, value: null };

  let working = raw.replace(/\(0\)/g, "").replace(/^whatsapp:/i, "");
  working = working.replace(/[\s().-]/g, "");
  if (working.startsWith("00")) working = `+${working.slice(2)}`;

  let digits: string;
  if (working.startsWith("+")) {
    digits = working.slice(1);
  } else if (working.startsWith("0")) {
    digits = `44${working.slice(1)}`;
  } else if (working.startsWith("44") && working.length >= 12) {
    digits = working;
  } else if (/^7\d{9}$/.test(working)) {
    // A UK mobile typed without its leading zero.
    digits = `44${working}`;
  } else {
    digits = working;
  }

  if (!/^\d+$/.test(digits)) return { ok: false, reason: "phone_invalid" };
  // "+44 0..." -- a trunk zero left after the country code.
  if (digits.startsWith("440")) digits = `44${digits.slice(3)}`;
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) {
    return { ok: false, reason: "phone_invalid" };
  }
  return { ok: true, value: `+${digits}` };
}

export function normaliseName(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned === "" ? null : cleaned;
}

export function normalisePostcode(value: string | null | undefined): string | null {
  const cleaned = normaliseName(value);
  return cleaned ? cleaned.toUpperCase() : null;
}

export function normaliseUtm(value: string | null | undefined): string | null {
  const cleaned = normaliseName(value);
  return cleaned ? cleaned.toLowerCase() : null;
}

/**
 * A provider timestamp as ISO-8601, or null. Accepts epoch milliseconds,
 * ISO strings (Meta's `+0000` form included) and Google's space-separated
 * `yyyy-MM-dd HH:mm:ss+hh:mm` form.
 */
export function normaliseSubmittedAt(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else {
    const normalised = value
      .trim()
      .replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, "$1T$2")
      .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    parsed = Date.parse(normalised);
  }
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Free-mail domains: a shared domain says nothing about a shared company. */
const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.co.uk", "outlook.com",
  "live.com", "live.co.uk", "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com",
  "aol.com", "btinternet.com", "sky.com", "virginmedia.com", "protonmail.com",
  "proton.me", "msn.com", "mail.com", "gmx.com", "talktalk.net",
]);

export function companyDomainOf(email: string | null): string | null {
  if (!email) return null;
  const domain = email.split("@")[1]?.toLowerCase() ?? null;
  if (!domain || GENERIC_DOMAINS.has(domain)) return null;
  return domain;
}

/** "Acme Studio Ltd." and "acme studio limited" are the same company name. */
export function companyKey(value: string | null | undefined): string | null {
  const cleaned = normaliseName(value);
  if (!cleaned) return null;
  const key = cleaned
    .toLowerCase()
    .replace(/[.,&'"]/g, " ")
    .replace(/\b(ltd|limited|llp|plc|inc|co|company|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key === "" ? null : key;
}

export type NormalisedPerson = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  roleTitle: string | null;
  postcode: string | null;
};

export type NormalisedIngest = {
  person: NormalisedPerson;
  utm: { source: string | null; medium: string | null; campaign: string | null; term: string | null; content: string | null };
  submittedAt: string | null;
  /** Codes for anything dropped along the way. */
  reasons: string[];
};

export function normaliseIngest(input: ParsedIngestInput): NormalisedIngest {
  const reasons: string[] = [];

  const email = normaliseEmail(input.person.email);
  if (!email.ok) reasons.push(email.reason);
  const phone = normalisePhoneE164(input.person.phone);
  if (!phone.ok) reasons.push(phone.reason);

  const submittedAt = normaliseSubmittedAt(input.source.submittedAt);
  if (input.source.submittedAt !== undefined && submittedAt === null) {
    reasons.push("submitted_at_unreadable");
  }

  return {
    person: {
      firstName: normaliseName(input.person.firstName),
      lastName: normaliseName(input.person.lastName),
      email: email.ok ? email.value : null,
      phone: phone.ok ? phone.value : null,
      companyName: normaliseName(input.person.companyName),
      roleTitle: normaliseName(input.person.roleTitle),
      postcode: normalisePostcode(input.person.postcode),
    },
    utm: {
      source: normaliseUtm(input.source.utm?.source),
      medium: normaliseUtm(input.source.utm?.medium),
      campaign: normaliseUtm(input.source.utm?.campaign),
      term: normaliseUtm(input.source.utm?.term),
      content: normaliseUtm(input.source.utm?.content),
    },
    submittedAt,
    reasons,
  };
}
