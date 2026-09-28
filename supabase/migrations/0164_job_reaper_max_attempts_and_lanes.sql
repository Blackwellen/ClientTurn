-- 0164_job_reaper_max_attempts_and_lanes
--
-- Queue reliability (docs/revenue-engine/15-system-gap-audit.md, top-10 #6).
-- Mirrored in TypeScript by src/lib/jobs/lanes.ts (`reapDecision`,
-- `effectivePriority`) and asserted by tests/queue-lanes.test.ts.
--
-- 1. The reaper dead-letters.
--    reap_stalled_jobs (0012) returned every stale `running` job to `pending`
--    without looking at attempts. `attempts` is incremented at claim, so a job
--    that always hits the 60 s function limit was re-run every 5 minutes for
--    ever, burned function time, and never reached `dead`, so nothing alerted.
--    Now: attempts >= max_attempts -> `dead`, with a last_error that says why.
--    Anything else goes back to `pending` exactly as before.
--
-- 2. Lanes and aging in claim_jobs.
--    Order by an effective priority instead of the raw column:
--      priority <= 10 -> priority                           (critical: fixed)
--      otherwise      -> greatest(11, priority - minutes due) (aged, floored)
--    then run_at. A critical job (inbound reply, first response, agent turn,
--    voice dial or webhook, verified payment) is always claimed first; any
--    other job gains a point per minute it waits, so a follow-up send cannot
--    be starved by quotes and a nightly rollup still runs on a busy day, but
--    nothing non-critical ever overtakes a critical job.
--
-- 3. claim_jobs(..., exclude_types).
--    The worker time-boxes by duration class (src/lib/jobs/worker-loop.ts):
--    late in a tick it skips long job types rather than starting one that
--    would be killed at 60 s. The new parameter has a default, so the
--    currently deployed worker (which passes two arguments) keeps working.
--    The two-argument function is dropped first: two overloads would make
--    PostgREST's call ambiguous.
--
-- The due set is small (a partial index on state = 'pending'), so sorting it
-- by an expression costs little; jobs_due_idx still narrows the scan.
--
-- NOT APPLIED by the agent that wrote it. Apply with the normal migration flow.

create or replace function public.reap_stalled_jobs(stale_after interval default '5 minutes')
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare released integer;
begin
  update public.jobs
  set state = case when attempts >= max_attempts then 'dead' else 'pending' end,
      last_error = case
        when attempts >= max_attempts then left(
          'Stalled on every attempt (' || attempts || ' of ' || max_attempts
          || '): the worker stopped mid-run, usually at the function time limit. '
          || 'Dead-lettered by reap_stalled_jobs. Previous error: '
          || coalesce(last_error, 'none'), 2000)
        else last_error
      end,
      locked_at = null,
      locked_by = null
  where state = 'running'
    and locked_at < now() - stale_after;
  get diagnostics released = row_count;
  return released;
end;
$$;

revoke all on function public.reap_stalled_jobs(interval) from public, anon, authenticated;

drop function if exists public.claim_jobs(integer, text);

create or replace function public.claim_jobs(
  batch_size integer,
  worker text,
  exclude_types text[] default '{}'::text[]
)
returns table (
  id uuid,
  type text,
  business_id uuid,
  payload jsonb,
  attempts integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due as (
    select j.id
    from public.jobs j
    where j.state = 'pending'
      and j.run_at <= now()
      and not (j.type = any (coalesce(exclude_types, '{}'::text[])))
      and not exists (
        select 1 from public.businesses b
        where b.id = j.business_id and b.job_claims_paused
      )
    order by
      case
        when j.priority <= 10 then j.priority
        else greatest(11, j.priority - floor(extract(epoch from (now() - j.run_at)) / 60)::integer)
      end,
      j.run_at
    limit batch_size
    for update of j skip locked
  )
  update public.jobs j
  set state = 'running',
      locked_at = now(),
      locked_by = worker,
      attempts = j.attempts + 1
  from due
  where j.id = due.id
  returning j.id, j.type, j.business_id, j.payload, j.attempts, j.max_attempts;
end;
$$;

revoke all on function public.claim_jobs(integer, text, text[]) from public, anon, authenticated;

-- Jobs already queued keep priority 100. Give the pending critical ones their
-- lane now, rather than after they drain. Types match lanes.ts CRITICAL.
update public.jobs
   set priority = 10
 where state = 'pending'
   and priority = 100
   and type in ('message.process_inbound', 'agent.run', 'lead.process', 'ingest.webhook',
                'app.ingest', 'voice.dial', 'voice.webhook_ingest', 'payment.confirm');
