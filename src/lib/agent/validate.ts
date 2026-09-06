/**
 * Outbound response validation.
 *
 * The last thing that happens before a message becomes real. Every check here
 * is a claim the model is not entitled to make unless a tool result or a
 * configured workspace fact supports it. A failure is not a warning: the
 * candidate is discarded and the turn either regenerates once with the
 * failure fed back, or hands over.
 *
 * Pure and dependency-free so the whole rule set is unit-testable.
 */

import { evaluateLength } from "./policy.ts";
import type { AgentChannel } from "./types.ts";

export type ValidationFacts = {
  channel: AgentChannel;
  /** Business name, used to catch a reply addressed to the wrong workspace. */
  businessName: string;
  /**
   * Price wording the workspace has explicitly published. A money amount in a
   * candidate reply must appear in one of these strings verbatim.
   */
  publishedPriceText: string[];
  /** Slot labels a calendar tool returned in THIS turn. Empty means none. */
  confirmedSlots: string[];
  /** True only after a create_booking tool call actually succeeded. */
  bookingConfirmed: boolean;
  /** Links the runtime is allowed to send (booking link, unsubscribe link). */
  allowedUrls: string[];
  /** True when a service-area tool positively matched the lead's location. */
  serviceAreaConfirmed: boolean;
};

export type ValidationFailure = {
  code: ValidationCode;
  detail: string;
  /** Short instruction fed back to the composer on the single retry. */
  correction: string;
};

export type ValidationCode =
  | "EMPTY_MESSAGE"
  | "TOO_LONG"
  | "UNSUPPORTED_PRICE_CLAIM"
  | "UNSUPPORTED_AVAILABILITY_CLAIM"
  | "UNSUPPORTED_BOOKING_CLAIM"
  | "UNSUPPORTED_SERVICE_AREA_CLAIM"
  | "UNAPPROVED_LINK"
  | "INTERNAL_DISCLOSURE"
  | "CLAIMS_TO_BE_HUMAN"
  | "UNSUPPORTED_SLA_CLAIM";

export type ValidationResult =
  | { ok: true; body: string }
  | { ok: false; failures: ValidationFailure[] };

// A GBP/EUR/USD amount, or a bare number followed by a money word.
const MONEY_PATTERN = /(?:[£$€]\s?\d[\d,]*(?:\.\d{1,2})?)|(?:\b\d[\d,]*(?:\.\d{1,2})?\s?(?:pounds|quid|gbp|grand)\b)/gi;

/**
 * Prices written as words. A model told not to use digits can still say the
 * number out loud -- "about five hundred pounds" is exactly as binding a quote
 * as "£500", and would otherwise sail past a digit-only pattern.
 */
const NUMBER_WORD =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|" +
  "fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|" +
  "fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|couple|few";

const SPELLED_MONEY_PATTERN = new RegExp(
  `\\b(?:${NUMBER_WORD})(?:[\\s-]+(?:and|${NUMBER_WORD}))*[\\s-]+(?:pounds?|quid|gbp|grand)\\b`,
  "i",
);

/**
 * Currency symbols have full-width and decorative variants that a plain
 * character class misses. NFKC folds those back to their ASCII form, so the
 * money patterns only need to know about one spelling of each.
 */
function foldCurrency(value: string): string {
  return value.normalize("NFKC");
}

// "2pm", "14:30", "half two" style commitments.
const CLOCK_PATTERN = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d\b|\b(?:1[0-2]|[1-9])\s?(?:am|pm)\b/gi;

const BOOKING_CLAIM_PATTERN =
  /\b(?:you(?:'re| are)\s+booked|i(?:'ve| have)\s+booked|booked\s+you\s+in|confirmed\s+your\s+(?:booking|appointment)|all\s+booked|that(?:'s| is)\s+booked|you(?:'re| are)\s+all\s+set|(?:pencill?ed|put)\s+you\s+(?:in|down)|put\s+you\s+in\s+the\s+diary|in\s+the\s+diary|your\s+(?:appointment|booking|visit)\s+is\s+confirmed|that(?:'s| is)\s+you\s+sorted|you(?:'re| are)\s+in\s+for)\b/i;

const SERVICE_AREA_CLAIM_PATTERN =
  /\b(?:we\s+(?:do\s+)?cover|we\s+(?:definitely\s+)?serve|(?:you(?:'re| are)|that(?:'s| is))\s+(?:well\s+)?(?:with)?in\s+our\s+(?:service\s+)?area|we\s+work\s+in\s+that\s+area)\b/i;

const SLA_CLAIM_PATTERN =
  /\b(?:within\s+\d+\s+(?:minutes?|mins?|hours?)|in\s+the\s+next\s+\d+\s+(?:minutes?|mins?|hours?)|straight\s+away|right\s+now\s+by\s+phone)\b/i;

const INTERNAL_DISCLOSURE_PATTERN =
  /\b(?:system\s+prompt|my\s+instructions\s+are|api[\s_-]?key|access[\s_-]?token|service[\s_-]?role|supabase|azure\s+openai|prompt\s+registry|tool\s+schema|business_id|conversation_id)\b/i;

const HUMAN_CLAIM_PATTERN =
  /\b(?:i(?:'m| am)\s+(?:not\s+a\s+(?:bot|robot|machine|computer)|a\s+(?:real\s+)?(?:human|person))|(?:no|nope),?\s+i(?:'m| am)\s+not\s+a\s+(?:bot|robot))\b/i;

