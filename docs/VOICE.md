# Voice: the AI voice sales agent (phases P2 and P3)

The AI voice agent phones a lead from the workspace's own dedicated UK number,
opens with a fixed AI disclosure, runs a short qualification or closing
conversation, and hands the result back to the same qualification, objection
and follow-up machinery the text channels use.

This document describes what is built in phases P2 and P3 (§16: the call as
an execution surface of the sales agent), what is not, and what the owner must
do before the first live call. Read it before changing anything
under `src/lib/voice/`, `src/lib/jobs/handlers/voice.ts`,
`src/lib/services/operations/voice.ts`, the voice webhook routes or the voice
billing files.

Design sources: [12-voice-quote-to-cash-gap-map.md](revenue-engine/12-voice-quote-to-cash-gap-map.md)
(owner decisions OD-1 and OD-2, risks R1 and R15) and
[12-voice-provider-research.md](revenue-engine/12-voice-provider-research.md)
(provider choice, prices, cost model).

---

## 1. Architecture

### Pure core, injected dependencies

Everything that decides anything is pure and has no `server-only`, Supabase or
network import. The server wires real dependencies in; the tests wire
in-memory fakes, so every path that can place a call is exercised without
spending money or touching a provider.

| Layer | Files | What it does |
|---|---|---|
| Pure rules | `entitlement.ts`, `eligibility.ts`, `calling-hours.ts`, `destinations.ts`, `dial-decision.ts`, `identity.ts`, `opener.ts`, `budget.ts`, `time-governor.ts`, `retry-policy.ts`, `state-machine.ts`, `ingest.ts`, `post-call.ts`, `cost.ts`, `snapshot.ts`, `settings-model.ts`, `numbers/provisioning.ts`, `numbers/provisioning-details.ts`, `numbers/sender.ts` | Decisions and arithmetic. No I/O. |
| Orchestration | `runtime-core.ts`, `minutes-core.ts` | The call lifecycle and the minute ledger, over the `VoiceDeps` / `MinuteStore` interfaces. No I/O of its own. |
| Server wiring | `server-deps.ts`, `minutes.ts`, `webhook-inbox.ts`, `sender-context.ts`, `providers/registry.ts` | Supabase reads and compare-and-swap writes, the 0157 RPCs, the job queue, R2, provider construction. Service role only. |
| Adapters | `providers/retell.ts`, `providers/retell-protocol.ts`, `providers/twilio-voice.ts`, `providers/twilio-protocol.ts`, `providers/fake.ts` | Wire formats, signatures, REST calls (fetch injectable). `fake.ts` is tests only. |
| Entry points | `jobs/handlers/voice.ts`, `services/operations/voice.ts`, `app/api/webhooks/retell`, `app/api/webhooks/twilio/voice`, `app/api/webhooks/twilio/regulatory` | Thin shells: validate, then call `runtime-core`. |

`runtime-core.ts` exports one function per job: `requestCall`, `dialCall`,
`ingestVoiceEvent`, `postProcessCall`, `planCallRetry`, `provisionStep`,
`startProvisioning`, `scheduleNumberRelease`, `fetchRecording`.

### The three provider roles (`providers/types.ts`)

| Role | Interface | Live implementation | Responsibility |
|---|---|---|---|
| Voice (conversation) | `VoiceProvider` | Retell (`retell.ts`) | Places the outbound call against an agent, runs the conversation, reports call events, returns transcript, duration, cost and recording URL. |
| Telephony (carrier) | `TelephonyProvider` | Twilio (`twilio-voice.ts`) | The carrier leg: hang-up backstop, number configuration, carrier status callbacks. |
| Numbers | `NumberProvider` | Twilio (`twilio-voice.ts`) | Subaccounts, regulatory bundles, number search, purchase, Messaging Service, release. |

`providers/registry.ts` builds them from env. A missing key yields `null` for
that role, never a throw: no `RETELL_SECRET_KEY` means no `VoiceProvider`, and
every voice path reports `integration-required`. No Twilio `AC...` SID and
auth token means no number provisioning. `voiceIntegrationStatus()` lists what
is missing by env name for the Settings integration-required state.

---

## 2. Call flow

```
request            voice.request_call / planCallRetry
  -> requestCall   decideDial (entitlement + canCallLead + human + caller id + allocation + concurrency)
                   insert voice_calls (state QUEUED, keyed voice:call:<biz>:<lead>:<route>:<attempt>)
                   voice_call_eligibility row, voice_call_queue row, enqueue voice.dial
queue
  -> voice.dial    re-read the call; skip unless QUEUED
                   decideDial again, immediately before dialling
                   reserve minutes (included first, then packs)
                   voice_call_begin_dial RPC: QUEUED -> DIALLING under the per-lead lock
                   Retell create-phone-call, exactly once, with the locked OD-1 preamble
webhooks
  -> /api/webhooks/retell, /api/webhooks/twilio/voice
                   verify -> webhook_events row -> 2xx -> voice.webhook_ingest
  -> voice.webhook_ingest
                   reduceVoiceEvent: apply the observed state under compare-and-swap,
                   append voice_call_events, queue voice.post_call / voice.recording_fetch
post-call
  -> voice.post_call
                   transcript, outcome, objections, qualification signals, voice opt-out,
                   next action, settle or release minutes, cost ledger, POST_PROCESSING -> COMPLETE,
                   queue voice.retry for a missed call
retry / fallback
  -> voice.retry   planRetry: a new requestCall (all gates again), or a text fallback
                   written as the lead's next action, or stop
```

Details worth knowing:

- **Deferral.** A `DEFER` decision (outside calling hours, attempt too soon,
  a person on the lead, concurrency full, minutes contended) re-queues the
  same call and re-enqueues `voice.dial` for the computed time. A `CANCEL`
  decision moves the call to `CANCELLED`, removes the queue row and returns any
  held minutes.
- **Crash between DIALLING and the provider.** A call left in `DIALLING` with
  no `provider_call_id` for more than 10 minutes (`DIAL_STALE_AFTER_MS`) is
  closed as `FAILED` with `DIAL_OUTCOME_UNKNOWN`. It is never re-dialled; the
  post-call job releases its minutes.
- **Provider refusal.** A Retell error closes the call `FAILED` with
  `PROVIDER_<status>[_PERMANENT]`. Post-call releases the hold and the retry
  job decides whether a transient failure is retried.
- **Agent and identity.** The agent is `voice_settings.provider_agent_id`, else
  `RETELL_AGENT_ID`. No agent, or an incomplete OD-1 identity at dial time,
  fails the call rather than dialling.
