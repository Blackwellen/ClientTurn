# The ClientTurn conversation agent

A bounded business-operations agent for one job: **respond to inbound leads
quickly, understand what they need, qualify them against the business's own
rules, answer safe questions, help them book, stop when required, and hand over
to a person when judgement is needed.**

It is not a chatbot product and not an autonomous agent. It is a controlled
actor inside the existing lead pipeline, and every consequential decision it
appears to make is actually made by deterministic code.

## The one rule everything else follows

> The model understands language and **proposes**.
> Application code **decides, authorises and executes**.

| The model does | Deterministic code does |
|---|---|
| Interpret what a lead means | Decide whether the agent may run at all |
| Draft wording | Decide whether a message may be sent, and when |
| Extract a candidate field value | Validate and persist that value |
| Choose among a fixed set of proposed actions | Execute (or refuse) the action |
| Summarise history | Qualification results, suppression, booking, lifecycle |

Nothing the model returns is ever executed directly. Its entire output is one
JSON object (`agentDecisionSchema`), which is treated as data and passed
through the policy engine before any of it becomes real.

## Where it sits

```
Twilio / Meta / mailbox
        │  webhook, verified + stored (existing code)
        ▼
message-inbound.ts ──► deterministic opt-out check ──► suppression (no model)
        │
        │  agent enabled for this workspace + channel?
        ▼
enqueueAgentTurn()  ──►  jobs table  ──►  /api/cron/worker  ──►  agent.run
                                                                    │
                                                                    ▼
                                                          orchestrator.runAgentTurn
```

The webhook never waits for a model call. It stores the inbound message,
queues a turn, and acknowledges — which is what stops Twilio and Meta from
retrying (and therefore duplicating) because inference was slow.

With `agent_mode = 'OFF'` — the default for every workspace — the inbound
handler's original deterministic flow runs completely unchanged.

## The turn

`src/lib/agent/orchestrator.ts`. Linear, bounded, no free-running ReAct loop:

```
assemble context
  → run gate            may the agent act at all?
  → claim turn lock     one turn per conversation at a time
  → deterministic classification    (binding verdicts short-circuit here)
  → model proposal      exactly one call, plus at most one retry
  → policy validation
  → tools
  → compose + validate  reject-and-retry once, then hand over
  → send / draft / queue
  → persist + log
  → release turn lock
```

`MAX_AGENT_STEPS = 5` is the ceiling. Most turns use one or two.

## Module map

| File | Responsibility | Pure? |
|---|---|---|
| `types.ts` | Vocabulary, `agentDecisionSchema`, confidence policy, limits | ✅ |
| `classification.ts` | Deterministic reply classification — binding verdicts | ✅ |
| `lifecycle.ts` | Lifecycle + mode derivation from existing columns | ✅ |
| `policy.ts` | Run gate, send gate, tool gate, length policy | ✅ |
| `validate.ts` | Outbound claim validation | ✅ |
| `context.ts` | Context assembly + prompt block rendering | server |
| `tools.ts` | Tool registry, permissions, executors | server |
| `orchestrator.ts` | The turn | server |
| `availability/slots.ts` | Slot generation, timezone maths, confirmation matching | ✅ |
| `availability/index.ts` | Google/Calendly providers and the resolver | server |
| `summary.ts` | Rolling conversation memory | server |
| `queries.ts` | Reads for the assistant surfaces | server |
| `actions.ts` | Handover / draft / ownership CRUD | server |
| `views.ts` | Read models and labels for the UI | ✅ |
| `audit.ts` | Runs, actions, extractions, skipped runs | server |
| `events.ts` | Event normalisation + queueing | server |

The pure modules are unit-tested with no database — `tests/agent.test.ts`
(71 cases) and `tests/agent-availability.test.ts` (28 cases). That is
deliberate: a rule like *never message a suppressed contact* is only credible
if it can be proven without infrastructure.

> Note the naming: `src/lib/agent/` (singular) is this conversation runtime.
> `src/lib/agents/` (plural) is the separate V4 sourcing-agent feature.

## What the model cannot do

### Deterministic verdicts outrank it

`classifyDeterministic()` runs **before** the model on every inbound message.
When it returns a binding verdict there is no model call at all:

