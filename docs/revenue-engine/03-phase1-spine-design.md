# Phase 1 — The spine: one intake path, identity, attribution, events

**Implements:** brief §§9–14, 23, 28–31, 66, 82, and duplicates D1–D4 and D10 in [00 §3](00-discovery-and-implementation-map.md).
**Depends on:** Phase 0 committed, and migrations 0110–0116 applied.

## 1. `ingestLead()` — every inbound source converges here

Module `src/lib/ingest/`:

- `types.ts` — pure. Zod schemas, `IngestInput` and `IngestOutcome`.
- `normalise.ts` — pure. Email is lowercased and trimmed, and fails when it doesn't match. Phone is normalised to E.164 with GB as the default region. Names are trimmed. UTM parameters are lowercased.
- `service.ts` — server-only. The pipeline below.

### Input

```ts
IngestInput = {
  businessId; idempotencyKey?: string;            // API header, provider id, or derived
  source: {
    type: "AD_FORM" | "WEB_FORM" | "CSV" | "MANUAL" | "API" | "MCP" | "CONNECTOR" | "SOCIAL_DM" | "CRM";
    provider: string;                              // meta | google_ads | linkedin_ads | tiktok_ads | zapier | ...
    providerRecordId?: string;                     // lead_id / leadgen_id / row id
    pageId?, formId?, campaignId?, adsetId?, adId? (+ names);
    utm?: { source, medium, campaign, term, content }; gclid?; fbclid?; referrer?; landingUrl?;
    submittedAt?: string;                          // provider's own timestamp; speed-to-lead starts here
    caller: { type: "SYSTEM" | "USER" | "API_KEY" | "MCP_CLIENT" | "CONNECTOR"; id?: string };
  };
  person: { firstName?, lastName?, email?, phone?, companyName?, roleTitle?, postcode? };
  answers?: Record<string, string>;                // form custom questions
  consent?: { marketing?: boolean; whatsapp?: boolean; evidence?: string };
  relationship?: RelationshipType;                 // default THEY_CONTACTED_US for inbound forms
  serviceId?: string;
}
```

### Outcome (a deterministic contract, brief §30)

`CREATED | MERGED | DUPLICATE | SUPPRESSED | INVALID | REVIEW | REJECTED`. The result also carries `leadId`, `matchedBy`, `reasons[]` and `touchId`.

### Pipeline, in order

1. **Validate** (zod) → `INVALID`. Reject when there is no email and no phone, unless the source is a social DM with a thread id.
2. **Normalise.**
3. **Idempotency.** The `ingest_requests` table is unique on (business_id, idempotency_key). A repeated key returns the first outcome unchanged → `DUPLICATE`.
4. **Suppression** on every destination supplied. A suppressed person is still recorded: the business must see the enquiry, and it must not be lost. The lead is created with `opted_out`. Outcome `SUPPRESSED` means "recorded, will not be contacted". A deletion-style suppression, such as an erased contact's hash, gives `REJECTED` and stores nothing.
5. **Identity resolution** (§2 below) → an existing lead, a new lead, or `REVIEW`.
6. **Write.**
   - For a new lead: insert with `intake_method` and `created_via` set.
   - For a match: fill blank fields only. Never overwrite provenance.
   - Always: insert one **`lead_touches`** row (§3), and upsert `contact_permissions` with relationship, consent and `consent_scope`. `consent_scope` includes `WHATSAPP` only when the form captured an explicit WhatsApp opt-in.
7. **Queue** `lead.process`, whose idempotency key is the touch id.
8. **Emit** `lead.created` or `lead.touched` (§4).
9. **Return** the outcome.

### Callers converted in Phase 1

- The Meta, Google Ads, LinkedIn and TikTok pollers: their four copy-pasted insert blocks are deleted.
- A new Google Ads **webhook** route: verify `google_key` in constant time, return 200 with an empty body, and a 5xx only on transient failure.
- Add Lead wizard; v4 CSV import (the reactivation importer is merged into it, D2); MCP `create_lead`; Meta DM inbound.
- A new `POST /api/v1/leads` with an `Idempotency-Key` header and the `leads:write` scope.

Prospect intake (sourcing, connectors, social engagement) gets the mirror `ingestProspect()` in Phase 2.

## 2. Identity resolution (§11)

Pure module `src/lib/identity/resolve.ts`. Matches are tested in this order:

