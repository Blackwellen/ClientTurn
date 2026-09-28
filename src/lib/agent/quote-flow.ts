/**
 * The quote path inside a conversation (brief §7, §13-14, §72-74). Pure.
 *
 * A lead who asks for a quote or a price for something in the workspace's
 * catalogue is taken down one path: REQUEST_QUOTE -> collect the inputs the
 * price needs -> draft -> approval or send. Every decision on that path is
 * made here, deterministically; the model only words the one message of the
 * turn, and may state only the figures `calculate_quote` returned
 * (`quoteFigures`, checked by validate.ts).
 *
 *   detect      `detectQuoteRequest`, `detectQuoteQuestion`, price objection
 *   items       `matchCatalogueItems`: catalogue items the lead's words or
 *               the turn's interest name (never an item they did not ask for)
 *   inputs      `readQuoteInputs` / `missingQuoteInputs`: quantity, options
 *               and timing. A known fact (QIE, CONFIRMED or INFERRED) or
 *               something the lead already wrote is never asked again; each
 *               input is asked at most twice, one question per turn.
 *   plan        `planQuoteStep`: one step per turn (collect, draft, answer
 *               from the quote, discount, awaiting approval, next step).
 *   gate        `quoteToolGate`: AI on, `quote_ai_enabled` (can()), and the
 *               workspace's per-capability AI permission (§74).
 *   discount    `planConcession`: what to propose, decided by
 *               `evaluateDiscount` (quotes/discount-policy.ts).
 *   figures     `quoteFigures` + `quoteStrategyLines`: the verbatim figures,
 *               the only ones the model may state this turn.
 *
 * Relative imports only (node --test loads it directly).
 */

import type { CatalogueItem } from "../catalogue/types.ts";
import type { QuoteCalculation, QuoteLineInput } from "../quotes/types.ts";

/**
 * A calculation as the assistant may hold it: the quote core presents it
 * without cost or margin to anyone but an owner or admin (presentCalculation),
 * so the margin may be absent. The margin floor is then applied by the quote
 * core, which holds the full calculation.
 */
export type QuoteCalculationView = Omit<QuoteCalculation, "margin"> & { margin: QuoteCalculation["margin"] | null };
import { formatBps, formatMinor, mulDivFloor, ratioBps } from "../quotes/money.ts";
import { aiMay, type AiAuthority } from "../commercial/ai-permissions.ts";
import { evaluateDiscount, type DiscountDecision, type DiscountPolicy } from "../quotes/discount-policy.ts";

/* =============================================================== detection */

