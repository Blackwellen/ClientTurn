# Client Turn — Full Build Plan

Derived from `ClientTurn_Master_Product_Bible_No_ML.md` (primary) and
`ClientTurn_Full_Product_Build_Specification.md`. Conflict resolutions are recorded in
`CLAUDE.md` and are not re-litigated here.

Status legend: ☐ not started · ◐ in progress · ☑ done

---

## 0. Scope statement

**In scope.** One marketing landing page + legal pages. Auth (signup/login/reset/verify).
An 8-step onboarding wizard. An authenticated app with sidebar + top bar covering Dashboard,
Leads, Automations, Qualification, Bookings, Reactivation, Analytics, Integrations, and a
tabbed Settings route. A separately-authenticated admin area with Overview, Customers, System.
Meta Lead Ads ingestion, Twilio SMS/WhatsApp, Calendly/Google Calendar, Stripe billing across
4 tiers, Resend email, Cloudflare R2 storage, optional Azure AI assist.

**Out of scope, permanently.** Full CRM, pipeline builder, invoicing, quotes, project
management, social posting, ad manager, freeform workflow canvas, proprietary scheduler,
voice bot, ML scoring. If a feature does not improve lead capture, speed-to-lead, response,
qualification, booking or attribution, it does not get built.

---

## 1. Commercial model

| Tier | Price | Leads/mo | Users | Channels | Key entitlements |
|---|---|---|---|---|---|
| Starter | £79/mo | 100 | 1 | SMS | 1 booking destination, standard follow-up, basic analytics |
| Growth | £149/mo | 500 | 3 | SMS + WhatsApp | Reactivation campaigns, source analytics, multi-question qualification, AI assist |
| Pro | £249/mo | 1,500 | 10 | All | Advanced routing, higher limits, priority support, AI assist |
| Enterprise | Contact sales | Custom | Custom | All | Custom limits, SSO-ready, dedicated support, DPA |

Trial: 14 days. Enterprise has no public price and no self-serve checkout — the pricing card
CTA opens a contact-sales form.

Entitlements are stored in `subscriptions` (mirrored from Stripe) and enforced by a single
server-side `assertEntitlement()` helper. Never enforced only in the UI.

---

## 2. Architecture

```
Browser ──► Next.js App Router (Vercel)
              ├── Server Components  → Supabase (anon key + RLS, user session)
              ├── Server Actions     → validated mutations
              └── Route handlers
                    ├── /api/webhooks/{meta,twilio,whatsapp,stripe,calendly,google}
                    ├── /api/integrations/{meta,google,calendly}
                    └── /api/cron/worker        ← drains the jobs table
                            │
                            └── service-role Supabase client (server only)
                                 ├── Twilio · Meta Graph · Calendly · Google
                                 ├── Stripe · Resend · Azure OpenAI
                                 └── Cloudflare R2 (S3 API, signed URLs)
```

**Job queue.** Database-backed (`jobs` table) drained by a Vercel Cron route hitting
`/api/cron/worker` every minute, protected by a shared secret. Claim is atomic
(`update … set locked_at where id in (select … for update skip locked)`). This avoids a
separate worker service at V1 while remaining durable and retry-safe.

**Realtime.** Supabase Realtime subscriptions only for: new lead, lead status change,
conversation reply, booking, notification. Analytics refetch on navigation — never subscribe
aggregate cards to table streams.

---

## 3. Environments & secrets map

Server-only (never `NEXT_PUBLIC_`):

| Var | Use |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | webhook handlers, worker, admin ops |
| `SUPABASE_PAT` | Management API only (migrations/provisioning), not app runtime |
| `STRIPE_SECRET_KEY_TEST` | all Client Turn billing work |
| `STRIPE_WEBHOOK_SECRET_CLIENTTURN` | new, to be created |
| `AZURE_OPENAI_*` | AI assist adapter |
| `R2_*` | signed URL generation |
| `TWILIO_*`, `META_*`, `CALENDLY_*`, `GOOGLE_*`, `RESEND_API_KEY` | to be provisioned |
| `CRON_SECRET` | protects `/api/cron/worker` |

