/**
 * Competitor positioning (commercial rules, 0174; Settings -> AI & selling ->
 * Competitors).
 *
 * The workspace lists the competitors its leads mention, with the factual
 * comparison points it has approved and the lines it never wants said. What
 * the assistant may do with them, and nothing more:
 *
 *   * detect a mention deterministically, by name or alias, whole words only;
 *   * when one is mentioned, receive that competitor's approved points on the
 *     offer card, to use word for word or not at all;
 *   * never disparage a competitor or say anything about one that is not an
 *     approved point. `competitorClaimFailures` enforces it on every draft,
 *     whether or not the lead raised the competitor (the same retry ->
 *     hand-over path as the prohibited-claims guard).
 *
 * The check is sentence-level and deliberately strict: a sentence that names
 * a configured competitor and carries comparison or judgement wording must
 * contain one of that competitor's approved points verbatim (normalised). A
 * neutral mention ("happy to talk through how we compare with Acme") passes.
 * It cannot see a claim that never names the competitor ("they charge hidden
 * fees" in a later sentence); the prompt forbids that, and the never-say lines
 * are matched anywhere in the reply.
 *
 * Pure: zod only, relative `.ts` imports.
 */

import { z } from "zod";

export const MAX_COMPETITORS = 20;
export const MAX_APPROVED_POINTS = 8;
export const MAX_NEVER_SAY = 10;
export const MAX_ALIASES = 10;

const slug = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "Use lower-case letters, numbers and hyphens.");
const plain = (max: number) => z.string().trim().min(1).max(max);

export const competitorSchema = z.object({
  id: slug,
  name: z.string().trim().min(2).max(80),
  aliases: z.array(z.string().trim().min(2).max(60)).max(MAX_ALIASES).default([]),
  /** Factual comparison points the business stands behind. Quoted, never added to. */
  approvedPoints: z.array(plain(240)).max(MAX_APPROVED_POINTS).default([]),
  /** Lines never to say about this competitor. Blocked anywhere in a reply. */
  neverSay: z.array(plain(160)).max(MAX_NEVER_SAY).default([]),
  enabled: z.boolean().default(true),
});
export type Competitor = z.infer<typeof competitorSchema>;

/**
 * Words that make a statement a put-down rather than a comparison. Refused in
 * the business's own approved points, and in any reply sentence that names a
 * competitor, whatever else it says.
 */
export const DISPARAGING =
  /\b(terrible|awful|rubbish|useless|incompetent|dodgy|shoddy|scam\w*|rip[\s-]?off\w*|cowboys?|crooks?|liars?|lying|dishonest|shady|con\s?artists?|garbage|crap|hopeless|pathetic|worst)\b/i;

