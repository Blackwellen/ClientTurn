---
title: Payment confirmation and the thank-you
summary: Let your own Stripe account, or a signed "order paid" webhook, tell ClientTurn when a lead pays a checkout link, so the deal is marked won, follow-up stops and the lead is thanked
category: booking-and-sales
keywords: [payment, paid, stripe webhook, signing secret, whsec, order paid, shopify, woocommerce, gocardless, paddle, zapier, won, thank you, next steps, client_reference_id, ct_ref, unmatched payment, link to lead]
order: 62
updated: 2026-09-27
---

When the assistant sends one of your approved checkout links (see [Direct close with checkout links](/help/booking-and-sales/direct-close-checkout-links)), ClientTurn can find out when the lead pays. It then marks the deal won with the amount, stops that lead's follow-up and sends them a short thank-you with your next steps.

ClientTurn never takes the payment itself, and there is no Stripe Connect. The confirmation comes from **your** Stripe account or **your** shop.

## How a payment is matched to a lead

Every checkout link the assistant sends carries a private reference that is unique to that send. It is random and never your lead's id or details.

- **Stripe Payment Links** (`buy.stripe.com`) carry it as `client_reference_id`. Stripe returns it with the payment automatically.
- **Other checkouts** carry it as `ct_ref` (or the **Tracking parameter** you set on the link). It only comes back if your shop keeps it on the order and your webhook sends it as `reference`. Many product pages drop unknown parameters, so check yours.

| What came back | What happens |
|---|---|
| The reference | Certain match. The lead is marked won and thanked straight away. |
| Only an email that matches one lead | Shown under **Payments needing a lead** as **Confirm lead**. Nothing happens until you confirm it. |
| Nothing that matches | Shown as **No lead found**. Link it to the right lead yourself. |

A payment is never ignored. You get a notification whenever one needs you.

## Connect your Stripe account

1. Open **Settings → Connections** and find **Payments: Stripe**.
2. Choose **Create Stripe endpoint** and copy the endpoint URL.
3. In your Stripe dashboard, go to **Developers → Webhooks**, add an endpoint with that URL, and select the events `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `invoice.paid`.
4. Copy the endpoint's **Signing secret** (it starts `whsec_`) and paste it into the card. It is stored encrypted and never shown again.

Deliveries are refused until a secret is saved. The card shows when the last delivery arrived and the last problem, if there was one.

## Use a different shop or payment provider

Use **Payments: order paid webhook** for Shopify, WooCommerce, GoCardless, Paddle or anything that can send a signed request.

1. Choose **Create endpoint and secret**. Copy the secret now, because it is shown once.
2. When an order is paid, send a `POST` to the endpoint URL with a JSON body containing `order_id`, `amount` (for example `49.99`), `currency`, and where you can, `reference` and `email`. For a subscription, add `recurring` and `interval`.
3. Sign it: header `X-ClientTurn-Timestamp` (Unix seconds) and header `X-ClientTurn-Signature`, the HMAC-SHA256 of `timestamp.body` with your secret, in hex.

Shopify and WooCommerce cannot compute this signature from their own webhook settings. Send it from Zapier (a Code step), Make or your own server. The full contract is in the developer documentation.

## What the lead receives

One message, on the channel the checkout link went out on, for example:

> Thank you, Hannah! Your payment for Bramble Team plan has come through. Your workspace invite is on its way to your inbox.

The last sentence is the **Next steps after payment** text you set on the checkout link. If you leave it blank, the message says your team will be in touch with the next steps. Opt-outs, quiet hours and a colleague's takeover still apply to it.

## Subscriptions

For a subscription, the deal is recorded at its monthly value (a yearly plan counts as one twelfth a month). Later renewals are recorded against the same lead without a second thank-you.

## Where you see it

- On the lead page, **Checkout and payments** lists each link sent, whether it was paid and the amount.
- Opportunities show the deal as won with the amount. Your CRM and your webhooks receive `opportunity.won` with the payment details.
