# Production Programme — Progress Tracker

Live status of the work identified in [PRODUCTION_PROGRAMME_AUDIT.md](PRODUCTION_PROGRAMME_AUDIT.md).
Ordered by value per day, not by programme section number.

**Legend:** ✅ done · 🔄 in progress · ⬜ not started · ⛔ blocked (reason given)

**Verification bar.** Nothing is ticked off until `npm test`, `npx tsc --noEmit`
and `eslint` are all clean, and the change has tests that would fail without it.

---

## Status

| # | Work | Status | Evidence |
|---|---|---|---|
| 1 | Follow-up compliance gate → policy engine | ✅ | [send-core.ts](../src/lib/jobs/send-core.ts), [send-store.ts](../src/lib/jobs/handlers/send-store.ts), [lead-process.ts](../src/lib/jobs/handlers/lead-process.ts) · 6 tests |
| 2 | One typed ledger writer + row shape | ✅ | [usage-metrics.ts](../src/lib/billing/usage-metrics.ts), [0062](../supabase/migrations/0062_usage_ledger.sql), [audit.ts](../src/lib/audit.ts) · 10 tests |
| 3 | Core service layer + result envelope | ✅ | [services/](../src/lib/services/) · Copilot + MCP rewired · 26 tests |
| 4 | MCP client/token provisioning | ✅ | [provisioning.ts](../src/lib/mcp/provisioning.ts), [actions.ts](../src/lib/mcp/actions.ts), [panel](../src/components/settings/connections/mcp-connections-panel.tsx) · 4 tests |
| 5 | Meta + LinkedIn app submissions | ⛔ | [PROVIDER_SUBMISSIONS.md](PROVIDER_SUBMISSIONS.md) · prep done, needs your account access |
| 6 | Copilot model loop + tool expansion | ✅ | [loop.ts](../src/lib/copilot/loop.ts), [azure-client.ts](../src/lib/ai/azure-client.ts) · 15 tests |
| 7 | Connector management UI (§5) | ✅ | [connector-ops.ts](../src/lib/integrations/connector-ops.ts), [0065](../supabase/migrations/0065_connector_event_failures.sql), [panel](../src/components/settings/connections/connector-operations.tsx) · 14 tests |
| 8 | Settings → Data Controls & Compliance (§14) | ✅ | [compliance/](../src/lib/compliance/), [0066](../supabase/migrations/0066_data_controls.sql), [form](../src/components/settings/compliance/data-controls-form.tsx) · 21 tests |

---

## 1 · Follow-up compliance gate ✅

**Problem.** Outreach sends passed the jurisdiction policy engine; follow-up and
reactivation sends passed a different guard that checked stop conditions and
quiet hours but not packs, consent or subscriber type.

**Done.**

- [x] `SendStore.policy()` contract, keeping `send-core.ts` pure and testable
- [x] Gate runs after the stop guard (a stopped conversation pays for no lookup)
      and immediately before the carrier call
- [x] Quiet hours defer and reschedule; `PolicyDecision.quietHours` added so the
      pure rules can hand the window to a caller that knows the timezone
- [x] Refusals are terminal, never retried, recorded on the message and in
      `message_events`
- [x] Blocks triaged: only refusals a person can resolve raise a review
- [x] `campaign.send` (reactivation) records `policy:<code>` as its stop reason
- [x] **Permission recorded at intake** — without this the gate would have
      refused every follow-up in the product
- [x] 6 tests in [send-guard.test.ts](../tests/send-guard.test.ts)

**Left for later:** `TRANSACTIONAL` reads the pack's warm rule set, so a booking
confirmation inherits `require_unsubscribe`. Giving it its own rule set is a
pack-semantics change and belongs with the §15 jurisdiction authoring work.

---

## 2 · One typed ledger writer ✅

**Problem.** Not the CHECK constraint (the audit was wrong; corrected there).
The ledger had four writers and only one was typed.

**Done.**

- [x] [usage-metrics.ts](../src/lib/billing/usage-metrics.ts) — one vocabulary,
      32 metrics, units, and the `feature` attribution dimension
- [x] [0062](../supabase/migrations/0062_usage_ledger.sql) — 6 new metrics,
      provenance columns, idempotency index, append-only trigger
- [x] `recordUsage` accepts every metric; `reverseUsage` posts compensating
      entries rather than editing history
