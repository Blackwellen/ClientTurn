---
title: Integrating with your CRM
summary: How ClientTurn pushes qualified and booked leads into HubSpot, Salesforce or Zoho CRM, and optionally imports new CRM records back
category: integrations
keywords: [crm, crm sync, two-way, push, pull, pipedrive, salesforce, zoho, deals, opportunities, crm integration]
order: 25
updated: 2026-09-26
---

ClientTurn works alongside your CRM rather than replacing it. There are two directions, and you choose each separately.

| Direction | What happens | Default |
|---|---|---|
| **Push** (ClientTurn → CRM) | A lead that reaches Qualified, Booked or Won is written to your CRM, and updated there as it moves on | On as soon as the CRM is connected |
| **Pull** (CRM → ClientTurn) | New and changed CRM records are added to Leads, without anyone being messaged | Off until you switch it on |

## Which CRMs

| CRM | Connect by | Push creates | Pull reads | Article |
|---|---|---|---|---|
| HubSpot | A HubSpot Service Key you paste in | Contact, with a linked deal | Contacts | [Connecting HubSpot](/help/integrations/connecting-hubspot) |
| Salesforce | Signing in to Salesforce | Lead, plus an opportunity | Leads | [Connecting Salesforce](/help/integrations/connecting-salesforce) |
| Zoho CRM | Signing in to Zoho | Lead | Leads | [Connecting Zoho CRM](/help/integrations/connecting-zoho-crm) |
| Pipedrive | A signed inbound endpoint | Nothing: Pipedrive sends contacts to ClientTurn only | Contacts you post from Pipedrive, as prospects | [Connecting Pipedrive](/help/integrations/connecting-pipedrive) |

All of them are under **Settings → Connections**. Only owners and admins can connect or disconnect a CRM.

## How push works

- Each qualifying change queues a push to every connected CRM. Nothing happens inside the step that changed the lead, so a slow CRM never slows follow-up down.
- Pushing the same lead again updates the same CRM record rather than creating a duplicate.
- When the conversation is handed to a person, the lead brief is also added to the CRM record as a note, where the CRM supports it.
- If a push fails, it is retried. A connection whose credentials stop working shows **Reconnect required** on its card.

> **Note:** Disconnecting a CRM stops pushing to it. Nothing already in ClientTurn or in your CRM is deleted.

## How pull works

Pull is opt-in per CRM. When it is on, ClientTurn checks about every 15 minutes for records added or changed since you switched it on, adds them as leads marked **Imported from another system**, and does not start follow-up. Records ClientTurn itself pushed are never imported back. See [Pulling leads from your CRM](/help/finding-leads/pulling-leads-from-your-crm).

## Erasure

When you erase or anonymise a lead in ClientTurn, the linked CRM record is handled too: HubSpot uses its GDPR delete, and Salesforce and Zoho move the record to their recycle bin. See [Data rights](/help/compliance/data-rights).

## Related

- [Troubleshooting integrations](/help/integrations/troubleshooting-integrations)
- [Webhooks](/help/developers/webhooks), if you want to push events to a system that is not listed here
