/**
 * The qualification fact store's rules (design 08 §B.12, CD-5), `qf-1`.
 *
 * Stored states: CONFIRMED / INFERRED / CONFLICTING / REJECTED. UNKNOWN is the
 * absence of a live fact and is only ever derived.
 *
 *   CONFIRMED    the lead's own answer to that dimension, an exact form-answer
 *                match, or a person setting it. Never asked again; may gate.
 *   INFERRED     a lead field, enrichment, CRM, the AI assist (>= 0.85, never
 *                more), or an incidental mention. Not asked; if MATERIAL it is
 *                verified before it can gate anything.
 *   CONFLICTING  two live facts disagree and neither supersedes. Excluded from
 *                the score and the gates until a person or a direct answer
 *                resolves it.
 *   REJECTED     a person rejected an inference, so the same inference is not
 *                re-made.
 *
 * Validity windows: TIMING until the stated date + 14 d; BUDGET and AUTHORITY
 * 180 d; CURRENT_SOLUTION 365 d. An expired fact is "last known": shown as
 * INFERRED + stale, counted for nothing, and re-verified (goal F nurture
 * remembers without trusting stale facts).
 *
 * UNKNOWN is not NEGATIVE: an unknown dimension lowers completeness and
 * confidence, never a score cap.
 *
 * Pure: no `server-only`, no Supabase, relative `.ts` imports.
 */

import {
  AI_EXTRACTION_MIN_CONFIDENCE,
  ALWAYS_MATERIAL_DIMENSIONS,
  FACT_VALIDITY_DAYS,
  FACT_VALUE_NORMALISED_MAX,
  TIMING_VALID_AFTER_STATED_DAYS,
  UNMAPPED_DIMENSION,
  type DimensionStatus,
  type DimensionStatusEntry,
  type FactDimension,
  type FactSource,
  type FactState,
  type QiDimensionKey,
  type QualificationFact,
  type QualificationFactWrite,
} from "./types.ts";
import { timelineDays } from "../scoring/answer-features.ts";

const DAY_MS = 86_400_000;

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function at(now: Date | string): number {
  return typeof now === "string" ? (ms(now) ?? Date.now()) : now.getTime();
}

/* ============================================================ values */

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};

const NUMERIC_DIMENSIONS = new Set<FactDimension>(["COMPANY_SIZE", "TEAM_SIZE", "VOLUME", "STAKEHOLDERS"]);

/**
 * A comparable form of a value: lower case, trimmed, whitespace collapsed;
 * counts and money reduced to their number ("40 staff" and "forty" agree),
 * so two sources that say the same thing are not reported as a conflict.
 */
export function normaliseFactValue(dimension: FactDimension, value: string): string | null {
  const text = value.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  if (!text) return null;

  if (NUMERIC_DIMENSIONS.has(dimension)) {
    const digits = /(\d[\d,]*)(\s?k\b)?/.exec(text);
    if (digits) {
      const n = Number(digits[1].replace(/,/g, "")) * (digits[2] ? 1000 : 1);
      if (Number.isFinite(n)) return String(n);
    }
    const word = Object.keys(WORD_NUMBERS).find((w) => new RegExp(`\\b${w}\\b`).test(text));
    if (word) return String(WORD_NUMBERS[word]);
  }

  if (dimension === "BUDGET") {
    const money = /[£$€]?\s?(\d[\d,.]*)\s?(k|m|grand)?\b/.exec(text);
    if (money) {
      const base = Number(money[1].replace(/,/g, ""));
      const mult = money[2] === "m" ? 1_000_000 : money[2] ? 1000 : 1;
      if (Number.isFinite(base)) return `gbp:${Math.round(base * mult)}`;
    }
  }

  if (dimension === "LOCATION") {
    // UK postcode outward code, if present: "SW1A 1AA" and "sw1a" agree.
    const postcode = /\b([a-z]{1,2}\d[a-z\d]?)\s?\d[a-z]{2}\b/.exec(text) ?? /^([a-z]{1,2}\d[a-z\d]?)$/.exec(text);
    if (postcode) return `pc:${postcode[1]}`;
  }

  if (dimension === "TIMING") {
    const days = timelineDays(text);
    if (days !== null) return `days:${days}`;
  }

  return text.replace(/[.!,;:]+$/g, "").slice(0, FACT_VALUE_NORMALISED_MAX);
}

