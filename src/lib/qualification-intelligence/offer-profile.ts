/**
 * Offer understanding (08 §B.6, brief §1) and the top of the hierarchy (§B.7):
 *
 *   Industry (SIC) -> Archetype -> Offer profile -> Motion / goal
 *     -> Lead context -> Intent -> Known -> next best question
 *
 * `services` is the offer entity; `services.offer_profile` holds the
 * per-offer profile (contract `offerProfileSchema`). Every field is optional:
 * what the offer does not say comes from the workspace's QUALIFICATION_POLICY
 * and, below that, from the archetype's qualification profile
 * (sales-library/archetypes.ts QUALIFICATION_PROFILES) for the motion.
 *
 * Resolution, per field, first match wins:
 *   service policy ('service:<uuid>') -> offer profile -> workspace policy ('*')
 *   -> archetype x motion defaults.
 * List fields that only ever narrow (required dimensions, forbidden intents,
 * disqualifiers) are unions: a lower layer can never un-forbid what a higher
 * one forbade.
 *
 * Pure: no server-only, no Supabase. The column is browser-writable through
 * services' table grant (CD-22), so it is only ever read through
 * `parseOfferProfile` (invalid => {} + defaults).
 */

import { z } from "zod";

import {
  MOTION_DEFAULT_GOAL,
  offerProfileSchema,
  parseOfferProfile,
  qualificationPolicySchema,
  questionIntentOverrideSchema,
  POLICY_KEY_PATTERN,
  QI_DIMENSION_KEYS,
  WORKSPACE_POLICY_KEY,
  type DimensionStatusEntry,
  type FactDimension,
  type OfferDisqualifier,
  type OfferProfile,
  type Predicate,
  type QiDimensionKey,
  type QualificationPolicy,
  type QuestionIntentOverride,
} from "./types.ts";
import { archetypeFor, qualificationPlan, qualificationProfileFor } from "../sales-library/archetypes.ts";
import { MOTIONS } from "../sales-library/motions.ts";
import type { Archetype, QualificationProfile, SalesMotion } from "../sales-library/types.ts";

export { parseOfferProfile };

/* --------------------------------------------------------------- defaults */

/** The disqualifier item schema, taken from the contract (not redefined). */
const disqualifierItemSchema = offerProfileSchema.shape.disqualifiers.unwrap().element;

function hintPredicate(hint: QualificationProfile["disqualifierHints"][number]): Predicate {
  switch (hint.op) {
    case "lt":
    case "gt":
      return { op: hint.op, dimension: hint.dimension, value: Number(hint.value) };
    case "equals":
      return { op: "equals", dimension: hint.dimension, value: String(hint.value) };
    case "in":
      return { op: "in", dimension: hint.dimension, values: (Array.isArray(hint.value) ? hint.value : [hint.value]).map(String) };
  }
}

/**
 * The archetype x motion default offer profile. Always valid against
 * `offerProfileSchema` (tested for every archetype x motion).
 */
export function defaultOfferProfile(archetype: Archetype | null, motion: SalesMotion): OfferProfile {
  const profile = qualificationProfileFor(archetype);
  const staff = profile.targetStaff;
  const sizes: string[] = [];
  if (staff) {
    const bands: [string, number, number][] = [
      ["1-9", 1, 9],
      ["10-49", 10, 49],
      ["50-249", 50, 249],
      ["250+", 250, Number.POSITIVE_INFINITY],
    ];
    for (const [label, lo, hi] of bands) {
      if ((staff.min ?? 0) <= hi && (staff.max ?? Number.POSITIVE_INFINITY) >= lo) sizes.push(label);
    }
  }
  return {
    pricingModel: profile.pricingModel,
    billing: profile.billing,
    cycleComplexity: profile.cycleComplexity,
    customerType: profile.customerType,
    ...(sizes.length > 0 ? { targetCustomer: { sizes, roles: archetype?.decisionMakerRoles.slice(0, 20) } } : {}),
    disqualifiers: profile.disqualifierHints.map((hint) => ({
      dimension: hint.dimension,
      when: hintPredicate(hint),
      reason: hint.reason,
      reviewInstead: true,
      suppress: false,
    })),
    goal: MOTION_DEFAULT_GOAL[motion],
    motion,
    requiredDimensions: [...profile.requiredDimensions],
    forbiddenQuestionIntents: [],
  };
}

/* ------------------------------------------------------------- resolution */

