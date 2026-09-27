---
title: Getting leads from TikTok lead forms
summary: Bring submissions from TikTok Lead Generation ads into ClientTurn as inbound leads
category: finding-leads
keywords: [tiktok, beta, tiktok ads, lead generation, instant form, tiktok for business, advertiser account, tiktok leads]
order: 60
updated: 2026-09-27
screenshots:
  - src: /help/screenshots/settings/connections-settings-1.png
    alt: "Connection health totals and the lead sources group, with the TikTok Lead Generation card and its Beta badge marked"
    caption: "The TikTok Lead Generation card is in beta; connect your TikTok for Business advertiser account from here"
---

TikTok Lead Generation ads collect details in a form inside TikTok. ClientTurn reads those submissions from your TikTok for Business advertiser account and adds each one to **Leads**, with TikTok as its source.

> **Important:** This connection is in **Beta**, and its card says so. The TikTok endpoint it reads has not yet been confirmed against a live TikTok ad account. After connecting, check that your first TikTok lead arrives, and contact support if it does not.

## Connect TikTok

1. Open **Settings → Connections** and find **TikTok Lead Generation** under **Ads / lead sources**.
2. Choose **Connect**, then **Connect** again in the panel.
3. Sign in to TikTok for Business and authorise ClientTurn for your advertiser account.
4. Back in Connections, the card shows **Connected**.

If the card says **Not yet available**, this deployment does not yet hold the TikTok app credentials the connection needs.

## How leads arrive

ClientTurn checks your advertiser account for new submissions every few minutes. Each one goes through the same intake checks as every source (see [Lead sources explained](/help/finding-leads/lead-sources-explained)), and a new lead is qualified and enters your follow-up sequence.

> **Note:** If a check fails, the card changes to **Reconnect required** with TikTok's reason, and no lead is lost or invented. Leads you can see in TikTok but not in ClientTurn can be downloaded from TikTok and [imported as a CSV](/help/finding-leads/importing-a-csv).

## Related

- [Troubleshooting integrations](/help/integrations/troubleshooting-integrations)
- [Lead sources explained](/help/finding-leads/lead-sources-explained)
