/**
 * The words that go to a stranger under the customer's own name.
 *
 * Pure -- no `server-only`, no Supabase, no model client -- for the same reason
 * `templates.ts` is pure. This module holds the fallback templates and, more
 * importantly, the guard that decides whether a model's output is allowed to
 * be used at all. That guard is the difference between "we asked the model not
 * to invent a price" and "a message containing a price cannot be sent", and it
 * is only worth anything if it can be exhaustively tested.
 *
 * ## Why a guard rather than a better prompt
 *
 * CLAUDE.md's resolved conflict #1 is explicit: AI may classify an inbound
 * message and extract a value for a configured question. It may never compose
 * a binding promise, quote, availability or service area. A cold opener is the
 * highest-risk copy the product generates -- it goes to somebody who has never
 * heard of the business, it is attributed to a named human being, and nobody
 * reads it before it goes in autonomous mode. So the model's output is treated
 * as a *proposal*, checked here, and discarded in favour of the deterministic
 * template if it fails. The template is never worse than nothing; an invented
 * price is much worse than a generic sentence.
 *
 * ## What is checked
 *
 *   1. **Length**, against the platform's own hard limit.
 *   2. **Commitments** -- money, timescales, guarantees, availability. These
 *      are the business's to state and never the model's.
 *   3. **Fabricated familiarity** -- a claimed prior conversation, referral or
 *      mutual connection. The most effective cold-outreach lie and the one a
 *      recipient is most likely to check.
 *   4. **Uncited facts** -- the same rule `research-policy.keepCitedClaims`
 *      applies to research summaries, applied to outbound copy: a message may
 *      only reference facts it was actually given.
 */

import { MAX_INVITE_NOTE_CHARS, MAX_SOCIAL_MESSAGE_CHARS } from "./social-limits.ts";
import type { SocialPlatform } from "./social-limits.ts";
import { renderTemplate, type ProspectMergeSource } from "./templates.ts";

export type SocialCopyKind =
  | "INVITE_NOTE"
  | "OPENER"
  | "FOLLOW_UP"
  /**
   * The one direct message Meta permits to somebody who commented on your
   * content but has never messaged you.
   *
   * Its own kind rather than a variant of OPENER, because the constraints are
   * different in a way the copy has to reflect: there is exactly one of these
   * and no follow-up will ever arrive, so it has to carry the whole ask. It is
   * also answering something the person actually said in public, which is a
   * far warmer starting point than a cold opener and reads as absurd if the
   * message ignores it.
   */
  | "PRIVATE_REPLY";

/** The platform's hard ceiling for this kind of message. */
export function maxCharsFor(kind: SocialCopyKind): number {
  if (kind === "INVITE_NOTE") return MAX_INVITE_NOTE_CHARS;
  // A private reply lands in Message Requests, read on a phone, from an account
  // the person has never spoken to. Meta would accept far more; this is the
  // length that gets read rather than the length that gets delivered.
  if (kind === "PRIVATE_REPLY") return MAX_PRIVATE_REPLY_CHARS;
  return MAX_SOCIAL_MESSAGE_CHARS;
}

/**
 * The practical ceiling on a private reply.
 *
 * Not a platform limit — Meta's is far higher. This is the length past which a
 * first message from a stranger reads as a sales blast, on a surface where the
 * recipient's only two options are to answer or to report it.
 */
export const MAX_PRIVATE_REPLY_CHARS = 480;

/* ------------------------------------------------------------- the guard */

/**
 * Phrases that turn a message into a commitment.
 *
 * Written as patterns rather than a word list because the failure is a
 * *claim*, not a vocabulary: "free" in "free to talk Thursday" is fine, and
 * "free quote" is not. Each entry names the promise it is stopping so a
 * rejection can say which rule fired rather than "failed validation".
 */
