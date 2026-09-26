---
title: Creating leads with the API
summary: The full reference for POST /api/v1/leads, including the Idempotency-Key header, the request body and every outcome it can return
category: developers
keywords: [post leads, create lead, idempotency-key, outcome, created, merged, duplicate, suppressed, invalid, review, rejected, 201, 422, relationship]
order: 10
updated: 2026-09-26
---

`POST /api/v1/leads` records an inbound lead. It runs the same intake path as every other source in ClientTurn: deduplication against existing leads, a suppression check, a record of permission, and attribution for the enquiry.

## Requirements

- An API key with the `leads:write` scope, belonging to someone with a member role or above.
- An `Idempotency-Key` header: 8 to 200 printable characters, no spaces, unique per enquiry.
- A JSON body.

## Example

```
POST /api/v1/leads
Authorization: Bearer ct_live_…
Idempotency-Key: webflow-contact-sub_881
Content-Type: application/json
```

```json
{
  "first_name": "Jo",
  "last_name": "Bloggs",
  "email": "jo@acme.co.uk",
  "phone": "07700 900123",
  "company_name": "Acme Studio Ltd",
  "relationship": "THEY_CONTACTED_US",
  "source": {
    "type": "WEB_FORM",
    "provider": "webflow",
    "record_id": "sub_881",
    "form_name": "Contact us",
    "utm_source": "google",
    "submitted_at": "2026-09-25T10:04:00Z"
  },
  "answers": { "Budget": "£5k–£10k" },
  "consent": { "marketing": true, "whatsapp": false, "evidence": "Ticked box v3 on /contact" }
}
```

## Body fields

| Field | Required | Notes |
|---|---|---|
| `relationship` | Yes | One of `THEY_CONTACTED_US`, `EXISTING_CUSTOMER`, `REFERRAL`, `REQUESTED_INFORMATION`, `EXPLICIT_MARKETING_CONSENT`, `EXISTING_BUSINESS_RELATIONSHIP`. A contact you merely found is a prospect, not a lead, and is not accepted here |
| `email`, `phone` | At least one | UK numbers may be written in national format; they are normalised |
| `first_name`, `last_name`, `company_name`, `role_title`, `postcode` | No | |
| `source` | No | `type` is `WEB_FORM`, `API` (default), `CRM` or `CONNECTOR`. `provider` is a lower-case name for the sending system (default `api`). Optional: `record_id`, `form_id`, `form_name`, `campaign_id`, `campaign_name`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `fbclid`, `referrer`, `landing_url`, `submitted_at` |
| `answers` | No | Question-and-answer pairs from your form |
| `consent` | No | `marketing` and `whatsapp` (true or false) and free-text `evidence`. WhatsApp is only treated as allowed when `whatsapp` is true |
| `service_id` | No | The ID of one of your services |

Send `submitted_at` whenever you have it: speed-to-lead is measured from the time the person submitted, not from when ClientTurn received the request.

## The response

Every successful call returns the outcome, never a bare "success":

```json
{
  "data": {
    "outcome": "CREATED",
    "lead_id": "…",
    "touch_id": "…",
    "matched_by": null,
    "reasons": []
  }
}
```

| `outcome` | HTTP | Meaning |
|---|---|---|
| `CREATED` | 201 | A new lead was created |
| `MERGED` | 200 | The same person already existed (same email, or same phone with no conflicting email). Blank fields were filled, nothing was overwritten, and this enquiry was recorded as a new touch. `matched_by` says which rule matched |
| `DUPLICATE` | 200 | This `Idempotency-Key`, or this `source.record_id`, was already received. Nothing new was created. A repeated key also returns `original_outcome` |
| `SUPPRESSED` | 200 | Recorded, but every address given is on your suppression list, so the person will not be contacted |
| `REVIEW` | 200 | Recorded, but the phone number belongs to another lead with a different email. The two are not merged; a person decides |
| `INVALID` | 422 | No usable email or phone. Nothing was stored |
| `REJECTED` | 409 | Nothing was stored |

If you reuse an `Idempotency-Key` with a different body, the first outcome is still returned and `reasons` includes `idempotency_key_reused_with_different_body`.

## Follow-up is never started by the API

A lead created over the API is recorded, qualified and counted against your plan, but automated follow-up is not started. A person chooses to message it, or selects it in **Leads** and chooses **Actions → Start follow-up**. The API has nobody present to confirm an outbound action, so it never takes one.

## Errors

A missing or malformed `Idempotency-Key` or body returns `400 invalid_request`. For the other error codes, see [API overview and authentication](/help/developers/api-overview-and-authentication).

## Related

- [Reading and updating leads](/help/developers/api-reading-and-updating-leads)
- [Webhooks](/help/developers/webhooks), which can tell your system when the lead qualifies or books