function normOf(fact: Pick<QualificationFact, "dimension" | "value" | "valueNormalised">): string | null {
  return fact.valueNormalised ?? normaliseFactValue(fact.dimension, fact.value);
}

/**
 * valid_until for a new fact (§B.12). TIMING: the stated date + 14 d, where
 * the date is given or readable from the value; otherwise none.
 */
export function factValidUntil(
  dimension: FactDimension,
  observedAt: string,
  opts: { value?: string | null; statedDate?: string | null } = {},
): string | null {
  const observed = ms(observedAt) ?? Date.now();
  if (dimension === "TIMING") {
    let stated = ms(opts.statedDate ?? null);
    if (stated === null && opts.value) {
      const days = timelineDays(opts.value);
      if (days !== null) stated = observed + days * DAY_MS;
    }
    return stated === null ? null : new Date(stated + TIMING_VALID_AFTER_STATED_DAYS * DAY_MS).toISOString();
  }
  if (dimension === UNMAPPED_DIMENSION) return null;
  const days = FACT_VALIDITY_DAYS[dimension as QiDimensionKey];
  return days ? new Date(observed + days * DAY_MS).toISOString() : null;
}

/* ============================================================ liveness */

/** Not superseded, not rejected. */
export function isFactLive(fact: Pick<QualificationFact, "supersededAt" | "state">): boolean {
  return fact.supersededAt === null && fact.state !== "REJECTED";
}

/** Past its validity window: "last known", not trusted. */
export function isFactStale(fact: Pick<QualificationFact, "validUntil">, now: Date | string): boolean {
  const until = ms(fact.validUntil);
  return until !== null && until <= at(now);
}

/* =========================================================== materiality */

export type MaterialityContext = {
  /** The offer's / policy's requiredDimensions. */
  requiredDimensions?: readonly QiDimensionKey[];
  /** Dimensions named by a hard_fail qualification rule or an offer disqualifier. */
  ruleDimensions?: readonly QiDimensionKey[];
  /** A service-area rule exists, so LOCATION gates. */
  serviceAreaRule?: boolean;
};

/** Material: an INFERRED value must be verified before it can gate (§B.12). */
export function isMaterialDimension(dimension: FactDimension, ctx: MaterialityContext = {}): boolean {
  if (dimension === UNMAPPED_DIMENSION) return false;
  if ((ALWAYS_MATERIAL_DIMENSIONS as readonly string[]).includes(dimension)) return true;
  if (ctx.requiredDimensions?.includes(dimension)) return true;
  if (ctx.ruleDimensions?.includes(dimension)) return true;
  return dimension === "LOCATION" && ctx.serviceAreaRule === true;
}

/* ================================================================ merge */

export type FactMergeDecision = {
  action: "INSERT" | "SKIP";
  /** The state to insert with (CONFLICTING when this write creates a conflict). */
  state: FactState;
  /** Live facts this write supersedes (set superseded_at). */
  supersede: string[];
  /** Live facts that now conflict with this write (set state = CONFLICTING). */
  markConflicting: string[];
  reason: string;
};

/** A person or the lead's direct answer to the question: replaces whatever was there. */
const AUTHORITATIVE: ReadonlySet<FactSource> = new Set(["MANUAL", "ANSWER"]);

function sameSlot(existing: QualificationFact, incoming: QualificationFactWrite): boolean {
  if (existing.source !== incoming.source) return false;
  if (incoming.question_id || existing.questionId) return existing.questionId === incoming.question_id;
  return true;
}

