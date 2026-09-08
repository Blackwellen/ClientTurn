# 19 · Missing Architecture Register

Ranked P0 (production blocker) → P3 (improvement). Each entry names the missing thing, the
failure it causes, and where the fix belongs.

---

## P0 — production blockers

**Five of six P0s are fixed.** Only P0-4 — one implementation per business action — remains, and
the concurrent stream is building `src/lib/services/` for exactly that.

**Every migration is deployed and verified**, and that is now a command rather than a claim:
`npm run schema:drift` reports 186 tables, 83 functions and 336 indexes with zero missing, and a
reconciled migration ledger. See [24 · R25](24-remediation-log.md).

Entries below are re-verified against the code rather than carried forward. Where the concurrent
stream has closed something, it is struck and marked; where an entry's *premise* has become false
— P1-1 is the example — it is rewritten rather than quietly deleted, because the original claim is
part of the audit's record.

| # | Missing | Failure | Fix |
|---|---|---|---|
| ~~P0-0~~ | ~~`0054_v4_expansion.sql` never applied to production~~ | **DEPLOYED.** Verified: 175 tables, all three `copilot_*` present | [24 · R1](24-remediation-log.md) |
| ~~P0-1~~ | ~~A working `promote_reviewed_prospect()`~~ | **FIXED AND DEPLOYED.** Verified in the live function body | [24 · R2](24-remediation-log.md) |
| ~~P0-2~~ | ~~Provenance columns populated on promotion~~ | **FIXED AND DEPLOYED** — all eight columns, the company snapshot and the `contact_permissions` row | [24 · R2](24-remediation-log.md) |
| ~~P0-3~~ | ~~One suppression list~~ | **DONE AND DEPLOYED** — `0069`. Every reader and writer repointed through `lib/policy/suppression.ts`; a structural test stops a new send path reattaching to the deprecated table | [24 · R18](24-remediation-log.md) |
| **P0-4** | A single implementation per business action | MCP `update_lead_status` leaves `won_at` null, keeps automation running on won leads, and skips the CRM push. Copilot and MCP `assignLead` skip assignment history and audit | Add an `actor` parameter to `lib/*/actions.ts`; make Copilot and MCP call them — [18 · D1/D2](18-duplication-bloat-register.md) |
| ~~P0-5~~ | ~~One reply-rate definition~~ | **DONE.** One rule (`rate()`), one recipient-level source (`analytics/engagement.ts`), consumed by Analytics, Copilot, Reactivation, Leads and Billing. The message-level per-channel figure is renamed `replies_per_delivered` rather than mis-computed | [24 · R8/R8b](24-remediation-log.md) |
| ~~P0-6~~ | ~~Metering and enforcement of `email_sent`~~ | **DONE** — the allowance is checked before the dispatch loop and each send records `usage_events` keyed by the send key, which `0062`'s unique partial index makes idempotent across a provider retry | [24 · R19](24-remediation-log.md) |

## P1 — critical

