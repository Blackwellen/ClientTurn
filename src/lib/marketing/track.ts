import { captureAttribution, type Attribution } from "./attribution";

export type CtaPlacement =
  | "header"
  | "header_mobile"
  | "hero_primary"
  | "hero_secondary"
  | "pain_timeline"
  | "how_it_works"
  | "conversation_demo"
  | "industries"
  | "reactivation"
  | "pricing_starter"
  | "pricing_growth"
  | "pricing_pro"
  | "pricing_enterprise"
  | "faq"
  | "final_cta"
  | "footer";

const UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
] as const;

/**
 * Carries campaign parameters from the landing URL onto the signup URL so the
 * account that gets created can be joined back to the ad that paid for it.
 */
export function withCampaignParams(path: string, placement?: CtaPlacement) {
  if (typeof window === "undefined") return path;

  const [base, existingQuery] = path.split("?");
  const target = new URLSearchParams(existingQuery ?? "");
  const current = new URLSearchParams(window.location.search);

  for (const key of UTM_PARAMS) {
    const value = current.get(key);
    if (value && !target.has(key)) target.set(key, value.slice(0, 200));
  }

  if (placement && !target.has("cta")) target.set("cta", placement);

  const attribution = captureAttribution();
  if (attribution.anonymousId && !target.has("aid")) {
    target.set("aid", attribution.anonymousId);
  }

  const query = target.toString();
  return query ? `${base}?${query}` : base;
}

function payload(placement: CtaPlacement, attribution: Attribution) {
  return {
    eventName: "cta_click",
    ctaPlacement: placement,
    anonymousId: attribution.anonymousId,
    utmSource: attribution.utmSource,
    utmMedium: attribution.utmMedium,
    utmCampaign: attribution.utmCampaign,
    utmContent: attribution.utmContent,
    utmTerm: attribution.utmTerm,
    referrer: attribution.referrer,
    landingPath: attribution.landingPath,
    metadata: {
      path:
        typeof window === "undefined" ? null : window.location.pathname,
    },
  };
}

/**
 * Best-effort: a failed analytics call must never block the visitor from
 * reaching signup, so every failure is swallowed.
 */
export function trackCta(placement: CtaPlacement): void {
  if (typeof window === "undefined") return;

  const body = JSON.stringify(payload(placement, captureAttribution()));

  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/marketing/track", blob)) return;
    }
  } catch {
    /* fall through to fetch */
  }

  try {
    void fetch("/api/marketing/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* analytics is never load-bearing */
  }
}
