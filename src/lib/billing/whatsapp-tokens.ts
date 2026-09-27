/**
 * WhatsApp tokens: how the WhatsApp add-on is bought and metered.
 *
 * Owner decisions (2026-09-27):
 *  - "We must be competitive with WhatsApp specialists." WhatsApp is the one
 *    purchase allowed below the 75% rule (plans, SMS packs and AI token packs
 *    keep it). Owner target (todo.md §4): about 50% -- about 10p a marketing
 *    message and 4p a reply or utility template -- with a hard floor of cost +
 *    25% (docs/economics.md §5.4 and §10.3). At 2p a token that is ~39-42%
 *    after Stripe on the Twilio route, ~47-54% on a workspace's own Meta number.
 *  - WhatsApp is bought as TOKENS, non-monetary units like AI tokens, never as
 *    a £ balance. Tokens have no cash value, cannot be exchanged or
 *    transferred, never expire, and are non-refundable once any are used.
 *
 * Each sent WhatsApp message spends a whole number of tokens by its category:
 *
 *   service (free-form reply inside the 24h window)  2 tokens (4p)
 *   utility template                                  2 tokens (4p)
 *   authentication template (not used; Meta prices it as utility)  2 tokens (4p)
 *   marketing template                                5 tokens (10p)
 *   a template with an unrecognised category          5 tokens (marketing: the safe direction)
 *
 * A token sells for 2p in every pack.
 *
 * Pure: no `server-only`, no Supabase, relative imports with `.ts`, so the
 * pricing page, the send gate, the admin model and the tests agree.
 */

import { normaliseCategory } from "../messaging/whatsapp-templates.ts";

export type WhatsappBillingCategory = "SERVICE" | "UTILITY" | "AUTHENTICATION" | "MARKETING";

/** Tokens one outbound WhatsApp message spends, by category. */
export const WHATSAPP_TOKENS_PER_MESSAGE: Record<WhatsappBillingCategory, number> = {
  SERVICE: 2,
  UTILITY: 2,
  AUTHENTICATION: 2,
  MARKETING: 5,
};

/**
 * The WhatsApp token packs (plans.ts builds the `whatsapp_tokens_*` bundles
 * from these). Every pack is the same rate per token, so a customer never has
 * to buy the biggest pack for a fair price. Inline Stripe prices at Checkout.
 */
export const WHATSAPP_TOKEN_PACKS = [
  { tokens: 1000, priceGbp: 20 },
  { tokens: 2000, priceGbp: 40 },
  { tokens: 5000, priceGbp: 100 },
] as const;

/**
 * Migration 0148: one pre-token WhatsApp message credit (bought at 27p, any
 * category) became this many tokens, ceil(27p / the 2p a token sells for) =
 * 14, so no customer lost value: 14 tokens (28p) is 7 replies or 2.8 marketing
 * messages where the old credit was one message of either.
 */
export const LEGACY_WHATSAPP_CREDIT_PRICE_PENCE = 27;
export const WHATSAPP_TOKEN_PACK_PENCE_PER_TOKEN =
  (WHATSAPP_TOKEN_PACKS[0].priceGbp * 100) / WHATSAPP_TOKEN_PACKS[0].tokens;
export const TOKENS_PER_LEGACY_WHATSAPP_CREDIT = Math.ceil(
  LEGACY_WHATSAPP_CREDIT_PRICE_PENCE / WHATSAPP_TOKEN_PACK_PENCE_PER_TOKEN,
);

/** Old message credits -> tokens (the 0147 conversion, in TypeScript). */
export function legacyWhatsappCreditsToTokens(credits: number): number {
  return Math.max(0, Math.floor(credits)) * TOKENS_PER_LEGACY_WHATSAPP_CREDIT;
}

/**
 * The category a WhatsApp send is billed as. No template means a free-form
 * message, which WhatsApp only allows inside the 24h customer-service window:
 * a SERVICE message. A template is billed at its category, and a category
 * that is missing or unrecognised is billed as MARKETING (`normaliseCategory`),
 * never as the cheaper one.
 */
export function whatsappBillingCategory(input: {
  /** True when the message goes out as an approved template. */
  template: boolean;
  /** The template's category as stored or reported, if any. */
  templateCategory?: unknown;
}): WhatsappBillingCategory {
  if (!input.template) return "SERVICE";
  return normaliseCategory(input.templateCategory);
}

/** Tokens one message of this category spends. */
export function whatsappTokensFor(category: WhatsappBillingCategory): number {
  return WHATSAPP_TOKENS_PER_MESSAGE[category] ?? WHATSAPP_TOKENS_PER_MESSAGE.MARKETING;
}

/** Roughly what a number of tokens covers, for pack labels and alerts. */
export function whatsappTokenCoverage(tokens: number): { replies: number; marketing: number } {
  const whole = Math.max(0, Math.floor(tokens));
  return {
    replies: Math.floor(whole / WHATSAPP_TOKENS_PER_MESSAGE.SERVICE),
    marketing: Math.floor(whole / WHATSAPP_TOKENS_PER_MESSAGE.MARKETING),
  };
}

const NUMBER = new Intl.NumberFormat("en-GB");

/** "about 500 conversation replies or 200 marketing messages" */
export function whatsappCoverageText(tokens: number): string {
  const { replies, marketing } = whatsappTokenCoverage(tokens);
  return `about ${NUMBER.format(replies)} conversation ${replies === 1 ? "reply" : "replies"} or ${NUMBER.format(marketing)} marketing ${marketing === 1 ? "message" : "messages"}`;
}

/** The one statement of what a WhatsApp token is, shown wherever packs are sold. */
export const WHATSAPP_TOKEN_NATURE =
  "WhatsApp tokens have no cash value and cannot be exchanged or transferred. They never expire, and a pack is non-refundable once any of its tokens are used.";

/** The per-category rate card, in words, for pricing and billing copy. */
export const WHATSAPP_TOKEN_RATE_TEXT = `A conversation reply or utility template uses ${WHATSAPP_TOKENS_PER_MESSAGE.SERVICE} tokens; a marketing template uses ${WHATSAPP_TOKENS_PER_MESSAGE.MARKETING}.`;