export type OfferResolutionInput = {
  /** business_profiles.archetype_key. */
  archetypeKey?: string | null;
  /** business_profiles.sales_motions[0]. */
  workspaceMotion?: SalesMotion | null;
  /** services.offer_profile, raw (validated here). */
  offerProfileRaw?: unknown;
  /** services.average_value, the fallback for averageDealValue. */
  averageValue?: number | null;
  workspacePolicy?: QualificationPolicy | null;
  servicePolicy?: QualificationPolicy | null;
  /** Rows of the DISQUALIFIER override kind that apply to this offer. */
  overrideDisqualifiers?: OfferDisqualifier[];
};

export type ResolvedOffer = {
  archetype: Archetype | null;
  archetypeKey: string | null;
  /** The library profile the defaults came from. */
  libraryProfile: QualificationProfile;
  /** The merged offer profile (always schema-valid). */
  offer: OfferProfile;
  /** True when services.offer_profile was absent or valid; false = it was ignored. */
  storedProfileValid: boolean;
  motion: SalesMotion;
  motionSource: "SERVICE_POLICY" | "OFFER_PROFILE" | "WORKSPACE_POLICY" | "WORKSPACE" | "ARCHETYPE" | "DEFAULT";
  /** The dimensions this offer is qualified on, in asking order. */
  plan: QiDimensionKey[];
  /** The motion's decision threshold, plus the offer's required dimensions in allOf. */
  threshold: { allOf: QiDimensionKey[]; anyOf: QiDimensionKey[] };
  requiredDimensions: QiDimensionKey[];
  /** Asked (one per turn) before a close even when the buyer asks for it. */
  gatingDimensions: QiDimensionKey[];
  /** Never asked by the library for this offer (motion + profile). */
  neverAsk: QiDimensionKey[];
  /** Library intent keys never asked. */
  forbiddenIntents: string[];
  /** Library intent keys a workspace adopted (policy.customQuestionIntents). */
  adoptedIntents: string[];
  disqualifiers: OfferDisqualifier[];
};

function union<T>(...lists: (readonly T[] | undefined | null)[]): T[] {
  const out: T[] = [];
  for (const list of lists) for (const item of list ?? []) if (!out.includes(item)) out.push(item);
  return out;
}

