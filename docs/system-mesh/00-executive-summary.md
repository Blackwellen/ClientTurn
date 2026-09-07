# ClientTurn — System Mesh Audit · Executive Summary

**Date:** 2026-09-07 · **Scope:** whole repository (989 TS/TSX files, 65 migrations, 174 tables,
255 server actions, 30 job types, 9 customer routes plus admin, affiliate and marketing shells).
**Status:** first-pass audit complete. Discovery only — **no production code was changed.**

---

## 1. What ClientTurn actually is

Three product generations are alive in one codebase at once, and that single fact explains
almost every duplication in this report.

| Generation | Shipped as | Core tables | Engine |
|---|---|---|---|
| **V3 "Lead Follower"** | warm inbound leads → follow-up → qualification → booking | `leads`, `conversations`, `messages`, `automation_*`, `qualification_*`, `bookings` | `automation.advance` + `message.send` |
| **V3.5 Reactivation** | re-contacting dormant leads | `campaigns`, `campaign_contacts` | `campaign.expand` + `campaign.send` |
| **V4 "Find · Convert · Reactivate · Learn"** | cold acquisition: ICP → sourcing → prospects → cold email | `prospects`, `prospect_*`, `sourcing_*`, `outreach_*`, `sender_identities` | `sourcing.run` + `outreach.tick` + `outreach.dispatch` |

V4 did **not** replace V3 — it was layered beside it. `conversations` and `messages` were widened
to carry both worlds (a genuinely good decision), but nearly every *behavioural* layer above them
was rebuilt rather than extended: three campaign engines, two contactability engines, two
entitlement systems, two quiet-hours implementations, three implementations of "assign a lead".

## 2. The findings that matter

| # | Finding | Severity | Detail |
|---|---|---|---|
| 1 | **One business action has up to three implementations, one per interface.** `assignLead` exists in `leads/actions.ts` (writes `lead_assignments` + `audit_log`), in `mcp/handlers.ts` (writes neither), and in `copilot/tool-service.ts` (writes neither). Same story for lead status and needs-attention. | **P0** | [18 · D1](18-duplication-bloat-register.md) |
| 2 | **MCP `update_lead_status` does not stamp lifecycle timestamps.** A lead marked WON over MCP leaves `won_at` null, so every conversion metric silently under-counts it, automation keeps running, and no CRM push is queued. | **P0** | [18 · D2](18-duplication-bloat-register.md) |
| 3 | **"Reply rate" is computed five different ways**, none of which matches the definition the metric registry publishes to the user. | **P0** | [18 · D3](18-duplication-bloat-register.md) |
| 4 | **Two contactability engines.** The V4 `ChannelPolicyService` (lawful basis, jurisdiction, provenance, `compliance_decisions`) guards only the *cold* path. Every warm send — automation, manual, reactivation — goes through an older guard that writes no compliance decision at all. | **P1** | [11](11-compliance-permission-mesh.md) |
| 5 | **`automation_events` is write-only.** 16 emit sites, zero readers, no dispatcher. There is no event bus; downstream work is hard-coupled through `enqueue()` calls inside handlers. | **P1** | [15](15-event-catalogue.md) |
| 6 | **Inbox advertises six channels and can reply on two.** Messenger, Instagram and LinkedIn have UI tabs and schema (`inbox_channels`, `conversations.inbox_channel_id`, `external_thread_id`) and *no ingestion code whatsoever*. Email can be received but not replied to from the Inbox. | **P1** | [07](07-messaging-conversation-mesh.md) |
| 7 | **21 broken deep links.** V4 surfaces link to `/app/settings?view=…`; Settings only reads `?section=`. Every "Open Connections" and "See plans" affordance in Find Leads, Inbox and Agents lands on the wrong tab. | **P1** | [13](13-page-action-button-audit.md) |
| 8 | **Two parallel acquisition-campaign UIs** sit side by side under `src/components/find-leads/campaigns/` — an inline builder on `outreach/actions.ts` and a six-step wizard on `outreach/campaign-actions.ts`. | **P1** | [18 · D5](18-duplication-bloat-register.md) |
| 9 | **19 server actions have no caller and 30 components are orphaned**, including `previewQualification`, `moveQuestion` and `deleteRule` (so Qualification has no reorder, no rule delete, no preview) and `setRowClassification` (so CSV import has no per-row review). | **P2** | [20](20-dead-code-register.md) |
| 10 | **The MCP approval queue is a dead end.** The four high-impact MCP tools correctly park in `mcp_approvals` instead of executing — but nothing ever reads that table. There is no approve UI, action or job, so the parked request is never carried out and the requester is never told. | **P1** | [10](10-ai-copilot-mcp-mesh.md) |
| 11 | **Copilot uses no AI.** `answerFrom()` is a regex router over ten read tools. That is honest and safe, but it is not what the surface implies, and two of its declared tools are unreachable. | **P2** | [10](10-ai-copilot-mcp-mesh.md) |

## 3. What is genuinely good and must not be "consolidated" away

An audit that only lists problems is misleading. These are correct, and they are the foundation
the target architecture should build on:

- **One conversation model.** `conversations` and `messages` already carry lead *and* prospect,
  cross-channel, with a partial-unique-index scheme that survives promotion. Do not split it.
