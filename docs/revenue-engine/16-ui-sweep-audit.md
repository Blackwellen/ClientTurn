# 16. UI sweep audit: signed-in app, onboarding, auth and admin

Date: 2026-09-28. Scope: every route under `src/app/(app)`, `/onboarding`, `/start-trial`, `(auth)`,
`/admin/login` and the Admin shell chrome. The public marketing site was swept separately and is out
of scope here. Status column: **Fixed**, **Mitigated** or **Left** (with the reason).

## Method

- **Live sweep.** Dev server on port 3001, signed in as the demo workspace
  (`demo@clientturn.co.uk`, owner) with a one-time link from `scripts/dev-login-link.mjs` for that
  existing user. No new auth users, no writes, no sends. A single failed sign-in used a
  non-existent address.
- **Probe.** For each viewport the page drove the App Router through 29 routes by soft navigation
  and measured: horizontal page overflow and the elements causing it, touch targets under 40px,
  unlabelled buttons and inputs, technical error text in the rendered page, back links,
  breadcrumbs, dashes and emoji in the copy.
- **Viewports run.** 320, 360, 390, 414 and 430 portrait; 667×375, 844×390 and 932×430 landscape;
  768 and 1024 tablet portrait; 1024×768 landscape; 1280 and 1440 desktop. Zoom was run as
  equivalent CSS widths of a 1280px window: 125% = 1024, 150% = 853, 200% = 640 and 400% = 320
  (WCAG 1.4.10 reflow).
- **Static audit.** Source greps for `error.message` in JSX, hand-rolled red error text,
  `href="#"`, no-op handlers, disabled controls without a reason, destructive actions without a
  confirmation, missing `loading`/`error`/`not-found` files and back links.
- **Admin.** The demo account is not a platform admin, and raising it would be a permission
  change in the live database, so Admin interiors were audited statically. `/admin/login` was
  swept live.
- **Screenshots** are in `.qa-artifacts/ui-sweep/{before,after}/` (gitignored, local). Where no
  before image exists, the evidence is the probe result quoted in the row.

## Results by viewport (after fixes)

| Viewport | Routes with horizontal overflow, before | After |
|---|---|---|
| 320 portrait | 20 of 28 (topbar, then Dashboard grid and Find Leads tabs underneath) | 0 |
| 360 portrait | 6 | 0 |
| 390, 414, 430 portrait | 0 | 0 |
| 667×375 landscape | 1 (Leads toolbar) | 0 |
| 844×390, 932×430 landscape | 0 | 0 |
| 768, 1024 portrait, 1024×768 | 0 | 0 |
| 1280, 1440 | 0 | 0 |
| 125% / 150% zoom | 0 | 0 |
| 200% zoom (640) | 1 (Leads toolbar) | 0 |
| 400% zoom (320) | 20 (same as 320) | 0 (Follow-Up publish bar found on the re-run, fixed) |
| Auth pages and `/admin/login` at 320 | 0 | 0 |

No technical error text (SQL, HTTP status, stack or Zod) was rendered on any route in the live
sweep. The findings below are about how errors *would* reach a customer when an action fails.

## Findings

Severity: **P0** blocks a core task, **P1** a customer can hit it and gets stuck or confused, **P2**
visible defect or inconsistency, **P3** polish.

### 1. Navigation and back buttons

