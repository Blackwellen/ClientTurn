/**
 * Deterministic extractors (08 §B.11 step 3). One implementation per
 * `EXTRACTOR_KEYS` entry in the contract, plus two readers interpret() uses
 * for incidental extraction that no contract key covers: `extractCounts`
 * (every count in a reply, by unit, so a team size and a headcount in one
 * reply are both read) and `extractProjectScope` (what the lead wants made).
 *
 * Every extractor reads a reply and returns either nothing or one candidate
 * value with:
 *   - `evidence`: the verbatim substring it read the value from;
 *   - `confidence`: how unambiguous the wording was (deterministic, 0..1);
 *   - `selfStated`: the lead said it about themselves in the first person
 *     ("we've got 45 staff"), which is what lets interpret() store a fact as
 *     CONFIRMED rather than INFERRED.
 *
 * Nothing is guessed. A reply an extractor cannot read confidently returns
 * null, so the dimension stays UNKNOWN (and is asked) rather than invented.
 *
 * Pure: no server-only, no Supabase, relative `.ts` imports.
 */

import type { ExtractorKey } from "./types.ts";
import { timelineDays } from "../scoring/answer-features.ts";

export type ExtractorContext = {
  /** CHOICE: the configured question's options. */
  options?: { value: string; label: string }[];
  /** PROVIDER_MENTION: how this business type's buyers name the incumbent. */
  incumbentTerms?: string[];
  /** SERVICE_NAME: the workspace's service names. */
  serviceNames?: string[];
  /**
   * SERVICE_NAME: the business type's own service vocabulary, from the
   * choice its SERVICE_NEEDED question offers ("accounts, tax, payroll, or
   * advisory"), each option with the phrases a buyer uses for it
   * (question-intents.ts `serviceTermsFor`). A regex source per option.
   */
  serviceTerms?: { label: string; pattern: string }[];
  /** PROVIDER_MENTION: competitor names from the offer profile, if any. */
  competitorNames?: string[];
  /** TIMELINE / DATE: "now" for date arithmetic (ISO). Defaults to the epoch-free current time. */
  now?: string;
};

export type Extraction = {
  /** Human-readable value, as it will be shown and stored (<= 500 chars). */
  value: string;
  /** Machine value predicates compare against (<= 200 chars). Numbers are plain digits. */
  normalised: string;
  confidence: number;
  selfStated: boolean;
  /** Verbatim substring of the reply. */
  evidence: string;
  /** TIMELINE / DATE: the stated or implied date, YYYY-MM-DD. */
  statedDate?: string;
  /** COUNT: what was counted. */
  unit?: "staff" | "users" | "devices" | "items";
};

export const EXTRACTORS_VERSION = "ex-1";

/* ------------------------------------------------------------ helpers */

