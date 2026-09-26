---
title: SMS and WhatsApp (Twilio)
summary: How ClientTurn sends and receives SMS and WhatsApp through its own Twilio account, what you configure, and how opt-outs are handled
category: integrations
keywords: [sms, text message, whatsapp, twilio, sender, stop, opt out, quiet hours, default channel, fallback channel]
order: 80
updated: 2026-09-26
---

You do not need a Twilio account. ClientTurn runs SMS and WhatsApp through its own Twilio account on every workspace's behalf, so the **Twilio SMS** and **WhatsApp** cards in **Settings → Connections** say **Run by Client Turn on your behalf. There is nothing to connect.** A green **Healthy** badge means the platform side is working.

## Availability

- **SMS** is available to every workspace.
- **WhatsApp** is not on every plan. If the card shows **Not on your plan**, see [Plans and pricing](/help/billing/plans-and-pricing).
- **WhatsApp (direct)**, which will connect your own WhatsApp Business number through Meta, shows **Not yet available** until it is enabled on this platform.

## What you configure

Open **Settings → Workspace**:

- **Channels** — the **Default channel** used to reach a new lead, and the **Fallback channel** used when the default cannot deliver.
- **Sender identity** — a **Message signature** of up to 160 characters, added to outbound messages so a lead knows who is writing. Keep it short: it counts towards every SMS.
- **Quiet hours** — **Quiet from** and **Quiet until**, in your workspace's timezone. Nothing is sent during these hours; messages wait until they end.
- **Opt-out wording** — the line that tells a lead how to stop messages. It should tell them to reply STOP.

## Replies and opt-outs

Replies arrive in **Inbox** and on the lead's **Conversation** tab, and drive qualification.

- A carrier opt-out keyword such as STOP stops that channel for that person.
- A plain-English request such as "please don't text me again" stops every channel.
- If Twilio reports that a number has opted out or is invalid, it is added to your suppression list automatically.

Every message is re-checked against suppression, stop conditions and quiet hours immediately before it is sent.

## WhatsApp rules

- WhatsApp allows free-form replies only within 24 hours of the person's last message. Outside that window, only a pre-approved template can be sent. See [WhatsApp templates](/help/integrations/whatsapp-templates).
- A mobile number on a lead form is not permission to use WhatsApp unless the form asked for it explicitly. See [Consent and WhatsApp opt-in](/help/compliance/consent-and-whatsapp-opt-in).

## Related

- [Usage and limits](/help/billing/usage-and-limits)
- [Suppression and unsubscribe](/help/compliance/suppression-and-unsubscribe)
