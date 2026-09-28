/**
 * What an agent sells: the whole catalogue, or a chosen set of offers and
 * catalogue items (commercial rules, 0174).
 *
 * The catalogue has two levels (0152): `services` is the OFFER, and
 * `catalogue_items` are the priced lines under it. An agent can target either:
 *
 *   * a service   covers the offer and every item under it;
 *   * an item     covers that item, and makes its offer "in target" for the
 *                 offer card (the card lists offers), but not the offer's
 *                 other items.
 *
 * "Whole catalogue" is the default and exactly the behaviour before 0174. A
 * legacy `agents.service_id` (one offer, never settable in the UI) is read as a
 * one-offer target, so an agent that had it keeps what it meant.
 *
 * Where it binds (all server-side, never only in the UI):
 *   - the offer card lists only in-target offers and their published prices;
 *   - the validator rejects a reply that names an out-of-target offer or item;
 *   - the best-fit scorer excludes out-of-target candidates (OUT_OF_TARGET);
 *   - the closing agent chases only leads on in-target offers, toward the
 *     goals of in-target opportunities only.
 *
 * Pure: zod only, relative `.ts` imports, so client components and the node
 * test runner can import it.
 */

import { z } from "zod";

export const OFFER_SCOPES = ["CATALOGUE", "SELECTED"] as const;
export type OfferScope = (typeof OFFER_SCOPES)[number];

export const MAX_TARGET_SERVICES = 50;
export const MAX_TARGET_ITEMS = 100;

export const OFFER_SCOPE_LABEL: Record<OfferScope, string> = {
  CATALOGUE: "Whole catalogue",
  SELECTED: "Specific products and services",
};

/** The target's fields, for a schema that adds its own (the operation adds agentId). */
export const offerTargetFields = {
  scope: z.enum(OFFER_SCOPES),
  serviceIds: z.array(z.uuid()).max(MAX_TARGET_SERVICES).default([]),
  catalogueItemIds: z.array(z.uuid()).max(MAX_TARGET_ITEMS).default([]),
};

/** SELECTED must select something. */
export function refineOfferTarget(
  value: { scope: OfferScope; serviceIds: string[]; catalogueItemIds: string[] },
  ctx: z.RefinementCtx,
): void {
  if (value.scope === "SELECTED" && value.serviceIds.length + value.catalogueItemIds.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["serviceIds"],
      message: "Choose at least one product or service, or target the whole catalogue.",
    });
  }
}

export const offerTargetSchema = z.object(offerTargetFields).superRefine(refineOfferTarget);

export type OfferTarget = {
  scope: OfferScope;
  serviceIds: string[];
  catalogueItemIds: string[];
};

export const WHOLE_CATALOGUE: OfferTarget = Object.freeze({
  scope: "CATALOGUE",
  serviceIds: [],
  catalogueItemIds: [],
}) as OfferTarget;

function uuidList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && z.uuid().safeParse(entry).success && !out.includes(entry.toLowerCase())) {
      out.push(entry.toLowerCase());
    }
  }
  return out;
}

/**
 * Reads a stored agent row. Anything malformed is the whole catalogue, the
 * behaviour every agent had before 0174; a SELECTED row whose lists are empty
 * (the CHECK forbids it, but a restored backup might not) is too.
 */
export function offerTargetFromRow(
  row: {
    offer_scope?: unknown;
    target_service_ids?: unknown;
    target_catalogue_item_ids?: unknown;
    service_id?: string | null;
  } | null,
): OfferTarget {
  if (!row) return WHOLE_CATALOGUE;
  if (row.offer_scope === "SELECTED") {
    const serviceIds = uuidList(row.target_service_ids);
    const catalogueItemIds = uuidList(row.target_catalogue_item_ids);
    if (serviceIds.length + catalogueItemIds.length > 0) {
      return { scope: "SELECTED", serviceIds, catalogueItemIds };
    }
    return WHOLE_CATALOGUE;
  }
  // Legacy: agents.service_id (0043) was a one-offer target.
  if (row.service_id && z.uuid().safeParse(row.service_id).success) {
    return { scope: "SELECTED", serviceIds: [row.service_id.toLowerCase()], catalogueItemIds: [] };
  }
  return WHOLE_CATALOGUE;
}

export type TargetCatalogueItem = { id: string; serviceId: string | null; name?: string };
export type TargetService = { id: string; name?: string };

/** A target resolved against the live catalogue. Null sets = everything. */
export type ResolvedTarget = {
  scope: OfferScope;
  /** Offers in target: chosen offers plus each chosen item's own offer. */
  serviceIds: ReadonlySet<string> | null;
  /** Offers chosen as a whole (all their items are in target). */
  wholeServiceIds: ReadonlySet<string> | null;
  /** Items chosen one by one. */
  itemIds: ReadonlySet<string> | null;
};