| Message | Verdict | Consequence |
|---|---|---|
| "STOP", "take me off your list", "do not message me" | `UNSUBSCRIBE` | Suppress, stop every queued send, close |
| "wrong number", "who is this" | `WRONG_NUMBER` | Suppress **that endpoint only** |
| "this is a scam", "I want a refund" | `COMPLAINT` | Handover, urgent |
| "gas leak", "flooded" | `EMERGENCY` | Handover, urgent |
| "speak to a human", "are you a bot" | `HUMAN_REQUEST` | Handover |
| "are you hiring", supplier pitches | Not a lead | Stop sequence, no sales reply |

Precedence matters: an opt-out inside an otherwise friendly message is still
an opt-out, and suppression outranks a complaint in the same message.

This layer also strengthened the **non-agent** path: `message-inbound.ts` now
checks these phrases alongside the existing carrier keywords, so a workspace
with the agent off also honours "please don't text me again".

### The response validator

Every candidate reply is checked before it becomes a message. A failure
discards the draft and feeds a correction back for one retry; a second failure
hands over.

| Rejected | Unless |
|---|---|
| Any money amount | It appears in wording the workspace published |
| Any specific time offered | It came back from a calendar tool this turn |
| "You're booked" | `create_booking` actually succeeded |
| "We cover your postcode" | A service-area tool positively matched |
| "Someone will call within 10 minutes" | Never — no SLA is configured |
| Any link | It is the configured booking link |
| Mentioning prompts, providers, credentials | Never |
| Claiming to be human | Never |
| Over the channel's hard length | Rejected, never truncated mid-fact |

Truncation is deliberately not a remedy: cutting a message in half can change
what it promises.

### Pricing

`services.pricing_visibility` defaults to `QUOTE_REQUIRED`. The existing
`services.average_value` is internal commercial data and is **never** loaded
into a prompt. A workspace must explicitly set `PUBLIC_FIXED` / `PUBLIC_FROM`
and write the wording it is willing to have quoted.

### Tools

The model names an action, never a target. Every tool receives a `ToolContext`
the runtime built from the verified event — business, lead, conversation,
channel — and no tool's input schema contains those identifiers, so no model
output can redirect one at another workspace or another lead.

There is no SQL tool, no HTTP tool, no shell. No tool is `CRITICAL` risk:
billing, account administration, permissions and credentials are outside this
agent's authority entirely, and `evaluateToolGate` refuses `CRITICAL`
unconditionally.

| Tool | Risk | Requires |
|---|---|---|
| `check_service_area` | LOW | — |
| `get_calendar_availability` | LOW | A connected, healthy calendar |
| `record_reply_classification` | LOW | — |
| `draft_message` | LOW | — |
| `record_qualification_answer` | MEDIUM | Value re-validated by the deterministic matcher |
| `update_lead_fields` | MEDIUM | Whitelisted field, blank target, confidence ≥ 0.85 |
| `send_message` / `send_booking_link` | MEDIUM | Contactability |
| `stop_follow_up` | MEDIUM | — |
| `create_booking` | HIGH | Confirmed availability + eligible lifecycle + confidence ≥ 0.9 |
| `request_human_handover` | HIGH | — |
| `apply_suppression` | HIGH | A **recognised** opt-out — only the deterministic layer can set this |

Allowed calls and refusals are both written to
`conversation_agent_actions`. A denial is the interesting row.

**Context is pushed, actions are pulled.** There are no `get_lead` /
`get_services` / `get_qualification_state` tools — the assembler already holds
that, and a round trip to fetch it would spend a model call for nothing.

## Ownership and concurrency

`conversations.owner` is a separate axis from `conversations.state`:

`AI_ACTIVE` → `HUMAN_ACTIVE` / `HANDED_OVER` → `CLOSED`

The agent may only act while `AI_ACTIVE`, and **never takes ownership back on
its own**. A handover moves ownership in the same operation that creates the
handoff row, so the agent cannot take another turn on that conversation.

Two inbound messages arriving together cannot produce two replies:
`claim_agent_turn()` bumps a monotonic sequence under a lock and returns null
to the loser, which drops its turn.

## Idempotency

