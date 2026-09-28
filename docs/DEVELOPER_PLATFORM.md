# The developer platform

Three ways into a ClientTurn workspace from outside, all governed by one
permission model and one audit trail:

| Surface | What it is | Where a customer sets it up |
|---|---|---|
| **API keys** | A credential for a customer's own software. | Settings → Developer |
| **Webhooks** | We POST signed events to their server. | Settings → Developer |
| **MCP** | An AI assistant acts on the workspace. | Settings → Developer |

They are one section, not three, because they are one decision: what leaves this
workspace, and who may act on it. Splitting them is how a customer revokes a key
and leaves an assistant connected.

---

## The rules that hold across all three

These are enforced in code, not by convention, and
`tests/developer-platform.test.ts` and `tests/developer-platform-e2e.test.ts`
fail if any of them stops being true.

1. **One list of scopes.** `lib/platform/scopes.ts` is the only place a
   permission is declared — eleven of them (`PLATFORM_SCOPES`), covering leads,
   prospects, campaigns, analytics, the business profile and the AI agents. `MCP_SCOPES` is a
   re-export of it, not a copy, so a scope cannot mean one thing over HTTP and
   something wider over MCP. A write is never gated by a `:read` scope, and
   `tests/mcp.test.ts` fails if one ever is.

2. **A credential carries one member's authority, re-read live.** The key stores
   *who* it acts as, never *what role they had*. Every request re-reads that
   person's current membership, so a demotion or an offboarding takes effect on
   the next call with nobody revoking anything.

3. **Scopes narrow, never widen.** A key granted `leads:write` on a viewer's
   authority still cannot write. Both checks run: the scope is what the key was
   granted, the role is what its owner can still do, and the narrower wins.

4. **Secrets are shown once.** API keys are stored as a SHA-256 digest, and
   there is no function anywhere that returns one. Webhook signing secrets are
   the exception and are *sealed* (AES-256-GCM) rather than hashed, because
   signing requires the value itself — they are decrypted only inside the
   delivery job.

5. **Refusals are vague outward and specific inward.** A caller is told "that
   key is not valid for this request"; the log records whether it was revoked,
   expired, IP-blocked or never existed. Distinguishing them to the caller would
   tell someone holding a stolen key exactly what they hold.

6. **Everything goes through the service layer.** No route reads the `leads`
   table. An API that queried directly would be a second definition of what a
   lead is and who may see one, and the two would drift.

---

## API keys

### Format

```
ct_live_<43 base64url characters>
ct_test_<43 base64url characters>
```

The prefix is not decoration. It makes a leaked string recognisable as a
ClientTurn credential in a log, a paste or a public repository, which is what
lets automated secret scanning find it.

### Protections

| Protection | Behaviour |
|---|---|
| Storage | SHA-256 digest only. The visible prefix and last four are stored for recognition. |
| Expiry | Default 90 days. "No expiry" exists but must be chosen deliberately. |
| IP allowlist | Optional. Exact addresses or IPv4 CIDR. An unknown caller address is **refused** when a list exists. |
| Rate limit | 300 requests/minute per key; 20/minute per address for credentials that do not resolve. |
| Revocation | Immediate, and idempotent — revoking twice does not rewrite who did it. |
| Offboarding | A suspended or removed member's keys stop working with no revocation step. |
| Audit | Issue and revoke are `audit_log` rows. Every request, allowed or refused, is an `api_request_logs` row. |
| Browser use | Impossible by design — no CORS headers are ever sent. |

### Endpoints

| Method | Path | Scope | Minimum role |
|---|---|---|---|
| GET | `/api/v1` | none (public description) | — |
| GET | `/api/v1/me` | `business:read` | viewer |
| GET | `/api/v1/leads` | `leads:read` | viewer |
| POST | `/api/v1/leads` | `leads:write` | member |
| GET | `/api/v1/leads/{id}` | `leads:read` | viewer |
| PATCH | `/api/v1/leads/{id}` | `leads:write` | member |
| GET | `/api/v1/events` | `business:read` | viewer |

### Creating a lead: `POST /api/v1/leads`

Runs the `lead.create` operation, which is `ingestLead()` — the one intake path
the ad-platform pollers, the Google Ads webhook, the Add Lead wizard, CSV import
and MCP all use (`lib/ingest/`, docs/revenue-engine/03-phase1-spine-design.md
§1). So the API gets the same deduplication, suppression check, permission
record and per-touch attribution as every other source, never a thinner copy.

* **`Idempotency-Key` header, required** (8–200 printable characters). A repeat
  with the same key returns the first outcome as `DUPLICATE` with
  `original_outcome`, and creates nothing. A key reused with a different body
  is reported in `reasons` (`idempotency_key_reused_with_different_body`).
* **`relationship` is required and must be warm** (`THEY_CONTACTED_US`,
  `EXISTING_CUSTOMER`, `REFERRAL`, `REQUESTED_INFORMATION`,
  `EXPLICIT_MARKETING_CONSENT`, `EXISTING_BUSINESS_RELATIONSHIP`). A contact you
  merely found is a prospect, not a lead.
* **`REFERRAL` needs evidence**: who referred them and when, at least 20
  characters, in `consent.evidence`. Without it the request is refused (400
  `invalid_request`). This is the same rule on every path: the Add Lead wizard
  and CSV import hold an unevidenced referral for review, and MCP `create_lead`
  refuses it the same way.
* **A suppressed contact is refused, not recorded**: 409 `REJECTED`, nothing
  stored. The caller is creating a record by hand, and "cannot be added" is the
  honest answer; an ad form's enquiry from a suppressed person is still
  recorded, by the pollers, so the business sees it.
* **Follow-up is never started from the API.** The lead is recorded, qualified
  and metered; a person chooses to message it. Starting outreach is an external
  action, and the API has nobody to confirm one.

