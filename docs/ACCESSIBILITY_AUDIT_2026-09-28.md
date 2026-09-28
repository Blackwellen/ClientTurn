# Accessibility audit — 2026-09-28

Target: **WCAG 2.2 AA**. Scope: the app shell (sidebar, top bar), Dashboard, Leads list and
lead page, Inbox, Follow-Up (incl. LinkedIn Assist), Agents, Settings (Connections, Team, Data
Controls), Billing, and the public site (home, pricing, product pages, SDR cost calculator, legal
pages incl. `/dpa`, affiliates) plus the auth doors they link to.

## Method

1. **Static review** of the shared primitives in `src/components/ui/` first (so fixes propagate),
   then the shells and the screens in scope.
2. **Ad-hoc `eslint-plugin-jsx-a11y` pass** (recommended rules, run from a scratch config against
   the existing transitive dependency; the project lint config is unchanged).
3. **axe-core 4.13** (already present as a transitive dependency of `eslint-config-next`) driven by
   Playwright (existing dev dependency) against a local `next dev` on every public route at
   **1440px and 320px**, tags `wcag2a/aa, wcag21a/aa, wcag22aa, best-practice`, after scrolling
   each page so reveal animations settle. Also recorded: h1 count, `<main>` count and horizontal
   overflow at 320px. Nothing was published or sent anywhere.
4. **Pure contrast test** over the real token values (`tests/a11y-contrast.test.ts`) and a
   source-level wiring guard for the primitive fixes (`tests/a11y-primitives.test.ts`). Both are
   registered in `test:g1`. No new dependency was added.

Authenticated screens were reviewed statically only: rendering them in a browser needs a real
session, and minting one means calling production Supabase auth, which this audit did not do.

## Brand and semantic token contrast (computed, WCAG 2.x formula)

| Pair | Ratio | Verdict |
|---|---|---|
| Lime `#B7F34A` on white | 1.32 | Fails everything. Lime is never text, focus or a boundary on light surfaces. |
| Lime on cloud `#F7F9FC` | 1.25 | As above. |
| Soft lime `#E7FFC0` on white | 1.08 | Decorative tint only. |
| Lime on midnight `#0B1020` | 14.36 | Pass (text, focus). |
| Lime on public black `#050814` / `#020409` | 15.2 / 15.6 | Pass. |
| Lime on sidebar rail `#090E14` | 14.69 | Pass — now the rail's focus colour. |
| Midnight on lime (primary button) | 14.36 | Pass. |
| Midnight on soft lime | 17.55 | Pass. |
| Midnight on white / cloud | 18.93 / 17.95 | Pass. |
| Text accent `#38530E` (accent-700) on white | 8.71 | Pass (light-theme focus ring and accent text). |
| Text accent `#38530E` on sidebar rail | 2.22 | **Failed** — was the rail's focus ring. Fixed by remapping. |
| accent-600 `#486B12` on white | 6.20 | Pass (field focus border, switch on, current page chip). |
| Text muted / subtle on white | 5.74 / 4.98 | Pass (4.55 on surface-sunken). |
| success-600 / warning-600 / info-600 on white (before) | 3.73 / 3.49 / 4.00 | **Failed** as text. Now 4.96 / 4.95 / 4.96. |
| danger-600 on danger-50 (before) | 4.44 | **Failed**. Now 4.56. |
| White on success-600 button (before) | 3.73 | **Failed**. Now 4.96. |
| Field border `#D3DAE5` on white | 1.41 | Open (see O1). |
| Switch off track (before `#D3DAE5` / now `#6B7A8F`) | 1.41 / 4.37 | Fixed. |
| Field focus ring alone (accent-700 @ 45%) on white | 2.24 | Not sufficient alone; the accent-600 border now carries the 3:1. |

## Findings

Severity: **Critical** blocks a task for a group of users; **Serious** makes a task very hard or
fails an AA criterion outright on a shared surface; **Moderate** fails AA locally or degrades a
pattern; **Minor** is a small AA miss or a best-practice issue.

