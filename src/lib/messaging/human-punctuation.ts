/**
 * Owner rule (2026-09-27): no emojis, and no em or en dashes used as dashes,
 * in anything a lead reads. "They make it obvious it's AI."
 *
 * The agent's validator rejects them (agent/human-style.ts, STYLE_EMOJI and
 * STYLE_EM_DASHES) and the composer regenerates. This module is the
 * deterministic half: it finds them, and it strips them without changing what
 * a sentence says. It is also the backstop in GSM normalisation
 * (sms-segments.ts normaliseForSms), so an SMS never carries one whoever wrote
 * it.
 *
 * Pure: no imports.
 */

/**
 * Emoji and pictographs, plus the joiners and modifiers that build them
 * (zero-width joiner, variation selector 16, keycap, skin tones, flags).
 * ©, ® and ™ are Extended_Pictographic but are ordinary trade marks in a
 * business name, so they are kept.
 */
const EMOJI =
  /(?![©®™])[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{20E3}\u{200D}]/gu;

/** The pictographs a text contains (joiners and selectors excluded). */
export function emojisIn(text: string): string[] {
  return (text.match(EMOJI) ?? []).filter((char) => !/[\u{FE0F}\u{20E3}\u{200D}\u{1F3FB}-\u{1F3FF}]/u.test(char));
}

/** An en dash between two digits is a range ("9–5", "2–3 weeks"), not a dash. */
const EN_DASH_RANGE = /(\d)\s?–\s?(\d)/g;

/** Em dashes, and en dashes used as a dash (anything but a digit range). */
export function dashesIn(text: string): number {
  const withoutRanges = text.replace(EN_DASH_RANGE, "$1-$2");
  return (withoutRanges.match(/[—–]/g) ?? []).length;
}

/**
 * Removes emojis and rewrites dashes as ordinary punctuation:
 *   "Yes — we can"      -> "Yes, we can"
 *   "a quick call — no pressure." -> "a quick call, no pressure."
 *   "9–5"               -> "9-5"
 *   "Thanks —"          -> "Thanks."
 * Never touches letters, digits, hyphens inside words, or anything else.
 */
export function stripAiPunctuation(text: string): string {
  let out = text.replace(EMOJI, "");
  out = out.replace(EN_DASH_RANGE, "$1-$2");
  // A dash at the very end of a sentence or the text becomes a full stop.
  out = out.replace(/\s*[—–]+\s*(?=$|\n)/g, ".");
  out = out.replace(/\s*[—–]+\s*/g, ", ");
  // Tidy what removal leaves behind.
  out = out
    .replace(/,\s*([.,!?;:])/g, "$1")
    .replace(/([.!?])\s*,\s*/g, "$1 ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?;:])/g, "$1")
    .replace(/^[ \t,]+|[ \t]+$/gm, "")
    .replace(/\.{2}(?!\.)/g, ".");
  return out.trim();
}
