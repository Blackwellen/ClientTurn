# 24 · Remediation Log

What has actually been changed since the audit, and what each change is worth. Kept separate from
the audit documents so those stay a record of what was found, and this stays a record of what was
done.

**Note on concurrency.** A second agent has been working in the same tree throughout, building
`src/lib/services/` (the canonical service layer — Phase 3) and `0062_usage_ledger.sql` (Phase 7).
Everything below is deliberately clear of those files. Where the two collide, it is called out.

---

## Done

### R1 · Migration 0054 was never applied to production — found and made safe to apply

**Severity: P0.** Not in the original audit; found while restoring a green typecheck.

`src/lib/supabase/database.types.ts` had been regenerated from the live database and was missing
precisely one migration's objects. Verified directly against the project via the Management API:

```
copilot_tables=0  bs_cols=0  as_cols=0  bp_cols=0  oc_cols=0  total_tables=172
```

Every migration through 0061 is applied **except `0054_v4_expansion.sql`**. What that means in
production right now:

| Missing | Consequence |
|---|---|
| `copilot_sessions`, `copilot_messages`, `copilot_actions` | Every Copilot turn fails at its first insert |
| `automation_steps.subject`, `.sender_identity_id`, and the widened channel check | A follow-up **email** step cannot be saved — the constraint still permits only `sms`/`whatsapp` |
| `business_settings.default_sender_identity_id`, `.follow_up_fallback_enabled` | Follow-up channel fallback cannot be configured |
| `business_profiles.outreach_*` (8 columns) | Outreach guidance cannot be saved |
| `outreach_campaigns.send_timezone`, `.send_window_*`, `.min_gap_days` | Campaign send windows cannot be set |

**Changed:** `0054_v4_expansion.sql` now guards its one non-idempotent statement
(`create trigger copilot_sessions_set_updated_at`) with a `drop trigger if exists`, so the whole
file is safely re-runnable. Every other statement was already `if not exists` / `drop … if exists`.

**Deployed.** Verified against the live database afterwards: **175 tables, all three `copilot_*`
present, `automation_steps.subject` present.** Copilot can now open a session and a follow-up
email step can now be saved.

**Also:** `database.types.ts` was restored from HEAD, because the committed version describes the
intended schema (175 tables) while the regeneration described a database missing a migration
(172). The regenerated file is preserved in the session scratchpad as
`database.types.regenerated-from-live-db.ts`. Restoring it took the typecheck from **100 errors to
0**.

### R2 · Prospect → Lead promotion fixed — `0063_fix_prospect_promotion.sql`

**Severity: P0.** [04 · 4.1](04-database-audit.md), [06 · C](06-prospect-lead-data-flow.md).

`promote_reviewed_prospect()` inserted `status = 'new'` against a CHECK that has permitted only
`'NEW'` since 0003, so every promotion raised `23514` — in both the manual path and the automatic
on-reply path. Steps 15–21 of the end-to-end journey were unreachable.

The replacement keeps everything that was already right — the `FOR UPDATE` row lock, the
idempotent early return, the suppression and engagement refusals, and the re-stamping of the
conversation and its messages so cold history appears in the Lead drawer rather than being copied
— and adds what was missing:

| Now written | Why it matters |
|---|---|
| `status = 'NEW'` | the fix |
| `phone_normalized` | duplicate detection and SMS addressing both read it |
| `promoted_from_prospect_id`, `promoted_at` | the lineage link `leads_promoted_from_idx` was built for |
| `company_name` (snapshot from `prospect_companies`) | a promoted lead had no company at all |
| `source_campaign_id`, `sourcing_run_id` | "which search paid for itself" becomes answerable |
| `intake_method`, `created_via` | intake analytics split by method |
| `relationship_type`, `subscriber_type` | the warm-send lawful basis |
| `conversion_goal_id` | the workspace default goal |
| a `contact_permissions` row | without it a promoted lead evaluates as UNKNOWN from the moment it exists |

Two invariants added, each **repaired before it is enforced** so no existing row can block the
migration:

- `prospects_converted_has_lead_check` — CONVERTED implies a lead;
- `prospects_score_grade_check` — score and grade are written together or not at all.

**Deployed.** Applied inside a transaction and verified against the live function body:
`'NEW'` present, lowercase `'new'` gone, `promoted_from_prospect_id` and `contact_permissions`
both written, both constraints created. Execute is granted to `service_role` only — `anon` and
`authenticated` have none, which `create or replace` does not preserve on its own and the
migration's explicit revoke/grant restored.

**Prospect → Lead promotion works in production for the first time.**

### R3 · Promotion failures stopped masquerading as business rules

`find-leads/actions.ts` reported *every* failure as "Only engaged, unsuppressed prospects can move
to Leads. Review the conversation first." — a plausible sentence about a completely different
cause, which is why a hard defect looked like correct behaviour for as long as it existed.

Both callers now distinguish the routine's three deliberate refusals from a fault, pass the
refusals through as themselves, and log anything else with its SQL error code.

### R4 · 21 broken settings deep links fixed

**Severity: P1.** [13 · §9](13-page-action-button-audit.md).

Every "Open Connections" / "See plans" / "Add a service" affordance in Find Leads, Inbox and
Agents linked to `/app/settings?view=…`; Settings parses only `?section=`. All 21 silently landed
on the default section. `?view=services`, which has no target at all, now points at `workspace`,
where services live.

### R5 · The Inbox stopped claiming channels it cannot fill

**Severity: P1.** [07 · C](07-messaging-conversation-mesh.md).