function unionDisqualifiers(...lists: (readonly OfferDisqualifier[] | undefined | null)[]): OfferDisqualifier[] {
  const seen = new Set<string>();
  const out: OfferDisqualifier[] = [];
  for (const list of lists) {
    for (const item of list ?? []) {
      const key = JSON.stringify([item.dimension, item.when]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Resolves the offer for one lead (08 §B.6 "Resolution order"). Pure and
 * total: every input may be absent, and the result is always usable.
 */
export function resolveOffer(input: OfferResolutionInput): ResolvedOffer {
  const { profile: stored, valid } = parseOfferProfile(input.offerProfileRaw ?? {});
  const service = input.servicePolicy ?? {};
  const workspace = input.workspacePolicy ?? {};

  const archetypeKey = service.archetypeKey ?? workspace.archetypeKey ?? input.archetypeKey ?? null;
  const archetype = archetypeFor(archetypeKey);

  let motionSource: ResolvedOffer["motionSource"] = "DEFAULT";
  let motion: SalesMotion = "BOOK_MEETING_B2B";
  if (service.motion) [motion, motionSource] = [service.motion, "SERVICE_POLICY"];
  else if (stored.motion) [motion, motionSource] = [stored.motion, "OFFER_PROFILE"];
  else if (workspace.motion) [motion, motionSource] = [workspace.motion, "WORKSPACE_POLICY"];
  else if (input.workspaceMotion) [motion, motionSource] = [input.workspaceMotion, "WORKSPACE"];
  else if (archetype?.defaultMotions[0]) [motion, motionSource] = [archetype.defaultMotions[0], "ARCHETYPE"];

  const defaults = defaultOfferProfile(archetype, motion);
  const libraryProfile = qualificationProfileFor(archetype);

  const requiredDimensions = union<QiDimensionKey>(
    defaults.requiredDimensions,
    workspace.requiredDimensions,
    stored.requiredDimensions,
    service.requiredDimensions,
  );
  const forbiddenIntents = union<string>(
    workspace.forbiddenQuestionIntents,
    stored.forbiddenQuestionIntents,
    service.forbiddenQuestionIntents,
  );
  const disqualifiers = unionDisqualifiers(
    defaults.disqualifiers,
    workspace.disqualifiers,
    stored.disqualifiers,
    service.disqualifiers,
    input.overrideDisqualifiers,
  );

  const offer: OfferProfile = {
    ...defaults,
    ...stripUndefined(workspacePolicyAsOffer(workspace)),
    ...stripUndefined(stored),
    ...stripUndefined(workspacePolicyAsOffer(service)),
    motion,
    requiredDimensions,
    forbiddenQuestionIntents: forbiddenIntents,
    disqualifiers,
    ...(stored.averageDealValue === undefined && typeof input.averageValue === "number" && input.averageValue >= 0
      ? { averageDealValue: input.averageValue }
      : {}),
  };
  // Goal precedence inside the offer: service policy > offer > workspace policy > motion default.
  offer.goal = service.goal ?? stored.goal ?? workspace.goal ?? MOTION_DEFAULT_GOAL[motion];
  offer.thresholds = service.thresholds ?? stored.thresholds ?? workspace.thresholds ?? defaults.thresholds;

  const motionDef = MOTIONS[motion];
  const neverAsk = union<QiDimensionKey>(motionDef.neverAsk, libraryProfile.neverAsk).filter(
    (key) => !requiredDimensions.includes(key),
  );
  const threshold = {
    allOf: union<QiDimensionKey>(motionDef.decisionThreshold.allOf, requiredDimensions),
    anyOf: [...motionDef.decisionThreshold.anyOf] as QiDimensionKey[],
  };
  const basePlan = archetype
    ? qualificationPlan(archetype, motion).map((d) => d.key)
    : [...motionDef.qualificationDimensions, ...motionDef.decisionThreshold.allOf];
  const plan = union<QiDimensionKey>(basePlan, threshold.allOf, requiredDimensions).filter(
    (key) => !neverAsk.includes(key) || threshold.allOf.includes(key) || threshold.anyOf.includes(key),
  );
  const gatingDimensions = union<QiDimensionKey>(
    motionDef.bookingGate,
    libraryProfile.gatingDimensions,
    disqualifiers.map((d) => d.dimension),
  ).filter((key) => !neverAsk.includes(key));

  return {
    archetype,
    archetypeKey: archetype?.key ?? archetypeKey,
    libraryProfile,
    offer: offerProfileSchema.parse(offer),
    storedProfileValid: valid,
    motion,
    motionSource,
    plan,
    threshold,
    requiredDimensions,
    gatingDimensions,
    neverAsk,
    forbiddenIntents,
    adoptedIntents: union<string>(workspace.customQuestionIntents, service.customQuestionIntents),
    disqualifiers,
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** The policy fields that are also offer-profile fields. */
function workspacePolicyAsOffer(policy: QualificationPolicy): Partial<OfferProfile> {
  return {
    goal: policy.goal,
    motion: policy.motion,
    thresholds: policy.thresholds,
  };
}

/* ------------------------------------------------------------- threshold */

/**
 * Known for the purpose of a threshold or gate (08 §B.12): CONFIRMED, or
 * INFERRED and not material. A material inference must be verified first; a
 * conflict or a stale fact is not known.
 */
export function knownDimensions(dimensions: readonly DimensionStatusEntry[]): Set<FactDimension> {
  const known = new Set<FactDimension>();
  for (const entry of dimensions) {
    if (entry.stale) continue;
    if (entry.status === "CONFIRMED" || (entry.status === "INFERRED" && !entry.material)) known.add(entry.dimension);
  }
  return known;
}

export type ThresholdStatus = {
  met: boolean;
  /** Unknown allOf dimensions, plus the whole anyOf group while none is known. */
  missing: QiDimensionKey[];
};

export function thresholdStatus(
  threshold: ResolvedOffer["threshold"],
  dimensions: readonly DimensionStatusEntry[],
): ThresholdStatus {
  const known = knownDimensions(dimensions);
  const missing = threshold.allOf.filter((key) => !known.has(key));
  const anyOfMet = threshold.anyOf.length === 0 || threshold.anyOf.some((key) => known.has(key));
  if (!anyOfMet) missing.push(...threshold.anyOf.filter((key) => !missing.includes(key)));
  return { met: missing.length === 0, missing };
}

/**
 * Qualification completeness (08 §B.14): the share of the plan's required and
 * threshold dimensions that are known. Lead-score owns the stored number; this
 * is the same rule for callers that have no score yet.
 */
export function completenessFor(resolved: ResolvedOffer, dimensions: readonly DimensionStatusEntry[]): number {
  const target = union<QiDimensionKey>(resolved.threshold.allOf, resolved.threshold.anyOf.slice(0, 1), resolved.requiredDimensions);
  if (target.length === 0) return 1;
  const known = knownDimensions(dimensions);
  // An any-of group counts once, met by any member.
  const anyOfKnown = resolved.threshold.anyOf.some((key) => known.has(key));
  let hit = 0;
  for (const key of target) {
    if (resolved.threshold.anyOf.includes(key) && !resolved.threshold.allOf.includes(key)) {
      if (anyOfKnown) hit += 1;
    } else if (known.has(key)) hit += 1;
  }
  return Math.round((hit / target.length) * 1000) / 1000;
}

/* ------------------------------------------------ workspace sales overrides */

/**
 * The payload of a DISQUALIFIER override row: one disqualifier, or
 * `{ disqualifiers: [...] }`. Its key is '*' (every offer) or
 * 'service:<uuid>' (one offer). Defect F9: before this reader existed the
 * kind was allowed by the CHECK but nothing read it.
 */
export const disqualifierOverridePayloadSchema = z.union([
  disqualifierItemSchema,
  z.object({ disqualifiers: z.array(disqualifierItemSchema).max(20) }).strict(),
]);

export type SalesOverrideRow = { kind: string; key: string; payload: unknown };

export type ParsedSalesOverrides = {
  /** QUALIFICATION_QUESTION rows, keyed by intent key (library or custom:<id>). */
  intentOverrides: Record<string, QuestionIntentOverride>;
  /** DISQUALIFIER rows: '*' applies to every offer, a service id to one. */
  disqualifiers: { serviceId: string | null; disqualifier: OfferDisqualifier }[];
  /** QUALIFICATION_POLICY rows. */
  workspacePolicy: QualificationPolicy | null;
  servicePolicies: Record<string, QualificationPolicy>;
  /** Rows that failed validation, for the log. Never thrown: a bad row is ignored. */
  rejected: { kind: string; key: string; reason: string }[];
};

/**
 * Validates workspace_sales_overrides rows of the three qualification kinds
 * (QUALIFICATION_QUESTION, DISQUALIFIER, QUALIFICATION_POLICY). Invalid rows
 * are reported, never applied: the rows are written through audited service
 * operations, but a direct database edit must not be able to widen anything.
 */
export function parseSalesOverrides(rows: readonly SalesOverrideRow[]): ParsedSalesOverrides {
  const out: ParsedSalesOverrides = {
    intentOverrides: {},
    disqualifiers: [],
    workspacePolicy: null,
    servicePolicies: {},
    rejected: [],
  };
  for (const row of rows) {
    if (row.kind === "QUALIFICATION_QUESTION") {
      const parsed = questionIntentOverrideSchema.safeParse(row.payload);
      if (parsed.success) out.intentOverrides[row.key] = parsed.data;
      else out.rejected.push({ kind: row.kind, key: row.key, reason: parsed.error.issues[0]?.message ?? "invalid" });
      continue;
    }
    if (row.kind === "DISQUALIFIER") {
      if (!POLICY_KEY_PATTERN.test(row.key)) {
        out.rejected.push({ kind: row.kind, key: row.key, reason: "key must be '*' or 'service:<uuid>'" });
        continue;
      }
      const parsed = disqualifierOverridePayloadSchema.safeParse(row.payload);
      if (!parsed.success) {
        out.rejected.push({ kind: row.kind, key: row.key, reason: parsed.error.issues[0]?.message ?? "invalid" });
        continue;
      }
      const serviceId = row.key === WORKSPACE_POLICY_KEY ? null : row.key.slice("service:".length);
      const list = "disqualifiers" in parsed.data ? parsed.data.disqualifiers : [parsed.data];
      for (const disqualifier of list) out.disqualifiers.push({ serviceId, disqualifier });
      continue;
    }
    if (row.kind === "QUALIFICATION_POLICY") {
      if (!POLICY_KEY_PATTERN.test(row.key)) {
        out.rejected.push({ kind: row.kind, key: row.key, reason: "key must be '*' or 'service:<uuid>'" });
        continue;
      }
      const parsed = qualificationPolicySchema.safeParse(row.payload);
      if (!parsed.success) {
        out.rejected.push({ kind: row.kind, key: row.key, reason: parsed.error.issues[0]?.message ?? "invalid" });
        continue;
      }
      if (row.key === WORKSPACE_POLICY_KEY) out.workspacePolicy = parsed.data;
      else out.servicePolicies[row.key.slice("service:".length)] = parsed.data;
    }
  }
  return out;
}

/** The DISQUALIFIER overrides that apply to one offer (workspace-wide + that service). */
export function disqualifiersForService(parsed: ParsedSalesOverrides, serviceId: string | null): OfferDisqualifier[] {
  return parsed.disqualifiers
    .filter((entry) => entry.serviceId === null || (serviceId !== null && entry.serviceId === serviceId.toLowerCase()))
    .map((entry) => entry.disqualifier);
}

/** Every dimension key, for callers validating stored strings. */
export function isQiDimensionKey(value: string | null | undefined): value is QiDimensionKey {
  return typeof value === "string" && (QI_DIMENSION_KEYS as readonly string[]).includes(value);
}