```json
POST /api/v1/leads
Idempotency-Key: 5f0c2a8e-web-form-1234
{
  "first_name": "Jo", "last_name": "Bloggs",
  "email": "jo@acme.co.uk", "phone": "07700 900123",
  "company_name": "Acme Studio Ltd",
  "relationship": "THEY_CONTACTED_US",
  "source": { "type": "WEB_FORM", "provider": "webflow", "record_id": "sub_881",
              "form_name": "Contact us", "utm_source": "google", "gclid": "…",
              "submitted_at": "2026-09-25T10:04:00Z" },
  "answers": { "Budget": "£5k–£10k" },
  "consent": { "marketing": true, "whatsapp": false, "evidence": "Ticked box v3 on /contact" }
}
```

The response is the outcome contract, never flattened into success/failure:

```json
{ "data": { "outcome": "CREATED", "lead_id": "…", "touch_id": "…",
            "matched_by": null, "reasons": [] } }
```

| `outcome` | HTTP | Meaning |
|---|---|---|
| `CREATED` | 201 | A new lead. |
| `MERGED` | 200 | The same person (email, or phone with no conflicting email) already existed; blank fields were filled, nothing was overwritten, and a touch was recorded. `matched_by` says which rule. |
| `DUPLICATE` | 200 | The same key or the same `source.record_id` was already ingested. |
| `SUPPRESSED` | 200 | Not returned by this endpoint (it refuses suppressed contacts with `REJECTED`). Other intake paths record the enquiry and never contact it. |
| `REVIEW` | 200 | Recorded, but the phone belongs to another lead with a different email. Never merged; a person decides. |
| `INVALID` | 422 | No usable email or phone. Nothing stored. |
| `REJECTED` | 409 | The email or phone is suppressed (opted out, bounced, complained or blocked). Nothing stored. |

### Errors

```json
{ "error": { "code": "forbidden", "message": "…", "request_id": "…" } }
```

| Code | HTTP |
|---|---|
| `unauthorized` | 401 |
| `forbidden` | 403 |
| `not_found` | 404 |
| `invalid_request` | 400 |
| `rate_limited` | 429 |
| `needs_confirmation` | 409 |
| `conflict` | 409 |
| `server_error` | 500 |

`needs_confirmation` is the interesting one: the operation requires a person to
agree, and the API has nobody at a keyboard. The `effect` field says what would
have happened, so a caller can tell their user and offer to do it in the app.

### Partial changes

A `PATCH` that asks for several changes is **not** a transaction, because the
service operations behind it are not one. Rather than pretend, a failure
part-way through names what was applied before it:

```json
{ "error": { "code": "conflict", "message": "…",
             "failed_step": "lead.add_note",
             "applied": ["lead.update", "lead.set_status"] } }
```

Successes carry the service layer's own warnings, so "follow-up stops for a lead
marked won" reaches the caller's user rather than being dropped.

---

## Webhooks

### Signing

Header `clientturn-signature`, the Stripe scheme:

```
t=1717171717,v1=<hex hmac-sha256 of "<t>.<raw body>">
```

The timestamp is inside the signed material on purpose. Signing the body alone
lets anyone who once saw a valid request replay it forever; with the timestamp a
receiver rejects anything outside its tolerance (5 minutes is the default we
document).

Also sent: `clientturn-event-id`, `clientturn-event-type`,
`clientturn-delivery-attempt`.

Verify against the **raw** body, before JSON parsing — a re-serialised object
has a different key order and the signature will fail intermittently, which is
the worst possible failure mode because it looks like a network problem.
`lib/webhooks/signature.ts` is the reference implementation and its
`verifySignature` is exactly what a customer needs.

### Delivery

* Queued as a `webhook.dispatch` job. No network I/O happens inside the work
  that produced the event, so a slow endpoint never slows down lead processing.
* Claimed via `claim_webhook_deliveries` (FOR UPDATE SKIP LOCKED), so two
  overlapping workers never send the same webhook twice.
* Retries at 30s, 5m, 30m, 2h, 8h, 12h — seven attempts in all (the first plus
  six retries) over about 22.6 hours, then `EXHAUSTED` and visible in Settings
  rather than retried forever. Between retries a delivery shows as
  **Retrying** (stored as `PENDING` with `attempts > 0`). Each
  retry books its own job at its due time, so the schedule survives restarts.
* **4xx is not retried** (except 408 and 429, which explicitly ask to be). A 404
  will not become a 200 in six hours.
* An endpoint failing 20 times in a row is switched off automatically, with the
  reason shown to the customer.

### Address safety

A webhook target is a customer-supplied address our servers connect to, which is
a request-forgery primitive unless every one is checked.

* `https` only, with no development exception — events carry lead data, and a
  signature proves who sent a request, not that nobody read it.
* DNS is resolved and **every** returned address checked; a host with one public
  and one private record is refused, because we do not control which one
  `connect()` picks.
* Re-validated immediately before each delivery, not only when saved. A hostname
  that resolved publicly last week can resolve to `10.0.0.5` today.
* Redirects are not followed — a 30x from a webhook endpoint is a
  misconfiguration, and following one would skip the check for the hop that
  actually connects.

### Events

Declared in `lib/webhooks/events.ts`. Each entry names the file that emits it,
and a test fails if that file stops emitting it — **an event is never advertised
unless something actually sends it.** A subscription checkbox for an event that
never fires is worse than a missing feature: the customer builds against it,
waits, and concludes the product is broken.