`ChannelDefinition` conflated two different facts: `canRead` (what the platform's API permits) and
whether we had built ingestion. Messenger and Instagram were `canRead: true` with no ingestion
anywhere, so their tabs rendered the ordinary "connect something and conversations appear" empty
state for a channel where connecting changes nothing.

Added `ingestion: "live" | "not-built" | "impossible"` as a separate field, set honestly, and the
Inbox now renders three distinct states — a "soon" marker versus a permanent "n/a", and no
"View connections" link where connecting would not help.

### R6 · `tests/wiring.test.ts` — the defect classes, made mechanical

Eight tests, each corresponding to a defect that shipped and could only have been found by hand:

| Test | Catches |
|---|---|
| every `/app/settings` link uses `?section=` | R4, permanently |
| every `?section=` names a real section | the `?view=services` class |
| `leads.status` permits exactly seven values | drift in the constraint |
| no SQL routine inserts a lead status the constraint refuses | **R2 — this test fails on the pre-fix code** |
| a channel is only `live` if something can ingest it | R5, derived from source rather than asserted |
| a channel that cannot fill says so plainly | copy that promises a fix connecting cannot deliver |
| every `connectPath` has a registered adapter | an enabled Connect button that 503s |
| every registered adapter is reachable | a built integration nobody can reach |

The status test reduces the migration set to its **effective** definition — last
`create or replace function` per name wins — so it reports the database as it ends up rather than
everything ever written. Registered in `npm test`.

### R7 · Correction to the audit — the Connect buttons were not broken

The audit claimed Meta, Salesforce, Calendly and Google Calendar render a Connect button that
dead-ends on a 503. **That was wrong**, and is corrected in
[09](09-integration-mesh.md) and [13](13-page-action-button-audit.md). All four carry
`connectPath: null`, which `integrations/queries.ts:130` already renders as a disabled "Not yet
available" card.

I had inferred the claim from the catalogue and the route without reading the query layer between
them. The real risk is the inverse case, which nothing guarded — now covered by R6.

### R8 · One reply-rate definition — P0-5

**Severity: P0.** [18 · D3](18-duplication-bloat-register.md).

The convention is now stated and enforced: **a rate is a fraction in [0, 1], produced by
`rate()`, and null when the denominator is empty.** `formatMetric(value, "percent")` renders it.

| Changed | From | To |
|---|---|---|
| `campaigns/reactivation-types` `replyRate` / `qualificationRate` / `bookingRate` | `(a / b) * 100`, `0` when empty | `rate(a, b)` |
| `campaigns/reactivation-queries` summary rates | inline percentage-point maths | the shared helpers |
| `leads/queries.getLeadHeaderMetrics` | `(a / b) * 100`, `0` when empty | `rate(a, b)` |
| `campaigns/reactivation-filters` conversion sort key | `0` when nothing sent | `rate() ?? -1`, so unsent campaigns sort below genuine zeroes instead of tying with them |
| Reactivation drawer and summary cards | `formatPercent` (percentage points) | `formatMetric(…, "percent")`, which renders an absent rate as "—" |
| `lib/dates.formatPercent` | undocumented unit | documented as percentage points, with a pointer to the fraction formatter |

**`src/lib/analytics/engagement.ts` is new** — the one place recipient-level engagement is
computed, for cold (`outreach_recipient_runs`), reactivation (`campaign_contacts`), warm (`leads`)
and the whole workspace. It counts **people, not messages**, which is what the published definition
always said and what none of the five implementations did; and it counts with
`{ count: "exact", head: true }` against tables that already hold one row per recipient, so it
cannot silently truncate the way a row fetch does.

The pure arithmetic (`withRates`, `EngagementTotals`) lives in `v4-metrics.ts` beside `rate()` and
the registry, not in the `server-only` shell — which is what makes it unit-testable, and follows
the pattern `send-core.ts` and `channel-policy.ts` already set.

### R8b · The rate is now consumed, not just defined

| Surface | Before | After |
|---|---|---|
| Analytics → Outreach `reply_rate` | inbound messages / outbound messages | `workspaceEngagement` — repliers / contacts |
| Analytics → Outreach `positive_reply_rate` | classified messages / classified messages | positive repliers / repliers |
| Copilot insights | **passed `null`**, so the reply-rate insight could never fire | the same two numbers as the page |
| Analytics channel table | column headed "Reply rate", computed messages/messages with FAILED in the denominator | column headed **"Replies / delivered"**, `repliesPerDelivered`, denominator is delivered |
| Billing → Usage channel table | a third copy of the same formula | the shared `rate()`, same rename, `formatMetric` for rendering |
| `/api/analytics/export` CSV | "Reply rate" | "Replies per delivered" |

The per-channel figure is genuinely message-level — a distinct-count per channel needs SQL this
audit cannot deploy — so it is **named apart** rather than mis-computed. `METRICS` gains
`replies_per_delivered`, whose definition says exactly that: *"A message-level ratio, deliberately
named apart from Reply rate, which counts contacts: one person replying four times moves this and
not that."* That is the brief's §16 rule applied literally.

Delivery and bounce stay message-level and are unchanged. A delivery is a property of a message,
not of a person, and the registry already said so.

### R13 · An unauthenticated server action, found and removed

`affiliates/link-actions.checkSlugAvailable` took a slug, queried `affiliate_links` and returned
whether it existed — **with no authentication of any kind**. A server action is a public endpoint
with a callable id, so this was a slug-enumeration oracle. It had no caller and is deleted.

Found by an authorisation sweep that resolves one level of guard indirection — `adminAccess()`
wraps `requireRole("admin")`, `guarded()` wraps the platform-admin check. Of 175
database-touching actions, **174 resolve an actor**; this was the one that did not.

That sweep is now `tests/wiring.test.ts` → *"every server action that touches the database
resolves an actor"*, with a seven-entry allow-list for the actions that legitimately run before an
actor exists (sign-in, sign-up, password reset, the public sales form).

The Dashboard keeps percentage points. It is internally consistent — KPI value, sparkline series
and delta ("0.8 pts") share the unit — so it carries an explicit `percentage-points:` marker
rather than being churned. Same for the progress bar, the trend delta, the audience share
breakdown and the CSV column headed "Booking rate (%)".

### R9 · Dead V3 analytics deleted

`analytics/queries.ts` went from 384 lines to 115. `getAnalyticsData` and the six helpers only it
used — funnel summaries, speed-to-lead buckets, replies-by-attempt, service rows, qualification
outcomes, messaging volume — had no caller since `v4-queries`/`v4-extras` superseded them. What
remains is the attribution rollup that `/api/exports/attribution` still uses.

### R10 · CSV import can now be reviewed row by row — P1-11

**Severity: P1, and it is a compliance affordance.** [14 · §5](14-wizard-state-audit.md).

The wizard called `createImport` and `commitImport` **back to back in one click**. The
`REVIEW` classification, the `user_classification` override column, `setRowClassification` and the
`lead_imports.status = 'REVIEW'` state all existed and none could ever be reached — the whole
file got one relationship type, and whether a row entered as a lead or as a cold prospect was
decided entirely by the classifier.

Now:

1. **Stage** — "Check against your workspace" writes the rows and classifies them server-side
   against live suppression, existing leads and existing prospects.
2. **Review** — `getImportReview` (new) returns the counts and the rows classified `REVIEW`, with
   the reason and the validation flags. Each gets a three-way choice — Lead, Prospect, Skip —
   writing through `setRowClassification`, optimistically so a long list does not jump under the
   cursor, and re-reading the server if a write fails.
3. **Commit** — imports only the decided rows. An undecided row is not imported, and the UI says
   so: *"Leaving a row undecided is a valid choice — it is the safe one."*

Stepping Back off a staged review discards it, so a changed mapping cannot be committed against
stale classifications.

### R11 · Loading states and a dead nav entry

`loading.tsx` added for `/app/analytics`, `/app/leads/import` and `/app/agents/new` — the three
routes without one, each mirroring its real layout rather than showing a spinner. Analytics is the
slowest route in the product and was the one without a skeleton.

`titleForPath` no longer maps `/app/status`, a page that lives at `/status` outside the app shell.

### R12 · The wiring and metric test suites

`tests/wiring.test.ts` — **13 structural tests**. Every `/app/settings` link uses `?section=` and
names a real section; `leads.status` permits exactly seven values and no SQL routine inserts
another; a channel is only marked `live` if something can ingest it, and one that cannot fill says
so plainly; every `connectPath` has an adapter and every adapter is reachable; every sidebar
destination and every `titleForPath` prefix resolves to a real page; no module computes a rate as
percentage points; `rate()` is the only place the empty-denominator rule lives; every
database-touching server action resolves an actor.

`tests/analytics-metrics.test.ts` — **14 unit tests** fixing the metric contract: a rate is a
fraction, an empty denominator is null and renders as "—", each reactivation rate is measured
against the step before it, positive replies are measured against replies rather than contacts,
and — the one that keeps the words and the code honest with each other — every
contact-denominated metric's published definition says "contacts" and every message-denominated
one says "messages".

The rate tests honour an explicit `percentage-points:` marker, scanning back to the nearest blank
line so the marker can sit above a comment block. That makes each exception visible in review
rather than inferred from a regex — the point is not to ban the idiom, it is to make choosing it
deliberate.

### R14 · Booking outcomes can be recorded — P1-14

**Severity: P1.** [13 · §4](13-page-action-button-audit.md), [20 · §3](20-dead-code-register.md).

`updateBookingStatus` was written with the bookings module and never had a caller: the standalone
`/app/bookings` page it was built for was removed when the IA collapsed to five destinations
(`CLAUDE.md` resolved-conflict 0), and nothing replaced the control. A booking could therefore
**never leave `scheduled`** — no-shows were invisible, completions were unrecorded, and
booking→won conversion could not be measured at all.

The gap was not only the control, it was the surface: the Dashboard shows *upcoming* bookings, and
a past appointment had nowhere to appear. So the card gains an **"Did these happen?"** block above
the upcoming list — bookings whose time has passed while still `scheduled`, capped at four,
because this is a daily sweep and not a backlog to work through on the Dashboard.

`BookingOutcomeControl` offers three plain outcomes — *It went ahead*, *They did not turn up*,
*It was cancelled*. The action already flags the lead for attention on a no-show or cancellation
and writes the audit row; the toast says so, because that side effect is the part an operator
would otherwise have to remember to do by hand.

### R15 · Business facts can be confirmed — P1

`verifyFact` had no caller, so `business_memory_facts.verified_by_user` and `last_verified_at`
were unreachable. The Business Profile already rendered **"Worth checking"** beside every
AI-inferred fact and offered no way to check it — an instruction with no affordance.

A confirm control now sits beside lock and delete, shown only where it means something: a fact the
customer typed is verified by definition, so the button appears only on unverified ones, and a
confirmed non-user fact gains a "confirmed" badge so the flag can actually clear.

### R16 · Finished the other agent's half-landed work

They stopped mid-change, leaving the shared typecheck red. Two fixes, both one-liners, because a
red typecheck blocks everyone:

- `settings-section-nav.tsx` had no icon for the new `data-controls` section they added to
  `SETTINGS_SECTIONS` — the Data Controls & Compliance section the brief §17 asks for. Added
  `ShieldCheck` and updated the "five canonical sections" comment, which was now wrong.
- The `audit.ts` and `apps/[id]/events` errors I saw earlier turned out to be a **mid-write
  artefact**, not a real defect — `database.types.ts` was being rewritten as I read it. Re-running
  after they stopped showed both clean. Recorded because the first reading was wrong and acting on
  it would have meant "fixing" correct code.

### R17 · Correction — the Reactivation wizard does persist

[14 · §3](14-wizard-state-audit.md) claimed this wizard held everything in React state and lost it
on refresh. **It does not.** `wizard/state.ts` persists to `sessionStorage` on every change and
restores on mount. I had read the `useState` list and inferred from its length, without looking for
the mount effect.

I started building a server draft on that false premise and **reverted it**, because
`WizardState` carries the analysed CSV and `campaigns` has no column for it: the server draft would
have silently dropped the most expensive thing in the flow while adding a second draft mechanism
beside the working one. The correct fix needs one `draft_state jsonb` column, is written up in
[14 · §3](14-wizard-state-audit.md), and is sequenced behind the 0054 deploy.

Downgraded from P1 to P2 in [19](19-missing-architecture-register.md).


### R18 · One suppression list — P0-3

**Severity: P0, and the most consequential compliance defect in the audit.**
[04 · 4.3](04-database-audit.md), [11 · 1.3](11-compliance-permission-mesh.md).

Two lists that never saw each other:

| | Written by | Read by |
|---|---|---|
| `contact_suppressions` | SMS `STOP`, the agent's `apply_suppression` tool, email bounces, the unsubscribe page | the warm send guard, the reactivation audience resolver, manual send |
| `suppression_entries` | the cold reply classifier, prospect actions, admin compliance, the unsubscribe page | `check_suppression()` → cold dispatch, sourcing, CSV import, Add Lead |

A lead who texted STOP was still emailable by an acquisition campaign. A prospect who replied
"unsubscribe" was still sendable warm SMS — while `suppressProspect()` set channel `ALL` with a
comment saying an opt-out means every channel. The split silently defeated the stated intent.

`0069` backfills into `suppression_entries` — strictly the richer model: nullable `business_id`
for platform-wide entries, `expires_at` for a provider's temporary block, separate destination
columns instead of one opaque `normalized_contact`, and `source`/`source_reference`/`note` for
evidence. Nine call sites across seven files are repointed through `lib/policy/suppression.ts`.

The unsubscribe page is the telling one: it had been **deliberately dual-writing both tables**,
with a comment explaining that the follow-up and reactivation engines read a different list from
the dispatcher. That workaround is now a single call.

`contact_suppressions` is left populated and unread for one release, so this is revertible by
repointing code rather than by restoring data.

`lift_suppression_for_destination()` is deliberately separate from `unsuppress()`. That one
refuses `OPT_OUT` because a workspace may not overturn someone's opt-out. This one allows it,
because a person texting `START` is that person changing their own mind, and refusing it would
leave them unable to resume a conversation they asked to resume. Platform-scope entries are never
touched.

Two structural tests keep it unified: no application code may name the deprecated table, and
`suppression_entries` is reachable only through the policy module — with an explicit allow-list
for surfaces that *display or manage* the list rather than gating a send, because those two reads
are different acts.

### R19 · Cold email is metered and enforced — P0-6

**Severity: P0.** [12 · 12.2](12-usage-billing-mesh.md).

`outreach/dispatch.ts` recorded **no usage at all** — not even a message count. So `email_sent`,
the metered unit of the acquisition product, was shown on Billing & Usage, read by the campaign
budget card, and never consumed. A workspace could run ten campaigns, each inside its own
`daily_contact_cap`, and pass the plan limit without anything noticing.

Now: `checkCapacity("email_sent")` before the dispatch loop, halting the run with
`EMAIL_ALLOWANCE_EXHAUSTED` rather than refusing message by message — the allowance is a property
of the workspace, so stopping and saying so beats a partial batch failing silently. Each send
records `usage_events` with `operationId` set to the send key, which is deterministic across a
retry; `0062`'s unique partial index on `(business_id, operation_id)` turns that into real
idempotency, so a provider retry or a replayed job is charged exactly once.

The metric is `email_sent`, not `cold_email_sent`. That is the one carrying the plan entitlement
and the one `checkCapacity` and Billing & Usage both read — recording a different name would have
left the allowance displayed-but-never-consumed, which is the defect being fixed. Cold and warm
are separated by `feature`, which is what `0062` added the column for.

### R20 · Two corrections to my own work

**Meta's `connectPath`.** The concurrent stream landed a complete Meta adapter — OAuth, poller,
registered in `jobs/register.ts` — with `connectPath: null`, so it was unreachable. I set the
path, and reverted it: `public-pages.test.ts` ties that null to enterprise copy, with a comment
saying that if it changes the copy should be revisited. The flow has also never been run against a
real Meta app. Exposing an unverified connect flow is precisely the "advertises a capability it
cannot deliver" defect catalogued in this audit.

**An over-strict test of mine.** I had asserted "every registered adapter is reachable from the
catalogue". It is wrong. An adapter the catalogue does not expose harms nobody — the card reads
"Not yet available" and the button is disabled, which is the correct state for an integration
built but not yet verified. The assertion turned part-finished work into a build failure and
pushed towards shipping an unverified flow to make a test pass. Removed; the reasoning is kept in
the test file. The direction that matters — a `connectPath` with no adapter, which 503s — is still
asserted.


---

### R21 · A route-guard test — P1-10

`proxy.ts` performs no authorisation. It refreshes the Supabase session and rewrites the status
host; it decides nothing about who may see what. Every access decision lives in a layout, a page
or a route handler.

That is defensible — a guard next to the query it protects cannot drift out of step with the data
it guards — and it has exactly one failure mode: **a route added without one is silently public,
and nothing says so.** No error, no 500, no red test. The page just renders.

`tests/route-guards.test.ts` is that missing error. 44 assertions:

| What it fixes in place | Assertion |
|---|---|
| Page coverage | Every `page.tsx` is under a declared guarded tree, is in the declared public list with a written reason, or guards itself. A page under a *new* top-level path fails until somebody classifies it |
| The specific guard | `(app)` calls `requireWorkspace`, `admin/(ops)` calls `requirePlatformAdmin`, `affiliates/app` calls `getAffiliateAccount` — by name, not by "some guard is present" |
| The admin confusion | `admin/(ops)/layout.tsx` must **not** call `requireWorkspace`. That substitution compiles, still redirects a signed-out visitor, and hands the platform console to every paying customer |
| Dev harnesses | All five `dev/*` pages 404 outside development. A sixth added without the gate fails |
| Route handlers | All 30 route files are in a table naming their mechanism — session, cron secret, HMAC, Stripe signature, Twilio signature, Meta signature, API key, MCP token, or public — and each file must contain that mechanism's call |
| Public endpoints | The five genuinely-unauthenticated routes each carry a written justification, and the justification list and the table must agree |
| Ordering | The OAuth callback must consume its `state` **before** exchanging the code. A token exchanged first is a token anyone who can craft the redirect can obtain |
| The proxy | `proxy.ts` must stay out of authorisation. A half-migration, where some routes trust the proxy and others guard themselves, is how gaps open |

**It found no bug.** Every route on disk is guarded today, and that is worth writing down as a
verified fact rather than an assumption. What it does is stop the next one being the exception.

### R22 · The aggregates that were wrong, not slow — P1-7 / S1–S3

Five reads fetched rows and counted or summed them in JavaScript, under a row cap. Past the cap
the answer is **wrong rather than slow**, and nothing anywhere says so — no error, no warning, no
truncation marker.

Two of them decided money or the customer's headline chart:

- **`getV4Usage`** summed `usage_events.quantity` in JS with no explicit limit, so PostgREST's own
  cap decided the result. A workspace past that many events in a billing period had its usage
  under-reported, `checkCapacity` saw room that did not exist, and **the allowance silently
  stopped being enforced.** The error was one-directional: it only ever gave away more than the
  plan sold, so no customer would ever report it.
- **`getTrends`** read up to 250,000 timestamps across five queries to draw one line. At the cap a
  busy month renders as a quiet one — and a workspace busy enough for the chart to matter was
  exactly the workspace whose chart was wrong.

`0074_analytics_rollups.sql` moves all five into SQL, applied and verified:

| Function | Replaces | Was capped at |
|---|---|---|
| `sum_usage_events` | `getV4Usage`'s JS reduce | PostgREST's default |
| `analytics_daily_trends` | five capped fetches bucketed in `getTrends` | 5 × 50,000 rows |
| `analytics_conversion_goal_counts` | `getConversionGoals`' JS tally | 50,000 booked leads |
| `analytics_provider_waterfall` | `getProviderWaterfall`'s fetch-then-chunked-`in` | 50,000 source rows *and* a round trip per 500 ids |
| `outreach_campaign_promoted` | `promotedFromCampaign`'s two-hop chunked count | 50,000 recipients |
| `prospect_counts_by_icp` | the ICP panel's `limit(5000)` tally | 5,000 prospects |

`limit(50000)` now appears **zero** times in `analytics/v4-extras.ts`.

Three details that were decided rather than defaulted:

- **`getV4Usage` now throws on a read error instead of returning 0.** Zero is indistinguishable
  from "no usage", which is precisely the state that unlocks the allowance. The one thing a
  failed meter read must never do is return the permissive answer. All five callers are on spend
  or gating paths, so failing closed is the safe direction.
- **The provider function was rebuilt mid-migration** because `create or replace` cannot change an
  OUT column's name or type, and the first shape did not match what the page actually reports.
  `candidates` counts distinct prospects, `verified` counts distinct VALID prospects, and
  `enriched_fields` counts rows the provider returned a value for — three different counts on
  purpose, and collapsing any two would have changed a published number.
- **`analytics_daily_trends` returns only days with activity.** The caller still generates the
  axis from the range bounds. A series that invented its own days would disagree with that axis at
  the boundaries; one that omitted quiet days would compress a fortnight of silence into a single
  step and read as growth.

Six covering indexes ship with it, all `if not exists`, on the `(business_id, timestamp)` shapes
these functions scan.

Five are `security invoker`, so RLS applies exactly as it did to the query each replaced.
`sum_usage_events` is `security definer` and `service_role`-only: it runs on the admin enforcement
path, and how much a workspace has consumed is not a figure a browser session should be able to
ask the database for directly.

### R23 · The same fix, applied to the operations console — S4

`0074` closed the aggregation-in-JavaScript class on the customer surfaces.
`0075_admin_rollups.sql` closes it on the admin ones, where the same seven
capped reads scan *across every workspace* — so the cap arrives sooner than on
any single tenant's data, and the number that goes wrong is the one an operator
uses to decide whether the platform is healthy.

Three of them fail in ways worth naming:

| Read | What the cap does |
|---|---|
| `getSystemHealth` queue depth | Counted from at most 20,000 unfinished jobs. **A genuine backlog is exactly the condition that exceeds it** — queue depth stops rising at the moment it matters, and the incident reads as recovery |
| `getProviderHealth` uptime and p95 | Derived from at most 20,000 probes. With six providers on a schedule, the cap silently *shortens the window* as probing gets denser: "30-day uptime" quietly becomes "uptime over however long 20,000 probes cover", with nothing on screen saying the period changed |
| `getPlatformEconomics` provider spend | Summed from at most 20,000 `cost_events`. Under-reported COGS reads as **better** margin — the error runs in the flattering direction on the one number that page exists to report |
| Customers → last activity | Read 20,000 audit rows newest-first only to find each workspace's first sighting. **One busy workspace could fill the entire read**, leaving every other workspace on the page reading as dormant |

Six functions, applied and verified:
`admin_customer_usage` · `admin_customer_last_activity` · `admin_stock_series` ·
`admin_job_state_counts` · `admin_provider_spend` · `admin_provider_check_summary`,
plus five covering indexes — the `jobs` one partial on open states, so it does
not grow with volume processed.

Two decisions worth recording:

- **The series functions take the caller's bucket boundaries, not `date_trunc`.**
  The admin ranges are anchored to `now` rather than to a clock boundary, so
  rounding to the hour or the day would shift records across bucket edges by up
  to an hour and quietly redraw the line. `width_bucket` over the caller's own
  start and end is exact, and it is the technique `admin_event_series` (0024)
  already used.
- **`admin_stock_series` returns plan and interval, not a price.** The plan
  catalogue lives in TypeScript. Pricing inside a migration would create a
  second price list that silently disagrees with the first the moment either is
  edited. The function counts; the caller prices.

One deliberate behaviour change: `p95_ms` now uses `percentile_cont`, a
continuous interpolation, where the application used a nearest-rank pick. On a
dense probe series the two agree to within a millisecond and the interpolated
figure is the standard one — but it is recorded here because a latency number
that moves for no visible reason costs an operator an afternoon.

Every function is `service_role`-only with no `anon` or `authenticated` grant,
and the deployed argument names and return columns were checked against the
hand-written types rather than assumed — a mismatch there fails at runtime, not
at compile time.

**Overview's panels were finished by the concurrent stream**, which picked up
`admin_stock_series` and split the subscription read into "the eight on the
recent list" and "the ones that can raise an action" — a better shape than the
single scoped read I had written. Left as theirs.

### R24 · Two tests taught the difference between stale and wrong

Both found by the suite, both fixed at the rule rather than at the assertion:

- **`public-pages.test.ts` kept a hand-written list of real routes.** It failed
  the day `/developers` shipped: the page was real, the link was right, and the
  test said the link was broken. A list that cries wolf gets edited to stop
  crying rather than read — which is how it stops catching the dead link it
  exists for. It now derives the route set from `page.tsx` on disk, walking only
  the unauthenticated trees, so a public footer link into `/app/leads` still
  fails. A guard test asserts the walk actually found the site, because a walk
  that silently found nothing would make every link valid and report success.
- **`route-guards.test.ts` pinned the avatar proxy's CDN allow-list.** The
  concurrent stream legitimately changed it — gravatar in, LinkedIn out — and
  a correct change failed the build. It now asserts the property that does the
  security work instead: https required, host tested against a list, and the
  test happening **before** the fetch. An allow-list consulted after the request
  has gone out protects nothing.

The same over-strictness was caught once before in this workstream (the adapter
reachability test in R16). The pattern: assert the invariant, not the current
value of a list that is supposed to grow.

## Deployment state

Verified against the live database after each apply. **181 tables.**

### Applied — the audit's migrations

| Migration | Verified |
|---|---|
| `0054_v4_expansion` | all three `copilot_*`, `automation_steps.subject` |
| `0062_usage_ledger` | 7 provenance columns + the append-only trigger |
| `0063_fix_prospect_promotion` | live body carries `'NEW'`, writes lineage and `contact_permissions`, both constraints, `service_role`-only execute |
| `0064_lead_archive_and_notes` | `leads.archived_at`/`archived_by`, `lead_notes` |
| `0065_connector_event_failures` | table + function, RLS on, policy, `service_role`-only execute |
| `0066_data_controls` | table, RLS on, policy, `set_updated_at` trigger |
| `0069_unify_suppression` | `lift_suppression_for_destination` present with `service_role`-only execute; deprecation comment on `contact_suppressions` |
| `0074_analytics_rollups` | all six functions present, each smoke-executed against real workspace data; `sum_usage_events` is `definer` + `service_role`-only, the other five are `invoker` with no `anon` grant |
| `0075_admin_rollups` | all six functions present and smoke-executed; `admin_stock_series` cross-checked against raw counts (2 active businesses, 2 paying, 0 trialing — reconciles exactly); every argument name and return column verified against the hand-written types; `service_role`-only throughout |

`0062` was pre-flighted: every `metric` value in the live `usage_events` and `usage_counters` was
checked against the widened CHECK first, because adding a CHECK to a populated table fails on the
first violating row.

Both `security definer` / replaced functions had their ACLs checked rather than assumed —
`create or replace function` does not preserve a grant, and a definer function runs as the owner.

### Pending — the concurrent stream's migrations

`0067_social_outreach` · `0068_social_tiktok` · `0070_admin_rls_coverage` · `0071_developer_platform`

**Not applied, deliberately.** That agent is still writing them — `0071` and its
`src/lib/api/public.ts` were being edited minutes before this was written. Applying a migration
someone is mid-way through authoring is how you get a half-shaped schema nobody can reason about.

**The branch cannot ship until they are.** Their code is committed and references tables that do
not exist yet — `api_keys`, `webhook_endpoints`, the social outreach tables. The unit suite does
not catch this because it does not touch a database.

They should be reviewed and applied, in numerical order, by whoever owns that stream, using the
same one-file-at-a-time shape recorded below.

```bash
set -a && . ./.env.local && . ./.env && set +a
python3 -c "
import json,sys
sql=open('supabase/migrations/<NAME>.sql',encoding='utf8').read()
sys.stdout.write(json.dumps({'query':'begin;'+chr(10)+sql+chr(10)+'commit;'}))" > /tmp/apply.json
curl -sS -w "HTTP %{http_code}
" -o /dev/null   -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query"   -H "Authorization: Bearer $SUPABASE_PAT" -H "Content-Type: application/json"   --data-binary @/tmp/apply.json
```

### Re-runnability

`0065`, `0066` and the concurrent stream's migrations carry unguarded `create policy` and
`create trigger` statements: they apply once and fail on a second run. `0054` and `0069` were
given `drop … if exists` guards. Anything rebuilding an environment from the migration set will
hit this.

---

## Verification

`npm test` — **1,333 tests, 0 failures** (1,199 + 134 across the two runners).
`npm run typecheck` — **clean**, including the two files the other agent left broken.
`npm run lint` — **clean**.

Both agents' work is in the tree together and green. Nothing is committed — see the handover.

---

## Deliberately not done

| Item | Why |
|---|---|
| Phase 3 — one action per concept (`Actor` parameter) | The other agent is building `src/lib/services/` for exactly this. Direct collision |
| Phase 2 — suppression unification | Touches `send-store.ts` / `shared.ts`, which the other agent is mid-edit on |
| Phase 4 — warm path through `ChannelPolicyService` | Same; they have `PolicyGate` half-built |
| Phase 7 — usage ledger | Their `0062_usage_ledger.sql` |
| Email reply from the Inbox | Requires widening `sendManualMessage` in `leads/actions.ts`, which their services refactor is likely to move |

## Next, in this lane

| Item | Why it is next |
|---|---|
| Reactivation wizard server draft | Needs `campaigns.draft_state jsonb` first — see [14 · §3](14-wizard-state-audit.md) for why the column is required rather than optional |
| Delete the 12 pure-orphan actions and the orphan components | Hygiene, once the other agent's refactor settles — it is moving actions into `services/` and the list would churn |
| An orphan-action test with an explicit allow-list | Would have caught all 27. Deferred for the same reason |

## Blocked

| Item | Blocker |
|---|---|
| Applying `0054_v4_expansion.sql` | Harness denied the write to the production database. Needs a permission rule or a human to run it |
| Full `npm test` | `src/lib/copilot/types.ts` now imports `@/lib/services/registry`; Node's test runner cannot resolve the `@/` alias, so `tests/v4-expansion.test.ts` fails to load. Their file, mid-edit. The convention elsewhere in test-reachable modules is a relative `../services/registry.ts` import |

---

# The developer platform — API keys, webhooks, MCP

**Date:** 2026-09-08 · **Migrations:** `0071_developer_platform.sql`, `0076_lead_notes_api_author.sql`

## What was missing

The MCP gateway could *authenticate* a token but the only way to mint one was a
Next.js server action, and the token lasted an hour. No MCP client can call a
server action, so a customer configured Claude with a bearer header, it worked
for an hour, and then stopped for no visible reason. The product had a working
MCP server that nobody could stay connected to.

There was no public API and no outgoing webhooks at all. A customer who wanted
to pull their own leads into a spreadsheet, or be told the moment a lead
qualified, had no way to do either.

## What was built

| Surface | Where |
|---|---|
| Workspace API keys | `lib/api-keys/`, Settings → Developer |
| Public REST API | `app/api/v1/*` on `lib/api/public.ts` |
| Outgoing webhooks | `lib/webhooks/`, `jobs/handlers/webhook-dispatch.ts` |
| MCP over an API key | `lib/mcp/gateway.ts` |

One credential model serves all three. `lib/platform/scopes.ts` is now the only
place a permission is declared, and `MCP_SCOPES` is a re-export of it rather
than a second copy — the regression it prevents is a scope meaning one thing
over HTTP and something wider over MCP.

The public API calls the service layer for everything. No route reads the
`leads` table, so the workspace scoping, the archived-lead exclusion and the
audit trail all apply without any route remembering them.

## Two bugs the live run found that review had not

1. **`lead_notes.author_kind` had a check constraint enumerating caller kinds.**
   Adding `API` to the service layer's `CallerKind` union made `lead.add_note`
   succeed for every other caller and fail with a constraint violation for the
   API, surfacing as an unexplained "that note could not be saved". Fixed in
   `0075`. A check constraint enumerating a TypeScript union will drift the
   moment the union gains a member, and nothing in the type system can see it.

2. **A multi-step `PATCH` reported a partial change as a plain failure.** The
   status change had already been applied when the note failed, and the caller
   was told only "conflict" — leaving them unable to distinguish an untouched
   lead from a half-changed one without re-reading it. The response now names
   `failed_step` and `applied`.

Both were found by driving real HTTP against a running server, not by review or
by the unit tests, which is the argument for having done that.

## Verification

| Check | Result |
|---|---|
| `npm test` | **1,480 tests, 0 failures** (1,346 + 134) |
| `npm run test:e2e:developer` | **27 tests, 0 failures**, real Postgres, real RLS |
| `npx tsc --noEmit` | **no errors in any file this lane touched** |
| Live HTTP — public API | `/api/v1`, `/me`, `/leads`, `/leads/{id}` GET + PATCH, all refusal paths |
| Live HTTP — MCP | `initialize` (version negotiated), `notifications/initialized` → 202, `tools/list` (17 tools, scope-filtered to 4 for a read-only key), `tools/call` read and write |
| Live HTTP — approval gate | `lead.archive` parked in `mcp_approvals`, lead **not** archived |
| Live HTTPS — webhook delivery | Real POST to a public host, signed, answered 405, correctly treated as permanent and not retried |

The remaining `tsc` errors in the tree are the parallel social/Meta lane's —
`social-execute.ts`, `agent/`, `meta-lead-ads.ts`, `inbox/types.ts` — whose
migration `0072` is not applied. None are in this lane's files.

## Deliberately not done

| Item | Why |
|---|---|
| `POST /api/v1/leads` | `lead.create` is absent from the service registry on purpose: creating a lead means deduplication, a contactability record and starting follow-up. A thinner version that skipped those would be worse than none. The endpoint returns a 400 saying so rather than a bare 405 |
| Archive/restore over the API | `DESTRUCTIVE` requires a person's confirmation, which an API caller cannot supply. It is refused with `needs_confirmation` and the stated effect, which is the correct behaviour rather than a gap |
| A second live signing secret during rotation | An overlap window means an endpoint whose secret leaked keeps accepting it for the length of the window. Rotation is an explicit act with an explicit consequence, stated in the dialog |
| IPv6 CIDR in the key allowlist | A partly-correct prefix comparison would silently admit addresses the customer believed were excluded. IPv6 is exact-match only, and documented as such |

---

# LinkedIn end-to-end: the scheduler that never existed

**Date:** 2026-09-08 · **Migration:** `0072_social_agent_flow.sql`

## What was actually wrong

`0067_social_outreach.sql` shipped a correct connect-then-message state
machine, conservative per-platform caps counted from an append-only log, and an
index whose comment reads *"the scheduler's due-work query"*. There was no
scheduler. Nothing in the codebase advanced a social prospect without somebody
clicking, so the channel could do connect-then-message but never did it
unattended.

Five gaps, in the order they broke the flow:

| Gap | Consequence |
|---|---|
| No clock on `social_connection_states` | A state machine with no `next_action_at` cannot be swept, so every advance needed a click |
| No `social.tick` job | Nothing queued the sweep even if it had existed |
| `AgentChannel` had no `linkedin` | The conversation agent could not answer on the channel a social lead arrives on |
| Nothing ingested a reply | `REPLIED` was a legal state nothing could reach — so no classification, no stop condition that fired, no promotion, no booking |
| No step counter | *"At most two further messages"* in `lead-routes.ts` was prose, not a rule |

## The decision worth arguing with

**The agent does not run on prospects.** Qualification, bookings and the whole
runtime hang off `leads`. The boundary sits at the reply: outbound messages
before one are composed by the deterministic sequencer and never enter the
agent runtime; the moment somebody replies they have stopped being someone we
found and become someone who contacted us, which is the definition of a Lead.
`conversations` has carried `prospect_id` with a nullable `lead_id` since 0029,
so promotion attaches a lead to the thread that already exists rather than
copying anything.

Whether that promotion is automatic is a workspace choice
(`social_auto_promote_on_reply`), defaulting to **off** so `lead-routes.ts`'s
promise that promotion is a human decision stays true unless a workspace says
otherwise.

## What "runs 24/7" honestly means here

There is no API that sends a connection request or a message from a personal
LinkedIn account; the messaging APIs are approved-partner-only, and automating
a personal account outside one is what gets the customer's account restricted.

So the deciding, drafting, timing, cap arithmetic, contactability checks and
stop conditions all run unattended around the clock, and a person performs the
final click from a queue where the work is already done.
`social_autonomous_sending` + an account in `PARTNER_API` mode moves that last
step to `social.execute`, through identical checks.
`lib/outreach/social-partners.ts` is the empty registry that makes plugging one
in a one-file change, and says why it ships empty.

## Corrections to my own earlier findings

| I said | Actually |
|---|---|
| "No free-mail guardrail" | `sourcing-run.ts` already routed role mailboxes and consumer domains to REVIEW via `prospects/dedupe.ts`. What was missing was the *sourcing run* using `contact-legality` at all, and `subscriberType` never being `INDIVIDUAL` |
| "`profile.ts` writes an unmapped `USER` provenance" | That write is on `business_memory_facts`, not `prospect_data_sources`. Every value that reaches the send gate is mapped |

## Defects found and fixed on the way

- **`contact-legality.assessPhone` could never refuse a 118 number.** The UK
  shape gate ran first and 118 numbers do not start with `0`, so every one fell
  through to "not a UK number — check the local rules", inviting somebody to
  dial a number charging pounds a minute. The premium/unroutable check now runs
  first.
- **The copy guard let a bare guarantee through.** `we can guarantee` was
  caught and `we guarantee` was not, because the pattern required a modal — the
  wrong way round, since the barer claim is the stronger one.
- **`messaging/registry.ts` would have sent LinkedIn through the SMS carrier.**
  The channel fell through to `carrier.send`. It is now refused explicitly:
  there is no transport, and a silent fall-through texts a stranger.
- **Two migrations both numbered `0075`.** Renumbered to `0076`.
- **LinkedIn lead-form fields were never mapped.** Answers come back keyed by
  the form's own `questionId`, and the code guessed the email by looking for an
  `@`. Leads arrived with no name and no phone, so the instant follow-up that is
  the whole point of the lead-form route had nothing to send to. Form schemas
  are now fetched and cached per process.

## Verification

| Check | Result |
|---|---|
| `npm test` | **1,568 tests, 0 failures** (1,434 + 134) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | succeeds |

62 of those tests are new and cover the gate, the clock, the two-follow-up
ceiling, reply-stops-everything, the copy guard's refusals, contact legality
and the avatar policy.

## Deliberately not done

| Item | Why |
|---|---|
| A LinkedIn sender | No compliant API exists for a personal account. Shipping a headless-browser driver would put the customer's own account at risk to claim a feature |
| Storing LinkedIn profile photos | Their terms forbid retaining member images outside the platform. `avatar_source: 'LINKEDIN'` is refused on read as well as write, so a row from an older build cannot become renderable |
| Connect-then-message for LinkedIn lead-form leads | Lead Gen Forms return no profile URL, so a connection request cannot be targeted. Those leads are worked on the channel they gave, which already works |
| Cold contact on a discovered mobile | A UK mobile is almost always a personal device and needs TPS screening this product does not perform. The number is recorded and not used |
