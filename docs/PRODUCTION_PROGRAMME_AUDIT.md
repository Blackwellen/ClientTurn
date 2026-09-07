# Production Programme — Gap Audit

**Date:** 2026-09-07 · **Branch:** `main` @ `87949d5` · **Scope:** the 21-section
"ClientTurn — Final Production Build Programme" assessed against the code as it
actually stands.

## How to read this

Each section carries one verdict:

| Verdict | Meaning |
|---|---|
| **BUILT** | Exists and is wired end to end. The programme adds refinement, not foundation. |
| **PARTIAL** | Real implementation exists; specific, listed pieces are missing. |
| **SCAFFOLD** | Schema and/or types exist, but nothing reaches them at runtime. |
| **MISSING** | No implementation. |

Effort is engineering-days for one person, excluding provider approval waits.

---

## Executive summary

The programme is written as though ClientTurn were being architected from
scratch. It is not. **65 migrations define ~190 tables**, and most of what
sections 1, 3, 7, 9, 12, 13, 14, 18 and 19 describe as new already has schema —
including `contactability_results`, `compliance_decisions`, `contact_permissions`,
`ai_token_ledger`, `mcp_clients` / `mcp_tokens` / `mcp_scopes` / `mcp_audit_logs`,
`agent_runs` / `agent_tool_calls` / `agent_budgets`, `prospect_enrichments` /
`prospect_verifications`, `mailbox_health_snapshots` and `domain_health_snapshots`.

The gap is **not architecture. It is depth, reach and unification.**

Three findings dominate everything else:

1. **Copilot is a regex router, not an agent.** [actions.ts:245](../src/lib/copilot/actions.ts#L245)
   dispatches on `/intent|expansion|signal/.test(text)`. It never calls a model —
   `actions.ts` imports no AI module at all. Section 2 is therefore not "finish
   Copilot's CRUD"; it is "build Copilot".

2. **MCP has no provisioning path.** The gateway, tool catalogue, audit and
   approval tables are all well built — but **nothing anywhere creates an
   `mcp_clients` row or issues an `mcp_tokens` row.** The only references to
   those tables outside the migration are reads in
   [gateway.ts](../src/lib/mcp/gateway.ts). The server authenticates tokens that
   cannot exist. No external client can connect today.

3. **There are three parallel tool layers and two parallel compliance gates.**
   [copilot/tool-service.ts](../src/lib/copilot/tool-service.ts) (19 tools),
   [mcp/handlers.ts](../src/lib/mcp/handlers.ts) (17 tools) and
   [agent/tools.ts](../src/lib/agent/tools.ts) each implement their own version
   of the same operations. Separately, outreach sends pass the jurisdiction
   policy engine ([dispatch.ts:262](../src/lib/outreach/dispatch.ts#L262)) while
   follow-up sends pass a *different* guard
   ([send-core.ts:74](../src/lib/jobs/send-core.ts#L74)) that checks stop
   conditions and quiet hours but **not** jurisdiction packs, consent status or
   subscriber type. Your §21 step 1 is correctly identified as the first job.

**Rough shape of the remaining work: 95–130 engineering-days**, of which roughly a
third is Copilot and MCP, a third is integrations and mailboxes, and a third is
enrichment commerce, compliance surfaces and QA.

---

## §1 — MCP server · **PARTIAL**

**Built.** A genuinely good gateway. [gateway.ts](../src/lib/mcp/gateway.ts)
hashes tokens (SHA-256, plaintext never stored), re-reads the authorising user's
**live** `business_members` role on every call so a demotion binds immediately,
scope-filters `tools/list` so an assistant cannot discover capabilities it lacks,
and parks high-impact tools in `mcp_approvals` rather than executing inline. Every
call is audited to `mcp_audit_logs` with a denial reason. Migration
[0035](../supabase/migrations/0035_v4_mcp_external.sql) is thorough.

**Gaps.**

| Item | State |
|---|---|
| **Client/token provisioning** | **Nothing writes `mcp_clients` or `mcp_tokens`.** No UI, no server action, no route. MCP is unreachable. |
| OAuth 2.1 + PKCE | Missing entirely. No `/.well-known/oauth-authorization-server`, no authorize/token endpoints, no PKCE, no refresh rotation. Auth is a bare bearer token. |
| Audience validation | Missing. Nothing checks the token's intended audience. |
| Protocol version | [route.ts](../src/app/api/mcp/route.ts) advertises `2024-11-05`, not `2026-07-28`. No stateless model, no cacheable discovery, no header routing, no Tasks extension. |
| Scopes | 8 defined ([tools.ts:22](../src/lib/mcp/tools.ts#L22)) vs the 16 in the programme. Missing: `enrichment:run`, `messages:read`, `messages:send`, `bookings:read`, `bookings:write`, `integrations:read`, `agents:run`, `compliance:read`. |
| Tools | 17, flat. No skill grouping. Programme targets 80–120 across 15 skills. |
| Skills | 0 of 15 exist as a grouping concept. |
| Rate limiting / quotas | A `rate_limits` table exists and is used elsewhere; the MCP path does not consult it. |
| Idempotency / correlation IDs | Missing on the MCP path. |
| Client identification | Missing. |
| Risk classes | Partially present as `READ` / `WRITE` / `APPROVAL_GATED`. The programme's 8-class model (financial, destructive, bulk-external, restricted) is not modelled. |
| Public hostname, STDIO dev server | Missing. |

**Note:** the right order is to build §2's service layer first. Adding 80 MCP
tools on top of today's `handlers.ts` would triple the duplication problem.

**Effort:** 18–25 days after the service layer exists.

---

## §2 — Copilot full CRUD · **PARTIAL** (weakest area)

**Built.** A well-designed *permission* model.
[copilot/types.ts](../src/lib/copilot/types.ts) declares 19 tools with role
scopes, `requiresConfirmation` flags and human-readable `effect` strings; the
comment block deliberately documents what is absent by construction (no SQL tool,
no HTTP tool, no send-outreach tool). `tool-service.ts` opens a `copilot_actions`
row before every call and closes it with `SUCCESS` / `DENIED` / `FAILED`.

**Gaps.**

- **No model.** [actions.ts](../src/lib/copilot/actions.ts) imports Zod, the
  session, Supabase, the tool service and insights — and no AI module. Intent is
  keyword-matched at line 245. There is no tool-calling loop, no planning, no
  multi-step execution. The "explain what actually happened" behaviour the
  programme wants cannot exist until the model is in the loop.
- **Result envelope is the wrong shape.** `ToolOutcome` is
  `{ok, summary, data}` ([tool-service.ts:50](../src/lib/copilot/tool-service.ts#L50)).
  The programme requires `success · entity_id · before · after · audit_event_id ·
  warnings · billing_effect · policy_result`. **No before/after diff is captured
  anywhere.**
- **Coverage: 19 tools against 18 domains.** Present: leads (partial), prospects
  (read only), campaigns, business profile, analytics, support tickets, intent,
  usage. **Entirely absent:** companies, contacts, ICPs, sequences, messages,
  conversations, tasks, qualification, bookings, integrations, automations,
  intent monitors, suppression. There is no delete or archive tool of any kind,
  and no merge.
- **QA matrix.** [tests/](../tests/) has 38 files but no per-tool write matrix.
  None of the 12 required cases (bad args, missing record, wrong workspace, wrong
  permission, plan limit, compliance blocked, duplicate submission, retry,
  concurrent update, partial provider failure, audit creation) is exercised
  against Copilot tools.

**Effort:** 25–35 days. The largest single item in the programme.

---

## §3 — Agents as workers · **PARTIAL**

**Built — and better than the programme assumes.**
[agent_runs](../supabase/migrations/0032_v4_agents_usage.sql) already carries
`business_id`, `agent_type`, `subject_type` / `subject_id`, `parent_run_id`,
`deployment`, `prompt_key` / `prompt_version`, `input_tokens`, `cached_tokens`,
`output_tokens`, `tool_call_count`, `provider_cost_minor`, `model_cost_minor`,
`budget_before_minor` / `budget_after_minor`, `confidence`, `status`, `latency_ms`
and `trace_id`. `agent_tool_calls` records every tool with `DENIED_PERMISSION` /
`DENIED_BUDGET` / `DENIED_POLICY` / `REQUIRES_APPROVAL` outcomes. `agent_budgets`
exists. The job queue ([queue.ts](../src/lib/jobs/queue.ts)) has leases
(`locked_at` / `locked_by`), 5 attempts with backoff, a `dead` state and an
idempotency key. **Agent ticks already call the policy engine**
([ticks.ts:83](../src/lib/agents/ticks.ts#L83)).

**Gaps.**

- **Worker coverage.** Customer-facing agents are 4 types — `SOURCING`,
  `BOOKING`, `REENGAGEMENT`, `COMBINED` ([types.ts:14](../src/lib/agents/types.ts#L14)) —
  with only two tick implementations (`runBookingTick`, `runReengagementTick`).
  The internal `agent_runs.agent_type` enum has 11 values. Against the
  programme's 15 workers, missing outright: Enrichment, Intake, Lead Grading,
  Follow-up, Reply, Qualification, Handover, Campaign, Data Hygiene, Compliance,
  Integration Health, Learning. Several of those exist as *job handlers* rather
  than agents — [handlers/](../src/lib/jobs/handlers/) has `qualify`,
  `integration-health`, `lead-process`. The work is done; it is not modelled as
  an agent with a goal and a budget.
- **Missing run fields:** `objective`, `trigger`, `tools_requested` (only
  executed calls are recorded), `retry_count`.
- **Missing runtime:** heartbeats — a lease can go stale without detection — and
  replay from dead-letter; `webhook-replay` exists for webhooks only.
- **Compliance gate timing:** correct for agent ticks and outreach dispatch. See
  §17 for the follow-up path, which is not.

**Effort:** 15–20 days.

---

## §4 — Managed integration layer · **PARTIAL**

**Built.** A well-modelled catalogue
([catalog.ts](../src/lib/integrations/catalog.ts)) with 14 providers, a `platform`
vs `workspace` distinction, `requiredEnv` declarations, `requiresFeature` plan
gates, honest `disconnectConsequence` copy, and a single derived status function
so a provider can never render "Connect" in one place and "Not yet available" in
another. Generic OAuth connect/callback routes exist at
[api/integrations/](../src/app/api/integrations/).

**Gaps — connect flows.** Only 6 of 14 have a `connectPath`: `google_ads`,
`microsoft_ads`, `tiktok_ads`, `linkedin_ads`, `slack`, `zoho_crm`.
**`connectPath: null`** — no connection flow at all — for **Meta Lead Ads,
Twilio SMS, WhatsApp, Google Calendar, Calendly, HubSpot and Salesforce**.

**Gaps — webhooks.** Only three exist: `linkedin-ads`, `stripe`, `twilio`
([api/webhooks/](../src/app/api/webhooks/)). Missing: Meta lead webhook, Google
Ads lead-form webhook, Calendly signed webhooks, TikTok webhooks, HubSpot.

| Provider | Remaining |
|---|---|
| Meta Lead Ads | OAuth, lead webhook, page/form mapping, token refresh, app review |
| Google Ads | **Adopt the programme's webhook-key model** — drop the OAuth dependency for basic lead delivery; generate URL + key, dedupe on `lead_id` |
| LinkedIn | Confirm `r_marketing_leadgen_automation` and Lead Sync product approval; verify no code targets the sunset 202508 version |
| TikTok | Custom API + Webhooks, not polling |
| Google Calendar | OAuth with minimum scopes, free/busy, event read/write |
| Calendly | OAuth 2.1 + signed webhook subscriptions |
| Slack | Connect route exists; verify channel-scoped incoming-webhook vs `chat:write` |
| Twilio / WhatsApp | Inbound webhook exists; account configuration UI and template approval do not |
| HubSpot / Salesforce | OAuth + object mapping; `crm-registry.ts` and `hubspot.ts` exist as stubs |
| Zoho | Connect route exists; sync depth unverified |
| Microsoft Ads | **Put behind a capability flag.** A connect route exists; the supported production lead-retrieval interface is unconfirmed. Do not ship an "Available" button on marketing-page evidence alone. |

**Effort:** 30–40 days, plus provider approval waits. Meta and LinkedIn are the
long poles and should start immediately regardless of build order.

---

## §5 — Inbound connectors · **PARTIAL**

**Built.** All 11 connectors are registered
([apps.ts](../src/lib/integrations/apps.ts)): Pipedrive, Instantly, Clay, folk,
Smartlead, Breakcold, webhooks, Zapier, HeyReach, SmartReach, Attio. Ingest lands
at [api/apps/](../src/app/api/apps/) with `workspace_app_installs` /
`workspace_app_events`, and migration
[0059](../supabase/migrations/0059_connector_credential_model.sql) defines the
credential model.

**Gaps.** Of the programme's 16 per-connection features, present are endpoint,
secret, enable/disable and delete. **Missing:** HMAC signing option, secret
rotation, field mapper UI, example payload, copy-cURL, test event, last-received
and last-successful display, failed-event list, event replay, imported-record
count, per-connector dedupe rules. Provenance columns (`source_provider`,
`source_record_id`, `raw_event_id`, `consent_metadata`, `original_fields`) need
verifying against `prospect_data_sources`, which has partial coverage.

**Effort:** 12–15 days. High value per day — mostly UI over data that already
exists.

---

## §6 — Campaign mailboxes · **PARTIAL**

**Built.** `mailbox_connections` already supports `GOOGLE` / `MICROSOFT` /
`IMAP_SMTP` with `secret_ref`, `scopes`, `sync_cursor` and status.
`sender_identities` exists. `mailbox_health_snapshots` tracks sent, bounce,
complaint, reply and throttled counts plus a `HEALTHY|WATCH|WARNING|PAUSED` state.
**`domain_health_snapshots` already carries `spf_state`, `dkim_state`,
`dmarc_state` and `dmarc_policy`.** Resend is correctly separated as platform
email.

**Gaps.** No Google Workspace OAuth button and no Microsoft 365 OAuth button —
`GOOGLE` and `MICROSOFT` are schema values with no flow behind them. The 12-point
green-Connected test the programme specifies does not exist; today's test is
login-level. The SPF/DKIM/DMARC columns are read by
[v4-extras.ts](../src/lib/analytics/v4-extras.ts) and
[campaigns/sender.ts](../src/lib/outreach/campaigns/sender.ts) but need a checker
job to populate them. Envelope encryption for mailbox secrets needs confirming
against the KMS requirement.

**Effort:** 10–14 days.

---

## §7 — Integration registry and counters · **PARTIAL**

**Built.** `integrations`, `integration_secrets`, `integration_objects`,
`integration_oauth_states`, `field_mappings`, `webhook_events`, `sync_runs`,
`sync_conflicts`, `rate_limits`, `platform_provider_checks` and
`external_connections` all exist. Status is already derived, not hard-coded
([catalog.ts:425](../src/lib/integrations/catalog.ts#L425)).

**Gaps.** No four-way count split (managed 14 / connectors 11 / mailboxes /
discovery providers) — the UI shows one undifferentiated "14 total", exactly the
ambiguity the programme calls out. Against the programme's table list, most of
the "missing" tables map onto existing tables under different names, so this is
largely a naming-reconciliation exercise, **not** 11 new tables. The status enum
needs extending with `CONNECTING`, `AUTH_EXPIRED`, `RATE_LIMITED` and
`PLATFORM_UNAVAILABLE`. Error streak, token expiry, webhook age and average
latency are not surfaced.

**Effort:** 6–8 days.

---

## §8 — nano + mini routing · **BUILT** (retained on Azure, per decision)

**This section is essentially already done, and done well.**
[model-router.ts](../src/lib/ai/model-router.ts) is the single routing decision
point — `deploymentFor()` sends `FAST_STRUCTURED_TASKS` to nano and everything
else to mini, and the comment explicitly records that callers never pick a
deployment "so it can't drift task-by-task". `ai_runs.deployment` is already
constrained to `nano` or `mini`. Every call is schema-validated, confidence-banded,
metered, and token-gated **before** the call, with a deterministic fallback on
`AI_UNAVAILABLE` or `NO_TOKENS`.

**Decision recorded:** stay on **Azure OpenAI (EU)** per CLAUDE.md
resolved-conflict #1, mapping the programme's nano/mini split onto the equivalent
Azure-deployed tiers. EU data residency is preserved, and no change to the routing
structure is needed — only the deployment names and the price book.

**Gaps.** Only 2 of 9 task types route to nano (`intent_classification`,
`answer_extraction`). The programme's nano list adds language detection,
unsubscribe detection, lead field normalization, basic summarization,
deduplication assistance, lightweight ranking and background signal
interpretation — **none of which exist as task types**
([schemas.ts:10](../src/lib/ai/schemas.ts#L10)). `conversation_summary` should
move to nano. The "enrichment fact generation is NEVER an LLM" rule is correctly
honoured today — enrichment goes through real providers — and should be written
into the prompt registry as an explicit guard so it cannot regress.

**Effort:** 4–6 days.

---

## §9 — AI token tracking · **BUILT**

`ai_runs` already carries exactly the programme's fields: `input_tokens`,
`cached_input_tokens`, `output_tokens`, `estimated_cost_usd`, `task_type`,
`deployment`, `prompt_key`, `prompt_version`, `latency_ms`, `confidence` and
`status`. `ai_token_ledger` is immutable-shaped (signed `delta_tokens`, no
updates) with a **unique idempotency index** so a retried worker cannot debit
twice, plus `balance_after` and a typed `reason`. `cost_events` and
`business_cost_daily` handle provider cost and rollup. The router debits the
**true** cost rather than the estimate, and does so even when the response fails
schema validation — with a comment explaining that hiding a billed call from the
customer's meter would misrepresent their usage. This is the strongest system in
the codebase.

**Gaps.** `ai_token_ledger` has no `user_id` or `agent_id`, and no
`internal_cost_gbp` or `billable_tokens` — only `delta_tokens`, with USD estimates
living on `ai_runs`. The "Roughly 23,528 more assistant replies" copy needs
replacing with "Estimated ~23,500 Copilot interactions remaining based on your
recent average", driven by a trailing-30-day average; it is a fixed divisor today
in [tokens.ts](../src/lib/billing/tokens.ts).

**Effort:** 3–4 days.

---

## §10 — AI budgets by category · **MISSING**

`ai_runs.task_type` is the only dimension available. The programme's five usage
categories — Interactive (Copilot), Agent, Classification, Research,
Summarisation — do not exist as a concept, so there is no per-category budget, no
per-category display, and no way to see that agents consumed 4.8M tokens without
a user pressing anything. `agent_budgets` provides per-agent ceilings but not
per-category ones. Admin has `economics` and `business_margin_monthly` but no
model-level margin analytics.

**Effort:** 5–7 days. Mostly a `feature` column plus aggregation and two surfaces.

---

## §11 — Enrichment commercial system · **PARTIAL**

**Built.** Five providers exist —
[apollo](../src/lib/find-leads/server/providers/apollo.ts),
[clearbit](../src/lib/find-leads/server/providers/clearbit.ts),
[hunter](../src/lib/find-leads/server/providers/hunter.ts),
[google-places](../src/lib/find-leads/server/providers/google-places.ts) and
[website-intent](../src/lib/find-leads/server/providers/website-intent.ts) —
behind a **cost-aware waterfall**
([router.ts](../src/lib/find-leads/server/providers/router.ts)) that reserves
spend before a call, settles after, and returns `budgetExhausted` to stop the run.
`provider_price_book` and `sourcing-allowances` exist.

**Gaps.** Enrichment is not a separate commercial dimension: there are no
`email_enrichment_limit` / `phone_enrichment_limit` / `company_enrichment_limit`
entitlements, and no enrichment credits distinct from sourcing allowance. The six
named actions (Enrich contact, Find work email, Verify email, Find phone, Enrich
company, Full enrichment) are not exposed as user-triggered operations, and the
button appears on none of the eight required surfaces. There is no
"Uses 1 email lookup + 1 phone lookup + 1 enrichment credit → Confirm" dialog and
no bulk "Enrich 127 selected · maximum charge X credits" preview. Charge-on-outcome
— bill for a verified email, not an empty provider response — is not implemented,
though `prospect_enrichments.status` already distinguishes `NOT_FOUND` from
`SUCCESS`, so the data to do it is present.

**Effort:** 12–16 days.

---

## §12 — Truthful enrichment provenance · **PARTIAL**

**Built.** `prospect_enrichments` records `provider`, `enrichment_type`, `status`
(`SUCCESS` / `NOT_FOUND` / `FAILED` / `SKIPPED_BUDGET` / `SKIPPED_GATE`),
`result_json`, `cost_minor`, `requested_at` and `completed_at`.
`prospect_verifications` records `channel`, `provider`, `result` (`VALID` /
`RISKY` / `INVALID` / `CATCH_ALL` / `UNKNOWN` / `UNVERIFIABLE`), `score` and
`verified_at`. `prospect_data_sources` carries source provenance. This is close to
the programme's model already.

**Gaps.** Phone statuses lack `likely_mobile` and `landline`. There is no
per-field provenance display — the "Verified work email · Provider verified ·
7 Sep 2026" chip does not exist on any surface, so the data is captured but never
shown to the customer. `verification_method` is not an explicit column; it lives
inside `detail_json`.

**Effort:** 5–7 days.

---

## §13 — Contactability / Data Permission Engine · **BUILT**

**This is the strongest evidence that the programme underestimates the codebase.**
[policy/service.ts](../src/lib/policy/service.ts) is a complete implementation:
per-channel evaluation across `EMAIL` / `SMS` / `WHATSAPP` / `SOCIAL`, a
`contact_permissions` lookup where **absent permission is explicitly `UNKNOWN`,
not denied**, suppression via `checkSuppression`, a jurisdiction pack selected by
country, subscriber type, relationship type, consent status and evidence, sender
health, caps, budget, and quiet hours computed in the **recipient's** timezone
with a safe fallback. Decisions are persisted to `contactability_results` with the
policy version and a full evidence snapshot, so an audit can reconstruct a
decision after the pack changes. The recording function is documented as never
throwing — a failure to record must neither block a permitted send nor allow a
refused one.

`evaluateAllChannels` returns the exact per-channel grid the programme asks for
(`email_permission`, `sms_permission`, and so on), and `summariseEligibility`
produces the single label.

**Gaps.** The outcome vocabulary needs mapping onto the programme's labels
(`Unknown jurisdiction`, `Insufficient provenance`, `Provider terms prohibit use`).
`PolicyInput` has no notion of **source provenance or data licence** — see §17.

**Effort:** 3–5 days.

---

## §14 — Settings → Data Controls & Compliance · **MISSING**

Settings has four sections today — `workspace`, `connections`, `team`, `billing`
([app/settings/](../src/app/(app)/app/settings/)). There is no Business Profile
section and no Data Controls & Compliance section, so **none** of the programme's
sub-surfaces exist: organisation legal identity, markets, prospect type, allowed
sourcing sources, marketing legal basis, suppression management, retention
configuration, compliance evidence.

The **data** largely exists — `compliance_policy_versions`, `suppression_entries`,
`contact_suppressions`, `privacy_requests`, `privacy_notice_events`,
`business_profiles`, and a `retention-cleanup` job handler. It has no UI.

Adding this as a sixth Settings section is compatible with the locked
5-destination IA (CLAUDE.md resolved-conflict #0), since Settings sub-sections are
not top-level destinations.

**Effort:** 12–15 days.

---

## §15 — Jurisdiction packs, not a global flag · **BUILT**

[packs.ts](../src/lib/policy/packs.ts) loads versioned packs from
`compliance_policy_versions` as jsonb and narrows every field defensively, with an
explicit rule that **a malformed pack degrades to the most restrictive
interpretation** — `readChannels` returns an empty array (nothing allowed) rather
than a default list. The fallback pack "permits nothing cold and nothing but email
warm", so a database failure can never widen what the product sends. Subscriber
types already distinguish `CORPORATE`, `SOLE_TRADER`, `PARTNERSHIP`, `INDIVIDUAL`
and `UNKNOWN` — precisely the UK ICO distinction the programme describes.

**Gaps.** Pack **content** per jurisdiction needs authoring and legal review —
UK/PECR, EU/ePrivacy, US/CAN-SPAM plus TCPA (email permission must not imply SMS
permission), Canada/CASL, Australia/Spam Act, New Zealand. The machinery is done;
the rules are data.

**Effort:** 4–6 days of engineering, plus legal review time.

---

## §16 — Official data sources · **PARTIAL**

Google Places and website-intent exist. **Missing:** Companies House (UK), EU TED,
SEC EDGAR, Corporations Canada, NZBN and ACRA. All are unauthenticated or
low-friction public APIs, so each is small.

The important architectural rule — these provide **company discovery and evidence,
not outreach authorisation** — needs enforcing as a link from source to the policy
engine's provenance input (§17). Otherwise adding registries quietly widens what
the product will contact.

The prohibited-source list (breached databases, unprovenanced purchased lists,
harvested personal emails and consumer phone lists, scraping authenticated
profiles, licence-prohibited datasets) is **not encoded anywhere** — there is no
allowed-sources configuration to enforce it against.

**Effort:** 8–12 days.

---

## §17 — Policy engine fails closed · **PARTIAL**

**Built.** Of the programme's 13-step chain, steps 3–12 are implemented in
[channel-policy.ts](../src/lib/policy/channel-policy.ts) and evaluated at the
right moment on the outreach path —
[dispatch.ts:262](../src/lib/outreach/dispatch.ts#L262) calls `evaluate()`
immediately before dispatch, not at campaign creation. Agent ticks do the same.
Fail-closed behaviour is explicit and documented.

**Two real gaps.**

1. **The follow-up path uses a different gate.**
   [send-core.ts](../src/lib/jobs/send-core.ts) — described in its own header as
   the "single guarded outbound path, shared by `message.send` and
   `campaign.send`" — checks stop conditions and quiet hours only. It never calls
   `policy/service.evaluate()`, so a follow-up SMS is not evaluated against the
   jurisdiction pack, subscriber type or consent status. **This is the most
   significant compliance gap in the codebase** and should be fixed early,
   independent of the rest of the programme.

2. **Steps 1, 2 and 5 are absent from the model.** `PolicyInput` has no
   `sourcePermitted`, no `dataLicencePermitsUse` and no
   `businessRelevanceEstablished`. A prospect from a prohibited source is
   indistinguishable from one from Companies House.

**Effort:** 6–9 days.

---

## §18 — One authoritative usage ledger · **PARTIAL**

**Built.** `usage_events`, `usage_counters`, `usage_reservations`,
`customer_usage_allocations`, `billing_credit_entries`, `cost_events`,
`business_cost_daily` and a `usage-aggregate` job. Reservation semantics already
exist, which is more than the programme asks for.

> **Correction (2026-09-07).** An earlier revision of this section claimed the
> `usage_events.metric` CHECK constraint permitted only five values and would
> reject every new metric. That was wrong: it was read from
> [0009_platform.sql](../supabase/migrations/0009_platform.sql) without following
> the later ALTERs. [0018](../supabase/migrations/0018_ai_usage_billing.sql) and
> [0038](../supabase/migrations/0038_v4_core_extensions.sql) widen it to 26
> metrics, already including `enrichment_unit`, `verification_unit`,
> `discovery_lookup`, `search_run` and `verified_prospect`. The real gap is
> below, and it is a different problem.

**The real gap is that the ledger has four writers, and only one of them is
typed.** `recordUsage` ([audit.ts:239](../src/lib/audit.ts#L239)) accepts a
five-value TypeScript union — the 0009 list, never widened when the database
was. So callers needing any of the other 21 metrics bypass it and hand-roll
their own insert:
[usage-meter.ts:112](../src/lib/ai/usage-meter.ts#L112),
[find-leads/server/runs.ts:222](../src/lib/find-leads/server/runs.ts#L222) and
[sourcing-run.ts:1878](../src/lib/jobs/handlers/sourcing-run.ts#L1878).
`runs.ts` calls **both** in the same function — `recordUsage` for the metric the
type allows, a raw insert for `search_run` immediately after. This is precisely
the "counters manually incremented in random parts of the codebase" the
programme sets out to end.

Also missing: the row shape has no `unit`, `feature`, `provider`, `entity` or
`operation_id`, so a ledger entry cannot be traced to the operation that caused
it or be made idempotent. Immutability is not enforced — no trigger blocks
updates — and the refund pattern (`+1`, then a compensating `-1`, never
rewriting history) is not implemented. Metrics still genuinely absent are agent
runs, MCP calls, integration API calls, and enrichment split by kind
(email/phone/company rather than one `enrichment_unit`).

**Effort:** 6–8 days.

---

## §19 — Effective sending limits · **PARTIAL**

**Built.** `warmupAllowance()`
([variant-allocation.ts:66](../src/lib/outreach/variant-allocation.ts#L66)) grows
a new mailbox linearly to its cap over `warmupDays`. Sender health is a
first-class `HEALTHY|WATCH|WARNING|PAUSED` state on both mailbox and domain
snapshots, and the policy engine already takes `senderHealth` and
`senderAvailable` as inputs — so a plan limit **cannot** currently override a
paused sender.

**Gaps.** The five-way `min(plan, workspace, sender-health, provider, compliance)`
is not computed in one place, and the resulting effective ceiling is never shown.
The programme's key UX point — a customer setting 2,000/day and being told
"Current safe sending ceiling: 40/day" — has no surface.

**Effort:** 5–7 days.

---

## §20 — Admin → Platform Readiness tracker · **MISSING**

Admin has Overview, Customers, System, Billing, Economics, Support, Affiliates and
Settings ([app/admin/](../src/app/admin/)). There is no readiness tracker: no
20-area matrix, no per-test owner / severity / environment / build-SHA / evidence
record, no regression or blocking status. `platform_error_triage`,
`platform_provider_checks` and `platform_feature_flags` exist and give it
somewhere to draw from.

**Effort:** 8–10 days.

---

## §21 — Implementation order · assessment

Your order is sound. Three amendments based on what the code shows:

1. **Insert a step 0: fix the follow-up compliance gate** (§17, finding 1). It is
   a live compliance exposure, it is small, and it should not wait behind a
   refactor.

2. **Start Meta and LinkedIn provider approval now, in parallel with step 1.**
   Both have review queues measured in weeks. Nothing about the service layer
   blocks submitting them.

3. **Step 3 (Copilot) is larger than the order implies** — it is a build, not a
   finish, because there is no model in the loop. Consider splitting it: the
   typed tool registry and result envelope belong with step 1; the model-driven
   planning loop is its own phase.

The four-route acceptance test (UI, Copilot, agent and MCP producing identical
database state, billing events, permission decisions and audit history) is the
right definition of done, and it is only achievable if step 1 genuinely
consolidates the three tool layers. If those layers survive step 1, the four
routes will diverge and the test will fail for reasons no one can localise.

---

## Ranked by value per day

| # | Work | Days | Why here |
|---|---|---|---|
| 1 | Follow-up compliance gate → policy engine | 2–3 | Live compliance exposure |
| 2 | One typed ledger writer + row shape | 3–4 | Four writers today; only one is typed |
| 3 | Core service layer + result envelope | 15–20 | Everything else gets cheaper |
| 4 | MCP client/token provisioning | 4–5 | MCP is currently unreachable |
| 5 | Meta + LinkedIn app submissions | 2 | Long external lead time |
| 6 | Copilot model loop + tool expansion | 25–35 | Largest gap |
| 7 | Connector management UI (§5) | 12–15 | High value, mostly UI over existing data |
| 8 | Settings → Data Controls & Compliance | 12–15 | Unblocks the compliance story commercially |
