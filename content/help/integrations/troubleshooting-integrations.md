---
title: Troubleshooting integrations
summary: What each connection status means, how to test and reconnect, and what to check when data stops flowing
category: integrations
keywords: [troubleshooting, connection, action required, reconnect required, needs attention, test connection, sync, status page, integration health]
order: 90
updated: 2026-09-26
---

## Connection health

The **Connection health** summary at the top of **Settings → Connections** shows how many providers are connected, how many need attention, and when they were last checked. Each card shows its own status, its **Last successful sync**, and, when something is wrong, the provider's last error.

## What each status means

| Status | Meaning | What to do |
|---|---|---|
| **Connected** | Working | Nothing |
| **Healthy** | Run by ClientTurn on your behalf (SMS, WhatsApp, system email) and working | Nothing to connect |
| **Needs attention** | Working, but recent checks had problems | Read the error on the card, then **Test connection** |
| **Reconnect required** | The provider refused ClientTurn's access | Choose **Reconnect** and sign in again |
| **Not connected** | Available, not set up | Choose **Connect** |
| **Not on your plan** | Your plan does not include it | **Compare plans** |
| **Not yet available** | This deployment does not yet hold the credentials the connection needs | Contact support if you need it |

Your mailbox card uses its own wording: **Having trouble** or **Action required** when the mail server is refusing ClientTurn.

## Test a connection

Choose **Test connection** on the card, or in its **Manage** panel. It checks the credentials only; nothing is sent to anyone.

## Common causes of "Reconnect required"

- The access was revoked in the provider's own settings, or the person who connected it lost their role there.
- The provider's token expired and could not be refreshed. Salesforce sessions, for example, follow your org's session policy.
- For a token you pasted (HubSpot), the token was deleted or its scopes changed. Disconnect and connect again with a new token.

## Inbound contact connections

Webhook-based connections (Zapier, Pipedrive, Custom webhook) show **Configured**, **Healthy**, **Warning** or **Failed**, based on what has actually arrived. **Failed** almost always means the sender's authentication does not match what you chose, or the body is missing `eventId` or a valid email or `+`-prefixed phone. See [Leads from Zapier and webhooks](/help/finding-leads/leads-from-zapier-and-webhooks).

## Who can fix it

Everyone can see connection status. Only owners and admins can connect, test, reconnect or disconnect.

## Wider outages

If a provider is having a wider incident, it shows under **System Status** in the support panel (the round help button at the bottom right of every page).

## Related

- [Integrating with your CRM](/help/integrations/integrating-with-your-crm)
- [Setting up email outreach](/help/integrations/setting-up-email-outreach)
