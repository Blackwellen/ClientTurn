---
title: SMS and WhatsApp (Twilio)
summary: How ClientTurn sends and receives SMS and WhatsApp through its own Twilio account, what you configure, and how opt-outs are handled
category: integrations
keywords: [sms, text message, whatsapp, twilio, whatsapp direct, whatsapp business account, sender, stop, stopall, start, opt out, quiet hours, default channel, fallback channel]
order: 80
updated: 2026-09-27
---

You do not need a Twilio account. ClientTurn runs SMS and WhatsApp through its own Twilio account on every workspace's behalf, so the **Twilio SMS** and **WhatsApp** cards in **Settings → Connections** say **Run by ClientTurn on your behalf. There is nothing to connect.** A green **Healthy** badge means the platform side is working.

## Availability

- **SMS** is available to every workspace.
- **WhatsApp** is a paid add-on on Growth and above, paid per message in prepaid [WhatsApp tokens](/help/billing/top-up-credits#whatsapp-token-packs): 2 for a conversation reply or utility template, 5 for a marketing template. There are no included messages, no monthly WhatsApp platform fee and no overage. If the card shows **Not on your plan**, see [Plans and pricing](/help/billing/plans-and-pricing).
- **WhatsApp (direct)** connects your own WhatsApp Business number through Meta instead, with no reseller in between. It needs Growth or above, where WhatsApp is available as a paid add-on. Choose **Connect** on its card and complete Meta's sign-up dialog, which sets up your WhatsApp Business Account and number. If the card says **Not yet available**, this platform does not yet hold the Meta configuration the dialog needs.

Once direct WhatsApp is connected, WhatsApp follow-up goes out through it. If you disconnect it, the shared WhatsApp sender takes over if it is available; otherwise WhatsApp conversations fall back to SMS where a mobile number is on file.

## What you configure

Open **Settings → Workspace**:

- **Channels** — the **Default channel** used to reach a new lead, and the **Fallback channel** used when the default cannot deliver.
- **Sender identity** — a **Message signature** of up to 160 characters, added to outbound messages so a lead knows who is writing. Keep it short: it counts towards every SMS.
- **Quiet hours** — **Quiet from** and **Quiet until**, in your workspace's timezone. Nothing is sent during these hours; messages wait until they end.
- **Opt-out wording** — the line that tells a lead how to stop messages. Every first outbound message carries it. It is a legal requirement, so it is fixed and cannot be edited or switched off.

## Replies and opt-outs

Replies arrive in **Inbox** and on the lead's **Conversation** tab, and drive qualification.

- STOP by SMS or WhatsApp stops that channel for that person, until they text START on it. START lifts only their own opt-out on that channel.
- STOPALL, or a plain-English request such as "please don't text me again", stops every channel. See [Suppression, STOP and unsubscribe](/help/compliance/suppression-and-unsubscribe).
- If Twilio reports that a number has opted out or is invalid, it is added to your suppression list automatically.

Every message is re-checked against suppression, stop conditions and quiet hours immediately before it is sent.

## WhatsApp rules

- WhatsApp allows free-form replies only within 24 hours of the person's last message. Outside that window, only a pre-approved template can be sent. See [WhatsApp templates](/help/integrations/whatsapp-templates).
- A mobile number on a lead form is not permission to use WhatsApp unless the form asked for it explicitly. See [Consent and WhatsApp opt-in](/help/compliance/consent-and-whatsapp-opt-in).

## Related

- [Usage and limits](/help/billing/usage-and-limits)
- [Suppression and unsubscribe](/help/compliance/suppression-and-unsubscribe)
