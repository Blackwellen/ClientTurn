/**
 * Intent evidence: what a buying signal is, where it came from, and how much
 * it counts.
 *
 * Pure -- no `server-only`, no Supabase -- so the sourcing run, the prospect
 * drawer and the tests all read the same vocabulary and the same arithmetic.
 *
 * ## Why every signal carries evidence
 *
 * A score that moved because "intent was detected" is a claim the customer has
 * to take on trust. A score that moved because "Companies House shows a share
 * allotment (SH01) filed on 12 August" is one they can check in thirty seconds.
 * Cold outreach is only defensible when it is grounded in something the sender
 * can show, so every intent result carries its kind, its source, a URL or
 * registry reference, the date it was observed and the text that matched.
 *
 * ## Only free, first-party sources
 *
 * Every kind here is produced by the company's own public website or by the
 * Companies House register. None depends on a paid data vendor.
 */

import {
  DEFAULT_TYPE_FOR_KIND,
  ROLE_FUNCTIONS,
  intentType,
  intentTypesForCategory,
  isIntentTypeId,
  type IntentTypeId,
  type RoleFunction,
} from "./intent-catalogue.ts";

/**
 * What was observed. Stored in the evidence summary and the dedupe key.
 *
 * These are the coarse kinds a category files evidence under. The finer
 * catalogue type (`intent-catalogue.ts`: SERIES_A, NEW_OFFICE, ...) travels on
 * the evidence as `intentType`.
 */
export const INTENT_EVIDENCE_KINDS = [
  /** A share allotment (SH01) on the register: new capital went in. */
  "FUNDING",
  /** A careers or jobs page naming a role the plan asked about. */
  "HIRING",
  /** A new director or officer appointed, from the register. Company-level. */
  "JOB_CHANGE",
  /** Incorporated inside the freshness window. */
  "NEW_COMPANY",
  /** The registered office changed (AD01): a possible move or expansion. */
  "EXPANSION",
  /** A technology the plan asked about, fingerprinted from the page HTML. */
  "TECHNOLOGY",
  /** A configured keyword on the site, or a recent news/press post. */
  "WEBSITE_MENTION",
  /** A growth announcement: launch, rebrand, relaunch, award, partnership, new region. */
  "GROWTH",
  /** A dated trigger: a tender, a filing deadline, an anniversary, accounts growth. */
  "TRIGGER_EVENT",
] as const;
export type IntentEvidenceKind = (typeof INTENT_EVIDENCE_KINDS)[number];

export const EVIDENCE_KIND_LABELS: Record<IntentEvidenceKind, string> = {
  FUNDING: "Raised new capital",
  HIRING: "Hiring",
  JOB_CHANGE: "Leadership change",
  NEW_COMPANY: "Newly incorporated",
  EXPANSION: "Moved registered office",
  TECHNOLOGY: "Uses a technology you target",
  WEBSITE_MENTION: "Mentioned on their website",
  GROWTH: "Growth announcement",
  TRIGGER_EVENT: "Trigger event",
};

/**
 * The `intent_events.signal_type` each kind is recorded under.
 *
 * That column is read as a `SignalSourceKey` by the Intent tab's source-usage
 * breakdown (`intent/queries.ts`), so it must stay in that vocabulary; the
 * finer-grained kind travels in the evidence summary and the dedupe key.
 */
export const EVIDENCE_SIGNAL_TYPE: Record<
  IntentEvidenceKind,
  "COMPANY_REGISTRY" | "COMPANY_WEBSITE" | "JOB_POSTING"
> = {
  FUNDING: "COMPANY_REGISTRY",
  JOB_CHANGE: "COMPANY_REGISTRY",
  NEW_COMPANY: "COMPANY_REGISTRY",
  EXPANSION: "COMPANY_REGISTRY",
  HIRING: "JOB_POSTING",
  TECHNOLOGY: "COMPANY_WEBSITE",
  WEBSITE_MENTION: "COMPANY_WEBSITE",
  GROWTH: "COMPANY_WEBSITE",
  TRIGGER_EVENT: "COMPANY_REGISTRY",
};

/**
 * The signal type for one piece of evidence, from where it actually came.
 *
 * A kind can now be evidenced by more than one source (a funding round from a
 * press page, an allotment from the register), so the source decides and the
 * kind is only the fallback.
 */
export function evidenceSignalType(
  evidence: Pick<IntentEvidence, "kind" | "source">,
): "COMPANY_REGISTRY" | "COMPANY_WEBSITE" | "JOB_POSTING" {
  const source = evidence.source.toLowerCase();
  if (source.includes("companies house")) return "COMPANY_REGISTRY";
  if (source.includes("careers")) return "JOB_POSTING";
  if (source.includes("website")) return evidence.kind === "HIRING" ? "JOB_POSTING" : "COMPANY_WEBSITE";
  return EVIDENCE_SIGNAL_TYPE[evidence.kind];
}

