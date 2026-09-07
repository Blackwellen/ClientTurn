# 02 · Domain Inventory

The 51 directories under `src/lib`, grouped into the domains they actually serve. The right-hand
column is the audit verdict: whether the directory represents a real domain boundary or an
accident of build order.

---

## Identity, tenancy, session

| Module | Contents | Verdict |
|---|---|---|
| `lib/auth` | `session.ts` (`requireWorkspace`, `requireRole`, `hasRole`), `actions.ts` (sign-up/in/out, password), `invites.ts` | **Canonical.** The one session resolver. Every other module depends on it |
| `lib/supabase` | `client` (browser), `server` (RSC/actions), `admin` (service-role), `database.types.ts` | **Canonical.** `proxy-session.ts` is orphaned — see [20](20-dead-code-register.md) |
| `lib/settings` | Workspace, team, services, messaging, booking, notifications, integrations, data export, delete | **Overloaded.** 26 exported actions in one 1,500-line file spanning six unrelated domains. Split, do not merge |
| `lib/security` | `rate-limit`, `safe-fetch` (SSRF guard), `secret-box` (envelope encryption) | **Canonical** |

## Business knowledge

| Module | Contents | Verdict |
|---|---|---|
| `lib/business-profile` | `business_profiles` facts, ICPs, conversion goals, website analysis, precedence rules | **Canonical.** `precedence.ts` (locked > verified > AI) is the right abstraction |
| `lib/onboarding` | 5-step wizard, provisioning, test lead | **Canonical**, but overlaps `business-profile` on the business-facts step |
| `lib/ai-settings` | Per-workspace AI behaviour toggles | **Merge candidate** into `settings` or `business-profile`; one action, one query |

## Prospecting (V4 cold side)

| Module | Contents | Verdict |
|---|---|---|
| `lib/find-leads` | Search sessions, sourcing runs, recurring searches, prospect actions, budget, cost model, provider router, 5 provider adapters, research, scoring plan | **Canonical**, but `actions.ts` (21 actions) and `prospect-actions.ts` (7 actions) overlap: `approveProspectAction` vs `approveProspectsAction`, `suppressProspectAction` vs `suppressProspectsAction` |
| `lib/prospects` | Queries, filters, filter SQL, dedupe, scoring, scoring explanation, activity | **Canonical.** `dedupe.ts` is the single normalisation rule and the DB unique index depends on it |
| `lib/intent` | Intent categories, monitors, matches | **Canonical** |

## Lead management (V3 warm side)

| Module | Contents | Verdict |
|---|---|---|
| `lib/leads` | Queries, filters, 12 actions, avatar, Add Lead sub-wizard | **Canonical** |
| `lib/leads/add-lead` | Duplicate check, contactability, manual lead, prospect-from-wizard | **Canonical.** Correctly refuses to create a lead from a cold relationship |
| `lib/imports` | CSV import + relationship classification | **Canonical**, incomplete: `setRowClassification` has no UI |
| `lib/qualification` | Deterministic engine, questions, rules, draft/publish, routing, preview | **Canonical.** The engine is pure and the system of record |
| `lib/bookings` | Booking queries + status | **Thin.** One orphaned action |

## Outbound (three engines)

| Module | Engine | Tables | Verdict |
|---|---|---|---|
| `lib/automation` + `lib/automations` | **Follow-Up** — per-lead sequence | `automation_definitions/versions/steps/runs` | **Canonical for warm follow-up.** Two directories for one domain is confusing: `automation` holds the pure scheduler + events, `automations` holds actions/queries/types. Rename, do not merge |
| `lib/campaigns` | **Reactivation** — bulk warm SMS/WhatsApp | `campaigns`, `campaign_contacts` | **Canonical for reactivation.** Correctly reuses the send core |
| `lib/outreach` | **Acquisition** — cold email sequences | `outreach_campaigns/sequences/steps/runs/recipient_runs`, `campaign_variants`, `sender_identities` | **Canonical for cold.** But contains *two* generations of itself — see below |
| `lib/messaging` | Provider abstraction (Twilio, email, stub) | — | **Canonical** |
| `lib/email` | SMTP/POP3, inbound parse, account, rich text | — | **Canonical** |
| `lib/policy` | ChannelPolicyService, packs, suppression, types | `contact_permissions`, `contactability_results`, `compliance_decisions`, `suppression_entries` | **Canonical — but only wired to the cold path** |
| `lib/follow-up` | Follow-Up UI queries + channel *availability* logic | — | **Name collision.** `follow-up/channel-policy.ts` is not a policy engine; it computes warm-channel availability and fallback. Rename to `channel-availability.ts` |

