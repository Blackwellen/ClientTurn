---
title: Connecting HubSpot
summary: Push qualified leads and bookings into your HubSpot CRM as contacts and deals, and optionally import HubSpot contacts back
category: integrations
keywords: [hubspot, crm, service key, private app, token, contacts, deals, sync, hubspot crm]
order: 30
updated: 2026-09-26
---

HubSpot connects with a token you create in your own HubSpot account. There is no HubSpot sign-in redirect.

## Create a HubSpot Service Key

1. In ClientTurn, open **Settings → Connections**, find **HubSpot** under **CRM** and choose **Connect**.
2. In another tab, open your HubSpot account and go to **Settings → Integrations → Service Keys**. (HubSpot used to call these Private Apps; the menu was renamed but the token works the same way.)
3. Create a key with these scopes:
   - `crm.objects.contacts.read` and `crm.objects.contacts.write`
   - `crm.objects.deals.read` and `crm.objects.deals.write`
   - optionally `crm.objects.owners.read`, which lets imported contacts be assigned to the right person in ClientTurn
4. Copy the token HubSpot shows you once, paste it into **HubSpot access token** in ClientTurn, and choose **Connect**.

The token is checked against HubSpot straight away, including a test that the contact scopes are granted, so a typo or a missing scope is caught now rather than on the first real lead. It is stored encrypted and never shown again.

## What gets pushed

A lead that reaches Qualified, Booked or Won is pushed to HubSpot as a **contact** (name, email, phone and postcode), with a **deal** created and associated with it. The deal stage follows the lead's deal in ClientTurn, including closed won and closed lost. Pushing the same lead again updates the same contact and deal rather than creating duplicates.

When a conversation is handed to a person, the lead brief is added to the contact as a note.

> **Note:** At the time of writing the company name is not sent to HubSpot with the contact.

## Import HubSpot contacts (optional)

Once connected, you can switch on **Import contacts from HubSpot** in **Settings → Connections**. New and changed HubSpot contacts are added to Leads as imported records, with no follow-up started. See [Pulling leads from your CRM](/help/finding-leads/pulling-leads-from-your-crm).

## Replacing the token

Stored tokens are never shown again. To replace one, open the card's **Manage** panel, choose **Disconnect HubSpot**, then connect again with the new token. If HubSpot revokes the token, the card shows **Reconnect required**.

## Related

- [Integrating with your CRM](/help/integrations/integrating-with-your-crm)
- [Troubleshooting integrations](/help/integrations/troubleshooting-integrations)