- [x] All three bypassing writers migrated; every remaining reference is a read
- [x] AI token charges carry `feature`, which is most of §10's groundwork
- [x] 10 tests pinning the TypeScript list to the SQL constraint, both directions

**Left for later:** `usage_counters` seeds zero-rows for only 5 metrics. Not a
defect — the aggregation sums whatever it finds — but the zero-rows are
inconsistent. Cosmetic; folded into §18's remaining work.

---

## 3 · Core service layer ✅

The keystone. Three tool layers existed because there was no shared place for an
operation to live.

- [x] **Envelope** — `success · entityId · before · after · auditEventId ·
      warnings · billingEffect · policyResult · correlationId`
      ([types.ts](../src/lib/services/types.ts))
- [x] **Registry** with the programme's 8 risk classes
      ([registry.ts](../src/lib/services/registry.ts)). Declared `as const`, so
      operation names are a literal union and the audit vocabulary stays
      compiler-checked instead of becoming `string`
- [x] **Runtime** ([runtime.ts](../src/lib/services/runtime.ts)) — caller check →
      role → schema → confirmation → execute → audit → meter, in that fixed
      order. A handler states facts; only the runtime writes audit rows, so a
      handler cannot forge an audit id or a policy verdict
- [x] **Leads ported** ([operations/leads.ts](../src/lib/services/operations/leads.ts)) —
      9 operations with real before/after diffs
- [x] **Copilot rewired.** Its lead tools are now *derived* from the registry,
      not restated. Four hand-written implementations deleted
- [x] **MCP rewired.** Same derivation; argument schemas generated from the
      handlers' own Zod validators via `z.toJSONSchema`, so what a client is
      shown is what will be enforced
- [x] [0064](../supabase/migrations/0064_lead_archive_and_notes.sql) — archive
      columns and a real `lead_notes` table
- [x] 26 tests ([services.test.ts](../tests/services.test.ts))

**Things this fixed on the way through:**

- Copilot's `assignLead` checked workspace membership but not whether it was
  *active* — a deactivated member could be assigned leads. The service version
  checks status.
- The Actions tab kept a hardcoded `["getLead", "getCampaign"]` exception list;
  it now reads `needsObject` from the declaration.
- A destructive operation is unreachable by an autonomous agent by construction,
  and a test asserts it for every future operation too.

**Deliberately not done:** `lead.create`. Creating a lead means deduplication,
capturing a relationship for the contactability engine, and starting follow-up.
The Add Lead wizard does all three; declaring a thinner version would offer
callers a capability that quietly skips them.

---

## 4 · MCP client/token provisioning ✅

The gateway validated credentials that had no way to exist. This is the missing
half.

- [x] [provisioning.ts](../src/lib/mcp/provisioning.ts) — client creation with a
      shown-once secret (only the SHA-256 digest is stored), scope grants as
      dated rows rather than an array column
- [x] **Token issuance and rotation.** Access tokens last an hour; the refresh
      token is revoked *before* the new pair is issued, so it is single-use and a
      second presentation both fails correctly and signals a stolen copy
- [x] **Revocation is immediate.** Revoking a client revokes every token it holds
      in the same call, rather than waiting for expiry
- [x] **Approval execution.** `mcp_approvals` had an `EXECUTED` state nothing
      could reach — a person could approve a request and nothing happened. The
      approval row is now the confirmation, claimed conditionally so two
      approvers execute it once, and it runs on the *approver's* authority
- [x] [Settings panel](../src/components/settings/connections/mcp-connections-panel.tsx)
      — create, issue keys, revoke, and decide pending approvals
- [x] 4 tests in [mcp.test.ts](../tests/mcp.test.ts)

**Choices worth knowing:**

- No permission is pre-selected when creating a connection. A default set is a
  decision made on the customer's behalf about what an outside assistant may read.
- A connection with no live token shows "No key issued", not "Active" — the
  latter would be a claim the customer could disprove.
- Refused calls are shown on the card. Repeated denials are either a
  misconfiguration or something worse, and both deserve to be noticed.
- Every refresh failure returns one message. Distinguishing expired from revoked
  from already-used would tell a holder of a stolen token which one they have.

**Still open from §1** (the larger MCP programme, not provisioning): OAuth 2.1 +
PKCE with `/.well-known` discovery, audience validation, the 2026-07-28 protocol
revision, per-workspace rate limits, and the 15-skill / 80–120-tool expansion.
The expansion is now cheap — each new operation appears in Copilot and MCP at
once — but it is a large amount of domain work.

