# Background processing — running ClientTurn 24/7

Everything asynchronous in ClientTurn is a row in `jobs`, drained by
`/api/cron/worker`. Follow-up sends, inbound message processing, agent turns,
campaign expansion, booking sync, integration health checks, cost rollups and
retention cleanup are all that one loop.

**If nothing calls the worker, none of it happens.** The queue fills up and the
product looks broken in the one way customers notice immediately: nobody
replies to their leads.

## Why Postgres schedules it, not Vercel

`vercel.json` carries `"crons": []`. The deployment is on a Hobby plan, which
permits one cron invocation per day — not enough to run a job queue. Rather
than couple uptime to a hosting tier, the schedule lives in Supabase, in the
same database as the queue, using `pg_cron` + `pg_net`.

That means:

- The worker ticks every 30 seconds regardless of the hosting plan.
- Moving or re-hosting the app is a Vault edit, not a redeploy.
- If the app is unreachable, the database still reaps stalled jobs, so nothing
  is left locked forever by a worker that died mid-batch.

Migration: `supabase/migrations/0024b_pg_cron_worker.sql`.

## Environment status

| Environment | Supabase project | Schedule | Enabled |
|---|---|---|---|
| Production (`https://clientturn.com`) | `losieaikadkadtmezini` | `clientturn-worker` / `-daily` / `-reap` | **Yes — 2026-09-06** |

Production is done: `0024b` is applied, both Vault secrets are populated, and
`clientturn-worker` is active on the 30-second schedule (pg_cron is 1.5+, so the
interval form works). Verified by a scheduled tick returning HTTP 200 and
draining the queue. Do not re-run the `create_secret` statements below against
production — use `update_secret` to rotate.

## One-time setup per environment

The migration deliberately contains no secrets. Before the schedule does
anything, store two values in Supabase Vault. Run this in the SQL editor of the
target project (**Client Turn** — `losieaikadkadtmezini`):

```sql
select vault.create_secret(
  'https://clientturn.com',          -- no trailing slash; the deployed origin
  'clientturn_site_url',
  'Base URL the pg_cron dispatcher calls'
);

select vault.create_secret(
  '<the value of CRON_SECRET>',      -- must match the app env var exactly
  'clientturn_cron_secret',
  'Shared secret for /api/cron/* authorisation'
);
```

`CRON_SECRET` must also be set in the app's environment. `/api/cron/worker` and
`/api/cron/daily` return 401 without it, and the dispatcher sends it as
`Authorization: Bearer <secret>`.

