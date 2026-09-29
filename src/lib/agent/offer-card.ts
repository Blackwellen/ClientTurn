/**
 * One voice profile and one offer card (design doc 04 §5, brief §§7–8).
 *
 * Four stores used to describe how a workspace sounds and what it sells, and
 * the agent read only one of them. This module merges them into a single
 * budgeted block that sits in the STABLE part of the prompt:
 *
 *   * voice: AI-settings tone and reply length, `business_profiles.outreach_*`
 *     (tone, CTA, things to avoid, claim restrictions), the default
 *     `business_playbooks` row (tone, prohibited claims) and the message
 *     signature;
 *   * offer: services with their PUBLISHED price wording only, the customer's
 *     value proposition, key messages and proof points, and business memory
 *     facts that are accepted or verified. Every fact carries its provenance.
 *
 * What never enters the card:
 *   * an unverified fact (AI- or website-sourced and not confirmed by a person);
 *   * a fact outside its validity window;
 *   * anything that looks like internal commercial data (price bands, costs,
 *     margins, deal values). A price reaches a prompt only as published wording.
 *
 * Budgeted: the card is kept under OFFER_CARD_TOKEN_BUDGET (chars / 4) by
 * dropping whole items, lowest priority first. Items are never cut mid-sentence,
 * because a truncated claim can say something different from the whole one.
 *
 * Pure: no server-only, no Supabase.
 */

export const OFFER_CARD_TOKEN_BUDGET = 600;

/** A text item longer than this keeps only its leading whole sentences. */
const ITEM_CHAR_CAP = 320;

/** Workspace phrases longer than this are instructions, not lintable phrases. */
const MAX_LINT_PHRASE_CHARS = 60;
const MIN_LINT_PHRASE_CHARS = 3;

/** Example messages are tone guides; this keeps one from eating the card. */
const EXAMPLE_CHAR_CAP = 240;
export const EXAMPLE_GOOD_SECTION =
  "STYLE EXAMPLES: SOUND LIKE THIS (tone and length only; these are not facts, never reuse their names, numbers, prices or claims)";
export const EXAMPLE_BAD_SECTION = "STYLE EXAMPLES: NEVER WRITE LIKE THIS";

/** Memory-fact confidence a customer-entered (USER) fact needs to be included. */
const MIN_USER_FACT_CONFIDENCE = 0.8;

export type MemoryFactRow = {
  key: string;
  value: unknown;
  /** USER | WEBSITE | INTEGRATION | PERFORMANCE | AI. Required: no provenance, no entry. */
  sourceType: string | null;
  confidence: number | null;
  verifiedByUser: boolean;
  locked: boolean;
  validFrom?: string | null;
  validTo?: string | null;
};

export type OfferServiceInput = {
  name: string;
  description: string | null;
  /** Only ever set for PUBLIC_FIXED / PUBLIC_FROM services. */
  publicPriceText: string | null;
};

export type OfferCardInput = {
  businessName: string;
  businessDescription: string | null;
  aiTone: string;
  replyLength: string;
  outreach: {
    tone: string | null;
    valueProposition: string | null;
    keyMessages: string | null;
    proofPoints: string | null;
    avoid: string | null;
    callToAction: string | null;
    claimRestrictions: string | null;
  };
  playbook: { tone: string | null; prohibitedClaims: unknown } | null;
  signature: string | null;
  services: OfferServiceInput[];
  facts: MemoryFactRow[];
  now: Date;
  tokenBudget?: number;
  /**
   * The workspace's example messages (Settings -> AI & selling). Rendered as
   * tone examples, explicitly not facts, and dropped first under the budget.
   */
  examples?: { good: readonly string[]; bad: readonly string[] };
  /**
   * Reassurance the business entered and stands behind (Settings -> AI &
   * selling -> Objections): SLAs, guarantees, case studies, testimonials it
   * owns, response-time commitments. Approved claims: quoted as written.
   */
  reassurance?: readonly string[];
  /**
   * Commercial rules (0174). The agent's target: when it sells only some of
   * the catalogue, `services` above is already filtered to it and this line
   * says so. Null or absent = the whole catalogue.
   */
  targetNote?: string | null;
  /**
   * The deterministic best fit for this lead (commercial/best-fit.ts
   * renderRecommendation): an offer name and reason codes, never a price.
   * Lead-specific, so it renders after every stable section.
   */
  recommendation?: string | null;
  /**
   * Approved points and never-say lines for the competitors THIS lead
   * mentioned (sales-library/competitors.ts), detected by name. Lead-specific.
   */
  competitors?: { approved: readonly string[]; neverSay: readonly string[] };
};

