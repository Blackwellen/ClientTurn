/**
 * Invoice pay links: how a customer pays an invoice online (0173).
 *
 * Pure and browser-safe (zod and relative imports only), so the settings
 * form, the invoice email, the public quote page and tests/invoice-pay-links
 * all use the same rules.
 *
 * The workspace is the merchant of record on ITS OWN Stripe account
 * (CLAUDE.md, Resolved conflict 8). ClientTurn never creates a Stripe object
 * and never holds money: the workspace pastes a Payment Link it made in its
 * own Stripe dashboard, and ClientTurn sends that link with ONE extra query
 * parameter -- an opaque per-invoice token -- using the same mechanism as
 * tracked checkout links (payments/tracking.ts):
 *
 *   * `buy.stripe.com` links carry the token in `client_reference_id`, which
 *     Stripe copies onto the Checkout Session and returns in
 *     `checkout.session.completed`;
 *   * any other link carries it in `ct_ref`, which comes back only if the
 *     shop passes it to the order-paid webhook as `reference`.
 *
 * The token names the invoice, never the lead. When a verified payment comes
 * back carrying it, `payment.confirm` records the payment on that invoice
 * (invoicing/settlement.ts).
 *
 * Modes:
 *
 *   NONE            bank transfer only: no online pay button anywhere.
 *   WORKSPACE_LINK  one Payment Link for every invoice. Make it a "let
 *                   customers choose what to pay" link, so the customer
 *                   enters the amount due on the invoice.
 *   PER_INVOICE     a person pastes a link on each invoice (a fixed-price
 *                   Payment Link for that amount). An invoice with no link
 *                   pasted shows no button.
 */

import { z } from "zod";
import {
  DEFAULT_TRACKING_PARAM,
  STRIPE_TRACKING_PARAM,
  TRACKING_TOKEN_PATTERN,
  isStripePaymentLink,
  tagCheckoutUrl,
  trackingParamFor,
} from "../payments/tracking.ts";

export const INVOICE_PAY_MODES = ["NONE", "WORKSPACE_LINK", "PER_INVOICE"] as const;
export type InvoicePayMode = (typeof INVOICE_PAY_MODES)[number];

export const INVOICE_PAY_MODE_LABEL: Record<InvoicePayMode, string> = {
  NONE: "Bank transfer only",
  WORKSPACE_LINK: "One Stripe Payment Link for every invoice",
  PER_INVOICE: "A Stripe Payment Link pasted on each invoice",
};

/** Only an issued, unpaid invoice shows a pay button. */
export const PAYABLE_INVOICE_STATUSES = ["OPEN", "PARTIALLY_PAID"] as const;

export const PAY_LINK_MAX_LENGTH = 2000;

/**
 * A link the workspace made in its own payment provider. https only, no
 * credentials, and not already carrying a tracking parameter (ClientTurn adds
 * exactly one, per invoice).
 */
export function payLinkProblem(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return "Paste the full link, starting with https://";
  }
  if (parsed.protocol !== "https:") return "The link must start with https://";
  if (parsed.username || parsed.password) return "The link must not contain a username or password.";
  if (value.trim().length > PAY_LINK_MAX_LENGTH) return "That link is too long.";
  if (parsed.searchParams.has(STRIPE_TRACKING_PARAM) || parsed.searchParams.has(DEFAULT_TRACKING_PARAM)) {
    return `Remove the ${parsed.searchParams.has(STRIPE_TRACKING_PARAM) ? STRIPE_TRACKING_PARAM : DEFAULT_TRACKING_PARAM} part: ClientTurn adds its own reference to each invoice.`;
  }
  return null;
}

export const payLinkUrlSchema = z
  .string()
  .trim()
  .min(1, "Paste the payment link.")
  .max(PAY_LINK_MAX_LENGTH)
  .superRefine((value, ctx) => {
    const problem = payLinkProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

/** Settings -> Quotes & invoices, "How invoices are paid". */
export const invoicePaySettingsSchema = z
  .object({
    invoicePayMode: z.enum(INVOICE_PAY_MODES).default("NONE"),
    invoicePayLinkUrl: z
      .string()
      .trim()
      .max(PAY_LINK_MAX_LENGTH)
      .nullable()
      .optional()
      .transform((value) => (value ? value : null)),
  })
  .superRefine((value, ctx) => {
    if (value.invoicePayMode === "WORKSPACE_LINK" && !value.invoicePayLinkUrl) {
      ctx.addIssue({ code: "custom", path: ["invoicePayLinkUrl"], message: "Paste your Stripe Payment Link, or choose bank transfer only." });
    }
    if (value.invoicePayLinkUrl) {
      const problem = payLinkProblem(value.invoicePayLinkUrl);
      if (problem) ctx.addIssue({ code: "custom", path: ["invoicePayLinkUrl"], message: problem });
    }
  });

/** A per-invoice link, pasted on one invoice (`invoice.set_pay_link`); null removes it. */
export const setInvoicePayLinkSchema = z.object({
  invoiceId: z.uuid(),
  url: payLinkUrlSchema.nullable(),
});

export type InvoicePaySettings = { mode: InvoicePayMode; workspaceLinkUrl: string | null };

export type InvoicePayFields = {
  status: string;
  /** The invoice's opaque tracking token (set when it is issued). */
  payToken: string | null;
  /** PER_INVOICE mode: the link a person pasted on this invoice. */
  payLinkUrl: string | null;
};

/** The untagged base link this invoice would be paid through, or null. */
export function invoicePayBase(settings: InvoicePaySettings, invoice: Pick<InvoicePayFields, "payLinkUrl">): string | null {
  if (settings.mode === "NONE") return null;
  const base = settings.mode === "WORKSPACE_LINK" ? settings.workspaceLinkUrl : invoice.payLinkUrl;
  if (!base || payLinkProblem(base)) return null;
  return base;
}

/**
 * The link the customer is sent for this invoice: the workspace's link with
 * the invoice's token in the tracking parameter. Null -- and so no pay
 * button -- when payment is bank transfer only, no link is configured, the
 * invoice is not payable (draft, paid, void, written off) or it has no token.
 */
export function invoicePayUrl(settings: InvoicePaySettings, invoice: InvoicePayFields): string | null {
  if (!(PAYABLE_INVOICE_STATUSES as readonly string[]).includes(invoice.status)) return null;
  if (!invoice.payToken || !TRACKING_TOKEN_PATTERN.test(invoice.payToken)) return null;
  const base = invoicePayBase(settings, invoice);
  if (!base) return null;
  return tagCheckoutUrl(base, trackingParamFor({ url: base }), invoice.payToken);
}

/** Whether a payment through this link is settled automatically, in words for the settings form. */
export function payLinkSettlementNote(url: string | null): string | null {
  if (!url || payLinkProblem(url)) return null;
  return isStripePaymentLink(url)
    ? "Payments through this link are recorded on the invoice automatically once your Stripe webhook is connected (Settings > Connections > Payments)."
    : "This is not a Stripe link: a payment is recorded automatically only if your shop sends the ct_ref value to the order-paid webhook as reference. Otherwise record it by hand.";
}