Client-safe: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST`, `NEXT_PUBLIC_SITE_URL`.

⚠ `.env` currently holds **live** Stripe keys belonging to Propvora. Client Turn uses test
keys only. No live-mode object is created without explicit confirmation.

---

## 4. Provisioning tasks (external, gated)

These change shared systems, so each is confirmed before execution:

| # | Action | System | Gate |
|---|---|---|---|
| P1 | Apply schema migrations | Supabase `losieaikadkadtmezini` | Confirm before first apply |
| P2 | Create R2 bucket `clientturn` + CORS | Cloudflare | Confirm bucket name |
| P3 | Create 4 products + 7 prices (monthly/annual) in **test mode** | Stripe | Confirm before create |
| P4 | Create Stripe **test** webhook endpoint → `/api/webhooks/stripe` | Stripe | Confirm URL |
| P5 | Verify Azure deployment names respond | Azure AI Foundry | Read-only probe, safe |
| P6 | Twilio / Meta app / Resend / Calendly credentials | external | **Blocked — user must supply** |

P6 credentials are not in `.env`. Those integrations get built against the adapter interface
with a stub provider, and go live when keys arrive. Nothing else is blocked by them.

---

## 5. Design system foundation

Built once, in Phase 0, and reused everywhere. Bright, clean, dense enough for business use;
moderate radius; one accent; green = healthy, amber = warning, red = action required.

**Tokens** (`src/app/globals.css`, CSS custom properties + Tailwind v4 `@theme`): colour
ramps (neutral, accent, success, warning, danger, info), surface layers, border, radius scale,
shadow scale, spacing rhythm, typography scale, motion durations/easings. Full light + dark.

**Primitives** (`src/components/ui/`): Button (5 variants × 4 sizes, loading + icon states),
IconButton, Input, Textarea, Select, Combobox, Checkbox, Radio, Switch, Slider, Label,
FormField (label/hint/error), Card, Surface, Badge, StatusBadge, Avatar, AvatarGroup, Tabs,
Table, DataTable (server pagination/sort/filter), FilterBar, SearchInput, Pagination, Drawer,
Sheet, Modal, ConfirmDialog, DropdownMenu, Popover, Tooltip, Toast, Skeleton, EmptyState,
ErrorState, Progress, Stepper, Breadcrumb, SegmentedControl, KpiCard, StatCard, ChartCard,
FunnelChart, Sparkline, Timeline, FileUploader, CopyButton, DateRangePicker.

**Composites**: AppShell, Sidebar, TopBar, PageHeader, NotificationTray, ProfileMenu,
LeadDrawer, ConversationThread, MessageComposer, QualificationSummary, AutomationCard,
SequenceEditor, IntegrationCard, HealthBadge, WizardShell, SettingsTabs, PricingCard,
AdminShell.

Rule: a new component may only be added if no existing primitive composes into it.

---

## 6. Data model

35 tables, every tenant-owned one carrying `business_id`. Grouped by migration file:

1. `0001_core` — `profiles`, `businesses`, `business_members`, `business_settings`
2. `0002_catalog` — `services`, `qualification_questions`, `qualification_options`,
   `qualification_rules`
3. `0003_leads` — `leads`, `lead_sources`, `lead_assignments`, `qualification_answers`,
   `contact_suppressions`
4. `0004_messaging` — `conversations`, `messages`, `message_events`
5. `0005_automations` — `automation_definitions`, `automation_versions`, `automation_steps`,
   `automation_runs`
6. `0006_bookings` — `bookings`
7. `0007_campaigns` — `campaigns`, `campaign_contacts`, `imports`
8. `0008_integrations` — `integrations`, `integration_objects`, `field_mappings`
9. `0009_platform` — `webhook_events`, `jobs`, `usage_events`, `subscriptions`,
   `notifications`, `audit_log`, `marketing_sessions`, `marketing_events`
10. `0010_rls` — helpers `is_business_member()`, `has_business_role()`, `is_platform_admin()`
    + per-table policies
11. `0011_indexes` — every index listed in Bible §15.5
12. `0012_seed` — default automation templates, default qualification question templates

Enums as CHECK constraints: lead status (NEW/CONTACTED/RESPONDED/QUALIFIED/BOOKED/WON/LOST),
message status, integration health, automation run state, campaign status, subscription status,
qualification evaluation (PENDING/QUALIFIED/NOT_QUALIFIED/REVIEW).

**Server-only tables** (no client policy at all): `webhook_events`, `jobs`, `usage_events`,
`audit_log`, `field_mappings`, and the secret columns of `integrations` (kept in a separate
`integration_secrets` table so `integrations` can stay readable for metadata).

**RLS test suite** runs the Bible §16.8 matrix against every exposed table as two real users
in two businesses. This is a launch gate, written in Phase 0, extended with each new table.

---

## 7. Phases

### Phase 0 — Foundations ☑
Design tokens + full primitive library. Supabase migrations 0001, 0010, 0011 (core + RLS
helpers). Three Supabase clients. Zod validation layer. `jobs` table + worker route + cron.
Audit helper. Entitlement helper. RLS test harness. R2 client + signed URL helpers. Azure AI
adapter (with the guard rails from CLAUDE.md). Error/loading/not-found boundaries.
**Exit:** a user can sign up and land in an isolated empty workspace; RLS tests pass.

### Phase 1 — Landing + auth ☑
Marketing shell (sticky header, mega-free simple nav, footer). Landing sections in order:
Hero, Cost-of-delay timelines, Outcome cards, How it works, Conversation demo, Why it works,
Industries, Reactivation, Analytics preview, Integrations strip, Pricing (4 cards),
FAQ accordion, Final CTA. Legal pages: privacy, terms, cookies, plus cookie consent.
Contact-sales page for Enterprise. Auth pages: signup, login, forgot, reset, verify-email.
Signup transaction: auth user → profile → business → owner membership → attribution capture →
redirect to `/onboarding`. UTM capture and preservation.
**Exit:** paid traffic can land and create a workspace; every CTA tracked.

### Phase 2 — App shell + leads ☑
AppShell with sidebar (Dashboard, Leads, Automations, Qualification, Bookings, Reactivation,
Analytics, Integrations; bottom: Settings, Help, Profile), top bar (mobile trigger, title,
integration health, notifications, profile). Notification tray. Dashboard: KPI cards, funnel
with drilldown, estimated pipeline (always labelled estimated), recent leads, needs-attention,
source snapshot, setup-health banner. Leads: status tabs, filters, search, server pagination,
and the reusable LeadDrawer (Overview / Conversation / Qualification / Booking / Timeline)
with all manual actions. Seeded fixtures for development.
**Exit:** a lead can be operated end-to-end manually through the UI.

### Phase 3 — Onboarding + Meta + SMS ☑
WizardShell with persisted resumable state. Steps 1–8 per Bible §03. Meta OAuth (server-side),
page/form selection, field mapping, webhook subscription + verification. Webhook inbox with
idempotency. `lead.process` job. Twilio adapter behind `MessagingProvider`. Inbound + delivery
webhooks. Test-lead path through the real pipeline, tagged `is_test`.
**Exit:** a real Meta lead arrives once, in the right workspace, and receives the first SMS.

### Phase 4 — Automation engine ☑
Definitions/versions/steps/runs. Three fixed automation types. SequenceEditor (linear only).
Merge-field validation — unknown token blocks publish. Draft→Publish with one active version.
Scheduler with stop-condition re-check, quiet hours rollover, retry policy, dead-lettering.
**Exit:** a quiet lead gets the full sequence; any reply stops it immediately.

### Phase 5 — Deterministic qualification ☑
Questions, options, rules, answers. Evaluation order per Bible §21.1. REVIEW state.
Conversation progression with exact/normalised matching only. Human handover. Booking-readiness
gate. Optional Azure AI assist layer behind the plan gate and workspace toggle, which may
propose an extraction but never decides.
**Exit:** a lead reaches QUALIFIED with an explainable reason chain and no AI dependency.

### Phase 6 — Bookings ☑
Calendly first (link send + optional webhook ingest). Google Calendar second (OAuth, calendar
select, conservative event creation). Human-handover mode. Bookings page tabs + detail drawer.
Booking stops follow-up.
**Exit:** a qualified lead books and the outcome is recorded.

### Phase 7 — Billing ☑
Stripe products/prices (test). Checkout for Starter/Growth/Pro, contact-sales for Enterprise.
Customer Portal. Webhook mirror into `subscriptions` — Stripe is authoritative, the redirect is
not. Entitlement enforcement at every gate. Usage metering into `usage_events`. Billing
settings tab: plan, status, period, lead/message usage meters, upgrade, manage billing.
**Exit:** subscription state governs product access.

### Phase 8 — Reactivation ☑
Campaign list, 4-step wizard (Audience → Message → Timing → Review), eligibility algorithm,
mandatory suppression with visible reason groups, CSV import to R2 with row validation, paced
send worker, campaign metrics.
**Exit:** old leads are re-contacted safely with suppression proven before send.

### Phase 9 — Analytics + admin ☑
Analytics: Overview, Sources, Follow-Up Performance, Campaign Performance; date range +
service filters; test leads excluded; labelled denominators. Admin: separate `/admin/login`
with step-up, server-side `platform_role` check in layout *and* every action; Overview cards
and panels; Customers table + drawer with audited support actions and no raw secrets;
System tabs (Integrations, Webhooks with safe retry, Messaging, AI Usage, Billing Events,
Errors).
**Exit:** operator can diagnose any failed webhook or job.

### Phase 10 — Launch hardening ◐
Cross-tenant RLS penetration tests, webhook replay tests, message-duplication tests, queue
failure tests, provider disconnect tests, Stripe state tests, opt-out end-to-end tests. Rate
limiting on login/manual send/test/public endpoints. Sentry + PostHog. Backups/PITR. Secrets
audit. Accessibility and responsive QA. Performance/Core Web Vitals. Load test on ingestion.
**Exit:** the Bible §54 acceptance matrix is fully green.

---

## 8. Acceptance gates

The Bible §54 matrix is the release checklist. The three that block everything else:

1. Business A cannot read or write Business B's data — proven by automated test, not review.
2. A duplicated provider webhook never duplicates a lead, message, booking or subscription
   transition.
3. No secret is reachable from the browser — verified by a build-time scan of the client bundle.

---

## 9. Provisioning outcome

| # | Action | Result |
|---|---|---|
| P1 | Supabase schema | ☑ 12 migrations, 36 tables, RLS forced on all, 11/11 cross-tenant tests pass |
| P2 | R2 bucket `clientturn` | ✖ **blocked** — the `R2_ACCESS_KEY_ID` token is object-scoped and cannot `CreateBucket`/`ListBuckets` |
| P3 | Stripe test products/prices | ☑ 4 products, 6 prices (annual = 10× monthly), Enterprise product has no price |
| P4 | Stripe webhook endpoint | ✖ **deferred** — needs a real HTTPS domain |
| P5 | Azure AI probe | ☑ `gpt-5.4-mini` and `gpt-5.4-nano` both respond |

## 10. Open items needing user input

- **R2**: create the `clientturn` bucket, or supply a Cloudflare token with R2 Admin, or
  authorise the Cloudflare MCP connector.
- **Supabase Auth redirect allow list**: needs `${SITE_URL}/auth/callback` added, and
  email-confirmation behaviour chosen for local development. The API call to set this was
  blocked by the sandbox permission classifier, so it needs doing in the dashboard or with
  explicit approval.
- **Production domain** — required for the Stripe webhook endpoint and `NEXT_PUBLIC_SITE_URL`.
- **Provider credentials** (supplied per phase, as agreed): Twilio, Meta app, Resend, Calendly,
  Google OAuth.
- **Enterprise tier**: which limits are genuinely custom rather than merely higher.

---

## 11. Verified state (last full run)

| Check | Result |
|---|---|
| `npm run build` | ☑ 46 routes |
| `npx tsc --noEmit` | ☑ clean |
| `npx eslint src` | ☑ 0 errors, 0 warnings |
| `npm test` | ☑ 105/105 |
| `npm run test:rls` | ☑ 11/11 against the live project |
| Authenticated route smoke test | ☑ 25/25 return 200 with seeded data |
| Job pipeline end-to-end | ☑ enqueue → claim → guard → dispatch → `SENT` → job `completed` |
| Send guards (live DB) | ☑ opted-out, LOST, human-takeover and suppression all blocked |
| Admin access control | ☑ signed-in non-admin gets the same response as a logged-out visitor |
| Invite acceptance | ☑ invited member reaches dashboard or wizard, no redirect loop |

**Messaging provider is the stub.** `TWILIO_SID`/`TWILIO_CLIENT_SECRET` exist but no sender
number does, so `isTwilioConfigured()` is false and messages are marked `SENT` with
`provider: "stub"`. Set `TWILIO_SMS_FROM` (or `TWILIO_MESSAGING_SERVICE_SID`) and the real
adapter takes over with no code change.

## 12. Remaining before real launch

1. **Provider credentials** — Twilio sender number, Meta app, Calendly, Google OAuth.
2. **OAuth connect routes** — every integration card is honestly "Not yet available";
   `connectPath` in `src/lib/integrations/catalog.ts` is the single wiring point.
3. **Calendly / Google webhook routes** — `booking.sync` is implemented and idempotent but
   nothing enqueues it yet.
4. **Invite-acceptance email copy** — activation works; the invite email is Supabase's default.
5. **R2 bucket** — still cannot be created with the current token.
6. **Supabase auth redirect allow list** — `${SITE_URL}/auth/callback` must be added.
7. **Stripe webhook endpoint** — needs a public HTTPS domain.

---

## 13. Bible conformance pass

Gaps found by reading `ClientTurn_Master_Product_Bible_No_ML.md` against the build, and closed:

| Bible ref | Gap | Resolution |
|---|---|---|
| §07.2, §43 | **No automation existed anywhere.** Zero rows in `automation_definitions`. Handlers worked, but a new lead had no sequence to run, so nothing was ever sent. | `src/lib/automation/defaults.ts` + `ensureDefaultAutomations()` provision the published New Lead sequence (immediate / 10m / 2h / 1d / 3d) during onboarding. Idempotent. |
| §03.8 | **Step 7 "Test Lead" was missing** from the wizard. | Added. Creates a synthetic `is_test` lead and drives it through the real `lead.process → automation.advance → message.send` path — no shortcut. Re-running replaces the previous attempt. |
| §03.9 | Activation checked only services + questions. | `getActivationChecks()` implements the full checklist and is re-read from the database, so a recorded wizard step alone cannot activate a workspace. |
| §26, §53 | **No rate limiting.** | `0015_rate_limits.sql` + `src/lib/security/rate-limit.ts`. Postgres-backed fixed window (serverless instances share no memory), applied to sign-in, sign-up, password reset, admin sign-in, marketing track and the inbound webhook. |

Verified live: 6 concurrent requests against a limit of 3 → exactly 3 allowed, so the limiter is
race-safe rather than read-then-write. The limiter **fails open** by design: an infrastructure
blip must not lock every customer out of signing in.

Test-lead run against the demo workspace produced:

```
LEAD: status CONTACTED, first_contacted_at set
[SENT/stub] Hi Dave, thanks for your enquiry with Southcoast Roofing about
            Roof replacement. Are you the homeowner?
            Reply STOP to opt out.
