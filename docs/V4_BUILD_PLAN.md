# ClientTurn V4 — Expansion Build Plan

Derived from `ClientTurn_Expansion_Architecture_Bible_V4_Find_Convert_Reactivate_Learn.md`.
V4 is additive to V3: the existing shell, Leads, Follow-Up, Reactivation, billing and
auth foundations stay. Where V4 changes a V3 surface, V4 wins for that surface.

## Navigation delta (V3 → V4)

| | V3 | V4 |
|---|---|---|
| Primary nav | Dashboard, Leads, Follow-Up, Reactivation, Settings | + **Find Leads**, + **Analytics** |
| Settings views | Workspace, Connections, Team, Billing | + **Business Profile**, Billing → **Billing & Usage** |
| Hidden utilities | Help | + **Status**, + **Support** |
| Admin | Overview, Customers, System | + Support, Affiliates, Billing, Usage & Margins, Settings |
| Portals | — | **/affiliates** (public + affiliate app) |

`/app/help` is retained and becomes the entry point to `/app/support`.

## Layers

```
L1  Data          migrations 0025–0038 — new table families, RLS, indexes, rollups
L2  Policy        ChannelPolicyService, contactability, suppression, entitlement/usage
L3  Domain        prospects, search, sourcing, intent, scoring, campaigns, promotion
L4  Providers     company search / contact discovery / enrichment / verification /
                  intent / website intelligence / email (Gmail, Graph, IMAP+SMTP)
L5  Agents        AgentRuntime over the existing lib/ai router — 9 bounded profiles
L6  Jobs          new job types + handlers + cron dispatchers
L7  UI            Find Leads, Analytics, Add Lead, Import, Status, Support,
                  Business Profile, Billing & Usage, Follow-Up email channel
L8  Portals       Affiliate portal, admin expansion
L9  Edges         MCP gateway, Pipedrive sync, webhooks
```

## Phase register

| Phase | Scope | Key artefacts |
|---|---|---|
| 0 | Schema foundation | `0025`–`0038`, regenerated `database.types.ts` |
| 1 | Policy core | `lib/policy/*` — channel policy, contactability, suppression |
| 2 | Manual leads | Add Lead wizard, `lib/leads/manual.ts`, provenance |
| 3 | Imports | `/app/leads/import`, `lib/imports/*` |
| 4 | Business profile | `lib/business-profile/*`, Settings → Business Profile |
| 5 | Prospect model | `lib/prospects/*`, Prospects view + drawer, scoring |
| 6 | Search sessions | `lib/search-sessions/*`, Discover + Search Session |
| 7 | Sourcing | `lib/sourcing/*` orchestrator, providers, Sourcing Run UI |
| 8 | Intent | `lib/intent/*`, Intent view |
| 9 | Email | `lib/email/*` mailbox providers, sender identities, health |
| 10 | Cold campaigns | `lib/outreach/*`, campaign wizard + detail, reply classification |
| 11 | Warm email | Follow-Up email channel + policy fallback |
| 12 | Usage & margins | price book, cost ledger, allocation sliders, admin economics |
| 13 | Analytics | `/app/analytics` 4 views over canonical metric definitions |
| 14 | Optimization | experiments, learnings, bounded Auto Optimize |
| 15 | Status & support | `/app/status`, `/app/support`, `/admin/support`, mail ingestion |
| 16 | Pipedrive | OAuth sync, entity links, conflicts |
| 17 | MCP | `/api/mcp` gateway, scoped tools, approvals, audit |
| 18 | Affiliates | portal, resources, tracking, commissions, payouts, admin |
| 19 | Hardening | RLS tests, cost-abuse tests, failure tests, QA pass |

## Invariants carried from V3 (non-negotiable)

- `business_id` on every tenant table; RLS on every browser-exposed table.
- Service-role key, provider tokens and raw provider costs are server-only.
- Webhooks: verify → `webhook_events` row → ack fast → enqueue job.
- Every job handler is retry-safe and re-reads state before external action.
- Every route implements loading / empty / error / permission-denied /
  integration-required / plan-limit-reached.
- Entitlements enforced server-side.
- Deterministic code owns scoring arithmetic, policy, budgets, scheduling,
  billing, suppression and state transitions. AI produces evidence only.

## V4-specific invariants

- **Prospect ≠ Lead.** Cold data never enters `leads`. Promotion is a
  transactional service (`LeadPromotionService`), never a status flip.
- **No customer-facing token economy.** Customers see prospects / searches /
  monitors / sends. Provider unit costs are admin-only.
