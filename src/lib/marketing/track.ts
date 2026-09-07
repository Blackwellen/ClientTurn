import { captureAttribution, type Attribution } from "./attribution";
import { hasAnalyticsConsent } from "./consent";

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
  | "footer"
  /* /product/find-leads */
  | "find_leads_hero_cta"
  | "find_leads_hero_secondary"
  | "find_leads_search_plan_cta"
  | "find_leads_final_cta"
  /* /product/lead-conversion */
  | "lead_conversion_hero"
  | "lead_conversion_core"
  | "lead_conversion_journey"
  | "lead_conversion_strip"
  | "lead_conversion_final"
  | "find_leads_contact_sales"
  /* Evaluation journey: /how-it-works, /results, /pricing, /enterprise,
     /contact-sales. One placement per CTA, so each page is judged on the
     journey it actually starts rather than on aggregate signups. */
  | "how_it_works_hero"
  | "how_it_works_hero_secondary"
  | "how_it_works_final"
  | "how_it_works_contact_sales"
  | "results_hero"
  | "results_hero_secondary"
  | "results_final"
  | "results_contact_sales"
  | "pricing_page_hero"
  | "pricing_page_final"
  | "pricing_page_contact_sales"
  | "enterprise_hero"
  | "enterprise_hero_secondary"
  | "enterprise_final"
  | "enterprise_commercial"
  | "contact_sales_form"
  | "contact_sales_final"
  | "contact_sales_start_free"
  /* Homepage V2. One placement per conversion surface on the page, so the
     hero, the two growth paths, pricing and the closing panel can each be
     judged on the signups they actually start. */
  | "header_contact_sales"
  | "growth_path_conversion"
  | "growth_path_find_leads"
  | "integrations_view_all"
  | "industry_card"
  | "pricing_compare"
  | "final_contact_sales"
  | "footer_affiliate";

/**
 * Non-CTA engagement on a product page: opening a drawer, expanding a score
 * factor, stepping through a demo. These say "the visitor explored the
 * proposition", which is a different question from "the visitor clicked
 * through", so they are a separate vocabulary rather than more placements.
 */
export type EngagementEvent =
  | "find_leads_example_prompt"
  | "find_leads_previous_chats_open"
  | "find_leads_search_plan_interaction"
  | "find_leads_sourcing_demo"
  | "find_leads_prospect_open"
  | "find_leads_score_expand"
  | "find_leads_intent_interaction"
  | "find_leads_campaign_interaction"
  | "find_leads_promotion_demo"
  | "how_it_works_inbound_view"
  | "how_it_works_outbound_view"
  | "how_it_works_decision_view"
  | "results_journey_view"
  | "results_source_detail"
  | "results_conversion_detail"
  | "pricing_toggle_change"
  | "pricing_compare_interaction"
  | "pricing_faq_expand"
  | "enterprise_capability_view"
  | "enterprise_security_view"
  | "enterprise_faq_expand"
  | "contact_sales_form_start"
  | "contact_sales_success"
  | "contact_sales_error"
  | "contact_sales_faq_expand"
  /* Homepage V2 exploration. */
  | "public_nav_click"
  | "capability_click"
  | "product_showcase_tab_change"
  | "integration_category_change"
  | "home_faq_expand";

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

function session(attribution: Attribution) {
  return {
    anonymousId: attribution.anonymousId,
    utmSource: attribution.utmSource,
    utmMedium: attribution.utmMedium,
    utmCampaign: attribution.utmCampaign,
    utmContent: attribution.utmContent,
    utmTerm: attribution.utmTerm,
    referrer: attribution.referrer,
    landingPath: attribution.landingPath,
  };
}

function currentPath(): string | null {
  return typeof window === "undefined" ? null : window.location.pathname;
}

/**
 * Best-effort: a failed analytics call must never block the visitor from
 * reaching signup, so every failure is swallowed.
 */
export function trackCta(placement: CtaPlacement): void {
  if (typeof window === "undefined") return;
  // No consent, no analytics event. The Cookie Policy says this happens.
  if (!hasAnalyticsConsent()) return;

  send(
    JSON.stringify({
      eventName: "cta_click",
      ctaPlacement: placement,
      ...session(captureAttribution()),
      metadata: { path: currentPath() },
    }),
  );
}

/**
 * Records a page interaction under the same consent rule as `trackCta`.
 *
 * `detail` is a bounded label chosen by the calling component — which chip,
 * which wizard step. It is never derived from anything the visitor typed, so
 * no interaction event can carry personal data.
 */
export function trackEngagement(
  event: EngagementEvent,
  detail?: string,
): void {
  if (typeof window === "undefined") return;
  if (!hasAnalyticsConsent()) return;

  send(
    JSON.stringify({
      eventName: event,
      ...session(captureAttribution()),
      metadata: {
        path: currentPath(),
        ...(detail ? { detail: detail.slice(0, 60) } : {}),
      },
    }),
  );
}

function send(body: string): void {
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
