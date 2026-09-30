---
title: Using System check to find out why something isn't working
summary: One page that checks every part of ClientTurn for your workspace and links straight to the setting that fixes each problem
category: troubleshooting
keywords: [system check, troubleshooting, not working, diagnostics, health check, status, why, needs attention, off by choice]
order: 10
updated: 2026-09-29
---

When something isn't happening (the AI isn't replying, calls aren't ringing, leads aren't arriving) the reason is usually a setting in one place stopping something in another. **Settings → System check** checks all of them at once.

## Open it

1. Open **Settings**.
2. Choose **System check**.

The check runs live every time you open the page. Choose **Check again** after changing a setting to see the result straight away.

## What it checks

| Area | What it looks at |
|---|---|
| AI assistant | Whether it is on, its mode (Suggest replies or Reply automatically) and the channels it works on |
| Text replies and follow-up | SMS, WhatsApp and your mailbox, quiet hours, sender and domain health, and your message allowances |
| AI voice calls | Voice on your plan, the voice switch, the AI assistant, business identity, your number, minutes, calling hours right now and the calling service |
| Booking | Your calendar (Google Calendar or Calendly) or booking link, and whether **Book meetings** is allowed in **What the AI may do** |
| Lead sources | Meta, Google Ads, LinkedIn and TikTok connections, their last activity, errors and access expiry, plus webhooks and API keys |
| Find Leads | Whether it is on your plan, your search allowances, and whether search sources are available |
| Agents | Each running agent, its last run and any error, and items waiting for your approval |
| Quotes and payments | The Pay now link on invoices, your payment webhook and payments waiting for review |
| Plan and limits | Your subscription and any limit reached |
| Background processing | Whether ClientTurn's background worker is running, and any of your tasks overdue, stuck or failed |

## What the statuses mean

- **Ready**: working.
- **Needs attention**: something is stopping it. The reason says what, and the link under it opens the exact setting that fixes it.
- **Off by choice**: switched off in your settings or not on your plan. That isn't a fault; the link shows where to turn it on.
- **Couldn't check**: the check itself couldn't run. Nothing has been changed; try again in a minute.

Anything that needs attention is listed first.

> **Note:** Anyone in the workspace can see System check. Most fixes need an owner or admin.

## One lead at a time

For a single lead, open the lead and read **Why hasn't anything happened?** in the right-hand column. It explains what is holding that lead up (an opt-out, a person taking over, quiet hours, no channel you may lawfully use, or simply waiting for their reply) and when the next step is scheduled.

## Still stuck?

If System check says everything is ready and something still isn't working, contact support from **Help**. Support can see the same check for your workspace, so you don't need to describe every setting.
