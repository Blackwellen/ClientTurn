---
title: Connecting Google Ads
summary: Connect your Google Ads account so lead-form submissions are collected automatically, and how the optional webhook fits in
category: integrations
keywords: [google ads, adwords, lead form asset, oauth, google account, google_key, webhook, reconnect google]
order: 56
updated: 2026-09-26
---

## Connect

1. Open **Settings → Connections**, find **Google Ads** under **Ads / lead sources** and choose **Connect**, then **Connect** again in the panel. Only owners and admins can connect.
2. Sign in with a Google account that has access to your Google Ads account, and approve access.
3. Back in Connections, the card shows **Connected**.

From then on ClientTurn checks your lead forms for new submissions every few minutes.

Connecting also creates the secret key your workspace uses for Google's lead-form webhook, which delivers each submission instantly. See [Getting leads from Google Ads lead forms](/help/finding-leads/google-ads-lead-forms) for how to set the webhook up and its current status.

## Disconnecting

In the card's **Manage** panel, choose **Disconnect Google Ads**. New leads from your Google Ads lead forms stop arriving. Leads already in ClientTurn keep their follow-up.

## Reconnect required

If Google refuses ClientTurn's access, for example because it was revoked in your Google account's security settings, the card shows **Reconnect required** with Google's reason. Choose **Reconnect**.

## Related

- [Getting leads from Google Ads lead forms](/help/finding-leads/google-ads-lead-forms)
- [Troubleshooting integrations](/help/integrations/troubleshooting-integrations)
