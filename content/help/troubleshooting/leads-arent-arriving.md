---
title: Leads aren't arriving from Meta or Google
summary: Check the connection, its access expiry, the last activity and any error for each lead source
category: troubleshooting
keywords: [no leads, meta leads missing, facebook lead ads, google ads leads, linkedin lead gen, tiktok leads, reconnect, token expired, webhook]
order: 50
updated: 2026-09-29
---

Look at **Settings → System check → Lead sources**. Each source shows whether it is connected, when it was last active, and the last error.

## Common reasons

| What System check says | What it means | Fix |
|---|---|---|
| Not connected | Nothing is connected for that source, so no leads can arrive from it | **Settings → Connections** |
| Reconnect required | The connection lost access (a password change, removed permission or an expired sign-in) | Reconnect it in **Settings → Connections** |
| Meta's access expires soon, or has expired | Meta's access lasts about 60 days and can't renew itself | Reconnect Meta before it expires |
| The last check failed | The source returned an error, shown in the reason | Follow the error; usually reconnect or re-select the Page or form |
| Webhooks and apps: Needs attention | Deliveries from a form, Zapier or another app couldn't be turned into leads (often a missing email or phone) | Fix the mapping in the sending app, then check **Settings → Connections** |

## Also check

- **Meta**: the Page and the lead forms you want are selected on the Meta card in **Settings → Connections**.
- **Google Ads**: the webhook address and key are pasted into the lead form in Google Ads exactly as shown.
- **Plan and limits**: if your plan's lead allowance is reached, System check lists it under **Plan and limits**.

## Related

- [Meta Lead Ads](/help/finding-leads/meta-lead-ads)
- [Google Ads lead forms](/help/finding-leads/google-ads-lead-forms)
- [Troubleshooting integrations](/help/integrations/troubleshooting-integrations)
