---
title: Getting leads from Google Ads lead forms
summary: Bring Google Ads lead-form submissions into ClientTurn by polling, and optionally by Google's lead-form webhook for faster delivery
category: finding-leads
keywords: [google ads, lead form extension, lead form asset, google_key, webhook, gclid, search ads, google leads]
order: 30
updated: 2026-09-26
---

ClientTurn can receive Google Ads lead-form submissions in two ways. You can use either or both: every submission carries Google's own lead ID, so a lead that arrives by both routes is recorded once.

| Route | Speed | Setup |
|---|---|---|
| Polling | ClientTurn checks for new submissions every few minutes | Connect Google Ads in Settings |
| Webhook | Google sends each submission the moment it happens | Paste a webhook address and key into each lead form in Google Ads |

## Connect Google Ads (polling)

1. Open **Settings → Connections** and find **Google Ads** under **Ads / lead sources**.
2. Choose **Connect**, then **Connect** again in the panel.
3. Sign in with the Google account that has access to your Google Ads account, and approve access.
4. Back in Connections, the card shows **Connected**.

On the first check ClientTurn looks back over the previous 24 hours. After that it picks up from where it left off, and it never moves past a submission it failed to save, so a temporary error does not lose a lead.

> **Note:** Google keeps lead-form data for a limited time. If you connect weeks after a campaign started, older submissions will not be collected; download those from Google Ads and [import them as a CSV](/help/finding-leads/importing-a-csv).

## Add the webhook (optional, faster)

Google's lead-form webhook sends each submission to a web address, with a secret key Google calls `google_key`. ClientTurn creates a key for your workspace when you connect Google Ads.

1. In Google Ads, open the lead form asset and find the **Lead delivery option** (webhook integration).
2. Enter your ClientTurn webhook URL and key.
3. Use Google's **Send test data** button. Test submissions are marked as test leads in ClientTurn.

> **Important:** At the time of writing, the webhook address and key are not yet shown on the Google Ads card in Settings. If you want to use the webhook and cannot see them, contact support from the help button and we will provide them. Polling works without the webhook.

How the webhook behaves:

- A request with the wrong key is refused, and Google does not retry it.
- A request ClientTurn could not save because of a temporary problem is answered so that Google retries it.
- The lead itself is processed moments after the request is accepted, not inside it.

## What happens to each lead

Each submission goes through the same intake checks as every other source (see [Lead sources explained](/help/finding-leads/lead-sources-explained)). The form, campaign and Google click ID (GCLID) are recorded for attribution, and speed-to-lead is measured from the time the person submitted the form. A new lead is qualified and enters your follow-up sequence.

## If leads stop arriving

- A **Reconnect required** status on the card means Google refused ClientTurn's access, usually because it was revoked. Choose **Reconnect**.
- If the card shows an error message, it is Google's reason for the last failed check.

## Related

- [Connecting Google Ads](/help/integrations/connecting-google-ads)
- [Troubleshooting integrations](/help/integrations/troubleshooting-integrations)
