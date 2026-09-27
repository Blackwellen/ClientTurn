-- 0137_job_claim_pause_and_retry_index
--
-- Written 2026-09-27 after the live business-story run 9b566d75.
--
-- 1. A per-workspace claim pause.
--    Jobs inserted by SQL (emit_domain_event's `event.dispatch`, fired by the
--    triggers on bookings, messages, agent_handoffs, qualification_answers and
--    suppression_entries) are committed with run_at = now(), so they are
--    claimable by the deployed worker until the story harness parks them. The
--    run measured 266 such jobs, exposed for up to 593 ms each, against a claim
--    every 30 s: an expected ~2-3 claims per run. Run 9b566d75 recorded 2
--    (`deployedWorkerTouched`). Parking cannot close that window; only the
--    claim can. With `job_claims_paused` set, claim_jobs never takes the
--    workspace's jobs, whatever their run_at. It is also an operator control
--    (pause one tenant's queue during an incident).
--
-- 2. jobs.retried_from_job_id is a self-reference (ON DELETE SET NULL) with no
--    index, so every deleted job seq-scans the whole jobs table (124k rows on
--    2026-09-27). One delete over a few hundred jobs exceeds PostgREST's 8 s
--    statement_timeout: that is why the story teardown and any bulk job purge
--    time out. A partial index makes the FK action an index lookup.

alter table public.businesses
  add column if not exists job_claims_paused boolean not null default false;

comment on column public.businesses.job_claims_paused is
  'When true, claim_jobs never claims this workspace''s jobs (test workspaces, incident response). Service role only.';

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
      and not exists (
        select 1 from public.businesses b
        where b.id = j.business_id and b.job_claims_paused
      )
    order by j.priority, j.run_at
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

revoke all on function public.claim_jobs(integer, text) from public, anon, authenticated;

create index if not exists jobs_retried_from_job_id_idx
  on public.jobs (retried_from_job_id)
  where retried_from_job_id is not null;