/**
 * How one new fact combines with a lead's live facts for the same dimension.
 * Deterministic; the service applies the decision in one pass.
 *
 *   * The same (source, source_ref) again is a no-op (a retried job).
 *   * A REJECTED inference is not re-made with the same value.
 *   * MANUAL and ANSWER confirmations supersede everything, conflicts included:
 *     that is how a conflict is resolved.
 *   * Another confirmation (a form, an unambiguous self-statement) that
 *     disagrees with a live confirmation is a CONFLICT; agreeing is a no-op.
 *   * An inference never overrides a confirmation or an open conflict, and
 *     one that disagrees with another source's inference is a CONFLICT,
 *     except the AI assist, which never creates or resolves a conflict.
 *   * A newer reading from the same slot (source + question) supersedes the
 *     older one, and a new fact always supersedes stale ("last known") ones.
 */
export function mergeFact(
  existing: readonly QualificationFact[],
  incoming: QualificationFactWrite,
  now: Date | string,
): FactMergeDecision {
  const norm = incoming.value_normalised ?? normaliseFactValue(incoming.dimension, incoming.value);
  const live = existing.filter((f) => f.dimension === incoming.dimension && f.supersededAt === null);

  if (incoming.source_ref && live.some((f) => f.source === incoming.source && f.sourceRef === incoming.source_ref)) {
    return { action: "SKIP", state: incoming.state, supersede: [], markConflicting: [], reason: "duplicate source event" };
  }
  if (incoming.source === "AI_ASSIST" && (incoming.state === "CONFIRMED" || incoming.confidence < AI_EXTRACTION_MIN_CONFIDENCE)) {
    return { action: "SKIP", state: incoming.state, supersede: [], markConflicting: [], reason: "AI assist below the floor or claiming confirmation" };
  }
  if (incoming.state === "REJECTED" || incoming.state === "CONFLICTING") {
    // Written by a person's review or by the merge itself: stored as given.
    const covered = live.filter((f) => f.state !== "REJECTED" && normOf(f) === norm).map((f) => f.id);
    return { action: "INSERT", state: incoming.state, supersede: incoming.state === "REJECTED" ? covered : [], markConflicting: [], reason: "stored as given" };
  }
  if (incoming.state === "INFERRED" && live.some((f) => f.state === "REJECTED" && normOf(f) === norm)) {
    return { action: "SKIP", state: incoming.state, supersede: [], markConflicting: [], reason: "a person rejected this inference" };
  }

  const active = live.filter((f) => f.state !== "REJECTED");
  const stale = active.filter((f) => isFactStale(f, now));
  const fresh = active.filter((f) => !isFactStale(f, now));
  const slot = fresh.filter((f) => sameSlot(f, incoming) && f.state !== "CONFLICTING");
  const others = fresh.filter((f) => !slot.includes(f));
  const ids = (list: readonly QualificationFact[]) => list.map((f) => f.id);

  if (incoming.state === "CONFIRMED") {
    if (AUTHORITATIVE.has(incoming.source)) {
      const same = others.find((f) => f.state === "CONFIRMED" && f.source === incoming.source && normOf(f) === norm);
      if (same && slot.length === 0 && stale.length === 0 && !others.some((f) => f.state !== "CONFIRMED")) {
        return { action: "SKIP", state: "CONFIRMED", supersede: [], markConflicting: [], reason: "already confirmed" };
      }
      return { action: "INSERT", state: "CONFIRMED", supersede: ids(active), markConflicting: [], reason: "authoritative confirmation" };
    }
    const disagree = others.filter((f) => (f.state === "CONFIRMED" || f.state === "CONFLICTING") && normOf(f) !== norm);
    if (disagree.length > 0) {
      return {
        action: "INSERT",
        state: "CONFLICTING",
        supersede: ids([...slot, ...stale, ...others.filter((f) => f.state === "INFERRED")]),
        markConflicting: ids(disagree.filter((f) => f.state !== "CONFLICTING")),
        reason: "disagrees with a live confirmation",
      };
    }
    if (others.some((f) => f.state === "CONFIRMED" && normOf(f) === norm) && slot.length === 0) {
      return { action: "SKIP", state: "CONFIRMED", supersede: ids(stale), markConflicting: [], reason: "already confirmed" };
    }
    return { action: "INSERT", state: "CONFIRMED", supersede: ids([...slot, ...stale, ...others.filter((f) => f.state === "INFERRED")]), markConflicting: [], reason: "confirmed" };
  }

  // INFERRED
  if (others.some((f) => f.state === "CONFIRMED" || f.state === "CONFLICTING")) {
    return { action: "SKIP", state: "INFERRED", supersede: [], markConflicting: [], reason: "a confirmation or an open conflict outranks an inference" };
  }
  if (others.some((f) => normOf(f) === norm) || slot.some((f) => normOf(f) === norm)) {
    return { action: "SKIP", state: "INFERRED", supersede: [], markConflicting: [], reason: "already inferred" };
  }
  const disagree = others.filter((f) => f.state === "INFERRED" && normOf(f) !== norm);
  if (disagree.length > 0) {
    if (incoming.source === "AI_ASSIST" || disagree.every((f) => f.source === "AI_ASSIST")) {
      // The AI assist neither creates nor resolves a conflict. A deterministic
      // inference replaces an AI one; an AI one never replaces anything.
      if (incoming.source === "AI_ASSIST") {
        return { action: "SKIP", state: "INFERRED", supersede: [], markConflicting: [], reason: "AI assist does not override an inference" };
      }
      return { action: "INSERT", state: "INFERRED", supersede: ids([...slot, ...stale, ...disagree]), markConflicting: [], reason: "replaces an AI-assist inference" };
    }
    return {
      action: "INSERT",
      state: "CONFLICTING",
      supersede: ids([...slot, ...stale]),
      markConflicting: ids(disagree),
      reason: "disagrees with another source's inference",
    };
  }
  return { action: "INSERT", state: "INFERRED", supersede: ids([...slot, ...stale]), markConflicting: [], reason: "inferred" };
}

