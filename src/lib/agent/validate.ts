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
import {
  checkoutLinkIn,
  claimsPurchase,
  discountOffers,
  type CheckoutLink,
} from "../commercial/authority.ts";
import { trackedTokenFor, trackingParamFor } from "../payments/tracking.ts";
import type { AgentChannel } from "./types.ts";
import type { QaCode } from "../qualification-intelligence/types.ts";
import type { QuoteValidationFacts } from "./quote-flow.ts";
import { humanStyleFailures, type HumanStyleCode } from "./human-style.ts";
import { competitorClaimFailures, type CompetitorRule } from "../sales-library/competitors.ts";
import { offTargetMentions } from "../agents/offer-target.ts";

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
  /** Workspace phrases never to use (voice profile). Case-insensitive. */
  forbiddenPhrases?: string[];
  /** Workspace prohibited claims (playbook). Case-insensitive. */
  prohibitedClaims?: string[];
  /**
   * Direct close (decision Q2). Absent or disabled = no discount of any size
   * may be offered and no checkout link has special standing. When set, the
   * approved links' price text is the only price wording a message carrying
   * that link may use, and a discount is allowed only up to the maximum.
   */
  commercial?: {
    enabled: boolean;
    maxDiscountPercent: number;
    checkoutLinks: CheckoutLink[];
  } | null;
  /**
   * Pre-send question QA (qualification-intelligence/qa.ts, design 08 §16),
   * supplied by the orchestrator with the turn's NBA and fact state bound in.
   * Its REJECT findings join the ordinary failures, so they take the same
   * one-retry -> handover path. Absent = no question QA (engine OFF).
   */
  extraChecks?: (body: string) => { code: QaCode; detail: string; correction: string }[];
  /**
   * The business's earlier messages in this conversation (any order). A
   * question that repeats one of their questions word for word, or nearly,
   * is rejected (QA_REPEAT): the lead has already seen it. Absent = no check.
   */
  priorOutbound?: string[];
  /**
   * The engine planned an explicit VERIFY of a stale fact this turn. Checking
   * an old answer may share most of its words with the question that first
   * got it, so a near-duplicate is allowed; a word-for-word repeat never is.
   */
  verifyingStaleFact?: boolean;
  /** The lead's first name: the human-style lint allows it once (human-style.ts). */
  leadFirstName?: string | null;
  /**
   * The quote in play this turn (agent/quote-flow.ts): the figures a
   * calculate_quote result or the current quote revision produced, formatted
   * as the quote shows them. A money amount is allowed when it is one of
   * these (or published wording, or an approved checkout link's price text);
   * VAT may be mentioned only for a VAT-registered quote, and a VAT rate or a
   * discount percentage only when the quote carries it. Absent = no quote:
   * no VAT or tax statement of any kind.
   */
  quote?: QuoteValidationFacts | null;
  /**
   * Competitor positioning (0174): every enabled competitor's names, approved
   * points and never-say lines. A draft may say about a competitor only one of
   * its approved points, word for word, and never disparage one. Absent or
   * empty = no competitors configured, no check.
   */
  competitors?: CompetitorRule[];
  /**
   * Agent targeting (0174): names of offers and items outside the lead's
   * agent's target. A draft naming one is rejected. Absent = whole catalogue.
   */
  offTargetNames?: string[];
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
  | "UNSUPPORTED_SLA_CLAIM"
  | "UNSUPPORTED_DISCOUNT"
  | "PURCHASE_CLAIM"
  | "CHECKOUT_PRICE_MISMATCH"
  | "UNSUPPORTED_VAT_CLAIM"
  | "UNSUPPORTED_DELIVERY_CLAIM"
  | "UNAPPROVED_COMPETITOR_CLAIM"
  | "OFF_TARGET_OFFER"
  | StyleCode
  | QaCode;