const MAX_INPUT = 2000;
const DAY_MS = 86_400_000;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max).trimEnd();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nowOf(ctx: ExtractorContext | undefined): Date {
  const parsed = ctx?.now ? Date.parse(ctx.now) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** First-person framing within the few words before a match. */
const FIRST_PERSON = /\b(we|we've|we have|we're|we are|our|i|i've|i have|i'm|i am|my|there are|there's|us)\b/i;

function selfStatedBefore(text: string, index: number): boolean {
  const window = text.slice(Math.max(0, index - 40), index);
  return FIRST_PERSON.test(window);
}

/** The clause of `text` containing `index`: split on sentence and clause breaks. */
export function clauseAround(text: string, index: number, length: number): string {
  const breaks = /[.;!?\n]|,\s|\s(?:and|but|because|so|although|though)\s/gi;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(breaks)) {
    const at = match.index ?? 0;
    if (at + match[0].length <= index) start = at + match[0].length;
    else if (at >= index + length) {
      end = at;
      break;
    }
  }
  return text.slice(start, end).trim();
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, dozen: 12, "a dozen": 12, "a hundred": 100,
};

/**
 * "45", "1,200", "forty five", "forty-five", "a dozen", "two hundred",
 * "two hundred and fifty", "three thousand" -> number, or null. Every word
 * must be understood; anything else is null, never a partial reading.
 */
export function parseNumberToken(token: string): number | null {
  const text = token.trim().toLowerCase().replace(/,/g, "");
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  if (NUMBER_WORDS[text] !== undefined) return NUMBER_WORDS[text];
  const words = text.split(/[\s-]+/).filter((w) => w && w !== "and");
  let total = 0;
  let current = 0;
  let seen = false;
  for (const [i, word] of words.entries()) {
    if (word === "a" && i === 0) {
      current = 1;
    } else if (word === "hundred") {
      current = (current || 1) * 100;
    } else if (word === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
    } else if (word === "dozen") {
      current = (current || 1) * 12;
    } else if (NUMBER_WORDS[word] !== undefined && NUMBER_WORDS[word] < 100) {
      // After a hundreds/thousands part anything below 100 may follow; after a
      // tens word only a unit may ("forty five"); nothing may follow a unit.
      const rest = current % 100;
      if (rest !== 0 && !(rest >= 20 && rest % 10 === 0 && NUMBER_WORDS[word] < 10)) return null;
      current += NUMBER_WORDS[word];
    } else {
      return null;
    }
    seen = true;
  }
  return seen ? total + current : null;
}

const UNIT_WORD = "(?:one|two|three|four|five|six|seven|eight|nine)";
const SMALL_WORD = `(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\\s-]${UNIT_WORD})?|${UNIT_WORD}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)`;
/** Spelled numbers, compound first so "two hundred" is not read as "hundred". */
const NUMBER_WORD_ALT = `(?:(?:a|${SMALL_WORD})\\s+(?:hundred|thousand)(?:\\s+(?:and\\s+)?${SMALL_WORD})?|${SMALL_WORD}|a dozen|dozen|a hundred|hundred|a thousand|thousand)`;
const NUMBER_ALT = `(?:\\d{1,3}(?:,\\d{3})+|\\d+|${NUMBER_WORD_ALT})`;
/** Hedges a lead puts before a number: "about 12", "roughly three months". */
const HEDGE = "(?:about|around|roughly|approx(?:imately)?\\.?|circa|maybe|perhaps|say|nearly|just over|just under|~)";

/* ------------------------------------------------------ question shape */

const DEFLECTION =
  /\b(rather not (say|share)|prefer not to|not sure|don'?t know|dunno|no idea|why do you (need|want) to know|mind your own|not telling|can'?t say|hard to say|depends|skip (that|this)|next question|does it matter)\b/i;

/** The lead declined or dodged the question (not a refusal of the sale). */
export function isDeflection(reply: string): boolean {
  return DEFLECTION.test(reply.slice(0, MAX_INPUT));
}

const QUESTION_START = /^(what|how|when|where|who|why|which|can|could|do|does|did|is|are|will|would|should|have|has)\b/i;

/** The lead asked something: a question mark, or a question word leading a short message. */
export function isQuestion(reply: string): boolean {
  const text = reply.slice(0, MAX_INPUT).trim();
  if (text.includes("?")) return true;
  return text.length < 200 && QUESTION_START.test(text);
}

/* ----------------------------------------------------------- extractors */

const YES = /^(yes|y|yeah|yep|yup|sure|correct|definitely|absolutely|of course|that's right|thats right|i do|we do|it is|we are|i am)\b/i;
const NO = /^(no|n|nope|nah|not really|not yet|we don'?t|i don'?t|it isn'?t|we aren'?t)\b/i;

function extractYesNo(text: string): Extraction | null {
  const trimmed = text.trim();
  const normalised = trimmed.toLowerCase().replace(/[.!?]+$/, "").trim();
  const yes = YES.exec(normalised);
  if (yes) {
    return { value: "yes", normalised: "yes", confidence: normalised === yes[0] ? 1 : 0.9, selfStated: true, evidence: trimmed.slice(0, yes[0].length) };
  }
  const no = NO.exec(normalised);
  if (no) {
    return { value: "no", normalised: "no", confidence: normalised === no[0] ? 1 : 0.9, selfStated: true, evidence: trimmed.slice(0, no[0].length) };
  }
  return null;
}

function extractChoice(text: string, ctx?: ExtractorContext): Extraction | null {
  const options = ctx?.options ?? [];
  if (options.length === 0) return null;
  const trimmed = text.trim();
  const normalised = trimmed.toLowerCase().replace(/[.!?]+$/, "").trim();
  const exact = options.find((o) => o.value.toLowerCase() === normalised || o.label.toLowerCase() === normalised);
  if (exact) return { value: exact.label, normalised: exact.value, confidence: 1, selfStated: true, evidence: trimmed };
  const index = Number(normalised);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) {
    const option = options[index - 1];
    return { value: option.label, normalised: option.value, confidence: 1, selfStated: true, evidence: trimmed };
  }
  // A label named inside a longer reply counts only when exactly one does.
  const contained = options
    .map((o) => ({ o, match: new RegExp(`\\b${escapeRegExp(o.label.toLowerCase())}\\b`).exec(trimmed.toLowerCase()) }))
    .filter((entry) => entry.match);
  if (contained.length === 1) {
    const { o, match } = contained[0];
    return {
      value: o.label,
      normalised: o.value,
      confidence: 0.85,
      selfStated: true,
      evidence: trimmed.slice(match!.index, match!.index + match![0].length),
    };
  }
  return null;
}

function extractFreeText(text: string): Extraction | null {
  const trimmed = text.trim();
  if (trimmed.length < 2 || isDeflection(trimmed)) return null;
  const value = clip(trimmed, 500);
  return { value, normalised: clip(value.toLowerCase(), 200), confidence: 0.7, selfStated: true, evidence: trimmed };
}

function extractNumber(text: string): Extraction | null {
  const match = new RegExp(`\\b${NUMBER_ALT}\\b`, "i").exec(text);
  if (!match) return null;
  const value = parseNumberToken(match[0]);
  if (value === null) return null;
  return { value: String(value), normalised: String(value), confidence: 0.85, selfStated: selfStatedBefore(text, match.index), evidence: match[0] };
}

const COUNT_UNITS: { pattern: string; unit: NonNullable<Extraction["unit"]> }[] = [
  { pattern: "(?:full[- ]time\\s+)?(?:staff|employees|people|members of staff|headcount|heads|of us|strong|person team|people team)", unit: "staff" },
  { pattern: "(?:users|seats|licen[cs]es|team members|people on the team|people using it|people would be using it)", unit: "users" },
  { pattern: "(?:devices|machines|laptops|pcs|computers|endpoints|workstations)", unit: "devices" },
  { pattern: "(?:orders|units|items|transactions|products)", unit: "items" },
];

/**
 * A team named by its function ("sales team", "support team"): a count of it
 * is the size of that team, not of the company. "We're a team of 12" (no
 * function named) stays a company headcount.
 */
const NAMED_TEAM =
  "(?:sales|marketing|support|customer service|customer success|success|service|dev|development|engineering|tech|technical|it|ops|operations|finance|accounts|accounting|design|product|recruitment|recruiting|hr|people|field|warehouse|admin|leadership|management|delivery|project|content|creative|data|analytics|bdr|sdr|account management|growth|revenue|contact centre|call centre|front desk|reception)";

type Located = Extraction & { index: number };

function extractNamedTeam(input: string): Located | null {
  const patterns = [
    // "a sales team of 12 people", "our support team is about 8"
    new RegExp(`\\b${NAMED_TEAM}\\s+team\\s+(?:of|is|has|with|numbers)\\s+(?:${HEDGE}\\s+)?(${NUMBER_ALT})\\b(?:\\s*(?:people|staff|users|members|reps|agents))?`, "i"),
    // "12 people in the sales team", "8 on our support team"
    new RegExp(`\\b(?:${HEDGE}\\s+)?(${NUMBER_ALT})\\s*(?:people|staff|users|members|reps|agents|of us)?\\s+(?:in|on)\\s+(?:the|our|my)\\s+${NAMED_TEAM}\\s+team\\b`, "i"),
    // "a 12-person sales team", "a twelve strong sales team"
    new RegExp(`\\b(${NUMBER_ALT})[- ](?:person|people|strong|seat)\\s+${NAMED_TEAM}\\s+team\\b`, "i"),
  ];
  for (const re of patterns) {
    const match = re.exec(input);
    if (!match) continue;
    const n = parseNumberToken(match[1]);
    if (n === null || n <= 0) continue;
    return {
      value: match[0].trim(),
      normalised: String(n),
      confidence: new RegExp(`\\b${HEDGE}\\b`, "i").test(match[0]) ? 0.85 : 0.9,
      selfStated: selfStatedBefore(input, match.index) || /\bour\b/i.test(match[0]),
      evidence: match[0].trim(),
      unit: "users",
      index: match.index,
    };
  }
  return null;
}

/**
 * Every count the reply states, earliest first, one per unit. A number inside
 * a named-team phrase ("a sales team of 12 people") is that team's size
 * (unit "users"), and is not also read as a company headcount.
 */
export function extractCounts(text: string): Extraction[] {
  const input = text.slice(0, MAX_INPUT);
  const found: Located[] = [];
  const team = extractNamedTeam(input);
  if (team) found.push(team);
  const inTeam = (index: number, length: number) =>
    team !== null && index < team.index + team.evidence.length && index + length > team.index;
  for (const { pattern, unit } of COUNT_UNITS) {
    const re = new RegExp(
      `\\b(?:about|around|roughly|approx(?:imately)?\\.?|circa|nearly|over|under|just over|just under|~)?\\s*(${NUMBER_ALT})(?:\\s*(?:-|to)\\s*(${NUMBER_ALT}))?\\s*\\+?\\s*${pattern}\\b`,
      "gi",
    );
    for (const match of input.matchAll(re)) {
      if (inTeam(match.index, match[0].length)) continue;
      const low = parseNumberToken(match[1]);
      const high = match[2] ? parseNumberToken(match[2]) : null;
      if (low === null) continue;
      if (found.some((f) => f.unit === unit)) break;
      const value = high !== null && high >= low ? Math.round((low + high) / 2) : low;
      const selfStated = selfStatedBefore(input, match.index);
      const hedged = high !== null || /\b(about|around|roughly|approx|circa|nearly|~)/i.test(match[0]);
      found.push({
        value: match[0].trim(),
        normalised: String(value),
        // A hedge or a range is part of what the lead told us ("we're about
        // 40 staff" states roughly 40), not doubt about what they said: when
        // they said it about themselves it is as readable as a bare number.
        // Only a hedged count not self-stated stays below the CONFIRMED bar
        // (defect MI-2: "Just to check, is it around 40 staff?" one message
        // after "We're about 40 staff").
        confidence: hedged ? (selfStated ? 0.9 : 0.85) : 0.95,
        selfStated,
        evidence: match[0].trim(),
        unit,
        index: match.index,
      });
      break;
    }
  }
  if (!found.some((f) => f.unit === "staff")) {
    const company = new RegExp(`\\b(?:team|company|business|firm) of (${NUMBER_ALT})\\b`, "i").exec(input);
    if (company && !inTeam(company.index, company[0].length)) {
      const n = parseNumberToken(company[1]);
      if (n !== null) {
        found.push({
          value: company[0],
          normalised: String(n),
          confidence: 0.9,
          selfStated: selfStatedBefore(input, company.index) || /^we|^i/i.test(input.trim()),
          evidence: company[0],
          unit: "staff",
          index: company.index,
        });
      }
    }
  }
  if (found.length === 0) {
    const justMe = /\b(just me|only me|on my own|sole trader|one[- ]man band)\b/i.exec(input);
    if (justMe) found.push({ value: justMe[0], normalised: "1", confidence: 0.9, selfStated: true, evidence: justMe[0], unit: "staff", index: justMe.index });
  }
  return found
    .sort((a, b) => a.index - b.index)
    .map((hit) => {
      const rest: Extraction & { index?: number } = { ...hit };
      delete rest.index;
      return rest;
    });
}

function extractCount(text: string): Extraction | null {
  return extractCounts(text)[0] ?? null;
}

const MONEY_RE =
  /(?:£\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|mn|million|grand)?|\b(\d[\d,]*(?:\.\d+)?)\s*(k|mn|million|grand|pounds|gbp|quid)\b)(\s*(?:a|per|\/)\s*(?:month|mo|pm|year|annum|yr)|\s*pcm|\s*p\.?a\.?)?/gi;

