# 19 · Missing Architecture Register

Ranked P0 (production blocker) → P3 (improvement). Each entry names the missing thing, the
failure it causes, and where the fix belongs.

---

## P0 — production blockers

Three of six are fixed in the working tree. **`0063` is written and not deployed**, and production
is separately a migration behind on `0054` — see [24 · R1](24-remediation-log.md).

| # | Missing | Failure | Fix |
|---|---|---|---|
| **P0-0** | **`0054_v4_expansion.sql` has never been applied to production.** Copilot has no tables, follow-up email steps cannot be saved, outreach guidance and campaign send windows have nowhere to write | Found while restoring the typecheck; verified against the live database (172 tables, zero `copilot_*`) | Made re-runnable; needs a deploy — [24 · R1](24-remediation-log.md) |
| ~~P0-1~~ | ~~A working `promote_reviewed_prospect()`~~ | **FIXED in `0063_fix_prospect_promotion.sql`** — not yet deployed | [24 · R2](24-remediation-log.md) |
| ~~P0-2~~ | ~~Provenance columns populated on promotion~~ | **FIXED in the same migration** — all eight columns, the company snapshot and the `contact_permissions` row | [24 · R2](24-remediation-log.md) |
| **P0-3** | One suppression list | An SMS `STOP` does not suppress cold email; a cold-email opt-out does not suppress warm SMS. UK PECR/GDPR exposure | Merge `contact_suppressions` into `suppression_entries` — [11 · 1.3](11-compliance-permission-mesh.md) |
| **P0-4** | A single implementation per business action | MCP `update_lead_status` leaves `won_at` null, keeps automation running on won leads, and skips the CRM push. Copilot and MCP `assignLead` skip assignment history and audit | Add an `actor` parameter to `lib/*/actions.ts`; make Copilot and MCP call them — [18 · D1/D2](18-duplication-bloat-register.md) |
| ~~P0-5~~ | ~~One reply-rate definition~~ | **DONE.** One rule (`rate()`), one recipient-level source (`analytics/engagement.ts`), consumed by Analytics, Copilot, Reactivation, Leads and Billing. The message-level per-channel figure is renamed `replies_per_delivered` rather than mis-computed | [24 · R8/R8b](24-remediation-log.md) |
| **P0-6** | Metering and enforcement of `email_sent` | The cold-email allowance — the acquisition product's revenue meter — is displayed and never consumed or enforced | Record `usage_events` at dispatch; call `assertCapacity` — [12 · 12.2](12-usage-billing-mesh.md) |

## P1 — critical

| # | Missing | Failure | Fix |
|---|---|---|---|
| **P1-1** | Meta Lead Ads implementation | No OAuth adapter, no poller, no webhook — yet Meta is in the catalogue, the onboarding flow, the Dashboard health strip, the agent source list and the admin provider panel. Onboarding step 2 waits for a connection that cannot happen | [09 · I1](09-integration-mesh.md) |
| **P1-2** | Warm sends passing through `ChannelPolicyService` | No `compliance_decisions` row for any SMS, WhatsApp, follow-up or reactivation message. `contact_permissions` is never read on the warm path | [11 · 1.2](11-compliance-permission-mesh.md) |
| **P1-3** | A consumer for `mcp_approvals` | Four MCP tools correctly park instead of executing, and are then never approved or run. The caller is promised a review that cannot happen | [10 · M1](10-ai-copilot-mcp-mesh.md) |
| **P1-4** | Email reply from the Inbox, and reply on a prospect conversation | The primary cold channel is receive-only in the unified inbox. `canReplyOn()` requires SMS/WhatsApp **and** a lead | [07 · C](07-messaging-conversation-mesh.md) |
| **P1-5** | Messenger / Instagram ingestion, or removal of the tabs | Three Inbox channels can never populate. `inbox_channels` and eight columns on `conversations`/`messages` are schema with no software | [07 · C](07-messaging-conversation-mesh.md) |
| **P1-6** | `variant_generation` in the prompt registry | AI spend with no prompt version, no token capacity check, no `ai_runs` row, no cost event. Invisible to the customer's meter and to margin reporting | [10 · A1](10-ai-copilot-mcp-mesh.md) |
| **P1-7** | `getV4Usage` as a SQL `sum()` | Fetches rows and sums in JS; past the PostgREST row cap the allowance silently stops being enforced | [12 · 12.3](12-usage-billing-mesh.md) |
| ~~P1-8~~ | ~~Correct settings deep links~~ | **DONE** — [24 · R4](24-remediation-log.md) | |
| **P1-9** | One acquisition-campaign UI | Two builders write the same table with different validation, and both render on the same page | [18 · D5](18-duplication-bloat-register.md) |
| **P1-10** | A route-guard test | Authorisation lives in layouts, pages and actions; `proxy.ts` performs none. A new route that forgets its guard is silently public | [11 · 2.3](11-compliance-permission-mesh.md) |
| ~~P1-11~~ | ~~Per-row import classification UI~~ | **DONE** — [24 · R10](24-remediation-log.md) | |
| **P1-12** | A `SUPPRESSED`/`BLOCKED` terminal state on `messages` | A blocked send is indistinguishable from a failed one, and `FAILED` is counted in the "sent" denominator of every rate | [16 · §6](16-state-machines.md) |
| **P1-13** | `createPolicyVersion` reachable from the UI | The versioned compliance pack that the whole policy engine reads cannot be authored from inside the product | [13 · §4](13-page-action-button-audit.md) |
| ~~P1-14~~ | ~~Booking status transitions~~ | **DONE** — [24 · R14](24-remediation-log.md) | |

