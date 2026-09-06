import "server-only";
import { geocodePlace } from "./providers/google-places";
import type { PlanLocation, SearchPlan } from "../plan";

/**
 * Location resolution for search plans (V4 §10.9).
 *
 * "Within 40 miles of Bournemouth" is a geographic claim, and the only honest
 * way to honour it is with coordinates and a real distance calculation. A
 * textual radius — matching a provider's free-text location field against a
 * place name — silently returns the wrong companies and looks like it worked,
 * which is why an unresolved location blocks the plan from being runnable
 * rather than falling back to string matching.
 */

/** UK regions and counties the geocoder is not needed for. */
const KNOWN_CENTRES: Record<string, { lat: number; lon: number }> = {
  bournemouth: { lat: 50.7192, lon: -1.8808 },
  dorset: { lat: 50.7488, lon: -2.3445 },
  hampshire: { lat: 51.0577, lon: -1.3081 },
  poole: { lat: 50.7192, lon: -1.9872 },
  southampton: { lat: 50.9097, lon: -1.4044 },
  portsmouth: { lat: 50.8198, lon: -1.088 },
  london: { lat: 51.5074, lon: -0.1278 },
};

export async function resolveLocation(
  location: PlanLocation,
): Promise<PlanLocation> {
  if (location.resolved && location.lat !== null && location.lon !== null) {
    return location;
  }

  const name = (location.city ?? location.region ?? "").trim().toLowerCase();
  const known = KNOWN_CENTRES[name];
  if (known) {
    return { ...location, lat: known.lat, lon: known.lon, resolved: true };
  }

  const geocoded = await geocodePlace({
    city: location.city,
    region: location.region,
    country: location.country,
  });

  if (!geocoded) {
    // Deliberately left unresolved rather than guessed. `checkPlanReadiness`
    // turns this into a visible "this location could not be found" problem.
    return { ...location, resolved: false };
  }

  return { ...location, lat: geocoded.lat, lon: geocoded.lon, resolved: true };
}

export async function resolvePlanLocations(plan: SearchPlan): Promise<SearchPlan> {
  if (plan.locations.length === 0) return plan;
  const locations = await Promise.all(plan.locations.map(resolveLocation));
  return { ...plan, locations };
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance. Used by the pre-filter to enforce the plan's radius. */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a candidate sits inside any of the plan's locations.
 *
 * A candidate with no coordinates falls back to a name comparison, which is
 * weaker but is applied only to records the geocoded pass could not judge —
 * and the score's GEOGRAPHY factor reflects the lower confidence.
 */
export function withinPlanLocations(
  plan: SearchPlan,
  candidate: {
    lat: number | null;
    lon: number | null;
    city: string | null;
    region: string | null;
    country: string | null;
  },
): { inside: boolean; confident: boolean } {
  if (plan.locations.length === 0) return { inside: true, confident: false };

  if (candidate.lat !== null && candidate.lon !== null) {
    for (const location of plan.locations) {
      if (location.lat === null || location.lon === null) continue;
      const radius = location.radiusKm ?? 25;
      const distance = distanceKm(
        { lat: location.lat, lon: location.lon },
        { lat: candidate.lat, lon: candidate.lon },
      );
      if (distance <= radius) return { inside: true, confident: true };
    }
    return { inside: false, confident: true };
  }

  const haystack = [candidate.city, candidate.region, candidate.country]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const inside = plan.locations.some((location) =>
    [location.city, location.region]
      .filter((value): value is string => Boolean(value))
      .some((value) => haystack.includes(value.toLowerCase())),
  );

  return { inside, confident: false };
}