| Rule | Evidence | Action |
|---|---|---|
| Same `(provider, providerRecordId)` | Exact | `DUPLICATE` (the same submission) |
| Same normalised email | Strong | Merge into the existing lead |
| Same E.164 phone, and email absent on one side | Strong | Merge |
| Same phone but a *different* email | Conflicting | `REVIEW`, never merged |
| Same name + company or domain, no shared contact field | Weak | New lead, plus a `merge_candidates` row for a person to decide |

- **Never silent.** Every merge writes `merge_events` (lead id, touch id, rule, confidence, a before-snapshot of changed fields) so it can be reversed.
- **Scope.** Matching runs across `leads` and `prospects`. A prospect match links the promotion instead of creating a duplicate.
- **Race safety.** Add unique partial indexes on `leads (business_id, email_normalized)` and `(business_id, phone_normalized)` where not archived. An insert that hits one is retried as a merge. Before creating the index, a migration reports existing duplicates and parks them as `merge_candidates` instead of failing.

## 3. Attribution: `lead_touches` (§§10, 23, 66)

Columns:

- `business_id`, `lead_id`, `occurred_at`, `received_at`
- `source_type`, `provider`, `provider_record_id`
- page, form, campaign, ad set and ad — ids and names
- `utm_*`, `gclid`, `fbclid`, `referrer`, `landing_url`
- `caller_type`, `caller_id`, `answers` (minimised)

It is unique on (business_id, provider, provider_record_id). `lead_sources` remains the *form* registry, and B11 is fixed at the root.

- **First touch** is the earliest touch, and **last meaningful touch** the latest.
- Attribution models (first, last, linear) are SQL views, never stored.
- **Speed to lead** is measured from `touches.occurred_at`, the provider's submission time, not from our insert.

## 4. Event outbox (§82, D10)

The `domain_events` table: `id`, `business_id`, `type`, `subject_type`, `subject_id`, `payload`, `occurred_at`, and a unique `dedupe_key`.

`emitDomainEvent()` writes the row in the same unit of work as the change, then queues `event.dispatch`. The consumers are:

- outgoing webhooks, replacing direct `emitWebhook` calls;
- `automation_events`, which becomes a projection of the outbox;
- analytics counters;
- Slack notifications.

Loop protection: each event carries `causation_depth`, and the dispatcher drops anything past depth 3 with a logged warning.

**Catalogue:**

- prospect: `prospect.created`
- lead: `lead.created`, `lead.touched`, `lead.scored`, `score.changed`, `lead.engaged`, `lead.qualified`, `lead.booking_ready`
- conversation: `reply.received`
- meetings: `meeting.booked`, `meeting.pending`, `meeting.cancelled`, `meeting.no_show`
- opportunities: `opportunity.created`, `opportunity.won`, `opportunity.lost`
- contact: `contact.unsubscribed`, `contact.suppressed`
- system: `integration.failed`, `ai.escalated`

## 5. Per-channel opt-out (Phase 0 follow-up)

- Carrier STOP keywords write a channel-scoped `OPT_OUT`.
- A plain-English "stop contacting me" writes `ALL`.
- `leads.opted_out` becomes a generated or trigger-maintained flag: true only while an `ALL` opt-out exists for the lead's addresses.
- The send guard reads channel suppression, not the flag.

## 6. Contactability states (§13)

`contactability_results` gains a `state` column holding the brief's vocabulary. It is derived and never set by hand:

- **Permission states:** `PERMITTED`, `CONSENTED`, `SOFT_OPT_IN`, `LEGITIMATE_INTERESTS_REVIEWED`, `EXISTING_CUSTOMER`
- **Timing and pauses:** `REPLY_WINDOW_OPEN`, `TEMPORARILY_PAUSED`, `LEGAL_HOLD`
- **Refusals and objections:** `OPTED_OUT`, `UNSUBSCRIBED`, `DO_NOT_CONTACT`, `BLOCKED`
- **Address problems:** `HARD_BOUNCE`, `COMPLAINT`, `INVALID`
- **Default:** `UNKNOWN`

`LEGITIMATE_INTERESTS_REVIEWED` requires a stored LIA row. A new `legitimate_interest_assessments` table holds the workspace, purpose, necessity, balancing, reviewer and review date.

## 7. Tests

- `ingest` unit: normalisation, outcome per case, idempotency, and no provenance overwrite.
- `identity` unit: every row of the §2 table, plus the conflict case.
- e2e against real Postgres:
  - two concurrent ingests of the same person produce one lead and two touches;
  - a duplicate webhook produces one touch;
  - a suppressed person is recorded and never queued for contact.