- **No provider lock-in.** Every external capability sits behind an adapter
  interface with declared capability + estimated cost.
- **Cold outreach is email-first.** SMS/WhatsApp/social cold is blocked by
  policy default and cannot be enabled from the customer UI.
- **Untrusted content.** Website text, prospect data and inbound mail are data,
  never instructions. Tool permission is enforced outside the prompt.
- **Bounded optimization.** Auto Optimize may not raise spend, weaken
  suppression, lower compliance thresholds or alter verified business facts.

---

## Status — 2026-09-06

### Landed and verified

| Area | Artefacts | Verification |
|---|---|---|
| Schema | `0025`–`0038` (14 migrations): 88 new tables, RLS, indexes, rollup functions, seeds | **Not executed** — see gap below |
| Types | `database.types.ts` + `scripts/gen-v4-types.mjs`, `scripts/gen-v4-column-extensions.mjs` | `tsc --noEmit` clean |
| Policy | `lib/policy/{types,channel-policy,packs,suppression,service}.ts` | 23 tests passing |
| Prospects | `lib/prospects/{types,scoring,dedupe}.ts` | 26 tests passing |
| Entitlements | `lib/billing/v4-entitlements.ts` | typechecked |
| Navigation | `lib/app/nav.ts` — Find Leads + Analytics, plan-gated | typechecked |

### Decisions worth knowing

- **V3 already had an economics layer** (`0018_ai_usage_billing`: `cost_events`,
  `business_cost_daily`, `business_margin_monthly`, `plan_entitlements`,
  `provider_price_book`). V4 **extends** these rather than introducing rival
  tables, and keeps 0018's units (numeric `*_cost`, not minor units). The V4
  allowances are seeded as new `plan_entitlements` rows on the existing
  `(plan_key, metric)` shape.
- **Conversations are now shared.** `conversations.lead_id` and
  `messages.lead_id` became nullable, and a prospect thread takes
  `channel = 'multi'`. Promotion stamps the lead id onto the existing rows,
  which is what makes cold email history appear in the Lead Drawer (the drawer
  reads messages by `lead_id`).
- **Cost columns are revoked from the browser role** even on member-readable
  tables, via column-level grants. Customer-facing budget meters read a derived
  percentage produced server-side (§112).
- **Policy fails closed.** An unreachable or malformed pack yields
  `FAIL_CLOSED_PACK`, which permits no cold channel at all.

### Migrations applied

All V4 migrations are **applied to the linked `Client Turn` project**
(`losieaikadkadtmezini`) and `database.types.ts` is generated from that live
schema. `scripts/run-sql.mjs` is the tool:

```
node scripts/run-sql.mjs --check 0025 0026 ...   # BEGIN ... ROLLBACK, validate only
node scripts/run-sql.mjs --apply 0025 0026 ...   # BEGIN ... COMMIT
node scripts/run-sql.mjs --query "select 1"
```

Nothing is applied that has not passed `--check` first: the check runs the real
statements against the real schema inside a transaction and rolls back, so
syntax, constraint and dependency errors surface without changing anything.

**The database was several migrations behind the repo when this started.**
`0022_reactivation`, `0023_salesforce_provider`, `0024_platform_admin_ops`,
`0024a_agent_runtime`, `0039_email_channel` and `0040_manual_lead_intake` had
never been run — which is why `campaigns.tags`, `leads.unsubscribe_token`,
`platform_provider_checks` and the `reactivation_campaign_results` function were
all absent while the checked-in types claimed otherwise. All are now applied.

`0024b_pg_cron_worker` is deliberately **not** applied: it enables `pg_cron` and
`pg_net` to fire scheduled HTTP requests at the app, and its own header requires
two `vault.create_secret` statements (see `docs/CRON.md`) to be run first.
Enabling it is an operational decision, not a schema one.

### Landed since

| Area | Artefacts |
|---|---|
| Find Leads | `/app/find-leads` — four-view shell, Prospects inbox (card + table), filter panel, Prospect Drawer with explainable scoring, allowance meters |
| Prospects data | `lib/prospects/{filters,filter-sql,queries}.ts` |
| Analytics | `/app/analytics` — Overview / Acquisition / Outreach / Conversion over `lib/analytics/v4-metrics.ts` |
| Navigation | `primaryNavFor()` threaded through `AppShell`; Find Leads and Analytics are plan-gated in the rail and enforced on the route |
| Security tests | `tests/rls-v4.test.ts` — 18 cross-tenant and cost-visibility tests (`npm run test:rls:v4`) |