| Type | Emitted by |
|---|---|
| `lead.created` | `jobs/handlers/lead-process.ts` |
| `lead.qualified` | `jobs/handlers/qualify.ts` |
| `lead.status_changed` | `services/operations/leads.ts` |
| `lead.handover_required` | `jobs/handlers/shared.ts` |
| `booking.created` | `jobs/handlers/booking-sync.ts` |
| `message.received` | `jobs/handlers/message-inbound.ts` |
| `lead.touched` | the event outbox (`events/outbox.ts`), from `ingestLead()` |
| `lead.scored` | the event outbox, from `jobs/handlers/lead-score.ts` |
| `score.changed` | the event outbox, from `jobs/handlers/lead-score.ts` |
| `reply.received` | the event outbox, from a trigger on `messages` (0123) |
| `meeting.booked` | the event outbox, from a trigger on `bookings` (0123) |
| `meeting.pending` | the event outbox, from a trigger on `bookings` (0123) |
| `meeting.cancelled` | the event outbox, from a trigger on `bookings` (0123) |
| `meeting.no_show` | the event outbox, from a trigger on `bookings` (0123) |
| `contact.unsubscribed` | the event outbox, from a trigger on `suppression_entries` (0123) |
| `contact.suppressed` | the event outbox, from a trigger on `suppression_entries` (0123) |
| `ai.escalated` | the event outbox, from a trigger on `agent_handoffs` (0123) |
| `opportunity.created` | the event outbox, from `opportunities/service.ts` |
| `opportunity.won` | the event outbox, from `opportunities/service.ts` (closed as won) |
| `opportunity.lost` | the event outbox, from `opportunities/service.ts` (closed as lost) |
| `lead.intent_changed` | the event outbox, from the `lead.score` job when the qualification engine's intent state changes |
| `quote.sent` | `quotes/events.ts`, from the `quote.send` operation |
| `quote.viewed` | `quotes/events.ts`, from the public quote page (first view per revision) |
| `quote.accepted` | `quotes/events.ts`, from the public quote page |
| `quote.declined` | `quotes/events.ts` |
| `quote.expired` | `quotes/events.ts`, from the `quote.expire` job |
| `signature.completed` | `quotes/events.ts`, from the public quote page when the signature is recorded |
| `invoice.issued` | `quotes/events.ts`, from the `invoice.issue` operation or job |
| `invoice.paid` | `quotes/events.ts`, from `invoice.record_payment` when the invoice is paid in full |
| `invoice.overdue` | `quotes/events.ts`, from the `invoice.remind` job (first overdue reminder) |

The three `opportunity.*` payloads carry `lead_id`; `opportunity.created` adds
`stage` and `motion`, and `won`/`lost` add the `reason` given when it was
closed. `subject_id` is the opportunity id.

Quote-to-cash payloads (P2). None carries a price breakdown, cost or margin,
and none carries the customer's public link (the link is the credential):

| Type | `data` |
|---|---|
| `quote.sent` | `quoteId`, `number`, `opportunityId`, `leadId`, `revision`, `totalGrossMinor`, `currency`, `validUntil` |
| `quote.viewed`, `quote.accepted`, `quote.declined`, `signature.completed` | `quoteId`, `number`, `revision`, `leadId` |
| `quote.expired` | `quoteId`, `number`, `leadId` |
| `invoice.issued` | `invoiceId`, `number`, `totalMinor`, `currency`, `dueDate`, `quoteId`, `leadId` |
| `invoice.paid` | `invoiceId`, `number`, `totalMinor`, `currency`, `quoteId` |
| `invoice.overdue` | `invoiceId`, `number`, `dueDate`, `dueMinor`, `leadId` |

Money is integer minor units (pence). The same events, plus `quote.created`,
`quote.approval_requested`, `quote.approved`, `quote.approval_rejected`,
`quote.revised`, `quote.withdrawn`, `quote.reminded`, `invoice.voided` and
`invoice.credited`, are written to `automation_events` (CHECK in migration
0156).

`lead.intent_changed` carries `lead_id`, `intent_state`, `previous_intent_state`,
`intent_score` (0–100), `next_action`, `qualification_completeness` (0–1) and the
`engine_version`. It fires only when the state changes, not on every rescore.

#### The event outbox

Phase 1 adds `domain_events` (docs/revenue-engine/03-phase1-spine-design.md §4).
A domain event is written in the same unit of work as the change — by
`emitDomainEvent()` in TypeScript, or by a database trigger where the change is
written from many places (bookings, suppressions, handoffs, inbound replies) —
and an `event.dispatch` job fans it out: to customer webhooks (the types in
`WEBHOOK_FORWARDED`), to the `automation_events` projection, and to re-scoring.
`dedupe_key` is unique, so an event is emitted once however often its source
retries, and an event more than three hops from its cause is dropped with a
warning (loop protection).

Payloads (every one also carries `subject_type`, `subject_id` and
`occurred_at`):

| Type | `data` |
|---|---|
| `lead.touched` | `lead_id`, `touch_id`, `outcome` (`MERGED`/`SUPPRESSED`), `source_type`, `source`, contact fields |
| `lead.scored`, `score.changed` | `lead_id`, `score_id`, `total`, `grade`, `previous_grade`, `confidence`, `trigger_event`, `scoring_version` |
| `reply.received` | `message_id`, `lead_id`, `channel`, `classification` (often null at arrival) |
| `meeting.*` | `booking_id`, `lead_id`, `provider`, `status`, `previous_status`, `starts_at`, `ends_at` |
| `contact.unsubscribed`, `contact.suppressed` | `lead_id` (when the address belongs to a lead), `suppression_id`, `channel` (`ALL` or one channel), `reason`, `source` |
| `ai.escalated` | `handoff_id`, `lead_id`, `conversation_id`, `reason`, `priority` |

`lead.created` is sent both by `lead.process` and by the outbox under the same
event id (the lead id), so a receiver gets it once.

