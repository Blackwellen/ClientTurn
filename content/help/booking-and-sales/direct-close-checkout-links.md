---
title: Direct close with checkout links
summary: Let the assistant send a lead one of your own approved checkout links, with your exact price wording, when they are ready to buy, and the limits that keep it safe
category: booking-and-sales
keywords: [direct close, checkout link, buy now, payment link, self-serve, ecommerce, price text, discount, maximum discount, approved links, sell without a call, signup]
order: 60
updated: 2026-09-27
screenshots:
  - src: /help/screenshots/booking-and-sales/direct-close-checkout-links-1.png
    alt: "The Selling direct close card with Allow direct close, maximum discount and an approved checkout link"
    caption: "Allow direct close, approve each checkout link and its exact price wording, and set a maximum discount"
---

For businesses that sell without a call, such as self-serve SaaS or ecommerce, the assistant can close the sale by sending a checkout link. It is **off** until you turn it on, and even then it can only send links you have approved, with the price wording you wrote.

## What you need

- A sales motion that closes without a person: self-serve, ecommerce or direct B2B. Set it under **How you sell** in **Settings → AI & selling → Sales behaviour**. On any other motion the assistant will not send a checkout link, because your sale closes through a person.
- Checkout pages you already use, for example a Stripe Payment Link or your shop's product page. ClientTurn does not take payments itself.
- The conversation assistant switched on. See [Setting up AI agents](/help/ai-agents/ai-agents-setup).

## Turn it on

1. Open **Settings → Business Profile** and scroll to **Selling: direct close**.
2. Choose **Add checkout link** and fill in:
   - **Id:** a short name the assistant refers to, in lower-case letters, numbers, `-` or `_`.
   - **Label** and **Product**.
   - **Checkout URL (https)**.
   - **Price text:** exactly the price wording the assistant may repeat, for example "£49 per month".
   - **Currency:** a three-letter code such as GBP.
3. Set **Maximum discount (%)**. Leave it at 0 for no discounts.
4. Optionally set **A person closes deals above (£)**. Above that opportunity value, the lead is handed to your team instead.
5. Tick **Allow direct close**. You need at least one link first.
6. Choose **Save selling settings**.

You can add up to 25 links. Only owners and admins can change these settings.

## What the assistant can and cannot do

- It chooses a link only from your approved list. The link is added to the message by ClientTurn, character for character, so the assistant cannot alter it.
- It may only repeat your **Price text**. It never invents a price.
- Any discount in its message is checked against your **Maximum discount (%)**. A discount above it, or a vague one such as "money off" with no figure, is rejected before sending.
- It never says a purchase has happened. A sale is recorded only when your Stripe account, your order webhook, your CRM or your team confirms it. See [Payment confirmation and the thank-you](/help/booking-and-sales/payment-confirmation) and [Abandoned checkout follow-up](/help/booking-and-sales/abandoned-checkout).
- It does not send a link to someone who cannot be messaged on that channel.

When a link is sent, the lead's opportunity moves to the checkout-sent stage. See [Opportunities, won and lost](/help/booking-and-sales/opportunities-and-won-lost).

## Related

- [Business Profile settings](/help/settings/business-profile-settings)
- [Sales motions and close targets](/help/sales-knowledge/sales-motions-and-close-targets)
- [The handoff brief](/help/booking-and-sales/handoff-brief)
