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
   permission is declared — ten of them, covering leads, prospects, campaigns,
   analytics, the business profile and the AI agents. `MCP_SCOPES` is a
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
| GET | `/api/v1/leads/{id}` | `leads:read` | viewer |
| PATCH | `/api/v1/leads/{id}` | `leads:write` | member |
| GET | `/api/v1/events` | `business:read` | viewer |

`POST /api/v1/leads` deliberately does not exist. Creating a lead means
deduplication, capturing a contactability record, and starting follow-up;
`lead.create` is absent from the service registry precisely because a thinner
version that skipped those would be worse than none. The endpoint returns a 400
that says so rather than a bare 405.

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
* Retries at 30s, 5m, 30m, 2h, 8h, 12h — six attempts over roughly 19 hours,
  then `EXHAUSTED` and visible in Settings rather than retried forever. Each
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

42 tools are offered to an MCP client today, across twelve domains:

| Domain | Operations | Notes |
|---|---|---|
| `lead` | get, search, update, assign, set_status, add_note, flag_attention, archive, restore | `lead.create` is deliberately absent — see below |
| `message` | send | EXTERNAL: always waits for a person |
| `agent` | list, get, create, configure, start, run_now, pause, stop | create/configure are ordinary writes; start/run_now are FINANCIAL |
| `ai_settings` | get, update | The conversation assistant's behaviour |
| `connector` | list, get, replay_event, dismiss_event, disconnect | disconnect is DESTRUCTIVE |
| `campaign` | list, get, pause, resume, launch | launch **and resume** are BULK_EXTERNAL |
| `prospect` | search, get, approve, reject | |
| `booking` | list, get, set_status | |
| `business` | get_profile, get_status | |
| `analytics` | summary | |
| `qualification` | list_questions | |
| *(legacy)* | create_lead | The one hand-written tool left; not a duplicate |

### How the risk class decides who waits

The registry grades every operation, and the grade — not the handler — decides
whether a person has to agree first:

| Risk | Runs | Examples |
|---|---|---|
| `READ` | immediately | every list and get |
| `SAFE_WRITE` | immediately | `lead.add_note`, `agent.create` |
| `REVERSIBLE_WRITE` | immediately, audited | `lead.set_status`, `agent.configure` |
| `EXTERNAL` / `BULK_EXTERNAL` | **needs a person** | `message.send`, `campaign.launch` |
| `FINANCIAL` | **needs a person** | `agent.start`, `agent.run_now` |
| `DESTRUCTIVE` | **needs a person** | `lead.archive`, `connector.disconnect` |

Over MCP, "needs a person" means the call **parks** in `mcp_approvals` with a
plain-English summary and does not execute. The assistant is told plainly, so it
cannot report success. Approving runs it on the *approver's* authority, with the
approval id as the idempotency key so approving twice cannot act twice.

`agent.create` being a `SAFE_WRITE` while `agent.start` is `FINANCIAL` is the
whole design in one line: a new agent is always a DRAFT and does nothing, so
configuring it wrongly costs nothing, and setting it running unattended is the
part that needs a decision.

### What no caller can do

Some things are absent by construction rather than gated, which is a stronger
guarantee than a permission check:

* **No model, temperature, token budget or system prompt.** A caller that could
  set them could talk an agent out of its own guardrails.
* **No `lead.create`.** Creating a lead means deduplication, capturing a lawful
  basis, and starting follow-up. A thinner version that skipped those would be
  worse than none. `create_lead` survives as the one legacy tool because it does
  all three and refuses anything that is not a warm relationship.
* **No send authority for Copilot.** `message.send` and `campaign.launch`
  exclude `COPILOT` from their callers, and `tests/copilot.test.ts` fails if
  that changes. The chat assistant in the corner of the screen does not get to
  put words in the customer's name in front of a real person.
* **No destructive operation for an autonomous agent.** Asserted by
  `tests/services.test.ts`: an unattended agent cannot set `confirmed`, so a
  destructive operation it could reach would be one nobody agreed to.

### The context budget

`tools/list` is sent to a model at the start of every session, so the catalogue
is a standing tax on every conversation. It is ~4.7k tokens today, and
`tests/mcp.test.ts` fails above 8k or if any single description exceeds 400
characters.

That budget is also why the legacy `MCP_TOOLS` array shrank from seventeen
entries to one. Thirteen duplicated a service operation — offering both
`get_lead` and `lead.get` makes an assistant choose between two tools that do
the same thing and costs the context twice. The other four were worse:
`send_message`, `launch_campaign`, `start_sourcing_run` and `change_overage_cap`
parked for approval and then **failed** when approved, because `executeApproval`
can only run a registered service operation and there was none. `message.send`
and `campaign.launch` now exist for real; the other two are gone rather than
left as promises.

---

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

**A workspace API key is the credential to use.** The older OAuth-issued MCP
access token still works, but it expires after an hour and the only way to
refresh it is a Next.js server action, which no MCP client can call — so a
connection made with one worked for an hour and then stopped for no visible
reason. Claude, Codex and Gemini all configure a static bearer header, which is
what a long-lived API key is.

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