`lead.status_changed` is emitted inside the service operation rather than at
each call site, so it fires whoever moved the lead — a person, Copilot, an
agent, or the customer's own software.

The "Send test" button sends `endpoint.test`, never a fabricated
`lead.created`. A receiver must be able to tell a drill from the real thing, or
testing an endpoint means creating a phantom lead in their CRM.

### Idempotency

`event_id` is stable across endpoints and retries, and `(endpoint_id, event_id)`
is unique. Retry-safe job handlers pass a natural id — the lead id, the booking
id, the message id — so a handler re-running cannot deliver the same thing
twice.

---

## The operation catalogue

Everything reachable from outside is a **service operation** declared in
`lib/services/registry.ts`. One declaration makes a capability available to the
app, Copilot, the agent runtime, MCP and the public API at once — and, just as
importantly, absent from all of them if it is not declared.

<!-- mcp-tools:start (generated: node scripts/generate-mcp-tools-doc.mjs) -->

140 tools are declared for MCP clients, across 33 domains. A declared operation whose handler is not implemented is not advertised by `tools/list`, and `tools/list` shows each credential only the tools its scopes allow.

| Domain | Tool | Kind | Scope |
|---|---|---|---|
| `agent` | `agent.list` | READ | `agents:read` |
| `agent` | `agent.get` | READ | `agents:read` |
| `agent` | `agent.create` | WRITE | `agents:write` |
| `agent` | `agent.configure` | WRITE | `agents:write` |
| `agent` | `agent.start` | APPROVAL_GATED | `agents:write` |
| `agent` | `agent.run_now` | APPROVAL_GATED | `agents:write` |
| `agent` | `agent.pause` | WRITE | `agents:write` |
| `agent` | `agent.stop` | WRITE | `agents:write` |
| `agent` | `agent.delete` | APPROVAL_GATED | `agents:write` |
| `ai_budget` | `ai_budget.update` | WRITE | `business:write` |
| `ai_settings` | `ai_settings.get` | READ | `agents:read` |
| `ai_settings` | `ai_settings.update` | WRITE | `agents:write` |
| `ai_usage` | `ai_usage.get` | READ | `analytics:read` |
| `analytics` | `analytics.summary` | READ | `analytics:read` |
| `booking` | `booking.list` | READ | `leads:read` |
| `booking` | `booking.get` | READ | `leads:read` |
| `booking` | `booking.set_status` | WRITE | `leads:write` |
| `business` | `business.get_profile` | READ | `business:read` |
| `business` | `business.get_status` | READ | `business:read` |
| `campaign` | `campaign.list` | READ | `campaigns:read` |
| `campaign` | `campaign.get` | READ | `campaigns:read` |
| `campaign` | `campaign.pause` | WRITE | `campaigns:write` |
| `campaign` | `campaign.resume` | APPROVAL_GATED | `campaigns:write` |
| `campaign` | `campaign.launch` | APPROVAL_GATED | `campaigns:write` |
| `campaign` | `campaign.add_lead` | WRITE | `campaigns:write` |
| `catalogue` | `catalogue.list` | READ | `business:read` |
| `catalogue` | `catalogue.upsert_item` | WRITE | `business:write` |
| `catalogue` | `catalogue.upsert_bundle` | WRITE | `business:write` |
| `catalogue` | `catalogue.archive` | WRITE | `business:write` |
| `connector` | `connector.list` | READ | `business:read` |
| `connector` | `connector.get` | READ | `business:read` |
| `connector` | `connector.replay_event` | WRITE | `business:write` |
| `connector` | `connector.dismiss_event` | WRITE | `business:write` |
| `connector` | `connector.disconnect` | APPROVAL_GATED | `business:write` |
| `crm_pull` | `crm_pull.list` | READ | `business:read` |
| `crm_pull` | `crm_pull.set` | WRITE | `business:write` |
| `experiment` | `experiment.list` | READ | `campaigns:read` |
| `experiment` | `experiment.results` | READ | `campaigns:read` |
| `experiment` | `experiment.create` | WRITE | `campaigns:write` |
| `experiment` | `experiment.start` | WRITE | `campaigns:write` |
| `experiment` | `experiment.stop` | WRITE | `campaigns:write` |
| `experiment` | `experiment.promotion_advice` | READ | `campaigns:read` |
| `experiment` | `experiment.promote` | WRITE | `campaigns:write` |
| `experiment` | `experiment.rollback` | WRITE | `campaigns:write` |
| `experiment` | `experiment.set_auto_promote` | WRITE | `campaigns:write` |
| `funnel` | `funnel.get` | READ | `analytics:read` |
| `invoice` | `invoice.create_from_quote` | APPROVAL_GATED | `leads:write` |
| `invoice` | `invoice.issue` | APPROVAL_GATED | `leads:write` |
| `invoice` | `invoice.record_payment` | APPROVAL_GATED | `leads:write` |
| `invoice` | `invoice.void` | APPROVAL_GATED | `leads:write` |
| `invoice` | `invoice.credit_note` | APPROVAL_GATED | `leads:write` |
| `invoice` | `invoice.list` | READ | `leads:read` |
| `lead` | `lead.get` | READ | `leads:read` |
| `lead` | `lead.search` | READ | `leads:read` |
| `lead` | `lead.update` | WRITE | `leads:write` |
| `lead` | `lead.assign` | WRITE | `leads:write` |
| `lead` | `lead.set_status` | WRITE | `leads:write` |
| `lead` | `lead.add_note` | WRITE | `leads:write` |
| `lead` | `lead.flag_attention` | WRITE | `leads:write` |
| `lead` | `lead.record_whatsapp_opt_in` | WRITE | `leads:write` |
| `lead` | `lead.archive` | APPROVAL_GATED | `leads:write` |
| `lead` | `lead.restore` | WRITE | `leads:write` |
| `lead` | `lead.suppress` | APPROVAL_GATED | `leads:write` |
| `lead` | `lead.anonymise` | APPROVAL_GATED | `leads:write` |
| `lead` | `lead.delete` | APPROVAL_GATED | `leads:write` |
| `lead` | `lead.export` | READ | `leads:read` |
| `lead` | `lead.score_explain` | READ | `leads:read` |
| `lead` | `lead.contactability` | READ | `leads:read` |
| `lead` | `lead.rescore` | WRITE | `leads:write` |
| `lead` | `lead.takeover` | WRITE | `leads:write` |
| `lead` | `lead.resume_follow_up` | WRITE | `leads:write` |
| `lead` | `lead.add_tag` | WRITE | `leads:write` |
| `legitimate_interest` | `legitimate_interest.save` | WRITE | `business:write` |
| `meeting_type` | `meeting_type.list` | READ | `business:read` |
| `meeting_type` | `meeting_type.save` | WRITE | `business:write` |
| `meeting_type` | `meeting_type.archive` | WRITE | `business:write` |
| `member` | `member.list` | READ | `business:read` |
| `member` | `member.invite` | APPROVAL_GATED | `business:write` |
| `member` | `member.resend_invite` | APPROVAL_GATED | `business:write` |
| `member` | `member.set_role` | WRITE | `business:write` |
| `member` | `member.remove` | APPROVAL_GATED | `business:write` |
| `member` | `member.transfer_ownership` | APPROVAL_GATED | `business:write` |
| `merge_candidate` | `merge_candidate.list` | READ | `leads:read` |
| `merge_candidate` | `merge_candidate.resolve` | APPROVAL_GATED | `leads:write` |
| `message` | `message.send` | APPROVAL_GATED | `leads:write` |
| `message` | `message.draft` | WRITE | `leads:write` |
| `opportunity` | `opportunity.list` | READ | `leads:read` |
| `opportunity` | `opportunity.get` | READ | `leads:read` |
| `opportunity` | `opportunity.add_interest` | WRITE | `leads:write` |
| `opportunity` | `opportunity.set_stage` | WRITE | `leads:write` |
| `opportunity` | `opportunity.close` | APPROVAL_GATED | `leads:write` |
| `pipeline` | `pipeline.get_mapping` | READ | `business:read` |
| `privacy_request` | `privacy_request.list` | READ | `business:read` |
| `privacy_request` | `privacy_request.create` | WRITE | `business:write` |
| `privacy_request` | `privacy_request.update` | WRITE | `business:write` |
| `prospect` | `prospect.search` | READ | `prospects:read` |
| `prospect` | `prospect.get` | READ | `prospects:read` |
| `prospect` | `prospect.approve` | WRITE | `prospects:write` |
| `prospect` | `prospect.reject` | WRITE | `prospects:write` |
| `prospect` | `prospect.set_company_website` | WRITE | `prospects:write` |
| `qualification` | `qualification.list_questions` | READ | `business:read` |
| `qualification` | `qualification.status` | READ | `leads:read` |
| `qualification` | `qualification.unknowns` | READ | `leads:read` |
| `qualification` | `qualification.explain` | READ | `leads:read` |
| `qualification` | `qualification.intent` | READ | `leads:read` |
| `qualification` | `qualification.requalify` | WRITE | `leads:write` |
| `qualification` | `qualification.set_fact` | WRITE | `leads:write` |
| `qualification` | `qualification.override_intent` | WRITE | `leads:write` |
| `qualification` | `qualification.override_nba` | WRITE | `leads:write` |
| `qualification` | `qualification.policy_get` | READ | `business:read` |
| `qualification` | `qualification.policy_update` | WRITE | `business:write` |
| `quote` | `quote.calculate` | READ | `leads:read` |
| `quote` | `quote.create` | WRITE | `leads:write` |
| `quote` | `quote.update_draft` | WRITE | `leads:write` |
| `quote` | `quote.submit_for_approval` | WRITE | `leads:write` |
| `quote` | `quote.send` | APPROVAL_GATED | `leads:write` |
| `quote` | `quote.revise` | WRITE | `leads:write` |
| `quote` | `quote.withdraw` | APPROVAL_GATED | `leads:write` |
| `quote` | `quote.get` | READ | `leads:read` |
| `quote` | `quote.list` | READ | `leads:read` |
| `quote_settings` | `quote_settings.get` | READ | `business:read` |
| `sales_objections` | `sales_objections.list` | READ | `business:read` |
| `sales_objections` | `sales_objections.save` | WRITE | `business:write` |
| `sales_objections` | `sales_objections.remove` | WRITE | `business:write` |
| `sales_objections` | `sales_objections.save_reassurance` | WRITE | `business:write` |
| `sales_objections` | `sales_objections.preview` | READ | `business:read` |
| `sales_settings` | `sales_settings.get` | READ | `business:read` |
| `sales_settings` | `sales_settings.update` | WRITE | `business:write` |
| `scoring_weights` | `scoring_weights.update` | WRITE | `business:write` |
| `voice` | `voice.settings_get` | READ | `business:read` |
| `voice` | `voice.settings_update` | WRITE | `business:write` |
| `voice` | `voice.number_status` | READ | `business:read` |
| `voice` | `voice.request_call` | APPROVAL_GATED | `leads:write` |
| `voice` | `voice.cancel_call` | WRITE | `leads:write` |
| `voice` | `voice.calls_list` | READ | `leads:read` |
| `voice` | `voice.call_get` | READ | `leads:read` |
| `whatsapp_template` | `whatsapp_template.list` | READ | `business:read` |
| `whatsapp_template` | `whatsapp_template.sync` | WRITE | `business:write` |
| `whatsapp_template` | `whatsapp_template.map_step` | WRITE | `business:write` |
| `(legacy)` | `create_lead` | WRITE | `leads:write` |