> **`lib/outreach` contains two campaign generations.** `actions.ts` (4 actions:
> `createCampaignAction`, `launchCampaignAction`, `setCampaignStatusAction`,
> `createSenderIdentityAction`) drives an inline builder. `campaign-actions.ts` (13 actions) plus
> `campaigns/*` (16 modules) drives the six-step wizard and the campaign detail page. Both write
> `outreach_campaigns`. See [18 · D5](18-duplication-bloat-register.md).

## Conversation and inbox

| Module | Contents | Verdict |
|---|---|---|
| `lib/inbox` | One dispatcher action (`inboxAction`) + channel definitions | **Underbuilt.** 24 lines of minified-style code for a primary destination |
| `lib/agent` (singular) | Conversational AI runtime: orchestrator, tools, policy, classification, lifecycle, drafts, handoffs, summary, availability | **Canonical** |

## Automation and agents

| Module | Contents | Verdict |
|---|---|---|
| `lib/agents` (plural) | Customer-facing background agents: definitions, scheduler, ticks, queue | **Canonical.** The singular/plural split is real (one answers a conversation, the other runs a schedule) but the naming is a maintenance trap |
| `lib/jobs` | Queue, registry, 30 handlers, shared send core | **Canonical** |

## Intelligence

| Module | Contents | Verdict |
|---|---|---|
| `lib/ai` | Azure client, model router, prompt registry, prompts, schemas, safety, usage meter, context builder | **Canonical.** `context-builder.ts` is orphaned |
| `lib/copilot` | Tool declarations, tool service, insights, actions | **Canonical shape, no AI inside** — see [10](10-ai-copilot-mcp-mesh.md) |
| `lib/mcp` | Gateway, tool table, handlers | **Canonical shape, duplicated logic inside** |
| `lib/analytics` | V3 `queries.ts` (dead) + V4 `v4-metrics/v4-queries/v4-extras` | **`queries.ts` is legacy**; only `getAttributionRows` survives |
| `lib/dashboard` | Dashboard aggregation | **Canonical**, but bypasses the metric registry |
| `lib/search` | Global search | **Canonical** |

## Commerce

| Module | Contents | Verdict |
|---|---|---|
| `lib/billing` | Plans, V3 entitlements, V4 entitlements, Stripe, invoices, tokens, token service, usage service, usage allocation, sourcing allowances | **Two entitlement systems.** See [12](12-usage-billing-mesh.md) |
| `lib/affiliates` | 23 modules — attribution, commissions, payouts, Stripe Connect, programme, portal | **Canonical and correctly separate** |
| `lib/admin` | 40 modules — platform ops | **Canonical.** The `*-shared.ts` / `*.ts` split is the deliberate server-only boundary |

## Platform

| Module | Contents |
|---|---|
| `lib/integrations` | Catalog (14 providers), OAuth framework, adapter registries, apps/connectors |
| `lib/notifications`, `lib/support`, `lib/status`, `lib/storage` (R2), `lib/marketing`, `lib/validation`, `lib/dev` | Supporting |
| `lib/audit.ts` | `recordAudit()` + `recordUsage()` — the two ledger writers |

---

## Domain boundary problems, ranked

1. **`agent` vs `agents`** — semantically distinct, lexically identical. Rename to
   `conversation-agent` and `worker-agents`.
2. **`automation` vs `automations`** — one domain, split by "pure vs I/O" rather than by concept.
   Rename to `follow-up/engine` and `follow-up/api`, or merge under `lib/follow-up`.
3. **`policy/channel-policy.ts` vs `follow-up/channel-policy.ts`** — same filename, unrelated
   jobs, and both export a function called `isWithinQuietHours` with different signatures.
4. **`campaigns` vs `outreach`** — genuinely different lifecycles (warm bulk vs cold sequenced)
   but they share the word "campaign" in the UI, the tables and the Copilot tool names, so
   `pauseCampaign` is ambiguous at every layer.
5. **`settings`** — six domains in one file.

See [18](18-duplication-bloat-register.md) for the merge/keep decision on each.
