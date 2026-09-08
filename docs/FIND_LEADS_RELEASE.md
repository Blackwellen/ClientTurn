# Find Leads — release evidence

What was built, what was verified, and what is honestly still missing.

Written to be read by someone deciding whether to turn this on for a paying
workspace. It records evidence, not intentions: every claim below either has a
command behind it or is listed under "Not built".

---

## What the surface does

A chat-first acquisition workspace. The customer describes who they want in
plain English; ClientTurn turns that into a structured plan they can see and
edit; nothing is spent until they press one button.

| Route | Purpose |
|---|---|
| `/app/find-leads` | Discover, Prospects, Intent, Campaigns |
| `/app/find-leads/search/[sessionId]` | Conversation + structured plan + sourcing controls |
| `/app/find-leads/runs/[runId]` | Live 12-stage run, counters, budget, provider activity |
| `/app/find-leads/campaigns/*` | Acquisition campaign wizard and detail |

---

## The rules the code enforces

These are the claims worth auditing, and where they live.

**A model suggestion is not authority to spend.** The Search Agent
(`lib/find-leads/server/search-agent.ts`) proposes a patch to the structured
plan and nothing else. It has no tool that calls a provider, starts a run, or
relaxes an exclusion. `maxProviderCostMinor`, `reviewMode` and the opt-out and
suppression exclusions are on a forbidden list that a model patch cannot touch.
`createRun` is reachable only from a server action a person triggers.

**No spend without a fresh authorisation.** `lib/find-leads/server/budget.ts`
is the single authority. The enforceable cap is
`min(customer's request, remaining allowance, workspace ceiling, platform
ceiling)` — the customer's number is an input to a `min()`, never the answer.
Start Run, Increase target, Resume and the recurring scheduler all call it
again rather than trusting the envelope a run was born with.

**A run cannot overspend.** Every paid call goes through
`providers/router.ts`, which reserves atomically against
`sourcing_runs.spent_cost_minor` with a conditional update, so two workers
racing cannot both see room for the last batch. Reservations settle against
actuals. A provider that costs nothing is billed nothing (`freeOfCharge`).

**Being in a campaign is not permission to send.** `outreach/dispatch.ts`
treats everything the audience builder concluded as stale: suppression,
contactability, caps, sender health and budget are re-evaluated per recipient
immediately before each send, because a person can opt out between being
selected and being written to.

**Cold email is lawful or it does not go.** A prospect with no unsubscribe
token is skipped rather than sent a broken link. A sender with no postal
address cannot launch. Unsubscribing suppresses the *address* at workspace
scope, so a later sourcing run cannot rediscover the same person.

**Nothing is invented.** A stage with no configured provider fails visibly.
Counters are counts of real rows. The budget meter is real spend. Provider
activity is aggregated from the run's own query log.

---

## Verification

Run these. They are the evidence.

```bash
npm run typecheck   # clean
npm run lint        # clean — 0 errors, 0 warnings
npm test            # 1,676 tests
npm run build       # compiles
```

`npm run typecheck` and `npm run build` both carry
`--max-old-space-size=6144`. The project outgrew Node's default heap; without
it the type check dies with "Zone Allocation failed" and reads as a mysterious
build failure rather than a resource limit.

### Background processing (production)

`pg_cron` in Supabase drives the queue, not Vercel — `vercel.json` ships
`"crons": []` because the Hobby plan allows one invocation a day, which cannot
run a job queue. See [CRON.md](CRON.md).

Verified live on 2026-09-08:

| Job | Schedule | Last run | Result |
|---|---|---|---|
| `clientturn-worker` | every 30s | continuous | succeeded |
| `clientturn-reap` | every 5m | continuous | succeeded |
| `clientturn-daily` | 03:07 UTC | 03:07 | succeeded |

Dispatch health: **50 of the last 50 HTTP calls returned 200.**

```sql
select * from public.cron_job_health;
select count(*), sum((status_code = 200)::int) from net._http_response;
```

### Security posture (production, verified)

| Check | Result |
|---|---|
| Tenant tables readable by browser without RLS | none |
| Tables granting browser SELECT with no policy | none (fixed in `0059`) |
| Provider cost columns readable by browser | none |
| Browser write grants without a matching policy | none — all 25 have RLS + policy |
| Literal secrets in `src/`, `supabase/`, `docs/` | none |

`0059` closed the only finding: `marketing_sessions` and `marketing_events`
granted browser SELECT with no policy. Fail-closed, so nothing was exposed —
but `marketing_sessions` has no `business_id`, so the obvious "fix" of adding a
`using (true)` policy would have turned one line into a cross-tenant leak.
`tests/rls.test.ts` now asserts the invariant so it cannot come back.

---

## Not built

Listed because a release note that omits these is not evidence, it is marketing.

**Sourcing providers are not configured.** No `APOLLO_API_KEY`,
`HUNTER_API_KEY`, `CLEARBIT_API_KEY` or `GOOGLE_PLACES_API_KEY` is set. A run
started today fails visibly at stage 3 with `PROVIDER_NOT_CONFIGURED` rather
than inventing results. **This is the single thing standing between the
surface and working end to end.** Add the keys and the same code path produces
prospects.

**Intent is first-party only.** `website-intent.ts` reads pages a business
publishes about itself and matches the workspace's own keywords. It is weaker
evidence than a licensed feed and is scored as such (strength capped at 0.6).
No Bombora-class adapter exists; one was deliberately not stubbed against a
vendor with no credentials and no verified API shape. Note that it fetches up
to 3 pages per company domain, so a 200-prospect run makes a few hundred
outbound requests.

**Warm-up is time-based, not reputation-based.** The ramp grows a sender from
10 to its full cap over 21 days on a clock. It does not read deliverability
signals to slow down when a domain is struggling — `autoPauseIfUnsafe` handles
the emergency case (bounce and complaint thresholds), but there is no gradual
reputation-aware throttle between "fine" and "stop".

**Optimisation proposes; it does not decide.** `campaigns/optimization.ts`
generates proposals and `variants.ts` authors experiments, but no engine
concludes an experiment and promotes a winner automatically. A person applies
the result.

---

## Operational notes

- **Migrations `0053`, `0054_v4_expansion` and `0056` are not applied to
  production** as of writing. They belong to adjacent work (campaign wizard
  columns, expansion signals, the affiliate programme), not to Find Leads.
  Apply them before relying on those surfaces.
- **A stopped run keeps its results.** Stop is terminal but not destructive.
- **Increase target is a fresh authorisation**, not a continuation. A workspace
  that spent its allowance while a run was paused cannot resume into spend it
  no longer has.
- **`prospects` and `leads` stay separate.** Promotion is a deliberate human
  act that carries the run, session, score and consent history across.
