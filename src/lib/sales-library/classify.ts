/**
 * Archetype resolution (design doc 04 §1, "Resolution order, deterministic first").
 *
 *   1. Companies House SIC 2007 codes → 2026 candidates (ONS correspondence,
 *      migration 0120) → archetypes.
 *   2. SIC 2026 codes, when the business already has them.
 *   3. Alias match on what the customer typed.
 *   4. Website text keywords.
 *   (5. An AI suggestion is stored separately as AI_SUGGESTED and never binding.
 *       It does not happen here: this module is deterministic.)
 *
 * The output is a ranked list of candidates with their evidence, plus a
 * `binding` flag. A result is binding only when one candidate is both confident
 * and clearly ahead of the next; otherwise the UI shows the candidates and a
 * person chooses. Many SIC 2007 codes map to several 2026 codes (01 §1), and
 * SIC cannot separate a shop from an ecommerce brand, so ambiguity is normal
 * and is reported rather than resolved by guessing.
 *
 * The SIC 2007 → 2026 lookup is passed in, so this stays pure: the server
 * wrapper reads `industry_code_mappings`, tests pass a small map.
 *
 * Pure module.
 */

import { ARCHETYPES } from "./archetypes.ts";
import type { Archetype } from "./types.ts";

export type ClassificationEvidenceSource =
  | "SIC_2007_MAPPED"
  | "SIC_2026"
  | "ALIAS"
  | "WEBSITE_KEYWORDS";

/** The `business_profiles.classification_source` vocabulary (migration 0121). */
export type ClassificationSource = "USER" | "COMPANIES_HOUSE" | "WEBSITE" | "AI_SUGGESTED";

export type ClassificationInput = {
  /** Dotted ("62.12/1") or Companies House five-digit ("62121") form. */
  sic2026Codes?: string[];
  /** Dotted ("62.01") or Companies House five-digit ("62012") form. */
  sic2007Codes?: string[];
  /** SIC 2007 class (dotted, e.g. "62.01") → SIC 2026 codes. */
  mapSic2007?: (sic2007Class: string) => string[];
  /** What the customer typed, e.g. "we're a Shopify web design studio". */
  aliasText?: string;
  /** Text or keywords taken from the business's own website. */
  websiteKeywords?: string[];
  /** Which source typed the alias text; defaults to USER. */
  aliasOrigin?: "USER" | "WEBSITE";
};

export type ClassificationEvidence = {
  source: ClassificationEvidenceSource;
  detail: string;
  confidence: number;
};

export type ArchetypeCandidate = {
  archetypeKey: string;
  confidence: number;
  /** The strongest single source behind this candidate. */
  source: ClassificationEvidenceSource;
  evidence: ClassificationEvidence[];
};

export type ClassificationResult = {
  candidates: ArchetypeCandidate[];
  best: string | null;
  binding: boolean;
  classificationSource: ClassificationSource | null;
  reason: string;
};

/** Source ceilings. A register code beats typed text beats website wording. */
const CONFIDENCE = {
  SIC_2026: 0.8,
  SIC_2007_MAPPED: 0.7,
  ALIAS_EXACT: 0.95,
  ALIAS_CONTAINED: 0.85,
  WEBSITE_BASE: 0.45,
  WEBSITE_PER_HIT: 0.1,
  WEBSITE_MAX: 0.75,
} as const;

export const BINDING_MIN_CONFIDENCE = 0.75;
export const BINDING_MIN_LEAD = 0.2;

/**
 * "62121" → "62.12/1"; "62120" → "62.12"; dotted input passes through. Returns
 * null for anything that is not a SIC-shaped code.
 */
export function normaliseSicCode(raw: string): string | null {
  const value = raw.trim();
  if (/^\d{2}(\.\d{1,2}(\/\d)?)?$/.test(value)) return value;
  const digits = /^(\d{2})(\d{2})(\d)$/.exec(value);
  if (!digits) return null;
  const [, division, klass, sub] = digits;
  return sub === "0" ? `${division}.${klass}` : `${division}.${klass}/${sub}`;
}

/** The class ("62.01") of any dotted SIC code, which is what 0120 maps from. */
export function sicClassOf(code: string): string {
  return code.split("/")[0];
}

/**
 * Hierarchical prefix match on dotted codes. "62.20" matches "62.20/1"; "43"
 * matches "43.21/3"; "62.1" does not match "62.20".
 */
export function sicPrefixMatches(prefix: string, code: string): boolean {
  if (code === prefix) return true;
  if (!code.startsWith(prefix)) return false;
  const next = code.charAt(prefix.length);
  // After a division ("43") the next char is "."; after a group ("62.1") it is a
  // digit (the class); after a class ("62.20") it is "/".
  if (/^\d{2}$/.test(prefix)) return next === ".";
  if (/^\d{2}\.\d$/.test(prefix)) return /\d/.test(next);
  return next === "/";
}