/**
 * Company revenue words. Turnover, revenue and ARR describe the size of the
 * lead's business (firmographic fit), not what they will spend with us:
 * "turnover around 900k" is not a £900k budget (defect MI-3).
 */
const REVENUE_WORDS =
  "turnover|turn over|turning over|turns over|turned over|revenues?|annual sales|sales of|arr|mrr|annual recurring revenue|monthly recurring revenue|recurring revenue|top[- ]line|t\\/o";
const REVENUE_BEFORE = new RegExp(`\\b(?:${REVENUE_WORDS})\\b`, "gi");
const REVENUE_AFTER = new RegExp(`^\\s*(?:(?:a|per|in)\\s+(?:year|annum)\\s+)?(?:(?:in|of)\\s+)?(?:annual\\s+|yearly\\s+)?(?:${REVENUE_WORDS})\\b`, "i");
const SPEND_WORDS = /\b(budget|budgeted|spend|spending|invest|investment|afford|pay|paying|fee|fees|price|cost|retainer)\b/gi;

type MoneyHit = { match: RegExpExecArray; amount: number; revenue: boolean };

function lastIndexOf(re: RegExp, text: string): number {
  let last = -1;
  for (const m of text.matchAll(re)) last = m.index ?? last;
  return last;
}

/** Every money amount in the text, each marked as company revenue or not. */
function moneyHits(input: string): MoneyHit[] {
  const hits: MoneyHit[] = [];
  for (const match of input.matchAll(MONEY_RE)) {
    const raw = (match[1] ?? match[3] ?? "").replace(/,/g, "");
    let amount = Number(raw);
    if (!Number.isFinite(amount)) continue;
    const suffix = (match[2] ?? match[4] ?? "").toLowerCase();
    if (suffix === "k" || suffix === "grand") amount *= 1_000;
    if (suffix === "m" || suffix === "mn" || suffix === "million") amount *= 1_000_000;
    const index = match.index ?? 0;
    // Revenue when the clause names revenue after the last spend word before
    // the amount ("budget of 20k, turnover around 900k"), or the amount is
    // followed by a revenue word ("£2m ARR", "900k turnover").
    const clause = clauseAround(input, index, match[0].length);
    const clauseStart = input.indexOf(clause);
    const before = clauseStart >= 0 && clauseStart <= index ? input.slice(clauseStart, index) : input.slice(Math.max(0, index - 40), index);
    const revenueAt = lastIndexOf(REVENUE_BEFORE, before);
    const spendAt = lastIndexOf(SPEND_WORDS, before);
    const after = input.slice(index + match[0].length, index + match[0].length + 40);
    const revenue = (revenueAt >= 0 && revenueAt > spendAt) || (spendAt < 0 && REVENUE_AFTER.test(after));
    hits.push({ match: match as RegExpExecArray, amount, revenue });
  }
  return hits;
}

