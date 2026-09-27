/**
 * Catalogue validation: the zod shape of each item and bundle (types.ts)
 * plus the cross-row rules a single row cannot see: unique ids, one
 * currency, add-on and bundle references that resolve, bundles that can be
 * priced as one charge, and bundles that do not cost more than their parts.
 *
 * Run before every catalogue write (server action) and at the start of
 * every `calculateQuote`, so a malformed catalogue can never be priced.
 */

import { toMilli } from "../quotes/money.ts";
import { listPrice } from "./pricing.ts";
import {
  catalogueBundleSchema,
  catalogueItemSchema,
  catalogueSchema,
  intervalKey,
  type Catalogue,
  type CatalogueBundle,
  type CatalogueIssue,
  type CatalogueItem,
} from "./types.ts";

export type CatalogueValidation =
  | { ok: true; catalogue: Catalogue }
  | { ok: false; issues: CatalogueIssue[] };

function zodIssues(prefix: (string | number)[], error: { issues: { path: PropertyKey[]; message: string }[] }): CatalogueIssue[] {
  return error.issues.map((issue) => ({
    code: "INVALID",
    path: [...prefix, ...issue.path.map((p) => (typeof p === "symbol" ? String(p) : p))],
    message: issue.message,
  }));
}

export function parseItem(raw: unknown): { ok: true; item: CatalogueItem } | { ok: false; issues: CatalogueIssue[] } {
  const parsed = catalogueItemSchema.safeParse(raw);
  return parsed.success ? { ok: true, item: parsed.data } : { ok: false, issues: zodIssues([], parsed.error) };
}

export function parseBundle(raw: unknown): { ok: true; bundle: CatalogueBundle } | { ok: false; issues: CatalogueIssue[] } {
  const parsed = catalogueBundleSchema.safeParse(raw);
  return parsed.success ? { ok: true, bundle: parsed.data } : { ok: false, issues: zodIssues([], parsed.error) };
}

export function quantityWithinBounds(item: CatalogueItem, quantity: number): boolean {
  if (item.minQuantity !== undefined && quantity < item.minQuantity) return false;
  if (item.maxQuantity !== undefined && quantity > item.maxQuantity) return false;
  return true;
}

export function validateCatalogue(raw: unknown): CatalogueValidation {
  const parsed = catalogueSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: zodIssues([], parsed.error) };
  const catalogue = parsed.data;
  const issues: CatalogueIssue[] = [];

  const items = new Map<string, CatalogueItem>();
  catalogue.items.forEach((item, index) => {
    if (items.has(item.id)) {
      issues.push({ code: "DUPLICATE_ID", path: ["items", index, "id"], message: `Item id "${item.id}" is used twice.` });
    }
    items.set(item.id, item);
    if (item.currency !== catalogue.currency) {
      issues.push({
        code: "CURRENCY_MISMATCH",
        path: ["items", index, "currency"],
        message: `Item "${item.id}" is priced in ${item.currency}; the workspace currency is ${catalogue.currency}.`,
      });
    }
  });

  catalogue.items.forEach((item, index) => {
    item.addOnItemIds.forEach((addOnId, j) => {
      const addOn = items.get(addOnId);
      if (!addOn) {
        issues.push({ code: "UNKNOWN_ADD_ON", path: ["items", index, "addOnItemIds", j], message: `Add-on "${addOnId}" is not in the catalogue.` });
      } else if (addOn.addOnItemIds.length > 0) {
        issues.push({
          code: "NESTED_ADD_ON",
          path: ["items", index, "addOnItemIds", j],
          message: `Add-on "${addOnId}" has add-ons of its own; add-ons are one level deep.`,
        });
      }
    });
  });

  const bundleIds = new Set<string>();
  catalogue.bundles.forEach((bundle, index) => {
    if (bundleIds.has(bundle.id) || items.has(bundle.id)) {
      issues.push({ code: "DUPLICATE_ID", path: ["bundles", index, "id"], message: `Bundle id "${bundle.id}" is already used.` });
    }
    bundleIds.add(bundle.id);
    if (bundle.currency !== catalogue.currency) {
      issues.push({ code: "CURRENCY_MISMATCH", path: ["bundles", index, "currency"], message: `Bundle "${bundle.id}" is not in ${catalogue.currency}.` });
    }
    const components: CatalogueItem[] = [];
    bundle.components.forEach((component, j) => {
      const item = items.get(component.itemId);
      if (!item) {
        issues.push({ code: "UNKNOWN_COMPONENT", path: ["bundles", index, "components", j], message: `Component "${component.itemId}" is not in the catalogue.` });
        return;
      }
      if (!quantityWithinBounds(item, component.quantity)) {
        issues.push({
          code: "COMPONENT_QUANTITY",
          path: ["bundles", index, "components", j, "quantity"],
          message: `Component "${item.id}" quantity is outside its min/max.`,
        });
      }
      if (item.chargeType === "USAGE") {
        issues.push({
          code: "USAGE_IN_BUNDLE",
          path: ["bundles", index, "components", j],
          message: "Usage-priced items cannot be bundled: their quantity is only an estimate.",
        });
      }
      components.push(item);
    });
    if (components.length !== bundle.components.length) return;

    if (bundle.pricing.type === "FIXED") {
      const charges = new Set(components.map((item) => (item.interval ? `${item.chargeType}|${intervalKey(item.interval)}` : item.chargeType)));
      if (charges.size > 1) {
        issues.push({
          code: "MIXED_FIXED_BUNDLE",
          path: ["bundles", index, "pricing"],
          message: "A fixed-price bundle must be all one-off or all the same recurring interval.",
        });
        return;
      }
      const listTotal = bundle.components.reduce((sum, component, j) => {
        return sum + listPrice(components[j], toMilli(component.quantity)).amountMinor;
      }, 0);
      if (bundle.pricing.priceMinor > listTotal) {
        issues.push({
          code: "BUNDLE_ABOVE_COMPONENTS",
          path: ["bundles", index, "pricing", "priceMinor"],
          message: "A bundle may not cost more than its components at list price.",
        });
      }
    }
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, catalogue };
}
