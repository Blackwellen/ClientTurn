# Business stories (coverage tracker 8.17)

End-to-end revenue journeys against the owner's **live** Supabase project. The owner approved this. Everything inside ClientTurn runs for real: route handlers, `ingestLead`, jobs, the agent, the policy gate and SQL triggers. Only the provider HTTP boundary is faked.

```
node --experimental-transform-types --env-file=.env --env-file=.env.local \
  --import ./scripts/e2e-resolver.mjs --test tests/stories/revenue-stories.test.ts
```

Run it between **08:02 and 19:30 UK time**. The UK compliance pack defers SMS during its quiet hours (20:00–08:00). Outside that window the run refuses to start. `STORY_ALLOW_QUIET=1` overrides this for development only, and in that mode every send defers.

`--experimental-transform-types` is Node's own flag. It is needed because `jobs/register.ts` imports a handler that uses TypeScript parameter properties.

## Files

| File | Contents |
|---|---|
| `safety.ts` | The guards (read this first). |
| `harness.ts` | The test workspace, the in-process job runner, the guard, provider fakes, turn helpers, the shadow-diff review, cleanup. |
| `guard-worker.mjs` | The guard loop's thread (layer 6). |
| `kit.ts` | Evidence ledger, `check()`, business configuration, connection helpers. |
| `story-hooks.mjs` and `fakes/` | Substitutions for things that only exist inside a Next request (see below). |
| `revenue-stories.test.ts` | Preflight, story A, report and teardown. It imports the other story files in order. |
| `story-b-google-ads.ts` | Story B. |
| `story-c-linkedin-leadgen.ts` | Story C. |
| `story-g-m-intake.ts` | Stories G to M. |
| `story-d-f-x.ts` | Stories D, E, F and X1 to X5. |
| `story-p-payments.ts` | Story P: the direct-sale loop (P1 to P6). A tracked Stripe Payment Link, one abandoned-checkout nudge (the attempt is backdated, then `checkout.nudge` fast-forwarded), a Stripe `checkout.session.completed` signed here with a fake per-workspace secret and posted to the real `/api/webhooks/payments/stripe/[endpointId]` route, then WON, the thank-you and no further nudge. Nothing reaches Stripe. Records BLOCKED (not FAIL) until migration 0143 is applied or when `CREDENTIAL_ENCRYPTION_KEY` is unset. |
| `story-q-engine-live.ts` | Story Q: the qualification engine in LIVE mode (Q1 to Q5). Imported last, because it switches the workspace's engine to LIVE. Its scripted model performs the NBA block's one move. |
| `story-r-reengagement.ts` | Story R: intent-driven re-engagement (R1, R2). Imported after Q (engine LIVE). R1: a "not now, try me in March" lead; the harness clock moves the conversation 40 days back and the NOT_NOW `resume_at` into the past, then `reengage.trigger` is fast-forwarded and must open one FOLLOW_UP_DUE agent turn that sends one SMS. R2: a booking marked no-show plans the rebook and the 24h nudge through the outbox; the rebook is sent, the nudge (fast-forwarded) is held by the 1-a-day frequency cap. Works before migration 0146 (defaults). |

## Safety design: why nothing can be sent

### 1. Secrets
Every provider secret in `process.env` is overwritten with a fake before any application module loads:
- Twilio, Resend, Azure, Meta, Google, LinkedIn, Salesforce, Zoho, Slack, Calendly, TikTok, Stripe test, and the cron secret.
- The live Stripe key, `SUPABASE_PAT` and the optional enrichment keys are deleted.

The Azure endpoint is forced to `story-fake.openai.azure.com`.

### 2. Sockets
`tls.connect`, `net.connect`, `http(s).request` and `http(s).get` refuse every host except the Supabase project, which Node's own `fetch` uses. The management API host is also allowed, for the harness's read-only verification SQL. The run proves this at start-up before writing anything (`assertEgressBlocked`).

### 3. DNS
Only the Supabase hosts resolve for real. Every other name gets a fixed address, so no lookup for a fixture domain ever leaves the machine.

### 4. fetch
Supabase traffic passes through. Every other URL must be answered by a registered fake, or the call throws `BLOCKED_EGRESS`. The report lists every blocked call; a clean run has none.

### 5. Jobs are parked
Every `jobs` row this process writes is rewritten to a far-future `run_at` that is unique to the run, with the original due time kept in `last_error`.
- The deployed worker runs older code, every 30 seconds.
- The live `claim_jobs` claims only `state='pending' AND run_at <= now()`. The run checks this definition before starting (`assertClaimContract`) and refuses if it has changed.
- So a parked job is invisible to the deployed worker. The in-process runner executes the jobs directly.
- `claim_jobs` and `reap_stalled_jobs` are refused in-process, so this run can never claim another workspace's job.
- A failed job is marked `dead`, never rescheduled. A reschedule would unpark it.