/** The evidence one signal carries. Every field is shown to the customer. */
export type IntentEvidence = {
  kind: IntentEvidenceKind;
  /** Human name of the source: "Companies House", "Company website". */
  source: string;
  /** A URL, or a registry reference such as a filing's transaction id. */
  reference: string | null;
  /** When the thing happened, where the source dates it; otherwise when we saw it. */
  observedAt: string;
  /** The text that matched, truncated. Never a person's name from the register. */
  snippet: string;
  /** The catalogue type, where the detector knows it. */
  intentType?: IntentTypeId | null;
  /** The business function of a role, for hiring and appointments. */
  roleFunction?: RoleFunction | null;
};

export const MAX_SNIPPET = 160;
export const MAX_SUMMARY = 300;

/** Whitespace-collapsed and cut on a word boundary, with an ellipsis. */
export function truncateSnippet(text: string, max: number = MAX_SNIPPET): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The sentence stored in `intent_events.evidence_summary` and shown under
 * "Why this lead". Kind first, because that is the reason; the quoted snippet
 * second, because that is the proof.
 */
export function evidenceSummary(evidence: IntentEvidence): string {
  const label =
    evidence.intentType && isIntentTypeId(evidence.intentType)
      ? intentType(evidence.intentType).label
      : EVIDENCE_KIND_LABELS[evidence.kind];
  const snippet = truncateSnippet(evidence.snippet);
  const line = snippet
    ? `${label} (${evidence.source}): "${snippet}"`
    : `${label} (${evidence.source})`;
  return line.length <= MAX_SUMMARY ? line : truncateSnippet(line, MAX_SUMMARY);
}

/* ------------------------------------------------------ recency weighting */

/**
 * How much one piece of evidence counts, from 0 to `max`.
 *
 *   * **Distinct hits** raise it with diminishing returns: three different
 *     roles on a careers page is stronger than one, but ten is not ten times
 *     stronger.
 *   * **Recency** scales it: content dated today counts in full, content at
 *     the edge of the freshness window counts half, and content outside the
 *     window counts nothing. Undated content is treated as mid-window rather
 *     than as fresh, because "we saw it today" says nothing about when it was
 *     written.
 *
 * The cap is the caller's, so a website mention can never be scored like a
 * register filing.
 */
export function recencyStrength(input: {
  hits: number;
  /** When the content is dated. Null when the source carries no date. */
  datedAt: string | null;
  now: Date;
  freshnessDays: number;
  max: number;
  base?: number;
}): number {
  const hits = Math.max(0, Math.floor(input.hits));
  if (hits === 0) return 0;

  // One hit is worth `base`; each further distinct hit adds less than the
  // last, approaching base + 0.45.
  const base = input.base ?? 0.25;
  const volume = base + 0.45 * (1 - Math.pow(0.6, hits - 1));

  let recency = 0.75;
  if (input.datedAt) {
    const age = (input.now.getTime() - new Date(input.datedAt).getTime()) / 86_400_000;
    if (!Number.isFinite(age)) recency = 0.75;
    else if (age > input.freshnessDays) return 0;
    else recency = 1 - 0.5 * Math.max(0, age) / Math.max(1, input.freshnessDays);
  }

  const strength = Math.min(input.max, volume * recency);
  return Math.round(Math.max(0, strength) * 1000) / 1000;
}

/** True when a dated event falls inside the window ending now. */
export function withinFreshness(
  datedAt: string | null | undefined,
  now: Date,
  freshnessDays: number,
): boolean {
  if (!datedAt) return false;
  const time = new Date(datedAt).getTime();
  if (!Number.isFinite(time)) return false;
  const age = (now.getTime() - time) / 86_400_000;
  return age >= -1 && age <= freshnessDays;
}

/* ------------------------------------------------- category <-> evidence */

/**
 * Which evidence kinds a workspace intent category collects.
 *
 * Categories are the customer's own named buckets ("New funding", "Hiring for
 * a related role"); structured evidence has to land in one because intent
 * events and prospect matches are keyed on a category. A category collects a
 * kind when its name or keywords speak that kind's language, or when it lists
 * the one source type that only that kind produces.
 */
const KIND_VOCABULARY: Record<Exclude<IntentEvidenceKind, "WEBSITE_MENTION">, RegExp> = {
  FUNDING: /\b(fund(ing|ed|raise)?|rais(e|ed|ing)|invest(ment|or|ed)?|series [a-e]|seed|capital|share (issue|allotment))\b/i,
  HIRING: /\b(hir(e|es|ing)|recruit(ing|ment)?|jobs?|vacanc(y|ies)|careers?|headcount)\b/i,
  JOB_CHANGE: /\b(leadership|director|appoint(ed|ment)?|new (ceo|cto|cfo|cmo|coo|md|head)|executive|board|job change)\b/i,
  NEW_COMPANY: /\b(incorporat(ed|ion)|newly formed|new (company|business)|start-?ups?|founded|launch(ed)?)\b/i,
  EXPANSION: /\b(expan(d|sion|ding)|new (office|location|premises|site)|relocat(e|ed|ion)|mov(e|ed|ing) office)\b/i,
  TECHNOLOGY: /\b(tech(nology|nologies)?|stack|platform|shopify|woocommerce|wordpress|webflow|hubspot|salesforce|intercom|stripe|magento|bigcommerce|squarespace|wix|zendesk|segment|klaviyo|mailchimp)\b/i,
  GROWTH: /\b(product launch|launch(es|ed)?|rebrand(ed|ing)?|new (brand|website|product|market)|relaunch(ed)?|awards?|accreditation|partnerships?|international expansion)\b/i,
  TRIGGER_EVENT: /\b(tenders?|rfp|procurement|deadline|anniversary|renewal|accounts (due|growth))\b/i,
};