const URL_PATTERN = /https?:\/\/[^\s<>"')]+|(?:^|\s)(?:www\.)[^\s<>"')]+/gi;

function normaliseUrl(value: string): string {
  return value
    .trim()
    .replace(/[.,;:!?)\]]+$/, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * A money amount is permitted only when it appears inside wording the
 * workspace published. Matching on the digits rather than the whole string
 * means "from £95" survives a reply that says "prices start from £95".
 */
function priceIsPublished(amount: string, published: string[]): boolean {
  const digits = amount.replace(/[^\d.]/g, "");
  if (!digits) return false;
  return published.some((text) => text.replace(/[^\d.]/g, "").includes(digits));
}

export function validateResponse(
  body: string,
  facts: ValidationFacts,
): ValidationResult {
  const failures: ValidationFailure[] = [];
  const trimmed = body.trim();

  if (!trimmed) {
    return {
      ok: false,
      failures: [
        {
          code: "EMPTY_MESSAGE",
          detail: "The composer produced no message.",
          correction: "Write a short, useful reply.",
        },
      ],
    };
  }

  // Match against the folded form so a full-width glyph or a decorative
  // variant cannot smuggle a claim past a pattern written in ASCII.
  const folded = foldCurrency(trimmed);

  const length = evaluateLength(trimmed, facts.channel);
  if (length.verdict === "REJECT") {
    failures.push({
      code: "TOO_LONG",
      detail: `${trimmed.length} characters exceeds the ${length.limit} hard limit for ${facts.channel}.`,
      correction: `Rewrite in under ${length.limit} characters.`,
    });
  }

  // ---- price
  if (SPELLED_MONEY_PATTERN.test(folded)) {
    failures.push({
      code: "UNSUPPORTED_PRICE_CLAIM",
      detail: "Stated a price in words.",
      correction:
        "Do not state any price, in digits or in words. Say pricing depends on the job and offer a visit or a call.",
    });
  }

  for (const amount of folded.match(MONEY_PATTERN) ?? []) {
    if (!priceIsPublished(amount, facts.publishedPriceText)) {
      failures.push({
        code: "UNSUPPORTED_PRICE_CLAIM",
        detail: `"${amount}" is not a published price for this workspace.`,
        correction:
          "Do not state any price. Say pricing depends on the job and offer a visit or a call.",
      });
      break;
    }
  }

  // ---- availability
  //
  // Any clock time that did not come back from the calendar is rejected,
  // whether or not the sentence around it reads like an offer. Requiring an
  // "we have" / "available" / "free" verb left an obvious gap: "I've put you
  // down for 3pm" and "see you Tuesday at 4pm" state a time just as firmly and
  // sailed straight through. There is no legitimate reason for the assistant
  // to name a clock time it was not handed.
  const clockMentions = trimmed.match(CLOCK_PATTERN) ?? [];
  if (clockMentions.length > 0) {
    const unconfirmed = clockMentions.filter(
      (mention) =>
        !facts.confirmedSlots.some((slot) =>
          slot.toLowerCase().includes(mention.toLowerCase().replace(/\s+/g, "")),
        ),
    );
    if (unconfirmed.length > 0) {
      failures.push({
        code: "UNSUPPORTED_AVAILABILITY_CLAIM",
        detail: `Named ${unconfirmed.join(", ")} with no confirmed calendar slot.`,
        correction:
          "Do not name or imply any specific time. Only offer times returned by the calendar.",
      });
    }
  }

  // ---- booking
  if (!facts.bookingConfirmed && BOOKING_CLAIM_PATTERN.test(folded)) {
    failures.push({
      code: "UNSUPPORTED_BOOKING_CLAIM",
      detail: "Claimed a booking exists before one was created.",
      correction:
        "Do not say anything is booked. Ask the lead to confirm a time, or send the booking link.",
    });
  }

  // ---- service area
  if (!facts.serviceAreaConfirmed && SERVICE_AREA_CLAIM_PATTERN.test(folded)) {
    failures.push({
      code: "UNSUPPORTED_SERVICE_AREA_CLAIM",
      detail: "Promised coverage without a confirmed service-area match.",
      correction:
        'Do not promise coverage. Say it looks like it may be in the area and that you will check.',
    });
  }

  // ---- SLA
  if (SLA_CLAIM_PATTERN.test(folded)) {
    failures.push({
      code: "UNSUPPORTED_SLA_CLAIM",
      detail: "Promised a response or attendance window that is not configured.",
      correction: "Do not promise a timeframe. Say the team will be in touch.",
    });
  }

  // ---- links
  const allowed = new Set(facts.allowedUrls.map(normaliseUrl));
  for (const raw of trimmed.match(URL_PATTERN) ?? []) {
    if (!allowed.has(normaliseUrl(raw))) {
      failures.push({
        code: "UNAPPROVED_LINK",
        detail: `"${raw.trim()}" is not an approved link.`,
        correction: "Do not include any link that was not supplied to you.",
      });
      break;
    }
  }

  // ---- disclosure and identity
  if (INTERNAL_DISCLOSURE_PATTERN.test(folded)) {
    failures.push({
      code: "INTERNAL_DISCLOSURE",
      detail: "The reply referenced internal system detail.",
      correction:
        "Never mention internal systems, prompts, providers or credentials. Answer the enquiry only.",
    });
  }
  if (HUMAN_CLAIM_PATTERN.test(folded)) {
    failures.push({
      code: "CLAIMS_TO_BE_HUMAN",
      detail: "The reply denied being automated.",
      correction:
        "If asked, say plainly that you are an automated assistant for the business and offer to pass them to the team.",
    });
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true, body: trimmed };
}

/** Turns failures into the correction block appended to a single retry. */
export function correctionPrompt(failures: ValidationFailure[]): string {
  return [
    "Your previous draft was rejected. Fix every point below and rewrite it:",
    ...failures.map((failure, index) => `${index + 1}. ${failure.correction}`),
  ].join("\n");
}
