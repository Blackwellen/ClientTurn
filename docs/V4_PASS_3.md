# V4 — third completion pass

Appendix to `V4_BUILD_PLAN.md` and `V4_PASS_2.md`. This pass builds the three
surfaces `V4_PASS_2.md` listed as "still not built".

## Admin → Support (`/admin/support`)

`lib/admin/support.ts` (reads), `lib/admin/support-types.ts` (pure),
`lib/admin/support-actions.ts` (writes), `components/admin/support`.

Four queues — Inbox, Open, Waiting, Resolved — beside a thread. The selected
ticket lives in the URL so a thread can be handed to another operator by pasting
a link, and so the server decides what that operator may read.

Three decisions worth naming:

- **The queue is sorted longest-waiting first.** A support queue sorted
  newest-first is how the hardest tickets never get answered.
- **A note and a reply never look alike.** Different tab colour, different
  textarea background, different button. Sending an internal note to a customer
  is the failure a support desk cannot take back.
- **Opening a thread is audited.** Reading another tenant's own words is a
  privileged read (§95), so it is recorded as `admin.support_view` whether or
  not the operator replies.

`first_response_at` is written once and never again, so a ticket that reopens
when the customer replies cannot rewrite its own response time.

### `guarded()` extracted

`actions.ts` held the only authorisation path for a mutating admin action —
authorise, step-up, audit — as a private function. It now lives in
`lib/admin/guarded.ts` and Support and Affiliates import it. A second copy of
that logic is how one admin surface eventually ends up without step-up.

## Affiliate portal (`/affiliates`)

`lib/affiliates/{types,queries,actions,attribution,attribution-core,nav}.ts`,
`components/affiliates`, plus the public programme page and seven portal pages.

The boundary the whole feature protects: **an affiliate is a platform-level
actor, never a member of the workspace they referred.** No query joins to a
referred tenant's data, and `referralLabel()` shows a referral by sign-up date
unless the customer opted into being named. The Referrals page says so on the
page rather than burying it in terms.

### Where the service role is used, and why

Partner rows are read through the caller's own RLS-scoped client —
`current_affiliate_id()` (0036) restricts them, so a bug in the query layer
cannot widen what a partner sees. Two tables have **no browser grant at all**
and so must go through the service role: `affiliate_commission_plans` (the
platform's commercial terms) and `affiliate_clicks` (raw traffic carrying
visitor hashes). Both are read only after the RLS query has proved who the
caller is, and both are scoped by that resolved affiliate id — never by a value
from the request.

### Attribution (`/r/[slug]`)

Last touch within the plan's cookie window. The click route resolves the slug,
records the click, sets a signed cookie and redirects — and never 404s a
visitor, because a broken link is the affiliate's problem to see in their
dashboard, not the visitor's problem to read about.

- **The destination is a fixed allow-list**, re-checked at redirect time as well
  as at creation. An affiliate-chosen landing path would turn a link carrying
  our brand into an open redirect.
- **No raw IPs.** A visitor is a salted hash; the salt is a server secret.
- **Self-referral earns nothing**, checked against `affiliates.user_id` rather
  than anything the browser sent, and recorded as rejected rather than dropped
  so the reason survives the question.
- One attribution per business, ever — enforced by the partial unique index, so
  a race between two signup paths cannot pay twice.

`attributeSignup()` is wired into `lib/auth/actions.ts` after the workspace
exists, inside its own try/catch: referral credit must never be able to block
account creation.

### Money

`commissionFor()` is pure and tested from the direction that matters — it can
never return more than the customer actually paid, even with a percent
misconfigured above 100 or a flat fee larger than the invoice. Reversed
commission contributes to no total anywhere: counting it would show a partner
earnings they will not receive.

Payment details are deliberately minimal — a method, a name and one reference
string. No sort codes, no account numbers. Saved values are never read back into
the form; the server returns only whether details exist.

## Admin → Affiliates (`/admin/affiliates`)

`lib/admin/affiliates.ts`, `lib/admin/affiliates-types.ts`,
`lib/admin/affiliate-actions.ts`, `components/admin/affiliates`.

Six tabs. Applications first, because the queue exists to be worked and a list
sorted by join date buries the one thing on it needing a decision. Only the
active tab's rows are loaded.

- **A partner cannot be activated without commission terms.** They would start
  referring customers with no defined rate and the accrual arithmetic would have
  nothing to work from.
- **Declining and suspending both require a reason**, because the applicant
  sees it. "Rejected" with no explanation is a support ticket.
- **"Mark paid" does not send money.** A person makes the transfer and records
  it here with the bank's reference, so our record can be reconciled. Wiring a
  payout button to a transfer API is how a double-click becomes a
  double-payment.
- A commission already inside a payout cannot be reversed — the money is
  committed to a batch, and unpicking it would make the payout total disagree
  with its own line items.

## Migration `0052_v4_affiliate_functions.sql` (applied)

Link counters as `security definer` functions, because a click is a concurrent
write on a hot row and read-modify-write from the app loses counts under load.
Plus `affiliate_summaries()` for the admin list and `approve_due_commissions()`
for the worker. None is granted to a browser role: a partner must not be able to
enumerate other partners' earnings.

## Three front doors

The product has three separate sign-in surfaces and they stay separate:

| Door | Audience | Signs out to |
|---|---|---|
| `/login` | Customers | `/login` |
| `/admin/login` | Platform operators | `/admin/login` |
| `/affiliates/login` | Partners | `/affiliates/login` |

