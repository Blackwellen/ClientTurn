/**
 * What may be written to `prospect_companies`, and when (B16, B24).
 *
 * Pure, and free of `server-only`, so it is testable under `node --test`.
 *
 * ## Re-discovery fills blanks (B16)
 *
 * A company found again — by a later run, another provider, or a CSV row — used
 * to be upserted over the existing row, replacing a name or description that
 * came from a better source (a Companies House registered name, the company's
 * own site) with whatever the latest source said. Now a re-discovery only fills
 * fields that are still empty. Deliberate updates (enrichment) are separate.
 *
 * ## Google Places is discovery-only (B24)
 *
 * Google Maps Platform ToS §3.2.3(a) forbids storing Places content — it names
 * "business names, addresses" explicitly — and the Service Specific Terms allow
 * latitude/longitude to be cached for at most 30 days. Only the place ID may be
 * stored indefinitely. So a Places result contributes:
 *
 *   - `externalId` — the place ID, the one field we may keep;
 *   - `websiteUrl` / `domain` — a pointer to the company's *own* site, which is
 *     where its identity is then read from (first-party), alongside Companies
 *     House (enrichment replaces the placeholder name with the registered one);
 *   - `discoveryOnly` — coordinates used once, at query time, to decide whether
 *     the place is inside the plan's radius. Never persisted: `upsertCompany`
 *     stores only the verdict (`discoveryGeo: "INSIDE"`), not the position.
 *
 * The display name, address, primary type and coordinates are not persisted.
 */

export type LocationFields = {
  country: string | null;
  region: string | null;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lon: number | null;
};

export const EMPTY_LOCATION: LocationFields = {
  country: null,
  region: null,
  city: null,
  postcode: null,
  lat: null,
  lon: null,
};

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).every((inner) => inner === null || inner === undefined);
  }
  return false;
}

/**
 * The patch that fills only the blank fields of `existing` from `incoming`.
 *
 * An incoming blank never clears a stored value. `external_ids` is merged by
 * key (new keys added, existing keys kept), because it is a map of
 * provider → id rather than one value.
 */
export function fillBlanks(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (isBlank(value)) continue;
    const current = existing[key];
    if (key === "external_ids" && current && typeof current === "object" && typeof value === "object") {
      const merged = { ...(value as Record<string, unknown>), ...(current as Record<string, unknown>) };
      if (Object.keys(merged).length > Object.keys(current as object).length) patch[key] = merged;
      continue;
    }
    if (isBlank(current)) patch[key] = value;
  }
  return patch;
}

export function hasAnyLocation(location: Partial<LocationFields> | null | undefined): boolean {
  if (!location) return false;
  return Object.values(location).some((value) => value !== null && value !== undefined && value !== "");
}

/** Until the company's own site or Companies House names it, its domain does. */
export function placeholderNameFor(domain: string): string {
  return domain;
}

function hostFrom(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

export type PlacesPlace = {
  id?: string;
  websiteUri?: string;
  location?: { latitude?: number; longitude?: number };
  // Everything else Places may return is ignored on purpose (ToS §3.2.3).
  [other: string]: unknown;
};

/**
 * The only fields a Places result contributes to a company candidate.
 *
 * Returns null for a place with no website: with no first-party source to read
 * its identity from, and no right to keep the name Google gave it, there is
 * nothing lawful to store and nothing downstream (contact discovery keys on the
 * domain) could use.
 */
export function placesCandidateFields(place: PlacesPlace): {
  externalId: string | null;
  name: string;
  domain: string;
  websiteUrl: string;
  industry: null;
  employeeCount: null;
  companySize: null;
  description: null;
  location: LocationFields;
  discoveryOnly: { lat: number | null; lon: number | null };
} | null {
  const websiteUrl = typeof place.websiteUri === "string" ? place.websiteUri : undefined;
  const domain = hostFrom(websiteUrl);
  if (!websiteUrl || !domain) return null;

  return {
    externalId: place.id ?? null,
    name: placeholderNameFor(domain),
    domain,
    websiteUrl,
    industry: null,
    employeeCount: null,
    companySize: null,
    description: null,
    location: { ...EMPTY_LOCATION },
    discoveryOnly: {
      lat: typeof place.location?.latitude === "number" ? place.location.latitude : null,
      lon: typeof place.location?.longitude === "number" ? place.location.longitude : null,
    },
  };
}

/** True when discovery recorded an "inside the plan's radius" verdict. */
export function discoveryGeoInside(locationJson: unknown): boolean {
  if (!locationJson || typeof locationJson !== "object") return false;
  return (locationJson as { discoveryGeo?: unknown }).discoveryGeo === "INSIDE";
}

/**
 * Companies House's registered name replaces a placeholder (the domain), and
 * nothing else: a name somebody or something better already supplied stays.
 */
export function registeredNameUpdate(
  current: { name: string | null; domain: string | null },
  registeredName: string | null | undefined,
): { name?: string } {
  const next = registeredName?.trim();
  if (!next) return {};
  const placeholder = !current.name?.trim() || (current.domain !== null && current.name === current.domain);
  return placeholder ? { name: next } : {};
}