To rotate either value later:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'clientturn_cron_secret'),
  '<new secret>'
);
```

No migration, no deploy — the dispatcher reads Vault on every call.

Until both secrets exist, `clientturn_dispatch_cron` raises a notice and
returns without making a request. That is deliberate: a missing secret must
never become an unauthenticated call.

## What is scheduled

| Job | Schedule | Calls | Does |
|---|---|---|---|
| `clientturn-worker` | every 30s | `/api/cron/worker` | Reaps stalled jobs; runs the schedulers (mailbox polls, outreach/social/CRM/intent/re-engage sweeps); claims and runs due jobs in a 40-second time box; every 5 minutes, the ops alert check |
| `clientturn-daily` | 03:07 UTC | `/api/cron/daily` | Enqueues cost rollups, usage aggregation, retention cleanup, audit-log retention (and the monthly rollup on the 1st); runs the full ops alert check |
| `clientturn-reap` | every 5m | *(in-database)* | Returns abandoned locked jobs to pending, even while the app is down; from 0164, dead-letters a job that stalled on its last attempt |

Overlapping worker invocations are safe: `claim_jobs` uses
`FOR UPDATE SKIP LOCKED`, so two ticks never claim the same row.

### The sweeps the worker queues

Two jobs are not scheduled by pg_cron at all — the worker queues them itself,
each on a five-minute idempotency bucket, so however often the worker ticks
only one of each is ever pending:

| Sweep | Queued as | Does |
|---|---|---|
| Outreach sequences | `outreach.tick` | Finds email sequence steps that are due across every workspace |
| Social outreach | `social.tick` | Finds workspaces with due `social_connection_states` rows and fans out one `social.advance` job each |
| Stuck voice calls (every 15 min) | `voice.reconcile` | Closes calls stuck live: a dial that crashed after `DIALLING` (FAILED after 10 min, never re-dialled), or a call whose `CALL_ENDED` never arrived (asks the provider once, then ENDED/FAILED). Frees the lead, the minutes hold and the concurrency slot (`runtime-core.ts reconcileStaleCalls`) |
| Integration tokens (every 10 min) | `integration.token_refresh` | (1) Renews every refreshable connection (Calendly, Google Calendar, Google Ads, Salesforce, Zoho CRM per data centre, Slack with rotation, LinkedIn Ads) whose access token expires within 30 minutes, through `getLiveAccessToken` (compare-and-swap on the refresh token, rotated refresh tokens stored, "Reconnect" only when the provider refuses the grant and nobody else has replaced it; a blip is retried next sweep). Salesforce states no lifetime, so an assumed two-hour session is recorded and a 401 forces one refresh. (2) Every six hours, retries connections flagged "Reconnect" and clears the flag if the provider accepts the refresh. (3) Once a day per Meta / WhatsApp Cloud connection (no refresh grant), asks Meta `/debug_token`, records its expiry, extends with `fb_exchange_token` within 15 days of expiry, warns (card + notification) from 10 days out, and flags "Reconnect" only when Meta says the token is invalid (`integrations/token-refresh-core.ts`, `integrations/meta-token-core.ts`) |

`social.advance` is what makes connect-then-message run unattended: it decides
what is due for each prospect, withdraws invites that have gone unanswered,
and composes the next message. It does **not** send anything on LinkedIn — see
`src/lib/outreach/social-scheduler.ts` for why the send is performed by a
person unless the workspace has a partner integration. `social.execute` is the
only job that touches a platform, and it is queued only for accounts in
`PARTNER_API` mode in a workspace that has opted into autonomous sending.

Both sweeps are cheap when idle: each is a single partial-index query that
queues nothing when nothing is due.

### If your pg_cron is older than 1.5

The `'30 seconds'` schedule needs pg_cron 1.5+. On an older version, replace it
with a once-a-minute cron expression:

```sql
select cron.unschedule('clientturn-worker');
select cron.schedule(
  'clientturn-worker',
  '* * * * *',
  $$select public.clientturn_dispatch_cron('/api/cron/worker')$$
);
```

Everything still works; replies just arrive up to a minute later.

## Checking it is alive

```sql
-- Last run of each ClientTurn job, with status and duration.
select * from public.cron_job_health;

-- Recent dispatch attempts and the HTTP responses they got back.
select id, status_code, created
  from net._http_response
 order by created desc
 limit 20;

-- Is the queue draining, or growing?
select state, count(*), min(run_at)
  from public.jobs
 group by state;