/** Comparison or judgement wording: a sentence with this and a competitor's name is a claim. */
const CLAIM_CUE =
  /\b(better|best|worse|cheaper|pricier|dearer|more|less|fewer|faster|slower|than|unlike|beats?|outperforms?|superior|inferior|lacks?|lacking|missing|cannot|can'?t|don'?t|doesn'?t|won'?t|isn'?t|aren'?t|wasn'?t|never|always|only|poor|bad|unreliable|expensive|overpriced|hidden|slow|buggy|outdated|problems?|issues?|complaints?|charges?|fees?|contracts?|lock[\s-]?in|switch(?:ed|ing)?|leav(?:e|ing))\b/i;

export function normaliseText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'/g, "")
    .replace(/[^a-z0-9£%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const needle = normaliseText(phrase);
  return needle.length >= 2 && ` ${normaliseText(haystack)} `.includes(` ${needle} `);
}

/** The names a competitor is recognised by: its name and aliases. */
export function competitorNames(competitor: Pick<Competitor, "name" | "aliases">): string[] {
  const seen = new Set<string>();
  return [competitor.name, ...competitor.aliases].filter((n) => {
    const key = normaliseText(n);
    if (key.length < 2 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Validates stored rows; an invalid row is reported, never half-used. */
export function parseCompetitorRows(rows: readonly unknown[]): { competitors: Competitor[]; invalid: number } {
  const competitors: Competitor[] = [];
  let invalid = 0;
  for (const row of rows) {
    const parsed = competitorSchema.safeParse(row);
    if (parsed.success) competitors.push(parsed.data);
    else invalid += 1;
  }
  competitors.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { competitors: competitors.slice(0, MAX_COMPETITORS), invalid };
}

/** Enabled competitors named in any of these texts (the lead's own words), in list order. */
export function detectCompetitorMentions(
  texts: readonly (string | null | undefined)[],
  competitors: readonly Competitor[],
): Competitor[] {
  const joined = texts.filter(Boolean).join("\n").slice(0, 8000);
  if (!joined) return [];
  return competitors.filter((c) => c.enabled && competitorNames(c).some((name) => containsPhrase(joined, name)));
}

/**
 * Problems with the business's own text before it is saved: an approved
 * point that disparages, or one that does not name the competitor at all (a
 * point about "them" cannot be checked against the reply).
 */
export function competitorTextProblems(competitor: Competitor): string | null {
  for (const point of competitor.approvedPoints) {
    if (DISPARAGING.test(normaliseText(point))) {
      return `"${point.slice(0, 60)}": approved points must be factual comparisons, not put-downs. Remove the judgement word.`;
    }
  }
  const names = competitorNames(competitor);
  for (const line of competitor.neverSay) {
    if (normaliseText(line).length < 3) return `"${line}": a never-say line needs at least a few words.`;
  }
  if (names.length === 0) return "Give the competitor a name.";
  return null;
}

/* ------------------------------------------------------------- validator */

export type CompetitorRule = {
  name: string;
  names: string[];
  approvedPoints: string[];
  neverSay: string[];
};

export function competitorRules(competitors: readonly Competitor[]): CompetitorRule[] {
  return competitors
    .filter((c) => c.enabled)
    .map((c) => ({ name: c.name, names: competitorNames(c), approvedPoints: c.approvedPoints, neverSay: c.neverSay }));
}

export type CompetitorFailure = {
  code: "UNAPPROVED_COMPETITOR_CLAIM";
  detail: string;
  correction: string;
};

function sentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Blocks what the assistant may not say about a competitor: a never-say line
 * anywhere; a put-down in a sentence naming one; and a comparison or judgement
 * about one that is not one of its approved points, word for word.
 */
export function competitorClaimFailures(body: string, rules: readonly CompetitorRule[]): CompetitorFailure[] {
  if (rules.length === 0 || !body.trim()) return [];
  const failures: CompetitorFailure[] = [];

  for (const rule of rules) {
    const neverSaid = rule.neverSay.filter((line) => containsPhrase(body, line));
    if (neverSaid.length > 0) {
      failures.push({
        code: "UNAPPROVED_COMPETITOR_CLAIM",
        detail: `Said a never-say line about ${rule.name}: ${neverSaid.map((l) => `"${l}"`).join(", ")}.`,
        correction: `Never say ${neverSaid.map((l) => `"${l}"`).join(", ")}. Remove it.`,
      });
    }
  }

  for (const sentence of sentences(body)) {
    for (const rule of rules) {
      if (!rule.names.some((name) => containsPhrase(sentence, name))) continue;
      const approved = rule.approvedPoints.some((point) => {
        const p = normaliseText(point);
        return p.length > 0 && ` ${normaliseText(sentence)} `.includes(` ${p} `);
      });
      const plainSentence = normaliseText(sentence);
      if (DISPARAGING.test(plainSentence)) {
        failures.push({
          code: "UNAPPROVED_COMPETITOR_CLAIM",
          detail: `Disparaged ${rule.name}: "${sentence.slice(0, 120)}".`,
          correction: `Never criticise ${rule.name}. Remove the sentence, or use one of its approved points word for word.`,
        });
      } else if (!approved && CLAIM_CUE.test(plainSentence)) {
        failures.push({
          code: "UNAPPROVED_COMPETITOR_CLAIM",
          detail: `Made a claim about ${rule.name} that is not an approved point: "${sentence.slice(0, 120)}".`,
          correction: rule.approvedPoints.length
            ? `Say nothing about ${rule.name} except these approved points, word for word: ${rule.approvedPoints.map((p) => `"${p}"`).join("; ")}. Otherwise talk only about what the business offers.`
            : `There are no approved points about ${rule.name}. Do not compare with or comment on them; talk only about what the business offers.`,
        });
      }
    }
  }
  return failures;
}

/* ---------------------------------------------------------- offer card */

/** Offer-card lines for the competitors this lead mentioned. */
export function competitorCardLines(mentioned: readonly Competitor[]): { approved: string[]; neverSay: string[] } {
  const approved: string[] = [];
  const neverSay: string[] = [];
  for (const c of mentioned) {
    for (const point of c.approvedPoints) approved.push(`${c.name}: ${point}`);
    for (const line of c.neverSay) neverSay.push(`${c.name}: ${line}`);
  }
  return { approved, neverSay };
}