const COMMITMENT_PATTERNS: { pattern: RegExp; rule: string }[] = [
  {
    // Any currency amount at all. There is no legitimate reason for a cold
    // opener composed by a model to contain one.
    pattern: /(?:£|\$|€)\s?\d|\b\d+\s?(?:k|per cent|percent|%)\s*(?:off|discount|cheaper|less)\b/i,
    rule: "a price, discount or percentage",
  },
  {
    pattern: /\b(?:free|no[- ]obligation|complimentary)\s+(?:quote|survey|consultation|audit|trial|estimate)\b/i,
    rule: "a free-of-charge offer",
  },
  {
    // The modal is optional. "We guarantee more bookings" is exactly as binding
    // as "we can guarantee more bookings", and an earlier version of this
    // pattern required the modal and let the barer, stronger claim through --
    // which is the wrong way round.
    pattern: /\b(?:we|I)\s+(?:can|will|could|do\s+)?\s*(?:guarantee|promise|save you|halve|double|triple)\b/i,
    rule: "a guarantee or a promised outcome",
  },
  {
    pattern: /\b(?:guarantee[ds]?|money[- ]back|no win no fee|risk[- ]free)\b/i,
    rule: "a guarantee",
  },
  {
    // A percentage attached to an outcome, however the sentence is arranged.
    // The currency pattern above catches "£499"; this catches "40% more leads"
    // and "cut costs by 30%", which are quantified promises without a price.
    pattern: /\b\d+\s?(?:%|per ?cent)\b/i,
    rule: "a quantified claim",
  },
  {
    // Availability. The agent may only offer a slot the calendar returned, and
    // a composer has no calendar at all.
    pattern: /\b(?:I|we)\s*(?:'m|'re| am| are)?\s*(?:free|available|open)\s+(?:on\s+)?(?:mon|tue|wed|thu|fri|sat|sun|tomorrow|today|this week|next week)/i,
    rule: "a specific availability",
  },
  {
    pattern: /\b(?:within|in)\s+\d+\s*(?:hours?|days?|weeks?)\b/i,
    rule: "a promised timescale",
  },
  {
    pattern: /\b(?:same[- ]day|next[- ]day|24[- ]hour)\s+(?:service|response|turnaround|callback)\b/i,
    rule: "a promised turnaround",
  },
];

/**
 * Claims of a relationship that does not exist.
 *
 * A cold message asserting a prior conversation is not merely inaccurate: it is
 * the specific deception that makes recipients report an account, and it is
 * trivially disprovable by the person reading it.
 */
const FAMILIARITY_PATTERNS: { pattern: RegExp; rule: string }[] = [
  {
    pattern: /\b(?:as|since)\s+(?:we|you and I)\s+(?:discussed|spoke|agreed|mentioned)\b/i,
    rule: "a conversation that never happened",
  },
  {
    pattern: /\b(?:following up on|further to)\s+(?:our|your|the)\s+(?:call|chat|conversation|email|meeting|enquiry)\b/i,
    rule: "a prior contact that never happened",
  },
  {
    pattern: /\b(?:you\s+(?:asked|requested|enquired|signed up|got in touch))\b/i,
    rule: "an enquiry the recipient never made",
  },
  {
    pattern: /\b(?:our\s+mutual\s+(?:friend|connection|contact)|(?:was|were)\s+referred\s+(?:to\s+you\s+)?by)\b/i,
    rule: "a referral or mutual connection",
  },
  {
    pattern: /\b(?:we|I)\s+(?:have\s+)?(?:worked\s+with|helped)\s+you\b/i,
    rule: "past work for this recipient",
  },
];

export type CopyRejection = {
  /** Which check failed. Shown to an admin, logged against the message. */
  rule: string;
  /** The offending fragment, for the audit trail. Never shown to a prospect. */
  excerpt: string;
};

export type CopyCheckResult =
  | { ok: true; body: string }
  | { ok: false; rejections: CopyRejection[] };

/**
 * Whether a composed message may be used.
 *
 * `suppliedFacts` are the exact strings the composer was given. A message
 * claiming to have used a fact that was never supplied is rejected outright
 * rather than having the claim stripped -- unlike a research summary, where
 * claims are separable, a message is one piece of prose and there is no
 * sentence to remove without leaving a non-sequitur.
 */
export function checkComposedCopy(input: {
  body: string;
  usedFacts: string[];
  suppliedFacts: string[];
  kind: SocialCopyKind;
}): CopyCheckResult {
  const rejections: CopyRejection[] = [];
  const body = input.body.trim();

  if (!body) {
    return { ok: false, rejections: [{ rule: "an empty message", excerpt: "" }] };
  }

  const limit = maxCharsFor(input.kind);
  if (body.length > limit) {
    rejections.push({
      rule: `over the ${limit}-character limit for this kind of message`,
      excerpt: `${body.length} characters`,
    });
  }

  for (const { pattern, rule } of [...COMMITMENT_PATTERNS, ...FAMILIARITY_PATTERNS]) {
    const match = pattern.exec(body);
    if (match) rejections.push({ rule, excerpt: match[0] });
  }

  // The citation guard. Normalised the same way `research-policy` normalises
  // evidence refs, so a difference in casing or surrounding whitespace cannot
  // turn a real fact into a fabricated one.
  const supplied = new Set(input.suppliedFacts.map((fact) => fact.trim().toLowerCase()));
  for (const claimed of input.usedFacts) {
    const key = claimed.trim().toLowerCase();
    if (!key) continue;
    if (!supplied.has(key)) {
      rejections.push({
        rule: "a fact that was never supplied to it",
        excerpt: claimed.slice(0, 120),
      });
    }
  }

  return rejections.length === 0 ? { ok: true, body } : { ok: false, rejections };
}

/* ---------------------------------------------------------- the templates */

