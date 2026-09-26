---
title: Connecting Pipedrive
summary: Send contacts from Pipedrive into ClientTurn for review using Pipedrive Automations and a signed inbound endpoint
category: integrations
keywords: [pipedrive, pipedrive automations, webhook, crm, raw json, inbound endpoint, persons]
order: 45
updated: 2026-09-26
---

Pipedrive connects in one direction: Pipedrive sends contacts to ClientTurn. ClientTurn never signs in to Pipedrive and cannot read or change anything there. Contacts arrive in **Find Leads** as prospects for review.

## 1. Create the endpoint

1. Open **Settings → Connections**, scroll to **Inbound contact connections** and choose **Set up** on **Pipedrive**.
2. Choose how Pipedrive will authenticate. **Basic authentication** is the method Pipedrive's webhook credential field supports end to end. For **Bearer token** or **API key header**, put the value in that same field.
3. Optionally name the connection, for example "Pipedrive — UK pipeline", and choose **Create endpoint**.
4. Copy **Your endpoint URL**.

## 2. Build the automation in Pipedrive

Pipedrive's standard webhook nests every field and sends email and phone as lists, which the endpoint rejects outright. Use Pipedrive's **Automations** builder instead (Advanced plan or above), with a webhook action and a raw JSON body that maps each field to the flat shape ClientTurn expects:

```json
{
  "eventId": "pipedrive-person-12345",
  "firstName": "Priya",
  "lastName": "Shah",
  "email": "priya@example.co.uk",
  "phone": "+447700900123",
  "company": "Example Studio Ltd"
}
```

- Use a value that is unique per event for `eventId`, such as the person ID plus a timestamp. A repeated `eventId` is not imported twice.
- Include an email or a phone number. Phone numbers must be in international format, starting with `+`.

## 3. Check it arrived

Trigger the automation once. The Pipedrive card changes from **Configured** to **Healthy** when a request is accepted, or to **Warning** or **Failed** if requests are being rejected. The panel shows **Last accepted** and **Last rejected** times.

For the full payload and signing reference, see [Leads from Zapier and webhooks](/help/finding-leads/leads-from-zapier-and-webhooks).

## Related

- [Integrating with your CRM](/help/integrations/integrating-with-your-crm)
- [Other CRMs and automation tools](/help/integrations/connecting-pipedrive-and-other-crms)