---

## 5 · Meta + LinkedIn app submissions ⛔ blocked on you

Prep is done: [PROVIDER_SUBMISSIONS.md](PROVIDER_SUBMISSIONS.md) carries every
value the forms need, taken from the code rather than from memory — redirect
URIs, webhook URLs, scopes, env var names.

I cannot submit these. Both need a developer account sign-in, acceptance of
terms as a legal representative, and business verification documents.

- [x] LinkedIn: implementation exists; submission checklist written
- [x] Meta: established that it is **not ready to submit** — no connect flow, no
      adapter, no lead webhook. Only env vars are declared. Submitting now would
      fail review
- [x] Flagged that LinkedIn's implementation should be checked against a
      currently-supported API version before submitting, given the 202508 sunset
- [ ] **You:** LinkedIn developer product application
- [ ] **You:** Meta app creation and business verification (can start in
      parallel with the engineering, since neither depends on the other)

---

## 6 · Copilot model loop ✅

Copilot was a keyword router that matched `/intent|expansion|signal/` and ran a
fixed query. It could not plan, could not combine two lookups, and could not act.

- [x] **Tool-calling transport** — `chatWithTools` in
      [azure-client.ts](../src/lib/ai/azure-client.ts). Separate from `chat`
      rather than a flag on it: `chat` forces a JSON response, which is exactly
      wrong for a turn that either calls a tool or answers in prose
- [x] **The loop** ([loop.ts](../src/lib/copilot/loop.ts)) — plans, calls tools
      through the service runtime, feeds real results back, answers from them
- [x] **Tool schemas** generated from each operation's own Zod validator, so what
      the model is shown is what will be enforced
- [x] **Role-filtered before the model sees them.** Offering a tool that would be
      refused invites the model to spend a turn discovering a boundary the loop
      already knew about
- [x] **Confirmation round-trip.** A gated action stops the turn and returns what
      will happen; confirming re-asks with the agreement attached, matched on
      *tool and exact arguments* — so agreement to archive one lead cannot be
      spent on another
- [x] **Cost bounded three ways** — max steps, a hard tool-call ceiling across
      the turn, and the token gate checked before the first call
- [x] **Metered as `copilot_turn`** with `feature: "copilot"`, so §10's
      per-category budgets can see it
- [x] Deterministic router kept as the fallback, so an AI outage degrades Copilot
      to what it used to be rather than removing it
- [x] 15 tests ([copilot.test.ts](../tests/copilot.test.ts))

**The property that matters:** Copilot cannot report a change the service layer
did not make. Not asked for in the prompt and hoped for — arranged. The model
never executes anything; it names a tool, the loop runs it, and only the real
envelope comes back.

**Found on the way through:** `createSupportTicket` is a viewer-accessible
write. That is legitimate — raising a ticket changes no workspace data — so the
test names it as the single allowed exception, which means a *second* one has to
be argued for rather than merely added.

**Not done:** the 18-domain tool expansion. Leads are ported; companies,
contacts, ICPs, sequences, messages, conversations, tasks, qualification,
bookings, integrations, automations, intent monitors and suppression are not.
Each is now cheap — one registry entry plus a handler appears in Copilot *and*
MCP at once — but it is a large amount of domain work.

---

## 7 · Connector management UI ✅

Installing a connector was all the product supported: a URL and a secret.
Everything a person needs *afterwards* now exists.

- [x] **Secret rotation** — `rotated_at` had a column and no action. Rotating
      keeps the same installation id, so the URL already configured in someone
      else's product still works and only one thing changes at their end
- [x] **Test event** — a correctly-signed event through the *real* endpoint over
      the network. A test that bypassed the route would prove the part nobody
      doubted
- [x] **Failed events + replay** ([0065](../supabase/migrations/0065_connector_event_failures.sql)),
      with reasons written for a person rather than a log
- [x] **Delivered counts and last-import date** — a connection's health is what
      arrived, not whether a secret was saved
- [x] **Example payload and copyable cURL**, generated per auth method
- [x] 14 tests ([connectors.test.ts](../tests/connectors.test.ts))