export function resolveTarget(target: OfferTarget, items: readonly TargetCatalogueItem[]): ResolvedTarget {
  if (target.scope === "CATALOGUE") {
    return { scope: "CATALOGUE", serviceIds: null, wholeServiceIds: null, itemIds: null };
  }
  const whole = new Set(target.serviceIds.map((id) => id.toLowerCase()));
  const itemIds = new Set(target.catalogueItemIds.map((id) => id.toLowerCase()));
  const services = new Set(whole);
  for (const item of items) {
    if (itemIds.has(item.id.toLowerCase()) && item.serviceId) services.add(item.serviceId.toLowerCase());
  }
  return { scope: "SELECTED", serviceIds: services, wholeServiceIds: whole, itemIds };
}

/** An offer the agent may pitch. A lead with no offer is in target only for the whole catalogue. */
export function serviceInTarget(target: ResolvedTarget, serviceId: string | null | undefined): boolean {
  if (!target.serviceIds) return true;
  return Boolean(serviceId) && target.serviceIds.has(serviceId!.toLowerCase());
}

/**
 * An offer the agent may recommend as a whole: chosen itself. An offer that is
 * in target only because one of its items was chosen is not (the scorer then
 * recommends the item, never the offer with all its other items).
 */
export function serviceWhollyInTarget(target: ResolvedTarget, serviceId: string): boolean {
  if (!target.wholeServiceIds) return true;
  return target.wholeServiceIds.has(serviceId.toLowerCase());
}

/** A best-fit candidate's target test (commercial/best-fit.ts FitCandidate). */
export function candidateInTarget(
  target: ResolvedTarget,
  candidate: { kind: "SERVICE" | "ITEM"; id: string; serviceId: string | null },
): boolean {
  return candidate.kind === "SERVICE"
    ? serviceWhollyInTarget(target, candidate.id)
    : itemInTarget(target, { id: candidate.id, serviceId: candidate.serviceId });
}

/** An item the agent may pitch: chosen itself, or its whole offer was chosen. */
export function itemInTarget(target: ResolvedTarget, item: TargetCatalogueItem): boolean {
  if (!target.itemIds || !target.wholeServiceIds) return true;
  if (target.itemIds.has(item.id.toLowerCase())) return true;
  return Boolean(item.serviceId) && target.wholeServiceIds.has(item.serviceId!.toLowerCase());
}

function norm(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9£%]+/g, " ")
    .trim();
}

/**
 * Names the agent must not say: every out-of-target offer and item, minus any
 * name that is part of an in-target name ("SEO" is not refused when "SEO
 * audit" is in target) and names too short to match safely.
 */
export function offTargetNames(
  target: ResolvedTarget,
  services: readonly TargetService[],
  items: readonly TargetCatalogueItem[],
): string[] {
  if (target.scope === "CATALOGUE") return [];
  const inNames: string[] = [];
  const outNames: string[] = [];
  for (const service of services) {
    if (!service.name) continue;
    (serviceInTarget(target, service.id) ? inNames : outNames).push(service.name);
  }
  for (const item of items) {
    if (!item.name) continue;
    (itemInTarget(target, item) ? inNames : outNames).push(item.name);
  }
  const inside = inNames.map(norm);
  const seen = new Set<string>();
  return outNames.filter((name) => {
    const n = norm(name);
    if (n.length < 3 || seen.has(n)) return false;
    seen.add(n);
    return !inside.some((kept) => ` ${kept} `.includes(` ${n} `));
  });
}

/** The out-of-target names a reply contains (whole-word, case-insensitive). */
export function offTargetMentions(body: string, names: readonly string[]): string[] {
  const text = ` ${norm(body)} `;
  return names.filter((name) => {
    const n = norm(name);
    return n.length >= 3 && text.includes(` ${n} `);
  });
}

/**
 * The goals the closing agent may chase for one lead: those of its open
 * opportunities on in-target offers. An opportunity with no offer counts only
 * for the whole catalogue. Empty = none recorded in target (the verdict then
 * applies its own default, a meeting, when the lead's own offer is in target).
 */
export function closingGoalsInTarget<G>(
  opportunities: readonly { serviceId: string | null; goal: G | null }[],
  target: ResolvedTarget,
): (G | null)[] {
  return opportunities.filter((o) => serviceInTarget(target, o.serviceId)).map((o) => o.goal);
}

/** A short description of the target, for the agent card and its activity feed. */
export function describeTarget(
  target: OfferTarget,
  services: readonly TargetService[],
  items: readonly TargetCatalogueItem[],
): string {
  if (target.scope === "CATALOGUE") return OFFER_SCOPE_LABEL.CATALOGUE;
  const names = [
    ...target.serviceIds.map((id) => services.find((s) => s.id.toLowerCase() === id)?.name),
    ...target.catalogueItemIds.map((id) => items.find((i) => i.id.toLowerCase() === id)?.name),
  ].filter((name): name is string => Boolean(name));
  const missing = target.serviceIds.length + target.catalogueItemIds.length - names.length;
  if (names.length === 0) return "Chosen products and services (none still in the catalogue)";
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return `${shown}${more}${missing > 0 ? ` (${missing} no longer in the catalogue)` : ""}`;
}

/** What the target picker shows: names and structure only, never a price. */
export type CatalogueOptions = {
  services: { id: string; name: string }[];
  items: { id: string; name: string; serviceId: string | null }[];
};