export type VoiceProfile = {
  tone: string;
  replyLength: string;
  styleNotes: string[];
  callToAction: string | null;
  signature: string | null;
  /** Lint-sized phrases the workspace said never to use. */
  forbiddenPhrases: string[];
  /** Lint-sized claims the workspace prohibits. */
  prohibitedClaims: string[];
  /** Longer avoid / restriction instructions: prompt-only, not lintable. */
  restrictions: string[];
};

export type OfferCard = {
  text: string;
  tokens: number;
  budget: number;
  /** Items dropped to meet the budget, in the order they were dropped. */
  dropped: string[];
  /** Fact keys that made it into the card. */
  includedFactKeys: string[];
  /** Fact keys refused, with why. */
  excludedFacts: { key: string; reason: "UNVERIFIED" | "NO_PROVENANCE" | "EXPIRED" | "INTERNAL_COMMERCIAL" | "EMPTY" }[];
  /** True when at least one approved claim or proof point is present. */
  hasApprovedClaims: boolean;
  voice: VoiceProfile;
};

/** chars/4, rounded up: the same estimate the billing gate uses for context. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------- helpers

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Splits a free-text list (newlines, bullets, semicolons) into items. */
export function splitList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n|;|•|•/)
    // Only a list marker ("- ", "* ", "1. ", "2) ") is stripped. ICP evaluation
    // 2026-09-29: the old /^[-*\d.)]+/ also ate a leading figure, so the
    // approved claim "10-year workmanship guarantee" reached the card as
    // "year workmanship guarantee" and "14-day free trial" as "day free trial".
    .map((item) => item.replace(/^\s*(?:[-*•]\s+|\d{1,2}[.)]\s+)/, "").trim())
    .filter(Boolean);
}

export function jsonStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      if (entry && typeof entry === "object") {
        const text = (entry as { text?: unknown; claim?: unknown; value?: unknown }).text ??
          (entry as { claim?: unknown }).claim ??
          (entry as { value?: unknown }).value;
        return typeof text === "string" ? [text] : [];
      }
      return [];
    });
  }
  if (typeof value === "string") return splitList(value);
  if (value && typeof value === "object" && "items" in value) {
    return jsonStrings((value as { items: unknown }).items);
  }
  return [];
}

/**
 * The card's sections whose items the business stands behind: what a reply
 * may state as fact. Never the NEVER CLAIM / NEVER SAY / RESTRICTIONS items,
 * the voice lines or the style examples.
 */
export const APPROVED_CARD_SECTIONS: readonly string[] = [
  "APPROVED CLAIMS",
  "PUBLISHED PRICES (quote verbatim, nothing else)",
  "VALUE PROPOSITION",
  "KEY MESSAGES",
  "WHAT THEY SELL",
  "WHO FOR",
  "DIFFERENTIATORS",
  "FAQS",
];

/**
 * The approved lines of a rendered card (buildOfferCard's text), for the
 * validator's credential check (validate.ts approvedClaims): a guarantee,
 * certification, integration or "free" offer in a reply must be one of these.
 */
export function approvedCardLines(cardText: string): string[] {
  const out: string[] = [];
  let section: string | null = null;
  for (const raw of cardText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("- ")) {
      if (section && APPROVED_CARD_SECTIONS.includes(section)) out.push(line.slice(2).trim());
      continue;
    }
    section = line;
  }
  return out;
}

/** Keeps whole leading sentences up to the cap; null when even one is too long. */
export function capSentences(text: string, cap = ITEM_CHAR_CAP): string | null {
  const value = clean(text);
  if (value.length <= cap) return value || null;
  const sentences = value.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = "";
  for (const sentence of sentences) {
    if ((out + sentence).trim().length > cap) break;
    out += sentence;
  }
  return out.trim() || null;
}