```

Healthy looks like: `cron_job_health.status = 'succeeded'` with a recent
`start_time`, `status_code = 200` on recent responses, and `jobs` holding few
`pending` rows with `run_at` in the near past — not a growing backlog.

Unhealthy patterns and what they mean:

| Symptom | Cause |
|---|---|
| `status_code = 401` | `CRON_SECRET` and `clientturn_cron_secret` disagree |
| No rows in `net._http_response` | Vault secrets missing — check for the notice in `cron.job_run_details.return_message` |
| `pending` count climbing | One tick cannot keep up. See Tuning throughput below; the `queue_backlog` alert fires after 15 minutes |
| Many `dead` jobs | A handler is failing permanently; read `jobs.last_error` |

## Tuning throughput

**Measured, 2026-09-27** (read-only, production `losieaikadkadtmezini`): the worker's
own responses in `net._http_response` over 6 hours, 720 ticks, all HTTP 200, none timed
out. Each tick claimed **3 to 7 jobs, mean 4.3, never more than 7**, so the real ceiling
was about **14 jobs a minute**, not the "~50 a minute" this page used to claim. At the
03:07 daily burst, 16 jobs were due at once and took two ticks. The cause was the loop,
not `BATCH_SIZE = 25`: it stopped *starting* jobs 10 seconds after the request began, and
the reaper and the seven scheduler enqueues ran inside those 10 seconds. Completed jobs
over 7 days: 48,451, of which 82% were the `outreach.tick`/`social.tick` sweeps.

**Now (derived).** `src/lib/jobs/worker-loop.ts` measures from the start of the request
(Vercel's `maxDuration = 60` counts from there) and time-boxes by duration class
(`src/lib/jobs/lanes.ts`):

| Class | May start until | Headroom | Examples |
|---|---|---|---|
| standard | 40 s | 20 s | notifications, quote expiry, webhook dispatch, the sweeps |
| slow | 25 s | 35 s | message sends, agent turns, voice dial, invoices |
| long | 12 s | 48 s | sourcing (self-limits to 45 s), analysis, rollups, PDF render, recording copy |

It claims in batches of 5 and, once a class's window has closed, asks `claim_jobs` to
skip those types (0164 `exclude_types`), so a long job at the head of the queue no longer
ends the tick. The schedulers now run concurrently, and one failing no longer fails the
tick. At the measured cost of roughly 1 to 1.5 s per light job (claim, handler, complete),
a 40-second window gives **about 25 to 35 jobs per tick, 50 to 70 a minute** from the
30-second schedule, plus whatever an overlapping invocation adds (a tick that runs past
30 s overlaps the next; `SKIP LOCKED` keeps that safe). Heavy jobs lower this: a queue
of nothing but 20-second agent turns does 2 or 3 per tick. The hard cap is 150 jobs per
tick. Re-measure after deploying with the query below; the response now also reports
`released`, `stoppedBy` and `elapsedMs`.

```sql
select count(*) ticks, avg((content::jsonb->>'claimed')::int) mean_claimed,
       max((content::jsonb->>'claimed')::int) max_claimed,
       avg((content::jsonb->>'elapsedMs')::int) mean_ms
  from net._http_response where content like '{"claimed"%';
```

If a real backlog still outgrows one invocation, add a second pg_cron schedule offset
by 15 s; do not raise `maxDuration` past the plan's limit.

## Lanes and priorities

`claim_jobs` (0164) orders by an effective priority, then `run_at`:

| Lane | Priority | Types (lanes.ts `JOB_CLASSES`) |
|---|---|---|
| Critical | 10 (or lower, as the Meta/Google/LinkedIn/Twilio webhooks set) | `message.process_inbound`, `agent.run`, `lead.process`, `ingest.webhook`, `app.ingest`, `voice.dial`, `voice.webhook_ingest`, `payment.confirm` |
| Interactive | 30 | `message.send`, `automation.advance`, `reengage.trigger`, `email.poll`, `lead_source.poll`, `booking.sync`, notifications, `voice.post_call`/`retry`/`text_back`, `lead.score` |
| Standard | 100 | quotes, invoices, `checkout.nudge`, CRM push, webhooks, the sweeps, `event.dispatch` |
| Bulk | 200 | sourcing, analysis, rollups, retention, health checks, margin checks |

A critical job is always claimed first and never ages. Every other job gains one point
per minute it has been due, down to 11, so nothing non-critical ever overtakes critical
work, a follow-up send is never starved by a flood of quotes, and the nightly jobs still
run on a busy day. `enqueue` stores the lane's priority when the caller passes none.
`event.dispatch` rows inserted by SQL triggers keep the column default (100).
A new `JobType` must be added to `JOB_CLASSES`; `tests/queue-lanes.test.ts` fails until it is.

## The reaper and dead-lettering

`attempts` is incremented when a job is claimed. Before 0164, `reap_stalled_jobs` put
every job still `running` after 5 minutes back to `pending`, whatever its attempts, so a
job that always hit the 60-second kill re-ran every 5 minutes for ever and never alerted.
From 0164 a stalled job that has used `max_attempts` is marked `dead` with a
`last_error` that says so, which the `dead_jobs` alert then reports.

## Alerts

`src/lib/ops/alerts.ts` pushes what used to be pull-only (docs/OBSERVABILITY.md, "Push
alerts"): dead jobs, a webhook failure spike, a queue backlog, a stopped worker schedule,
jobs no longer completing (pg_cron firing but the app refusing it), a missed daily run, a
failed pg_cron run, provider outages and new margin alerts (voice and platform).

It runs from the worker every 5 minutes, from the daily route, and from
**`GET /api/cron/heartbeat`**, which is for an external uptime monitor: every check above
runs *inside* pg_cron, so if pg_cron stops, only something outside notices. Point any
free HTTP monitor at `https://clientturn.com/api/cron/heartbeat` every 5 minutes and alert
on a non-200. It returns `{"ok":true}` or 503 `{"ok":false}` and nothing else.