<!-- mcp-tools:end -->

`lead.get` returns the lead and its last 20 messages as `recent_activity` (over
the API, beside `data`). `lead.create` is the API's intake (see above);
`create_lead` survives as the one hand-written MCP tool.

### Quote-to-cash operations (P2)

Catalogue (`catalogue.*`), quote settings (`quote_settings.*`), quotes
(`quote.*`) and customer invoices (`invoice.*`) are ordinary service
operations: one implementation (lib/quotes/service-core.ts,
lib/invoicing/service-core.ts) for the app, the API, MCP and later the agent.

- Roles: the catalogue and quote settings are owner/admin (prices, VAT, legal
  terms). Members build, send, revise and withdraw quotes. Only an owner or
  admin approves, and only in the app (`quote.approve`/`quote.reject` are
  UI-only). Invoices, payments, voids and credit notes are admin.
- Plan gates run inside each handler through `can()` (billing/capabilities.ts):
  `quote_builder_enabled`, `esign_enabled`, `invoicing_enabled`,
  `quote_approval_enabled`, `quote_ai_enabled`. No operation checks a plan name.
- `quote.create` is idempotent on `requestId` (or the API `Idempotency-Key`):
  the same request returns the existing quote. `invoice.credit_note` is
  idempotent on its request id and `invoice.record_payment` on its reference.
