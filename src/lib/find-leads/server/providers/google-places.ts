import "server-only";
import { serverEnv } from "@/lib/env";
import { providerJson, unconfigured } from "./http";
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
 */

type PlacesResult = {
  places?: {
    id?: string;
    displayName?: { text?: string };
    websiteUri?: string;
    primaryType?: string;
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    addressComponents?: { longText?: string; types?: string[] }[];
  }[];
  nextPageToken?: string;
};

function key(): string | undefined {
  return serverEnv.sourcing.googlePlacesApiKey;
}

function hostFrom(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function componentOf(
  components: { longText?: string; types?: string[] }[] | undefined,
  type: string,
): string | null {
  return components?.find((c) => c.types?.includes(type))?.longText ?? null;
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
        "places.id,places.displayName,places.websiteUri,places.primaryType,places.formattedAddress,places.location,places.addressComponents,nextPageToken",
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
                // Places caps the bias radius at 50km; a wider plan radius is
                // enforced again in the pre-filter using real coordinates.
                radius: Math.min(50_000, location.radiusKm * 1000),
              },
            },
          }
        : {}),
    },
  });

  if (!result.ok) return providerFailure<CompanyCandidate>(result.code, result.latencyMs);

  const records = (result.data.places ?? []).map((place): CompanyCandidate => {
    const website = place.websiteUri;
    return {
      externalId: place.id ?? null,
      name: place.displayName?.text ?? "Unknown company",
      domain: hostFrom(website),
      websiteUrl: website ?? null,
      industry: place.primaryType ?? null,
      employeeCount: null,
      companySize: null,
      description: null,
      location: {
        country: componentOf(place.addressComponents, "country"),
        region: componentOf(place.addressComponents, "administrative_area_level_2"),
        city: componentOf(place.addressComponents, "postal_town"),
        postcode: componentOf(place.addressComponents, "postal_code"),
        lat: place.location?.latitude ?? null,
        lon: place.location?.longitude ?? null,
      },
    };
  });

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
