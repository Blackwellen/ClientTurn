-- 0012_job_claim: atomic job claiming.
-- SKIP LOCKED means overlapping worker invocations never take the same row.

create or replace function public.claim_jobs(batch_size integer, worker text)
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
    order by j.priority, j.run_at
    limit batch_size
    for update skip locked
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

revoke all on function public.claim_jobs(integer, text) from public, anon, authenticated;

-- Releases jobs whose worker died mid-run so they become due again.
create or replace function public.reap_stalled_jobs(stale_after interval default '5 minutes')
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare released integer;
begin
  update public.jobs
  set state = 'pending', locked_at = null, locked_by = null
  where state = 'running'
    and locked_at < now() - stale_after;
  get diagnostics released = row_count;
  return released;
end;
$$;

revoke all on function public.reap_stalled_jobs(interval) from public, anon, authenticated;