/** Archetypes whose most specific matching prefix is the longest, for one code. */
function archetypesForSic2026(code: string): { archetype: Archetype; specificity: number }[] {
  const hits: { archetype: Archetype; specificity: number }[] = [];
  for (const archetype of ARCHETYPES) {
    let best = -1;
    for (const prefix of archetype.sic2026Prefixes) {
      if (sicPrefixMatches(prefix, code)) best = Math.max(best, prefix.length);
    }
    if (best >= 0) hits.push({ archetype, specificity: best });
  }
  if (hits.length === 0) return [];
  const top = Math.max(...hits.map((hit) => hit.specificity));
  return hits.filter((hit) => hit.specificity === top);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(phrase)}($|[^a-z0-9])`, "i").test(haystack);
}

function normaliseText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function resolveArchetype(input: ClassificationInput): ClassificationResult {
  const evidence = new Map<string, ClassificationEvidence[]>();
  const add = (key: string, item: ClassificationEvidence) => {
    evidence.set(key, [...(evidence.get(key) ?? []), item]);
  };

  // 1–2. SIC codes. Confidence is split across ties so an ambiguous code can
  // never, on its own, look as certain as an unambiguous one.
  const sic2026 = (input.sic2026Codes ?? [])
    .map(normaliseSicCode)
    .filter((code): code is string => code !== null);
  for (const code of sic2026) {
    const hits = archetypesForSic2026(code);
    for (const { archetype } of hits) {
      add(archetype.key, {
        source: "SIC_2026",
        detail: `SIC 2026 ${code}`,
        confidence: CONFIDENCE.SIC_2026 / hits.length,
      });
    }
  }

  if (input.mapSic2007) {
    const classes2007 = [
      ...new Set(
        (input.sic2007Codes ?? [])
          .map(normaliseSicCode)
          .filter((code): code is string => code !== null)
          .map(sicClassOf),
      ),
    ];
    for (const klass of classes2007) {
      const targets = [...new Set(input.mapSic2007(klass))];
      for (const target of targets) {
        const hits = archetypesForSic2026(target);
        for (const { archetype } of hits) {
          add(archetype.key, {
            source: "SIC_2007_MAPPED",
            detail: `SIC 2007 ${klass} → 2026 ${target}`,
            confidence: CONFIDENCE.SIC_2007_MAPPED / (targets.length * hits.length),
          });
        }
      }
    }
  }

  // 3. Alias text.
  const aliasText = normaliseText(input.aliasText ?? "");
  if (aliasText) {
    for (const archetype of ARCHETYPES) {
      for (const alias of archetype.aliases) {
        if (aliasText === alias) {
          add(archetype.key, { source: "ALIAS", detail: `"${alias}"`, confidence: CONFIDENCE.ALIAS_EXACT });
        } else if (containsPhrase(aliasText, alias)) {
          add(archetype.key, { source: "ALIAS", detail: `"${alias}"`, confidence: CONFIDENCE.ALIAS_CONTAINED });
        }
      }
    }
  }

  // 4. Website keywords: several independent alias hits are needed to reach a
  // useful confidence, because marketing copy mentions many things.
  const website = normaliseText((input.websiteKeywords ?? []).join(" \n "));
  if (website) {
    for (const archetype of ARCHETYPES) {
      const hits = archetype.aliases.filter((alias) => containsPhrase(website, alias));
      if (hits.length > 0) {
        add(archetype.key, {
          source: "WEBSITE_KEYWORDS",
          detail: hits.slice(0, 5).map((hit) => `"${hit}"`).join(", "),
          confidence: Math.min(
            CONFIDENCE.WEBSITE_MAX,
            CONFIDENCE.WEBSITE_BASE + CONFIDENCE.WEBSITE_PER_HIT * (hits.length - 1),
          ),
        });
      }
    }
  }

  const candidates: ArchetypeCandidate[] = [...evidence.entries()].map(([archetypeKey, items]) => {
    // Within a source take the strongest item (two aliases for the same
    // archetype are one piece of evidence, not two); across sources combine
    // as independent evidence (noisy-or), capped below certainty.
    const bySource = new Map<ClassificationEvidenceSource, number>();
    for (const item of items) {
      bySource.set(item.source, Math.max(bySource.get(item.source) ?? 0, item.confidence));
    }
    const combined = 1 - [...bySource.values()].reduce((acc, c) => acc * (1 - c), 1);
    const strongest = [...bySource.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return {
      archetypeKey,
      confidence: round3(Math.min(0.99, combined)),
      source: strongest,
      evidence: items,
    };
  });

  candidates.sort(
    (a, b) => b.confidence - a.confidence || a.archetypeKey.localeCompare(b.archetypeKey),
  );

  if (candidates.length === 0) {
    return {
      candidates,
      best: null,
      binding: false,
      classificationSource: null,
      reason: "No SIC code, alias or website keyword matched an archetype.",
    };
  }

  const [top, second] = candidates;
  const lead = top.confidence - (second?.confidence ?? 0);
  const binding = top.confidence >= BINDING_MIN_CONFIDENCE && lead >= BINDING_MIN_LEAD;

  return {
    candidates,
    best: top.archetypeKey,
    binding,
    classificationSource: sourceFor(top.source, input.aliasOrigin ?? "USER"),
    reason: binding
      ? `Matched ${top.archetypeKey} from ${describe(top.source)}.`
      : second && lead < BINDING_MIN_LEAD
        ? `Ambiguous between ${top.archetypeKey} and ${second.archetypeKey}; a person should choose.`
        : `Best match ${top.archetypeKey} is not confident enough to apply automatically.`,
  };
}

function sourceFor(
  source: ClassificationEvidenceSource,
  aliasOrigin: "USER" | "WEBSITE",
): ClassificationSource {
  switch (source) {
    case "SIC_2007_MAPPED":
      return "COMPANIES_HOUSE";
    case "WEBSITE_KEYWORDS":
      return "WEBSITE";
    case "ALIAS":
      return aliasOrigin;
    case "SIC_2026":
      return "USER";
  }
}

function describe(source: ClassificationEvidenceSource): string {
  switch (source) {
    case "SIC_2007_MAPPED":
      return "the Companies House SIC code";
    case "SIC_2026":
      return "the SIC 2026 code";
    case "ALIAS":
      return "the business description";
    case "WEBSITE_KEYWORDS":
      return "the website";
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
