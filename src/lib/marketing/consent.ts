/**
 * Cookie consent state.
 *
 * PECR regulation 6 permits storing or reading information on a visitor's
 * device without consent only where it is strictly necessary to provide the
 * service the visitor asked for. Campaign attribution and CTA analytics are
 * not strictly necessary, so everything in this module is the gate that keeps
 * them off until the visitor has actively accepted.
 *
 * The published Cookie Policy describes this behaviour. If you change the gate,
 * change the policy in the same commit.
 */

export const CONSENT_STORAGE_KEY = "lr.cookie-consent";
export const CONSENT_CHANGED_EVENT = "lr:cookie-consent-changed";

export type ConsentChoice = "accepted" | "rejected";

export function readConsent(): ConsentChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch {
    // Storage blocked. Treat as "no consent given" — never as consent.
    return null;
  }
}

/** True only once the visitor has actively accepted non-essential storage. */
export function hasAnalyticsConsent(): boolean {
  return readConsent() === "accepted";
}

export function writeConsent(choice: ConsentChoice) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    /* storage blocked — the banner simply reappears next visit */
  }
  window.dispatchEvent(
    new CustomEvent<ConsentChoice>(CONSENT_CHANGED_EVENT, { detail: choice }),
  );
}

/**
 * Clears the recorded choice so the banner is shown again. Used by the
 * "change your cookie choice" control on the Cookie Policy page, which is the
 * withdrawal mechanism PECR and Article 7(3) UK GDPR require to be as easy as
 * giving consent in the first place.
 */
export function resetConsent() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: null }));
}