- `quote.send`, `quote.withdraw` and every invoice write except `invoice.list`
  need a person's confirmation (MCP parks them for approval; an API key is
  told a person is needed).
- State changes only happen through the 0153 `quote_transition` /
  `quote_record_signature` functions (row lock, expected status, action key).
- The agent may later call exactly `quote.calculate`, `quote.create`,
  `quote.submit_for_approval` and `quote.send` (`AGENT_QUOTE_OPERATIONS` in
  the registry); the tools are wired in a later phase.

## MCP

Endpoint: `POST /api/mcp`, JSON-RPC 2.0. Methods: `initialize`, `ping`,
`tools/list`, `tools/call`, plus `notifications/initialized` and
`notifications/cancelled` (answered `202` with no body — answering a
notification with a result makes a client treat the stream as corrupt).

### Connecting

```bash
claude mcp add --transport http clientturn \
  https://<host>/api/mcp \
  --header "Authorization: Bearer ct_live_…"
```

**A workspace API key is the credential to use.** Claude, Codex and Gemini all
configure a static bearer header, which is what a long-lived API key is.

**Settings → Developer → Assistant connections** issues one: *New connection*
asks for a name and the permissions, and shows the key once, with the server
URL and a ready-to-paste client configuration. The key is an ordinary workspace
API key scoped to exactly those permissions and **bound to the connection**
(`api_keys.mcp_client_id`, migration 0133; before 0133 is applied the binding is
carried by a `[mcp:<connection id>]` tag at the end of the key's name). So:

* calls made with it are attributed to the connection in `mcp_audit_logs`;
* *Replace key* on the connection revokes the old key and shows a new one;
* revoking the connection revokes its key, and the gateway also refuses a key
  whose connection is suspended or revoked, even if the key row were missed.

The dialog used to show an OAuth *client secret*, which the gateway never
accepted, and *New key* minted a one-hour access token whose only refresh path
was a Next.js server action no MCP client can call — so a connection worked for
an hour and then stopped. The OAuth access tokens still authenticate until they
expire; nothing issues new ones from the UI.

### Behaviour

* `tools/list` is scope-filtered, so an assistant cannot learn that a capability
  it cannot use exists.
* The tool catalogue is *derived* from the service registry, not restated, and
  each tool's argument schema is generated from the operation's own validator —
  what a client is shown is exactly what will be enforced.
* Anything needing a person's confirmation becomes `APPROVAL_GATED`: it parks in
  `mcp_approvals` and is **not** carried out. The assistant is told plainly, so
  it cannot report success. The parked summary is the operation's own
  customer-facing summary and effect, plus the record being acted on — an
  approver reading "Archive a lead" without knowing which lead cannot decide.
* Approving runs on the *approver's* authority, not the requester's, with the
  approval id as the idempotency key so approving twice cannot act twice.
* Every call is audited in `mcp_audit_logs`, including every refusal, with the
  credential that made it.

---

## Payment confirmation (the direct-sale loop)

When the assistant closes a sale with an approved checkout link (Settings →
Business Profile → Selling: direct close), ClientTurn learns that the lead paid
from one of two per-workspace inbound endpoints. Both are set up in
**Settings → Connections → Payments**. Code: `src/lib/payments/`,
`src/app/api/webhooks/payments/`, migration 0143.

Both follow the webhook rule: verify the signature → write `webhook_events`
(unique on provider + `<endpoint id>:<event id>`) → queue `payment.confirm` →
acknowledge. Nothing calls a provider and nothing touches a lead inside the
request. Payments are also unique per (workspace, provider, order id) in
`checkout_payments`, so a redelivery or a second event for the same order never
applies twice.

### Tracked links

Every checkout link the assistant sends carries one extra query parameter: an
opaque token (24 characters from `A–Z a–z 0–9 - _`, HMAC-derived from the send,
never the lead id) that names a `checkout_attempts` row.

| Link | Parameter | Comes back as |
|---|---|---|
| Stripe Payment Link (`https://buy.stripe.com/...`) | `client_reference_id` | `client_reference_id` on the Checkout Session |
| Anything else | `ct_ref` by default, or the link's own **Tracking parameter** | `reference` in the order-paid body, **only if your shop passes it through** |

Be clear-eyed about the second row. A plain Shopify or WooCommerce product page
drops unknown query parameters. The reference survives only where the shop
carries it into the order (for example a Shopify cart permalink with
`attributes[ct_ref]`, a WooCommerce plugin that saves URL parameters to order
meta, or Paddle `custom_data`) and your order webhook sends it back. Without it
the payment falls back to an email match, which is a REVIEW match and is never
applied automatically.

The response validator admits a tracked URL only when its base is an approved
link allowed on that turn and the only difference is that link's tracking
parameter with a well-formed token.

### Stripe (the customer's own account, no Connect)

```
POST /api/webhooks/payments/stripe/<endpoint id>
Stripe-Signature: t=<unix>,v1=<hex>
```

Add the URL shown in Settings as a webhook endpoint in **your** Stripe account
(Developers → Webhooks) with the events `checkout.session.completed`,
`checkout.session.async_payment_succeeded` and `invoice.paid`, then paste the
endpoint's signing secret (`whsec_…`) into the card. It is sealed with
`CREDENTIAL_ENCRYPTION_KEY` and never shown again. Verification is Stripe's
scheme (HMAC-SHA256 over `t.rawBody`, any `v1` may match, 5 minutes'
tolerance). A delivery with no saved secret is refused.

| Event | Used as |
|---|---|
| `checkout.session.completed` (`payment_status` `paid` or `no_payment_required`) | the payment; `client_reference_id` is the token; a subscription session's order id is the subscription id |
| `checkout.session.async_payment_succeeded` | the same, once a delayed method clears |
| `invoice.paid` | a subscription's first invoice collapses onto its session (same order id) and adds the interval; later invoices are renewals, matched by subscription id; zero-amount invoices are ignored |

This endpoint is separate from `/api/webhooks/stripe`, which is ClientTurn's
own billing account.

### Order paid (Shopify, WooCommerce, GoCardless, Paddle, Zapier)

```
POST /api/webhooks/payments/order-paid/<endpoint id>
Content-Type: application/json
X-ClientTurn-Timestamp: <unix seconds>
X-ClientTurn-Signature: hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))
```

The same signing scheme as the inbound contact endpoint (five minutes each
way). The secret (`ctop_…`) is generated in the card and shown once; rotating it
stops the old one immediately.

```json
{
  "order_id": "1001",                 // required, your order id (idempotency key)
  "amount": 49.99,                    // required, MAJOR units: number or "49.99"
  "currency": "GBP",                  // required, three letters
  "reference": "AbCdEfGhIjKlMnOpQrStUvWx", // optional, the tracking value from the link
  "email": "buyer@example.com",       // optional, used only for a REVIEW match
  "recurring": true,                  // optional
  "interval": "month",                // optional: day | week | month | year
  "subscription_id": "sub_123",       // optional, lets renewals follow the first payment
  "event_id": "evt-1",                // optional, defaults to order_id
  "source": "shopify",                // optional: shopify | woocommerce | gocardless | paddle | zapier | other
  "paid_at": "2026-09-27T10:00:00Z"   // optional
}
```

Responses: `202 {accepted, order_id, status: "queued" | "duplicate"}`; `400`
invalid JSON or body (the message names the field); `401` bad or stale
signature; `404` unknown endpoint; `413` over 16 KB; `415` not JSON.

Shopify and WooCommerce cannot compute this signature from their own webhook
settings. Send the request from Zapier (a Code step can compute the HMAC), Make,
or a small function of your own.

### What happens on payment

`payment.confirm` (`src/lib/payments/confirm.ts`), re-reading every row:

1. Match: the token → that checkout attempt (certain); a known subscription →
   the lead it already belongs to (a renewal); exactly one live lead with the
   email → **REVIEW** (recorded, the owner is told, nothing applied until a
   person confirms it); otherwise **UNMATCHED** (kept and shown for linking,
   never dropped).
2. Apply (certain matches, and a person's link): the attempt becomes PAID; on
   the lead's first payment the open opportunity takes the amount (MRR for a
   subscription) and closes WON through `closeOpportunity`, which stops the
   lead's automation and emits `opportunity.won` (now carrying a `payment`
   object: `amount_minor`, `currency`, `recurring`, `interval`, `mrr_minor`,
   `payment_id`) to webhooks and the CRM push; the thank-you is queued on the
   normal send path. A renewal is recorded as revenue only.