| # | Route | Issue | Sev | Status | Evidence |
|---|---|---|---|---|---|
| N1 | `/app/agents/[id]` | A missing or foreign agent fell through to the app-wide 404 ("This page does not exist") with no way back to Agents. | P1 | Fixed: `agents/[id]/not-found.tsx` | after: `after/agent-missing__320.png` |
| N2 | `/app/help/[category]`, `/[slug]` | An unknown category or article hit the app-wide 404. | P2 | Fixed: `help/[category]/not-found.tsx` | static |
| N3 | `/app/agents/new` | The wizard had no back link to Agents. | P2 | Fixed: `BackLink` | probe: `back=[]` before, `/app/agents` after |
| N4 | `/app/leads/import` | No back link above the wizard; "Back to Leads" existed only in the step 1 footer. | P2 | Fixed: `BackLink`; the footer link is now "Cancel" so there are not two identical actions | probe |
| N5 | 7 detail and sub pages | Back links came in three visual styles (accent underline, muted, bold), with mixed labels ("Find Leads", "All agents", "Back to Campaigns"). | P2 | Fixed: one `BackLink` primitive (`src/components/app/back-link.tsx`), fixed parent href, 44px on touch, labels "Back to X" | static |
| N6 | Any detail page | Back links must not depend on browser history (a page opened from a notification dead-ends). | P2 | OK, now guarded by a test | `tests/ui-sweep.test.ts` |
| N7 | `/app/find-leads/campaigns/[id]` | Pause/Resume/Archive appear in the header and in the Controls panel on Overview. | P3 | Left: deliberate. The code comment explains both are driven by one state machine, for people reading results. | static |
| N8 | Find Leads run, score and search pages when not on the plan | The plan-limit state has an upgrade link but no back link. | P3 | Left: the upgrade link is the next action, and the nav rail is present. | static |

### 2. Buttons, links and confirmations

| # | Route | Issue | Sev | Status |
|---|---|---|---|---|
| B1 | Find Leads → Recurring searches | "Stop this schedule" deleted the schedule in one click. | P1 | Fixed: `ConfirmDialog` (danger) |
| B2 | Find Leads → Prospects bulk bar | "Remove from campaign" acted on N prospects with no confirmation. | P1 | Fixed: `ConfirmDialog` (warning) stating that unsent steps are cancelled |
| B3 | Settings → AI & selling → Objections | The remove icon deleted custom objection wording in one click. | P2 | Fixed: `ConfirmDialog` (danger) |
| B4 | Find Leads → Campaigns filters | A filter with no options was disabled with no reason. | P2 | Fixed: `title` reason |
| B5 | All | No `href="#"`, no no-op `onClick`. Other disabled controls carry a reason (tooltip, hint or `disabledReason`). | — | OK |
| B6 | Search session archive; logo removal | One click, no confirmation. | P3 | Left: archive is soft and the logo is re-uploadable. |

### 3. Responsive, zoom and touch