function uniqueCaseless(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const INTERNAL_COMMERCIAL_KEY =
  /(price|pricing|cost|fee|rate|budget|margin|revenue|deal_value|average_value|discount|commission)/i;

type FactSection = "WHO_FOR" | "DIFFERENTIATORS" | "CLAIMS" | "FAQ" | "SELLS" | "OTHER";

function sectionForKey(key: string): FactSection {
  const k = key.toLowerCase();
  if (/(target|icp|customer|audience|who_for|industr)/.test(k)) return "WHO_FOR";
  if (/(differentiat|usp|why_us|unique|strength)/.test(k)) return "DIFFERENTIATORS";
  if (/(claim|proof|accredit|award|certif|case_stud|testimonial|result)/.test(k)) return "CLAIMS";
  if (/faq|question/.test(k)) return "FAQ";
  if (/(service|product|offer|sell)/.test(k)) return "SELLS";
  return "OTHER";
}

function factText(value: unknown): string {
  const list = jsonStrings(value);
  if (list.length > 0) return list.join(", ");
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const text = (value as { text?: unknown; value?: unknown }).text ?? (value as { value?: unknown }).value;
    if (typeof text === "string" || typeof text === "number") return String(text);
  }
  return "";
}

/**
 * Accepted = a person verified or locked it, or the customer entered it
 * themselves with confidence at least 0.8. AI, website, integration and
 * performance facts need a person's verification first.
 */
function screenFact(
  fact: MemoryFactRow,
  now: Date,
): OfferCard["excludedFacts"][number]["reason"] | null {
  if (!fact.sourceType) return "NO_PROVENANCE";
  if (INTERNAL_COMMERCIAL_KEY.test(fact.key)) return "INTERNAL_COMMERCIAL";
  if (fact.validFrom && Date.parse(fact.validFrom) > now.getTime()) return "EXPIRED";
  if (fact.validTo && Date.parse(fact.validTo) < now.getTime()) return "EXPIRED";
  const personConfirmed = fact.verifiedByUser || fact.locked;
  const customerEntered =
    fact.sourceType === "USER" && (fact.confidence ?? 1) >= MIN_USER_FACT_CONFIDENCE;
  if (!personConfirmed && !customerEntered) return "UNVERIFIED";
  if (!clean(factText(fact.value))) return "EMPTY";
  return null;
}

function provenance(fact: MemoryFactRow): string {
  return fact.verifiedByUser || fact.locked ? "verified" : "entered by the business";
}

function humaniseKey(key: string): string {
  return key.split(".").pop()!.replace(/_/g, " ");
}