A person links a REVIEW or UNMATCHED payment with the `payment.link_to_lead`
operation (UI only, EXTERNAL, owner/admin, confirmed and audited), which queues
the same apply.

## The Zapier app

A Zapier Platform CLI integration ("Client Turn", `developer.zapier.com/app/246145`)
sits on top of the same API keys and endpoints above — it is a client of
`/api/v1`, not a fourth surface with its own rules. Private (invite-only) until
it clears Zapier's review for the public directory.

| Piece | Type | Calls |
|---|---|---|
| Authentication | API Key | Every request; validated with `GET /api/v1/me` |
| New Lead | Trigger, Polling | `GET /api/v1/leads` |
| Find Lead | Action, Search | `GET /api/v1/leads?query=…` |
| Update Lead | Action, Create | `PATCH /api/v1/leads/{id}` |

There is no Create action yet. `POST /api/v1/leads` now exists (see above) and
runs the full intake pipeline, so a Create Lead action can be added on top of it
— sending a stable `Idempotency-Key` per Zap run — once the app is next
published. Until then a Zap uses "Webhooks by Zapier" against that endpoint or
the connector endpoint from `lib/integrations/apps.ts`.

**Every request sets its own `Authorization` header explicitly**, inside each
step's own code rather than relying on the Request Template's global header
merge. That merge looked configured correctly and worked for the trigger in
testing, then produced a 401 on the Update action with the identical key
against the identical endpoint — a live-`fetch()` call with the same key
succeeded every time. Whatever Zapier's cause, an explicit header per step
removed the failure mode entirely, so it is now the pattern for all three
steps rather than something to keep half-fixed.