### Verification

```
npm test            # 426 unit tests
npm run test:rls    # 15 V3 cross-tenant tests   (live database)
npm run test:rls:v4 # 18 V4 cross-tenant tests   (live database)
npx tsc --noEmit    # clean against generated types
npm run build       # compiles; /app/find-leads and /app/analytics are live routes
```

### A trap worth remembering

`0036` withheld provider cost with `grant select on <table>` followed by
`revoke select (cost_column)`. **That does nothing.** In PostgreSQL a
table-level SELECT grant covers every column, and a column-level REVOKE cannot
subtract from it — column privileges only narrow a grant that was itself made
at column level. The revokes succeeded silently while `spent_cost_minor` and
friends stayed fully readable.

`0041_v4_cost_column_grants` fixes it by dropping the table grant and
re-granting the allowed columns, resolved from `information_schema` so a column
added later is included automatically. The regression test is
"a sourcing run's spend columns are not readable, though the run is".

### Coordination note

Another workstream is building in this repo concurrently and is **building on**
these migrations (`0040_manual_lead_intake` opens by referencing what 0038 added
to `leads`). It currently owns manual lead intake, the email/mailbox layer
(`lib/email`, `0039`) and the agent runtime (`lib/agent`, `0024a`). This
workstream has taken Find Leads, prospects, policy and analytics. Check
`git log`/`ls src/lib` before starting a new area.

### Not yet started


Phases 2–19 of the register above: manual Add Lead wizard, imports, business
profile, search sessions, sourcing orchestrator and providers, intent, mailbox
integrations, cold campaigns, warm email, usage/margin surfaces, analytics,
optimization, status/support, Pipedrive, MCP, affiliates — and all of the V4 UI.

---

## Agents and Inbox

Two destinations added to the rail beyond the V4 spec, at the customer's request.

### Agents — `/app/agents`

A customer-facing background worker: a name, a role, sources, a schedule and a
queue. **Not to be confused with `lib/agent`** (singular), which is the
conversational runtime that answers one lead's messages, or with `agent_runs`,
which is the internal ledger of bounded LLM executions. One agent causes many
agent_runs.

| Piece | Where |
|---|---|
| Schema | `0043_v4_agents` — `agents`, `agent_sources`, `agent_queue_items`, `agent_activity_events`, `agent_summaries()` |
| Domain | `lib/agents/{types,queries,actions,scheduler}.ts` |
| List | `/app/agents` — cards grouped by role, empty roles teach the capability |
| Wizard | `/app/agents/new` — Role → Sources → Limits → Review |
| Detail | `/app/agents/[id]` — Overview, Leads, Queue, Sources, Campaign, Activity, Settings |

Four roles: Sourcing, Booking, Re-engagement, Combined. Tabs are per-role — a
booking agent has no Sources tab because it discovers nothing.

An agent is always created as a **draft** and never started by its own creation.
Only Sourcing runs independently today; the others refuse to start with an
explanation rather than sitting idle and looking broken.

### Inbox — `/app/inbox`

| Piece | Where |
|---|---|
| Schema | `0044_v4_unified_inbox` — `inbox_channels`, conversation/message extensions, `inbox_channel_counts()` |
| Domain | `lib/inbox/{types,actions}.ts` |
| UI | `/app/inbox` — channel rail, conversation list, thread pane |

Social channels join the existing `conversations` model rather than getting a
parallel one, so someone who emails and then messages on Instagram is one
conversation.

### What the source and channel catalogues will NOT claim

This is the part most likely to be quietly "fixed" into a lie later, so it is
written down:

- **There is no LinkedIn people-search source.** LinkedIn has no API permitting
  member search for prospecting. `LINKEDIN_ADS` brings in lead-form submissions
  from the workspace's *own* ad account, nothing more.
- **There is no LinkedIn inbox sync.** No API gives an application access to a
  member's LinkedIn messages; the messaging APIs are approved-partner only. The
  channel is modelled `can_read: false` and the UI says why.
- **Meta is inbound-only for sourcing.** Messenger and Instagram *messaging*
  work against a Page the customer administers, with permissions granted.
- **No scraping.** V4 §113/§114 forbid it and so do most platform terms. A
  capability that cannot be built lawfully does not get a catalogue entry just
  because it would look good in the wizard.
- **Finding a contact detail is not permission to use it.** Phone enrichment is
  a separate switch from email precisely because the obligations differ, and
  ChannelPolicyService still gates every send regardless of either.

