---
title: Reading and updating leads with the API
summary: Reference for GET /api/v1/me, GET and PATCH /api/v1/leads, and GET /api/v1/events, with parameters and response shapes
category: developers
keywords: [get leads, list leads, search leads, patch lead, update lead, lead status, add note, events endpoint, delivery log, api reference]
order: 15
updated: 2026-09-26
---

All endpoints need an API key sent as `Authorization: Bearer …`. See [API overview and authentication](/help/developers/api-overview-and-authentication).

## GET /api/v1/me

Scope `business:read`. Returns the workspace, the key and the live role it acts with:

```json
{
  "workspace": { "id": "…", "name": "…", "timezone": "Europe/London", "industry": "…", "status": "…" },
  "key": { "name": "…", "environment": "live", "scopes": ["business:read", "leads:read"] },
  "acting_as": { "role": "admin" }
}
```

## GET /api/v1/leads

Scope `leads:read`. Searches your leads. Archived leads are not included.

| Parameter | Meaning |
|---|---|
| `query` | Match on name, email or phone |
| `status` | One status, for example `QUALIFIED` |
| `needs_attention` | `true` or `false` |
| `limit` | 1 to 50; 25 if omitted |

```json
{ "data": [ { "id": "…", "first_name": "…" } ], "count": 1 }
```

## GET /api/v1/leads/{id}

Scope `leads:read`. Returns one lead as `data`, with its recent activity beside it as `recent_activity`: the last 20 messages on any channel, newest first.

```json
{
  "data": { "id": "…", "first_name": "Jo", "status": "QUALIFIED", … },
  "recent_activity": [
    { "type": "message", "id": "…", "direction": "inbound", "channel": "email", "status": "…", "body": "…", "at": "2026-09-25T10:12:00Z" }
  ]
}
```

A message body longer than 500 characters is shortened. An ID that is not a valid UUID returns `400`; a valid ID with no matching lead in your workspace returns `404`.

## PATCH /api/v1/leads/{id}

Scope `leads:write`, member role or above. Send only what you want to change:

| Field | Notes |
|---|---|
| `first_name`, `last_name`, `email`, `phone`, `postcode` | Send `null` to clear a field |
| `status` | `NEW`, `CONTACTED`, `RESPONDED`, `QUALIFIED`, `BOOKED`, `WON` or `LOST`. Status rules apply, exactly as in the app |
| `note` | Adds a note to the lead (up to 2,000 characters) |

Any other field is refused. Changes are applied in the order details, then status, then note. The response is the lead as it is now stored, plus the steps that were applied:

```json
{ "data": { … }, "applied": ["lead.update", "lead.set_status"], "warnings": [ { "code": "…", "message": "…" } ] }
```

`warnings` passes on what the change means, for example that follow-up has stopped because the lead was marked won. Show these to your user.

A multi-part change is not all-or-nothing. If a later step is refused, the error says which step failed and which had already been applied:

```json
{ "error": { "code": "conflict", "message": "…", "failed_step": "lead.set_status", "applied": ["lead.update"] } }
```

## GET /api/v1/events

Scope `business:read`. Lists recent webhook deliveries for your workspace, newest first, so you can see what was sent to your endpoints, what your server answered, and whether it will be retried.

| Parameter | Meaning |
|---|---|
| `type` | One event type, for example `lead.created` |
| `status` | `PENDING`, `SUCCEEDED`, `FAILED`, `EXHAUSTED` or `CANCELLED` |
| `limit` | 1 to 100; 25 if omitted |

Each item has `id`, `event_id`, `type`, `status`, `attempts`, `response_status`, `next_attempt_at`, `delivered_at`, `created_at` and the `payload` that was sent. The endpoint URL and signing secret are never included.

> **Note:** Deliveries are only created for events that at least one of your webhook endpoints subscribes to. With no endpoint set up, this list is empty.

## Related

- [Creating leads with the API](/help/developers/api-create-leads)
- [Webhooks](/help/developers/webhooks)