function extractMoney(text: string): Extraction | null {
  const input = text.slice(0, MAX_INPUT);
  // A company's turnover, revenue or ARR is never a budget (defect MI-3).
  const hit = moneyHits(input).find((h) => !h.revenue);
  if (!hit) return null;
  const { match, amount } = hit;
  // The amount is normalised as stated; the period stays in `value`, so a
  // "£2k a month" retainer and a "£2k" project are not silently equated.
  return {
    value: match[0].trim(),
    normalised: String(Math.round(amount)),
    confidence: 0.9,
    selfStated: selfStatedBefore(input, match.index) || /\bbudget\b/i.test(input),
    evidence: match[0].trim(),
  };
}

/** The prefix a revenue-shaped COMPANY_SIZE value is normalised with. */
export const REVENUE_NORMALISED_PREFIX = "revenue:gbp:";

/**
 * Company revenue (turnover, revenue, ARR): firmographic fit, read into
 * COMPANY_SIZE as context, never into BUDGET. `normalised` is
 * `revenue:gbp:<amount>` so a headcount predicate ("fewer than 5 staff")
 * can never read a turnover as a number of people.
 */
export function extractRevenue(text: string): Extraction | null {
  const input = text.slice(0, MAX_INPUT);
  const hit = moneyHits(input).find((h) => h.revenue);
  if (!hit) return null;
  const index = hit.match.index ?? 0;
  const end = index + hit.match[0].length;
  const clause = clauseAround(input, index, hit.match[0].length);
  const clauseStart = Math.max(0, input.indexOf(clause));
  const before = input.slice(clauseStart, index);
  const word = [...before.matchAll(REVENUE_BEFORE)].pop();
  const after = REVENUE_AFTER.exec(input.slice(end));
  const start = word ? clauseStart + (word.index ?? 0) : index;
  const stop = after ? end + after[0].length : end;
  const phrase = clip(input.slice(start, stop), 200);
  return {
    value: phrase,
    normalised: `${REVENUE_NORMALISED_PREFIX}${Math.round(hit.amount)}`,
    confidence: 0.9,
    selfStated: selfStatedBefore(input, start) || /^\s*(we|our|i)\b/i.test(clause),
    evidence: phrase,
  };
}

/** Relative phrases this extractor reads itself, before falling back to timelineDays. */
const RELATIVE_TIMELINE: { pattern: RegExp; days: number }[] = [
  // "right now" but not "not right now" (that is a not-now, read below).
  { pattern: /\b(today|(?<!\bnot\s)right now|immediately|straight away|right away|asap|as soon as possible|urgently)\b/i, days: 3 },
  { pattern: /\b(tomorrow)\b/i, days: 1 },
  { pattern: /\b(this week|end of the week|by friday)\b/i, days: 5 },
  { pattern: /\b(next week)\b/i, days: 10 },
  { pattern: /\b(end of (the|this) month|this month|within (a|one) month|in a month|couple of weeks|few weeks|next few weeks)\b/i, days: 30 },
  { pattern: /\b(next month)\b/i, days: 45 },
  { pattern: /\b(this quarter|next couple of months|in (two|2) months)\b/i, days: 75 },
  { pattern: /\b(next quarter|in (three|3) months|in a few months)\b/i, days: 100 },
  { pattern: /\b(in (six|6) months|later this year|second half of the year|in the new year)\b/i, days: 180 },
  { pattern: /\b(next year|in a year|(twelve|12) months)\b/i, days: 365 },
];

/** A season, as a timeframe: "in the spring", "not until the summer", "late autumn". */
const SEASON =
  /\b(?:(?:not\s+)?(?:until|till|before|by|in|over|during|from|this|next)\s+)?(?:the\s+)?(early|late|mid[- ]?)?\s*(spring|summer|autumn|winter)\b/i;
const SEASON_START_MONTH: Record<string, number> = { spring: 2, summer: 5, autumn: 8, winter: 11 };

function seasonTimeline(input: string, now: Date): Extraction | null {
  const match = SEASON.exec(input);
  if (!match) return null;
  const offset = /late/i.test(match[1] ?? "") ? 2 : /mid/i.test(match[1] ?? "") ? 1 : 0;
  const month = SEASON_START_MONTH[match[2].toLowerCase()] + offset;
  let date = new Date(Date.UTC(now.getUTCFullYear(), month, 1));
  // Already in (or past) that season this year: "in the spring" said in
  // April means now; said in September it means next year's.
  const seasonEnd = new Date(Date.UTC(now.getUTCFullYear(), SEASON_START_MONTH[match[2].toLowerCase()] + 3, 1));
  if (date.getTime() < now.getTime()) date = now.getTime() < seasonEnd.getTime() ? now : new Date(Date.UTC(now.getUTCFullYear() + 1, month, 1));
  const days = Math.max(0, Math.round((date.getTime() - now.getTime()) / DAY_MS));
  const phrase = match[0].trim();
  return { value: phrase, normalised: String(days), confidence: 0.85, selfStated: true, evidence: phrase, statedDate: isoDate(date) };
}