**The security decision in this item.** A request that fails authentication has
its body discarded — only a sender that proved it holds the credential gets its
payload stored. Persisting unauthenticated bodies would turn a public endpoint
into somewhere anyone can write arbitrary JSON into a workspace for staff to
read back. So a bad signature is recorded as a reason and a count, never as
content, and the UI says plainly why such an event cannot be replayed rather
than greying out a button with no explanation.

**Tested as code, not prose.** The documented cURL is asserted to sign
`<timestamp>.<body>` in that order, and the example payload is parsed by a copy
of the schema the route enforces — so an example that drifts from what the
endpoint accepts fails the build rather than becoming a support ticket.

**Deliberately not done:** the field mapper. Mapping arbitrary sender fields onto
lead fields is its own project, and the current fixed schema is at least honest
about what it accepts.

---

## 8 · Settings → Data Controls & Compliance ✅

The engine that decides whether a contact may be messaged was already good.
What never existed was anywhere for the customer to state the facts it reasons
from — so every workspace fell back to the country-neutral pack, and a UK
company prospecting only UK businesses was held to the same restrictions as one
whose jurisdiction was unknown.

- [x] [0066](../supabase/migrations/0066_data_controls.sql) — one row per
      workspace: legal identity, markets, prospect type, permitted sources,
      lawful basis, retention
- [x] **Organisation** — legal name, registered address, privacy notice, privacy
      contact, DPO. These are what marketing email legally has to carry
- [x] **Markets and prospect type**, with an explicit warning that contacting
      individuals is more restricted than contacting businesses
- [x] **Permitted sources**, defaulting to *none*. A workspace that has not
      answered has not consented
- [x] **Prohibited sources printed with no toggle beside them** — breached
      databases, unprovenanced lists, harvested addresses, scraping behind
      sign-in, licence-forbidden datasets
- [x] **Lawful basis**, recorded not assessed, with the note field that makes a
      legitimate-interests claim evidenced rather than asserted
- [x] **Retention** for uncontacted prospects, inactive leads and raw payloads
- [x] **Suppression summary** — read-only by design
- [x] **Evidence** — 30 days of contactability decisions and the policy versions
      in force, so "why did you contact this person" has a visible answer
- [x] 21 tests ([compliance.test.ts](../tests/compliance.test.ts))

**The design decision that matters most:** `EMPTY_DATA_CONTROLS` is the *most*
restrictive position, not a blank one. Otherwise the workspace that never opened
Settings would be the least constrained in the product.

**Two things deliberately absent:**

- **No remove button on suppression.** An entry exists because somebody asked
  not to be contacted. Removing one needs an audited reason and platform
  support, not a delete icon in a customer's settings.
- **"Publicly available" is not offered as a lawful basis**, and a test asserts
  no basis containing PUBLIC/AVAILABLE/SCRAPED can be added. It is the single
  most common misunderstanding this section exists to prevent.

**Not wired yet:** `allowedSources` is recorded but not yet consulted by the
policy engine — §17's provenance gap (`sourcePermitted`,
`dataLicencePermitsUse`) is still open. The data it needs now exists, which is
the hard half.

---

## What remains in the programme

Everything on the ranked list is done. These are the larger items the audit
identified that were never on it:

| Programme section | Remaining |
|---|---|
| §1 MCP | OAuth 2.1 + PKCE with `/.well-known` discovery, audience validation, the 2026-07-28 protocol revision, per-workspace rate limits, and the 15-skill / 80–120-tool expansion |
| §2 Copilot | 17 of 18 domains still to port. Each is now cheap — one registry entry plus a handler reaches Copilot *and* MCP at once |
| §3 Agents | 12 of 15 workers; heartbeats; dead-letter replay; `objective`/`trigger`/`retry_count` on runs |
| §4 Integrations | Meta, Google Calendar, Calendly, HubSpot, Salesforce, Twilio config; Google Ads webhook-key model |
| §6 Mailboxes | Google Workspace and Microsoft 365 OAuth; the 12-point connected test |
| §11–12 Enrichment | Credits as a billing dimension, confirm-before-charge, per-field provenance chips |
| §15 Packs | Jurisdiction pack *content* and legal review. The machinery is done; the rules are data |
| §16 Sources | Companies House, TED, EDGAR, Corporations Canada, NZBN, ACRA |
| §17 Policy | Wire `allowedSources` into `PolicyInput` — the settings half now exists |
| §20 Admin | Platform Readiness tracker |