## P2 — important

| # | Missing | Notes |
|---|---|---|
| **P2-1** | An event bus. `automation_events` has 16 emitters, 28 declared types and **zero readers** | Transactional outbox over the existing job queue — [15 · F](15-event-catalogue.md) |
| **P2-2** | `correlation_id` / `causation_id` on jobs and events | "Why did this message go out?" cannot be traced across a five-job chain |
| **P2-3** | One audit history | Three trails (`audit_log`, `mcp_audit_logs`, `copilot_actions`); which holds the answer depends on the door the change came through |
| **P2-4** | A unique constraint on `leads (business_id, lower(email))` and `(business_id, phone_normalized)` | Duplicates are prevented only in application code, and MCP `create_lead` does not call it |
| **P2-5** | Idempotency on the MCP `create_lead` tool | No client-supplied idempotency key; a retried call creates a second lead |
| **P2-6** | Rate limiting on `/api/mcp` | `security/rate-limit.ts` and `consume_rate_limit()` exist and are not applied there |
| **P2-7** | The feedback loop. `search_feedback` and `campaign_learnings` are never written | The "Learn" quarter of the V4 thesis is open at both ends — [06 · F](06-prospect-lead-data-flow.md) |
| **P2-8** | `business_learning_events` writers | Read at `business-profile/queries.ts:75` to power a panel that is permanently empty |
| **P2-9** | `agent_tool_calls` and `agent_budgets` writers | Worker agents have narrative activity but no structured tool-call log and no per-agent spend ceiling |
| **P2-10** | Fairness in `scheduleAgents()` | Claims at most 3 due agents per 30-second tick with no ordering. A starvation risk at a few hundred active agents |
| **P2-11** | Cleanup of abandoned wizard artefacts | Orphan DRAFT campaigns, non-terminal `lead_imports`, services created by an abandoned Add Lead wizard — [14 · X2](14-wizard-state-audit.md) |
| **P2-12** | `campaigns.draft_state jsonb`, then a server draft for the Reactivation wizard | Its `sessionStorage` draft survives a refresh but not the tab. **Corrected** — see [14 · §3](14-wizard-state-audit.md); the column is required, not optional, because `WizardState` carries the analysed CSV |
| **P2-13** | Compensation after a partial CRM push | `crm.push` can create the contact and fail on the deal, leaving partial state in the customer's CRM with nothing recording it |
| **P2-14** | Booking provider adapters (Calendly, Google Calendar) | `booking.sync` is a registered job with no provider behind it |
| **P2-15** | An admin reader for `workspace_app_events` | Connector events are received and stored, and no operator can see them |
| **P2-16** | Real health probes beyond Twilio | For every other provider, HEALTHY means "we hold a token", not "the integration works" |

## P3 — improvement

| # | Missing |
|---|---|
| P3-1 | `loading.tsx` for `/app/analytics`, `/app/leads/import`, `/app/agents/new` |
| P3-2 | Explicit transition tables for the warm campaign and lead machines, following `outreach/campaign-state.ts` |
| P3-3 | CHECK constraints for the impossible states in [16](16-state-machines.md) |
| P3-4 | Consistent status casing, with a CI test that inserts every enum value |
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
| **S1** | `analytics/v4-extras.ts` — nine queries with `.limit(50000)` | Fetches up to 50k rows into Node and aggregates in JS | A workspace with >50k messages in a range gets **silently truncated analytics**. This is a correctness bug at scale, not just a slow page |
| **S2** | `billing/v4-entitlements.getV4Usage` | Fetches every matching `usage_events` row and sums in JS, with no explicit limit — so the PostgREST cap applies | ~1,000 usage events per metric per period |
| **S3** | `business-profile/queries.ts:82` | `prospects.select("icp_profile_id").limit(5000)` then counts in JS | 5,000 prospects |
| **S4** | `admin/customers.ts`, `admin/overview.ts`, `admin/health.ts`, `admin/economics.ts`, `admin/providers.ts` | `.limit(20000)` scans across all workspaces | Platform-wide totals go wrong as the customer base grows |
| **S5** | `campaigns/queries.resolveAudience` | Audience resolution reads `filter_config` jsonb with no jsonb path index | Large lead tables |
| **S6** | `jobs` claiming one row at a time | One round trip per job | Job throughput, not correctness. The comment explains the trade-off and it is currently the right one |

**The pattern:** aggregation is done in JavaScript over a capped row fetch. Where a limit is
reached, the answer is *wrong* rather than *slow*, and nothing tells anyone. The codebase already
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
| Why was this usage charged? | ⚠️ | `usage_events.source` + `metadata`; but `email_sent` is never charged and `generateVariants` never recorded |
| Why is this integration unhealthy? | ⚠️ | `integrations.last_error_code/message`; but only Twilio has a real probe |
| Who changed this lead's owner? | ⚠️ | Three audit trails, and Copilot/MCP assignments write no `lead_assignments` row |
| Why did this send go out? | ❌ warm / ✅ cold | `compliance_decisions` exists only for cold |

The gaps are the same P0/P1 items above. Fixing them closes the observability gaps as a side
effect, which is the strongest argument for the sequencing in
[21](21-consolidation-migration-plan.md).
