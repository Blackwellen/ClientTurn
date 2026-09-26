/**
 * Structured won/lost reason categories.
 *
 * The free-text reason stays required (decision Q3); a category is optional
 * and is stored with it as a leading tag, "[Price] chose a cheaper supplier",
 * because there is no category column on the opportunity and the tagged text
 * is what reaches the reports and the connected CRM either way. A report can
 * recover the category with `parseCloseReason`.
 *
 * Pure: no React, no `server-only`.
 */

export const CLOSE_REASON_CATEGORIES = [
  "Price",
  "Timing",
  "Competitor",
  "No need",
  "No response",
  "Chose us — fit",
  "Other",
] as const;

export type CloseReasonCategory = (typeof CLOSE_REASON_CATEGORIES)[number];

/** The categories that make sense for each outcome, in display order. */
export const CLOSE_REASON_CATEGORIES_FOR: Record<"WON" | "LOST", readonly CloseReasonCategory[]> = {
  WON: ["Chose us — fit", "Price", "Timing", "Other"],
  LOST: ["Price", "Timing", "Competitor", "No need", "No response", "Other"],
};

/** A starting sentence put in the reason box when a chip is picked on an empty box. */
export const CLOSE_REASON_PREFILL: Record<CloseReasonCategory, string> = {
  Price: "Price was the deciding factor.",
  Timing: "The timing was the deciding factor.",
  Competitor: "They chose another supplier.",
  "No need": "They no longer need this.",
  "No response": "They stopped responding.",
  "Chose us — fit": "We were the best fit for what they need.",
  Other: "",
};

const TAG = /^\[([^\]]{1,40})\]\s*/;

export function isCloseReasonCategory(value: unknown): value is CloseReasonCategory {
  return typeof value === "string" && (CLOSE_REASON_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The stored reason: the text, tagged with the category when one was picked.
 * A tag the person typed themselves is replaced, never doubled.
 */
export function composeCloseReason(category: CloseReasonCategory | null, text: string): string {
  const body = text.trim().replace(TAG, "").trim();
  return category ? `[${category}] ${body}` : body;
}

/** A stored reason split back into its category (if tagged) and text. */
export function parseCloseReason(stored: string | null | undefined): {
  category: CloseReasonCategory | null;
  text: string;
} {
  const value = (stored ?? "").trim();
  const match = value.match(TAG);
  if (match && isCloseReasonCategory(match[1])) {
    return { category: match[1], text: value.slice(match[0].length).trim() };
  }
  return { category: null, text: value };
}