| # | Missing | Failure | Fix |
|---|---|---|---|
| **P1-1** | *(rewritten — the original premise is now false)* Meta self-serve connect | The audit said "no OAuth adapter, no poller, no webhook". **All three now exist**: the adapter registers, `registerLeadSourcePoller("meta")` is live, and `/api/webhooks/meta` verifies the signature and queues both lead forms and inbound messages. What remains is only the last mile — `connectPath` is still `null`, so a customer cannot connect Meta themselves and onboarding step 2 still waits. That is **deliberate**: the flow has never run against a real Meta app, and `public-pages.test.ts` asserts the null to keep the enterprise copy honest | [09 · I1](09-integration-mesh.md) |
| ~~P1-2~~ | *(premise was partly false; the real gap was worse)* ~~Warm sends through `ChannelPolicyService`~~ | **DONE.** Warm sends already called `evaluate()` and did read `contact_permissions`. What was missing: `compliance_decisions` — the append-only evidence trail — was written by **nothing**, while the admin review queue read it. `recordDecision` now appends one row per real gate | [24 · R28](24-remediation-log.md) |
| ~~P1-3~~ | ~~A consumer for `mcp_approvals`~~ | **DONE** by the concurrent stream — `mcp/provisioning.ts` reaches the `EXECUTED` state. Verified, not assumed | |
| ~~P1-4~~ | ~~Email reply from the Inbox~~ | **DONE** for email and the social channels, and one reply gate now serves both the composer and the server. **Prospect conversations remain unreplyable** and now say why: `send-core` resolves policy against a lead and refuses without one, so a composer there would create a message that could not be gated | [24 · R29](24-remediation-log.md) |
| ~~P1-5~~ | ~~Messenger / Instagram ingestion, or removal of the tabs~~ | **DONE** by the concurrent stream. Six channels are `ingestion: "live"`; LinkedIn is the honest exception at `"recorded"` — it fills from the social outreach queue rather than from a sync, because no API lets an application read a member's inbox. Verified against `CHANNEL_DEFINITIONS`, not assumed | |
| ~~P1-6~~ | ~~`variant_generation` in the prompt registry~~ | **DONE** — routed through `runTask`, so it carries a prompt version, passes the token gate before spending, writes `ai_runs` and a cost event, and is filed under `outreach` alongside the sends | [24 · R27](24-remediation-log.md) |
| ~~P1-7~~ | ~~`getV4Usage` as a SQL `sum()`~~ | **DONE AND DEPLOYED** — `0074`. `sum_usage_events` sums in Postgres, and a failed read now throws rather than returning 0, because 0 is the permissive answer | [24 · R22](24-remediation-log.md) |
| ~~P1-8~~ | ~~Correct settings deep links~~ | **DONE** — [24 · R4](24-remediation-log.md) | |
| ~~P1-9~~ | ~~One acquisition-campaign UI~~ | **DONE.** Creation had already collapsed to the wizard — `CampaignBuilder` is now two entry points that link to it — and the dead `createCampaignAction` is deleted. The dangerous half remained and is fixed: `setCampaignStatusAction` wrote `status` directly against a looser list than `TRANSITIONS`, permitting `DRAFT → PAUSED`. It now delegates to `transition()` | [24 · R30](24-remediation-log.md) |
| ~~P1-10~~ | ~~A route-guard test~~ | **DONE** — `tests/route-guards.test.ts`, 44 assertions. Every page is in a declared guarded or public tree, every one of the 30 route handlers declares its mechanism by name, and each public endpoint carries a written justification. It found no live defect: every route on disk is guarded today | [24 · R21](24-remediation-log.md) |
| ~~P1-11~~ | ~~Per-row import classification UI~~ | **DONE** — [24 · R10](24-remediation-log.md) | |
| ~~P1-12~~ | ~~A `BLOCKED` terminal state on `messages`~~ | **DONE AND DEPLOYED** — `0083`. A refused send no longer sits in the denominator of every rate, nor on the customer's bill | [24 · R27b](24-remediation-log.md) |
| ~~P1-13~~ | ~~`createPolicyVersion` reachable from the UI~~ | **DONE.** A policy pack could be published and archived from the console but only *created* by hand in the database | [24 · R27c](24-remediation-log.md) |
| ~~P1-14~~ | ~~Booking status transitions~~ | **DONE** — [24 · R14](24-remediation-log.md) | |

## P2 — important

