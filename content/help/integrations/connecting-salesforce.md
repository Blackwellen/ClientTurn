---
title: Connecting Salesforce
summary: Push qualified leads and bookings into Salesforce as leads and opportunities, and optionally import new Salesforce leads
category: integrations
keywords: [salesforce, sfdc, crm, opportunity, lead object, connected app, sandbox, stage, salesforce crm]
order: 35
updated: 2026-09-26
screenshots:
  - src: /help/screenshots/integrations/connecting-salesforce-1.png
    alt: "The Salesforce card marked Connected with the org name and last successful sync"
    caption: "A connected Salesforce org"
---

## Connect

1. Open **Settings → Connections**, find **Salesforce** under **CRM** and choose **Connect**, then **Connect** again in the panel.
2. Sign in to Salesforce and approve access. ClientTurn asks only for API access and a refresh token, so the connection keeps working without you signing in again.
3. Back in Connections, the card shows your org.

> **Important:** Sandbox orgs are not supported yet. The connection signs in through the production login, which works for production and Developer Edition orgs.

## What gets pushed

A lead that reaches Qualified, Booked or Won is pushed to Salesforce as a **Lead** with first name, last name, email, phone and postcode, and **Lead Source** set to "Client Turn". Pushing again updates the same Salesforce Lead.

ClientTurn also writes an **Opportunity** that follows the lead's deal. Salesforce needs a stage name from your org's own stage list, so ClientTurn reads your active opportunity stages and picks from them: your first won stage for Won, your first closed-lost stage for Lost, and a matching open stage otherwise. If none matches, only the opportunity is skipped; the Lead is still kept.

When a conversation is handed to a person, the lead brief is added to the record as a note.

> **Note:** Salesforce requires a company on every Lead. At the time of writing ClientTurn fills it with the placeholder "Client Turn lead" rather than the lead's company name, so you may want to update it in Salesforce.

## Import Salesforce leads (optional)

You can switch on **Import contacts from Salesforce** in **Settings → Connections**. New and changed Salesforce Leads are added as imported leads, with no follow-up started, and assigned to the workspace member whose email matches the Salesforce owner. See [Pulling leads from your CRM](/help/finding-leads/pulling-leads-from-your-crm).

## If it stops working

Salesforce sessions end according to your org's session policy. ClientTurn refreshes the session automatically; if Salesforce refuses, the card shows **Reconnect required**. Choose **Reconnect**.

## Related

- [Integrating with your CRM](/help/integrations/integrating-with-your-crm)
- [Troubleshooting integrations](/help/integrations/troubleshooting-integrations)
