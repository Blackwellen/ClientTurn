---
title: Connections settings
summary: Connect lead sources, messaging, calendars and CRMs, read each connection's status, check your sending mailbox and domain, and map WhatsApp templates
category: settings
keywords: [integrations, connect, reconnect, disconnect, test connection, connection health, lead sources, meta lead ads, google ads, calendly, google calendar, twilio, slack, crm import, whatsapp templates, sending domain]
order: 20
updated: 2026-09-26
---

**Settings → Connections** is where ClientTurn links to the other services you use. Owners and admins can connect and change things here. Everyone else can see the status of each connection.

## What is on the page

From top to bottom:

1. **Your sending mailbox:** the mailbox your outreach email is sent from. See [Setting up email outreach](/help/integrations/setting-up-email-outreach).
2. **Sending domain health:** whether each sending domain passes SPF, DKIM and DMARC, with bounce and complaint figures. It is checked daily against DNS.
3. **Connection health:** how many providers are connected, and when they were last checked.
4. **Connection cards**, grouped as **Ads / lead sources**, **Messaging**, **Booking**, **CRM** and **Email**.
5. **Inbound contact connections**, for tools that send contacts into ClientTurn.
6. **CRM import** and **WhatsApp templates**.

## Connection cards

Each card shows a status:

| Status | Meaning |
|---|---|
| Connected or Healthy | Working |
| Needs attention | Working, but something needs checking |
| Reconnect required | The connection has stopped. Reconnect it |
| Testing | A test is running |
| Not connected | Not set up yet |
| Not on your plan | Needs a higher plan, for example WhatsApp needs Growth |

A card's buttons depend on its status: **Connect**, **Reconnect**, **Test connection** and **Manage**. Some providers, such as the email service ClientTurn itself uses, are run for you and have nothing to connect.

Available connections include Meta Lead Ads, Google Ads, TikTok Lead Generation, LinkedIn Lead Gen Forms, Twilio SMS, WhatsApp, Slack, Google Calendar, Calendly, HubSpot, Zoho CRM and Salesforce.

> **Warning:** Disconnecting stops that connection straight away. The card tells you what stops before you confirm: for example, disconnecting Google Calendar means qualified leads are no longer offered slots.

## CRM import

**Import contacts from your CRM** brings new and updated contacts in as leads marked as imported. Nobody is messaged just because they are in your CRM, and leads ClientTurn sent to your CRM are never imported back. Only owners and admins can change it.

## WhatsApp templates

WhatsApp only allows free-form messages within 24 hours of the person's last message. After that, only an approved template can be sent. Templates are synced once a day, or when you sync them yourself. Under **Follow-up steps on WhatsApp**, choose a **Template when the 24-hour window has closed** for each step. A step with **No template** is held for a person. See [WhatsApp templates for reactivation](/help/reactivation/whatsapp-templates-for-reactivation).

## Related

- [Troubleshooting integrations](/help/integrations/troubleshooting-integrations)
- [Booking with Google Calendar](/help/booking-and-sales/booking-with-google-calendar)
- [Developer settings](/help/settings/developer-settings)
