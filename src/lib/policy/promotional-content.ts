/**
 * Does this message market something?
 *
 * Used where the policy engine returns `NON_PROMOTIONAL_ONLY`: an individual
 * subscriber who accepted a connection or follow may be spoken to, but not
 * marketed to, until they reply (docs/revenue-engine/00 §6.1).
 *
 * Deterministic on purpose. A model deciding whether its own draft counts as
 * marketing is the wrong party to ask. The test is deliberately broad: a false
 * positive costs one draft that goes to a person instead of out; a false
 * negative is an unlawful message. Pure — no I/O — so it is unit-testable.
 *
 * What counts, following the ICO's reading of "direct marketing" (promoting the
 * aims, goods or services of the sender):
 *   * a price, discount, offer or trial;
 *   * a link or call to action to book, buy, sign up or check out;
 *   * a pitch for the sender's services ("we help…", "our service…").
 * A thank-you, a question about *their* work, or a reply to what they said is
 * not marketing.
 */

export type PromotionalFinding = {
  code: "PRICE" | "OFFER" | "BOOKING_CTA" | "PURCHASE_CTA" | "LINK" | "PITCH";
  match: string;
};

const RULES: { code: PromotionalFinding["code"]; pattern: RegExp }[] = [
  { code: "PRICE", pattern: /[£$€]\s?\d|\b\d+(?:\.\d{2})?\s?(?:gbp|usd|eur|pounds?|dollars?)\b|\bper (?:month|year|user|seat)\b/i },
  {
    code: "OFFER",
    pattern:
      /\b(?:discount|special offer|limited[- ]time|free trial|trial|promo(?:tion)?|% off|coupon|voucher|deal)\b/i,
  },
  {
    code: "BOOKING_CTA",
    pattern:
      /\b(?:book (?:a|an|in|your)|schedule (?:a|an)|grab (?:a|some) time|hop on a call|jump on a call|quick call|15[- ]min(?:ute)?s?|30[- ]min(?:ute)?s?|demo|calendly|free consultation|discovery call)\b/i,
  },
  {
    code: "PURCHASE_CTA",
    pattern: /\b(?:buy now|sign up|signup|subscribe (?:now|today)|check ?out|get started|order now|start your)\b/i,
  },
  { code: "LINK", pattern: /\bhttps?:\/\/\S+|\bwww\.\S+/i },
  {
    code: "PITCH",
    pattern:
      /\b(?:we help|we work with|works with|we offer|we provide|we specialise|we specialize|happy to answer anything about|our (?:service|services|product|platform|solution|agency|team can)|i help (?:businesses|companies|agencies|brands)|would you be interested in|are you open to|let me show you)\b/i,
  },
];

export function promotionalFindings(text: string): PromotionalFinding[] {
  const findings: PromotionalFinding[] = [];
  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (match) findings.push({ code: rule.code, match: match[0] });
  }
  return findings;
}

export function isPromotional(text: string): boolean {
  return promotionalFindings(text).length > 0;
}

/** Instruction appended to a generation prompt when only conversation is allowed. */
export const NON_PROMOTIONAL_INSTRUCTION =
  "This person has not asked to hear about our services. Write a short, genuine, non-promotional message: thank them or ask one relevant question about their work. Do not mention our services, prices, offers, links, demos, calls or bookings.";