## Local development

Do not point Vault at `localhost`; Supabase cannot reach it. Drive the worker
by hand instead:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/worker
```

The `?secret=` query form still works in development only. In production only the
`Authorization` header is accepted, compared in constant time
(`src/lib/security/cron-auth.ts`): a query-string secret ends up in access logs.

## Revenue-engine jobs (added 2026-09, migrations 0110–0126)

All three schedules were verified live on 2026-09-26:

- **`clientturn-worker`**: every 30 seconds. 239 of 239 runs in the last 2 hours succeeded; all 60 HTTP calls in the last 30 minutes returned 200.
- **`clientturn-reap`**: every 5 minutes, all succeeded.
- **`clientturn-daily`**: 03:07 UTC, succeeded every day.
- **Vault:** both secrets are present.

New job types, all registered in `src/lib/jobs/register.ts`:

| Job | Producer |
|---|---|
| `event.dispatch` | SQL `emit_domain_event()` triggers (0123) and `emitDomainEvent()` — the outbox fan-out |
| `lead.score` | `lead.process`, the event dispatcher (re-score triggers), `lead.rescore` |
| `ingest.webhook` | `/api/webhooks/google-ads` |
| `handoff.brief` | `requestHumanHandover` |
| `domain.health_check`, `email.sender_health`, `whatsapp.template_sync`, `retention.cleanup`, `billing.daily` (failed-payment retries, once a day for up to 30 days; overage invoice items) | `/api/cron/daily` |
| `voice.margin_check` (voice gross-margin alert for Admin, Economics), `experiment.auto_promote` (promotes a significant winner only where auto-promote is switched on) | `/api/cron/daily` |
| `voice.retention` (daily, 3 attempts): deletes `voice_call_recordings` and `voice_call_transcripts` rows past their `retain_until` or older than the workspace's current `voice_settings.recording_retention_days` (the 0150 trigger tombstones each stored object), then deletes the R2 object of every unpurged `voice_object_tombstones` row and marks it `purged_at`. Tombstones outlive a deleted workspace, so this is also what removes a deleted workspace's recordings from R2. Idempotent and bounded (500 rows per kind and 500 objects per run; a backlog drains over several days). Rules in `src/lib/data-rights/voice-retention.ts`, tested with a fake R2 | `/api/cron/daily` |
| `audit.retention` (daily, 3 attempts, IR-09): deletes `audit_log` rows older than each workspace's audit retention (Settings -> Security; 12 months by default, capped by plan: Pro 24, Enterprise 84) and platform rows (`business_id` null) older than 12 months, through `audit_log_purge_batch` (0180) in batches of 1,000 with a 50,000-row budget per run, so a backlog drains over several days. Writes one `security.audit_log_purged` summary per workspace purged. Only `audit_log` rows are touched; exports a customer already downloaded are their own copy. Skips (and logs) until 0180 is applied. Rules in `src/lib/data-rights/audit-retention.ts`, tested with fakes | `/api/cron/daily` |
| `billing.workspace_deletion` (daily, 3 attempts): the day-90 deletion of cancelled workspaces (`docs/BILLING.md` §3). Syncs `workspace_deletion_schedule` (0170) with `subscriptions` in `CANCELLED` (a resubscribe clears the row), sends the owner a notice on day 60 and day 83 (idempotent, keyed per workspace, day and end date), then on day 90, and never sooner than 7 days after the final notice, re-reads the state and erases every lead and prospect through `data_rights_delete` (bounded per run; a large workspace finishes over several days), writes PREFIX tombstones for its R2 prefixes (`r2_object_tombstones`) and purges them, and closes the workspace with `workspace_close_after_retention`. A workspace ON HOLD (Admin -> Billing -> Scheduled deletions) is never notified or deleted. **Dry run until `WORKSPACE_DELETION_ENABLED=true`**: the job reports the plan and writes nothing; `{ "dryRun": true }` forces one. Rules in `src/lib/billing/workspace-deletion.ts`, tested with fakes | `/api/cron/daily` |
| `automation.dispatch` (event-driven): one per automation event a rule, the pipeline mapping or a derived trigger needs; runs the pipeline move and each enabled rule's actions (`src/lib/automation/rule-runner.ts`). A delayed action ("schedule a call") queues its own continuation with `run_at` | `emitAutomationEvent` |
| Voice (event-driven, not scheduled): `voice.dial`, `voice.webhook_ingest`, `voice.post_call`, `voice.recording_fetch`, `voice.retry`, `voice.number_provision`, `voice.number_release`, `voice.text_back` (docs/VOICE.md) | queued by the voice operations, webhooks and each other |

**Deploy dependency.** pg_cron calls the *deployed* app. Until the revenue-engine code is
deployed, any `event.dispatch` job that a new SQL trigger enqueues is picked up by a worker
with no handler for it, and dies with "No handler registered". Nothing is lost:

- the triggers never fail the write that caused them;
- the event itself stays in `domain_events`.

After deploying, re-queue those jobs:

```sql
update public.jobs set state = 'pending', attempts = 0, run_at = now(), last_error = null
 where type = 'event.dispatch' and state = 'dead';
