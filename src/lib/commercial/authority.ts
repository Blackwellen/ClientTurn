/**
 * Commercial authority: what the agent may do to close a sale (decision Q2,
 * Phase 3.2).
 *
 * Pure: zod and relative imports only, so the settings form, the agent and
 * the validator share one definition and tests/direct-close.test.ts asserts
 * every rule without a database.
 *
 * The whole model is a closed list. Direct close is OFF unless a workspace
 * enables it, and even then the agent may send only a checkout link the
 * workspace registered, with the price wording the workspace registered, and
 * no discount beyond an explicit maximum (default 0 = none). No Stripe
 * Connect: the links are the customer's own. The agent never says a purchase
 * happened -- completion is recorded when a CRM or webhook confirms it.
 */

import { z } from "zod";

export const CHECKOUT_LINKS_MAX = 25;

export const checkoutLinkSchema = z.object({
  /** Stable id the model refers to; never the URL. */
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "Use lower-case letters, numbers, - or _"),
  label: z.string().trim().min(1).max(80),
  product: z.string().trim().min(1).max(120),
  url: z
    .string()
    .trim()
    .max(2000)
    .url()
    .refine((value) => value.startsWith("https://"), "Checkout links must use https://"),
  /** Exactly the price wording the agent may repeat, e.g. "£49 per month". */
  price_text: z.string().trim().min(1).max(120),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Three-letter currency code, e.g. GBP"),
});
export type CheckoutLink = z.infer<typeof checkoutLinkSchema>;

export const commercialAuthoritySchema = z
  .object({
    enabled: z.boolean(),
    approved_checkout_links: z.array(checkoutLinkSchema).max(CHECKOUT_LINKS_MAX),
    max_discount_percent: z.number().min(0).max(100),
    requires_human_above_value_minor: z.number().int().min(0).nullable(),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.approved_checkout_links.forEach((link, index) => {
      if (ids.has(link.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["approved_checkout_links", index, "id"],
          message: "Each link needs a different id.",
        });
      }
      ids.add(link.id);
    });
    if (value.enabled && value.approved_checkout_links.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["approved_checkout_links"],
        message: "Add at least one approved checkout link before turning direct close on.",
      });
    }
  });
export type CommercialAuthority = z.infer<typeof commercialAuthoritySchema>;

export const DISABLED_AUTHORITY: CommercialAuthority = {
  enabled: false,
  approved_checkout_links: [],
  max_discount_percent: 0,
  requires_human_above_value_minor: null,
};

/**
 * A stored row, read defensively: any malformed link is dropped rather than
 * trusted, and a row that does not parse is treated as disabled.
 */
export function parseAuthority(row: unknown): CommercialAuthority {
  if (!row || typeof row !== "object") return DISABLED_AUTHORITY;
  const raw = row as Record<string, unknown>;
  const links = Array.isArray(raw.approved_checkout_links)
    ? raw.approved_checkout_links
        .map((link) => checkoutLinkSchema.safeParse(link))
        .filter((result) => result.success)
        .map((result) => result.data)
    : [];
  const maxDiscount = Number(raw.max_discount_percent ?? 0);
  const ceiling = raw.requires_human_above_value_minor;
  return {
    enabled: raw.enabled === true && links.length > 0,
    approved_checkout_links: links,
    max_discount_percent: Number.isFinite(maxDiscount) ? Math.min(100, Math.max(0, maxDiscount)) : 0,
    requires_human_above_value_minor:
      ceiling === null || ceiling === undefined || !Number.isFinite(Number(ceiling))
        ? null
        : Number(ceiling),
  };
}

/* --------------------------------------------------------------- the gate */

export type CheckoutGate =
  | { allowed: true; link: CheckoutLink }
  | {
      allowed: false;
      reason:
        | "DISABLED"
        | "MOTION_NOT_DIRECT"
        | "UNKNOWN_LINK"
        | "ABOVE_HUMAN_THRESHOLD"
        | "NOT_CONTACTABLE";
      detail: string;
    };

/**
 * Whether the agent may propose this checkout, decided before any text is
 * composed. Deterministic; the model's proposal is only the link id.
 */