export type CategoryShape = {
  name: string;
  keywords: string[];
  signalTypes?: string[];
};

export function kindsForCategory(category: CategoryShape): IntentEvidenceKind[] {
  const text = [category.name, ...category.keywords].join(" ");
  const kinds = new Set<IntentEvidenceKind>(["WEBSITE_MENTION"]);

  for (const [kind, pattern] of Object.entries(KIND_VOCABULARY) as [
    IntentEvidenceKind,
    RegExp,
  ][]) {
    if (pattern.test(text)) kinds.add(kind);
  }
  if ((category.signalTypes ?? []).includes("JOB_POSTING")) kinds.add("HIRING");
  // A category started from the catalogue collects its type's kind.
  for (const type of intentTypesForCategory(category)) kinds.add(intentType(type).evidenceKind);

  return INTENT_EVIDENCE_KINDS.filter((kind) => kinds.has(kind));
}

/**
 * The category name a search creates when it asked for a kind of signal and
 * the workspace has no category that collects it. Visible and editable in the
 * Intent tab like any other; it is a bucket, not data.
 */
export const EVIDENCE_KIND_CATEGORY_NAME: Record<IntentEvidenceKind, string> = {
  FUNDING: "Raised new capital",
  HIRING: "Hiring for a related role",
  JOB_CHANGE: "Leadership change",
  NEW_COMPANY: "Newly incorporated",
  EXPANSION: "Moved or expanded premises",
  TECHNOLOGY: "Uses a technology you target",
  WEBSITE_MENTION: "Mentioned on their website",
  GROWTH: "Growth announcement",
  TRIGGER_EVENT: "Trigger event",
};

/* ------------------------------------------------------------ dedupe key */

/**
 * The key one fact collapses to, per prospect.
 *
 * Evidence of a kind's default type (what was recorded before the catalogue)
 * keeps the old key exactly, so re-seeing an old filing is still a duplicate.
 * A finer type, or a role function, is appended as `t=TYPE/FUNCTION`, which
 * is also how a segment reads the type back from a stored event.
 */
export function intentDedupeKey(input: {
  domain: string;
  evidence: Pick<IntentEvidence, "kind" | "reference" | "intentType" | "roleFunction">;
  sourceUrl: string | null;
  observedAt: string;
  prospectId: string;
}): string {
  const parts = [
    input.domain,
    input.evidence.kind,
    input.evidence.reference ?? input.sourceUrl ?? "",
    input.observedAt.slice(0, 10),
    input.prospectId,
  ];
  const type = input.evidence.intentType ?? null;
  const fn = input.evidence.roleFunction ?? null;
  if ((type && type !== DEFAULT_TYPE_FOR_KIND[input.evidence.kind]) || fn) {
    parts.push(`t=${type ?? DEFAULT_TYPE_FOR_KIND[input.evidence.kind] ?? ""}${fn ? `/${fn}` : ""}`);
  }
  return parts.join(":");
}

/** The catalogue type and role function a stored dedupe key records. */
export function parseIntentDedupeKey(key: string): {
  kind: IntentEvidenceKind | null;
  intentType: IntentTypeId | null;
  roleFunction: RoleFunction | null;
} {
  const parts = key.split(":");
  const kind = (INTENT_EVIDENCE_KINDS as readonly string[]).includes(parts[1] ?? "")
    ? (parts[1] as IntentEvidenceKind)
    : null;
  const last = parts[parts.length - 1] ?? "";
  if (last.startsWith("t=")) {
    const [type, fn] = last.slice(2).split("/");
    return {
      kind,
      intentType: isIntentTypeId(type) ? type : null,
      roleFunction: (ROLE_FUNCTIONS as readonly string[]).includes(fn ?? "") ? (fn as RoleFunction) : null,
    };
  }
  return { kind, intentType: kind ? (DEFAULT_TYPE_FOR_KIND[kind] ?? null) : null, roleFunction: null };
}

/**
 * The keywords stored on an intent category.
 *
 * The category builder saves `{ terms: [...] }` while the sourcing run used to
 * read `{ keywords: [...] }`, so a customer's keywords never reached a run.
 * Both shapes are read.
 */
export function categoryKeywords(blob: unknown): string[] {
  const value = (blob && typeof blob === "object" ? blob : {}) as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ["terms", "keywords"]) {
    const list = value[key];
    if (Array.isArray(list)) {
      for (const item of list) if (typeof item === "string" && item.trim()) out.push(item.trim());
    }
  }
  return [...new Set(out)];
}