/* ======================================================= derived status */

export type DimensionStatusContext = MaterialityContext & {
  /** The dimensions the plan covers, in asking order (listed even when UNKNOWN). */
  planDimensions?: readonly FactDimension[];
  /** Goal threshold + requiredDimensions: what completeness is measured against. */
  required?: readonly QiDimensionKey[];
};

/**
 * One status per dimension: every plan dimension (UNKNOWN when nothing is
 * known), then any other dimension a live fact covers. Deterministic order.
 */
export function deriveDimensionStatuses(
  facts: readonly QualificationFact[],
  now: Date | string,
  ctx: DimensionStatusContext = {},
): DimensionStatusEntry[] {
  const live = facts.filter(isFactLive);
  const byDimension = new Map<FactDimension, QualificationFact[]>();
  for (const f of live) {
    const list = byDimension.get(f.dimension) ?? [];
    list.push(f);
    byDimension.set(f.dimension, list);
  }
  const required = new Set<string>(ctx.required ?? []);
  const order: FactDimension[] = [];
  for (const d of [...(ctx.planDimensions ?? []), ...(ctx.required ?? []), ...[...byDimension.keys()].sort()]) {
    if (!order.includes(d)) order.push(d);
  }

  const idsOf = (list: QualificationFact[]) =>
    [...list].sort((a, b) => (ms(b.observedAt) ?? 0) - (ms(a.observedAt) ?? 0) || (a.id < b.id ? -1 : 1)).slice(0, 10).map((f) => f.id);

  return order.map((dimension) => {
    const list = byDimension.get(dimension) ?? [];
    const fresh = list.filter((f) => !isFactStale(f, now));
    const conflicting = list.filter((f) => f.state === "CONFLICTING");
    const confirmed = fresh.filter((f) => f.state === "CONFIRMED");
    const inferred = fresh.filter((f) => f.state === "INFERRED");

    let status: DimensionStatus = "UNKNOWN";
    let factIds: string[] = [];
    let stale = false;
    if (conflicting.length > 0) {
      status = "CONFLICTING";
      factIds = idsOf(conflicting);
    } else if (confirmed.length > 0) {
      status = "CONFIRMED";
      factIds = idsOf(confirmed);
    } else if (inferred.length > 0) {
      const values = new Set(inferred.map((f) => normOf(f)));
      status = values.size > 1 ? "CONFLICTING" : "INFERRED";
      factIds = idsOf(inferred);
    } else if (list.length > 0) {
      // Only expired facts: "last known", which nurture remembers and verifies.
      status = "INFERRED";
      stale = true;
      factIds = idsOf(list);
    }

    return {
      dimension,
      status,
      fact_ids: factIds,
      material: isMaterialDimension(dimension, ctx),
      required: required.has(dimension),
      stale,
    };
  });
}