export function checkoutGate(input: {
  authority: CommercialAuthority;
  motionAllowsDirectClose: boolean;
  linkId: string | null | undefined;
  /** The opportunity's value in minor units, when known. */
  opportunityValueMinor: number | null;
  contactable: boolean;
}): CheckoutGate {
  const { authority } = input;
  if (!authority.enabled) {
    return { allowed: false, reason: "DISABLED", detail: "Direct close is not enabled for this workspace." };
  }
  if (!input.motionAllowsDirectClose) {
    return {
      allowed: false,
      reason: "MOTION_NOT_DIRECT",
      detail: "This workspace's sales motion closes through a person, not a checkout link.",
    };
  }
  const link = authority.approved_checkout_links.find((candidate) => candidate.id === input.linkId);
  if (!link) {
    return { allowed: false, reason: "UNKNOWN_LINK", detail: "That checkout link is not on the approved list." };
  }
  if (
    authority.requires_human_above_value_minor != null &&
    input.opportunityValueMinor != null &&
    input.opportunityValueMinor > authority.requires_human_above_value_minor
  ) {
    return {
      allowed: false,
      reason: "ABOVE_HUMAN_THRESHOLD",
      detail: "The deal is above the value the workspace lets the assistant close alone.",
    };
  }
  if (!input.contactable) {
    return { allowed: false, reason: "NOT_CONTACTABLE", detail: "The lead cannot be messaged on this channel." };
  }
  return { allowed: true, link };
}

/* ------------------------------------------------------------ text checks */

const NUMBER_WORDS: Record<string, number> = {
  five: 5, ten: 10, fifteen: 15, twenty: 20, "twenty-five": 25, "twenty five": 25,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const DISCOUNT_WORD = /\b(?:off|discount(?:ed)?|reduction|reduced|saving|savings|save|knock(?:ed)?|cheaper|money\s+off)\b/i;

/**
 * Every discount the text offers, as a percentage.
 *
 *   "30% off", "30 percent off", "a discount of 30%", "30% discount",
 *   "thirty percent off"           -> 30
 *   "half price", "half off", "50/50 deal" style "half the price" -> 50
 *   "a discount" / "money off" with no figure -> Infinity (unquantified: never
 *   allowed, because no workspace approved an open-ended one)
 *
 * A percentage with no discount wording in the same sentence ("90% of our
 * clients") is not a discount and is ignored.
 */
export function discountOffers(text: string): number[] {
  const offers: number[] = [];
  const sentences = text.normalize("NFKC").split(/(?<=[.!?\n])\s+/);
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (/\bhalf[\s-]+(?:price|off|the\s+price|priced)\b/.test(lower)) offers.push(50);
    if (!DISCOUNT_WORD.test(lower)) continue;

    const percents: number[] = [];
    for (const match of lower.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|per\s?cent\b|pc\b)/g)) {
      percents.push(Number(match[1]));
    }
    for (const [word, value] of Object.entries(NUMBER_WORDS)) {
      if (new RegExp(`\\b${word}\\s+per\\s?cent\\b`).test(lower)) percents.push(value);
    }
    if (percents.length > 0) {
      offers.push(...percents);
    } else if (/\b(?:a|some|any|special|extra|further)\s+discount\b|\bdiscount(?:ed)?\s+(?:rate|price|deal)\b|\bmoney\s+off\b/.test(lower)) {
      offers.push(Number.POSITIVE_INFINITY);
    }
  }
  return offers;
}

/** The agent never says a purchase, order or payment happened. */
export const PURCHASE_CLAIM_PATTERN =
  /\b(?:(?:your|the)\s+(?:order|purchase|payment|subscription)\s+(?:is|has been|was)\s+(?:confirmed|complete|completed|received|processed|placed|active)|(?:you(?:'ve| have)|we(?:'ve| have))\s+(?:purchased|bought|paid|ordered|subscribed)|thanks?\s+(?:you\s+)?for\s+(?:your\s+)?(?:purchase|order|payment)|payment\s+(?:received|confirmed|successful)|you(?:'re| are)\s+(?:now\s+)?(?:signed\s+up|subscribed|a\s+customer))\b/i;

export function claimsPurchase(text: string): boolean {
  return PURCHASE_CLAIM_PATTERN.test(text.normalize("NFKC"));
}

/** Normalised URL for comparison, matching validate.ts's rule. */
export function normaliseCheckoutUrl(value: string): string {
  return value
    .trim()
    .replace(/[.,;:!?)\]]+$/, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * The approved link a message contains, if any. Used by the validator to tie
 * any price in the message to THAT link's price text.
 */
export function checkoutLinkIn(text: string, links: CheckoutLink[]): CheckoutLink | null {
  const urls = (text.match(/https?:\/\/[^\s<>"')]+/gi) ?? []).map(normaliseCheckoutUrl);
  return links.find((link) => urls.includes(normaliseCheckoutUrl(link.url))) ?? null;
}

/**
 * The message the agent sends with a checkout: the model's words, then the
 * approved URL appended by the runtime -- byte for byte the registered one --
 * exactly as the booking link is.
 */
export function checkoutMessage(body: string, link: CheckoutLink): string {
  const trimmed = body.trim();
  return trimmed.includes(link.url) ? trimmed : `${trimmed} ${link.url}`.trim();
}

/** Minor units from a value in major units (opportunities.value is major). */
export function toMinor(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 100);
}
