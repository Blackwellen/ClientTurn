---
title: Emails are bouncing or not sending
summary: Mailbox connection, sender pauses, domain health and email allowances, and what ClientTurn does to protect your reputation
category: troubleshooting
keywords: [email bounce, bounces, email not sending, mailbox disconnected, smtp error, spf, dkim, dmarc, sender paused, deliverability]
order: 70
updated: 2026-09-29
---

Look at **Settings → System check → Text replies and follow-up**, at **Email mailbox**, **Sender health** and the email allowance.

## Common reasons

| What System check says | What it means | Fix |
|---|---|---|
| Email mailbox: Off by choice | No mailbox is connected. Email has no fallback sender, so nothing can be emailed | Connect your mailbox in **Settings → Connections** |
| Email mailbox: Needs attention | Your mailbox rejected ClientTurn (often a changed password or app password) | Reconnect it in **Settings → Connections**; the error is shown in the reason |
| Sender health: Needs attention | A sender is paused, or a sending domain is at warning or paused on its daily health check because of bounces or complaints | Open **Sending domain health** in **Settings → Connections** and fix the SPF, DKIM or DMARC record it lists |
| Email allowance: Needs attention | This period's email allowance is used or nearly used | **Settings → Billing & Usage** |

## Why ClientTurn pauses a sender

A high bounce or complaint rate damages your domain's reputation for every email you send, not just ClientTurn's. When a domain crosses the safe rate, email from it is held until it recovers. Addresses that hard-bounce are added to your suppression list and are not emailed again.

## Related

- [Setting up email outreach](/help/integrations/setting-up-email-outreach)
- [Suppression and unsubscribe](/help/compliance/suppression-and-unsubscribe)