| Layer | Key |
|---|---|
| Inbound message | `(provider, provider_message_id)` — existing |
| Agent run | `(business_id, idempotency_key)` from the stored message id |
| Job | `agent.run:<idempotency_key>` |
| Outbound message | `send_key` = `agent:<run id>` |
| Qualification answer | upsert on `(lead_id, question_id)` |
| Handoff | one open row per conversation (partial unique index) |
| Suppression | upsert on `(business_id, normalized_contact, channel)` |

A retried job either resumes a crashed turn or finds the work done. Model
generation retries are separated from tool execution, so a successful side
effect is never repeated because a later generation failed.

## Quiet hours, suppression and sending

The agent does **not** own any of these. `evaluateSendGate` predicts what the
existing send guard in `send-core.ts` will do so the turn can report the right
outcome (`MESSAGE_QUEUED` vs `MESSAGE_SENT`) — but the guard re-checks stop
conditions, suppression, quiet hours and connection health against live state
immediately before dispatch, and it has the last word. `origin = "agent"`
behaves like `"system"`: a lead having replied does not block the reply owed
back to them, while opt-out, suppression and human takeover bind absolutely.

## Memory

Four layers, and no free-form long-term memory:

1. **Turn context** — last 8 messages verbatim
2. **Rolling summary** — `conversation_summaries`, compressed beyond that
3. **Structured lead** — the lead row and qualification answers
4. **Workspace config** — settings, services, booking

The structured half of a summary (opt-out, booking, handover, qualification,
key answers) is written by the runtime from database state, not by the model,
so a compression pass cannot lose the facts that matter. Summaries refresh
once per window of new messages, not every turn.

## Observability

**Customers** see outcomes: assistant replied, reply drafted for review,
qualification updated, booking options sent, passed to the team. They never see
prompts, tool arguments, reasoning or provider detail.

**Platform admin** sees `conversation_agent_runs` — trigger, mode, outcome,
latency, tokens, cost, error code, tools used and refused.

`conversation_agent_runs` and `agent_handoffs` are member-readable via RLS
(they carry no internals). `conversation_agent_actions`,
`conversation_agent_extractions` and `conversation_summaries` are server-only:
RLS on, no policies.

**No chain-of-thought is stored anywhere, because none is ever requested.**
`reasoning_code` is a single auditable token like
`USER_EXPLICITLY_REQUESTED_BOOKING`.

Skipped runs are recorded too — "why did the assistant not reply to this" is
answerable without re-running anything.

## Prompt injection

Lead text is untrusted content. It is never interpolated into a labelled
policy field; it arrives wrapped by `wrapUntrustedContent()` inside the user
message, with system policy assembled separately in `prompts.ts`.

Injection probes are detected and recorded on the run for audit, but they do
**not** change handling — the message is processed as the ordinary enquiry it
is. Even a perfectly persuasive injection reaches a model whose entire output
is a fixed JSON schema, every field of which is re-validated before use.

## Turning it on

Settings → Workspace → **AI assistant**. Four controls:

- **Mode** — Off (default) / Suggest replies / Reply automatically
- **Channels** — SMS, WhatsApp, Email (only those actually connected)
- **When to involve a person** — handover on qualification review; whether to
  answer service questions at all
- **Tone**, and an optional extra handover rule

`SUGGEST_ONLY` writes a real `DRAFT` message row that the send worker never
claims, and notifies the workspace. Nothing escapes review.

The agent is additionally gated by `business_settings.ai_assist_enabled` and
the plan's AI entitlement — turning AI assist off writes `agent_mode = 'OFF'`
in the same operation, so there is never a live actor with its master switch
off.

## Working with what the assistant did

`src/lib/agent/queries.ts` (reads) and `src/lib/agent/actions.ts` (writes),
surfaced as a strip above the thread in **Inbox**.

Three rules hold across every write:

1. **A person is always the actor.** Each action starts with `requireRole`,
   re-reads the target scoped to that person's workspace, and records who did
   it in the audit log. None of them are reachable by the agent.
2. **Ownership moves explicitly.** The agent may hand a conversation to a
   person; only a person hands it back. There is no timeout that reclaims it,
   because "the human went quiet" and "the human is done" are not the same
   thing.
