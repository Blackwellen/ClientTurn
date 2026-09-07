import "server-only";
import { resolveLocation } from "@/lib/find-leads/server/locations";
import type { AudienceDraft } from "../campaign-draft";

/**
 * Turning "Bournemouth + 25 miles" into coordinates (V4 section 16.9).
 *
 * A radius is a geographic claim, and the only honest way to honour it is with
 * a centre and a real distance. Matching a city name as text answers a
 * different question — it misses every company in Poole that is plainly inside
 * the radius — and it looks like it worked, which is worse than failing.
 *
 * Resolved on save rather than per keystroke: geocoding is a paid provider
 * call, and step 2's estimate re-runs on every edit.
 */

const KM_PER_MILE = 1.609_344;

export type ResolvedCentre = { lat: number; lon: number; label: string };

export function milesToKm(miles: number): number {
  return miles * KM_PER_MILE;
}

/**
 * Whether the stored centre still answers for the current criteria.
 *
 * Keyed on the first location and the radius, because those are the only two
 * inputs the centre depends on — re-geocoding because someone added an
 * industry would be a provider call for nothing.
 */
export function centreIsCurrent(audience: AudienceDraft): boolean {
  if (!audience.radiusMiles || audience.locations.length === 0) return true;
  if (!audience.center) return false;
  return audience.center.label.toLowerCase().startsWith(
    audience.locations[0].trim().toLowerCase(),
  );
}

/**
 * Resolves the centre of a campaign's radius, or null when the place cannot be
 * found.
 *
 * Null is a real answer here, not a failure to be papered over: the estimate
 * reports that it could not measure the radius rather than silently returning
 * a count for somewhere else.
 */
export async function resolveAudienceCentre(
  audience: AudienceDraft,
): Promise<ResolvedCentre | null> {
  if (!audience.radiusMiles || audience.locations.length === 0) return null;

  const place = audience.locations[0].trim();
  if (!place) return null;

  // Reuse the resolver the search planner uses, so a place name means the same
  // thing in both — including its table of known UK centres, which avoids a
  // provider call for the towns this product actually serves.
  const resolved = await resolveLocation({
    country: "GB",
    region: null,
    city: place,
    lat: null,
    lon: null,
    radiusKm: Math.round(milesToKm(audience.radiusMiles)),
    resolved: false,
  }).catch(() => null);

  if (!resolved?.resolved || resolved.lat === null || resolved.lon === null) {
    return null;
  }

  return { lat: resolved.lat, lon: resolved.lon, label: place };
}