### Verification

```
npm run typecheck    # raised to --max-old-space-size=6144: the generated
                     # Database type is ~10k lines and exhausts the default heap
npm test             # 520 unit tests
npm run test:rls     # 15 V3 cross-tenant  (live database)
npm run test:rls:v4  # 21 V4 cross-tenant  (live database)
npm run audit:db     # every .from()/.rpc() in src/ exists in the database
npm run build
```

`audit:db` exists because of a real incident: `0041_find_leads_workspace` was
never applied, yet `database.types.ts` had been regenerated against a schema
that included it. Typecheck passed, the build passed, and seven files queried
three tables that did not exist — which would have 500'd the first time a
customer opened Find Leads. Types describe intent; only the database is
authoritative. Run this after any migration.

---

## Completion pass — 2026-09-06

### Wired the three orphaned SQL functions

Each turned out to be a real defect, not tidying:

- **`inbox_channel_counts`** → the channel rail now shows unread badges, counted
  across the whole inbox rather than only the 100 conversations the page fetched.
- **`sourcing_run_counters`** → the run funnel was being counted by pulling every
  `sourcing_run_results` row into the app. A run with more results than
  PostgREST's row cap would have **silently under-reported every number the
  customer sees**. Now aggregated in Postgres.
- **`outreach_campaign_results`** → backs the new Campaigns tab.

### Intent and Campaigns are real surfaces

Both tabs previously said "being built".

- **Intent** (`lib/intent`, `components/find-leads/intent`) — categories with a
  bounded score impact and a freshness window, monitors over an ICP or a named
  company list, and a signal feed where expired signals are shown greyed rather
  than hidden. The score-impact slider is capped at §15.4's ceiling in the UI as
  well as on the server, so the bound is visible.
- **Campaigns** (`lib/outreach`, `components/find-leads/campaigns`) — per-campaign
  funnel from the SQL function, and for anything not running, exactly what is
  blocking it. States plainly that cold outreach is email-only.

### Booking and re-engagement agents now run

`lib/agents/ticks.ts`. The governing decision: **these orchestrate the engines
that already exist rather than reimplementing them.** A booking agent finds
qualified leads that stalled without a booking and, only when set to AUTO,
re-arms the existing follow-up automation — the message still goes out through
`message.send` and every one of its guards. A re-engagement agent builds its
audience with the same `resolveAudience` the Reactivation wizard uses and drafts
a campaign; it does not launch one. Every candidate passes ChannelPolicyService
first, and a blocked lead is queued as BLOCKED with the reason rather than
silently skipped.

The entitlement gate was also wrong: it demanded the *sourcing* entitlement for
every agent type. Booking and re-engagement work existing leads, which every
paying plan includes.

### Settings → Business Profile

`lib/business-profile`, `components/settings/business-profile`. This was a
functional blocker: there was no way to create an ICP profile or a conversion
goal, and the agent wizard, intent monitors and campaigns all target them.

Holds the memory-safety rule from §54.2: every fact shows its source, a fact the
customer types is verified and locked by definition, and locking stops any later
inference overwriting it.

### Two silent cost-ledger bugs

- The daily rollup bucketed by **provider name** and only knew azure/twilio/
  resend/stripe, so every V4 acquisition cost fell into `other_cost` and
  `discovery_cost` / `enrichment_cost` / `verification_cost` / `intent_cost`
  would have stayed zero forever. Cost per verified prospect (§102) was
  uncomputable. Now reads `cost_events.category`, with the provider heuristic
  kept as a fallback so historical rows do not shift.
- The monthly rollup **selected `email_cost` and never summed it**, so it fell
  out of COGS entirely and margin was overstated for any workspace sending email.

### Expiry sweeps

`maintenance.expiry` job, enqueued daily. `expire_intent_matches` and
`expire_usage_reservations` existed but nothing called them — expired signals
kept inflating prospect scores, and a worker that died between reserve and
settle permanently consumed a customer's allowance.

### Background processing is live

Verified against the database, not the doc: `clientturn-worker` on a 30-second
schedule, `-daily` and `-reap` active, **39 consecutive HTTP 200s** in the
preceding 20 minutes, queue draining (15 completed / 2 pending). The rollups and
sweeps above therefore actually run.

### Still not built

Imports wizard · MCP gateway · affiliate portal · admin Support / Affiliates /
Economics · warm email in Follow-Up. The admin economics gap is the notable one:
the cost breakdown fixed above is now recorded correctly but has no surface.