| # | Route | Issue | Sev | Status | Evidence |
|---|---|---|---|---|---|
| R1 | Every `/app` route at 320 and 360, and 400% zoom | The topbar title was `shrink-0`, so the right cluster overflowed by up to 60px. At 320 the account menu (avatar) was fully off-screen, so there was no route to Account or Sign out. The menu button was squeezed to 16px wide. | **P1** | Fixed at source (`top-bar.tsx`): the title flexes and truncates, Tour moves to Help below `sm`, Copilot is icon-only on phones, the avatar chevron is hidden on phones. The same fix is in `admin-top-bar.tsx`. | before `before/reactivation__320.png`, after `after/reactivation__320.png` |
| R2 | `/app/find-leads` at 320 | The view tabs sat in an `overflow-hidden` container, so Intent, Campaigns and Social were clipped and unreachable. | **P1** | Fixed: the tabs scroll sideways and the clicked tab scrolls into view (`view-switch.tsx`) | after `after/find-leads__320.png` |
| R3 | `/app/leads` at 667×375 and 200% zoom | The search was fixed at 380px with `shrink-0`, pushing the Card/Table toggle off-screen. | P2 | Fixed: the search prefers 380px but may shrink | before `before/leads__667x375.png`, after `after/leads__667x375.png` |
| R4 | Dashboard at 320 and 360 | The revenue-control grid had no `grid-cols-1`, so the implicit track sized to a nowrap card (351px). | P2 | Fixed locally, plus at source: `@layer base { .grid > * { min-width: 0 } }` covers the 254 grids with the same latent pattern | after `after/dashboard__320.png` |
| R5 | Find Leads AI chat at 320 | A header with a nowrap "View example prompts" button did not wrap. | P2 | Fixed: `flex-wrap` | probe |
| R6 | All phone views | Topbar icon buttons and every `sm`/`xs` Button were 28 to 32px targets. | P2 | Fixed at source: `TOUCH_TARGET` in `ui/button.tsx` adds an invisible 6px hit area on coarse pointers (44px), with no layout change | static |
| R7 | Loading states at 320 | Fixed-width skeleton bars (`w-80`, `w-96`, `w-[300px]`) widened the page while it loaded; `w-96 max-w-full` does not cap inside a shrink-wrapped parent. | P3 | Fixed: `Skeleton` is `max-w-full`; 11 loading files use `w-full max-w-*` | observed on agents loading |
| R8 | Toasts on iOS | The toast stack ignored the bottom safe-area inset. | P3 | Fixed: `bottom-[max(1rem,env(safe-area-inset-bottom))]` |  |
| R9 | Landscape phones | The 60px floating support button covered toolbar controls mid-scroll. | P3 | Mitigated: it is 44px, 12px from the corner, on viewports under 500px tall. The main content already reserves `pb-24` for it at the page end. | `after/leads__667x375.png` (before the tweak) |
| R10 | Follow-Up at 400% zoom; any `PageHeader` with several actions | Action groups were `flex shrink-0` and could not wrap (Discard / Publish overflowed by 10px). | P2 | Fixed at source: `PageHeader`, the Follow-Up publish bar and `SettingsSaveBar` wrap | probe |
| R11 | Tables | Tables either become cards (Leads, Reactivation) or scroll inside their container; no table caused page overflow at any width. | — | OK | probe |
| R12 | Modals and drawers | The support panel is a full-screen sheet on phones; drawers and dialogs use `overflow-y-auto` bodies. | — | OK |  |

### 4. Error presentation

| # | Where | Issue | Sev | Status |
|---|---|---|---|---|
| E1 | Analytics, Follow-Up, Help, Leads list, Import, Reactivation, Settings, Support, Dashboard, `(auth)`, `/admin/login` | No section error boundary. A failure fell to the generic `(app)` boundary with no section-specific reassurance or way back. `(auth)` and `/admin/login` had none at all. | P1 | Fixed: 12 new `error.tsx` files |
| E2 | 12 existing boundaries | These logged with `console.error` only (never reaching Sentry), showed no reference, used a red icon and had inconsistent copy. | P2 | Fixed: all 24 now render the shared `RouteError` (`src/components/ui/route-error.tsx`). It gives a plain sentence, "Try again", a way back to the section and the error digest as a support reference, and it reports to Sentry via `reportClientError`. |
| E3 | 44 components (51 places) | `{error && <p className="text-danger-700">{error}</p>}` rendered whatever the server returned, in red, with no retry. | P1 | Fixed: `<FormError>` (amber, `role="alert"`) runs every message through `friendlyErrorMessage`. Field validation (`errors.x`, `fieldErrors.x`, anything wired to `aria-describedby`) stays field-level. |
| E4 | 263 toast calls | Error toasts showed `result.error` verbatim. | P1 | Fixed at source: `ToastProvider` passes error and warning titles and descriptions through `friendlyErrorMessage`. |
| E5 | Settings → Connections → Meta Pages | `refreshMetaPagesAction` and `selectMetaPageAction` returned the raw exception or Graph message. | P1 | Fixed: `actionFailure()` (`src/lib/errors/action-error.ts`) logs the real error with a reference and returns "... (Ref ABC123)". |
| E6 | Reactivation CSV import | The warning interpolated the storage exception text and HTTP status. | P2 | Fixed: plain sentence; the detail is logged. |
| E7 | CRM push failures, message delivery errors, failed sourcing run, intent monitor, payments webhook card | Stored provider errors were rendered verbatim. | P2 | Fixed: `friendlyErrorMessage` with a contextual fallback. Friendly provider sentences still pass through. |
| E8 | `ErrorState` | Load failures used a red danger icon. | P3 | Fixed: warning tone, `role="alert"`, optional reference and secondary action. |
| E9 | Sign-in | A failed sign-in says "That email and password do not match." The service layer is already opaque ("That action could not be completed."). | — | OK |
| E10 | Developer → Webhooks deliveries; Admin | These show raw HTTP and error detail. | — | Left on purpose: developer and operator audiences need the detail. |