- **One prospect/lead boundary, enforced in the database.** `promote_reviewed_prospect()` is a
  single SQL function: promotion is atomic, keeps the conversation row, and re-stamps history.
  The MCP `create_lead` tool refuses to create a lead from a cold relationship type.
- **RLS on all 174 tables**, applied via explicit `DO` loops, with server-only tables carrying
  RLS and no policies. No `using (true)`, no grants to `anon`.
- **One outbound send core.** `jobs/send-core.ts` is pure and shared by `message.send` and
  `campaign.send`, with `send_key` idempotency and a webhook inbox on `webhook_events`.
- **One job queue** with `FOR UPDATE SKIP LOCKED` claiming, idempotency keys, capped backoff and
  a stalled-job reaper.
- **One prompt registry and model router.** `runTask()` is the only AI path (one exception, see
  [10](10-ai-copilot-mcp-mesh.md)); it enforces token capacity, schema-validates output and bands
  confidence.
- **One shared OAuth framework** (`integrations/oauth.ts`); providers register adapters.
- **A canonical metric registry already exists** (`analytics/v4-metrics.ts`). The problem is that
  the queries do not obey it, not that it is missing.

## 4. The shape of the fix

Not a rewrite. Four moves, in order:

1. **Collapse the interface duplication (P0).** Make `lib/<domain>/actions.ts` the single
   implementation and have MCP and Copilot call those functions with an explicit actor, instead
   of re-issuing their own Supabase writes. Highest value per line changed in the repository.
2. **Make the metric registry authoritative (P0).** One definition per metric, consumed by
   Analytics, Dashboard, Copilot, campaign detail and the export route.
3. **One contactability gate (P1).** Route the warm send path through `policy/service.evaluate()`
   with a WARM policy pack, so every outbound message — cold or warm — leaves a
   `compliance_decisions` row.
4. **Finish or remove the half-built surfaces (P1).** Inbox social channels, the second campaign
   UI, the orphaned qualification actions. Each is either finished or deleted; none may ship
   as-is.

Full sequencing in [21-consolidation-migration-plan.md](21-consolidation-migration-plan.md).

## 5. Coverage and confidence

**Verified by reading code or SQL:** route and page inventory; all 65 migrations for table,
constraint and index definitions; RLS enablement across all tables; all 255 server actions and
their call sites; all 30 job handlers and their registration; the complete AI call graph; the MCP
and Copilot tool tables against their implementations; the policy-service call graph; every
usage-ledger writer; the integration adapter registry; orphan components, orphan actions and
unreferenced tables.

**Inferred, and marked as such at the point of use:** runtime behaviour of external providers;
live database state (this audit reads migrations, not the deployed schema); and per-control UX
where the component was not opened individually. Section
[13](13-page-action-button-audit.md) states its own coverage explicitly: every action *file* is
enumerated and every action traced to a caller, but not every one of the several hundred rendered
controls was opened. Where a claim is inference rather than verification, it says so.

---

### Document map

| File | Contents |
|---|---|
| [01](01-route-page-inventory.md) | Every route, layout, tab and view, with what owns it |
| [02](02-domain-inventory.md) | Functional domains and the modules in each |
| [03](03-canonical-data-model.md) | Which entities should be first-class, and which should not exist |
| [04](04-database-audit.md) | 174 tables: purpose, referenced or not, constraint and index notes |
| [05](05-global-system-mesh.md) | The global mesh diagram |
| [06](06-prospect-lead-data-flow.md) | ICP → search → prospect → promotion → lead |
| [07](07-messaging-conversation-mesh.md) | Conversation, message, channel and inbox architecture |
| [08](08-agent-automation-mesh.md) | Agents, conversational runtime, automations, jobs |
| [09](09-integration-mesh.md) | Providers, OAuth, webhooks, sync, health |
| [10](10-ai-copilot-mcp-mesh.md) | Every AI call, Copilot, MCP |
| [11](11-compliance-permission-mesh.md) | Contactability, consent, RLS, roles |
| [12](12-usage-billing-mesh.md) | Usage ledgers, entitlements, cost |
| [13](13-page-action-button-audit.md) | Action-by-action status register |
| [14](14-wizard-state-audit.md) | Seven wizards, their state and resume behaviour |
| [15](15-event-catalogue.md) | Event tables, emitters, consumers, the missing bus |
| [16](16-state-machines.md) | State machines and impossible states |
| [17](17-data-lineage.md) | Where each important value comes from |
| [18](18-duplication-bloat-register.md) | Every duplication, with A/B/why/risk/recommendation |
| [19](19-missing-architecture-register.md) | Missing architecture, ranked P0–P3 |
| [20](20-dead-code-register.md) | Orphan components, actions, tables, columns |
| [21](21-consolidation-migration-plan.md) | Phased plan with migration, tests and rollback |
| [22](22-final-target-architecture.md) | The target architecture |
| [23](23-production-readiness-test-matrix.md) | Acceptance matrix |
| [24](24-remediation-log.md) | **What has actually been fixed since the audit** |
| [25](25-master-system-inventory.md) | Every one of the 270 server actions, generated |
