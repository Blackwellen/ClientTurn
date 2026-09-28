/**
 * VAT readiness (todo O7, gap audit 15 §6): Stripe Tax behind one switch.
 *
 * `STRIPE_AUTOMATIC_TAX=true` turns on, for every Checkout ClientTurn builds
 * (subscription, SMS/WhatsApp top-ups, AI token packs, voice minute packs):
 *
 *   * `automatic_tax: { enabled: true }`  -- Stripe calculates and adds VAT;
 *   * `tax_id_collection: { enabled: true }` -- a UK B2B buyer can enter a VAT
 *     number, which Stripe validates and prints on the invoice;
 *   * `billing_address_collection: "required"` -- Stripe Tax needs the
 *     customer's location to decide the rate;
 *   * `customer_update: { address: "auto", name: "auto" }` when an existing
 *     customer is passed (Stripe requires it for the two above), or
 *     `customer_creation: "always"` on a one-off payment without a customer
 *     (a tax ID needs a customer to live on).
 *
 * Default OFF. The owner must first register for VAT, then add the
 * registration in Stripe Tax (Dashboard, Tax, Registrations) and set a
 * product tax code; only then set the variable. With it off, Checkout is
 * unchanged and the public copy must not claim VAT is added at checkout.
 *
 * Pure (reads only the env object it is given), so the pricing pages and the
 * tests use it without `server-only`.
 */

type EnvLike = Record<string, string | undefined>;

/** Exactly "true" (case-insensitive) turns it on; anything else is off. */
export function automaticTaxEnabled(env: EnvLike = process.env): boolean {
  return (env.STRIPE_AUTOMATIC_TAX ?? "").trim().toLowerCase() === "true";
}

export type TaxCheckoutParams = {
  automatic_tax?: { enabled: true };
  tax_id_collection?: { enabled: true };
  billing_address_collection?: "required";
  customer_update?: { address: "auto"; name: "auto" };
  customer_creation?: "always";
};

/**
 * The Checkout params for tax, or `{}` when the switch is off.
 *
 * @param mode the Checkout mode ("subscription" always creates a customer;
 *        a "payment" session only does when asked)
 * @param hasCustomer an existing Stripe customer id is passed to the session
 */
export function taxCheckoutParams(input: {
  enabled: boolean;
  mode: "subscription" | "payment";
  hasCustomer: boolean;
}): TaxCheckoutParams {
  if (!input.enabled) return {};
  return {
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    billing_address_collection: "required",
    ...(input.hasCustomer
      ? { customer_update: { address: "auto" as const, name: "auto" as const } }
      : input.mode === "payment"
        ? { customer_creation: "always" as const }
        : {}),
  };
}

/**
 * The VAT sentence the pricing pages show. True either way:
 *
 *   on  -- Stripe adds VAT at checkout and takes a VAT number there;
 *   off -- no claim that VAT is added at checkout; any VAT due appears on the
 *          invoice, which the billing portal keeps.
 */
export function vatCopy(enabled: boolean): { short: string; faq: string } {
  if (enabled) {
    return {
      short: "Prices exclude VAT, which is added at checkout.",
      faq: "No. All prices exclude VAT. UK VAT is calculated and added at checkout, and you can enter your VAT number there so it appears on your invoices.",
    };
  }
  return {
    short: "Prices exclude VAT.",
    faq: "No. All prices exclude VAT. Any VAT due is shown separately on your invoice, and every invoice is available in the billing portal.",
  };
}