/**
 * The deterministic fallback for every message the sequencer sends.
 *
 * These are what goes out when AI is off, out of tokens, unavailable, or when
 * its output failed the guard above -- which means they are what a customer
 * actually receives most of the time, and they are written to be sent as-is
 * rather than as placeholders someone is expected to improve.
 *
 * They are deliberately plain. Every "I was really impressed by your profile"
 * opener reads as a template to the person receiving it, and a message that
 * admits what it is converts better than one pretending to be personal.
 */
const TEMPLATES: Record<SocialCopyKind, Record<"LINKEDIN" | "OTHER", string[]>> = {
  INVITE_NOTE: {
    LINKEDIN: [
      "Hi {{first_name}}, I work with {{company_type}} on {{service_line}}. Thought it might be worth being connected.",
    ],
    OTHER: [
      "Hi {{first_name}} — {{business_name}} here. Thought it was worth connecting.",
    ],
  },
  OPENER: {
    LINKEDIN: [
      "Thanks for connecting, {{first_name}}.\n\nI'll be straight with you — I got in touch because {{business_name}} works with {{company_type}} on {{service_line}}, and {{company_name}} looked like it might be relevant.\n\nIs that something you deal with, or is it someone else's patch?",
    ],
    OTHER: [
      "Thanks for the follow, {{first_name}}.\n\n{{business_name}} works with {{company_type}} on {{service_line}}, which is why I got in touch about {{company_name}}.\n\nIs that your area, or should I be speaking to someone else?",
    ],
  },
  /**
   * Answering a comment, not opening a cold conversation.
   *
   * The copy names what they did, because they did it in public and the message
   * is delivered as a reply to it — pretending otherwise is both dishonest and
   * confusing. It asks exactly one question, because there will be no second
   * message unless they answer this one.
   */
  PRIVATE_REPLY: {
    LINKEDIN: [
      "Thanks for the comment, {{first_name}} — replying here rather than in the thread.\n\n{{business_name}} works with {{company_type}} on {{service_line}}. Happy to answer anything about it.\n\nWas there something specific you wanted to know?",
    ],
    OTHER: [
      "Thanks for commenting, {{first_name}} — thought I'd reply directly rather than in the thread.\n\n{{business_name}} does {{service_line}}, so if that's what prompted it, ask away.\n\nWhat were you after?",
    ],
  },
  FOLLOW_UP: {
    LINKEDIN: [
      "Hi {{first_name}} — following up on my note above in case it got buried.\n\nIf {{service_line}} isn't something {{company_name}} is looking at, just say and I'll leave it there.",
      "Last one from me, {{first_name}}. I'll assume the timing isn't right and won't chase again.\n\nIf it becomes relevant later, my details are here.",
    ],
    OTHER: [
      "Hi {{first_name}} — just following up in case my message got buried.\n\nIf it isn't relevant, say so and I'll leave it there.",
      "Last one from me. I'll assume the timing isn't right and won't chase again.",
    ],
  },
};

export type SocialCopyContext = {
  prospect: ProspectMergeSource;
  businessName: string;
  /**
   * How the business describes who it works with, e.g. "letting agents".
   * Falls back to a phrase that still reads as a sentence, because "I work
   * with on roofing" is worse than a slightly vague opener.
   */
  companyType: string | null;
  /** What the business does, e.g. "roof repairs". */
  serviceLine: string | null;
};

/**
 * The template for one step, rendered.
 *
 * `step` selects which follow-up: the second one says it is the last, because
 * saying so and then meaning it is the single thing that stops a follow-up
 * sequence reading as harassment.
 */
export function renderSocialTemplate(input: {
  kind: SocialCopyKind;
  platform: SocialPlatform;
  /** 2 for the first follow-up, 3 for the second. Ignored for other kinds. */
  step: number;
  context: SocialCopyContext;
}): string {
  const family = input.platform === "LINKEDIN" ? "LINKEDIN" : "OTHER";
  const variants = TEMPLATES[input.kind][family];
  const index =
    input.kind === "FOLLOW_UP"
      ? Math.min(variants.length - 1, Math.max(0, input.step - 2))
      : 0;

  const values = {
    first_name: input.context.prospect.first_name?.trim() || "there",
    company_name: input.context.prospect.company?.name?.trim() || "your business",
    business_name: input.context.businessName,
    company_type: input.context.companyType?.trim() || "businesses like yours",
    service_line: input.context.serviceLine?.trim() || "the work we do",
  };

  const body = renderTemplate(variants[index], values);
  // Templates are authored inside the limit, but a long business name can push
  // one over it. Truncating at a word boundary beats a platform-side rejection.
  return truncateAtWord(body, maxCharsFor(input.kind));
}

/** Cuts to the last whole word inside the limit. Never mid-word, never mid-URL. */
export function truncateAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}