export type StyleCode =
  | "STYLE_CLICHE"
  | "STYLE_EM_DASHES"
  | "STYLE_REPEATED_JUST"
  | "STYLE_MULTIPLE_QUESTIONS"
  | "STYLE_FORBIDDEN_PHRASE"
  | "STYLE_PROHIBITED_CLAIM"
  | "STYLE_PRESSURE"
  // The "sounds like AI" lint (human-style.ts). STYLE_EM_DASHES above is
  // raised there too, now for any em or en dash used as a dash.
  | HumanStyleCode;

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

// Transparency (owner decision 2026-09-27): the assistant never claims or
// implies to be a person, however it is asked.
const HUMAN_CLAIM_PATTERN =
  /\b(?:i(?:'m| am)\s+(?:not\s+(?:a\s+|an\s+)?(?:bot|robot|machine|computer|ai|chatbot|automated)|a\s+(?:real\s+)?(?:human|person))|(?:no|nope),?\s+i(?:'m| am)\s+not\s+a\s+(?:bot|robot)|you(?:'re| are)\s+(?:talking|speaking|chatting)\s+(?:to|with)\s+a\s+(?:real\s+)?(?:human|person)|this\s+is\s+a\s+real\s+(?:human|person))\b/i;

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

/**
 * VAT and tax (resolved conflict 1: the AI never improvises VAT). A mention
 * of VAT, tax, "zero-rated" or "exempt" is a statement about the price.
 */
const VAT_PATTERN = /\b(?:vat|v\.a\.t\.?|sales\s+tax|tax(?:es)?|zero[\s-]?rated|vat[\s-]?exempt|tax[\s-]?free|ex(?:cl(?:uding)?)?\.?\s+vat|inc(?:l(?:uding)?)?\.?\s+vat)\b/i;

/**
 * A delivery, start or completion promise: a commitment to a date or a
 * duration the quote does not make ("ready in two weeks", "we can start on
 * Monday", "delivered by Friday", "turnaround of 5 days").
 */
const DELIVERY_PATTERN =
  /\b(?:deliver(?:ed|y)?|turnaround|lead\s+time|ready|complete(?:d)?|finish(?:ed)?|live|launch(?:ed)?|start(?:ed)?|kick\s+off|begin|ship(?:ped)?|installed|done)\b[^.?!\n]{0,40}?\b(?:(?:with)?in|by|on|of)\s+(?:(?:\d+|a|an|one|two|three|four|five|six|seven|eight|ten|a\s+couple\s+of|a\s+few)\s+(?:working\s+|business\s+)?(?:days?|weeks?|months?)|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)|(?:the\s+)?end\s+of\s+(?:the\s+)?(?:week|month))\b/i;

function vatPercents(sentence: string): number[] {
  return [...sentence.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|per\s?cent\b)/gi)].map((m) => Number(m[1]));
}