Search and polling requests unwrap `{ data: […], count }` into a bare array
(`results.data`) in a `.then()` — Zapier requires triggers and searches to
return an array, and the public API deliberately wraps every list response,
so every step does this unwrapping rather than exposing an unwrapped variant
of the endpoint just for Zapier.

Verifying a change to any step means testing it against the **live** API with
a throwaway workspace — Zapier's own request tester calls the real
`developer.zapier.com` app, so there is no local/staging variant to point it
at instead. The pattern:

```bash
node --env-file=.env --env-file=.env.local --import ./scripts/e2e-resolver.mjs <script.mjs>
```

with a script that creates a business, a user, a lead and a **live**
`createApiKey(...)` for it, prints the key, and — after the manual test in
Zapier's UI is done — deletes all four (`api_keys`, `leads`,
`business_members`, `businesses`, the auth user) in one follow-up run. A live
key is fine here specifically because nothing behind it is real: the business
is synthetic and gets deleted the same session, never left to accumulate.
Delete the connected account in Zapier's own connections list
(`zapier.com/app/assets/connections`) at the same time — a stale connection
to a deleted business shows as "expired" and is otherwise silent clutter.

### Publishing status (2026-09-12)

Signed off as release-ready with one accepted gap. Zapier's own publishing
checklist (`developer.zapier.com/app/246145` → Validate) still blocks the
"Publish" action on:

- **`find_lead` has no live Zap run recorded.** Structural, not a bug: Zapier
  never allows a Search step to be the last step of a Zap, so proving it live
  needs a 3-step Zap (trigger → search → action), and any 3-step Zap is
  gated behind Zapier's paid plan regardless of which apps are used — a
  2-step Zap ending in `find_lead` is not a workaround, it does not exist as
  a publishable shape. **Explicitly authorized to ship without this** rather
  than pay for Zapier Pro; revisit if a Pro trial becomes available or the
  business ends up on a paid Zapier plan anyway.
- **Fewer than 3 users with a live Zap** (has 1 — the admin account used to
  build it). Needs real adoption, which is now seeded by the invite email
  below rather than something to chase manually.
- **Admin email domain match.** `admin@clientturn.com` is invited as an Admin
  team member on the integration, but the invitation is stuck **Pending**
  because that address has no inbox yet. Needs either a real mailbox behind
  it or DNS-level forwarding to somewhere that can click the confirmation.

Everything else that was previously blocking (static sample data on all
three steps, a live task recorded for `new_lead` and `update_lead`, the
description/logo metadata checks) is fixed and verified.

**Adoption is seeded automatically**: the first time a workspace's Stripe
subscription takes a real payment (`invoice.paid`, `billing_reason:
subscription_create`), `src/app/api/webhooks/stripe/route.ts` enqueues a
`notification.send` job (`kind: "developer_integrations_invite"`, see
`src/lib/jobs/handlers/notification-send.ts`) that emails the workspace's
owner/admins a branded invite to connect Client Turn on Zapier, sent from
`admin@clientturn.com`. Fires at most once per workspace ever (keyed on the
business id alone in `jobs.idempotency_key`).

---

## Testing

```bash
npm test                       # the pure rules
npx supabase start
npm run test:e2e:developer     # credentials, RLS, MCP gateway, webhook delivery
npm run test:e2e:operations    # every service operation, executed for real
```

`test:e2e:operations` exists because of a specific failure. Six operations
shipped writing vocabulary their column does not hold — `"sending"` where the
value is `RUNNING`, `"REJECTED"` where it is `DISQUALIFIED`, `"dismissed"` where
it is `ignored`. Every one type-checked and passed the unit tests, and every one
would have failed on its first real call: a `CHECK` constraint enumerating
strings is invisible to TypeScript, and a mocked client agrees with whatever it
is told.

So that suite runs each operation against a real Postgres and reads the row
back, asserting the stored value by name. It ends with a coverage guard — a
write operation it does not exercise fails the suite — because an operation
nobody has ever run is exactly how six of them shipped broken.

### What an unattended agent may reach

Every operation declares its `callers`. Leaving that unset means *all* of them,
which is how an agent briefly gained the ability to raise its own spend caps and
switch off its own supervision. The rules are asserted in
`tests/services.test.ts`:

* **It cannot edit its own limits** — `agent.create`, `agent.configure`,
  `agent.start`, `agent.run_now`.
* **It cannot edit its own supervision** — `ai_settings.update` decides whether
  the assistant drafts or sends, and whether a REVIEW reaches a person.
* **It cannot cause outbound contact** — `message.send`, `campaign.launch`,
  `campaign.resume`.
* **It cannot approve its own output** — `prospect.approve` would make an
  agent's `REVIEW_ALL` autonomy setting mean nothing.
* **It cannot conceal breakage** — `connector.dismiss_event`, `replay_event`,
  `disconnect`.

It keeps: working leads, pausing and stopping, marking a booking, and
*rejecting* a prospect. The cautious direction, in every case.

**The safe direction is never gated.** `agent.pause`, `agent.stop` and
`campaign.pause` must not require confirmation and must stay reachable — the
thing that stops a misbehaving agent cannot itself be waiting on an approval.
A test asserts it.

The end-to-end suite proves the rules are *enforced* rather than merely stated:
a key issued by the real `createApiKey` resolving through the real
`authenticateApiKey`, every way a key should stop working actually stopping it,
the MCP gateway refusing a scope it was not granted, and a delivery refusing a
private address at send time. Nothing is mocked — a mocked Supabase client would
only demonstrate that the mock agrees with itself, which is the wrong thing to
be confident about for a credential boundary.