### 6. SQL-originated jobs
Only two live SQL functions insert jobs: `emit_domain_event` (event.dispatch) and `receive_workspace_app_event` (app.ingest). The run asserts this list.
- A guard loop parks any unparked pending job of the test workspace every 40 ms, up to 3 sweeps in flight. It runs on its own thread (`guard-worker.mjs`), so the stories' synchronous work cannot stall it; its only request is that parking PATCH to the Supabase REST endpoint.
- Both job types are local writes only. A test workspace has no webhook endpoints and no Slack connection.
- **Known gap.** `emit_domain_event` runs inside row triggers (bookings, messages, agent_handoffs, qualification_answers, suppression_entries). It inserts `event.dispatch` with `run_at = now()`, so the job is claimable until the guard parks it, and the deployed claim runs every 30 s. A run makes about 265 such jobs. On 2026-09-27 the deployed worker claimed 2, 2 and 1 of them in three runs (all `event.dispatch`, all completed as local writes). Parking cannot close this window.
- Migration 0137 closes it. It adds `businesses.job_claims_paused`, and `claim_jobs` skips a paused workspace. The harness sets the flag whenever the column exists, and the report shows `claimPause0137`. Until 0137 is applied, expect layer 7 to fail now and then.

### 7. Proof after the run
Every test-workspace job that left `pending` must be one this process claimed. `deployedWorkerTouched` must be `[]`, and the run fails otherwise.

### 8. Billing
The workspace's **real** subscription row is `CANCELLED`. If the deployed code ever did claim a job, its policy gate would refuse any send with `BLOCKED_BUSINESS_STATE`: the deployed-era `send-core` evaluates policy, including entitlements, before any provider call. In this process only, the read of that one row returns an ACTIVE row. Stripe is never called.

### 9. Connections
Connections are created only with fake credentials, and only for the story that needs them. The deployed worker never sees a job for the workspace (see 5).

### 10. Test contacts
Emails are `@example.invalid`. Mobiles are Ofcom drama numbers `+447700900xxx`.

### 11. Schedule
The run refuses to start between 02:45 and 03:40 UTC, when the deployed daily cron runs.

## The workspace and cleanup

There is one workspace, `ZZ-E2E-STORY-<run>`, with one owner user. Each story reconfigures its profile: archetype, motion, services and questions. Earlier questions are deactivated rather than deleted.

The `after` hook works in this order, so the evidence survives a teardown failure:
1. stops the guard loop and computes `deployedWorkerTouched` (read before anything is deleted);
2. runs the shadow-diff review (`shadowReview`: `decision_json.qi.accounting.shadow_differs` on every agent run, `legacy_decision` on every SHADOW assessment), which the teardown would otherwise delete;
3. prints the story report and the evidence table;
4. runs the staged teardown (`teardownWorld`), which never throws and checks every delete's `{ error }`:
   - **jobs**: the workspace's own, then the parked jobs this run wrote with no workspace id. Deleted by id in batches of 25, halved on a statement timeout. `jobs.retried_from_job_id` is an unindexed self-reference (ON DELETE SET NULL), so every deleted job scans the whole `jobs` table; one statement over a run's jobs exceeds PostgREST's 8 s `statement_timeout` (the 2026-09-27 08:07 run failed exactly here);
   - **domain_events**, by id in batches;
   - the global `webhook_events` rows the run created;
   - every other table with rows for the workspace, largest first, in up to four passes (a table still referenced by another is retried after it);
   - the workspace itself, retried three times with backoff;
   - the auth user;
5. counts rows for the workspace id across **every public table with a `business_id` column**, plus the run's parked jobs, webhook rows, auth user and workspace name;
6. prints the cleanup result. If anything remains, it prints what remains and the SQL that finishes it (run as `postgres`, with `set statement_timeout = '600s'`).

The run fails unless `deployedWorkerTouched` is `[]`, the teardown recorded no errors and every count is zero.

**Never run the file with `--test-name-pattern` or `--test-only`.** With a filter, Node runs the file-level `after` hook before the filtered suites, so the workspace is created after its teardown has already run, the guard loop keeps the process alive and everything is left behind (seen once on 2026-09-27 and cleaned by hand).

## Fakes: what is and is not evaluated

Provider fakes return the response shapes in each provider's public documentation:
- Graph lead forms
- Google Ads `googleAds:search`
- LinkedIn Lead Sync (`leadFormResponses`, `leadForms/{id}`, with `content.questions`)
- Community Management comments (actor URN only)
- Companies House search
- HubSpot contact search
- Salesforce SOQL
- Google Calendar freeBusy and events. Like Google, freeBusy reports every event the fake has accepted in this run as busy, so a slot booked in one story is not offered again in a later one
- Twilio Messages

The model (Azure) is faked with **scripted decisions**. The script asks exactly the question the deterministic strategy block names, and at the threshold takes the motion's close. **Model quality is NOT evaluated here.** What is evaluated is everything the runtime does around the model: gates, strategy, the qualification pointer, the validator, sends, booking, checkout and hand-off.

## Harness-only substitutions (`story-hooks.mjs`)

- `@/lib/auth/session`: returns the story owner's membership. Role checks still run.
- `@/lib/supabase/server`: a client built from the owner's **real** access token, so RLS applies exactly as for a signed-in page.
- `next/cache`: no-op.
- `next/server`: resolved to `next/server.js`.

There are no schema shims. Migration 0129 (billing) is applied, so the send path reads `usage_overage_events` and `message_credit_balances` for real.
