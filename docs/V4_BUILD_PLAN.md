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