/** A money amount is one of this turn's quote figures (digits compared, as for published prices). */
function isQuoteFigure(amount: string, quote: QuoteValidationFacts | null | undefined): boolean {
  if (!quote || quote.figures.length === 0) return false;
  const digits = amount.replace(/[^\d.]/g, "").replace(/\.$/, "");
  if (!digits) return false;
  return quote.figures.some((figure) => {
    const f = figure.replace(/[^\d.]/g, "");
    // "£1,200" for "£1,200.00" is the same figure; "£120" is not.
    return f === digits || f === `${digits}.00` || f.replace(/\.00$/, "") === digits;
  });
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
        "Do not state any price, in digits or in words. Say pricing depends on their requirements and offer the next step.",
    });
  }

  for (const amount of folded.match(MONEY_PATTERN) ?? []) {
    if (!priceIsPublished(amount, facts.publishedPriceText) && !isQuoteFigure(amount, facts.quote)) {
      failures.push({
        code: "UNSUPPORTED_PRICE_CLAIM",
        detail: facts.quote?.figures.length
          ? `"${amount}" is not one of this quote's figures.`
          : `"${amount}" is not a published price for this workspace.`,
        correction: facts.quote?.figures.length
          ? `State only these figures, exactly as written: ${facts.quote.figures.slice(0, 6).join(", ")}. Do not calculate or round anything.`
          : "Do not state any price. Say pricing depends on their requirements and offer the next step.",
      });
      break;
    }
  }

  // ---- VAT and tax: never improvised (resolved conflict 1)
  if (VAT_PATTERN.test(folded)) {
    const quote = facts.quote ?? null;
    if (!quote || !quote.vatRegistered) {
      failures.push({
        code: "UNSUPPORTED_VAT_CLAIM",
        detail: quote ? "Mentioned VAT on a quote that carries none." : "Mentioned VAT or tax with no quote in hand.",
        correction: "Do not mention VAT or tax at all.",
      });
    } else {
      const sentences = folded.split(/(?<=[.!?\n])\s+/).filter((sentence) => VAT_PATTERN.test(sentence));
      const stray = sentences.flatMap(vatPercents).filter((pct) => !quote.vatRatesPercent.includes(pct) && !quote.discountPercents.includes(pct));
      if (stray.length > 0) {
        failures.push({
          code: "UNSUPPORTED_VAT_CLAIM",
          detail: `Stated a VAT rate of ${stray[0]}% that is not on the quote.`,
          correction: "Say nothing about VAT beyond the quote's own figures.",
        });
      }
    }
  }

  // ---- delivery, start and completion dates: never promised
  if (DELIVERY_PATTERN.test(folded)) {
    failures.push({
      code: "UNSUPPORTED_DELIVERY_CLAIM",
      detail: "Promised a delivery, start or completion time.",
      correction: "Do not promise when anything will start, be delivered or be finished. Say the team will confirm the timeline.",
    });
  }

  // ---- discounts (decision Q2)
  //
  // A percentage off is as binding as a price, and it needs no money amount
  // to be one: "30% off if you sign today" is an offer the business never
  // made. Allowed only when the workspace granted discount authority, and
  // only up to its maximum. An unquantified "a discount" is never allowed.
  const commercial = facts.commercial ?? null;
  const allowance = commercial?.enabled ? commercial.maxDiscountPercent : 0;
  const quoteDiscounts = facts.quote?.discountPercents ?? [];
  const underReview = facts.quote?.discountUnderReview === true;
  const offers = discountOffers(folded).filter(
    (percent) =>
      // The discount the quote itself carries this turn (a calculate_quote
      // result) may be stated exactly; one with a person for approval may be
      // mentioned, never quantified.
      !quoteDiscounts.includes(percent) && !(underReview && percent === Number.POSITIVE_INFINITY),
  );
  const excessive = offers.filter((percent) => !(percent > 0 && percent <= allowance));
  if (excessive.length > 0) {
    failures.push({
      code: "UNSUPPORTED_DISCOUNT",
      detail: Number.isFinite(excessive[0])
        ? `Offered a ${excessive[0]}% discount; the workspace allows ${allowance}%.`
        : "Offered an unspecified discount.",
      correction:
        allowance > 0
          ? `Do not offer a discount above ${allowance}%, and never an unspecified one.`
          : "Do not offer any discount or money off. Pricing is set by the business.",
    });
  }

  // ---- purchases: completion is confirmed by the CRM or a webhook, never here.
  if (claimsPurchase(folded)) {
    failures.push({
      code: "PURCHASE_CLAIM",
      detail: "Claimed a purchase, order or payment happened.",
      correction:
        "Never say anything was bought, ordered or paid. Point to the checkout link and let the lead complete it.",
    });
  }

  // ---- a checkout link carries its own price text, and only that one.
  const checkoutLink = commercial?.enabled ? checkoutLinkIn(trimmed, commercial.checkoutLinks) : null;
  if (checkoutLink) {
    for (const amount of folded.match(MONEY_PATTERN) ?? []) {
      if (!priceIsPublished(amount, [checkoutLink.price_text])) {
        failures.push({
          code: "CHECKOUT_PRICE_MISMATCH",
          detail: `"${amount}" does not match the approved price for ${checkoutLink.label}.`,
          correction: `If you state the price, use exactly: ${checkoutLink.price_text}.`,
        });
        break;
      }
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
  //
  // A tracked checkout link (payments/tracking.ts) is admitted only when its
  // base is an approved checkout link that THIS turn allows, and the one
  // difference is that link's own tracking parameter carrying a well-formed
  // token. Any other added parameter, a different parameter name, or a base
  // that is not allowed this turn is UNAPPROVED_LINK as before.
  const allowed = new Set(facts.allowedUrls.map(normaliseUrl));
  const trackedAllowed = (raw: string): boolean =>
    Boolean(commercial?.enabled) &&
    (commercial?.checkoutLinks ?? []).some(
      (link) =>
        allowed.has(normaliseUrl(link.url)) &&
        trackedTokenFor(raw.trim(), link.url, trackingParamFor(link)) !== null,
    );
  for (const raw of trimmed.match(URL_PATTERN) ?? []) {
    if (!allowed.has(normaliseUrl(raw)) && !trackedAllowed(raw)) {
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

  // ---- competitors: approved points only, never a put-down (0174)
  failures.push(...competitorClaimFailures(trimmed, facts.competitors ?? []));

  // ---- the agent's target: never pitch an offer it does not sell (0174)
  const offTarget = offTargetMentions(trimmed, facts.offTargetNames ?? []);
  if (offTarget.length > 0) {
    failures.push({
      code: "OFF_TARGET_OFFER",
      detail: `Named ${offTarget.map((n) => `"${n}"`).join(", ")}, outside what this agent sells.`,
      correction:
        `Do not name or offer ${offTarget.map((n) => `"${n}"`).join(", ")}. Talk only about what is on the offer card; ` +
        "if they asked about something else, say a colleague will pick that up.",
    });
  }

  // ---- style and QA lint (design doc 04 §5, brief §49)
  failures.push(...lintStyle(trimmed, facts));

  // ---- no repeated question (golden eval `book-meeting-one-word-reply`: a
  // verbatim repeat of the question the lead just answered was accepted).
  const repeat = repeatedQuestion(trimmed, facts.priorOutbound ?? [], { allowNearDuplicate: facts.verifyingStaleFact === true });
  if (repeat) {
    failures.push({
      code: "QA_REPEAT",
      detail: `${repeat.exact ? "Repeats" : "Nearly repeats"} an earlier question: "${repeat.prior}".`,
      correction: "That question was already asked in this conversation. Do not ask it again; move the conversation on, or ask something new in new words.",
    });
  }

  // ---- question QA (design 08 §16). Codes already reported above are not
  // repeated (TOO_LONG, STYLE_MULTIPLE_QUESTIONS, QA_REPEAT).
  if (facts.extraChecks) {
    const reported = new Set<string>(failures.map((failure) => failure.code));
    for (const extra of facts.extraChecks(trimmed)) {
      if (reported.has(extra.code)) continue;
      reported.add(extra.code);
      failures.push(extra);
    }
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true, body: trimmed };
}

// --------------------------------------------------------------- style lint

/**
 * Phrases that make an automated message read as automated, or as a sales
 * template. Matched case-insensitively on word boundaries.
 */
export const BANNED_CLICHES: { phrase: string; pattern: RegExp }[] = [
  { phrase: "I hope this finds you well", pattern: /\bhope (this|that|my (message|email)) finds you well\b/i },
  { phrase: "I completely understand", pattern: /\bi (completely|totally|fully) understand\b/i },
  { phrase: "Absolutely!", pattern: /(^|[\s"'(])absolutely\s*!/i },
  { phrase: "game-changing", pattern: /\bgame[\s-]?chang(ing|er)\b/i },
  { phrase: "revolutionary", pattern: /\brevolutionary\b/i },
  { phrase: "unlock", pattern: /\bunlock(s|ed|ing)?\b/i },
  { phrase: "circle back", pattern: /\bcircl(e|ing) back\b/i },
  // "leverage" as filler. As a noun about physical force it never comes up in
  // a sales reply, so every use is treated as filler.
  { phrase: "leverage", pattern: /\bleverag(e|es|ed|ing)\b/i },
];

/**
 * Pressure language (evidence register 01 §7, reactance row: pressure provokes
 * resistance, and fabricated urgency is also a misleading claim). Deterministic
 * and deliberately narrow, so ordinary wording passes: "you must be busy",
 * "you need to send your postcode" and "the offer is on our site" are fine.
 * Each entry names what it catches so the correction can say it.
 */
export const PRESSURE_PATTERNS: { kind: "URGENCY" | "SCARCITY" | "CONTROL" | "THREAT" | "GUILT"; label: string; pattern: RegExp }[] = [
  // Fabricated urgency and deadlines.
  { kind: "URGENCY", label: "a deadline", pattern: /\b(offer|deal|discount|price|pricing|promotion|this)\s+(ends|expires|closes)\s+(today|tonight|tomorrow|soon|at midnight|this (week|weekend|friday|month))\b/i },
  { kind: "URGENCY", label: "last chance", pattern: /\blast chance\b/i },
  { kind: "URGENCY", label: "act now", pattern: /\bact (now|fast|quickly|today)\b/i },
  { kind: "URGENCY", label: "before it's too late", pattern: /\bbefore it[’']?s too late\b/i },
  { kind: "URGENCY", label: "time is running out", pattern: /\b(time is running out|running out of time|now or never|hurry)\b/i },
  { kind: "URGENCY", label: "don't delay", pattern: /\bdon[’']?t (delay|wait)\b/i },
  // Fabricated scarcity.
  { kind: "SCARCITY", label: "only a few left", pattern: /\bonly\s+(\d+|one|two|three|four|five|a (few|handful))\s+(left|remaining|spots?|places?|spaces?|slots?)\b/i },
  { kind: "SCARCITY", label: "limited spots", pattern: /\blimited (spots|places|spaces|slots|availability|numbers)\b/i },
  { kind: "SCARCITY", label: "while they last", pattern: /\bwhile (stocks?|spaces|spots|places|supplies) last\b/i },
  { kind: "SCARCITY", label: "selling fast", pattern: /\b(selling|filling up|going) fast\b/i },
  // Controlling language aimed at the buyer's decision.
  { kind: "CONTROL", label: "you need to decide", pattern: /\byou (need|have|ought) to (act|decide|commit|sign( up)?|buy|purchase|book now|move (fast|quickly)|say yes)\b/i },
  { kind: "CONTROL", label: "you must act", pattern: /\byou must (act|decide|commit|sign( up)?|buy|purchase|book|respond|reply|take (this|advantage))\b/i },
  { kind: "CONTROL", label: "don't miss out", pattern: /\bdon[’']?t miss (out|this( (offer|opportunity|chance|deal))?)\b/i },
  // Threats of loss.
  { kind: "THREAT", label: "you'll lose out", pattern: /\byou[’']?(ll| will) (lose|miss) (out|your (place|spot|slot|space|discount|chance))\b/i },
  { kind: "THREAT", label: "given to someone else", pattern: /\b(spot|place|slot|space|discount)\s+will (be given|go) to someone else\b/i },
  // Guilt and shame framing.
  { kind: "GUILT", label: "guilt framing", pattern: /\b(don[’']?t you (want|care)|why (haven[’']?t|wouldn[’']?t|won[’']?t) you|i[’']?m (really )?(disappointed|surprised) (you|that you))\b/i },
  { kind: "GUILT", label: "competitor shaming", pattern: /\b(your competitors|everyone else) (are|is) already\b/i },
];

/** The pressure phrases a text uses, by label. Pure; exported for tests. */
export function pressureIn(text: string): string[] {
  const value = text.normalize("NFKC");
  return PRESSURE_PATTERNS.filter((entry) => entry.pattern.test(value)).map((entry) => entry.label);
}

/**
 * Owner rule (2026-09-27): no em or en dashes used as dashes at all. They
 * make it obvious it is AI. Enforced by human-style.ts (STYLE_EM_DASHES).
 */
export const MAX_EM_DASHES = 0;
/** This many or more "just"s reads as hedging. */
export const MAX_JUST = 2;

/**
 * Interrogative openings that make a sentence a question without a "?".
 * Auxiliary-first only: "Could you send your postcode." is a question, while a
 * sentence opening with a wh-word ("When you're ready, here's the link.") is
 * usually not, and counting it would reject good replies.
 */
const INTERROGATIVE_CLAUSE =
  /(^|[.!]\s+|\n)\s*(could you|can you|would you|will you|do you|did you|are you|is it|is there|have you)\b[^.!?\n]*(?=[.\n]|$)/gi;

/** The text with every link removed: a URL's "?" is never a question. */
export function withoutUrls(body: string): string {
  return body.replace(URL_PATTERN, " ");
}

/**
 * Counts the questions a message asks: every "?"-terminated sentence, plus
 * interrogative clauses written without one ("Could you tell me your postcode.").
 * Multiple "?" in one sentence ("Really??") count once.
 */
export function countQuestions(raw: string): number {
  // A link's query string ("...?client_reference_id=...") is not a question.
  const body = withoutUrls(raw);
  const marked = (body.match(/[^?]*\?+/g) ?? []).filter((part) => part.replace(/\?+/g, "").trim()).length;
  const unmarked = (body.match(INTERROGATIVE_CLAUSE) ?? []).length;
  return marked + unmarked;
}

/** The question sentences of a message: "?"-terminated, plus unmarked interrogative clauses. */
export function questionParts(raw: string): string[] {
  const body = withoutUrls(raw);
  const marked = (body.match(/[^.!?\n]*\?+/g) ?? []).map((part) => part.trim()).filter((part) => part.replace(/\?+/g, "").trim());
  const unmarked = (body.match(INTERROGATIVE_CLAUSE) ?? []).map((part) => part.replace(/^[.!\s]+/, "").trim());
  return [...marked, ...unmarked];
}

/** Lower-case words of a question, punctuation and apostrophes dropped. */
export function questionTokens(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9£\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Openers that do not change what a question asks ("Great, ...", "Thanks. ..."). */
const QUESTION_OPENERS = new Set(["great", "thanks", "thank", "you", "ok", "okay", "perfect", "lovely", "brilliant", "cheers", "sure", "so", "and", "also", "just", "quickly", "hi", "hello", "again"]);

function stripOpeners(tokens: string[]): string[] {
  let start = 0;
  while (start < tokens.length - 1 && QUESTION_OPENERS.has(tokens[start])) start += 1;
  return tokens.slice(start);
}

/** Near-duplicate thresholds: overlap of the smaller set, and Jaccard, over word sets. */
export const REPEAT_OVERLAP_MIN = 0.8;
export const REPEAT_JACCARD_MIN = 0.6;
const REPEAT_MIN_WORDS = 4;

/**
 * Whether the draft asks a question the business already asked in this
 * conversation: the same words once normalised (exact), or a high overlap of
 * words (near). `allowNearDuplicate` (a VERIFY of a stale fact) lets a
 * near-duplicate through, never an exact repeat. Pure; exported for tests.
 */
export function repeatedQuestion(
  body: string,
  priorOutbound: readonly string[],
  options: { allowNearDuplicate?: boolean } = {},
): { prior: string; draft: string; exact: boolean } | null {
  const priors = priorOutbound.flatMap(questionParts).map((q) => ({ q, tokens: stripOpeners(questionTokens(q)) }));
  if (priors.length === 0) return null;
  for (const draft of questionParts(body)) {
    const tokens = stripOpeners(questionTokens(draft));
    if (tokens.length === 0) continue;
    const draftSet = new Set(tokens);
    for (const prior of priors) {
      if (prior.tokens.length === 0) continue;
      if (prior.tokens.join(" ") === tokens.join(" ")) return { prior: prior.q, draft, exact: true };
      if (options.allowNearDuplicate) continue;
      const priorSet = new Set(prior.tokens);
      if (Math.min(priorSet.size, draftSet.size) < REPEAT_MIN_WORDS) continue;
      let shared = 0;
      for (const token of draftSet) if (priorSet.has(token)) shared += 1;
      const overlap = shared / Math.min(priorSet.size, draftSet.size);
      const jaccard = shared / (priorSet.size + draftSet.size - shared);
      if (overlap >= REPEAT_OVERLAP_MIN && jaccard >= REPEAT_JACCARD_MIN) return { prior: prior.q, draft, exact: false };
    }
  }
  return null;
}

function includesPhrase(haystack: string, phrase: string): boolean {
  const needle = phrase.trim().toLowerCase();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(haystack);
}

/**
 * The style and QA rules on their own, without the claim checks. Used by the
 * agent (inside validateResponse, so failures take the retry -> handover path)
 * and by the deterministic paths that restyle or personalise copy with AI
 * (restyleMessage, reactivation copy), which fall back to their template.
 */
export function lintStyle(
  body: string,
  options: {
    forbiddenPhrases?: string[];
    prohibitedClaims?: string[];
    /** For the human-style lint: chat channels get the list and sign-off rules. */
    channel?: string | null;
    leadFirstName?: string | null;
    priorOutbound?: readonly string[];
  } = {},
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const text = body.normalize("NFKC");

  const cliches = BANNED_CLICHES.filter((entry) => entry.pattern.test(text)).map((entry) => entry.phrase);
  if (cliches.length > 0) {
    failures.push({
      code: "STYLE_CLICHE",
      detail: `Used ${cliches.map((phrase) => `"${phrase}"`).join(", ")}.`,
      correction: `Do not use ${cliches.map((phrase) => `"${phrase}"`).join(", ")}. Write plainly, like one person replying to another.`,
    });
  }

  // No emojis, no em or en dashes used as dashes, and nothing else that
  // reads as automated (human-style.ts). A draft failing only these is
  // regenerated once, then repaired (compose-policy.ts).
  failures.push(
    ...humanStyleFailures(body, {
      channel: options.channel ?? null,
      leadFirstName: options.leadFirstName ?? null,
      priorOutbound: options.priorOutbound ?? [],
    }),
  );

  const justs = (text.match(/\bjust\b/gi) ?? []).length;
  if (justs > MAX_JUST) {
    failures.push({
      code: "STYLE_REPEATED_JUST",
      detail: `"just" used ${justs} times.`,
      correction: 'Remove the word "just".',
    });
  }

  const questions = countQuestions(text);
  if (questions > 1) {
    failures.push({
      code: "STYLE_MULTIPLE_QUESTIONS",
      detail: `${questions} questions in one message (max 1).`,
      correction: "Ask exactly one question. Drop the others.",
    });
  }

  const pressure = pressureIn(text);
  if (pressure.length > 0) {
    failures.push({
      code: "STYLE_PRESSURE",
      detail: `Used pressure language: ${pressure.join(", ")}.`,
      correction:
        "Remove every deadline, scarcity claim, 'act now' push, threat of loss and guilt framing. " +
        "State the next step plainly and let them decide in their own time.",
    });
  }

  const forbidden = (options.forbiddenPhrases ?? []).filter((phrase) => includesPhrase(text, phrase));
  if (forbidden.length > 0) {
    failures.push({
      code: "STYLE_FORBIDDEN_PHRASE",
      detail: `Used workspace-forbidden wording: ${forbidden.map((p) => `"${p}"`).join(", ")}.`,
      correction: `The business never uses ${forbidden.map((p) => `"${p}"`).join(", ")}. Rewrite without it.`,
    });
  }

  const prohibited = (options.prohibitedClaims ?? []).filter((claim) => includesPhrase(text, claim));
  if (prohibited.length > 0) {
    failures.push({
      code: "STYLE_PROHIBITED_CLAIM",
      detail: `Made a prohibited claim: ${prohibited.map((p) => `"${p}"`).join(", ")}.`,
      correction: `Never claim ${prohibited.map((p) => `"${p}"`).join(", ")}. Remove it.`,
    });
  }

  return failures;
}

/** Turns failures into the correction block appended to a single retry. */
export function correctionPrompt(failures: ValidationFailure[]): string {
  return [
    "Your previous draft was rejected. Fix every point below and rewrite it:",
    ...failures.map((failure, index) => `${index + 1}. ${failure.correction}`),
  ].join("\n");
}