const QUOTE_REQUEST: RegExp[] = [
  /\b(?:a|the|your|us a|me a|send (?:me|us)(?: over)? a|get a|need a|want a|like a|put together a)\s+(?:rough\s+|ballpark\s+|firm\s+|formal\s+|written\s+)?(?:quote|quotation|estimate|price|proposal)\b/i,
  /\bquote (?:for|on|me|us)\b/i,
  /\bhow much (?:is|are|would|will|does|do|for|to|it|would it|does it)\b/i,
  /\bhow much\b.*\?/i,
  /\bwhat(?:'s| is| are| would| will)(?: be)? (?:the |your )?(?:price|prices|cost|costs|pricing|fee|fees|rate|rates)\b/i,
  /\b(?:price|pricing|cost) (?:for|of)\b/i,
  /\bwhat (?:would|will|does) (?:it|that|this) cost\b/i,
];

const NOT_A_REQUEST = /\b(?:no|don'?t need a|do not need a|not after a|not looking for a)\s+(?:quote|price|estimate)\b/i;

/** The lead asks for a quote or a price. */
export function detectQuoteRequest(text: string | null | undefined): boolean {
  const value = normalise(text);
  if (!value || NOT_A_REQUEST.test(value)) return false;
  return QUOTE_REQUEST.some((pattern) => pattern.test(value));
}

const QUOTE_QUESTION: RegExp[] = [
  /\b(?:the|your|this|that|my|our) (?:quote|quotation|proposal|estimate)\b/i,
  /\b(?:include|includes|included|including)\b.*\?/i,
  /\b(?:vat|deposit|payment terms|instal?ments?|monthly|per month|valid|validity|expire|expires|expiry)\b/i,
  /\bwhat(?:'s| is) the (?:total|deposit|first payment)\b/i,
];

/** The lead asks something about a quote they have (or its terms). */
export function detectQuoteQuestion(text: string | null | undefined): boolean {
  const value = normalise(text);
  if (!value) return false;
  return QUOTE_QUESTION.some((pattern) => pattern.test(value));
}

const PRICE_OBJECTION =
  /\b(?:too (?:expensive|pricey|much|high)|over (?:our|my|the) budget|more than (?:we|i) (?:expected|budgeted|wanted|can)|out of (?:our|my) budget|can'?t afford|cannot afford|a bit steep|cheaper elsewhere|cheaper quote|better price elsewhere|(?:price|cost) is (?:a bit )?(?:high|steep))\b/i;

/** A price objection (not a bare discount ask): unlocks ONLY_AFTER_OBJECTION. */
export function detectPriceObjection(text: string | null | undefined): boolean {
  return PRICE_OBJECTION.test(normalise(text));
}

const DISCOUNT_ASK =
  /\b(?:discount|money off|any (?:wiggle|flexibility|movement) (?:room )?on (?:the )?price|best (?:price|you can do)|better (?:price|deal)|knock (?:some|a bit|anything|\d+%?) off|sharpen (?:the|your) pencil|do (?:it|that|this) for less|come down on (?:the )?price|(?:\d{1,3})\s?% off)\b/i;

/** The lead asks for a discount, with the percentage when they name one. */
export function detectDiscountAsk(text: string | null | undefined): { percent: number | null } | null {
  const value = normalise(text);
  if (!value || !DISCOUNT_ASK.test(value)) return null;
  if (/\b(?:no|don'?t want|not after) (?:a )?discount\b/i.test(value)) return null;
  const percent = /(\d{1,3})\s?%/.exec(value);
  return { percent: percent ? Math.min(100, Number(percent[1])) : null };
}

function normalise(text: string | null | undefined): string {
  return (text ?? "").normalize("NFKC").replace(/[’]/g, "'").slice(0, 2000);
}

/* ================================================================== items */

/** What the quote path reads of a catalogue item (never its cost). */
export type QuoteCatalogueItem = Pick<
  CatalogueItem,
  "id" | "name" | "serviceId" | "unit" | "chargeType" | "options" | "minQuantity" | "maxQuantity" | "addOnOnly" | "active"
> & { interval?: CatalogueItem["interval"] };

const STOP_WORDS = new Set(["the", "and", "for", "with", "our", "your", "a", "an", "of", "to", "in", "on", "plan", "package", "service", "services"]);

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function stem(word: string): string {
  return word.replace(/(?:ies)$/, "y").replace(/(?:es|s)$/, "");
}

/**
 * Catalogue items the lead's words name: the full name, or every significant
 * word of it in any order (singular or plural). An add-on-only or inactive
 * item is never quoted on its own. With nothing named, the one sellable item
 * of the turn's interest (its service) is used; with several, nothing is
 * guessed and the path asks nothing (the ordinary turn goes on).
 */
export function matchCatalogueItems(
  text: string | null | undefined,
  items: readonly QuoteCatalogueItem[],
  options: { serviceId?: string | null } = {},
): QuoteCatalogueItem[] {
  const sellable = items.filter((item) => item.active && !item.addOnOnly);
  const said = new Set(words(normalise(text)).map(stem));
  const named = sellable.filter((item) => {
    const needed = words(item.name).map(stem);
    return needed.length > 0 && needed.every((word) => said.has(word));
  });
  if (named.length > 0) {
    // "website" inside "website care plan": keep the most specific names only.
    return named.filter(
      (item) => !named.some((other) => other !== item && words(other.name).length > words(item.name).length && words(item.name).every((w) => words(other.name).includes(w))),
    );
  }
  if (options.serviceId) {
    const forService = sellable.filter((item) => item.serviceId === options.serviceId);
    if (forService.length === 1) return forService;
  }
  return [];
}

/* ================================================================= inputs */

export const QUOTE_INPUT_KINDS = ["QUANTITY", "OPTIONS", "TIMING"] as const;
export type QuoteInputKind = (typeof QUOTE_INPUT_KINDS)[number];

/** An input is asked at most this many times (then the path drafts with what it has, or stops). */
export const MAX_ASKS_PER_INPUT = 2;

/** Units a single price covers: a quantity of one is implied, never asked. */
const WHOLE_UNITS = new Set(["project", "package", "job", "item", "each", "unit", "one-off", "fixed", "build", "site", "website", "setup", "set-up", "audit", "engagement", "retainer", "subscription", "plan", "licence", "license"]);

export function needsQuantity(item: QuoteCatalogueItem): boolean {
  if (item.minQuantity !== undefined && item.maxQuantity !== undefined && item.minQuantity === item.maxQuantity) return false;
  const unit = stem(item.unit.trim().toLowerCase());
  // "£50 per month" on a monthly item is one unit per period, not a count to ask for.
  if (item.chargeType === "RECURRING" && ["week", "month", "quarter", "year"].includes(unit)) return false;
  return !WHOLE_UNITS.has(item.unit.trim().toLowerCase());
}

/** The persisted state of the quote path on a conversation (decision_json.quote). */
export type QuotePathState = {
  v: 1;
  itemIds: string[];
  /** Per item: the quantity the lead gave. */
  quantities: Record<string, number>;
  /** Per item: the options chosen; [] = none wanted; absent = not decided. */
  options: Record<string, string[]>;
  /** The lead's stated timing, or "known" when the engine already holds it. */
  timing: string | null;
  /** How often each input was asked ("QUANTITY:<itemId>", "TIMING"). */
  asked: Record<string, number>;
  /** The inbound message that asked for the quote: the idempotency request id. */
  requestMessageId: string | null;
  /** The quote this path drafted. */
  quoteId: string | null;
  /** Discount concessions the assistant made on that quote. */
  concessions: number;
};

export function emptyQuotePathState(): QuotePathState {
  return { v: 1, itemIds: [], quantities: {}, options: {}, timing: null, asked: {}, requestMessageId: null, quoteId: null, concessions: 0 };
}

/** Read defensively from a stored decision_json.quote. */
export function parseQuotePathState(raw: unknown): QuotePathState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !Array.isArray(r.itemIds)) return null;
  const record = <T>(value: unknown, ok: (v: unknown) => v is T): Record<string, T> => {
    const out: Record<string, T> = {};
    if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) if (ok(v)) out[k] = v;
    return out;
  };
  const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
  const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
  return {
    v: 1,
    itemIds: r.itemIds.filter((id): id is string => typeof id === "string").slice(0, 10),
    quantities: record(r.quantities, isNum),
    options: record(r.options, isStrArr),
    timing: typeof r.timing === "string" ? r.timing.slice(0, 120) : null,
    asked: record(r.asked, isCount),
    requestMessageId: typeof r.requestMessageId === "string" ? r.requestMessageId : null,
    quoteId: typeof r.quoteId === "string" ? r.quoteId : null,
    concessions: isCount(r.concessions) ? r.concessions : 0,
  };
}

/** A fact the engine holds, as the quote path reads it. */
export type KnownFact = { dimension: string; value: string | null; status: "CONFIRMED" | "INFERRED" | "UNKNOWN" | "CONFLICTING" };

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};

function unitPattern(unit: string): string {
  const base = unit.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const singular = stem(base);
  const synonyms: Record<string, string[]> = {
    seat: ["seats", "users", "user", "people", "staff", "licences", "licenses"],
    user: ["users", "seats", "seat", "people", "staff"],
    page: ["pages"],
    hour: ["hours", "hrs"],
    day: ["days"],
    month: ["months"],
    location: ["locations", "sites", "offices"],
    employee: ["employees", "staff", "people"],
  };
  const all = new Set([base, singular, `${singular}s`, ...(synonyms[singular] ?? [])]);
  return [...all].filter(Boolean).map((w) => w.replace(/\s+/g, "\\s+")).join("|");
}

/** A quantity for this item in the lead's words: "10 seats", "for ten users", or a bare number answering our question. */
export function parseQuantity(text: string | null | undefined, item: QuoteCatalogueItem, answeringQuantity: boolean): number | null {
  const value = normalise(text).toLowerCase();
  if (!value) return null;
  const units = unitPattern(item.unit);
  const digits = new RegExp(`\\b(\\d{1,6}(?:\\.\\d{1,3})?)\\s*(?:x\\s*)?(?:${units})\\b`).exec(value);
  if (digits) return Number(digits[1]);
  for (const [word, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\s+(?:${units})\\b`).test(value)) return n;
  }
  if (answeringQuantity) {
    const bare = /^(?:about |around |roughly |maybe |probably |we(?:'re| are| have| need)? ?|just |only )?(\d{1,6}(?:\.\d{1,3})?)\b/.exec(value.trim());
    if (bare) return Number(bare[1]);
    const any = /\b(\d{1,6})\b/.exec(value);
    if (any && value.length <= 40) return Number(any[1]);
    for (const [word, n] of Object.entries(NUMBER_WORDS)) if (new RegExp(`^(?:about |around |just )?${word}\\b`).test(value.trim())) return n;
  }
  return null;
}

const NO_OPTIONS = /\b(?:no|none|nothing else|just the (?:basic|standard|core|base)|basic is fine|without (?:any )?(?:extras|add-?ons|options)|no (?:extras|add-?ons|options)|keep it simple)\b/i;

/** The options the lead chose for this item; [] when they said none; null when their words decide nothing. */
export function parseOptions(text: string | null | undefined, item: QuoteCatalogueItem, answeringOptions: boolean): string[] | null {
  const value = normalise(text);
  if (!value || item.options.length === 0) return null;
  const said = new Set(words(value).map(stem));
  const chosen = item.options.filter((option) => {
    const needed = words(option.name).map(stem);
    return needed.length > 0 && needed.every((word) => said.has(word));
  });
  if (chosen.length > 0) return chosen.map((option) => option.id);
  if (answeringOptions && NO_OPTIONS.test(value)) return [];
  return null;
}

const TIMING = /\b(?:asap|as soon as possible|urgent(?:ly)?|immediately|straight away|right away|this (?:week|month|quarter|year)|next (?:week|month|quarter|year)|in (?:\d+|a|a couple of|a few|two|three|four|six) (?:days?|weeks?|months?)|by (?:the end of )?(?:january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|spring|summer|autumn|winter|christmas|the new year)|(?:in|from|around|before) (?:january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|spring|summer|autumn|winter)|no rush|whenever|flexible|not in a hurry)\b/i;

export function parseTiming(text: string | null | undefined): string | null {
  const match = TIMING.exec(normalise(text));
  return match ? match[0].toLowerCase().slice(0, 60) : null;
}

/**
 * The inputs this reply (and the engine's facts) supply, merged into the
 * state. The previous turn's question decides what a bare answer means ("10"
 * after "how many seats?").
 */
export function readQuoteInputs(input: {
  state: QuotePathState;
  items: readonly QuoteCatalogueItem[];
  text: string | null;
  facts?: readonly KnownFact[];
  /** What the previous turn asked, when it was a quote input question. */
  answering?: { kind: QuoteInputKind; itemId: string | null } | null;
}): QuotePathState {
  const state: QuotePathState = { ...input.state, quantities: { ...input.state.quantities }, options: { ...input.state.options } };
  const known = (dimension: string) =>
    (input.facts ?? []).find((f) => f.dimension === dimension && (f.status === "CONFIRMED" || f.status === "INFERRED"));
  for (const item of input.items) {
    if (state.quantities[item.id] === undefined && needsQuantity(item)) {
      const answering = input.answering?.kind === "QUANTITY" && input.answering.itemId === item.id;
      const fromText = parseQuantity(input.text, item, answering);
      if (fromText !== null && fromText > 0) state.quantities[item.id] = fromText;
      else {
        // A seat-priced item reads the team size the engine already holds; a
        // volume-priced one the stated volume.
        const unit = stem(item.unit.toLowerCase());
        const fact = ["seat", "user", "licence", "license", "employee"].includes(unit) ? known("TEAM_SIZE") ?? known("VOLUME") : known("VOLUME");
        const n = fact?.value ? parseQuantity(fact.value, item, true) : null;
        if (n !== null && n > 0) state.quantities[item.id] = n;
      }
    }
    if (state.options[item.id] === undefined && item.options.length > 0) {
      const answering = input.answering?.kind === "OPTIONS" && input.answering.itemId === item.id;
      const chosen = parseOptions(input.text, item, answering);
      if (chosen !== null) state.options[item.id] = chosen;
    }
  }
  if (!state.timing) {
    const said = parseTiming(input.text);
    if (said) state.timing = said;
    else if (known("TIMING")) state.timing = "known";
    else if (input.answering?.kind === "TIMING" && (input.text ?? "").trim().length > 0 && (input.text ?? "").trim().length <= 80) {
      // An answer to "when would you like to start?" that the patterns did
      // not read is still an answer: it is not asked again.
      state.timing = (input.text ?? "").trim().toLowerCase().slice(0, 60);
    }
  }
  return state;
}

export type MissingInput = { kind: QuoteInputKind; itemId: string | null };

/** What is still needed, in the order it is asked: quantity, options, timing. Inputs asked twice already are not asked again. */
export function missingQuoteInputs(state: QuotePathState, items: readonly QuoteCatalogueItem[]): MissingInput[] {
  const out: MissingInput[] = [];
  const room = (key: string) => (state.asked[key] ?? 0) < MAX_ASKS_PER_INPUT;
  for (const item of items) {
    if (needsQuantity(item) && state.quantities[item.id] === undefined && room(`QUANTITY:${item.id}`)) out.push({ kind: "QUANTITY", itemId: item.id });
  }
  for (const item of items) {
    if (item.options.length > 0 && state.options[item.id] === undefined && room(`OPTIONS:${item.id}`)) out.push({ kind: "OPTIONS", itemId: item.id });
  }
  if (!state.timing && room("TIMING")) out.push({ kind: "TIMING", itemId: null });
  return out;
}

/** A quantity the price cannot be drafted without (asked twice and still unknown). */
export function quantityBlocked(state: QuotePathState, items: readonly QuoteCatalogueItem[]): boolean {
  return items.some((item) => needsQuantity(item) && state.quantities[item.id] === undefined && (state.asked[`QUANTITY:${item.id}`] ?? 0) >= MAX_ASKS_PER_INPUT);
}

function plural(unit: string): string {
  const u = unit.trim().toLowerCase();
  if (/(s|x|ch|sh)$/.test(u)) return `${u}es`;
  if (/[^aeiou]y$/.test(u)) return `${u.slice(0, -1)}ies`;
  return `${u}s`;
}

function listOr(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * The one question for a missing input: plain, short, with the reason where
 * it helps. The strategy block hands it to the model as the turn's question;
 * it is also the fixed text when no model call is made.
 */
export function quoteInputQuestion(missing: MissingInput, items: readonly QuoteCatalogueItem[]): string {
  const item = items.find((candidate) => candidate.id === missing.itemId) ?? null;
  switch (missing.kind) {
    case "QUANTITY":
      return item ? `So I can price it properly, how many ${plural(item.unit)} would you need?` : "So I can price it properly, how many would you need?";
    case "OPTIONS": {
      const names = (item?.options ?? []).slice(0, 4).map((option) => option.name);
      return item && names.length > 0 ? `Would you like ${listOr(names)} added, or the standard version?` : "Would you like any extras added, or the standard version?";
    }
    case "TIMING":
      return "When would you be looking to get started?";
  }
}

/** The quote lines for the state: one line per item, quantity and options as the lead gave them. */
export function quoteLinesFor(state: QuotePathState, items: readonly QuoteCatalogueItem[]): QuoteLineInput[] {
  return items.map((item, index) => ({
    lineId: `l${index + 1}`,
    kind: "ITEM" as const,
    itemId: item.id,
    quantity: needsQuantity(item) ? state.quantities[item.id] ?? item.minQuantity ?? 1 : item.minQuantity ?? 1,
    optionIds: state.options[item.id] ?? [],
  }));
}

/* ==================================================================== gate */

export const QUOTE_TOOLS = ["calculate_quote", "draft_quote", "request_quote_approval", "send_quote", "propose_discount"] as const;
export type QuoteTool = (typeof QUOTE_TOOLS)[number];

export type QuoteGateInput = {
  /** business_settings.ai_assist_enabled and agent mode not OFF. */
  aiEnabled: boolean;
  /** can(businessId, "quote_ai_enabled"): the plan and the AI entitlement. */
  quoteAiCapability: boolean;
  authority: AiAuthority | null | undefined;
};

export type QuoteGate =
  | { allowed: true }
  | { allowed: false; reason: "AI_OFF" | "NOT_ON_PLAN" | "NOT_PERMITTED"; detail: string };

const TOOL_PERMISSION = {
  calculate_quote: "create_quote",
  draft_quote: "create_quote",
  request_quote_approval: "create_quote",
  send_quote: "send_quote",
  propose_discount: "discount",
} as const;

/**
 * Whether the assistant may use a quote tool at all. Enforced server-side in
 * agent/tools.ts before the service registry is called; the registry and the
 * quote core then apply their own role, confirmation, capability and policy
 * checks on top.
 */
export function quoteToolGate(tool: QuoteTool, input: QuoteGateInput): QuoteGate {
  if (!input.aiEnabled) return { allowed: false, reason: "AI_OFF", detail: "The AI assistant is switched off for this workspace." };
  if (!input.quoteAiCapability) return { allowed: false, reason: "NOT_ON_PLAN", detail: "AI quote drafting is not on this workspace's plan." };
  const permission = TOOL_PERMISSION[tool];
  if (!aiMay(input.authority, permission)) {
    return { allowed: false, reason: "NOT_PERMITTED", detail: `The workspace has not let the assistant ${permission.replace("_", " ")}.` };
  }
  return { allowed: true };
}

/* ==================================================================== plan */

/** A quote the lead already has on the opportunity the turn is about. */
export type OpenQuote = {
  id: string;
  status: string;
  /** The current revision. */
  revisionId: string | null;
  /** The current revision's calculation (figures come only from here). */
  calculation: QuoteCalculationView | null;
  validUntil: string | null;
  /** Revision frozen for sending (a sent revision). */
  sent: boolean;
};

export type QuoteStep =
  | { kind: "NONE" }
  /** A quote is the right move but the assistant may not make it: the ordinary price handling (a colleague confirms). */
  | { kind: "NOT_PERMITTED"; gate: Extract<QuoteGate, { allowed: false }> }
  /** Several interests: the quote is for an offer this turn is not about. */
  | { kind: "DEFERRED"; itemIds: string[] }
  | { kind: "COLLECT"; input: MissingInput; question: string }
  | { kind: "DRAFT"; lines: QuoteLineInput[] }
  | { kind: "SEND"; quoteId: string }
  | { kind: "ANSWER_FROM_QUOTE"; quoteId: string }
  | { kind: "DISCOUNT"; quoteId: string; requestedPercent: number | null }
  | { kind: "AWAITING_APPROVAL"; quoteId: string }
  | { kind: "NEXT_STEP"; quoteId: string; status: string };

const LIVE_UNSENT = new Set(["DRAFT", "APPROVED"]);
const LIVE_SENT = new Set(["SENT", "VIEWED"]);
const AFTER_ACCEPT = new Set(["ACCEPTED", "SIGNED", "DEPOSIT_PAID"]);

export type PlanInput = {
  text: string | null;
  state: QuotePathState;
  /** The items for the state (resolved from the catalogue). */
  items: readonly QuoteCatalogueItem[];
  openQuote: OpenQuote | null;
  gate: QuoteGateInput;
  /** Several interests: the service the turn is about (null = one interest). */
  focusServiceId: string | null;
  /** The offer closes by quote (pricing model QUOTE with catalogue items), and the NBA is at its close. */
  quoteIsTheClose?: boolean;
};

/**
 * One step per turn. A quote the lead already has comes first (a discount
 * ask, a question about it, the approval it waits for, the step after
 * acceptance); then a quote in progress or a new ask; otherwise NONE and the
 * turn is the ordinary one.
 */
export function planQuoteStep(input: PlanInput): QuoteStep {
  const { openQuote, state } = input;
  const asksQuote = detectQuoteRequest(input.text);
  const discountAsk = detectDiscountAsk(input.text);
  const priceObjection = detectPriceObjection(input.text);
  const gate = (tool: QuoteTool) => quoteToolGate(tool, input.gate);

  if (openQuote) {
    if (AFTER_ACCEPT.has(openQuote.status)) return { kind: "NEXT_STEP", quoteId: openQuote.id, status: openQuote.status };
    if (openQuote.status === "PENDING_APPROVAL") return { kind: "AWAITING_APPROVAL", quoteId: openQuote.id };
    if ((discountAsk || priceObjection) && (LIVE_SENT.has(openQuote.status) || LIVE_UNSENT.has(openQuote.status))) {
      // The discount decision itself (allow / approval / hold) is made by
      // evaluateDiscount; without the discount switch it is a hold.
      return { kind: "DISCOUNT", quoteId: openQuote.id, requestedPercent: discountAsk?.percent ?? null };
    }
    if (LIVE_UNSENT.has(openQuote.status) && openQuote.status === "APPROVED" && gate("send_quote").allowed) {
      return { kind: "SEND", quoteId: openQuote.id };
    }
    if (LIVE_SENT.has(openQuote.status) && (asksQuote || detectQuoteQuestion(input.text))) {
      return { kind: "ANSWER_FROM_QUOTE", quoteId: openQuote.id };
    }
    if (LIVE_UNSENT.has(openQuote.status) && (asksQuote || detectQuoteQuestion(input.text))) {
      // Drafted but not sent (a person sends it, or it waits): say it is being prepared.
      return { kind: "AWAITING_APPROVAL", quoteId: openQuote.id };
    }
    return { kind: "NONE" };
  }

  const inProgress = state.itemIds.length > 0 && state.quoteId === null;
  if (!asksQuote && !inProgress && !input.quoteIsTheClose) return { kind: "NONE" };
  if (input.items.length === 0) return { kind: "NONE" };

  const draftGate = gate("draft_quote");
  if (!draftGate.allowed) return { kind: "NOT_PERMITTED", gate: draftGate };

  if (input.focusServiceId && input.items.every((item) => item.serviceId !== null && item.serviceId !== input.focusServiceId)) {
    return { kind: "DEFERRED", itemIds: input.items.map((item) => item.id) };
  }

  if (quantityBlocked(state, input.items)) return { kind: "NONE" };
  const missing = missingQuoteInputs(state, input.items);
  if (missing.length > 0) {
    return { kind: "COLLECT", input: missing[0], question: quoteInputQuestion(missing[0], input.items) };
  }
  return { kind: "DRAFT", lines: quoteLinesFor(state, input.items) };
}

/** The state after a COLLECT step is asked. */
export function markAsked(state: QuotePathState, missing: MissingInput): QuotePathState {
  const key = missing.itemId ? `${missing.kind}:${missing.itemId}` : missing.kind;
  return { ...state, asked: { ...state.asked, [key]: (state.asked[key] ?? 0) + 1 } };
}

/** The offer closes by quote: its pricing model is QUOTE and the catalogue has a sellable item for it. */
export function quoteIsTheClose(input: { pricingModel: string | null | undefined; itemsForService: number; nbaAction: string | null }): boolean {
  return input.pricingModel === "QUOTE" && input.itemsForService > 0 && (input.nbaAction === "CTA_BOOK" || input.nbaAction === "CTA_CHECKOUT");
}

/* ================================================================ discount */

export type Concession = {
  /** The discount the proposal takes off, as a whole-quote percentage in basis points. */
  bps: number;
  discountMinor: number;
  baseMinor: number;
  decision: DiscountDecision;
  /** True when the lead asked for more and this is the most the policy allows instead. */
  countered: boolean;
};

/** The discountable base of a calculation (list less bundle pricing, usage excluded) and the negotiated discount on it. */
export function discountBase(calc: QuoteCalculationView): { baseMinor: number; discountMinor: number; valueMinor: number } {
  const priced = calc.lines.filter((line) => line.chargeType !== "USAGE");
  const baseMinor = priced.reduce((t, l) => t + l.listMinor - l.bundleDiscountMinor, 0);
  const discountMinor = priced.reduce((t, l) => t + l.lineDiscountMinor + l.quoteDiscountMinor, 0);
  return { baseMinor, discountMinor, valueMinor: calc.totals.netMinor };
}

/**
 * The concession to propose for a discount ask on a quote, decided by
 * evaluateDiscount. The assistant proposes the lead's own figure when they
 * named one, otherwise the policy's first concession. Above the limits, the
 * largest discount the policy allows is offered instead when there is one;
 * otherwise the price is held (DENY).
 *
 * The margin after the discount is estimated from the current margin (cost
 * unchanged, net reduced by the discount): the quote core recomputes it
 * exactly before anything is stored.
 */
export function planConcession(input: {
  policy: DiscountPolicy;
  calculation: QuoteCalculationView;
  requestedPercent: number | null;
  afterObjection: boolean;
  priorAiConcessions: number;
}): Concession {
  const { calculation } = input;
  const { baseMinor } = discountBase(calculation);
  // Without the cost in hand, the margin rules are left to the quote core,
  // which re-decides with the full calculation before anything is stored.
  const marginKnown = calculation.margin?.complete === true;
  const policy: DiscountPolicy = marginKnown
    ? input.policy
    : {
        ...input.policy,
        marginFloorBps: null,
        approvalRules: input.policy.approvalRules.filter((rule) => rule.marginBelowBps === undefined || rule.discountAboveBps !== undefined || rule.discountAboveMinor !== undefined || rule.valueAboveMinor !== undefined),
      };
  const firstStepBps = policy.firstConcessionMaxBps ?? policy.aiMaxBps;
  const wantedBps = input.requestedPercent !== null ? Math.round(input.requestedPercent * 100) : firstStepBps;
  const evaluate = (bps: number) => {
    const discountMinor = baseMinor > 0 ? mulDivFloor(baseMinor, Math.max(0, Math.min(10_000, bps)), 10_000) : 0;
    const netAfter = calculation.totals.netMinor - discountMinor;
    const cost = calculation.margin?.complete ? calculation.margin.costMinor : null;
    const marginAfterBps = cost === null || netAfter <= 0 ? null : ratioBps(netAfter - cost, netAfter);
    const decision = evaluateDiscount(policy, {
      actor: { kind: "AI" },
      baseMinor,
      discountMinor,
      valueAfterMinor: netAfter,
      marginAfterBps,
      afterObjection: input.afterObjection,
      priorAiConcessions: input.priorAiConcessions,
    });
    return { bps, discountMinor, decision };
  };

  const first = evaluate(wantedBps > 0 ? wantedBps : 1);
  if (first.decision.outcome === "DENY" && first.decision.maxAllowedMinor && first.decision.maxAllowedMinor > 0 && baseMinor > 0) {
    // "I can't do 20%, the most I can do is 5%": the counter is itself
    // evaluated, so it is only offered when it would be allowed.
    const counterBps = Math.floor((first.decision.maxAllowedMinor * 10_000) / baseMinor);
    if (counterBps > 0) {
      const counter = evaluate(counterBps);
      if (counter.decision.outcome !== "DENY") return { ...counter, baseMinor, countered: true };
    }
  }
  return { ...first, baseMinor, countered: false };
}

/* ================================================================= figures */

export type QuoteFigures = {
  currency: string;
  /** Every figure the model may state this turn, formatted as the quote shows it. */
  figures: string[];
  /** Labelled for the strategy line, in order of importance. */
  labelled: { label: string; value: string }[];
  vatRegistered: boolean;
  /** VAT rates on the quote, in percent (20, 5). Empty when not VAT-registered. */
  vatRatesPercent: number[];
  /** The whole-quote discount on the quote, in percent (e.g. 5 or 7.5); empty when none. */
  discountPercents: number[];
  validUntil: string | null;
};

const INTERVAL_WORD: Record<string, string> = { WEEK: "week", MONTH: "month", QUARTER: "quarter", YEAR: "year" };

/**
 * The figures of one calculation, formatted exactly as the quote document
 * shows them. These, and only these, are what the model may say.
 */
export function quoteFigures(calc: QuoteCalculationView, options: { validUntil?: string | null } = {}): QuoteFigures {
  const money = (minor: number) => formatMinor(minor, calc.currency);
  const labelled: { label: string; value: string }[] = [];
  const add = (label: string, minor: number) => {
    if (minor > 0) labelled.push({ label, value: money(minor) });
  };
  const vatNote = calc.vatRegistered ? " including VAT" : "";
  add(`total${vatNote}`, calc.totals.grossMinor);
  if (calc.vatRegistered) {
    add("before VAT", calc.totals.netMinor);
    add("VAT", calc.totals.vatMinor);
  }
  const { baseMinor, discountMinor } = discountBase(calc);
  add("discount", discountMinor);
  if (calc.depositMinor > 0) add("deposit", calc.depositMinor);
  if (calc.firstPaymentMinor > 0 && calc.firstPaymentMinor !== calc.totals.grossMinor) add("first payment", calc.firstPaymentMinor);
  for (const recurring of calc.recurring) {
    const every = recurring.interval.count > 1 ? `every ${recurring.interval.count} ${INTERVAL_WORD[recurring.interval.unit]}s` : `per ${INTERVAL_WORD[recurring.interval.unit]}`;
    add(`${every}${vatNote}`, recurring.grossMinor);
  }
  for (const line of calc.lines) {
    if (line.chargeType === "USAGE") continue;
    add(`${line.description}${vatNote}`, line.grossMinor);
    if (line.unitPriceMinor !== null && line.quantityMilli !== 1000) add(`${line.description} per ${line.unit}`, line.unitPriceMinor);
  }
  // One label per figure: a one-line quote's line total is the total.
  const seen = new Set<string>();
  const unique = labelled.filter((entry) => (seen.has(entry.value) ? false : (seen.add(entry.value), true)));
  const vatRates = calc.vatRegistered ? [...new Set(calc.lines.filter((l) => l.vatBps > 0).map((l) => l.vatBps / 100))] : [];
  const discountBps = discountMinor > 0 && baseMinor > 0 ? ratioBps(discountMinor, baseMinor) : null;
  const discountPercents = discountBps !== null ? [Number(formatBps(discountBps).replace("%", ""))] : [];
  return {
    currency: calc.currency,
    figures: [...new Set(unique.map((entry) => entry.value))],
    labelled: unique,
    vatRegistered: calc.vatRegistered,
    vatRatesPercent: vatRates,
    discountPercents,
    validUntil: options.validUntil ?? null,
  };
}

/** The validator's view of the turn's quote (validate.ts ValidationFacts.quote). */
export type QuoteValidationFacts = {
  figures: string[];
  vatRegistered: boolean;
  vatRatesPercent: number[];
  discountPercents: number[];
  /** A discount is with a person for approval: the message may say so, with no figure. */
  discountUnderReview?: boolean;
};

export function validationFactsFor(figures: QuoteFigures | null, options: { discountUnderReview?: boolean } = {}): QuoteValidationFacts {
  return {
    figures: figures?.figures ?? [],
    vatRegistered: figures?.vatRegistered ?? false,
    vatRatesPercent: figures?.vatRatesPercent ?? [],
    discountPercents: figures?.discountPercents ?? [],
    discountUnderReview: options.discountUnderReview === true,
  };
}

const MAX_FIGURE_LINES = 6;

function dateLabel(iso: string | null): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const d = new Date(at);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The strategy lines that tell the model which figures it may state,
 * verbatim, and what it may not say. Short: they sit in the per-turn block
 * (the token budget in tests/token-budget.test.ts).
 */
export function quoteFigureLines(figures: QuoteFigures): string[] {
  const shown = figures.labelled.slice(0, MAX_FIGURE_LINES).map((entry) => `${entry.value} (${entry.label})`);
  const lines = [`Figures you may state, exactly as written: ${shown.join(", ")}. No other figure, and do not round or work anything out.`];
  lines.push(
    figures.vatRegistered
      ? "Say nothing about VAT beyond these figures."
      : "Do not mention VAT or tax at all.",
  );
  const valid = dateLabel(figures.validUntil);
  if (valid) lines.push(`The quote is valid until ${valid}.`);
  lines.push("Never promise a start, delivery or completion date.");
  return lines;
}

/** One line on what this step says, plus the figure lines when a calculation is in play. */
export function quoteStrategyLines(step: QuoteStep | { kind: "DRAFTED"; then: "SENT" | "APPROVAL" | "PERSON_SENDS" }, figures: QuoteFigures | null, extra: { concession?: Concession | null; question?: string | null } = {}): string[] {
  const lines: string[] = [];
  switch (step.kind) {
    case "COLLECT":
      lines.push(`They want a quote. Before pricing it, ask one thing only: "${step.question}". Do not give any price yet.`);
      break;
    case "DRAFTED":
      if (step.then === "SENT") lines.push("Their quote has just been emailed to them. Say it is on its way, give the headline figure, and invite questions.");
      else if (step.then === "APPROVAL") lines.push("Their quote is drafted and a colleague is checking it before it goes out. Say so plainly; no figure yet.");
      else lines.push("Their quote is drafted and a colleague will send it over. Say so plainly; no figure yet.");
      break;
    case "ANSWER_FROM_QUOTE":
      lines.push("They are asking about the quote they have. Answer from the quote's figures only; anything the quote does not say, a colleague confirms.");
      break;
    case "AWAITING_APPROVAL":
      lines.push("Their quote is with a colleague for a final check. Say so honestly and that it will follow; promise no figure or time.");
      break;
    case "NEXT_STEP":
      lines.push(
        step.status === "ACCEPTED"
          ? "They have accepted the quote. The signature step is on the same quote page they already have; point them to it."
          : "The quote is signed. Any payment step is on their quote page; thank them and answer what they ask.",
      );
      break;
    case "DISCOUNT": {
      const concession = extra.concession;
      if (!concession || concession.decision.outcome === "DENY") {
        lines.push(
          "They want a lower price. Hold the price politely: acknowledge it, ask what is driving it or reframe with the value and scope options from the offer card, then one small next step. Do not offer or hint at any discount.",
        );
      } else if (concession.decision.outcome === "REQUIRE_APPROVAL") {
        lines.push("They asked for a better price. Say honestly you have asked the team to look at it and will come back to them. Do not name or promise any discount.");
      } else {
        lines.push(
          `They asked for a better price. The revised quote takes ${formatBps(concession.bps)} off${concession.countered ? " (the most that can be offered, less than they asked)" : ""}. Say so once, warmly, with the new total.`,
        );
      }
      break;
    }
    default:
      break;
  }
  if (figures && step.kind !== "COLLECT" && step.kind !== "AWAITING_APPROVAL") lines.push(...quoteFigureLines(figures));
  return lines;
}

/* ================================================================ fallback */

export type QuoteMessageKind =
  | { kind: "COLLECT"; question: string }
  | { kind: "DRAFTED"; then: "SENT" | "APPROVAL" | "PERSON_SENDS" }
  | { kind: "ANSWER_FROM_QUOTE" }
  | { kind: "AWAITING_APPROVAL" }
  | { kind: "NEXT_STEP"; status: string; permitted: boolean }
  | { kind: "DISCOUNT"; outcome: "ALLOW" | "REQUIRE_APPROVAL" | "DENY"; sent: boolean; bps: number | null };

/**
 * The message used when the model is unavailable or its drafts keep failing
 * the validator: plain, deterministic, and built only from the figures this
 * turn's calculation returned. It is validated like any draft.
 */
export function quoteFallbackText(message: QuoteMessageKind, figures: QuoteFigures | null, firstName: string | null): string {
  const thanks = firstName?.trim() ? `Thanks ${firstName.trim()}. ` : "Thanks. ";
  const headline = figures?.labelled[0] ?? null;
  switch (message.kind) {
    case "COLLECT":
      return message.question;
    case "DRAFTED":
      if (message.then === "SENT") {
        return headline
          ? `${thanks}I've sent your quote over. It comes to ${headline.value} (${headline.label}). Happy to go through any of it.`
          : `${thanks}I've sent your quote over. Happy to go through any of it.`;
      }
      return `${thanks}Your quote is with a colleague for a final check, and it will come over to you once it is ready.`;
    case "ANSWER_FROM_QUOTE":
      return headline
        ? `Your quote comes to ${headline.value} (${headline.label}). If there's anything it doesn't cover, a colleague can confirm it for you.`
        : "A colleague can confirm anything your quote doesn't cover.";
    case "AWAITING_APPROVAL":
      return `${thanks}Your quote is with a colleague for a final check, and it will come over to you once it is ready.`;
    case "NEXT_STEP":
      if (!message.permitted) return `${thanks}A colleague will be in touch about the next step.`;
      return message.status === "ACCEPTED"
        ? `${thanks}The signature step is on the same quote page, whenever you're ready.`
        : `${thanks}Any payment step is on your quote page. Let me know if anything is unclear.`;
    case "DISCOUNT":
      if (message.outcome === "DENY") {
        return "I understand. The price reflects everything that's included, so I can't change it, but I'm happy to look at which options fit best. What matters most to you?";
      }
      if (message.outcome === "REQUIRE_APPROVAL") return `${thanks}I've asked the team to look at the price for you, and I'll come back to you.`;
      return headline && message.bps
        ? `Good news: I've been able to take ${formatBps(message.bps)} off, so it now comes to ${headline.value} (${headline.label}).${message.sent ? " The revised quote is on its way to you." : " A colleague will send the revised quote over."}`
        : `${thanks}A colleague will send the revised quote over.`;
  }
}

/** The quote step's strategy block for the model: the move, then the figure lines. */
export function quoteStrategyBlock(lines: string[], extraGuidance: readonly string[] = []): string {
  return ["QUOTE", ...lines, ...extraGuidance].join("\n");
}