/** Splits workspace text into lint-sized phrases and prompt-only instructions. */
function partitionPhrases(values: string[]): { phrases: string[]; instructions: string[] } {
  const phrases: string[] = [];
  const instructions: string[] = [];
  for (const raw of values) {
    const value = clean(raw).replace(/^["'“‘]|["'”’]$/g, "");
    if (value.length < MIN_LINT_PHRASE_CHARS) continue;
    if (value.length <= MAX_LINT_PHRASE_CHARS) phrases.push(value);
    else instructions.push(value);
  }
  return { phrases: uniqueCaseless(phrases), instructions: uniqueCaseless(instructions) };
}

// ------------------------------------------------------------------ voice

export function buildVoiceProfile(input: OfferCardInput): VoiceProfile {
  const avoid = partitionPhrases(splitList(input.outreach.avoid));
  const prohibited = partitionPhrases(jsonStrings(input.playbook?.prohibitedClaims));
  const restrictions = splitList(input.outreach.claimRestrictions).map(clean).filter(Boolean);

  return {
    tone: input.aiTone,
    replyLength: input.replyLength,
    styleNotes: uniqueCaseless(
      [clean(input.outreach.tone), clean(input.playbook?.tone)].filter(Boolean),
    ),
    callToAction: clean(input.outreach.callToAction) || null,
    signature: clean(input.signature) || null,
    forbiddenPhrases: avoid.phrases,
    prohibitedClaims: prohibited.phrases,
    restrictions: uniqueCaseless([...avoid.instructions, ...prohibited.instructions, ...restrictions]),
  };
}

// ------------------------------------------------------------------- card

/**
 * `volatile` items are lead-specific (recommended fit, competitor points).
 * They render after every stable section, so the card's prefix stays the same
 * across the workspace's leads and the provider can still cache it.
 */
type Item = { id: string; section: string; line: string; priority: number; volatile?: boolean };

export const RECOMMENDED_FIT_SECTION = "RECOMMENDED FIT (decided by rules, not by you)";
export const COMPETITOR_SECTION = "COMPETITOR POINTS (approved: word for word or not at all, only if they raise it)";
export const COMPETITOR_NEVER_SECTION = "NEVER SAY ABOUT COMPETITORS";

/**
 * Builds the card. Deterministic: same input, same bytes, which is what lets
 * the provider cache the prefix it sits in.
 */
export function buildOfferCard(input: OfferCardInput): OfferCard {
  const budget = input.tokenBudget ?? OFFER_CARD_TOKEN_BUDGET;
  const voice = buildVoiceProfile(input);
  const items: Item[] = [];
  const push = (id: string, section: string, text: string | null, priority: number, volatile = false) => {
    const line = text ? capSentences(text) : null;
    if (line) items.push({ id, section, line, priority, ...(volatile ? { volatile } : {}) });
  };

  // Priority 0: dropped only if nothing else is left to drop. The rules of
  // what may not be said.
  voice.prohibitedClaims.forEach((claim, i) => push(`prohibited:${i}`, "NEVER CLAIM", claim, 0));
  voice.forbiddenPhrases.forEach((phrase, i) => push(`avoid:${i}`, "NEVER SAY", phrase, 0));
  voice.restrictions.forEach((rule, i) => push(`restriction:${i}`, "RESTRICTIONS", rule, 0));

  // Priority 1: voice.
  push("voice:tone", "VOICE", `Tone: ${voice.tone}. Reply length: ${voice.replyLength}.`, 1);
  // How to sound (elite-closer brief): the business's best salesperson
  // messaging a prospect, not a chatbot. The detailed rules are in the
  // static prompt and enforced by human-style.ts; this line ties them to the
  // workspace's own voice.
  push("voice:human", "VOICE", `Sound like ${clean(input.businessName) || "the business"}'s best salesperson messaging a prospect: mirror their length and register, plain words.`, 1);
  voice.styleNotes.forEach((note, i) => push(`voice:style:${i}`, "VOICE", `Style: ${note}`, 1));
  push("voice:cta", "VOICE", voice.callToAction ? `Preferred call to action: ${voice.callToAction}` : null, 1);
  push("voice:signature", "VOICE", voice.signature ? `Sign-off (email only): ${voice.signature}` : null, 1);

  // The agent's target (0174): the services below are already only these.
  push("scope", "SCOPE", input.targetNote ?? null, 1);

  // Priority 2: what they sell, with published prices only.
  const priced = input.services.filter((service) => clean(service.publicPriceText));
  input.services.forEach((service, i) => {
    const description = clean(service.description);
    push(
      `service:${i}`,
      "WHAT THEY SELL",
      description ? `${service.name}: ${description}` : service.name,
      2,
    );
  });
  priced.forEach((service, i) =>
    push(`price:${i}`, "PUBLISHED PRICES (quote verbatim, nothing else)", `${service.name}: ${clean(service.publicPriceText)}`, 2),
  );

  // Priority 3: the customer's own positioning.
  push("value", "VALUE PROPOSITION", input.outreach.valueProposition, 3);
  splitList(input.outreach.keyMessages).forEach((message, i) => push(`key:${i}`, "KEY MESSAGES", message, 3));

  // Priority 4: approved claims (customer-written proof points).
  const proof = splitList(input.outreach.proofPoints);
  proof.forEach((point, i) => push(`proof:${i}`, "APPROVED CLAIMS", point, 4));
  (input.reassurance ?? []).forEach((line, i) => push(`reassurance:${i}`, "APPROVED CLAIMS", line, 4));

  // Priority 4-6: memory facts, accepted/verified only, with provenance.
  const excludedFacts: OfferCard["excludedFacts"] = [];
  const includedFactKeys: string[] = [];
  const sectionLabel: Record<FactSection, { label: string; priority: number }> = {
    SELLS: { label: "WHAT THEY SELL", priority: 4 },
    CLAIMS: { label: "APPROVED CLAIMS", priority: 4 },
    WHO_FOR: { label: "WHO FOR", priority: 5 },
    DIFFERENTIATORS: { label: "DIFFERENTIATORS", priority: 5 },
    FAQ: { label: "FAQS", priority: 6 },
    OTHER: { label: "OTHER FACTS", priority: 6 },
  };
  const facts = input.facts.slice().sort((a, b) => a.key.localeCompare(b.key));
  for (const fact of facts) {
    const reason = screenFact(fact, input.now);
    if (reason) {
      excludedFacts.push({ key: fact.key, reason });
      continue;
    }
    const section = sectionForKey(fact.key);
    const { label, priority } = sectionLabel[section];
    const text = `${humaniseKey(fact.key)}: ${clean(factText(fact.value))} (${provenance(fact)})`;
    const before = items.length;
    push(`fact:${fact.key}`, label, text, priority);
    if (items.length > before) includedFactKeys.push(fact.key);
  }

  // Priority 7-8: style examples. Lowest priority of all, so they never push
  // out a fact or a rule. Each is capped to whole sentences, and the section
  // heading says what they are: how to sound, never something to state.
  (input.examples?.good ?? []).forEach((example, i) =>
    push(`example:good:${i}`, EXAMPLE_GOOD_SECTION, capSentences(clean(example), EXAMPLE_CHAR_CAP), 7),
  );
  (input.examples?.bad ?? []).forEach((example, i) =>
    push(`example:bad:${i}`, EXAMPLE_BAD_SECTION, capSentences(clean(example), EXAMPLE_CHAR_CAP), 8),
  );

  // Lead-specific, rendered last (volatile). Competitor rules are priority 0
  // like every never-say rule; the approved points and the recommended fit
  // sit with what the business sells.
  const competitors = input.competitors ?? { approved: [], neverSay: [] };
  if (competitors.approved.length + competitors.neverSay.length > 0) {
    push(
      "competitor:rule",
      COMPETITOR_NEVER_SECTION,
      "Never criticise a competitor or say anything about one beyond the approved points.",
      0,
      true,
    );
  }
  competitors.neverSay.forEach((line, i) => push(`competitor:never:${i}`, COMPETITOR_NEVER_SECTION, line, 0, true));
  competitors.approved.forEach((line, i) => push(`competitor:point:${i}`, COMPETITOR_SECTION, line, 2, true));
  push("fit", RECOMMENDED_FIT_SECTION, input.recommendation ?? null, 2, true);

  // ---- budget: drop whole items, lowest priority (highest number) first,
  // later items before earlier ones within a priority.
  const header = [
    "OFFER CARD AND VOICE",
    `Business: ${input.businessName}`,
    clean(input.businessDescription) ? `About: ${capSentences(input.businessDescription!) ?? ""}` : null,
    "Use only what is written here. Anything not listed is unknown: do not state it.",
  ]
    .filter(Boolean)
    .join("\n");

  const render = (kept: Item[]): string => {
    const group = (list: Item[]) => {
      const sections = new Map<string, string[]>();
      for (const item of list) {
        const lines = sections.get(item.section) ?? [];
        lines.push(`- ${item.line}`);
        sections.set(item.section, lines);
      }
      return [...sections.entries()].map(([section, lines]) => `${section}\n${lines.join("\n")}`);
    };
    const body = group(kept.filter((item) => !item.volatile));
    if (priced.length === 0) {
      body.push("PUBLISHED PRICES\n- None. Do not state any price, in digits or words.");
    }
    body.push(...group(kept.filter((item) => item.volatile)));
    return [header, ...body].join("\n\n");
  };

  let kept = items.slice();
  const dropped: string[] = [];
  let text = render(kept);
  while (estimateTokens(text) > budget) {
    let victim = -1;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].priority === 0) continue;
      if (victim === -1 || kept[i].priority > kept[victim].priority) victim = i;
    }
    // Only the never-say rules remain and they still do not fit: the budget is
    // a hard ceiling, so the last ones go too. The lint still enforces every
    // forbidden phrase and prohibited claim on the reply itself.
    if (victim === -1) victim = kept.length - 1;
    if (victim < 0) break;
    dropped.push(kept[victim].id);
    kept = kept.filter((_, i) => i !== victim);
    text = render(kept);
  }

  const keptIds = new Set(kept.map((item) => item.id));
  return {
    text,
    tokens: estimateTokens(text),
    budget,
    dropped,
    includedFactKeys: includedFactKeys.filter((key) => keptIds.has(`fact:${key}`)),
    excludedFacts,
    hasApprovedClaims: kept.some((item) => item.section === "APPROVED CLAIMS"),
    voice,
  };
}