The mapping is `src/lib/errors/friendly.ts`. It is pure, so the client, server and tests share
it. Hand-written messages pass through (with any "Error:" prefix removed). Postgres, PostgREST,
RLS, JWT, network, JS runtime, stack-frame, HTTP-status, Zod, HTML-page and `WriteError` texts
become the caller's fallback. The genuine failure is never hidden: the customer always sees that
it failed, and the log carries the detail.

### 5. Visual polish and consistency

| # | Issue | Sev | Status |
|---|---|---|---|
| P1 | Em dashes in UI copy. The rule is no dashes in UI copy. | P3 | Fixed: 141 strings in 77 files, rewritten through the AST (string literals and JSX text only; comments, en-dash time ranges and log text untouched). Paired dashes became commas, short tails became colons, and the rest became sentences. Left: billing, voice, quotes, invoicing, affiliates, admin and marketing files (owned by other agents or out of scope), plus server-side lib messages. |
| P2 | `/app/support`, `/onboarding` and `/start-trial` had no loading state (a blank screen at signup on a slow render). | P2 | Fixed: 3 `loading.tsx` |
| P3 | Emoji in UI | — | None found |
| P4 | Shared `IntegrationRequiredState` and `PermissionDeniedState` (gap audit 15, §1) did not exist. | P2 | Added to `ui/feedback.tsx`. Left: adopting them per route (Leads, Inbox, Agents, Analytics) needs a product decision on which role or connection gates what. |
| P5 | Status badges | — | OK: one mapping, `StatusBadge` in `ui/badge.tsx` |

### 6. Accessibility

| # | Issue | Sev | Status |
|---|---|---|---|
| A1 | Below `sm` the Copilot button's only text was `hidden` (display:none), so it had no accessible name on phones. | P2 | Fixed: `aria-label="Copilot"` |
| A2 | Error states had no live-region role. | P3 | Fixed: `ErrorState` and `FormError` are `role="alert"` |
| A3 | Unlabelled buttons | — | None found. The probe's "unlabelled inputs" were the `aria-hidden` native selects behind the custom `Select` (false positives). |
| A4 | Auth "Keep me signed in" and Terms checkboxes are 18px. | P3 | Left: each is wrapped in its label, so the target is the whole label row. |
| A5 | Focus rings and keyboard support in menus, drawers and modals | — | OK in primitives (`focus-visible:outline-*`, focus trap and Escape in `drawer.tsx`) |

## Counts

| Category | Found | Fixed | Mitigated | Left (with reason) |
|---|---|---|---|---|
| Navigation | 7 | 5 | 0 | 2 |
| Buttons, links, confirmations | 5 | 4 | 0 | 1 |
| Responsive, zoom, touch | 10 | 9 | 1 | 0 |
| Error presentation | 9 | 8 | 0 | 1 (intentional) |
| Visual polish | 3 | 2 | 0 | 1 (adoption of the new state components) |
| Accessibility | 3 | 2 | 0 | 1 |
| **Total** | **37** | **30** | **1** | **6** |

## Tests

`tests/ui-sweep.test.ts` (98 tests, registered in `test:g1`) covers:

- the friendly-error mapping;
- every `/app` route having a loading state and a section error boundary, with a section not-found
  for dynamic routes that call `notFound()`;
- every boundary rendering `RouteError` and never `error.message`;
- no `{error.message}` or `{String(error)}` in customer JSX, and no hand-rolled red action error;
- toasts and `FormError` sanitising their text;
- `actionFailure` in the Meta actions;
- every detail, sub and wizard route being registered with a fixed `BackLink` target, with no
  `router.back()`;
- the topbar, touch-target and grid safety-net rules.