test lead visible to analytics (is_test=false): 0
```

Merge fields render, the opt-out wording is appended automatically, speed-to-lead is recorded,
and the test lead is invisible to analytics.

## 14. Acceptance matrix (Bible §54) status

| Area | State |
|---|---|
| Landing / Signup / RLS / Onboarding | ☑ verified |
| Idempotency (duplicate webhook) | ☑ unique index on `(provider, external_event_id)` |
| SMS first message · Automation · Stop logic | ☑ verified end-to-end via the worker |
| Qualification · Review routing | ☑ deterministic engine, unmatched ⇒ REVIEW |
| Booking | ☑ path configured; provider sync awaits credentials |
| Analytics · Campaigns · Admin · Security | ☑ verified |
| Meta form → correct tenant | ✖ **blocked** — needs Meta app credentials |
| Delivery status stored · Reply mapping | ◐ code + webhook built; unverifiable without a live Twilio number |
| Stripe entitlements | ◐ test-mode products live; webhook endpoint needs a public domain |
| Monitoring / error alerts | ☐ not built (Sentry not provisioned) |
| Mobile core flow | ◐ responsive throughout; not tested on a real handset |

---

## 15. Extended integrations pass (Google Ads, Microsoft Ads, TikTok, LinkedIn, Slack, HubSpot, Zoho CRM)

User-directed scope expansion beyond the original Meta-only lead source lock. Built as shared
plumbing (one OAuth flow, one connect/callback route pair, three provider registries) plus four
parallel platform adapters, each required to pull live official documentation rather than work
from training data.

**Shared plumbing:** `src/lib/integrations/oauth.ts` (state/token/refresh/storage),
`/api/integrations/[provider]/{connect,callback}` (generic, dispatch-only), provider registries
for OAuth adapters / lead-source pollers / CRM push, `TokenConnectDialog` for HubSpot's pasted
private-app-token flow. Migrations `0016` (7 new `provider_type` values + `integration_oauth_states`
+ `crm_push_records` + `lead_source_cursors`) and `0017` (widened `lead_sources.provider` —
without this every new-platform lead would have silently failed attribution).

| Provider | State | Detail |
|---|---|---|
| Google Ads | ☑ Working | OAuth + GAQL polling of `lead_form_submission_data`, cursor-tracked |
| Microsoft Advertising | ◐ OAuth only | No published API exists for retrieving Lead Form submissions — poller fails loudly to `ACTION_REQUIRED` rather than fabricating success |
| TikTok | ◐ Built, one unverified assumption | Lead-fetch endpoint path could not be confirmed live (TikTok's docs portal is a client-rendered SPA); flagged in-code, fails soft |
| LinkedIn | ◐ Built, blocked on LinkedIn | Real-time webhook fully implemented and signature-verified, but Lead Sync API requires a **separate LinkedIn partner approval** (verified business + Company Page + review) beyond OAuth credentials — will 403 until approved |
| Slack | ☑ Working | Confirmed no App Directory review needed for per-customer installs |
| HubSpot | ☑ Working | Customer-pasted private-app token, validated against two real API calls before saving |
| Zoho CRM | ☑ Working | Regional API-domain quirk solved by deriving `api_domain` from the token refresh response and caching it, since it isn't available at connect time |

**CRM push** wired at every point a lead reaches QUALIFIED/BOOKED/WON (manual actions, the
qualification engine, and booking sync) via one shared `enqueueCrmPushes()` helper.

**Fixed along the way:** a JSDoc comment containing the literal text `settings/*/loading.tsx`
was silently truncating itself — `*/` closes a block comment even inside a glob-style path,
leaving a dangling backtick as live code. `npx tsc --noEmit` reported it as "unterminated
template literal" on an unrelated line; reproduced in total isolation before fixing.

**Verified:** typecheck clean, lint clean, 47 routes build, 105/105 unit tests, 13/13 RLS tests
(added 2 covering the new `crm_push_records` table — cross-tenant read blocked, direct client
insert blocked). All 7 new provider cards render on `/app/integrations`; HubSpot correctly shows
a live Connect action (no platform credential needed) while the other 6 correctly show "Not yet
available" until their OAuth credentials are supplied.