/** Counts as known for thresholds and completeness: CONFIRMED, or a fresh non-material INFERRED. */
export function countsAsKnown(entry: DimensionStatusEntry): boolean {
  if (entry.stale) return false;
  if (entry.status === "CONFIRMED") return true;
  return entry.status === "INFERRED" && !entry.material;
}

/** The dimensions known well enough to satisfy a decision threshold. */
export function knownDimensions(entries: readonly DimensionStatusEntry[]): QiDimensionKey[] {
  return entries.filter(countsAsKnown).map((e) => e.dimension).filter((d): d is QiDimensionKey => d !== UNMAPPED_DIMENSION);
}

/** Needs a VERIFY question before it can gate (material inference or stale), or a CLARIFY one (conflict). */
export function verificationNeeded(entries: readonly DimensionStatusEntry[]): { dimension: FactDimension; purpose: "VERIFY" | "CLARIFY" }[] {
  return entries
    .filter((e) => e.status === "CONFLICTING" || (e.status === "INFERRED" && (e.material || e.stale)))
    .map((e) => ({ dimension: e.dimension, purpose: e.status === "CONFLICTING" ? ("CLARIFY" as const) : ("VERIFY" as const) }));
}

/**
 * Qualification completeness, 0..1 (§B.14): the share of the required
 * dimensions (goal threshold + requiredDimensions) that count as known. With
 * nothing required, the share of every listed dimension; with nothing listed, 1.
 */
export function qualificationCompleteness(entries: readonly DimensionStatusEntry[]): number {
  const required = entries.filter((e) => e.required);
  const base = required.length > 0 ? required : entries.filter((e) => e.dimension !== UNMAPPED_DIMENSION);
  if (base.length === 0) return 1;
  return Math.round((base.filter(countsAsKnown).length / base.length) * 1000) / 1000;
}

/** Stored row -> the engine's camelCase shape. */
export function factFromRow(row: {
  id: string;
  lead_id: string;
  service_id: string | null;
  dimension: string;
  value: string;
  value_normalised: string | null;
  state: string;
  source: string;
  source_ref: string | null;
  question_id: string | null;
  question_intent_key: string | null;
  confidence: number | string;
  observed_at: string;
  valid_until: string | null;
  verified_at: string | null;
  set_by: string | null;
  superseded_at: string | null;
}): QualificationFact {
  return {
    id: row.id,
    leadId: row.lead_id,
    serviceId: row.service_id,
    dimension: row.dimension as FactDimension,
    value: row.value,
    valueNormalised: row.value_normalised,
    state: row.state as FactState,
    source: row.source as FactSource,
    sourceRef: row.source_ref,
    questionId: row.question_id,
    questionIntentKey: row.question_intent_key,
    confidence: Number(row.confidence),
    observedAt: row.observed_at,
    validUntil: row.valid_until,
    verifiedAt: row.verified_at,
    setBy: row.set_by,
    supersededAt: row.superseded_at,
  };
}

/* ============================================================ builders */

/**
 * A fact write from one stored qualification answer (the engine's input,
 * mirrored). The lead's reply or a form is CONFIRMED; an answer the AI assist
 * matched (source 'ai_assist', or a reply with confidence below 1: the Q-D1
 * provenance gap) is INFERRED at most and dropped below the 0.85 floor.
 */
