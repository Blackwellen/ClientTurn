-- 0091_status_page_rollups: the last two, on the most public surface there is.
--
-- The status page builds thirty days of provider uptime from a 20,000-row probe
-- fetch and twenty-four hours of queue health from a 20,000-row job fetch, both
-- aggregated in Node.
--
-- Six providers on a schedule reach 20,000 probes well inside thirty days, and
-- the read is ordered newest-first — so the window silently shortens and the
-- published uptime percentage is computed over however long the most recent
-- 20,000 probes happen to cover, while the page says "30 days". This is the one
-- place in the product where a wrong number is read by people who are not
-- customers, during an incident, to decide whether to trust the service.
--
-- Both functions return counts grouped by the dimensions the page displays, and
-- deliberately do **not** decide what those counts mean. `statusFromProbe` and
-- `worst()` — which map a probe result to OPERATIONAL/DEGRADED/DOWN and pick
-- the worst of a day — stay in TypeScript, because that mapping is what the
-- page promises its readers and belongs next to the words it produces. The
-- result sets are small by construction: providers × days × statuses.

/* ------------------------------------------------------------ probe daily */

create or replace function public.status_probe_daily(
  p_since timestamptz
)
returns table (
  provider text,
  day date,
  status text,
  probes integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    c.provider,
    (c.checked_at at time zone 'UTC')::date,
    c.status,
    count(*)::int
    from public.platform_provider_checks c
   where c.checked_at >= p_since
   group by c.provider, (c.checked_at at time zone 'UTC')::date, c.status;
$$;

revoke all on function public.status_probe_daily(timestamptz) from public, anon, authenticated;
grant execute on function public.status_probe_daily(timestamptz) to service_role;

/* ---------------------------------------------------------- probe latest */

-- The current state per provider, and when it was last seen working.
--
-- `last_success_at` is a separate aggregate rather than "the newest HEALTHY row
-- in the fetched page", which is what it was: under truncation that produced
-- "last working: never" for a provider whose successes had simply fallen off
-- the end of the read — the most alarming possible way to be wrong on a status
-- page.
create or replace function public.status_provider_latest(
  p_since timestamptz
)
returns table (
  provider text,
  status text,
  error_code text,
  checked_at timestamptz,
  last_success_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with scoped as (
    select * from public.platform_provider_checks where checked_at >= p_since
  ),
  latest as (
    select distinct on (s.provider) s.provider, s.status, s.error_code, s.checked_at
      from scoped s
     order by s.provider, s.checked_at desc
  )
  select
    l.provider,
    l.status,
    l.error_code,
    l.checked_at,
    (select max(h.checked_at) from scoped h
      where h.provider = l.provider and h.status = 'HEALTHY')
    from latest l;
$$;

revoke all on function public.status_provider_latest(timestamptz) from public, anon, authenticated;
grant execute on function public.status_provider_latest(timestamptz) to service_role;

/* ------------------------------------------------------------ queue health */

-- Queue health, and the two figures the summary needs that a plain count
-- cannot give: how many pending jobs are retries rather than first attempts,
-- and how long a completed job actually took.
--
-- `avg_seconds` is bounded to an hour for the same reason the application
-- bounded it: a job row whose `completed_at` predates its `created_at`, or that
-- sat in a dead queue over a weekend, is not a processing time and would drag
-- a published average into meaninglessness.
drop function if exists public.status_job_health(timestamptz);

create function public.status_job_health(
  p_since timestamptz
)
returns table (
  job_type text,
  state text,
  jobs integer,
  retrying integer,
  avg_seconds numeric,
  last_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    j.type,
    j.state,
    count(*)::int,
    count(*) filter (where j.attempts > 0)::int,
    avg(extract(epoch from (j.completed_at - j.created_at))) filter (
      where j.completed_at is not null
        and j.completed_at >= j.created_at
        and j.completed_at < j.created_at + interval '1 hour'
    ),
    max(coalesce(j.completed_at, j.created_at))
    from public.jobs j
   where j.created_at >= p_since
   group by j.type, j.state;
$$;

revoke all on function public.status_job_health(timestamptz) from public, anon, authenticated;
grant execute on function public.status_job_health(timestamptz) to service_role;

create index if not exists platform_provider_checks_checked_at_idx
  on public.platform_provider_checks (checked_at desc);

create index if not exists jobs_created_at_idx
  on public.jobs (created_at desc);