`signOut()` previously sent everyone to `/login`, so a partner signing out of
the portal landed on a door they may have no account for. It now takes an
optional destination validated against an allow-list of exactly those three
paths, failing closed to `/login`. Admin sign-out already returned
`/admin/login` and is unchanged.

The partner portal had no sign-out at all and a "Back to ClientTurn" link into
`/app` — which bounces a partner who has no workspace. Both replaced with a
sign-out that returns to the partner login.

The one deliberate cross-link is on `/affiliates/login`: "Looking for your own
workspace? Customer sign in". Someone at the wrong door should be pointed at the
right one, clearly labelled.

`/affiliates` linked to `/signup?redirect=/affiliates`, but `signUp` ignores a
redirect entirely — it always goes to email verification and then customer
onboarding. The dead parameter is removed and the copy now says what actually
happens rather than promising a return trip the code does not make.

## Partner signup and onboarding

`lib/affiliates/signup-actions.ts`, `lib/affiliates/onboarding.ts` (pure, 21
tests), `components/affiliates/onboarding-wizard.tsx`, and the
`/affiliates/signup` → `/affiliates/verify-email` → `/affiliates/onboarding` →
`/affiliates/app` path.

### Why partners do not use customer signup

Customer `signUp` provisions a business, a settings row, a trial subscription
and an owner membership. A partner is not a tenant and needs none of that —
routing them through it would leave an empty workspace behind for every person
who only ever wanted a referral link, and drop them in customer onboarding
being asked to name a business they do not have.

`signUpPartner` creates exactly two things: the auth user and their profile. It
shares the credential store, the rate limiter and the enumeration behaviour with
customer signup, because those are properties of the account system rather than
of either door. If the profile write fails the auth user is deleted, so nothing
half-built survives.

### Onboarding is the application

The `affiliates` row is written **once, at the end**. An abandoned wizard leaves
no partial partner record for an operator to puzzle over. Five steps — About
you, Your audience, How you'll promote, Getting paid, Check and submit — each
gated by the same pure rules the server re-runs at submit, because the wizard
runs in a browser and a resumed draft must not be able to create a partner with
an empty audience field. That field is the one a reviewer actually reads.

Two judgement calls in the validation:

- **Payout details are optional, but half-filled is refused.** Someone can be
  approved and add them before the first payout run. A method with no reference
  looks saved and fails silently later, which is worse than blank.
- **The audience description has a floor of twenty characters**, roughly one
  honest sentence. Less cannot tell a reviewer anything.

The draft is kept in `sessionStorage` so a refresh does not cost someone the two
minutes they just spent, but a stored draft only ever refills the form — it can
never skip a step.

### Verification lands in the portal

`/affiliates/verify-email` mirrors the customer page with a different
destination, and `ResendVerification` took a `next` prop (defaulting to the
existing customer value) so a resent link cannot quietly move a partner into the
customer flow.

`/auth/callback` now derives the **door** from the destination rather than
carrying it as a second parameter — the two can then never disagree. A failed
`/affiliates/*` link returns to the partner login, an `/admin/*` one to the
operator login, everything else to `/login`.

### One path in, not two

The inline apply form on `/affiliates` and its `applyToProgramme` action were
removed. Two paths creating the same record with different validation is how one
of them ends up accepting an application a reviewer cannot act on.
`completeOnboarding` is now the only writer of an `affiliates` row.

## Auth design system

The four `Designs#/Auth` mockups are already implemented as `AuthShell` +
`AuthBrandPanel` + `AuthCard`. This pass added two variants to that system
rather than building anything new:

- **`partner-signup`** — programme-specific headline, features and product
  visual, switching to the partner login rather than customer signup.
- **`admin`** — the operator door, redesigned onto the same shell and card so
  the product reads as one thing. It deliberately carries none of the
  marketing: `isInternalVariant()` suppresses the "trusted by" logo strip, the
  handwritten annotation and the sign-up switch. Someone arriving there already
  works here. The form drops "keep me signed in" and password reset too —
  operator accounts are provisioned, not self-served, and a long-lived session
  on a platform-wide account is not a convenience worth having.

`AuthDarkShell` was extracted so every dark auth route opts into the environment
for itself. That matters under `/affiliates`, where the dark doors and the light
portal are interleaved and `/affiliates/app` must not be pulled into
`ct-force-dark`.

## Also changed

- `audit.ts`: support and affiliate actions added to `AuditAction`; `entityId`
  widened to accept `null`, since a bulk action has no single entity to name.
- `rate-limit.ts`: `affiliate:apply` and `affiliate:click`.
- `package.json`: the `test:rls*` scripts loaded only `.env.local`, but the
  Supabase credentials live in `.env` — they now load both, `.env.local` last so
  it still wins. The suite had been failing to start.
- `admin/nav.ts`: Support and Affiliates added. `tests/admin.test.ts` pinned
  both — `/admin/support` had been on the *forbidden* list from the V3 IA
  consolidation, and V4 §39/§41 reinstate both surfaces.

## Environment repair

`node_modules/@aws-sdk/checksums` had extracted without its `dist-cjs`
directory, so anything importing `lib/storage/r2` failed at page-data
collection. Pre-existing — `campaigns/actions.ts`, `settings/actions.ts` and
`settings/queries.ts` already import it — but the new resource-download route
was collected first and surfaced it. Fixed by reinstalling the package.

## Verification

```
npx next build       # clean
npx tsc --noEmit     # clean
npm test             # 891 + 81
npm run test:rls:v4  # 25, live database
npm run audit:db     # 137 tables, 34 functions — all exist
```