/** A fault happening now, stated in the present tense. */
const ACTIVE_FAULT =
  /\b(?:(?:we(?:'ve| have)?|i(?:'ve| have)?|there(?:'s| is))\s+(?:got\s+)?an?\s+(?:bad\s+|big\s+|small\s+|new\s+)?(?:leak|burst pipe|outage|flood)|(?:is|are|keeps?|keep)\s+(?:still\s+)?(?:leaking|flooding|dripping|going down|crashing|falling over)|(?:has|have)\s+(?:just\s+)?(?:burst|collapsed|blown off|come off|gone down|stopped working))\b/i;

function extractTimeline(text: string, ctx?: ExtractorContext): Extraction | null {
  const input = text.slice(0, MAX_INPUT);
  const now = nowOf(ctx);
  // "in 3 months", "in about three months", "within roughly six weeks",
  // "over the next 12 months": digits or a spelled number, optionally hedged.
  const numeric = new RegExp(
    `\\b(?:in|within|over the next|next)\\s+(${HEDGE}\\s+)?(${NUMBER_ALT})\\s*(day|week|month|year)s?\\b`,
    "i",
  ).exec(input);
  const count = numeric ? parseNumberToken(numeric[2]) : null;
  if (numeric && count !== null && count > 0 && count <= 999) {
    const unitDays = { day: 1, week: 7, month: 30, year: 365 }[numeric[3].toLowerCase() as "day" | "week" | "month" | "year"];
    const days = count * unitDays;
    return {
      value: numeric[0],
      normalised: String(days),
      confidence: numeric[1] ? 0.85 : 0.9,
      selfStated: true,
      evidence: numeric[0],
      statedDate: isoDate(new Date(now.getTime() + days * DAY_MS)),
    };
  }
  for (const { pattern, days } of RELATIVE_TIMELINE) {
    const match = pattern.exec(input);
    if (match) {
      return {
        value: clauseAround(input, match.index, match[0].length).slice(0, 500) || match[0],
        normalised: String(days),
        confidence: 0.85,
        selfStated: true,
        evidence: match[0],
        statedDate: isoDate(new Date(now.getTime() + days * DAY_MS)),
      };
    }
  }
  const season = seasonTimeline(input, now);
  if (season) return season;
  const date = extractDate(input, ctx);
  if (date?.statedDate) {
    const days = Math.max(0, Math.round((Date.parse(`${date.statedDate}T00:00:00Z`) - now.getTime()) / DAY_MS));
    return { ...date, normalised: String(days) };
  }
  // "We've got a leak", "the server keeps going down": a fault happening now
  // answers "is it now, or something you're planning ahead for?" (defect
  // MI-2: the lead was asked "Is it leaking now?" after saying so).
  const fault = ACTIVE_FAULT.exec(input);
  if (fault) {
    return {
      value: clip(clauseAround(input, fault.index, fault[0].length) || fault[0], 500),
      normalised: "3",
      confidence: 0.9,
      selfStated: true,
      evidence: fault[0],
      statedDate: isoDate(new Date(now.getTime() + 3 * DAY_MS)),
    };
  }
  const days = timelineDays(input);
  if (days !== null) {
    return {
      value: clip(input, 200),
      normalised: String(days),
      confidence: 0.75,
      selfStated: true,
      evidence: clip(input, 200),
      statedDate: isoDate(new Date(now.getTime() + days * DAY_MS)),
    };
  }
  return null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

function monthIndex(token: string): number {
  const t = token.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(t));
}

function extractDate(text: string, ctx?: ExtractorContext): Extraction | null {
  const input = text.slice(0, MAX_INPUT);
  const now = nowOf(ctx);
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(input);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (!Number.isNaN(date.getTime())) {
      return { value: iso[0], normalised: isoDate(date), confidence: 0.95, selfStated: true, evidence: iso[0], statedDate: isoDate(date) };
    }
  }
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}\\b`, "i").exec(input);
  const monthDay = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i").exec(input);
  const monthOnly = new RegExp(`\\b(?:in|by|from|before|end of|start of|early|late|mid)[-\\s]+${MONTH_RE}\\b`, "i").exec(input);
  let day = 1;
  let month = -1;
  let evidence = "";
  if (dayMonth) {
    day = Number(dayMonth[1]);
    month = monthIndex(dayMonth[2]);
    evidence = dayMonth[0];
  } else if (monthDay) {
    day = Number(monthDay[2]);
    month = monthIndex(monthDay[1]);
    evidence = monthDay[0];
  } else if (monthOnly) {
    month = monthIndex(monthOnly[1]);
    day = /end of|late/i.test(monthOnly[0]) ? 28 : /mid/i.test(monthOnly[0]) ? 15 : 1;
    evidence = monthOnly[0];
  }
  if (month < 0 || day < 1 || day > 31) return null;
  let year = now.getUTCFullYear();
  let date = new Date(Date.UTC(year, month, day));
  if (date.getTime() < now.getTime() - DAY_MS) {
    year += 1;
    date = new Date(Date.UTC(year, month, day));
  }
  return { value: evidence, normalised: isoDate(date), confidence: 0.85, selfStated: true, evidence, statedDate: isoDate(date) };
}

function extractPostcode(text: string): Extraction | null {
  const upper = text.slice(0, MAX_INPUT).toUpperCase();
  const full = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/.exec(upper);
  if (full) {
    const value = `${full[1]} ${full[2]}`;
    return { value, normalised: value, confidence: 0.95, selfStated: true, evidence: text.slice(full.index, full.index + full[0].length) };
  }
  const outward = /\b(?:POSTCODE|POST CODE|IN|AROUND|NEAR)\s+(?:IS\s+)?([A-Z]{1,2}\d[A-Z\d]?)\b/.exec(upper);
  if (outward) {
    return { value: outward[1], normalised: outward[1], confidence: 0.8, selfStated: true, evidence: text.slice(outward.index, outward.index + outward[0].length) };
  }
  return null;
}

const DECISION_ROLES = "owner|founder|co-?founder|ceo|md|managing director|director|partner|cfo|cto|coo|finance director|chairman|chair|principal|proprietor";
const INFLUENCER_ROLES = "head of [a-z]+|[a-z]+ manager|manager|office manager|operations manager|it manager|team lead|lead";

function extractRole(text: string): Extraction | null {
  const input = text.slice(0, MAX_INPUT);
  const deferral =
    /\b(my|our) (boss|manager|director|md|ceo|board|partner|business partner|owner|finance director|finance team|it team|procurement(?: team)?) (decides|would decide|makes the (call|decision)|signs off|has the final say|needs to (approve|sign off|agree))|\b(need|have) to (check|run it past|speak|talk) (with|to|by) (my|our|the) (boss|manager|director|md|ceo|board|partner|business partner|owner|finance director|finance team|it team|procurement)|\bnot (my|the) (decision|call)\b|\bsomeone else (decides|makes)/i.exec(
      input,
    );
  if (deferral) {
    return { value: deferral[0], normalised: "NOT_DECISION_MAKER", confidence: 0.9, selfStated: true, evidence: deferral[0] };
  }
  const decide = /\b(i (decide|make the (call|decision)|sign (it )?off|have the final say)|it'?s my (call|decision)|i'?m the decision[- ]?maker)\b/i.exec(input);
  if (decide) return { value: decide[0], normalised: "DECISION_MAKER", confidence: 0.95, selfStated: true, evidence: decide[0] };
  const role = new RegExp(`\\bi(?:'m| am)\\s+(?:the\\s+|a\\s+|an\\s+|one of the\\s+)?(${DECISION_ROLES}|${INFLUENCER_ROLES})\\b`, "i").exec(input);
  if (role) {
    const name = role[1].toLowerCase();
    const decisionMaker = new RegExp(`^(${DECISION_ROLES})$`, "i").test(name);
    return {
      value: role[0],
      normalised: decisionMaker ? "DECISION_MAKER" : "INFLUENCER",
      confidence: decisionMaker ? 0.9 : 0.85,
      selfStated: true,
      evidence: role[0],
    };
  }
  return null;
}

const GENERIC_INCUMBENT = ["provider", "supplier", "agency", "vendor", "partner", "company", "contractor", "firm"];

function extractProvider(text: string, ctx?: ExtractorContext): Extraction | null {
  const input = text.slice(0, MAX_INPUT);
  const inHouse = /\b(in[- ]house|ourselves|we do it ourselves|our own (team|staff|people)|internal team)\b/i.exec(input);
  if (inHouse) return { value: inHouse[0], normalised: "IN_HOUSE", confidence: 0.9, selfStated: true, evidence: inHouse[0] };
  const none = /\b(no ?one|nobody|we don'?t have (one|an?|anyone)|haven'?t got (one|an?|anyone)|we don'?t use (one|anyone|anything)|nothing at the moment|not using anything)\b/i.exec(input);
  if (none) return { value: none[0], normalised: "NONE", confidence: 0.85, selfStated: true, evidence: none[0] };
  const competitors = (ctx?.competitorNames ?? []).filter((name) => name.trim().length > 1);
  for (const name of competitors) {
    const match = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").exec(input);
    if (match) return { value: match[0], normalised: `COMPETITOR:${name.toLowerCase()}`.slice(0, 200), confidence: 0.9, selfStated: selfStatedBefore(input, match.index), evidence: match[0] };
  }
  const terms = [...(ctx?.incumbentTerms ?? []), ...GENERIC_INCUMBENT]
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const incumbent = new RegExp(`\\b(our|current|existing|the|my)\\s+(?:current\\s+|existing\\s+)?(${terms.join("|")})(?:'s)?\\b`, "i").exec(input);
  if (incumbent) {
    return {
      value: incumbent[0].replace(/'s$/i, ""),
      normalised: "EXTERNAL_PROVIDER",
      confidence: /^(our|my|current|existing)/i.test(incumbent[1]) ? 0.9 : 0.75,
      selfStated: /^(our|my)$/i.test(incumbent[1]) || selfStatedBefore(input, incumbent.index),
      evidence: incumbent[0].replace(/'s$/i, ""),
    };
  }
  const using = /\bwe(?:'re| are)? (?:currently )?(?:use|using|with|on) ([A-Z][A-Za-z0-9&.-]{1,30}(?: [A-Z][A-Za-z0-9&.-]{1,30})?)\b/.exec(input);
  if (using) return { value: using[1], normalised: "EXTERNAL_PROVIDER", confidence: 0.75, selfStated: true, evidence: using[0] };
  return null;
}

function extractServiceName(text: string, ctx?: ExtractorContext): Extraction | null {
  const names = (ctx?.serviceNames ?? []).filter((name) => name.trim().length > 1);
  const found = names
    .map((name) => ({ name, match: new RegExp(`\\b${escapeRegExp(name.trim())}\\b`, "i").exec(text.slice(0, MAX_INPUT)) }))
    .filter((entry) => entry.match);
  if (found.length === 1) {
    const { name, match } = found[0];
    return { value: name, normalised: name.toLowerCase().slice(0, 200), confidence: 0.95, selfStated: true, evidence: match![0] };
  }
  if (found.length > 1) return null;
  // No workspace service named: the business type's own options. A buyer
  // often needs more than one ("year end accounts and corporation tax"), and
  // naming them all is still a full answer to "which do you need help with?".
  const input = text.slice(0, MAX_INPUT);
  const options = (ctx?.serviceTerms ?? [])
    .map((option) => ({ option, match: new RegExp(option.pattern, "i").exec(input) }))
    .filter((entry) => entry.match)
    .sort((a, b) => a.match!.index - b.match!.index);
  if (options.length === 0) return null;
  const labels = options.map((entry) => entry.option.label);
  const value = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  const first = options[0].match!;
  return {
    value,
    normalised: labels.map((l) => l.toLowerCase()).join("+").slice(0, 200),
    confidence: 0.9,
    selfStated: selfStatedBefore(input, first.index) || /^\s*(we|i|our|my)\b/i.test(input),
    evidence: first[0],
  };
}

/**
 * USE_CASE: what the lead wants the product to do, stated as a need for a
 * tool ("We need something to route inbound leads to the right rep
 * automatically"). Not an EXTRACTORS key: the planned USE_CASE question is
 * read with FREE_TEXT; this reads the same thing from a reply that was not
 * answering it (defect MI-2: the lead was then asked "What would you mainly
 * want the platform to handle for you?").
 */
const USE_CASE_PATTERN =
  /\b(?:need|needs|needing|want|wanting|looking for|after|require)\s+(?:something|a tool|a platform|a system|software|an app|a way|a solution|some software|a product|an easier way|a better way|a simple way|help)\s+(?:to|that|which|for|that can|that will|that would)\s+([a-z][^.!?\n]{8,})/i;

export function extractUseCase(text: string): Extraction | null {
  const input = text.slice(0, MAX_INPUT);
  const match = USE_CASE_PATTERN.exec(input);
  if (!match) return null;
  const clause = clauseAround(input, match.index, match[0].length) || match[0];
  const firstPerson = selfStatedBefore(input, match.index);
  return {
    value: clip(clause.replace(/[.!?]+$/, ""), 500),
    normalised: clip(match[1].toLowerCase(), 200),
    confidence: firstPerson ? 0.9 : 0.8,
    selfStated: firstPerson,
    evidence: match[0].trim(),
  };
}

/**
 * PRODUCT_INTEREST: a named product, plan or package ("I'm interested in the
 * standard fulfilment plan"). The lead was otherwise asked "Which product
 * were you looking at?" straight after naming it (defect MI-2).
 */
const PRODUCT_PATTERN =
  /\b(?:interested in|looking at|keen on|after|want|would like|i'd like|we'd like|enquiring about|asking about)\s+(?:the|your|a|an)\s+((?:[a-z0-9&+-]+\s+){0,4}?(?:plan|package|product|tier|bundle|subscription|edition|licen[cs]e|membership))\b/i;

export function extractProductInterest(text: string): Extraction | null {
  const input = text.slice(0, MAX_INPUT);
  const match = PRODUCT_PATTERN.exec(input);
  if (!match) return null;
  const firstPerson = selfStatedBefore(input, match.index) || /^\s*(i|we)\b/i.test(input);
  return {
    value: clip(match[1], 200),
    normalised: clip(match[1].toLowerCase(), 200),
    confidence: firstPerson ? 0.9 : 0.8,
    selfStated: firstPerson,
    evidence: match[0].trim(),
  };
}

const URGENT_HIGH =
  /\b(urgent(ly)?|asap|as soon as possible|right away|immediately|straight away|can'?t wait|cannot wait|today|tomorrow|this week|emergency|(is|are|went) down|not working at all|stopped working)\b/i;
const URGENT_MEDIUM =
  /\b(next month|end of (the|this) month|within (a|one|two|2) weeks?|in (a|two|2|a few) weeks|soon|contract (ends|expires|is up|runs out|finishes)|renewal (is )?(due|coming up)|coming up for renewal|deadline)\b/i;

function extractUrgency(text: string): Extraction | null {
  const input = text.slice(0, MAX_INPUT);
  const high = URGENT_HIGH.exec(input);
  if (high) return { value: high[0], normalised: "HIGH", confidence: 0.9, selfStated: true, evidence: high[0] };
  const medium = URGENT_MEDIUM.exec(input);
  if (medium) return { value: medium[0], normalised: "MEDIUM", confidence: 0.8, selfStated: true, evidence: medium[0] };
  return null;
}

/**
 * Unhappiness with the current situation. Verb phrases take any inflection
 * ("never replies", "never replied", "never replying"), and service failures
 * are read as failures whoever they are pinned on: "they miss deadlines",
 * "we keep missing deadlines", "always late", "hard to get hold of".
 */
const DISSATISFIED = new RegExp(
  [
    "terrible|awful|rubbish|useless|poor|appalling|shocking|hopeless|a nightmare|not happy|unhappy|fed up|frustrat\\w*",
    "let(?:ting)? (?:us|me) down|slow to (?:respond|reply|get back|answer)\\w*",
    // "never replies", "rarely answers", "doesn't get back to us", "won't return calls"
    "(?:never|rarely|hardly ever|seldom) (?:respond|repl(?:y|ies|ied|ying)|answer|pick(?:s|ed|ing)? up|get(?:s|ting)? back|return|call(?:s|ed)? (?:us|me) back)\\w*",
    "(?:doesn'?t|don'?t|won'?t|didn'?t|isn'?t|aren'?t) (?:ever )?(?:respond|reply|answer|get back|return (?:our|my) (?:calls|emails)|pick up)\\w*",
    // "missing deadlines", "missed the filing date", "always late", "keeps getting it wrong"
    // ...but not "we never miss a deadline" / "they don't miss calls".
    "(?<!\\b(?:never|don'?t|doesn'?t|didn'?t|won'?t|not|rarely)\\s)miss(?:es|ed|ing)? (?:(?:our|the|my|every|a|another) )?(?:deadlines?|filing (?:dates?|deadlines?)|dates|appointments|calls|emails)",
    "(?:always|constantly|often|keeps? being|kept being) late|keeps? (?:getting (?:it|things) wrong|making mistakes|forgetting|breaking|going down|failing|crashing)",
    "(?:hard|impossible|difficult) to (?:get hold of|reach|contact|pin down)|no (?:communication|response|reply|replies) from (?:them|him|her|our|my|the)|ignor(?:e|es|ed|ing) (?:us|me|our|my)",
    "not good enough|disappoint\\w*|sick of|had enough|isn'?t working|not working (?:well|for us|out)|struggl\\w*|not (?:great|good)|could be (?:a lot )?better",
  ]
    .map((part) => `(?:${part})`)
    .join("|")
    .replace(/^/, "\\b(?:")
    .concat(")\\b"),
  "i",
);

function extractDissatisfaction(text: string): Extraction | null {
  const input = text.slice(0, MAX_INPUT);
  const match = DISSATISFIED.exec(input);
  if (!match) return null;
  const clause = clauseAround(input, match.index, match[0].length) || match[0];
  return { value: clip(clause, 500), normalised: "DISSATISFIED", confidence: 0.9, selfStated: true, evidence: clause };
}

/* --------------------------------------------------- project scope */

/** Things a studio, agency or developer is asked to make. */
const DELIVERABLE =
  "(?:web ?site|site(?!\\s+(?:visit|survey|meeting|inspection|manager))|web ?app|mobile app|app|online (?:shop|store)|e-?commerce (?:site|store|shop)|shopify (?:site|store)|brand(?:ing)?|brand identity|visual identity|logo|landing pages?|customer portal|client portal|intranet|booking system|marketing campaign|ad campaign|explainer video|brand video)";
const SCOPE_VERB =
  "(?:need(?:s|ing)?|want(?:s|ing)?|looking for|after|require|build(?:ing)?|rebuild(?:ing)?|redesign(?:ing)?|refresh(?:ing)?|revamp(?:ing)?|overhaul(?:ing)?|create|creating|develop(?:ing)?|launch(?:ing)?|migrat(?:e|ing)|replatform(?:ing)?|move|moving)";
const SCOPE_PATTERNS: RegExp[] = [
  // "we need a new website", "looking to rebuild our booking system"
  new RegExp(
    `\\b${SCOPE_VERB}\\s+(?:to\\s+(?:build|rebuild|redesign|refresh|create|develop|launch|replace)\\s+)?(?:a|an|our|the|some|us|my)?\\s*(?:(?:new|complete|full|bespoke|custom|fresh|proper|modern|better|simple|small|whole)\\s+)*(?:[a-z-]+\\s+)?${DELIVERABLE}\\b`,
    "i",
  ),
  // "a redesign of our online shop", "a rebuild of the portal"
  new RegExp(`\\b(?:re-?design|rebuild|refresh|revamp|overhaul|migration|build|relaunch|replatform)\\s+of\\s+(?:our|the|my|a|an)\\s+(?:[a-z-]+\\s+){0,2}?${DELIVERABLE}\\b`, "i"),
  // "a new website for our practice"
  new RegExp(`\\b(?:a|an|our|the)\\s+new\\s+(?:[a-z-]+\\s+)?${DELIVERABLE}\\b`, "i"),
];

/**
 * PROJECT_SCOPE: what the lead wants made ("a new website", "a redesign of
 * our online shop"). Not an EXTRACTOR_KEYS entry: PROJECT_SCOPE's planned
 * question is read with FREE_TEXT; this reads the same thing incidentally
 * from a reply that was not answering it, so "we need a new website" is the
 * scope of the job rather than a stated problem.
 */
export function extractProjectScope(text: string): Extraction | null {
  const input = text.slice(0, MAX_INPUT);
  for (const re of SCOPE_PATTERNS) {
    const match = re.exec(input);
    if (!match) continue;
    const clause = clauseAround(input, match.index, match[0].length) || match[0];
    const firstPerson = selfStatedBefore(input, match.index) || FIRST_PERSON.test(match[0]);
    return {
      value: clip(clause, 500),
      normalised: clip(match[0].toLowerCase(), 200),
      confidence: firstPerson ? 0.9 : 0.8,
      selfStated: firstPerson,
      evidence: match[0],
    };
  }
  return null;
}

/** READY_TO_BUY > READY_TO_MEET > REPLACING > EXPLORING. */
export const READINESS_PATTERNS = {
  READY_TO_BUY:
    /\b(ready to (go|buy|sign|start|proceed|move forward|go ahead)|let'?s (do it|go ahead|get started|proceed)|(want|like) to (go ahead|sign up|get started|buy|purchase|order|proceed)|how do (i|we) (sign up|pay|buy|order|get started)|send (me|us) (the|a) (contract|invoice|payment link|order form)|where do i sign|take my money)\b/i,
  READY_TO_MEET:
    /\b(happy to (chat|talk|meet|have a call|jump on a call)|up for a (call|chat)|let'?s (talk|chat|meet|have a (call|chat))|open to a (call|chat|meeting)|keen to (chat|talk|meet))\b/i,
  REPLACING:
    /\b(looking to (replace|switch|change|move)|want(ing)? to (replace|switch|change|move away|leave)|switch(ing)? (provider|supplier|agency|from|over)|replace (our|them|the|it)|replacement|move away from|moving away from|contract (ends|expires|is up|runs out|finishes)|leaving (our|them)|find (a|someone) new|new (provider|supplier|agency|accountant|it company))\b/i,
  EXPLORING:
    /\b(just (looking|browsing|researching)|early days|exploring (options|the market)|gathering (info|information|quotes|prices)|not sure yet|weighing up)\b/i,
} as const;
export type Readiness = keyof typeof READINESS_PATTERNS;

/**
 * A negation just before a positive readiness match flips it: "not ready to
 * go ahead yet", "we don't want to sign up". EXPLORING is itself hedged
 * ("not sure yet"), so it is matched as written.
 */
const READINESS_NEGATION_BEFORE =
  /\b(not|never|no|don'?t|do not|isn'?t|aren'?t|won'?t|wouldn'?t|can'?t|cannot|haven'?t|hasn'?t|nowhere near)\b[^.!?,;]{0,20}$/i;

function readinessMatch(key: Readiness, input: string): RegExpExecArray | null {
  if (key === "EXPLORING") return READINESS_PATTERNS[key].exec(input);
  const pattern = new RegExp(READINESS_PATTERNS[key].source, "gi");
  for (let match = pattern.exec(input); match; match = pattern.exec(input)) {
    if (!READINESS_NEGATION_BEFORE.test(input.slice(Math.max(0, match.index - 40), match.index))) return match;
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return null;
}

function extractReadiness(text: string): Extraction | null {
  const input = text.slice(0, MAX_INPUT);
  for (const key of Object.keys(READINESS_PATTERNS) as Readiness[]) {
    const match = readinessMatch(key, input);
    if (match) {
      return {
        value: clip(clauseAround(input, match.index, match[0].length) || match[0], 500),
        normalised: key,
        confidence: key === "EXPLORING" ? 0.8 : 0.9,
        selfStated: true,
        evidence: match[0],
      };
    }
  }
  return null;
}

/** Every readiness level the reply states (a reply can be both REPLACING and READY_TO_MEET). */
export function readinessAll(text: string): { level: Readiness; evidence: string }[] {
  const input = text.slice(0, MAX_INPUT);
  const out: { level: Readiness; evidence: string }[] = [];
  for (const key of Object.keys(READINESS_PATTERNS) as Readiness[]) {
    const match = readinessMatch(key, input);
    if (match) out.push({ level: key, evidence: match[0] });
  }
  return out;
}

/* ------------------------------------------------------------ dispatch */

/**
 * Runs one extractor. Deterministic: the same text and context always give
 * the same result. Input is capped so a pasted essay cannot make the regexes
 * expensive.
 */
export function extract(key: ExtractorKey, text: string, ctx?: ExtractorContext): Extraction | null {
  const input = (text ?? "").slice(0, MAX_INPUT);
  if (!input.trim()) return null;
  switch (key) {
    case "YES_NO":
      return extractYesNo(input);
    case "CHOICE":
      return extractChoice(input, ctx);
    case "FREE_TEXT":
      return extractFreeText(input);
    case "NUMBER":
      return extractNumber(input);
    case "COUNT":
      return extractCount(input);
    case "MONEY":
      return extractMoney(input);
    case "TIMELINE":
      return extractTimeline(input, ctx);
    case "DATE":
      return extractDate(input, ctx);
    case "POSTCODE":
      return extractPostcode(input);
    case "ROLE_MENTION":
      return extractRole(input);
    case "PROVIDER_MENTION":
      return extractProvider(input, ctx);
    case "SERVICE_NAME":
      return extractServiceName(input, ctx);
    case "URGENCY":
      return extractUrgency(input);
    case "DISSATISFACTION":
      return extractDissatisfaction(input);
    case "READINESS":
      return extractReadiness(input);
  }
}
