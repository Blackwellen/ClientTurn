/**
 * SMS segment counter (Phase 3.5, 01 §5).
 *
 * Pure. GSM-7: 160 characters in one segment, 153 per segment once split
 * (the rest is the concatenation header). Characters in the GSM-7 extension
 * table (€ [ ] { } \ ~ ^ |) cost two septets. Any character outside GSM-7 --
 * one emoji, one curly quote -- switches the WHOLE message to UCS-2: 70 in one
 * segment, 67 per segment once split, counted in UTF-16 code units (so an
 * emoji outside the BMP costs two).
 *
 * Used by the agent's length lint and recorded on every SMS send for cost.
 */

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€\f";

const BASIC = new Set(GSM7_BASIC);
const EXTENDED = new Set(GSM7_EXTENDED);

export type SmsEncoding = "GSM7" | "UCS2";

export type SegmentCount = {
  encoding: SmsEncoding;
  /** Septets (GSM-7) or UTF-16 code units (UCS-2). */
  units: number;
  segments: number;
  /** Units left before the next segment starts. */
  remaining: number;
};

export function smsEncoding(body: string): SmsEncoding {
  for (const char of body) {
    if (!BASIC.has(char) && !EXTENDED.has(char)) return "UCS2";
  }
  return "GSM7";
}

export function countSmsSegments(body: string): SegmentCount {
  const encoding = smsEncoding(body);
  let units = 0;
  if (encoding === "GSM7") {
    for (const char of body) units += EXTENDED.has(char) ? 2 : 1;
  } else {
    units = body.length; // UTF-16 code units
  }

  const single = encoding === "GSM7" ? 160 : 70;
  const multi = encoding === "GSM7" ? 153 : 67;

  if (units === 0) return { encoding, units, segments: 0, remaining: single };
  if (units <= single) return { encoding, units, segments: 1, remaining: single - units };

  const segments = Math.ceil(units / multi);
  return { encoding, units, segments, remaining: segments * multi - units };
}

/**
 * Typographic characters that silently force UCS-2 (and so up to 2.3x the
 * segments) when a plain GSM-7 equivalent says the same thing.
 */
const SMART_REPLACEMENTS: [RegExp, string][] = [
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[–—]/g, "-"],
  [/…/g, "..."],
  [/ /g, " "],
];

/** Replaces smart punctuation with GSM-7 equivalents. Never touches emoji or letters. */
export function normaliseForSms(body: string): string {
  return SMART_REPLACEMENTS.reduce((text, [pattern, plain]) => text.replace(pattern, plain), body);
}

/** Segments above which an SMS is too long to send as one reply (lint). */
export const SMS_MAX_SEGMENTS = 4;
/** Segments above which the composer is asked to compress. */
export const SMS_PREFERRED_SEGMENTS = 3;
