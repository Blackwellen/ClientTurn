# 01 · Route, Page and View Inventory

Every route in `src/app`, with the view state it carries, what renders it, and what it owns.
Source of truth: the filesystem (`page.tsx` / `route.ts` / `layout.tsx`) plus the view enums in
`src/lib/*/types.ts` and `src/lib/*/filters.ts`.

There are **four shells**: customer app `(app)`, admin `/admin`, affiliate portal
`/affiliates`, and public marketing `(marketing)` + `(auth)`.

---

## 1. Customer app — `src/app/(app)/app`

Navigation is defined once in [`src/lib/app/nav.ts`](../../src/lib/app/nav.ts) — nine primary
destinations, two of them plan-gated.

> **Doc drift.** `CLAUDE.md` resolved-conflict 0 locks navigation at *five* primary destinations
> (Dashboard, Leads, Follow-Up, Reactivation, Settings). The shipped rail has nine: V4 added
> Agents, Inbox, Find Leads and Analytics. The V4 Expansion Bible authorises this, but the
> project instructions were never updated. Recorded in
> [19 · Missing architecture](19-missing-architecture-register.md) as a documentation defect,
> not a code defect.

| Route | View state | Renders | Owns | Notes |
|---|---|---|---|---|
| `/app` | `?range=` | `DashboardPage` → 9 cards | Nothing. Aggregates `dashboard/queries`, `bookings/queries`, `campaigns/queries` | Correct: no unique business logic. But computes its own funnel counts rather than using the metric registry — see [18 · D3](18-duplication-bloat-register.md) |
| `/app/agents` | — | `AgentsView` | `agents` table | List + counts + "New agent" |
| `/app/agents/new` | — | `AgentWizard` | draft agent | In-memory wizard, `saveAgent` at the end |
| `/app/agents/[id]` | `?tab=overview\|leads\|queue\|sources\|campaign\|activity\|settings` | 7 tabs | `agents`, `agent_queue_items`, `agent_runs`, `agent_activity_events`, `agent_sources` | Server-side per-tab loading — only the open tab queries |
| `/app/inbox` | `?channel=`, `?c=<conversationId>` | `InboxView` | `conversations`, `messages`, `inbox_channels` | 6 channel tabs, 3 ingest paths, 2 reply paths — see [07](07-messaging-conversation-mesh.md) |
| `/app/leads` | `?view=cards\|table`, quick filters, status, sort, page | `LeadQuickFilters` + `LeadsToolbar` + `LeadsContent` + `LeadDrawerHost` + `AddLeadButton` | `leads`, `lead_assignments`, `conversations` | View preference persisted to a cookie |
| `/app/leads/import` | wizard step | `ImportWizard` | `lead_imports`, `lead_import_rows` | Per-row classification UI missing — `setRowClassification` is orphaned |
| `/app/find-leads` | `?view=discover\|prospects\|intent\|campaigns` + prospect filters | `FindLeadsView` → `DiscoverView` \| `ProspectsView` \| `IntentView` \| `CampaignsView` | `prospects`, `prospect_*`, `search_sessions`, `intent_*`, `outreach_campaigns` | Plan-gated on `sourcing` |
| `/app/find-leads/search/[sessionId]` | — | `SearchSessionView` | `search_sessions`, `search_messages`, `search_strategies` | Conversational search planner |
| `/app/find-leads/runs/[runId]` | — | `SourcingRunView` | `sourcing_runs`, `sourcing_run_*` | Live progress via Supabase Realtime |
| `/app/find-leads/scoring/[prospectId]` | — | `ExplainableScoring` | `prospect_scores`, `prospect_score_factors` | Score explanation |
| `/app/find-leads/campaigns/new` | `?draft=<id>&step=` | `CampaignWizard` (6 steps) | `outreach_campaigns` DRAFT | Server-persisted draft |
| `/app/find-leads/campaigns/[campaignId]` | `?tab=all\|ready\|contacted\|replied\|review\|suppressed\|promoted` | `CampaignHeader` + `Overview` + `Tabs` | `outreach_campaigns`, `outreach_recipient_runs`, `campaign_variants` | |
| `/app/follow-up` | `?view=follow-up\|qualification`, `?tab=sequence\|settings\|enrolment\|performance` | `FollowUpView` \| `QualificationView` | `automation_definitions`, `automation_steps`, `qualification_*` | Two modules on one route, correctly |
| `/app/reactivation` | `?view=cards\|list`, `?campaign=`, filters | `ReactivationView` | `campaigns`, `campaign_contacts` | View persisted to cookie **and** localStorage |
| `/app/reactivation/new` | wizard step | `ReactivationWizard` (3 steps) | `campaigns` DRAFT | Draft is in-memory only |
| `/app/analytics` | `?view=overview\|acquisition\|outreach\|conversion`, `?range=` | `AnalyticsView` | Nothing. Reads `v4-queries` + `v4-extras` | Plan-gated on `analytics` |
| `/app/settings` | `?section=workspace\|connections\|business-profile\|team\|billing` | 5 section components | `businesses`, `business_settings`, `services`, `integrations`, `business_members`, `subscriptions`, `business_profiles`, `icp_profiles` | |
| `/app/settings/{billing,connections,team,workspace}` | — | `redirect()` | — | Deliberate legacy-link redirects. Correct |
| `/app/help` | — | Help articles | `support_articles` | |
| `/app/support` | — | Ticket list + composer | `support_tickets`, `support_messages`, `support_attachments` | Not in the nav rail; reached from Help |

**Route-level gaps found**

- `titleForPath()` in `nav.ts` maps `/app/status`, but the status page lives at `/status`
  (outside the app shell). Dead mapping entry.