3. **A draft is a message, not a suggestion blob.** Approving one queues it
   through the ordinary `message.send` pipeline, so the send guard re-checks
   suppression, stop conditions and quiet hours exactly as for any other
   outbound message.

| Object | Operations |
|---|---|
| Handover | read · acknowledge · assign (admin) · resolve (± hand back) · cancel (admin) |
| Suggested reply | read · edit · send · discard |
| Conversation ownership | take over · hand back to the assistant |
| Run history | read (outcomes only) |

Two details worth knowing:

- A discarded draft is kept as `DISCARDED`, not deleted. What the assistant
  proposed and a person declined is the most useful evidence there is for
  judging whether to trust it with more.
- Handing a conversation back is refused outright if the contact has opted
  out, whatever the UI offers.

## Booking: real availability, deterministic confirmation

`src/lib/agent/availability/`

Two providers, one contract. Each returns **busy intervals**, never slots —
slot generation is the pure code in `slots.ts`, so business hours, duration,
buffer and minimum notice apply identically whichever calendar a workspace
uses.

| Provider | How it is asked | Notes |
|---|---|---|
| Google Calendar | `freeBusy` across the selected calendars | Returns opaque busy blocks only: no titles, no attendees. A calendar that errors is never read as "free". |
| Calendly | `event_type_available_times` | Calendly owns its own availability rules, so its answer is authoritative and is not re-filtered through business hours. |

A provider that is missing, unhealthy or erroring returns a **typed failure**,
never an empty list. Empty means "genuinely nothing free", which is a different
answer and earns a different reply:

| Outcome | What the lead gets |
|---|---|
| Slots returned | Up to three real times, spread across the window |
| Empty (calendar answered, nothing free) | Told so plainly, then handed to a person |
| Provider failure, booking link configured | The configured booking link |
| Provider failure, no link | A person |

### Timezone correctness

`zonedTimeToUtc` resolves a wall-clock time in the workspace's IANA zone to the
right UTC instant in two passes — the second corrects using the offset actually
in force at the guessed instant, which is what makes the hours either side of a
DST change come out right. Tested against BST/GMT, both sides of a UK
transition, and a zone well off UTC.

### Confirming a time

`create_booking` is armed only by a slot **this runtime offered on a previous
turn**. The lead's reply is matched by `matchOfferedSlot` — pure string
matching, never a model judgement:

- an explicit time (`"1:30pm"`, `"3pm"`) that matches exactly one offer
- ordinal wording (`"the first one"`, `"second please"`, `"the last one"`)
- a bare number, read as an **hour** when one slot is at that hour — `"3"`
  after offering 1:30pm / 3:00pm / 4:30pm means three o'clock, not the third
  option, which would have been a wrong booking

Anything ambiguous or unrecognised returns null, which becomes a short
clarifying question rather than a booking.

The offer is persisted on the run's `decision_json` and expires after 24 hours,
so a confirmation is matched against exactly the list the lead was shown, and a
day-old offer is re-checked rather than booked from memory.

The confirmation sentence — the one line that must never be wrong — is composed
deterministically from the tool result, not by the model. If the insert fails
or someone else took the slot, the turn hands over; the lead is never told they
are booked when they are not.

## Schema

`supabase/migrations/0024a_agent_runtime.sql`

- `conversations` → `owner`, `agent_turn_seq`, `agent_locked_until`
- `messages` → `origin = 'agent'`, `status = 'DRAFT'`, `agent_run_id`
- `business_ai_settings` → `agent_mode`, `agent_channels`, two handover flags
- `services` → `pricing_visibility`, `public_price_text`
- New: `conversation_agent_runs`, `conversation_agent_actions`,
  `conversation_agent_extractions`, `conversation_summaries`, `agent_handoffs`
- New RPCs: `claim_agent_turn`, `release_agent_turn`

Named `conversation_agent_*` deliberately: `0032_v4_agents_usage` defines its
own `agent_runs` for the V4 sourcing profiles, which is a different thing with
a different shape. Both can coexist.

Both migrations are applied to the **Client Turn** project
(`losieaikadkadtmezini`).

Background execution: see [CRON.md](CRON.md).
