-- 0024b_pg_cron_worker: run the job queue 24/7 from Postgres.
--
-- Why this exists. `vercel.json` ships `"crons": []` because the deployment is
-- on a Hobby plan, which allows one cron a day. Nothing was therefore driving
-- `/api/cron/worker`, so the queue only advanced when something happened to
-- call it. Every asynchronous behaviour in the product -- follow-up sends,
-- campaign expansion, inbound processing, booking sync, cost rollups and now
-- agent turns -- depends on that tick.
--
-- Supabase runs pg_cron and pg_net in the same database that already holds the
-- queue, so the scheduler lives next to the work. That removes the platform
-- dependency entirely: the queue keeps draining whoever is hosting the app.
--
-- SECRETS ARE NOT IN THIS FILE. The base URL and the shared cron secret are
-- read at call time from Supabase Vault. Run the two `vault.create_secret`
-- statements in docs/CRON.md once per environment before enabling the
-- schedule; until then `clientturn_dispatch_cron` raises a notice and does
-- nothing rather than firing unauthenticated requests at the internet.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- --------------------------------------------------------------- dispatcher
-- One place that knows how to call the app. Every scheduled job goes through
-- it, so rotating the secret or moving the domain is a Vault edit, not a
-- migration.
create or replace function public.clientturn_dispatch_cron(endpoint_path text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault, pg_temp
as $$
declare
  base_url text;
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret into base_url
    from vault.decrypted_secrets
   where name = 'clientturn_site_url'
   limit 1;

  select decrypted_secret into cron_secret
    from vault.decrypted_secrets
   where name = 'clientturn_cron_secret'
   limit 1;

  -- Fail quiet and visible. A missing secret must never become an
  -- unauthenticated request, and must never take the whole schedule down.
  if base_url is null or cron_secret is null then
    raise notice 'clientturn_dispatch_cron: vault secrets are not configured; skipping %', endpoint_path;
    return null;
  end if;

  -- Fire and forget. pg_net queues the request and returns immediately, so a
  -- slow worker invocation never holds a cron worker slot open.
  select net.http_get(
    url := rtrim(base_url, '/') || endpoint_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 55000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.clientturn_dispatch_cron(text) from public, anon, authenticated;

-- ----------------------------------------------------------------- schedule
-- Unschedule first so re-running this migration is safe.
do $$
declare
  job record;
begin
  for job in
    select jobname from cron.job
     where jobname in ('clientturn-worker', 'clientturn-daily', 'clientturn-reap')
  loop
    perform cron.unschedule(job.jobname);
  end loop;
end;
$$;

-- The queue tick. Thirty seconds keeps inbound replies and agent turns feeling
-- immediate; the worker claims with FOR UPDATE SKIP LOCKED, so overlapping
-- invocations are safe by construction and never double-process a job.
--
-- pg_cron 1.5+ accepts an interval string here. On an older pg_cron, replace
-- the schedule with '* * * * *' (once a minute) -- everything still works,
-- just with up to a minute of latency.
select cron.schedule(
  'clientturn-worker',
  '30 seconds',
  $$select public.clientturn_dispatch_cron('/api/cron/worker')$$
);

-- Daily rollups, usage aggregation and retention cleanup. 03:07 UTC rather
-- than 03:00 so it does not contend with every other system's top-of-hour job.
select cron.schedule(
  'clientturn-daily',
  '7 3 * * *',
  $$select public.clientturn_dispatch_cron('/api/cron/daily')$$
);

-- Safety net. The worker reaps stalled jobs on every tick, but if the app is
-- unreachable for a while nothing reaps them at all -- so the database does it
-- itself. Locked-but-abandoned jobs return to pending and get retried.
select cron.schedule(
  'clientturn-reap',
  '*/5 * * * *',
  $$select public.reap_stalled_jobs('5 minutes')$$
);

-- ------------------------------------------------------------ observability
-- Admin-facing health of the scheduler itself: last run, status, duration.
-- Server-role only; nothing here is exposed to a browser session.
create or replace view public.cron_job_health
with (security_invoker = true)
as
  select
    j.jobname,
    j.schedule,
    j.active,
    r.status,
    r.return_message,
    r.start_time,
    r.end_time,
    extract(epoch from (r.end_time - r.start_time)) as duration_seconds
  from cron.job j
  left join lateral (
    select status, return_message, start_time, end_time
      from cron.job_run_details d
     where d.jobid = j.jobid
     order by d.start_time desc
     limit 1
  ) r on true
  where j.jobname like 'clientturn-%';

revoke all on public.cron_job_health from anon, authenticated;

comment on view public.cron_job_health is
  'Last run of each ClientTurn scheduled job. Read by the platform admin
   System view to show whether background processing is alive.';