| # | Missing | Notes |
|---|---|---|
| **P2-1** | An event bus. `automation_events` has 16 emitters, 28 declared types and **zero readers** | Transactional outbox over the existing job queue — [15 · F](15-event-catalogue.md) |
| **P2-2** | `correlation_id` / `causation_id` on jobs and events | "Why did this message go out?" cannot be traced across a five-job chain |
| **P2-3** | One audit history | Three trails (`audit_log`, `mcp_audit_logs`, `copilot_actions`); which holds the answer depends on the door the change came through |
| **P2-4** | *(narrowed)* A unique constraint on `leads` | **The MCP half is done** — `create_lead` now runs `findDuplicates` and returns the existing lead, so it is idempotent. The constraint itself is **deliberately not added**: eleven insert paths would turn a duplicate into a hard job failure, and it is a symptom of P0-4 rather than a separate fix |
| ~~P2-5~~ | ~~Idempotency on MCP `create_lead`~~ | **DONE.** An exact email or phone match already *is* the record's identity, so the tool returns the existing lead with `created: false` rather than needing a client-supplied key |
| ~~P2-6~~ | ~~Rate limiting on `/api/mcp`~~ | **DONE** by the concurrent stream — an unauthenticated guess limit and a post-authentication per-caller limit. Verified |
| **P2-7** | The feedback loop. `search_feedback` and `campaign_learnings` are never written | The "Learn" quarter of the V4 thesis is open at both ends — [06 · F](06-prospect-lead-data-flow.md) |
| **P2-8** | `business_learning_events` writers | Read at `business-profile/queries.ts:75` to power a panel that is permanently empty |
| **P2-9** | `agent_tool_calls` and `agent_budgets` writers | Worker agents have narrative activity but no structured tool-call log and no per-agent spend ceiling |
| ~~P2-10~~ | ~~Fairness in `scheduleAgents()`~~ | **DONE.** Ordered longest-overdue first with a deterministic tie-break, so the maximum wait is bounded by the number of due agents rather than by physical row order |
| ~~P2-11~~ | ~~Cleanup of abandoned wizard artefacts~~ | **DONE AND DEPLOYED** — `0088`, on the existing daily sweep. Conservative by construction: a draft is removed only if untouched since creation with no sequence and no recipients, and imports are moved to CANCELLED, never deleted | [24 · R31](24-remediation-log.md) |
| **P2-12** | `campaigns.draft_state jsonb`, then a server draft for the Reactivation wizard | Its `sessionStorage` draft survives a refresh but not the tab. **Corrected** — see [14 · §3](14-wizard-state-audit.md); the column is required, not optional, because `WizardState` carries the analysed CSV |
| ~~P2-13~~ | ~~Compensation after a partial CRM push~~ | **DONE AND DEPLOYED** — `0092`. The contact id now leaves with the failure, so a retry updates rather than creating a second contact; `partial` is a distinct state from `failed` | [24 · R32](24-remediation-log.md) |
| **P2-14** | Booking provider adapters (Calendly, Google Calendar) | `booking.sync` is a registered job with no provider behind it |
| **P2-15** | *(premise stale)* An **admin** reader for `workspace_app_events` | The customer-facing reader exists (`connector-ops.ts`); only a platform-operator view is missing. Reading it found something worse, now fixed: `importedCount`, documented as "events accepted, ever", was counted from a 2,000-row fetch and plateaued there | [24 · R33](24-remediation-log.md) |
| **P2-16** | *(narrowed)* Real health probes beyond Twilio | **The untrue part is fixed**: a token-presence check no longer stamps `last_success_at`, which the connection card renders as "Last sync" — the product was claiming a sync that never happened. HEALTHY still means "the credential is valid as far as we can tell", which is honest. Per-provider `verify` calls remain undone: `identify` is not one (Slack's makes no network call), and guessing eight endpoints would mark working integrations broken | [24 · R34](24-remediation-log.md) |

## P3 — improvement

| # | Missing |
|---|---|
| P3-1 | `loading.tsx` for `/app/analytics`, `/app/leads/import`, `/app/agents/new` |
| P3-2 | Explicit transition tables for the warm campaign and lead machines, following `outreach/campaign-state.ts` |
| P3-3 | CHECK constraints for the impossible states in [16](16-state-machines.md) |
| P3-4 | Consistent status casing, with a CI test that inserts every enum value |
| ~~P3-10~~ | ~~A way to prove the live schema matches the migration set~~ — **DONE**, `npm run schema:drift` ([24 · R25](24-remediation-log.md)) |
| P3-5 | Archive for warm campaigns |
| P3-6 | Conversation assign / snooze / close (`conversations` has the columns) |
| P3-7 | Threaded notes on leads |
| P3-8 | Field mapping for CRM push (`field_mappings` exists, unused) |
| P3-9 | Realtime beyond Find Leads — Inbox in particular |

---

## Performance and scale

Flagged where the architecture will bite, not speculatively.

| # | Location | Pattern | Breaks at |
|---|---|---|---|
| ~~S1~~ | ~~`analytics/v4-extras.ts` — nine queries with `.limit(50000)`~~ | **FIXED** — `0074`. `limit(50000)` now appears zero times in that file; trends, conversion goals, the provider waterfall and campaign promotions are all grouped in SQL | [24 · R22](24-remediation-log.md) |
| ~~S2~~ | ~~`billing/v4-entitlements.getV4Usage`~~ | **FIXED** — `sum_usage_events`, a `security definer` SQL sum granted to `service_role` only | [24 · R22](24-remediation-log.md) |
| ~~S3~~ | ~~`business-profile/queries.ts:82`~~ | **FIXED** — `prospect_counts_by_icp`, grouped in SQL | [24 · R22](24-remediation-log.md) |
| ~~S4~~ | ~~`admin/customers.ts`, `admin/overview.ts`, `admin/health.ts`, `admin/economics.ts`, `admin/providers.ts`~~ | **FIXED AND DEPLOYED** — `0075`, six rollup functions. Queue depth no longer flattens during the backlog that causes it; provider uptime no longer silently shortens its own window; COGS is no longer under-reported in the flattering direction | [24 · R23](24-remediation-log.md) |
| **S5** | `campaigns/queries.resolveAudience` | Audience resolution reads `filter_config` jsonb with no jsonb path index | Large lead tables |
| **S6** | `jobs` claiming one row at a time | One round trip per job | Job throughput, not correctness. The comment explains the trade-off and it is currently the right one |

**This whole class is now closed.** `.limit(20000)` and `.limit(50000)` appear **zero** times in
`src/`. Beyond S1–S4, the sweep in `0090`/`0091` caught five more: the daily cost rollup (which
*persisted* an understated total to `business_cost_daily`, so every margin report downstream read
it), the billing page's six-month history, follow-up performance, connector activity, and the
**public status page** — whose 30-day uptime was computed over however long the most recent 20,000
probes happened to cover, and whose "last working" could read *never* for a provider whose
successes had fallen off the end of the fetch.

**The original pattern:** aggregation is done in JavaScript over a capped row fetch. Where a limit is
reached, the answer is *wrong* rather than *slow*, and nothing tells anyone.

**S1–S4 are now closed** — `0074` ([24 · R22](24-remediation-log.md)) for the customer surfaces
and `0075` ([24 · R23](24-remediation-log.md)) for the operations console. The remaining entries,
S5 and S6, are genuinely performance rather than correctness: S5 is a missing jsonb path index and
S6 is a documented throughput trade-off in job claiming that is currently the right one. The codebase already
knows the right technique — `{ count: "exact", head: true }` and the several purpose-built SQL
rollup functions (`outreach_campaign_performance`, `reactivation_campaign_results`,
`rollup_business_cost_daily`) — it just is not applied consistently.

**Recommendation:** every aggregate over a table that grows per-message or per-prospect becomes a
SQL function. Same move as the metric consolidation in [18 · D3](18-duplication-bloat-register.md),
and they should be done together.

## Observability

Can a production operator answer these? Measured against what exists.

| Question | Answerable | With what |
|---|---|---|
| Why did this lead not send? | ⚠️ partly | `messages.error_code/message`, `jobs` state, `automation_runs`. **Not** a compliance decision — none is recorded for warm sends |
| Why did this agent stop? | ✅ | `agent_activity_events`, `agent_queue_items.status='BLOCKED'` with the reason, `conversation_agent_runs` |
| Why was this prospect rejected? | ✅ | `prospect_scores.explanation` + `prospect_score_factors` + `/app/find-leads/scoring/[id]` |
| Why was this reply not detected? | ⚠️ | `messages.reply_classification` + `reply_confidence` exist; no log of the classifier input |
| Why did this booking not sync? | ❌ | No booking provider adapter exists |
| Why was this usage charged? | ✅ mostly | `usage_events.source` + `metadata`; `email_sent` is now metered ([24 · R19](24-remediation-log.md)) and summed in SQL ([24 · R22](24-remediation-log.md)). `generateVariants` is still unrecorded — P1-6 |
| Why is this integration unhealthy? | ⚠️ | `integrations.last_error_code/message`; but only Twilio has a real probe |
| Who changed this lead's owner? | ⚠️ | Three audit trails, and Copilot/MCP assignments write no `lead_assignments` row |
| Why did this send go out? | ❌ warm / ✅ cold | `compliance_decisions` exists only for cold |

The gaps are the same P0/P1 items above. Fixing them closes the observability gaps as a side
effect, which is the strongest argument for the sequencing in
[21](21-consolidation-migration-plan.md).
