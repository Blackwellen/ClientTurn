# 14 — Quote-to-cash: capability entitlements and plan defaults

Written 2026-09-27 (P2 quote-to-cash). The code is `src/lib/billing/capability-rules.ts`
(pure rules and defaults) and `src/lib/billing/capabilities.ts` (`can(businessId, capability)`).
Migration **0156** writes the rows. **It is not applied yet.** Until it is, `can()` falls back to
the identical defaults in code. `tests/capabilities.test.ts` holds the code, the migration rows and
the public site (`marketing/voice-offer.ts` `QUOTES_ON_PLAN`) together.

## One enforcement path

A capability is a `plan_entitlements` row (`unit = 'boolean'`, 1 or 0; a numeric capability holds
its allowance), plus any live `business_entitlement_grants` row for the workspace:

- A grant only raises a value.
- An expired or revoked grant is ignored.
- An inactive subscription allows nothing.
- An unknown plan denies.

Quote, e-signature, invoicing and voice gates call only `can()`. None of them checks a plan by name
(`tests/quote-service.test.ts` asserts this for the quote-to-cash files).

## Plan defaults (owner decision 2026-09-27)

| Capability | Trial | Starter | Growth | Pro | Enterprise |
|---|---|---|---|---|---|
| `quote_builder_enabled` | off | on | on | on | on |
| `esign_enabled` | off | on | on | on | on |
| `invoicing_enabled` | off | on | on | on | on |
| `quote_approval_enabled` | off | off | on | on | on |
| `quote_ai_enabled` | off | on* | on* | on* | on* |
| `direct_close_enabled` | on | on | on | on | on |
| `white_label_public_pages` | off | off | off | off | off |
| `voice_sales_enabled` | 0 | 0 | 0 | 0 | 0 |
| `voice_minutes_included` | 0 | 0 | 0 | 0 | 0 |

\* `quote_ai_enabled` also needs the existing AI-assistant entitlement (`aiAssistAllowed`, applied in
`capabilities.ts`) and the workspace's own AI switch, which the agent runtime checks.

## Why

- **Quotes, e-signature and invoicing are on every paid plan.** A quote costs almost nothing to
  produce: a PDF, a few rows and one stored object. Quoting, signing and invoicing are also what turn
  a qualified lead into revenue. That makes them a differentiator on every plan, not an upsell.
- **The trial is off.** A public, signable, branded document sent from an account that has not paid
  is an abuse vector, and the trial gains nothing from it. The locked state names the plan that
  unlocks it (the plan-limit-reached state).
- **Approvals start at Growth.** Growth is the first plan with more than one user, and an approval
  chain needs a second person.
- **White-label is off everywhere.** OD-1 says the "Powered by ClientTurn" badge shows on public
  pages. Removing it will be a future paid add-on, granted as a row in `business_entitlement_grants`.
- **Voice stays 0 on every plan.** OD-2 grants voice from the Stripe voice item or a minute pack,
  never from the plan. This uses the 0151 rows unchanged.
- **Direct close is on for the trial and every plan.** Every workspace has it today. The key exists
  so later gates can go through `can()`, and this default changes nothing that already works.

## Economics note

Per-quote cost of goods:

| Item | Cost |
|---|---|
| PDF | Rendered in the background job by an in-repo writer: no dependency and no provider cost (see below). |
| Storage | One R2 object per sent revision. |
| Email | One email through the workspace's existing sending path, counted against its normal allowance. |
| Reminders | At most two automated reminders per quote, through the re-engagement frequency guard. |

There is no new metered usage. Payment is collected through the customer's own Stripe account, so
ClientTurn never holds the money and pays no processing fees.

## Paying an invoice (quote -> pay)

Added 2026-09-28, migration **0173_invoice_pay_links.sql (not applied yet)**. Until it is applied,
every workspace reads as "bank transfer only" and nothing below changes behaviour.

**Who holds the money.** The workspace is the merchant of record on its own Stripe account
(CLAUDE.md, Resolved conflict 8). ClientTurn creates no Stripe object, uses no Stripe Connect and
holds no funds. It sends the workspace's own link and reads the payment result.

**Setup (Settings -> Quotes & invoices, "How invoices are paid").** Owner or admin, through
`quote_settings.update`. There are three modes:

| Mode | What the customer gets |
|---|---|
| `NONE` (the default) | Bank transfer only. No pay button anywhere. |
| `WORKSPACE_LINK` | One Stripe Payment Link for every invoice. Make it a "let customers choose what to pay" link: the email and page tell the customer to enter the amount due. |
| `PER_INVOICE` | A person pastes a fixed-price Payment Link on each invoice (lead page -> Quotes -> Add pay link, `invoice.set_pay_link`, UI-only, admin). An invoice without one shows no button. |

**The link.** When an invoice is issued it gets an opaque pay token (`invoices.pay_token`, random,
fixed once set by a 0173 trigger). The link sent is the workspace's link plus one parameter, using the
same mechanism as tracked checkout links (`payments/tracking.ts`):

- `client_reference_id=<token>` on `buy.stripe.com`;
- `ct_ref=<token>` otherwise.