export function answerFactWrite(input: {
  leadId: string;
  serviceId: string | null;
  questionId: string;
  dimension: QiDimensionKey | null;
  questionIntentKey: string | null;
  value: string;
  answerSource: string;
  confidence: number | null;
  answeredAt: string;
}): QualificationFactWrite | null {
  const value = input.value.trim().slice(0, 500);
  if (!value) return null;
  const dimension: FactDimension = input.dimension ?? UNMAPPED_DIMENSION;
  const ai =
    input.answerSource === "ai_assist" ||
    input.answerSource === "ai" ||
    (input.confidence !== null && input.confidence < 1);
  if (ai && (input.confidence ?? 0) < AI_EXTRACTION_MIN_CONFIDENCE) return null;
  const source: FactSource = ai ? "AI_ASSIST" : input.answerSource === "form" ? "FORM" : input.answerSource === "manual" ? "MANUAL" : "ANSWER";
  const observedAt = new Date(ms(input.answeredAt) ?? Date.now()).toISOString();
  const intentKey = dimension === UNMAPPED_DIMENSION ? `custom:${input.questionId.toLowerCase()}` : input.questionIntentKey;
  return {
    lead_id: input.leadId,
    service_id: input.serviceId,
    dimension,
    value,
    value_normalised: normaliseFactValue(dimension, value),
    state: ai ? "INFERRED" : "CONFIRMED",
    source,
    // One slot per question per answer time: a changed answer is a new fact.
    source_ref: `qa:${input.questionId}:${ms(input.answeredAt) ?? 0}`,
    question_id: input.questionId,
    question_intent_key: intentKey,
    confidence: ai ? Math.min(1, Math.max(0, input.confidence ?? 0)) : 1,
    observed_at: observedAt,
    valid_until: factValidUntil(dimension, observedAt, { value }),
    verified_at: null,
    set_by: null,
  };
}

/** Touch sources that are a form the lead filled in themselves. */
export const LEAD_FORM_TOUCH_SOURCES: readonly string[] = ["AD_FORM", "WEB_FORM"];

/**
 * Whether the lead's own fields (postcode, service) came from a form the lead
 * submitted: the lead was created by an inbound form (created_via INBOUND,
 * written by ingest from the submission) and a form touch is on record. A
 * lead created by import, API, sourcing or by hand has fields someone else
 * entered, which stay INFERRED until the lead confirms them.
 *
 * Known limit: a team member who later edits the postcode on a form lead is
 * not distinguished from the form (leads carries no per-field provenance).
 */
export function leadFieldsFromLeadForm(
  lead: { created_via: string | null },
  touches: readonly { source_type: string | null }[],
): boolean {
  return lead.created_via === "INBOUND" && touches.some((t) => LEAD_FORM_TOUCH_SOURCES.includes(t.source_type ?? ""));
}

/**
 * A lead-field fact (postcode, service): INFERRED, per §B.12, unless the lead
 * submitted it on a form (then FORM, CONFIRMED: see `submittedByLead`).
 */
export function leadFieldFactWrite(input: {
  leadId: string;
  serviceId: string | null;
  dimension: QiDimensionKey;
  value: string | null;
  observedAt: string;
  /**
   * The lead typed or chose this value themselves on a form they submitted
   * (leadFieldsFromLeadForm). It is then their own statement: source FORM,
   * CONFIRMED, so booking is not gated on a VERIFY turn asking them to repeat
   * it. A value staff entered, imported or enriched stays LEAD_FIELD INFERRED.
   */
  submittedByLead?: boolean;
}): QualificationFactWrite | null {
  const value = (input.value ?? "").trim().slice(0, 500);
  if (!value) return null;
  const norm = normaliseFactValue(input.dimension, value);
  const observedAt = new Date(ms(input.observedAt) ?? Date.now()).toISOString();
  const own = input.submittedByLead === true;
  return {
    lead_id: input.leadId,
    service_id: input.serviceId,
    dimension: input.dimension,
    value,
    value_normalised: norm,
    state: own ? "CONFIRMED" : "INFERRED",
    source: own ? "FORM" : "LEAD_FIELD",
    source_ref: `lead:${input.dimension.toLowerCase()}:${(norm ?? value).slice(0, 120)}`,
    question_id: null,
    question_intent_key: null,
    confidence: own ? 1 : 0.9,
    observed_at: observedAt,
    valid_until: factValidUntil(input.dimension, observedAt, { value }),
    verified_at: null,
    set_by: null,
  };
}