| # | Issue | WCAG | Severity | Where | Status |
|---|---|---|---|---|---|
| 1 | Main-navigation links (and every rail control without its own class) showed the global focus ring in accent-700 on the near-black rail: 2.2:1, effectively invisible | 2.4.7, 1.4.11 | Serious | `app/sidebar.tsx` (+ admin / affiliate rails), mobile nav | Fixed — `.ct-rail, .ct-on-dark` remap `--lr-text-accent` to lime (14.7:1) in `globals.css` |
| 2 | Text fields, selects and search boxes signalled focus with a lime border (1.3:1) and a translucent ring (2.2:1) | 2.4.7, 1.4.11 | Serious | `ui/field.ts`, `ui/select.tsx`, `ui/search-input.tsx`, `leads/lead-search-input.tsx`, `find-leads/.../token-select.tsx`, `admin/admin-search.tsx` | Fixed — new `--lr-focus-border` token (accent-600 6.2:1 on light; lime in dark scopes) |
| 3 | Top-bar search trigger focus was ring-only (2.2:1) | 2.4.7 | Serious | `app/top-bar.tsx`, `affiliates/shell/affiliate-top-bar.tsx` | Fixed — standard accent outline |
| 4 | Reactivation SMS/WhatsApp message box and rich-text email editor had no focus indicator at all | 2.4.7 | Serious | `reactivation/wizard/message-timing-step.tsx`, `rich-text-editor.tsx` | Fixed — `focus-within` border + ring on the wrapper |
| 5 | Find Leads chat composer and prospect cards used lime (`accent-300`, `accent-500/40`) as the focus cue on white | 2.4.7, 1.4.11 | Serious | `find-leads/chat-composer.tsx`, `find-leads/prospect-card.tsx` | Fixed |
| 6 | Status -600 colours used as text (~170 usages) failed 4.5:1; success button text failed | 1.4.3 | Serious | tokens in `globals.css` | Fixed — success/warning/info/danger-600 walked down in lightness (same hue) to ≥ 4.5:1 on white, cloud, sunken and own tint |
| 7 | Switch "off" track was 1.4:1 against the surface; success "on" 2.6:1 | 1.4.11 | Serious | `ui/form.tsx` `Switch` | Fixed — `--lr-switch-off` (neutral-500, 4.4:1), success-600 |
| 8 | Auth/onboarding dark scope: subtle text 4.33:1 on surface, 3.35:1 on raised | 1.4.3 | Serious | `.ct-force-dark` | Fixed — `#8390A2` (≥ 4.5:1 on every dark ground) |
| 9 | Public site subtle text 3.8–4.3:1 on cards and canvas | 1.4.3 | Serious | `.ct-marketing` in `clientturn.css` | Fixed — `#6D819A` |
| 10 | Public product mock-ups: grey captions 2.8–4.4:1, white on `#2F7DF7` pills/buttons 3.9:1, calculator "Estimated saving" 4.3:1 (axe: ~300 nodes) | 1.4.3 | Serious | `home/app-frames.tsx`, `home/partner-frame.tsx`, `find-leads.css`, `lead-conversion.css`, `sdr-calculator.css`, prospects panel, hero chat | Fixed — same-hue shades that clear 4.5:1. "Turn" in the wordmark mock is a logotype (exempt) |
| 11 | Tooltip text was never announced: `aria-describedby` sat on the wrapping `<span>`, which never takes focus. KPI hints, integration status, campaign badges were sighted-only | 1.3.1, 4.1.2 | Serious | `ui/tooltip.tsx` (37 call sites) | Fixed — focusable triggers are described directly from an always-mounted node; non-focusable triggers get an `sr-only` copy; redundant copies skipped |
| 12 | Tooltip bubble ignored the pointer (could not be hovered) and Escape on it also closed the drawer behind | 1.4.13 | Moderate | `ui/tooltip.tsx` | Fixed — hoverable with a 120 ms grace, Escape captured and consumed |
| 13 | Toasts: each card was a live region inserted together with its text, which NVDA/VoiceOver often do not announce | 4.1.3 | Serious | `ui/toast.tsx` | Fixed — two persistent `sr-only` regions (polite / assertive for errors) receive the text |
| 14 | Clickable prospect rows were mouse-only (no tab stop, no key handler); row checkboxes were named "Select row <uuid>" | 2.1.1, 2.4.6 | Serious | `ui/data-table.tsx`, `find-leads/prospects-view.tsx` | Fixed — focusable rows, Enter/Space, `rowLabel` for names |
| 15 | Scroll containers could not be scrolled by keyboard in Firefox/Safari (axe `scrollable-region-focusable`) | 2.1.1 | Serious | `ui/table.tsx` (legal pages, app tables), pricing comparison, developers reference tables, product screens, Find Leads prospect table and chat lists | Fixed — new `ui/scroll-region.tsx`; `useScrollableRegion` now measures both axes and only adds a tab stop while content overflows |
| 16 | Import wizard: every "match your columns" select was unlabelled (name was a sibling `<span>`) | 1.3.1, 3.3.2, 4.1.2 | Serious | `leads/import/import-wizard.tsx` | Fixed — `aria-label="Column for …"` |
| 17 | Inbox agent panel: handover note textarea was placeholder-only; suggested-reply editor had no name | 3.3.2, 4.1.2 | Serious | `inbox/agent-panel.tsx` | Fixed |
| 18 | Public mobile menu: `aria-modal` dialog whose only close button is outside it (unreachable for touch screen-reader users); focus fell to `<body>` on close | 2.1.1, 2.4.3 | Serious | `marketing/public/public-header.tsx` | Fixed — in-dialog "Close menu" (visible on focus), focus returned to opener |
| 19 | App pages had no h1 on desktop (PageHeader/DashboardHeader were h2; the only h1 was the mobile top-bar title, hidden at `lg`); phones got two h1s | 1.3.1, 2.4.6 | Moderate | `app/page-header.tsx`, `dashboard/dashboard-header.tsx`, app/admin/affiliate top bars | Fixed — page titles are h1, top-bar titles are `<p>` |
| 20 | Tabs used global ids (`tab-overview`), so two tab sets could collide and arrow keys could focus the wrong one | 4.1.2 | Moderate | `ui/tabs.tsx` | Fixed — `idBase` scoping; `aria-controls` only when panels exist |
| 21 | SegmentedControl announced tabs with no tab panels; every `aria-controls` pointed at a missing id | 4.1.2 | Moderate | `ui/tabs.tsx` (view toggles, Follow-Up view switch, admin filters) | Fixed — radio-group semantics (arrow keys already selected) |
| 22 | Select/Combobox listbox had no accessible name | 4.1.2 | Moderate | `ui/select.tsx` | Fixed — named from the control's label / aria-label on open |
| 23 | Popover Escape also closed the drawer behind it | 2.1.2 (owner rule: Escape closes top overlay only) | Moderate | `ui/popover.tsx` | Fixed — registered in the drawer layer stack via `useEscape` |
| 24 | Auth doors had no landmarks at all | 1.3.1 | Moderate | `(auth)/layout.tsx` | Fixed — `<main>` |
| 25 | Find Leads product page: `<dl>` containing icons and wrapper divs (axe `definition-list`, `dlitem` ×20) | 1.3.1 | Moderate | `find-leads/business-learning-section.tsx`, `hero/find-leads-hero-chat.tsx`, `find-leads.css` | Fixed — list of label/value rows |
| 26 | `aria-readonly` on a `<p>` | 4.1.2 | Minor | hero chat composer mock | Fixed |
| 27 | Mega-menu triggers declared `aria-haspopup="true"` (menu) for a panel of links | 4.1.2 | Minor | `public-header.tsx` | Fixed — disclosure pattern |
| 28 | Public `<main>` not focusable, so the skip link moved scroll but not focus in some browsers | 2.4.1 | Minor | `(marketing)/layout.tsx` | Fixed — `tabIndex={-1}` |
| 29 | Search clear (18px) and Combobox clear (20px) targets | 2.5.8 | Minor | `ui/search-input.tsx`, `ui/select.tsx` | Fixed — 24px |
| 30 | Integration chip announced only "Healthy" | 2.4.6 | Minor | `app/top-bar.tsx` | Fixed — `sr-only` "Integrations:" |
| 31 | Paging a table gave screen-reader users no cue | 4.1.3 | Minor | `ui/pagination.tsx` | Fixed — polite range line |
| 32 | `aria-label` on a generic `<span>` (+N avatars) | 4.1.2 | Minor | `ui/avatar.tsx` | Fixed — `role="img"` |
| 33 | Find Leads product page: the footer's primary "Approve for outreach" button rendered grey caption text on lime (2.9:1) — a caption selector out-ranked the button's colour | 1.4.3 | Serious | `find-leads.css` | Fixed |
| 34 | Public pages sat on the app's cloud-grey `<body>`: a light flash on overscroll, and cells scrolled sideways out of view measured against it (axe: `/developers` at 320px, 17 nodes) | 1.4.3 | Minor | `clientturn.css` (`body:has(.ct-public-root)`) | Fixed |
| O1 | Field and select borders (`--lr-border-strong` `#D3DAE5`) are 1.41:1 against white | 1.4.11 | Moderate | every input | **Open** — a design decision: the nearest passing grey (neutral-500) visibly darkens every form. Fields are also identified by label position and shadow; owner to decide |
| O2 | SegmentedControl selected state is a white fill on `#F1F5F9` (1.1:1) plus darker text | 1.4.11 | Minor | `ui/tabs.tsx` | **Open** — design; state is also exposed as `aria-checked` |
| O3 | Heading levels skip (h1 → h3) in Follow-Up cards, `EmptyState`, pricing chart title, product mock-ups | 1.3.1 (advisory) | Minor | several | **Open** — needs per-page restructuring, not a primitive change |
| O4 | Tooltips on non-focusable triggers (badges, truncated cells) are not reachable by a sighted keyboard user | 2.1.1, 1.4.13 | Moderate | ~15 call sites (Find Leads campaigns, prospect cells, intent view) | **Partly fixed** — text now reaches screen readers (#11); keyboard reveal needs each trigger made focusable or the text shown inline |
| O5 | Decorative loops (public path pulse, live-call dot and wave) have no pause control when reduced motion is off | 2.2.2 | Minor | `clientturn.css`, `revenue.css` | **Open** — decorative; all stop under `prefers-reduced-motion`; a pause control is a design change |
| O6 | Toasts (errors included) auto-dismiss after 5 s | 2.2.1 | Minor | `ui/toast.tsx` | **Open** — pause on hover/focus exists and the text is announced; recommend errors persist until dismissed (behaviour change, owner call) |
| O7 | Switch (36×20) and Checkbox (16×16) are under 24px | 2.5.8 | Minor | `ui/form.tsx` | **Open (passes via spacing exception** in current layouts); not enlarged to keep density |
| O8 | Deliberately dimmed illustration states: home "revenue journey" steps not yet reached (opacity .55, 2.4:1) and lead-conversion "excluded" contact rows (opacity .58, 1.5–4.5:1). The "Turn" of the ClientTurn wordmark in the mock-ups (2.9:1) is a logotype and exempt | 1.4.3 | Minor | `revenue.css`, `lead-conversion.css` | **Open** — the dimming is the information ("upcoming", "excluded"); raising it to 4.5:1 removes the effect. Owner call: treat as incidental, or restate the state with a label and un-dim |
| O9 | `/affiliates` hero `<section>` shares its accessible name with another landmark | best practice | Minor | `affiliates/public/affiliate-hero.tsx` | **Open** — low impact |
| O10 | Onboarding and admin forms: a few labels not associated (business step, affiliate onboarding, admin programme panel, admin support reply) | 1.3.1, 4.1.2 | Moderate | onboarding / admin | **Open** — outside this audit's scope list |
| O11 | Authenticated screens not run through axe in a browser | — | — | app | **Open** — needs a local test session that does not touch production auth |

**Counts:** 34 fixed — 0 critical, 18 serious, 8 moderate, 8 minor. 11 open or partly open —
0 critical, 0 serious, 3 moderate, 7 minor, plus 1 coverage gap (authenticated screens not run in
a browser).

**axe result after fixes** (21 public routes x 2 widths): 0 critical/serious findings other than
O8; remaining items are `heading-order` (O3), `landmark-unique` on `/affiliates` (O9) and the
dimmed illustration states (O8). Before: ~360 failing nodes at 1440px alone, across `color-contrast`,
`scrollable-region-focusable`, `definition-list`/`dlitem`, `landmark-one-main`/`region` (auth),
`aria-allowed-attr`.

## What was already in good shape

Skip link and focusable `<main>` in the app shells; drawer/modal focus traps with a layer stack;
`FormField` wiring `aria-describedby`/`aria-invalid` and `role="alert"` errors; `IconButton`
requiring a label; charts with `sr-only` data tables; reduced-motion handling across the Three.js
hero, Motion sections and CSS (global and per-stylesheet); rail density tiers for 200% zoom; no
horizontal scroll at 320px on any public route.

## Regression guards

- `tests/a11y-contrast.test.ts` — every text / focus / state pairing above, from the live token
  values (light app, rail, `.ct-force-dark`, `.ct-auth`, `.ct-marketing`).
- `tests/a11y-primitives.test.ts` — the wiring each primitive fix depends on.