The URL never contains the lead id. `invoicing/pay-link.ts` `invoicePayUrl` is the one rule. It
returns no link when the mode is `NONE`, no link is configured, the invoice is not `OPEN` or
`PARTIALLY_PAID`, or it has no token. Where the "Pay now" button shows:

- in the invoice email and each reminder (`invoicing/store.ts` `deliverInvoice`);
- on the public quote page, after signing, for the earliest unpaid invoice with a link
  (`quotes/public-server.ts` `paymentNextStep`; the page only reads, and never writes);
- as "Copy pay link" on the lead page.

**Settlement.** This uses the same path as a direct sale:

1. The customer's Stripe sends `checkout.session.completed` to the workspace's payments webhook.
2. The webhook verifies the signature, writes `webhook_events`, acknowledges, and queues
   `payment.confirm`. There is no provider I/O in the request.
3. `payments/confirm.ts` records the `checkout_payments` row.
4. If its token is an invoice's pay token, the payment is recorded on that invoice through the
   invoicing append-payment path (`service-core.ts` `recordPayment`). The rest is the existing
   machinery:
   - the 0154 trigger moves `paid_minor` and the status;
   - `invoice.paid` is emitted by the insert that paid the invoice off, and only by that insert;
   - `projectOntoQuote` moves the quote to `DEPOSIT_PAID` (a deposit invoice) or `PAID` (every
     schedule invoice paid), which also stops the sales chase.

   An invoice payment closes no opportunity and sends no thank-you. The checkout row becomes
   `MATCHED`, `match_kind = 'INVOICE'`, with `invoice_id` set.

**Settlement rules** (`invoicing/settlement.ts`, `tests/invoice-pay-links.test.ts`):

| Payment | Result |
|---|---|
| Token names an open invoice in this workspace, amount <= due, same currency | Recorded; the invoice is `PARTIALLY_PAID` or `PAID` |
| Amount > due | The amount due is recorded; the payment is flagged `OVERPAID` and the owner told to refund or credit the rest |
| Currency differs | `REVIEW` (`CURRENCY_MISMATCH`); nothing recorded |
| Invoice already `PAID` | `REVIEW` (`INVOICE_ALREADY_PAID`); nothing recorded |
| Invoice `DRAFT`, `VOID` or `UNCOLLECTIBLE`, or changed underneath | `REVIEW` (`INVOICE_NOT_PAYABLE`) |
| Same provider payment again (duplicate webhook, retried job, crash mid-way) | Nothing recorded again. The invoice payment is unique on (workspace, provider, order id). A retry after a crash finishes the quote projection without a second `invoice.paid`. |
| No token, or an email-only match | `REVIEW` on the payment, as for any direct sale. **Never** an automatic invoice settlement. |
| Token names another workspace's invoice | Ignored for invoicing (lookups are workspace-scoped) |
| `charge.refunded` / `charge.dispute.created` on a recorded payment | Flagged `REFUNDED` / `DISPUTED` and the owner told. Nothing is reversed: a refund is corrected with a credit note (`invoice.credit_note`), and a dispute is answered in Stripe. |

REVIEW items appear with the other payments needing a person (Settings -> Connections -> Payments),
and the owner gets one notification per payment and reason. Resolve an invoice REVIEW item by
recording the payment on the invoice by hand (Record payment). Linking it to the lead would treat it
as a direct sale.

**Stripe webhook events.** `checkout.session.completed`, `checkout.session.async_payment_succeeded`
and `invoice.paid` are needed. Add `charge.refunded` and `charge.dispute.created` to have refunds and
disputes flagged.

**Test it end to end in Stripe TEST mode (no live account, no code calls Stripe):**

1. Apply 0173. In the workspace's Stripe account, switch to Test mode.
2. Create a Payment Link: Product "Invoice payment", "Let customers choose what to pay", GBP.
3. Paste the `https://buy.stripe.com/test_...` URL into Settings -> Quotes & invoices -> "One Stripe
   Payment Link for every invoice". Save.
4. Settings -> Connections -> Payments: create the Stripe endpoint. In Stripe (Test mode) ->
   Developers -> Webhooks, add its URL with the events above, and paste the `whsec_` secret.
5. On a lead, build a quote with a deposit, send it, then open the link and sign it.
6. Create invoices (automatic issue on). The deposit invoice is issued and emailed with "Pay now".
   The quote page shows the button too.
7. Pay with `4242 4242 4242 4242`, any future date, any CVC, entering the deposit amount.
8. Within a minute, the deposit invoice is PAID and the quote is DEPOSIT_PAID. Pay the balance
   invoice the same way, and the quote moves to PAID.

## PDF dependency decision

The repo has no PDF library, and a quote is text, rules and a table. `src/lib/quotes/pdf.ts` is a
small PDF 1.4 writer. It uses the standard Helvetica fonts (built into every reader, nothing embedded)
with WinAnsi encoding.

This has three advantages over a dependency:

- no bundle-size or cold-start cost;
- no supply-chain surface;
- **deterministic output**: the same revision always produces byte-identical bytes.

The logo is not drawn in the PDF. The public page shows it.

## Open questions

- Should white-label be sold as an add-on, and at what price?
- Should Enterprise contracts include white-label by default?