- **Locked preamble.** `opener.ts` builds the OD-1 opener ("This is an AI
  assistant calling from {calling_as_name} about the enquiry you sent us
  {day}. Is now an OK time for a couple of minutes?") plus the recording notice
  when recording is on. It is passed to Retell as the `locked_preamble`
  dynamic variable with `opener_version`, `identity_answer`, `persona_name`,
  `opener_suffix`, `route` and `lead_first_name`. `OPENER_VERSION` is stored on
  every call. P3: the Retell LLM's begin message is `{{locked_preamble}}`, so
  Retell speaks it before any model output (§16.1); the call ends with the
  fixed closing line (§16.7).
- **Post-call analysis** (`post-call.ts`) runs the lead's words through the
  same `extractTextSignals` and `matchObjection` the text path uses. There is
  no voice-only extractor, and the model's reasoning is never stored.
  Qualification changes go through the QI service and the ordinary
  `lead.score` reassessment.
- **Voicemail.** P3 delivers it: see §16.6.
- **Fallback.** After the last attempt, or when a retry is not allowed, the
  retry job writes a next action ("No answer after N call attempts. Follow up
  by text/email.") on the lead. It does not send the message itself; the
  follow-up engine and its own gates do.
- **Transfer.** Retell `transfer_*` events move the call to `TRANSFERRED`.
  `voice_settings.transfer_number_e164` and `transfer_mode` (0157) are stored;
  the live transfer itself is an agent configuration concern.
- **Inbound calls are not handled.** `/api/webhooks/twilio/voice` returns empty
  TwiML, so Twilio ends an inbound call to the dedicated number. `resolveInbound`
  (numbers/sender.ts) and the `INBOUND_ANSWER` / `CALLBACK` entry points exist
  for a later phase.

### Call states (`state-machine.ts`)

`REQUESTED -> ELIGIBILITY_CHECKED -> QUEUED -> DIALLING -> RINGING -> ANSWERED
-> IN_CONVERSATION -> WRAPPING_UP -> (TRANSFERRED) -> ENDED | NO_ANSWER | BUSY |
VOICEMAIL | FAILED -> POST_PROCESSING -> COMPLETE`, plus `CANCELLED` from any
pre-dial state. `applyObservedState` ignores a stale or repeated observation
instead of regressing the call, so out-of-order and duplicate provider events
are safe.

---

## 3. Eligibility

Two gates, both pure, both run on **every** initiation path (manual request,
MCP, API, the retry job) and again inside `voice.dial` immediately before
dialling. `decideDial` (`dial-decision.ts`) runs them in this order, cheapest
and most absolute first:

1. **Still diallable.** A call past `QUEUED` is never dialled again (`SKIP`).
2. **Entitlement** (`entitlement.ts` `assertVoiceAllowed`), in precedence order:
   `KILL_SWITCH_PLATFORM` (`VOICE_CALLS_DISABLED`), `KILL_SWITCH_WORKSPACE`
   (`voice_settings.admin_kill_switch`), `TRIAL_ACCOUNT`, `DEMO_ACCOUNT`,
   `FREE_ACCOUNT`, `SUBSCRIPTION_INACTIVE`, `CAPABILITY_MISSING`
   (`voice_sales_enabled`), `NO_VOICE_PACKAGE`, `NO_MINUTES`,
   `INSUFFICIENT_MINUTES` (less than a full reservation of 420 seconds),
   `VOICE_DISABLED_IN_SETTINGS`, `IDENTITY_INCOMPLETE`, `NO_NUMBER`. Every
   denial maps to a product state: plan-limit-reached, integration-required, or
   error (a kill switch). A trial, demo or free workspace can never dial,
   whatever plan is being trialled.
3. **The lead** (`policy/channel-policy.ts` `canCallVoice` -> `eligibility.ts`
   `canCallLead`, `callKind: "AI_AUTOMATED"`):
   - stop conditions: anonymised, suppressed (VOICE or ALL), opted out, voice
     opted out;
   - the number: present, valid, a diallable class (UK geographic, UK mobile,
     03 only; premium, 070, 076, 084/087/09/118, freephone and non-UK are
     refused), under the $0.04/min rate cap, and **supplied by the lead**
     (`LEAD_FORM`, `LEAD_MESSAGE`, `INBOUND_CALL`, `MANUAL_BY_LEAD_REQUEST`;
     never `ENRICHMENT` or `IMPORT`, CLAUDE.md rule 6);
   - **PECR consent basis.** An AI call is an automated call (PECR reg 19), so
     it needs `CALL_REQUESTED` (with a capture time, valid 30 days) or
     `FORM_CONSENT_TO_CALL` (with the consent wording on record).
     `PHONE_NUMBER_PROVIDED` alone is refused with
     `CONSENT_INSUFFICIENT_FOR_AUTOMATED_CALL` and the lawful alternatives
     (a human call, or a "may we call you?" text). Consent to be called
     overrides a TPS/CTPS listing; screening binds only a human call on the
     number-provided basis. Withdrawn consent is refused;
   - **calling hours in the recipient's time zone.** Zone from the lead, else
     the number's country (single-zone countries only), else the workspace; if
     none resolves the call is refused (`TIMEZONE_UNRESOLVED`), never guessed.
     Default windows: weekdays 09:00 to 20:00, Saturday 10:00 to 16:00, no
     Sunday, no UK bank holidays (by nation). A workspace may configure within
     08:00 to 21:00 local only. The workspace policy pack's quiet hours, when
     they name VOICE, also apply;
   - **attempt caps:** default 3 in total (settable 1 to 5), 2 in any rolling
     24 hours, at least 120 minutes apart;
   - **one live call per lead** (`CALL_ALREADY_ACTIVE`).

   Outside calling hours, too soon, or a live call is `NOT_NOW` (deferred to
   the next eligible time); everything else is `BLOCKED` (cancelled, state
   permission-denied).
4. **Human take-over.** No AI call while a person has taken the lead over;
   deferred 30 minutes.
5. **Caller id.** The workspace's `ACTIVE` dedicated number. A number that is
   not active or is `RELEASE_SCHEDULED` cancels the call (integration-required).
6. **Route allocation and concurrency.** A disabled route or an exhausted
   route share of the period's minutes cancels (plan-limit-reached). A full
   concurrency slot (workspace default 2, platform default 20) defers one minute.

Every decision is written to `voice_call_eligibility` with the denials, the
consent basis and evidence wording, TPS/CTPS flags, the recipient time zone
and `policy_version`.

### Double dial is impossible

Only the transition `QUEUED -> DIALLING` grants the right to call the
provider, and it is granted once. With 0157 applied it is the
`voice_call_begin_dial` RPC: it takes the per-lead advisory lock
(`advisoryLockId(voiceLeadLockKey(...))`) and a per-workspace lock, re-checks
human take-over, another live call to the lead and both concurrency limits,
then moves the row. A second run of `voice.dial` for the same call finds it no
longer `QUEUED` and returns `NOT_QUEUED`. The call key
(`voice:call:<business>:<lead>:<route>:<attempt>`) makes `requestCall`
idempotent: a repeated request returns the existing call.

---

## 4. Minutes

Voice is prepaid only. `budget.ts` computes every delta; `minutes-core.ts`
applies it through `MinuteStore.apply`, a compare-and-swap on the balance
(the 0157 `voice_minutes_apply` RPC, balance row locked). On `CONFLICT` the step
re-reads and recomputes (up to 5 times, then `CONTENDED`).

- **Reserve** before the dial: the call budget (300 s) plus the maximum
  extension (2 x 60 s) = **420 seconds**, drawn from **included minutes first,
  then packs**. A balance that cannot cover the full reservation refuses the
  call (`INSUFFICIENT_MINUTES`). There is **no overage**: neither bucket may go
  below zero, in the RPC and in the table CHECKs.
- **Settle** after an answered call, **to the second** (`PER_SECOND`), returning
  the unused part of the hold to the buckets it came from.
- **Release** the whole hold for a call that never connected, was cancelled or
  failed.
- **Ledger.** `voice_minute_ledger` is append-only (a trigger refuses UPDATE
  and DELETE). Every row carries an idempotency key
  (`voice:reserve:<call>`, `voice:pack:<stripe session>`,
  `voice:period:<start>:<seconds>`, ...), so a retried job never moves minutes
  twice. Kinds: `RESERVE`, `SETTLE`, `RELEASE`, `PERIOD_GRANT`,
  `PERIOD_EXPIRE`, `PACK_PURCHASE`, `PACK_REFUND`, `ADJUSTMENT`.
- **Packs** (`creditPackMinutes`) add pack seconds that never expire, credited
  by the Stripe webhook once the Checkout session is paid.
- **Included minutes** (`grantIncludedPeriod`, the Pro voice item's 200 a
  month) **set** the included bucket to the allowance each period, so unused
  included minutes do not roll over.
- **Alerts.** A settlement that newly crosses **75%, 90% or 100%** of the
  period's minutes queues one in-app billing notification (the allowance-alerts
  threshold rule), linking to Billing. At 100% the copy says calls are paused
  until a pack is bought and nothing more is charged.

`voice_minute_reservations` is server-only; balances and the ledger are
member-read.

---

## 5. Cost ledger

`cost.ts` writes ClientTurn's own provider cost of each call to the
server-only, append-only `voice_cost_ledger` (USD; GBP derived at the
economics rate 0.7549):

1. The provider's figure when known (Retell `call_cost.combined_cost`, cents),
   `estimated = false`.
2. Otherwise an estimate: the destination rate from `DEFAULT_RATE_TABLE_USD`
   (Elastic SIP), plus the voice engine at $0.0828/min (Retell $0.055 + TTS
   $0.015 + LLM $0.0128), plus recording at $0.0025/min when on,
   `estimated = true`.

A later correction is a new row, never an UPDATE. Cost is shown only to an
owner or admin (on the call card) and in admin economics; `voice.calls_list`
does not even read it for other roles.

---

## 6. Webhooks

Every voice webhook follows CLAUDE.md: **verify -> `webhook_events` row -> ack
fast -> queue**. No provider I/O on the request path. All three routes are
rate limited (`webhook:inbound`).

| Route | Verification | Dedupe key |
|---|---|---|
| `POST /api/webhooks/retell` | `X-Retell-Signature` `v=<ms>,d=<hex>`, HMAC-SHA256 of raw body + timestamp keyed by `RETELL_SECRET_KEY`, 5-minute tolerance. Format verified against Retell's docs, not yet live-tested with a real webhook. No key configured: 503, never waved through. | `call_id:event` |
| `POST /api/webhooks/twilio/voice` | `X-Twilio-Signature` over the exact public URL (`VOICE_WEBHOOK_BASE_URL` + path). Parent auth token first, then a sealed subaccount token from `telephony_accounts` if one is stored. | `CallSid:CallStatus` |
| `POST /api/webhooks/twilio/regulatory` | As above. Only `BUNDLE_STATUS_CHANGED` events are accepted. | `BundleSid:Status` |

`webhook-inbox.ts` `storeVoiceEvents` writes one `webhook_events` row per
normalised `VoiceEvent`, `provider` = `retell` or `twilio_voice`,
`external_event_id` = `VoiceEvent.dedupeKey`. A unique violation (a provider
retry) is counted as a duplicate and acknowledged; a failed insert returns 5xx
so the provider retries. Each stored row enqueues `voice.webhook_ingest`.

The ingest job re-parses the stored events with `voiceEventSchema`, applies
them, and marks the row `processed` or `failed` with `last_error`. Rows are
never deleted.

**Replay.** A failed row can be replayed by enqueueing `voice.webhook_ingest`
with `{ provider, externalEventId }` again; the reduction is idempotent and
`voice_call_events` is deduped on `(provider, dedupe_key)`. The admin
**webhook.replay** job re-queues `retell` and `twilio_voice` events through
`voice.webhook_ingest` (P3), and Voice ops has its own Retry.

---

## 7. Jobs

Registered in `lib/jobs/register.ts`, drained by the 24/7 worker
([CRON.md](CRON.md)). Payloads are Zod-validated; a malformed payload is a
`PermanentJobError`. Every handler re-reads state and is idempotent.

| Job | Payload | Does |
|---|---|---|
| `voice.dial` | `{ callId }` | The only path to the provider. Decide, reserve, begin dial, dial once. |
| `voice.webhook_ingest` | `{ provider, externalEventId }` | Apply a stored provider event to its call or number. |
| `voice.post_call` | `{ callId, providerSummary?, providerCostCents? }` | Transcript, outcome, objections, QI signals, opt-out, next action, minutes, cost, `COMPLETE`. Throws (and so retries) while the call is still live. |
| `voice.recording_fetch` | `{ callId }` | Copy the recording to R2 at `voice/recordings/<business>/<call>/recording.mp3|wav` with its SHA-256 and retention date. Served only through short-lived signed URLs (300 s). Retries until the recording is ready. |
| `voice.retry` | `{ callId }` | Plan the next attempt (a fresh `requestCall`), the text fallback, or stop. |
| `voice.number_provision` | `{ businessId }` | One provisioning step, re-scheduled until the number settles. |
| `voice.number_release` | `{ businessId, releaseAfter? }` | Schedule and drive a release. |

Retry spacing (`retry-policy.ts`): busy 20 minutes, no answer 2 hours,
voicemail 24 hours, transient failure 30 minutes (once), later attempts at
least the next day, each moved into the recipient's calling hours. A voice
opt-out stops retries.

---

## 8. Number provisioning and the dedicated SMS sender

One Twilio **subaccount** per workspace (isolation, reputation, cost
attribution), driven by `numbers/provisioning.ts`, one provider step per job
run:

```
NOT_REQUESTED -> DETAILS_REQUIRED -> SUBACCOUNT_CREATED -> BUNDLE_SUBMITTED
  -> BUNDLE_IN_REVIEW -> BUNDLE_APPROVED | BUNDLE_REJECTED(reason, fixable)
BUNDLE_APPROVED -> NUMBER_SEARCHING -> NUMBER_PURCHASED -> CONFIGURED -> ACTIVE
ACTIVE -> RELEASE_SCHEDULED -> RELEASED -> QUARANTINED -> NOT_REQUESTED
```

- The only human input is the workspace's own details, given once
  (`number_provisioning_details`): the OD-1 identity plus what Twilio's GB
  mobile regulation asks of a business end user (Companies House number,
  website, business address, an authorised representative with phone and work
  email). Business classification defaults to `DIRECT_CUSTOMER`. With
  `COMPANIES_HOUSE_API_KEY` set, `voice.settings_get` (with
  `lookupCompaniesHouse`) prefills the legal name, company number and
  registered office from the workspace's own Companies House record
  (`ownCompanyRegistration` in `find-leads/server/providers/companies-house.ts`);
  without the key the prefill is simply absent.
- Every step is idempotent: subaccount and Messaging Service found by name
  before creation, an already-bought number adopted, "already gone" on release
  treated as done, a rejected bundle resubmitted only when the details'
  fingerprint changed. Known gap: a crash between bundle creation and saving
  its SID can leave a draft bundle at Twilio.
- Bundle status arrives on `/api/webhooks/twilio/regulatory` and is also polled.
  `provisionally-approved` is treated as still in review.
- On `ACTIVE` the owner is notified ("Your calling number is ready"); on a
  stall or rejection, "Your calling number needs attention" with Twilio's
  reason.
- Release keeps the number until `releaseAfter`, cancels queued calls, and then
  quarantines the E.164 for 90 days: inbound calls and texts to it resolve to no
  workspace and it cannot be picked again, so a former tenant's leads never
  reach a new one.

**Dedicated SMS sender** (`messaging/sms-sender.ts`, `voice/sender-context.ts`,
used by `messaging/twilio.ts`): a workspace whose number is `ACTIVE` or
`RELEASE_SCHEDULED`, and whose subaccount is known, sends SMS through its own
Messaging Service under `/Accounts/{sub}/Messages.json` (parent credentials),
so replies land on the number the AI calls from. Every other workspace, or any
read failure, uses the platform sender exactly as before
(`TWILIO_SMS_FROM` or `TWILIO_MESSAGING_SERVICE_SID`). A message is never sent
to a Messaging Service under the wrong account.

---

## 9. Service operations

Declared in `services/registry.ts` (domain `voice`), handled in
`services/operations/voice.ts`. The runtime checks role, scope, caller and
confirmation; the handlers enforce section-level RBAC, the OD-1 identity and
the entitlement gate server-side. `AGENT` is a caller of `voice.request_call`
only, and only for a background agent with "Phone leads with AI" on (§9a).

| Operation | Risk | Minimum role | Callers | Notes |
|---|---|---|---|---|
| `voice.settings_get` | READ | viewer | UI, COPILOT, MCP, API | Settings, number, minutes, entitlement, integration status. Representative phone and email are masked for non-admins; missing env names only shown to admins. |
| `voice.settings_update` | REVERSIBLE_WRITE | admin | UI, MCP, API | Identity, agent suffix, hours, routes, transfer, voicemail, recording, regulatory details. Voice cannot be enabled until the identity is complete (also a DB CHECK). |
| `voice.number_request` | REVERSIBLE_WRITE | admin | UI | Starts provisioning. Refused in a trial and without the number item or Pro voice item. |
| `voice.number_status` | READ | member | UI, COPILOT, MCP, API | Stage, timeline, rejection reason. |
| `voice.number_release` | DESTRUCTIVE | owner | UI | Requires typing the number. Cancels queued calls. |
| `voice.request_call` | EXTERNAL | member | UI, MCP, API, AUTOMATION, AGENT | Places a real call and spends minutes, so a person confirms it (an agent's standing confirmation is its admin-set switch, §9a). `recordCallRequest` (a team member recording that the lead asked to be called) is UI only. `agentId` is required from, and only accepted from, caller AGENT. |
| `voice.cancel_call` | REVERSIBLE_WRITE | member | UI, MCP, API | Only before the call starts. Releases held minutes. |
| `voice.calls_list` | READ | viewer | UI, COPILOT, MCP, API | Call cards; cost only for owner/admin. |
| `voice.call_get` | READ | viewer | UI, COPILOT, MCP, API | One call with transcript and a signed recording URL. |
| `voice.admin_disable_workspace` | REVERSIBLE_WRITE | admin | SYSTEM | The per-workspace kill switch, called by the admin shell after platform-admin check and step-up. Cancels queued calls. |

### 9a. Calls from agents ("Phone leads with AI", 0176)

Owner feedback 2026-09-28: calling should be automatic from agents and manual
from the Leads drawer. Both use the one calling path above.

- **Manual.** The Leads drawer's call control is a split: "Call yourself"
  (`tel:`) and "Call with AI" (on narrow screens, in More). It opens the same
  `CallWithAiDialog` and server action as the lead page, and its disabled
  reason comes from the same `callDisabledReason` (`voice/call-button-state.ts`).
  A viewer, or a drawer whose voice state could not be read, never gets an
  enabled button.
- **Automatic.** `agents.voice_calls_enabled` (off by default) and
  `agents.voice_daily_call_cap` (default 20, 1..100). Offered in the new-agent
  wizard and the agent's Settings tab only when `assertVoiceAllowed` passes and
  calling is connected; otherwise shown disabled with the reason and, for
  admins, the link to Settings, Voice (or to plans when locked). Closing agents
  call stalled qualified leads on `BOOKING_CLOSE` or `DIRECT_CLOSE` (by the
  goal not reached); combined agents also call new leads (7 days, PENDING or
  REVIEW) on `QUALIFICATION`. Sourcing and re-engagement agents never phone.
- **The tick** (`agents/voice-calls.ts` `runAgentVoiceCalls`, wired in the
  scheduler BEFORE the agent's own work). On **Run automatically** (AUTO) it
  asks `voice.request_call` as caller AGENT with `{ leadId, route, agentId }`,
  `confirmationSource: standing_permission`, idempotency key
  `agent-voice:<agent>:<lead>:<route>`. It skips leads with a call queued or
  live, leads with a call waiting for approval, and leads already called on
  that route (retries belong to `planCallRetry` and the configured attempts).
  It stops for maintenance, unusable voice, the "Phone leads" permission off,
  or the daily cap (open approvals count toward it).
- **Approval levels (owner decision 2026-09-28).** Any other level
  (**Review everything**, **Review new companies only**) never dials: each
  call becomes the agent queue's existing review item (`item_type REVIEW`,
  `subject_type LEAD`, status BLOCKED, shown under "Waiting for you" with
  **Approve call** / **Decline**). `agent.decide_call` (EXTERNAL, member, UI
  only, capability `send_outbound`) claims the item conditionally, works out
  the route from where the lead is now (`routeForApproval`: not qualified ->
  QUALIFICATION; qualified -> the unmet goal's close route; goal reached or
  disqualified -> not called), then runs `voice.request_call` as caller
  AGENT (`userId: null`, `confirmationSource: person`, idempotency key
  `agent-call-approval:<item>`), so every agent and calling check applies and
  it is never `personRequested`. Declining cancels the item.
- **No double contact (owner decision 2026-09-28).** The call is the touch:
  the leads a run's call covers (asked for, already queued or live, or
  waiting for approval; `touchedLeadIds`) get no text nudge from that run's
  closing tick (`runBookingTick(agent, calledLeadIds)` via
  `leadsForFollowUp`). A cancelled, refused or declined call leaves the lead
  to follow-up on the next run.
- **The handler** refuses an AGENT caller unless the named agent is ACTIVE,
  has the option on, makes that route, is under its daily cap (counted from
  `voice_calls.requested_by_agent_id` since UTC midnight) and the workspace's
  "What the AI may do -> Phone leads" is on (`agentCallRefusal`). Then
  `requestCall` runs exactly as for the button; an agent is never a person,
  so it keeps the human-takeover hold.
- **Permission is never widened implicitly.** `agent.set_voice_calls`
  (FINANCIAL, admin, not AGENT) never touches `commercial_authority`. When
  "Phone leads" is off the agent screens say it will not call yet and offer
  `ai_settings.allow_calls` (UI only, admin), which sets only `call` and writes
  `commercial_authority.ai_updated` with the before and after.
- **Surfaces.** The call card shows "Called by <agent>"; the agents list and
  Overview show on/off and the calls asked for in 7 days; every request and
  refusal is on the agent's Activity timeline.
- Tests: `tests/agent-voice-calls.test.ts`.

Billing (outside the service layer): `billing/voice-actions.ts` (owner-only
server actions: buy a pack, add the number item), `voice-purchase.ts`
(Stripe-injected core), `voice-checkout.ts`, `voice-webhook.ts` (credits a
paid pack), `voice-subscription-sync.ts` (mirrors the Pro voice item and the
number item into `business_entitlement_grants` and grants the period's
included minutes), `subscription-items.ts` (`selectPlanItem`: the plan item is
never assumed to be `items.data[0]`). Prices live only in `billing/plans.ts`:
packs 100/250/500/1000 minutes at £49/£115/£225/£449, number £11.99/month,
Pro voice item £100/month with 200 included minutes and the number, no
annual discount on the item, never purchasable in a trial.

**UI surfaces.** Being built in parallel with this document: the
**Settings → Voice** section (`app/(app)/app/settings/_sections/voice-section.tsx`,
`components/settings/voice/*`, `lib/voice/settings-ui.ts`, `ui-queries.ts`,
`actions.ts`) and the lead page's voice card with **Call with AI** and the call
timeline (`components/voice/*`). Check those files for their current state
rather than this paragraph. P3: the monthly Pro checkout adds the voice item by
default and it can be removed (§16.11 a).

---

## 10. Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `RETELL_SECRET_KEY` | Any call; Retell webhook verification | The server-only secret key (`RETELL_API_KEY` is accepted as an alias). The same key verifies `X-Retell-Signature`. `RETELL_PUBLIC_KEY` is for browser web calls only and the server never reads it. Absent: every voice path is integration-required, the Retell webhook returns 503. |
| `RETELL_AGENT_ID` | Any call | Platform default agent; `voice_settings.provider_agent_id` overrides per workspace. |
| `VOICE_WEBHOOK_BASE_URL` | Number provisioning; Twilio signature checks | Public `https` origin (never localhost). Falls back to `NEXT_PUBLIC_SITE_URL`. Twilio signs the exact URL, so this must match what Twilio posts to. |
| `VOICE_CALLS_DISABLED` | Platform kill switch | `1`/`true`/`yes` stops every AI call on every workspace. |
| `COMPANIES_HOUSE_API_KEY` | Regulatory prefill (optional) | Prefills legal name, company number and registered office for the number review. Set. |
| `VOICE_BUNDLE_NOTIFICATION_EMAIL` | Bundle submission | Where Twilio emails bundle status; falls back to the workspace's notification or representative email. |
| `TWILIO_ACCOUNT_SID` | Numbers, SMS | Must be the parent `AC...` SID, not an `SK...` API key. |
| `TWILIO_AUTH_TOKEN` | Numbers, Twilio signatures | Parent account auth token. |
| `TWILIO_SMS_FROM` / `TWILIO_MESSAGING_SERVICE_SID` | Platform SMS sender | Unchanged; used whenever there is no active dedicated number. |
| `STRIPE_PRICE_VOICE_ADDON_MONTHLY` | Pro voice item | £100/month recurring, TEST. |
| `STRIPE_PRICE_VOICE_NUMBER_MONTHLY` | Number item | £11.99/month recurring, TEST. |
| `STRIPE_PRICE_VOICE_PACK_100` / `_250` / `_500` / `_1000` | Minute packs | One-off, TEST. A missing id refuses that purchase as integration-required. |

---

## 11. UNVERIFIED provider items

Collected from the `UNVERIFIED` notes in the voice code. Each must be checked
against the live provider before the first live call.

**Retell**

1. The shape of `call_cost` (assumed `combined_cost` in US cents). Wrong shape
   means the cost ledger silently falls back to the estimate.
   (`cost.ts`, `retell-protocol.ts`)
2. `call_analysis.call_summary` and `call_successful` field names, and the
   `transcript_object[].words[]` timing shape. (`retell-protocol.ts`)
3. No documented REST endpoint ends a live Retell call. `endCall` throws
   `UNVERIFIED_ENDPOINT`; the backstop is the Twilio carrier leg
   (`Calls/{Sid}` Status=completed). (`retell.ts`)
4. `PATCH /update-agent/{agent_id}` as the agent update path (believed from SDK
   naming). (`retell.ts`)
5. ~~The `voicemail_option` shape~~ verified 2026-09-27: `{ action: { type:
   "static_text", text } | { type: "hangup" } }`, per call through
   `agent_override.agent` (§16.6).
6. Webhook signature (`X-Retell-Signature`, `v={ts},d=HMAC-SHA256(body+ts)`
   keyed by `RETELL_SECRET_KEY`, 5-minute tolerance): verified against the
   docs, not live-tested with a real webhook. (`retell-protocol.ts`)
7. Recording URL access: `recording_fetch` downloads `recording_url` with a
   plain unauthenticated GET, assuming a short-lived public URL.
   (`server-deps.ts`)

**Twilio**

8. Webhook signing for resources in a **subaccount**: believed to be the
   subaccount's own auth token, not verified against a live subaccount. Only
   tried when a sealed token is stored. (`twilio-protocol.ts`, `webhook-inbox.ts`)
9. How an Address is attached to a regulatory bundle (here, a supporting
   document of type `business_address` with `address_sids`). (`twilio-voice.ts`)
10. The GB mobile End User `Attributes` key names (snake_case assumed).
   (`twilio-voice.ts`)
11. Whether the v2 Regulatory and v1 Messaging hosts accept parent credentials
    for a subaccount (the subaccount token is used). (`twilio-voice.ts`)
12. Whether `provisionally-approved` allows a GB number purchase; treated as
    still in review, so we wait for `twilio-approved`. (`provisioning.ts`)
13. The business-classification value an ISV should give for customers'
    numbers (default `DIRECT_CUSTOMER`). (`provisioning-details.ts`)
14. The Pricing v2 response shape used by `lookupRatePerMinuteUsd`
    (`{ outbound_call_prices: [{ current_price }] }`). Not called at dial time
    in P2; the cap uses the static rate table. (`twilio-voice.ts`)
15. Error 21712 as "number already in this Messaging Service" (treated as an
    idempotent success). (`twilio-voice.ts`)
16. A find-by-friendly-name filter for bundles (would close the draft-bundle
    crash gap). (`provisioning.ts`)
17. Typical UK bundle review time (not published).
18. Which UK prefixes Twilio prices as Special Services, Surcharged or Mobile
    Other, and its route for 03 numbers. Mitigated by the rate cap.
    (`destinations.ts`)

**Retell and Twilio together**

19. **The SIP leg mapping.** How the Twilio number is connected to Retell
    (imported into Retell over an Elastic SIP trunk, or VoiceUrl TwiML dialling
    Retell's SIP endpoint) is not built. Consequence today: nothing writes
    `voice_calls.carrier_call_sid`, so a Twilio status callback for a
    Retell-placed call cannot be matched to its call and is recorded as
    unmatched. P3: the carrier id is recorded from Retell's telephony
    identifier (UNVERIFIED field) or by the number-pair match (§16.11 c); the
    SIP trunk itself is still owner configuration.
20. **Inbound call handling is built (§14) but not yet switched on in
    production** (2026-09-28): `RETELL_SIP_DOMAIN` is unset, so an inbound
    call gets the transfer or the message and text back, never the AI. Turning
    it on is step 5a of the go-live checklist. (This item used to say inbound
    was not built; that was superseded by §14.)

---

## 12. Migrations

- **`0162_voice_agent_tools.sql` is written and NOT applied** (§16.13).
- **0150, 0151 and 0157 are applied.** 0157 adds `voice_minutes_apply` (the minute compare-and-swap RPC; `authenticated` cannot execute it), `voice_call_begin_dial` (the locked `QUEUED -> DIALLING` transition), `voice_settings.transfer_mode` and `VOICE` in the `suppression_entries` channel CHECK.
- **`0159_voice_return_call_route.sql` is applied** (2026-09-28). Previously: It widens the route CHECKs on `voice_calls`, `voice_minute_ledger` and `voice_minute_reservations` to admit `RETURN_CALL` (inbound return calls, §14). Until it is applied, creating a RETURN_CALL call row is refused by the CHECK and `answerRetellInbound` returns no agent, so an inbound caller gets the polite message and text back (or a transfer); the AI never answers without a call row.

Apply with the Supabase MCP or CLI against project `losieaikadkadtmezini`, then regenerate `database.types.ts`.

## 14. Inbound return calls (§25)

A call TO the workspace's dedicated number is answered by one decision (`voice/inbound.ts` `decideInbound`, orchestrated by `voice/inbound-core.ts`, tested in `tests/voice-inbound.test.ts`):

| Caller | Workspace entitled, AI connected | Otherwise |
|---|---|---|
| Known lead of the workspace | AI agent on the `RETURN_CALL` route, with the lead's context | Transfer if `transfer_mode` is not NEVER and a transfer number is set, else a short message and a text back |
| Unknown caller | Transfer if allowed, else a short message and a text back (UK mobile callers only) | Same |
| Lead opted out of all contact, suppressed on ALL, or erased | Never the AI, never a text: transfer if allowed, else the short message | Same |
| Released, quarantined or unknown number | "Not in service", never connected to a former tenant | Same |

A calls-only opt-out does not stop the AI answering a call the person chose to make.

Flow, with no provider I/O on either request (CLAUDE.md webhook rule):
1. Twilio posts the inbound call to `/api/webhooks/twilio/voice` (signature verified). The route answers from the database: AI_AGENT becomes `<Dial><Sip>sip:{number}@{RETELL_SIP_DOMAIN}</Sip></Dial>`; TRANSFER is `<Say>` then `<Dial callerId>`; MESSAGE is `<Say>` and hang up, with `voice.text_back` queued (a service reply with STOP, re-checked against SMS suppression, sent from the workspace's own number when ACTIVE).
2. Retell raises its inbound-call webhook at `/api/webhooks/retell/inbound` (signature verified). The same decision runs again on current state; only for AI_AGENT does it create the INBOUND call row (`RETURN_CALL`), reserve the minutes, and return `override_agent_id`, the dynamic variables (the locked inbound greeting, version `od1-inbound.2026-09-28.v1`, which says it is an AI assistant and includes the recording notice when recording is on; the identity answer; the lead's first name) and the call metadata (`voice_call_id`). Anything else returns no agent.
3. From there the call is an ordinary call: Retell's call webhooks, `voice.webhook_ingest`, `voice.post_call` (settle to the second). A missed inbound call is never retried by the AI.

UNVERIFIED for inbound: the Retell SIP domain and whether a `<Dial><Sip>` to it reaches the number imported into Retell; the `call_inbound` payload and response shapes; that an empty answer leaves the call unanswered by any agent. With `RETELL_SIP_DOMAIN` unset, inbound callers never reach the AI.

## 14a. Platform operator controls (0158, applied)

`runtime-core.ts` calls `adminVoiceBlocks()` (admin/voice-ops-model.ts) on every outbound initiation path (`voice.request_call`, `voice.dial`, `voice.retry`), from `readAdminControls()` in server-deps: `voice_settings.admin_outbound_paused`, `admin_spend_limit_gbp_month` against this calendar month's `voice_cost_ledger` in GBP, and `business_numbers.admin_suspended_at`. A block is a typed CANCEL (`ADMIN_OUTBOUND_PAUSED`, `ADMIN_SPEND_LIMIT_REACHED`, `ADMIN_NUMBER_SUSPENDED`); an unreadable control reads as paused. Inbound: a suspended number or the kill switch means the short message only (no AI, no text back, no transfer). Tests: `tests/voice-runtime.test.ts`, `tests/voice-inbound.test.ts`.

Daily jobs (`/api/cron/daily`, docs/CRON.md): `voice.margin_check` (runVoiceMarginCheck) and `experiment.auto_promote` (only experiments whose owner switched auto-promote on, through `experiment.promote` as SYSTEM).

## 15. Billing fixes after the first pass

- **Scheduled downgrade** (`plan-change.ts` `carriedItems`): a schedule phase lists every item it keeps, so the dedicated-number item (and any other non-plan item) now carries into the new plan; only the Pro £100 voice item is dropped when leaving Pro (OD-2), and the owner is told to buy packs and add the number before the change. Packs are prepaid balance and untouched.
- **Refunded voice pack** (`voice/pack-refund.ts`, `billing.refund_reverse` kind `voice_pack`): claws back only the pack's unused minutes (FIFO, the same rule as other top-ups), never below zero or below what has been used; keyed on the PaymentIntent and the cumulative refunded amount.
- **Included minutes end with the Pro voice item** (`expireIncludedMinutes`): when the item is removed, or its scheduled end passes, the included bucket is set to zero with one PERIOD_EXPIRE row; packs are untouched.
- **End trial** picks the plan item by price, not by `items.data[0]` (`end-trial.ts` `trialPlanItem`).

Tests: `tests/voice-billing-gaps.test.ts`.

---

## 16. Phase P3: the call as an execution surface of the sales agent

A call is the same agent as text, on another channel. Nothing about what to
say or do is decided twice: the brief is built from the same strategy
inputs, and every action is a service-registry operation with the same
gates as the text agent's tools.

### 16.1 Architecture decision: Retell-hosted LLM driven by ClientTurn

Vercel serverless cannot hold Retell's custom-LLM websocket for the length
of a call, so the conversation runs on Retell's hosted LLM (`retell-llm`),
and ClientTurn drives it two ways:

1. **The per-call brief as dynamic variables.** One fixed general prompt
   (`voice/tools/definitions.ts` `RETELL_GENERAL_PROMPT`) reads
   `{{call_brief}}`, `{{time_plan}}`, `{{locked_preamble}}` and
   `{{lead_first_name}}`. `voice/call-brief.ts` `buildVoiceCallBrief` builds
   them at dial time (`server-p3.ts` `loadVoiceCallBrief`) from the SAME
   context a text turn assembles (`agent/context.ts` `assembleContext`): the
   lead's current next-best-action (lead_assessments.nba), the goal, what is
   known (never re-asked), the offer card's approved lines, the sales
   library's objection playbooks plus the business's own answers, the
   motion's close (agent/closing.ts), the loop ladder (anti-loop.ts) and the
   pacing rules, adapted for speech. One LLM serves every workspace.
2. **Custom functions** (HTTPS tools) at `/api/voice/tools/<tool>`, verified
   with `X-Retell-Signature` (the webhook helper), each a `voice_agent.*`
   service operation run as caller AGENT.

The begin message is `{{locked_preamble}}`: Retell speaks the OD-1 opener,
never the model. `scripts/retell-setup.mjs` creates or updates the LLM and
the agent (see 16.9).

### 16.2 Retell shapes used (checked against docs.retellai.com, 2026-09-27)

| Shape | What we send or read | Status |
|---|---|---|
| `POST /create-retell-llm`, `PATCH /update-retell-llm/{llm_id}` | `general_prompt`, `begin_message`, `start_speaker: "agent"`, `model`, `model_temperature`, `default_dynamic_variables`, `general_tools` | verified (api-references/create-retell-llm) |
| Custom tool in `general_tools` | `{ type: "custom", name, description, url, method: "POST", parameters (JSON Schema, type object), speak_during_execution, speak_after_execution, execution_message_description, timeout_ms (1,000..600,000), max_retry (0..5) }` | verified |
| Built-in tools | `{ type: "end_call", name }`; `{ type: "transfer_call", name, transfer_destination: { type: "predefined", number: "{{transfer_number}}" }, transfer_option: { type: "cold_transfer", show_transferee_as_caller } }` | verified; dynamic variables in transfer numbers verified (build/dynamic-variables) |
| Custom-function request | `POST <url>` body `{ name, call: { call_id, metadata, ..., transcript }, args }`, header `X-Retell-Signature` | verified. **UNVERIFIED:** that the signature is the webhook's `v=<ms>,d=<hex>` format with the same key (the page says "an HMAC-SHA256 signature of the request body"); a per-invocation tool call id (see 16.4) |
| Custom-function response | any 2xx; body given to the LLM as a string, capped at 15,000 characters | verified |
| Dynamic variables | `{{name}}`; values are strings; `retell_llm_dynamic_variables` on create-phone-call; system `{{session_duration}}` | verified. **UNVERIFIED:** whether `{{session_duration}}` is re-evaluated every turn |
| Per-call agent override | create-phone-call `agent_override.agent.{ max_call_duration_ms, voicemail_option }` | verified (api-references/create-phone-call). `agent_override.retell_llm` does NOT accept the prompt or tools, which is why the brief rides in dynamic variables |
| Voicemail | `voicemail_option: { action: { type: "static_text", text } }` or `{ action: { type: "hangup" } }`; setting it enables detection ("tries to detect in the first 3 minutes") | verified |
| Agent | `response_engine: { type: "retell-llm", llm_id }`, `voice_id`, `language: "en-GB"`, `timezone`, `webhook_url`, `max_call_duration_ms` (60,000..7,200,000), `end_call_after_silence_ms`, `interruption_sensitivity`, `responsiveness`, `enable_backchannel`, `backchannel_words`, `reminder_trigger_ms`, `boosted_keywords`, `post_call_analysis_data`, `data_storage_setting`, `data_storage_retention_days` | verified |
| Lists | `POST /v2/list-agents` (POST, not GET), `GET /v2/list-retell-llms` | verified |
| UK destinations | a number bought from Retell calls only US destinations: UK calls need the imported (SIP) number | verified caveat |
| `call.telephony_identifier.twilio_call_sid` | the carrier id on the call object | **UNVERIFIED** (used when present; the number-pair match is the fallback) |
| Model enum | the setup script defaults to `gpt-4.1-mini` (stack A cost) | **UNVERIFIED** current enum value: check on a live GET |

### 16.3 The call brief (`voice/call-brief.ts`)

`buildVoiceCallBrief(input)` for QUALIFICATION, BOOKING_CLOSE, DIRECT_CLOSE,
NURTURE, REACTIVATION and RETURN_CALL. Sections, in order:

- **Who and why**: persona, the business, the route and goal; the
  deterministic identity answer; the "who built you" answer; never claims to
  be human.
- **First**: "is now a good time" (§17). If not, ask when, `schedule_callback`,
  end, no pitch. A return call starts with "how can I help".
- **The one move**, from the lead's next-best-action (ASK / ANSWER_AND_ASK
  with the NBA's own question and `record_fact`; CTA_BOOK via
  `check_availability` then `book_meeting` at the exact time; CTA_CHECKOUT
  via `send_checkout_link` only when direct close is allowed; ESCALATE,
  DISQUALIFY, WAIT never sell), else the route's default move.
- **Known, never ask again**; the editable opener remainder.
- **Close**: the motion's close wording (agent/closing.ts `closeLine`).
- **Money, times and areas** (resolved conflict 1): only figures, times and
  areas a tool returned in this call, exactly; the list of what the assistant
  may and may not do.
- **How you speak** (§18–19): one or two short sentences, under 35 words, one
  question, no lists, dashes, emoji or links.
- **Hearing** (§20): numbers read back (a digit at a time for phone numbers),
  emails spelt back, one gentle repeat, then offer a text; never guess.
- **Loops** (§21), **honest selling** (§22), **objections** (§23: the route's
  library playbooks, the business's own answers, `log_objection` every time),
  **a person** (§24: per transfer mode, as the last resort), **ending** (the
  fixed closing line, then `end_call_summary`), **stop** (`opt_out` at once,
  no closing line).
- **Earlier conversation**: the text conversation's summary, so the call does
  not repeat it (continuity).

**Bounded.** `CALL_BRIEF_MAX_TOKENS = 1,500` (about 4 characters a token;
raised from 1,100 by the live-call fixes, see 16.16). Optional detail is
dropped in a fixed order (history, the business's answers, the objection
example questions, offer lines down to two, the known list, the enquiry
detail, optional plan questions, the rest of the offer lines, the opener
remainder) and the move, the plan's required questions, the booking-off and
no-claims lines, the money rule and the stop rule are never cut.
`tests/voice-call-brief.test.ts` pins a worst case. The time plan is a
separate variable of about 170 tokens (it now carries the local date and
time).

### 16.4 Tools and endpoints

`POST /api/voice/tools/<tool>` (route-guard class `retell-signature`;
maintenance class WEBHOOK so a live call keeps working in a window). Order
in `voice/tools/core.ts` `runVoiceTool`: tool exists and arguments parse
(Zod), the call exists and is live (or just ended, for `end_call_summary`,
`log_objection` and `opt_out`), idempotency, the deterministic gate, the
work, a JSON answer `{ ok, say, data, code?, time_level, time_instruction,
seconds_left }`.

| Tool | Service operation (caller AGENT) | Gate | Work (reused, not copied) |
|---|---|---|---|
| `record_fact` | `voice_agent.record_fact` (SAFE_WRITE) | AI on | the lead's words through `extractTextSignals` into intent signals; a read-back-confirmed value becomes an AI_ASSIST INFERRED fact (never CONFIRMED); `lead.score` reassessment |
| `check_availability` | `voice_agent.check_availability` (READ) | aiMay(book) | the text agent's `getCalendarAvailability` |
| `book_meeting` | `voice_agent.book_meeting` | aiMay(book); the time must be one `check_availability` returned in THIS call; the call's commercial lease (BOOKING) | the text agent's `createBooking` (re-check, pending row, invite) |
| `calculate_quote` | `voice_agent.calculate_quote` (READ) | `quoteToolGate` (AI on, quote_ai_enabled, create_quote) | catalogue match + `calculateQuoteForLead` -> `quote.calculate`; the spoken figures come from the calculation only |
| `send_quote` | `voice_agent.send_quote` (EXTERNAL, standing permission) | `quoteToolGate` draft + send; the reference must come from `calculate_quote` in THIS call | `draftQuote` -> `quote.create`, approval if the policy says so, `sendQuoteToLead` -> `quote.send`, under the VOICE lease |
| `send_checkout_link` | `voice_agent.send_checkout_link` (EXTERNAL, standing permission) | direct close on, the motion, an approved link, `checkoutGate` (value ceiling), SMS only to a lawful UK mobile; PAYMENT_LINK lease | `trackCheckoutLink` + `proposeCheckout` (queued through the ordinary send path) |
| `send_booking_link` | `voice_agent.send_booking_link` (EXTERNAL, standing permission) | a booking link is configured; SMS only to a lawful UK mobile, email only with an address (voice QA pass) | the text agent's `sendBookingLink` (the configured link appended by the runtime; queued through the ordinary send path) |
| `transfer_to_human` | `voice_agent.transfer_to_human` | aiMay(transfer_human), transfer mode not NEVER, a transfer number; ON_REQUEST only when the lead asked | `requestHumanHandover`; then the model calls Retell's `transfer_call` to `{{transfer_number}}` (empty when not allowed) |
| `schedule_callback` | `voice_agent.schedule_callback` | by AI: CALL_REQUESTED / FORM_CONSENT_TO_CALL AND aiMay(call); by a person: always | by AI: `requestCall` (CALLBACK entry point, every dial gate); by a person: the lead's next action and a notification |
| `opt_out` | `voice_agent.opt_out` | always, whatever else is off | `recordVoiceSuppression` (the number called, or the one they rang from); ALL: `applySuppression` |
| `log_objection` | `voice_agent.log_objection` (SAFE_WRITE) | none | `objection_events` (VOICE, the call id), once per key |
| `end_call_summary` | `voice_agent.end_call_summary` (SAFE_WRITE) | none | stored on the tool row; post-call prefers it over the provider's summary |
| `get_call_status` | none (reads the clock) | none | the time governor's level for this moment |

**Idempotency.** `voice_tool_calls` (0162) is unique on (call, tool call id);
a retry returns the stored answer, the same id with different arguments is
409. The tool call id is Retell's when it sends one (a top-level
`tool_call_id`, or the last `tool_call_invocation` in
`call.transcript_with_tool_calls`), else a hash of the call, tool and
arguments (UNVERIFIED which Retell sends; the hash is the safe reading).

**One actor per lead.** The commercial tools claim the lead's lease as
`VOICE` keyed by the call (`commercial/locks.ts`, 0160); the text agent's
quote tools now accept a `holder` on their ToolContext for this, so a call
and a text turn never act on the lead at once.

**Not a webhook.** Retell waits for the answer. Tools do database work and,
for availability, a calendar read; anything that contacts the lead (a quote
email, a checkout text) is queued through the ordinary send path, never
sent inline.

### 16.5 Time governor in the call (§15)

Retell has no mid-call timing feature (checked 2026-09-27). Three layers:

1. **The plan**: `{{time_plan}}` states the route's target, TIME_AMBER and
   TIME_RED points (time-governor.ts) and reads `{{session_duration}}`.
2. **Every tool answer** carries `time_level`, `time_instruction` and
   `seconds_left`, computed server-side from the call's `answered_at`, so the
   level is authoritative even if the variable is not refreshed.
   `get_call_status` gives it without acting.
3. **The ceiling**: `agent_override.agent.max_call_duration_ms` =
   `PROVIDER_MAX_DURATION_SEC` (420 s: budget plus both extensions), inside
   the 420-second minute reservation, so a call can never overdraw.

A server-side push (`PATCH /v2/update-live-call`) could inject TIME_RED
mid-call; it is not used (it needs a scheduler holding every live call).

### 16.6 Voicemail (§26)

Decided at dial time (`runtime-core.ts` `planVoicemail`), because Retell
leaves the message itself: the fixed, versioned script
(`retry-policy.ts` `renderVoicemailScript`, `vm.2026-09-27.v1`) only when
voicemail is on, the consent basis is CALL_REQUESTED or
FORM_CONSENT_TO_CALL, and none was left for this request (lead and route).
Otherwise `hangup`. The plan is recorded (`voice_calls.voicemail_script_version`);
when the call ends VOICEMAIL, post-call marks `voicemail_left`, so the next
attempt hangs up. The AMD outcome feeds the retry policy (24-hour spacing).

### 16.7 The closing line (owner decision 2026-09-28, amends OD-1)

Every call ends, as it wraps up, with the fixed line
"Thanks for your time. You've been speaking with {calling_as_name}'s AI
assistant, powered by ClientTurn." (`opener.ts` `CLOSING_TEMPLATE`,
`CLOSING_VERSION = close.2026-09-28.v1`). Attribution, never a pitch. Not
spoken after an opt-out or on a dropped call. Removed only with the white
label capability (`white_label_public_pages`, "White label (public pages
and call attribution)", off by default), which leaves "Thanks for your
time." The opener is unchanged and owner-approved (no lawyer dependency).
Post-call stores `voice_call_outcomes.attribution_spoken` (from the agent's
transcript, never the model's say-so) and `closing_version` (0162).

### 16.8 Channel orchestration (§71)

`voice/channel-orchestration.ts` `decideNextChannel`: ONE move per decision
point. Rules V0–V6 are in the file header; golden cases in
`tests/voice-orchestration.test.ts`. In short:

- Never a call to a lead who did not request or consent (CALL_REQUESTED,
  FORM_CONSENT_TO_CALL, or the lead's own written request in V1, recorded as
  CALL_REQUESTED with the message as evidence).
- An AI-initiated call needs the owner's "Phone leads" permission
  (aiMay call). A person pressing Call with AI, a retry of that request, and
  a call the lead makes back are not AI-initiated.
- CALL_REQUESTED + HIGH / BOOKING_READY / PURCHASE_READY -> call within four
  hours of calling time; preference "phone" + consent + MEDIUM -> call.
- The lead asks for a call on WhatsApp / SMS / email with a buying signal or
  MEDIUM+ intent -> the text reply is one fixed line and the AI calls
  (`voice/text-to-call.ts`, hooked into the orchestrator before the turn is
  composed); otherwise the text turn offers bookable call times as before.
- No answer -> ONE text now through the ordinary send path (SMS to a UK
  mobile, then WhatsApp on the next miss when its window is open, then
  email), while the retry call stays scheduled at the best time.
- Automated touches respect the frequency guard (reengagement/frequency.ts);
  the lead's own request is a response and is not held by it.
- Cost orders text channels only when nothing else decides; a new or hot
  lead gets the fastest channel.

Wired in: `planCallRetry` (missed calls), the orchestrator (text to call).
The follow-up engine's own step channel choice is unchanged.

### 16.9 Post-call continuity

The call is one more turn of the same conversation. The lead's words go
through the QI extractors (signals, reassessment, so the next text turn's NBA
and known facts include the call); the next action is set (with the step
agreed on the call); and a dated note, the agreed step and the objections are
merged into the lead's opportunity memory (`voice/continuity.ts`), which the
text agent renders into its context. The memory's own refresh keeps them.

### 16.10 Platform maintenance

`voice.dial` and `requestCall` read `outboundPauseUntil()`: during
APP_OFFLINE / SITE_OFFLINE without "keep automated follow-up running", a dial
is re-scheduled for the end of the window (never dropped) and a new request
reports `MAINTENANCE_WINDOW`. READ_ONLY does not pause calls. Inbound return
calls are still answered. An unreadable state holds nothing (fail open, as
the proxy gate).

### 16.11 P2 gaps closed

- **(a) OD-2 checkout**: monthly Pro checkout carries the £100 voice item by
  default, with "Include the AI voice agent" on the plan picker (untick for
  Pro without voice, £399); an upgrade to monthly Pro adds it once; annual Pro
  does not bundle it (the item has no annual price, and mixing a yearly and
  a monthly price in one Checkout subscription is UNVERIFIED for this
  account). "Remove voice" (owner, Settings -> Voice -> Budget) deletes only
  the item, prorated, keeps the number to the period end unless the £11.99
  number item is held. `billing/voice-line-items.ts`, tested without Stripe.
- **(b)** The subaccount's auth token is fetched from Twilio when the
  subaccount is created (and back-filled once for older ones) and stored
  sealed (`security/secret-box.ts`) in `telephony_accounts.auth_token_ciphertext`;
  `verifyTwilioVoiceRequest` already tries it.
- **(c)** The carrier call id is recorded: from Retell's telephony identifier
  when present, else by matching a Twilio callback's number pair to the one
  live call between them (0162 `carrier_call_sid_source`).
- **(d)** Admin replay: the generic `webhook.replay` job now re-queues
  `retell` and `twilio_voice` events through `voice.webhook_ingest` (the Voice
  ops "Retry" button already did).
- **(e)** Voicemail delivery (16.6).

### 16.12 Call QA simulation (§62)

`tests/voice-call-qa.test.ts` with `tests/fixtures/voice-call-qa/`: 20
scripted calls (a scripted prospect with ASR noise, background noise,
interruptions and speaking rate; a scripted agent that follows the brief's
one move and acts only through `runVoiceTool`). Scored out of 100:
naturalness proxies 25, loops 15, route 10, commercial action 20 (the
expected tools ran, forbidden ones did not, every spoken figure came from a
tool), duration 15, tools 5, disposition and closing line 10. Zero cost. Set
`VOICE_QA_REPORT=1` for the table. The scripted agent proves the brief
carries what a model needs; it is not a measure of a live model, which the
owner's first test calls are.

**Voice QA pass (2026-09-28): 46 scenarios, all 100/100.** Added: ASR and
dialect variants ("stop colin me", "take me of ya list", "aye the second
one's grand"), several objections in one call, the same objection twice, a
gatekeeper, a train with a bad line, a privacy question, the price asked
first, a quote for two services, a lead who says yes to everything (the time
is still read back before booking), silence, hostility, a complaint with and
without transfer, a call-back at a bad time, voicemail and a phone menu, a
language barrier, "just email me" with and without a booking link. The
scripted agent now hears with `speech-intents.ts` (the same table the
Retell prompt is rendered from), and the scorer also fails a turn of more
than two sentences and any **dead air**: a tool after which the agent did not
speak before the lead did.

**Adversarial QA pass (2026-09-28, second): 94 scenarios (46 before), all
100/100 under a stricter scorer; 162 detection rows (90 before).** A suite
that scored itself 100 was suspect, and it was: the simulator carried its own
fallback regexes for opt-outs and "a person", so a scenario passed when
`speech-intents.ts` missed the phrase. Those fallbacks are gone; the scripted
agent now hears only through the product table.

What the table missed, now caught (each with a scenario or a row): "you're
alright mate", "we're sorted", "I already told you no"; "take me off your
MAILING list", "opt me out", "don't ring me" (no "again": the old pattern
needed a suffix), "never ring this number again", "leave me alone", "f off" /
"piss off" (now an opt-out, not a question: a swear-off hung up on was rung
again), "I'm on the TPS"; "she doesn't work here any more", "I never gave you
my number"; "I want to speak to your manager"; "is this a scam", "what's
this about"; voicemail variants ("you've reached Dave, I can't take your
call", "switched off", "menu options have changed"); "I'm on another call",
"call back in ten minutes", "I'm busy", "drivin".

False positives fixed (negative scenarios): "not interested in the blue one,
the red one"; "stop calling it a website"; "don't call me before ten" / "sir";
"remove me from the invite"; "wrong number? no, the right number"; a complaint
about their CURRENT agency (was a transfer); "our site is crap" and "it's
ridiculous how slow our site is" (were ANGRY); "I'm driving the project"; "is
this a real person" no longer also logs a TRUST objection. post-call.ts's
private opt-out regex (which recorded "stop calling it a website" and "take
me off speaker") is removed: opt-outs come only from the table.

New intents in the playbook (and the general prompt): **CALL_SCREEN** (Google
Call Screen, iOS "record your name": one sentence saying who and why, never a
voicemail pitch; a person picking up hears the AI disclosure and recording
notice again), **VULNERABLE** (a child, a carer, dementia, illness, a
bereavement: stop selling, ask and note nothing, WRONG_PERSON for a person to
review; post-call too), **DATA_REQUEST** (a subject access request: never
refused, a colleague sends a copy), **LINE_CHECK** ("hello, are you there"),
**PRICE_QUESTION** (a price, date, area or guarantee: only a tool, an approved
offer line, or a colleague). LANGUAGE_BARRIER now says English only, and
skips the slow-down step when they speak no English at all.

Other product changes: the brief carries a **RECORDING** line with the locked
answer (`opener.ts` RECORDING_ANSWER_ON / _OFF, `recordingEnabled` from
`voice_calls.recording_enabled`), replacing "the call may be recorded", which
was vague and wrong when recording is off (`brief.2026-09-28.v3`). Slot
labels are spoken, not screen text: `spoken-time.ts`, used by the
availability and booking tools ("Wednesday 30 September at 10am or 2pm", not
"Wed 30 Sep, 10:00am or Wed 30 Sep, 2:00pm"). Conversion: the default
qualification move is one question; NURTURE and REACTIVATION always leave a
next step (a short call, or an agreed check-in time); "I'll have a think" is a
NOT_NOW stall that gets a follow-up time instead of ending with none; the
objection acknowledgement is said once.

**Stricter scoring.** Consecutive agent lines are ONE turn (three lines in a
row used to pass "two sentences"); at most one question per heard turn;
locked text (closing, identity, recording answer, a tool's words) is exempt
from length but not from the question count. On every scenario: never claims
to be human; the recording answer word for word when asked; an honest "AI
assistant" when asked; after an opt-out only the tool's confirmation, nothing
else; no time or day that no tool returned; no area, guarantee, discount or
start date of its own; nothing recorded with a number or address unless
confirmed; no call-back in the past; no question to a vulnerable person. The
scorer itself is tested to fail each of these.

**Prompt budget raised, with the reason.** The general prompt is 1,250
tokens (pinned at 1,300, was 1,100; the total at 2,550, was 2,350): the new
intents are the same on every call so they cannot live in the per-call
brief, and ~150 more tokens a turn is about $0.0009 on a 15-turn call on
GPT-4.1 mini. Labels were dropped from the rendered block and actions
tightened to pay for part of it.

**Known limits: only a real call proves these.** Latency (tool round trips
under Retell's timeout, the holding line), voice naturalness and prosody of
the spoken slot labels, barge-in timing (interruption sensitivity 0.75 on a
bad line), whether the model follows the LISTEN FOR block on misheard words
the table has never seen, whether Google/iOS screens wait for a full sentence,
and the answering-machine detection race between Retell and the model. The
detection table is conservative regex: a sarcastic "oh brilliant, go on then"
or a heavy accent the recogniser mangles beyond these rows will still be
missed; the post-call net catches opt-outs only when the words survive ASR.
**Swear-offs (owner decision 2026-09-28).** A swear-off ("f off", "piss
off", "go away") or "leave me alone" is an objection to contact, not only to
calls (PECR, UK GDPR Art. 21): `OPT_OUT_ALL`, so `opt_out` scope ALL runs the
one global path (`agent/tools.ts` applySuppression: the ALL suppression row,
`leads.opted_out`, automation off, `lead.opted_out`), which every channel's
send guard reads (calls, SMS, WhatsApp, email; LinkedIn tasks read the same
lead flag). The post-call net applies the same scope when the model missed
it. Anything the lead asked for earlier in the same call ("just email me")
is void: the tool gate (`tools/core.ts`) refuses every send, booking,
call-back and transfer once an `opt_out` succeeded in the call, and the ALL
opt-out overwrites a call-back or "a colleague will email you" note set
earlier in the call. Scenario `email-me-then-f-off` proves it. A TPS mention
stays calls only (it is about calls).

### 16.15 What the call hears, and the voice (voice QA pass, 2026-09-28)

**Detection** happens in three layers, all reading one table,
`voice/speech-intents.ts` `SPOKEN_INTENT_PLAYBOOK`:

| Layer | What | Where |
|---|---|---|
| Provider | voicemail and IVR (`voicemail_option`, `voicemail_reached` / `ivr_reached`) | Retell |
| Model, in the call | opt-out (scope ALL or CALLS), wrong number, gatekeeper, angry caller, "speak to a person", "is this a robot", who is this / how did you get my number, privacy, language barrier, bad time / driving, not interested, "just email me", buying signals, objections | the LISTEN FOR block of `RETELL_GENERAL_PROMPT`, rendered by `renderListenFor()` |
| Post-call safety net | a missed opt-out (with its scope), a wrong number, a voicemail greeting that reached the model | `analyseCall` (post-call.ts) runs `detectSpokenIntents` on the lead's words |

`tests/voice-speech-detection.test.ts` holds 162 spoken, ASR-noisy rows (90 before the adversarial pass, §16.12)
(fillers, missing apostrophes, "numba", "ro bot", "e mail", "gaffer",
"give us a bell") and proves each intent maps to its action. Fixes that came
out of it: "take me off your list" now opts out of **every channel**
(opt_out scope ALL; post-call applies the ALL suppression and the lead's
`opted_out` flag when the model missed it); a wrong number is not rung again;
post-call suppressed the business's own number on an inbound call (it now
uses the caller's number); a voicemail greeting that reached the model no
longer counts as a conversation or feeds the qualification extractors.

**"Just email me"** has a tool now: `send_booking_link` (sms or email, the
business's own link appended by the runtime, through the ordinary send
path; `voice_agent.send_booking_link`, EXTERNAL on standing permission; 0162's
tool list includes it). The brief's SEND ME SOMETHING line picks the send
by goal (checkout link, quote, booking link, else a colleague) and then
offers a short follow-up at two times.

**Tool failure.** A tool that throws or times out answers "Sorry, I cannot
do that just now. I will get the details sent to you by text or email, and a
colleague will follow up." and the prompt says: apologise once, never guess,
move to a text follow-up. Every verdict is also a `voice.tool_used`
operator event (ids, tool, verdict, code, latency; no words).

**No dead air.** `record_fact` and `log_objection` now have
`speak_after_execution: true` (Retell: leave it on unless nothing is said
next; with it off the agent does not carry on after the function returns),
their descriptions say never to read the note aloud, and the prompt says
they are silent notes, never a turn on their own. Only `end_call_summary` is
off: the call ends after it.

**Conversion craft in the brief** (`brief.2026-09-28.v2`, still inside
1,100 tokens; the general prompt is pinned at 1,100 and prompt plus brief
plus time plan at 2,350): straight to the reason for the call after the
permission question; the assumptive two-slot close ("I can do X or Y, which
is better?") with the time read back; one light trial close; objections
first ask the library's one question, and on a repeat never ask it again:
a timing, not-now or happy-supplier is accepted with a follow-up time,
anything else gets one approved reason and the goal's own step (the same
goal step the text strategy uses).

**The voice.** No voice was heard in this pass (zero spend: no Retell
calls), so this is a provisional default from provider quality, latency and
cost:

| | Cartesia (default) | ElevenLabs (premium) |
|---|---|---|
| TTS through Retell | $0.015/min | $0.040/min |
| Why | Sonic is built for low-latency conversational speech; five British voices | generally the most natural prosody; five British voices |
| Default | **`cartesia-Willa`** (F, middle aged); male alternative `cartesia-Anthony` | opt-in premium only (+£0.20/min, owner accepts) |

Retell settings (voice-profile.ts `DEFAULT_VOICE_FEEL`, and the setup
script): responsiveness **0.85** (from 0.9: UK B2B callers pause mid-thought),
interruption sensitivity **0.75** (from 0.8: a bad line should not cut the
assistant off), backchannel **on** at 0.5 with `mm, right, yeah, okay`
(`BRITISH_BACKCHANNEL_WORDS`; "I see" dropped), ambient sound **none** (a
fake office would be theatre on a call that says it is an AI), speed
**1.0**, end the call after **20 s** of silence with one reminder at **8 s**.
Before the first live call, listen to Willa and Anthony on a test call.

**OWNER DECISION (not made; prices unchanged).** ElevenLabs is not proven
best here (nothing was listened to). If the owner wants it as the default
for every call without the surcharge, on GPT-4.1 mini: cost per minute
$0.10886 + $0.025 = $0.13386 = £0.1010 base, **£0.1222** stressed (×1.21).
Holding 75% gross margin stressed (Stripe 1.8% + 20p a pack, economics §13.3
formula, number excluded) needs at least **£0.528 a minute**: the 1,000
pack from £449 to **£528** (+17.6%), 500 from £225 to **£265**, 250 from
£115 to **£133**, 100 from £49 to **£54**, and the Pro voice item from
£100 to **£119** ((200 × 0.1222 + 2.283) ÷ 0.225). Kept as premium instead,
the current +£0.20/min surcharge more than covers it (it needs only about
+£0.08/min on GPT-4.1 mini; the +£0.20 was sized for GPT-4.1).

### 16.14 How the assistant sounds (owner request 2026-09-28)

Per workspace, in Settings -> Voice -> Agent ("How the assistant sounds"),
stored in `voice_settings.voice_profile` (0162) and sent per call as
`agent_override.agent` fields (`voice/voice-profile.ts`):

| Setting | Retell field | Default | Range |
|---|---|---|---|
| Voice | `voice_id` | none: the Retell agent's own voice (the setup script's `RETELL_VOICE_ID`) | a listed British voice |
| Speaking speed | `voice_speed` (**UNVERIFIED** field name; sent only when not 1.0) | 1.0 | 0.8 to 1.2 |
| Reply speed | `responsiveness` | 0.9 | 0 to 1 |
| Lets the lead interrupt | `interruption_sensitivity` | 0.8 | 0 to 1 |
| Listening sounds | `enable_backchannel`, `backchannel_frequency` | on, 0.6 | |
| Background sound | `ambient_sound` | none | Retell's six sounds |

**No final voice is hard-coded.** The setup script's platform default is a
PROVISIONAL `cartesia-Willa` (British, stack A TTS cost) and refuses an
ElevenLabs default. A voice QA pass chooses the default against cost.

**British English candidates** (`GET /list-voices`, read-only, 2026-09-28;
300 voices listed, these are the ones Retell tags British):

| Provider | TTS $/min (research §2.1) | Voices (gender, age) |
|---|---|---|
| Cartesia | 0.015 | Willa (F, middle aged), Eve (F, middle aged), Maren (F, young), Adam (M, middle aged), Anthony (M, middle aged) |
| OpenAI | 0.015 | Amy (F, young), Anthony (M, middle aged), Fable (M, young) |
| Retell platform | 0.015 | Willa (F, middle aged), Maren (F, young) |
| Inworld | 0.015 | Eleanor (F, middle aged), Duncan (M, middle aged), Willa (F, middle aged), Maren (F, young) |
| Fish Audio | 0.015 | Willa (F, middle aged), Maren (F, young) |
| MiniMax | 0.015 | Willa (F, middle aged), Maren (F, young) |
| **ElevenLabs (premium)** | 0.040 | Willa (F, middle aged), Dorothy (F, young), Amy (F, young), Maren (F, young), Anthony (M, middle aged) |

**Premium voice.** ElevenLabs is $0.025/min more than the stack A TTS. It is
offered only as premium voice at +£0.20 a minute (research §8), which the
owner accepts with a tick box (refused by the service otherwise). A call on
it is marked `voice_calls.premium_voice` and its seconds settle at
`PREMIUM_MINUTE_FACTOR` = 1.45 (1 + 0.20 / 0.449, rounded up: at the
cheapest pack rate one premium minute costs at least £0.651); the extra TTS
cost is an estimated `PREMIUM_VOICE_MINUTE` line in `voice_cost_ledger`
(Retell's own figure, when present, already includes it). Settling above the
hold draws on the balance and never goes below zero (no overage).

### 16.16 The first real calls (2026-09-28): what failed and what changed

The 95 simulated scenarios all scored 100 while the owner's first real call
failed. The call (route QUALIFICATION, lead "jamahl thomas", service "Roof
replacement", qualification PENDING, calling as "Blackwellen", booking not
permitted):

> AI: ...Is now an OK time for a couple of minutes? / Lead: Yes. /
> AI: ...One useful point: we offer tailored solutions to fit your specific
> needs. Does that sound like it would help to talk further? / Lead: Yes. /
> AI: Great. A colleague will send you the details to get started. When
> would be a good time for a quick follow-up call? I can offer times this
> afternoon or tomorrow morning. / Lead: Tomorrow. / AI: One moment while I
> check availability for tomorrow morning. [check_availability refused
> NOT_PERMITTED] A colleague will handle arranging the follow-up call... /
> summary: "Qualified lead interested in tailored solutions..."

Root causes and fixes:

| Defect | Root cause | Fix |
|---|---|---|
| No qualification | The brief carried ONE move from the lead's NBA (that day an INFORM, "share one useful point"). The loader (`server-p3.ts`) never read the workspace's configured `qualification_questions` (the live workspace has four), so no plan could reach the call; the INFORM move plus "one light trial close" took the call straight to a close. | `voice/question-plan.ts` `buildQuestionPlan`: the NBA's own question first, then the configured questions for the lead's service (or for every service) in the owner's order, else a catalogue default (need or scope for the named service, timeline, budget range, decision-maker, the postcode when the business works to service areas), skipping what is known. At most 5 questions; required floor 3, ceiling 4. A QUALIFICATION brief always carries a `QUESTION PLAN` section (keys in brackets for `record_fact`) and "ask 1 to N before any close, next step or closing line, unless they opt out, say it is a bad time, want a person or it is the wrong person". The plan is never dropped for space. The engine's own decisions stand: ESCALATE, DISQUALIFY, NO_ACTION, WAIT and CTA_* NBAs get no plan. The trial close is not in a plan brief. A confirmed answer to a configured question with no dimension (`Q.<id>`) is written as an UNMAPPED fact against that question. |
| Invented claim | "Share one useful point from the approved offer lines" with no offer lines. | With no approved lines the brief says `NO APPROVED CLAIMS. Do not describe the business or its offer beyond the service name (...)`; INFORM / NURTURE / ANSWER moves and the objection step never mention offer lines that do not exist. The general prompt adds "nothing about the business beyond its APPROVED OFFER LINES". `voice/call-lint.ts` (reusing the text agent's AI-tell list) flags claim-like sentences no approved line supports, in post-call analysis and in the QA scorer. |
| Times before the tool | The booking-off rule was only inside the close ("you may not book"). | `BOOKING IS OFF. Never offer, suggest or check times or days, never say you are checking availability, never call check_availability or book_meeting.` up front whenever booking is off. The next step is a call-back window: ask which day and time of day suits a colleague, `schedule_callback` by PERSON with the window in the note, say only its line. |
| False summary | `end_call_summary` stored the model's label. | `voice/summary-guard.ts`: before the summary is stored (tool core) and again in post-call analysis, "qualified" is replaced unless `leads.qualification_state` is QUALIFIED, and the summary states what `record_fact` recorded in the call, or "No qualifying answers were recorded on the call; qualification stays pending." |
| "A colleague will... A colleague will" | A two-sentence NOT_PERMITTED refusal, the model's own line on top, and a holding line for a tool it was not allowed. | Refusals are one sentence; a calendar tool refused for booking-off says "A colleague will arrange a time with you." with `data.next` (ask for a call-back window). The general prompt: "If a tool refuses, say its say line once and add nothing." No holding line, because the brief forbids the tool. |
| Harness gap | The scripted agent took the brief's one move; the scorer never checked what the call learned or claimed. | The scripted agent reads the `QUESTION PLAN` from the brief TEXT and follows it (so a brief without a plan fails the suite). New checks on every scenario (`liveCallFailures`): the required plan questions asked (or answered) before any close on QUALIFICATION, unless the lead took it elsewhere, the call looped or the time plan said wrap up; no availability before a successful `check_availability`; no "checking availability" with booking off; no claim outside the offer lines; no "qualified" in the model's summary. `scoreRecorded` replays a real transcript: the live call (`live-2026-09-28-no-qualification`) fails on all five, and the same lead lines through the fixed brief score 100. |

**Second real call** (the same day; service "Flat roof / GRP", the lead's
notes and postcode on file, the workspace's AI assistant switched off):

| Defect | Fix |
|---|---|
| Every tool refused: the tool gate required the text assistant (`aiEnabled`) | Decision: `record_fact`, `schedule_callback` by PERSON, `end_call_summary`, `log_objection` and `opt_out` are core call functions and follow the call, not the text assistant's switch (they decide nothing commercial; an AI call-back still needs `aiMay(call)`). And a call is not placed with a crippled agent: new entitlement reason `AI_ASSISTANT_OFF` (integration-required), "Switch on the AI assistant in Settings, Workspace before AI calls...", read by `loadEntitlementFacts` with the text agent's own rule (switch, plan allowance, a mode other than OFF). It shows wherever the entitlement message shows (the dial decision, the drawer's "Call with AI" reason, the Settings, Voice notice) and as a Set-up checklist item. |
| A call-back agreed for 5pm at 17:3x, the correction to 6 lost | The time plan carries `NOW: ... Monday 28 September, 5:32pm their time` and "a call-back time must be later than now; if they correct a time, the latest one wins; read the exact time back once". `schedule_callback` with a past `at_iso` is refused `PAST_TIME` with one natural reprompt ("5pm has already gone today. Did you mean 6pm today, or 5pm tomorrow?", `spoken-time.ts pastTimeReprompt`); an accepted one is read back exactly ("A colleague will call you back at 6pm today."). |
| "What prompted your enquiry?" with the service, notes and postcode on file | The brief carries `They enquired about: <service>`, `THEIR ENQUIRY` (the lead's notes, up to 280 characters: "open on it; never ask what prompted the enquiry; confirm instead of asking where it answers a plan question") and the postcode as known. On unclear speech: one reprompt, then a yes or no question from what is known, not a hand-over. |
| Talking over and restarting sentences | Default feel: interruption sensitivity 0.75 -> 0.6, responsiveness 0.85 -> 0.8, backchannel 0.5 -> 0.3 (stored profiles keep their values); turns "under 25 words; if they talk over you, stop and let them finish". |

Budgets (reasons in the code): `CALL_BRIEF_MAX_TOKENS` 1,100 -> 1,500; the
QA prompt total 2,550 -> 3,000; the general prompt stays under 1,300. The
brief for the first live lead now reads, in order: who and why (with "They
enquired about: Roof replacement"), FIRST, the move ("Ask question 1 of the
QUESTION PLAN (What does the roof replacement involve, roughly?)"), the plan
(scope, timing, budget, decision-maker; ask 1 to 4 before any next step),
BOOKING IS OFF, NO APPROVED CLAIMS, CLOSE (only after the plan: a
colleague's call-back window), then the unchanged rules. Tests:
`tests/voice-live-call-fixes.test.ts`, `tests/voice-call-qa.test.ts`
("live call 2026-09-28"). To re-test on a real call the Retell LLM must be
updated (`scripts/retell-setup.mjs`) so the new general prompt is live.

**Live dry run** (`node scripts/voice-brief-dry-run.mjs <leadId> [route]`,
read-only: a fetch guard refuses every Supabase write and any other host;
the only POST allowed is the STABLE `check_suppression` RPC) builds the
exact brief, time plan and dynamic variables from the live database through
the real loader. Its first run found three more loader faults, fixed:
(1) the offer card was flattened, so its NEVER CLAIM items ("cheapest",
"best in London") were listed as APPROVED OFFER LINES along with the card's
header; now only the approved sections are used (`voiceOfferLines`:
APPROVED CLAIMS, published prices, value proposition, key messages, what
they sell, differentiators) and the never-say items become a `NEVER SAY OR
CLAIM` line; (2) the owner's proof points were dropped by the text card's
600-token budget, so the voice loader reads them itself (profile outreach
proof points and the default playbook's `proof_points`), puts them first
with the lead's own service line, and removes restatements
(`dedupeApproved`); (3) with booking allowed but no readable calendar
(`ASK_PREFERRED_TIME`, `LINK`), the close said "call book_meeting with
their time", which the gate always refuses (no `check_availability` in the
call): now `NO CALENDAR ON THIS CALL` plus a colleague-confirmed time via
`schedule_callback` (or the booking link). Plan order: the lead's service's
own questions, then the workspace-wide ones (`service_id` null), each by
position, one per dimension or intent.

### 16.17 AI QA on real inputs (2026-09-29): every route and permission, graded

No call had been placed since 2026-09-28 (read-only check of `voice_calls`
for the live workspace). The two calls of 2026-09-28 showed one more fault
§16.16 did not record: tool refusals took 2.4 to 18.8 seconds (a full
context assembly per tool call), past the 8-second tool timeout, which is why
the second call's summary says "call-back scheduling failed due to tool
errors".

**The dry run now covers every combination.** `node
scripts/voice-brief-dry-run.mjs <lead> --matrix` reads the live sources once
(`server-p3.ts gatherVoiceBriefSources`) and builds, through the dial's own
`voiceBriefFromSources`, the brief for every route x booking on/off x
calendar (none, slots, link) x AI assistant x recording x transfer (288 per
lead), varying the permissions in memory; each brief is read by
`voice/brief-lint.ts`, a checker for the contradictions a model would act on.
The single-route dry run now takes recording from the voice settings (it
said "recorded" on a workspace that records nothing) and makes a return call
INBOUND. Before: all 12 live briefs (2 leads x 6 routes) failed, 80 findings.
After: 0 of 576.

| Defect (live data) | Fix |
|---|---|
| Every non-qualification route opened with the lead's stale INFORM, "share one useful point ... ask if it would help", the pitch that sank the first call | A call placed for a close, a check-in, a win-back or a caller who rang us keeps its own move over a point-only NBA (INFORM, NURTURE, ANSWER); ESCALATE, DISQUALIFY and WAIT still bind every route |
| "Goal: Direct sale" above "Close on a meeting"; on a booking call a meeting move and a "colleague sends the details" close | The plan's close follows the goal (a colleague sends the details when checkout is off); a booking or direct-close call's CLOSE is "take it as YOUR ONE MOVE says" |
| "WHAT YOU MAY DO: book meetings" beside "never call book_meeting" | With no calendar: "arrange a meeting time for a colleague to confirm" |
| "Ask 1 to 2 before any close" (read as "one or two questions") | "Ask questions 1 to 2" / "Ask question 1" |
| "a colleague will send the details today" | No send time is promised |
| "call schedule_callback" for a person's call-back | "schedule_callback by PERSON" |
| A nurture or reactivation call closing "they may be ready to buy" with a trial close | "No hard close", the goal's step only if they are keen |
| "YOU ARE the assistant, an AI assistant" | "YOU ARE an AI assistant" |
| The brief loader derived permissions by hand and omitted the booking link and contactability, so it never offered `send_booking_link` the endpoint allowed | One derivation, `tools/core.ts callPermissionsFromContext`, used by the loader and the endpoint |
| Every tool call (even `record_fact`, after every answer) assembled the whole context before its gate | `record_fact`, `log_objection` and `opt_out` never read permissions |
| An AI call-back without consent was refused with "a colleague will call you back", and nothing was recorded | It becomes a person's call-back and is recorded |

The general prompt and the tool definitions did not change: **no
`retell-setup.mjs --apply` is needed for these fixes** (the brief rides in
per-call dynamic variables). `CALL_BRIEF_VERSION` is `brief.2026-09-29.v5`.

Data, not code: both live test leads were created in the Add Lead wizard
with conversion goal "Purchase", so the engine assessed a roof as a direct
sale. A wizard-picked goal is no longer read as the lead's own request
(`signals.ts originSignals`, below in AGENT_RUNTIME.md); signals already
stored on those two leads stay until they are reassessed or re-added.

Tests: `tests/voice-brief-matrix.test.ts` (432 synthetic briefs across three
workspaces, each defect by name, the lint tested to fail, the endpoint and
permission parity).

### 16.13 Migration 0162 (written, NOT applied)

`0162_voice_agent_tools.sql`: `voice_tool_calls` (member-read, service-role
write, the voice lead-row check, cleared on anonymise); `voice_calls.brief_version`,
`voicemail_script_version`, `carrier_call_sid_source` and a carrier-sid index;
`voice_call_outcomes.attribution_spoken`, `closing_version`;
`voice_settings.voice_profile` and `voice_calls.premium_voice`. Until it is
applied the tool endpoint answers "unavailable" (the idempotency row cannot be
written, so no tool acts), the dial path skips the plan columns, and
post-call saves the outcome without the attribution columns.

---

## 13. Owner setup before the first live call

1. **Retell.** `RETELL_SECRET_KEY` is set. Apply migration 0162, set
   `VOICE_WEBHOOK_BASE_URL`, then run the setup script: first a dry run
   (`node --env-file=.env --env-file=.env.local scripts/retell-setup.mjs`)
   to read what it will send, then `... scripts/retell-setup.mjs --apply`. It
   creates or updates the Retell LLM (prompt, `{{locked_preamble}}` begin
   message, the ClientTurn tools at `<origin>/api/voice/tools/*`, end_call,
   transfer_call) and the agent (en-GB, Europe/London, webhook, the 7-minute
   ceiling, voicemail detection), and prints `RETELL_AGENT_ID` and
   `RETELL_LLM_ID` for `.env`. Choose a British English voice
   (`RETELL_VOICE_ID`) and confirm the model id. Then in "What the AI may do"
   switch on "Phone leads" and "Transfer live calls" only if wanted.
   Nothing in the codebase creates Retell objects or places calls without the
   owner's approval.
2. **Twilio parent credentials.** `TWILIO_ACCOUNT_SID` must be the `AC...`
   account SID and `TWILIO_AUTH_TOKEN` its auth token (not an API key; gap map
   F7).
3. **Webhook URLs.** Set `VOICE_WEBHOOK_BASE_URL` to the public https origin.
   Provisioning then configures each number's voice URL, status callback and
   SMS URL, and each bundle's status callback, from it:
   `/api/webhooks/twilio/voice`, `/api/webhooks/twilio`,
   `/api/webhooks/twilio/regulatory`. Set `VOICE_BUNDLE_NOTIFICATION_EMAIL`.
4. **Stripe TEST prices.** Create by hand in the TEST account only (CLAUDE.md
   Stripe safety): the £100/month voice item, the £11.99/month number, and the
   four one-off packs. Put the ids in the `STRIPE_PRICE_VOICE_*` variables.
5. **Apply migration 0159** (0157 is applied) and regenerate types.
5a. **Inbound calls.** Import each number into Retell (without a default inbound agent), set its inbound webhook to `https://<public origin>/api/webhooks/retell/inbound`, and set `RETELL_SIP_DOMAIN`. Until then inbound callers get the message and text back.
6. **The OD-1 opener is owner-approved** (2026-09-28); the call now names
   ClientTurn only in the closing line (§16.7). A change is an edit in
   `opener.ts` plus a bump of `OPENER_VERSION` or `CLOSING_VERSION`.
7. **Sub-processors.** Retell is listed in `marketing/subprocessors.ts`;
   confirm its entity, location and own sub-processors (marked unconfirmed
   there) and the privacy notice before any live call (release criterion R10).
8. Resolve the UNVERIFIED items above, in particular the SIP leg mapping (19),
   the Retell cost and analysis fields (1, 2), the live Retell webhook (6) and
   subaccount webhook signing (8).