```

## Verified live 2026-09-27 (final programme check)

Read-only checks against project `losieaikadkadtmezini`:

| Check | Result |
|---|---|
| `cron.job` | `clientturn-worker` every 30 s, `clientturn-daily` at 03:07 UTC, `clientturn-reap` every 5 min; all active |
| `cron.job_run_details`, last 24 h | worker 2,879/2,879 succeeded, reap 288/288, daily 1/1 (03:07) |
| `net._http_response`, last 6 h | 720/720 calls to `/api/cron/worker` returned HTTP 200 |
| Vault | `clientturn_site_url` and `clientturn_cron_secret` present |
| Daily run (03:07 today) | every job completed: `cost.rollup_daily`, `usage.aggregate`, `retention.cleanup`, `maintenance.expiry`, `affiliate.ledger`, `recurring_search.tick`, `domain.health_check`, `email.sender_health`, `whatsapp.template_sync`, `billing.daily` |
| Minute ticks | `outreach.tick` and `social.tick` completing continuously (~8.6k each in 3 days) |
| Backlog | 0 pending jobs overdue by more than 5 minutes; 0 dead or failed jobs in 48 h |
| `claim_jobs` (0137) | claims skip workspaces with `businesses.job_claims_paused`; service-role only; worker still 200 after the change |

**Deploy dependency.** The deployed worker runs the last deployed code. `intent.sweep` (qualification engine, every 6 h) is scheduled by `/api/cron/worker` in this working tree, so it starts only after this code is deployed; until then intent decay happens only when a lead is rescored. Every other new job type added in this programme is enqueued by application events and runs as soon as the code that enqueues it is deployed. After deploying, confirm with:

```sql
select type, state, count(*) from public.jobs
 where type = 'intent.sweep' and created_at > now() - interval '1 day' group by 1, 2;
```
