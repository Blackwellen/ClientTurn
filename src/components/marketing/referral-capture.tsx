"use client";

import * as React from "react";
import {
  CONSENT_CHANGED_EVENT,
  hasAnalyticsConsent,
  readConsent,
} from "@/lib/marketing/consent";
import {
  looksLikeReferralToken,
  REFERRAL_PARAM,
  withReferralParam,
} from "@/lib/affiliates/referral-param";

/**
 * Keeps a partner's referral through a visit without storing anything until
 * the visitor consents (owner decision 2026-09-28, Cookie Policy "Referral").
 *
 * `/r` lands the visitor with `?ct_ref=<signed referral>`.
 *
 * - **Consent given** (now, or later on this page): the referral is sent to
 *   `/api/affiliates/referral`, which verifies it and sets the httpOnly
 *   `ct_ref` cookie for the rest of the partner's window. The parameter is
 *   then dropped from the address bar.
 * - **No consent**: nothing is stored. The parameter is carried in the URL:
 *   clicks on links to other pages of this site get `?ct_ref=` added, so it
 *   reaches `/signup` in the same visit, where the form sends it with the
 *   signup. Close the tab and it is gone.
 * - **Consent withdrawn**: the cookie is deleted server-side.
 *
 * Renders nothing.
 */
export function ReferralCapture() {
  React.useEffect(() => {
    const token = new URLSearchParams(window.location.search).get(REFERRAL_PARAM);
    const carried = looksLikeReferralToken(token) ? token : null;
    let stored = false;

    async function persist() {
      if (!carried || stored) return;
      try {
        const response = await fetch("/api/affiliates/referral", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: carried }),
          credentials: "same-origin",
        });
        if (response.ok) {
          stored = true;
          const url = new URL(window.location.href);
          url.searchParams.delete(REFERRAL_PARAM);
          window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
        }
      } catch {
        // The URL still carries it; signup attributes from the parameter.
      }
    }

    function withdraw() {
      void fetch("/api/affiliates/referral", { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
    }

    // Carries the parameter on same-site navigation while there is no consent.
    function onClick(event: MouseEvent) {
      if (!carried || stored || event.defaultPrevented) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const next = withReferralParam(anchor.getAttribute("href") ?? "", carried, window.location.origin);
      if (!next) return;
      // A modified click (new tab or window) uses the DOM href.
      anchor.setAttribute("href", next);
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      // A plain click: next/link would navigate from its own prop and drop the
      // parameter, so navigate here instead. A full load is fine on the
      // marketing site, and the next page's ReferralCapture carries it on.
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(next);
    }

    function onConsentChanged() {
      const choice = readConsent();
      if (choice === "accepted") void persist();
      else withdraw();
    }

    if (carried && hasAnalyticsConsent()) void persist();
    document.addEventListener("click", onClick, true);
    window.addEventListener(CONSENT_CHANGED_EVENT, onConsentChanged);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(CONSENT_CHANGED_EVENT, onConsentChanged);
    };
  }, []);

  return null;
}
