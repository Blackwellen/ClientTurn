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
| `clientturn-worker` | every 30s | `/api/cron/worker` | Claims and runs up to 25 due jobs; re-queues mailbox polls; queues the outreach and social sweeps; reaps stalled jobs |
| `clientturn-daily` | 03:07 UTC | `/api/cron/daily` | Enqueues cost rollups, usage aggregation, retention cleanup (and the monthly rollup on the 1st) |
| `clientturn-reap` | every 5m | *(in-database)* | Returns abandoned locked jobs to pending, even while the app is down |

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
| `pending` count climbing | One tick cannot keep up; raise `BATCH_SIZE` in `src/app/api/cron/worker/route.ts` |
| Many `dead` jobs | A handler is failing permanently; read `jobs.last_error` |

## Tuning throughput

`BATCH_SIZE` is 25 per invocation in `src/app/api/cron/worker/route.ts`, and
the route's `maxDuration` is 60s. At a 30-second tick that is roughly 50 jobs a
minute. If a workspace's volume outgrows it, raise `BATCH_SIZE` first — the
route processes jobs sequentially, so keep the batch inside the 60-second
budget rather than pushing it far higher.

## Local development

Do not point Vault at `localhost`; Supabase cannot reach it. Drive the worker
by hand instead:

```bash
curl "http://localhost:3000/api/cron/worker?secret=$CRON_SECRET"
```

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
