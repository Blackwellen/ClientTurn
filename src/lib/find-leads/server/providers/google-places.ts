import "server-only";
import { serverEnv } from "@/lib/env";
import { providerJson, unconfigured } from "./http";
import { placesCandidateFields } from "../company-provenance";
import {
  providerFailure,
  type CompanyCandidate,
  type ProviderResponse,
  type SearchWindow,
  type SourcingProvider,
} from "./types";

/**
 * Google Places: the cheapest company discovery source, and the only one that
 * understands "within 40 miles of Bournemouth" as a real geographic constraint
 * rather than a string match on a location field.
 *
 * Cost rank 0 — this runs first in the waterfall, and the records it returns
 * are pre-filtered on stage 5 before anything expensive touches them.
 *
 * ## Discovery only (B24, decision Q7)
 *
 * Google Maps Platform ToS §3.2.3(a) forbids pre-fetching, caching or storing
 * Places content, naming "business names, addresses" explicitly; the Service
 * Specific Terms allow latitude/longitude to be cached for at most 30 days;
 * only the place ID may be stored indefinitely. So this provider asks Places
 * for the place ID, the website and the position — nothing else — and returns:
 *
 *   - the place ID as `externalId` (persistable);
 *   - the website's domain, as a pointer to the company's own site, which is
 *     where its identity is read from (with Companies House at enrichment);
 *     the domain stands in as the name until then;
 *   - the position in `discoveryOnly`, used once by the run to test "within X
 *     miles" at query time and never written to the database.
 *
 * Display name, address, types and coordinates are not persisted. See
 * `../company-provenance.ts`.
 */

type PlacesResult = {
  places?: {
    id?: string;
    websiteUri?: string;
    location?: { latitude?: number; longitude?: number };
  }[];
  nextPageToken?: string;
};

function key(): string | undefined {
  return serverEnv.sourcing.googlePlacesApiKey;
}

async function searchCompanies(
  window: SearchWindow,
): Promise<ProviderResponse<CompanyCandidate>> {
  const apiKey = key();
  if (!apiKey) return unconfigured<CompanyCandidate>();

  const { plan, limit } = window;
  const location = plan.locations[0];

  // A radius search needs resolved coordinates. `validate_target_location`
  // resolves them before the plan can be approved, so an unresolved location
  // here means the plan bypassed validation — refuse rather than silently
  // searching the wrong place.
  if (!location) {
    return { ok: true, records: [], costMinor: 0, cursor: null, latencyMs: 0, errorCode: null };
  }

  const query = [plan.industries.join(" OR "), location.city ?? location.region ?? ""]
    .filter(Boolean)
    .join(" in ");

  const result = await providerJson<PlacesResult>({
    url: "https://places.googleapis.com/v1/places:searchText",
    method: "POST",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        // Only what may be kept (the place ID) or used transiently (website as
        // a pointer, position for the radius test). ToS §3.2.3.
        "places.id,places.websiteUri,places.location,nextPageToken",
    },
    body: {
      textQuery: query,
      pageSize: Math.min(20, limit),
      pageToken: window.cursor ?? undefined,
      ...(location.lat !== null && location.lon !== null && location.radiusKm
        ? {
            locationBias: {
              circle: {
                center: { latitude: location.lat, longitude: location.lon },
                // Places caps the bias radius at 50km; the plan's real radius is
                // enforced by the run at discovery, from `discoveryOnly`.
                radius: Math.min(50_000, location.radiusKm * 1000),
              },
            },
          }
        : {}),
    },
  });

  if (!result.ok) return providerFailure<CompanyCandidate>(result.code, result.latencyMs);

  const records = (result.data.places ?? [])
    .map((place) => placesCandidateFields(place))
    .filter((fields): fields is NonNullable<typeof fields> => fields !== null)
    .map((fields): CompanyCandidate => fields);

  return {
    ok: true,
    records,
    costMinor: 0,
    cursor: result.data.nextPageToken ?? null,
    latencyMs: result.latencyMs,
    errorCode: null,
  };
}

export const googlePlacesProvider: SourcingProvider = {
  key: "google_places",
  displayName: "Google Maps",
  capabilities: ["COMPANY_SEARCH"],
  costRank: 0,
  configured: () => Boolean(key()),
  searchCompanies,
};

/**
 * Geocoding for `validate_target_location`. Separate from the provider
 * interface because it is not part of a run's waterfall — it resolves a plan
 * before any run exists, and costs nothing against the run budget.
 *
 * The result resolves the *user's own* target location (a city they typed),
 * not a business, and is used at query time. Geocoding content carries the
 * same 30-day cap on cached coordinates, so whatever stores the resolved plan
 * must not keep these coordinates indefinitely (see the B24 report).
 */
export async function geocodePlace(input: {
  city: string | null;
  region: string | null;
  country: string;
}): Promise<{ lat: number; lon: number; resolvedName: string } | null> {
  const apiKey = key();
  if (!apiKey) return null;

  const address = [input.city, input.region, input.country].filter(Boolean).join(", ");

  const result = await providerJson<{
    results?: { geometry?: { location?: { lat?: number; lng?: number } }; formatted_address?: string }[];
    status?: string;
  }>({
    url: `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}`,
  });

  if (!result.ok) return null;
  const first = result.data.results?.[0];
  const lat = first?.geometry?.location?.lat;
  const lon = first?.geometry?.location?.lng;
  if (typeof lat !== "number" || typeof lon !== "number") return null;

  return { lat, lon, resolvedName: first?.formatted_address ?? address };
}
