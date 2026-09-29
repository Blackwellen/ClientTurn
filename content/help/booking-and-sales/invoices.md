---
title: Invoices from a signed quote
summary: Turn a signed quote's deposit, balance or instalments into numbered VAT invoices, issue and remind automatically, record payments and issue credit notes
category: booking-and-sales
keywords: [invoice, invoices, invoicing, deposit, balance, instalments, payment reminder, overdue, credit note, void, record payment, vat invoice, pay link, pay now, stripe payment link]
order: 82
updated: 2026-09-28
---

These are invoices to **your** customers. Invoices for your ClientTurn subscription are under **Settings → Billing & Usage**.

Invoices are created from a signed or accepted quote, so the amounts always match it exactly. A quote with a deposit and a balance gets two invoices, and a quote with instalments gets one invoice per instalment. Together they add up to the quote's one-off total and VAT, to the penny.

## Create the invoices

1. Open the lead. On the **Quotes** card, open the signed quote.
2. Choose **Create invoices**. You must be an owner or admin.
3. Choose whether to **issue and email each invoice automatically on its date**.
   - A payment due on acceptance is issued straight away.
   - A later instalment is issued your payment-terms days before it falls due.

Without automatic issue, each invoice stays a draft until you choose **Issue**.

## Issuing

When an invoice is issued:

- it gets its number, for example INV-00031, and its issue and due dates;
- it is emailed to the customer;
- payment reminders are scheduled.

An issued invoice can't be edited.

To change the numbering prefixes, go to **Settings → Quotes & invoices → More options**. Numbers are never reused.

## Reminders

Reminders follow the day offsets under **More options**. The default is 3 days before the due date, on the day, and 3, 7 and 14 days after.

- Weekend dates move to Monday.
- If a reminder was missed, only the latest one is sent, never a burst.
- Reminders respect your contact-frequency limits.
- The first overdue reminder marks the invoice as overdue for your automations and webhooks.

## Payments

To record a payment, choose **Record payment**. Enter the amount, the date and the bank reference.

- The same reference is never counted twice.
- A payment larger than the amount still due is refused.

When a deposit invoice is paid, the quote moves to **Deposit paid**. When every invoice is paid, it moves to **Paid**.

## Pay links

Customers pay you directly, through your own Stripe account. ClientTurn never holds the money and takes no share. Choose how invoices are paid in **Settings → Quotes & invoices → How invoices are paid** (owner or admin):

| Option | What the customer gets |
|---|---|
| **Bank transfer only** (the default) | No pay button. You record payments by hand. |
| **One Stripe Payment Link for every invoice** | Every invoice carries the same link. Make it a "let customers choose what to pay" link in Stripe: the email tells the customer the amount to enter. |
| **A Stripe Payment Link pasted on each invoice** | You paste a fixed-price Payment Link on each invoice from the lead page (**Quotes**, then **Add pay link**). An invoice without one shows no button. |

These settings are for invoices only. The fixed-price checkout links the assistant sends when a lead is ready to buy, and the pay step a catalogue item offers straight after a quote is accepted, are a separate list in **Settings → Business Profile → Selling: direct close**. See [Direct close with checkout links](/help/booking-and-sales/direct-close-checkout-links).

With a link set, **Pay now** appears in the invoice email and every reminder, on the quote page after signing (for the earliest unpaid invoice), and as **Copy pay link** on the lead page. The link carries a reference to the invoice, never the lead.

For payments to be matched automatically, connect your Stripe payments webhook in **Settings → Connections → Payments**. Then:

- A payment that carries the invoice's reference is recorded on that invoice, and the quote moves on as above.
- More than is due: the amount due is recorded and you are told to refund or credit the rest.
- A different currency, an invoice that is already paid or no longer payable, or a payment with no reference: nothing is recorded automatically. It waits for you with the other payments that need a person in **Settings → Connections → Payments**. Record it on the invoice with **Record payment**.
- A refund or dispute on a recorded payment is flagged and you are told. Nothing is reversed: correct a refund with a credit note, and answer a dispute in Stripe.

## Corrections

- **Void** cancels an unpaid invoice. Its number stays in the sequence.
- A paid invoice is corrected with a **credit note**. A credit note can never be for more than was paid, and it splits the VAT in the same proportions as the invoice. You refund the money yourself in your payment provider.

## Related

- [Quotes from your catalogue](/help/booking-and-sales/quotes)
- [E-signatures on quotes](/help/booking-and-sales/e-signatures)