- Find Leads, Inbox and Agents contain **21 links to `/app/settings?view=…`**. Settings parses
  only `?section=`, so all 21 land on the default section. Full list in
  [13](13-page-action-button-audit.md).
- `?view=services` is linked from the campaign wizard goal step; there is no `services` section
  at all (services live inside `workspace`).

## 2. Admin shell — `src/app/admin`

Separate route, separate sign-in (`/admin/login`), mandatory step-up
(`src/lib/admin/step-up.ts`), `platform_role` checked server-side against the database.

| Route | Owns |
|---|---|
| `/admin` | Platform overview — `admin/overview.ts` |
| `/admin/customers` | Workspace list and detail, suspend/unsuspend, resend onboarding |
| `/admin/support` | Ticket queue, reply, internal notes, assignment |
| `/admin/affiliates` | Approve/reject/suspend partners, commissions, payouts |
| `/admin/system` | Jobs, errors, webhook replay, provider health, feature flags |
| `/admin/billing` | Plan changes, credits, entitlement grants, trial extension |
| `/admin/economics` | `cost_events`, `business_cost_daily`, `business_margin_monthly` |
| `/admin/settings` | Provider settings, AI settings, kill switch, outreach settings |

> `CLAUDE.md` describes the admin shell as three destinations (Overview, Customers, System).
> Eight ship. Same doc-drift note as above.

## 3. Affiliate portal — `src/app/affiliates`

Own auth (`/affiliates/login`, `/affiliates/signup`, `/affiliates/verify-email`), own onboarding
wizard, own nav (`src/lib/affiliates/nav.ts`), own RLS predicates (`current_affiliate_id()`,
`is_active_affiliate()`).

Pages: Home, Links, Referrals, Resources Hub, Performance, Payouts, Settings, Help.
Route handlers: payout statement/breakdown/export, referral export, resource download, Stripe
Connect refresh.

This is a genuinely separate tenant model (partners are not workspace members) and is
**correctly** separate. It should not be merged into the customer app.

## 4. Public / marketing — `src/app/(marketing)`, `(auth)`, root

Marketing: `/`, `/how-it-works`, `/pricing`, `/enterprise`, `/results`, `/affiliates`,
`/contact-sales`, `/product/find-leads`, `/product/lead-conversion`, plus legal pages
(`/terms`, `/privacy`, `/cookies`, `/sub-processors`).

Auth: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`,
`/auth/callback`.

Standalone: `/onboarding` (5-step wizard), `/status`, `/unsubscribe/[token]`, `/r/[slug]`
(affiliate referral redirect).

**Dev-only routes — verified guarded.** `/dev/add-lead`, `/dev/admin-preview`,
`/dev/reactivation-preview`, `/dev/wizard-preview` and `/dev/wizard-steps` each call
`notFound()` when `NODE_ENV === "production"`. `/api/dev/seed` returns 404 in production *and*
requires the cron secret. No action needed.

## 5. API route handlers — `src/app/api`

| Route | Purpose | Auth |
|---|---|---|
| `/api/cron/worker` | Job loop, every 30s from pg_cron | `CRON_SECRET` bearer |
| `/api/cron/daily` | Enqueues rollups, aggregation, retention, maintenance | `CRON_SECRET` bearer |
| `/api/webhooks/stripe` | Billing events → `webhook_events` → job | Stripe signature |
| `/api/webhooks/twilio` | Delivery + inbound → `webhook_events` + `message_events` | Twilio signature |
| `/api/webhooks/linkedin-ads` | Lead form submissions | Provider signature |
| `/api/integrations/[provider]/connect` | OAuth start | `requireRole("admin")` |
| `/api/integrations/[provider]/callback` | OAuth exchange | state token |
| `/api/mcp` | MCP JSON-RPC gateway | `mcp_tokens` bearer |
| `/api/apps/[id]/events` | Inbound connector events → `receive_workspace_app_event()` | per-install secret |
| `/api/search` | Global search | session |
| `/api/find-leads/runs/[runId]` | Run polling | session |
| `/api/analytics/export`, `/api/exports/attribution`, `/api/exports/prospects` | CSV exports | session |
| `/api/marketing/track` | Marketing attribution | public, rate-limited |
| `/api/dev/seed` | Seed data | 404 in production + cron secret |

**Edge layer:** this is Next.js **16.3.4**, where middleware is named `proxy.ts`.
[`src/proxy.ts`](../../src/proxy.ts) is active and does exactly two things: it rewrites the
`status.clientturn.com` host to `/status` (skipping the Supabase session refresh entirely, so the
status page has one less dependency during the outage it exists to report), and otherwise calls
`updateSession()` to refresh the Supabase auth cookie.

**It performs no authorisation.** Authentication and workspace scoping are enforced by the shell
layouts — `(app)/layout.tsx` calls `requireWorkspace()`, `admin/(ops)/layout.tsx` calls
`requirePlatformAdmin()` — and then again, independently, by `requireWorkspace()` /
`requireRole()` / `assertEntitlement()` inside each page, server action and route handler. That
double enforcement is correct: a layout guard alone would not protect a server action, and it
keeps authorisation next to the data access rather than in a path-matching layer that drifts.

The cost is that *a new route that forgets its guard is silently public* — nothing at the edge
would catch it.
See [19 · P1](19-missing-architecture-register.md) for the proposed route-guard test.

---

## Cross-references

- What each page is *allowed* to own: [09 · Page → data → action graph](05-global-system-mesh.md)
- What every button on these pages does: [13](13-page-action-button-audit.md)
- Which of these pages should exist at all: [22 · Target architecture](22-final-target-architecture.md)
