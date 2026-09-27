/**
 * Tracked checkout links (the direct-sale loop, step 1).
 *
 * Pure and browser-safe (no imports), so the settings form can preview the
 * parameter and tests/direct-sale.test.ts asserts every rule. Token
 * generation, which needs `node:crypto`, is in ./tracking-token.ts.
 *
 * Every checkout link the assistant sends carries ONE extra query parameter:
 * an opaque token that identifies the send (a `checkout_attempts` row), never
 * the lead id. When the payment comes back the token is what ties the money
 * to the lead with certainty.
 *
 *   * Stripe Payment Links (`https://buy.stripe.com/...`) take
 *     `client_reference_id`, which Stripe copies onto the Checkout Session and
 *     sends back in `checkout.session.completed`. Stripe accepts alphanumerics,
 *     dashes and underscores, up to 200 characters, and silently drops
 *     anything else -- so the token alphabet is exactly that
 *     (docs.stripe.com/payment-links/url-parameters, read 2026-09-27).
 *   * Every other provider gets a configurable parameter, `ct_ref` by
 *     default. It only comes back if the customer's shop passes it through to
 *     the order (a Shopify cart attribute, a WooCommerce order meta field, a
 *     Paddle custom_data value) and their "order paid" webhook sends it as
 *     `reference`. A plain product page usually drops unknown query
 *     parameters; the payment then falls back to an email match, which is a
 *     REVIEW match, never an automatic win.
 *
 * The validator admits a tagged URL only when its base is an approved link
 * allowed on this turn AND the one extra parameter is this link's tracking
 * parameter carrying a well-formed token. Nothing else may differ.
 */

export const DEFAULT_TRACKING_PARAM = "ct_ref";
export const STRIPE_TRACKING_PARAM = "client_reference_id";

/** Stripe's client_reference_id alphabet, with a floor that keeps it unguessable. */
export const TRACKING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** A parameter name a shop could plausibly read back: letters, digits, _ - . [ ]. */
export const TRACKING_PARAM_PATTERN = /^[A-Za-z0-9_.[\]-]{1,64}$/;

/** A Stripe-hosted Payment Link. Custom-domain payment links set the parameter explicitly. */
export function isStripePaymentLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "buy.stripe.com";
  } catch {
    return false;
  }
}

/** The parameter a link's token travels in: explicit, else Stripe's, else ct_ref. */
export function trackingParamFor(link: { url: string; tracking_param?: string | null }): string {
  const explicit = link.tracking_param?.trim();
  if (explicit && TRACKING_PARAM_PATTERN.test(explicit)) return explicit;
  return isStripePaymentLink(link.url) ? STRIPE_TRACKING_PARAM : DEFAULT_TRACKING_PARAM;
}

/** The approved URL with exactly one added parameter: `param=token`. */
export function tagCheckoutUrl(url: string, param: string, token: string): string {
  if (!TRACKING_TOKEN_PATTERN.test(token)) throw new Error("Invalid checkout tracking token.");
  if (!TRACKING_PARAM_PATTERN.test(param)) throw new Error("Invalid checkout tracking parameter.");
  const parsed = new URL(url);
  parsed.searchParams.delete(param);
  parsed.searchParams.append(param, token);
  return parsed.toString();
}

function comparable(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+(?=\?|#|$)/, "")
    .toLowerCase();
}

/**
 * Splits a URL found in a message into its base and token, when it carries
 * `param` exactly once with a well-formed token. Null otherwise. Trailing
 * sentence punctuation is ignored, as the validator ignores it.
 */
export function untagCheckoutUrl(candidate: string, param: string): { base: string; token: string } | null {
  const cleaned = candidate.trim().replace(/[.,;:!?)]+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
  } catch {
    return null;
  }
  const values = parsed.searchParams.getAll(param);
  if (values.length !== 1 || !TRACKING_TOKEN_PATTERN.test(values[0])) return null;
  parsed.searchParams.delete(param);
  return { base: parsed.toString(), token: values[0] };
}

/** True when two URLs name the same page with the same query (scheme, www, case and a trailing slash aside). */
export function sameCheckoutUrl(a: string, b: string): boolean {
  const left = safeCanonical(a);
  const right = safeCanonical(b);
  return left !== null && left === right;
}

function safeCanonical(value: string): string | null {
  try {
    const cleaned = value.trim().replace(/[.,;:!?)]+$/, "");
    const parsed = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
    return comparable(parsed.toString());
  } catch {
    return null;
  }
}

/**
 * The token in `candidate` when it is `baseUrl` plus exactly the tracking
 * parameter and nothing else; null otherwise. This is the validator's rule.
 */
export function trackedTokenFor(candidate: string, baseUrl: string, param: string): string | null {
  const split = untagCheckoutUrl(candidate, param);
  if (!split) return null;
  return sameCheckoutUrl(split.base, baseUrl) ? split.token : null;
}
