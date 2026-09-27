---
title: Sending leads in from your own software (API)
summary: Record enquiries from your website, app or back office with POST /api/v1/leads, with deduplication and a clear outcome for every request
category: finding-leads
keywords: [api, post leads, web form, website form, integration, idempotency, developer, rest api, create lead]
order: 90
updated: 2026-09-27
screenshots:
  - src: /help/screenshots/finding-leads/leads-from-the-api-1.png
    alt: "A lead's Attribution tab showing an API touch with its campaign, form and UTM values"
    caption: "API leads keep the campaign, form and UTM details you send"
---

If your website, app or back-office system captures enquiries, it can send them straight to ClientTurn with the public API. Each request goes through the same intake path as an ad-platform lead: suppression check, deduplication against existing leads, and a record of where it came from.

This article is the overview. The full request and response reference is in [Creating leads with the API](/help/developers/api-create-leads).

## What you need

1. An API key with the `leads:write` permission, created by an owner or admin in **Settings → Developer**. See [API overview and authentication](/help/developers/api-overview-and-authentication).
2. The key must belong to someone with a member role or above. A key acts with its owner's current access.

## What to send

- At least an email address or a phone number.
- A `relationship` saying how the person came to you, for example `THEY_CONTACTED_US` for a website enquiry. Only warm relationships are accepted; a contact you merely found belongs in Find Leads as a prospect.
- An `Idempotency-Key` header that is unique per enquiry, so a retried request never creates a second lead.
- Optionally, where it came from (form name, UTM parameters, Google click ID), the answers to your form's questions, and the consent the person gave.

## What happens next

The response tells you exactly what happened: a new lead was **created**, an existing lead was **merged** (the same person enquired again), the request was a **duplicate** of one already received, the details were **invalid**, it needs a person to **review** a conflicting match, or it was **rejected** because the person is on your suppression list (`409`, and nothing is stored). A `REFERRAL` must carry evidence of who referred them and when, at least 20 characters, or the request is refused with `400`. See [Creating leads with the API](/help/developers/api-create-leads).

> **Important:** A lead created through the API is recorded and qualified, but follow-up is **not** started automatically. Someone in your team chooses to message it, or selects it in **Leads** and chooses **Actions → Start follow-up**. This is deliberate: the API has nobody present to confirm an outbound action.

## Related

- [Creating leads with the API](/help/developers/api-create-leads)
- [Leads from Zapier and webhooks](/help/finding-leads/leads-from-zapier-and-webhooks)
- [Leads from MCP](/help/finding-leads/leads-from-mcp)
