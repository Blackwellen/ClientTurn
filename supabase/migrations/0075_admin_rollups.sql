-- 0075_admin_rollups: the same fix as 0074, applied to the operations console.
--
-- Seven reads across `lib/admin/` scan up to 20,000 rows *across every
-- workspace* and aggregate them in Node. Same failure as 0074 and worse in one
-- respect: these are platform-wide totals, so the cap is reached sooner than on
-- any single tenant's data, and the number that goes wrong is the one an
-- operator uses to decide whether the platform is healthy.
--
-- Concretely, today:
--
--   * `getSystemHealth` counts queue depth from at most 20,000 unfinished jobs.
--     A genuine backlog is exactly the condition that exceeds it, so the queue
--     depth stops rising at the moment it matters most and the incident reads
--     as recovery.
--   * `getProviderHealth` derives uptime and p95 latency from at most 20,000
--     probes. With six monitored providers probed on a schedule, that window
--     silently shortens as probing gets denser, so "30-day uptime" quietly
--     becomes "uptime over however long 20,000 probes covers".
--   * `getPlatformEconomics` sums provider spend from at most 20,000
--     `cost_events`. Under-reported COGS reads as better margin.
--
-- The two series functions take the caller's bucket boundaries rather than
-- grouping by day or hour. The admin windows are anchored to `now`, not to a
-- clock boundary, so date_trunc would shift events across bucket edges by up
-- to an hour. `width_bucket` over the caller's own start/end is exact, and it
-- is the technique `admin_event_series` (0024) already uses.
--
-- All `security invoker`: every caller is the service-role admin client, which
-- is already how these tables are reached, and a definer function here would
-- add a privilege path nothing needs.

/* ================================================== per-workspace usage */

-- Current-period usage for a set of workspaces, for the Customers table.
--
-- `distinct on` picks the newest period per (workspace, metric), which is what
-- the application was doing by reading rows newest-first and keeping the first
-- sighting. Done here it cannot be truncated, and it returns at most two rows
-- per workspace instead of every counter row those workspaces have ever had.
create or replace function public.admin_customer_usage(
  p_business_ids uuid[]
)
returns table (
  business_id uuid,
  leads numeric,
  messages numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with latest as (
    select distinct on (c.business_id, c.metric)
      c.business_id, c.metric, c.quantity
      from public.usage_counters c
     where c.business_id = any(p_business_ids)
       and c.metric in ('lead_processed', 'message_sent')
     order by c.business_id, c.metric, c.period_start desc
  )
  select
    l.business_id,
    coalesce(sum(l.quantity) filter (where l.metric = 'lead_processed'), 0)::numeric,
    coalesce(sum(l.quantity) filter (where l.metric = 'message_sent'), 0)::numeric
    from latest l
   group by l.business_id;
$$;

revoke all on function public.admin_customer_usage(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_customer_usage(uuid[]) to service_role;

-- When each workspace was last active, from the audit trail.
--
-- One row per workspace. The application was reading up to 20,000 audit rows
-- ordered newest-first purely to find the first sighting of each workspace --
-- which means a single busy workspace could fill the whole read and leave
-- every other workspace looking dormant.
create or replace function public.admin_customer_last_activity(
  p_business_ids uuid[]
)
returns table (
  business_id uuid,
  last_activity_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select a.business_id, max(a.created_at)
    from public.audit_log a
   where a.business_id = any(p_business_ids)
   group by a.business_id;
$$;

revoke all on function public.admin_customer_last_activity(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_customer_last_activity(uuid[]) to service_role;

/* ======================================================== stock series */

-- The cumulative lines on the Overview: active customers, trials and MRR.
--
-- These are *stocks*, not flows -- the value at each point is everything that
-- existed up to then, so the series needs both a starting balance and the
-- additions inside the window. `bucket = 0` carries the balance at the window
-- start; buckets 1..p_buckets carry what was added in each slot.
--
-- Plan and interval are returned rather than a price. The plan catalogue lives
-- in TypeScript, prices change, and duplicating them in a migration would
-- create a second price list that silently disagrees with the first the moment
-- one of them is edited. This function counts; the caller prices.
create or replace function public.admin_stock_series(
  p_start timestamptz,
  p_end timestamptz,
  p_buckets integer
)
returns table (
  metric text,
  plan text,
  billing_interval text,
  bucket integer,
  entries bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with sources as (
    select 'active_customers'::text as metric,
           ''::text as plan,
           ''::text as billing_interval,
           b.created_at as at
      from public.businesses b
     where b.status = 'active'
       and b.created_at < p_end
    union all
    select 'trials',
           coalesce(s.plan, ''),
           coalesce(s.billing_interval, ''),
           s.created_at
      from public.subscriptions s
     where s.status = 'TRIALING'
       and s.created_at < p_end
    union all
    select 'paying',
           coalesce(s.plan, ''),
           coalesce(s.billing_interval, ''),
           s.created_at
      from public.subscriptions s
     where s.status = 'ACTIVE'
       and s.created_at < p_end
  )
  select
    s.metric,
    s.plan,
    s.billing_interval,
    -- 0 is the pre-window balance; everything inside the window lands in
    -- 1..p_buckets, clamped so a row at exactly p_end joins the last slot
    -- rather than falling off the end.
    case
      when s.at < p_start then 0
      else least(
        p_buckets,
        greatest(
          1,
          width_bucket(
            extract(epoch from s.at),
            extract(epoch from p_start),
            extract(epoch from p_end),
            p_buckets
          )
        )
      )
    end::integer as bucket,
    count(*)::bigint
    from sources s
   group by 1, 2, 3, 4;
$$;

revoke all on function public.admin_stock_series(timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.admin_stock_series(timestamptz, timestamptz, integer) to service_role;

comment on function public.admin_stock_series(timestamptz, timestamptz, integer) is
  'Cumulative admin metrics as a starting balance (bucket 0) plus per-bucket additions. Counts only -- the plan catalogue prices them in application code.';

/* ============================================================ job queues */

-- Queue depth by job type and state.
--
-- Completed jobs are excluded, as they were before: this stays small no matter
-- how much has been processed. What changes is that it is now a count rather
-- than a truncated fetch, so a backlog past 20,000 is reported as a backlog
-- instead of flattening out at exactly the point an operator needs the number.
create or replace function public.admin_job_state_counts()
returns table (
  job_type text,
  state text,
  jobs bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select j.type, j.state, count(*)::bigint
    from public.jobs j
   where j.state in ('pending', 'running', 'failed', 'dead')
   group by j.type, j.state;
$$;

revoke all on function public.admin_job_state_counts() from public, anon, authenticated;
grant execute on function public.admin_job_state_counts() to service_role;

/* ======================================================= provider spend */

-- Provider spend for a billing period, from the raw cost ledger.
--
-- Aggregated from `cost_events` rather than the margin snapshots so a provider
-- that has not yet been rolled up still appears -- the same reason the
-- application gave for reading the ledger, preserved.
create or replace function public.admin_provider_spend(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  provider text,
  category text,
  total_cost numeric,
  workspaces bigint,
  events bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    e.provider,
    e.category,
    coalesce(sum(e.total_cost), 0)::numeric,
    count(distinct e.business_id)::bigint,
    count(*)::bigint
    from public.cost_events e
   where e.occurred_at >= p_from
     and e.occurred_at < p_to
   group by e.provider, e.category
   order by coalesce(sum(e.total_cost), 0) desc;
$$;

revoke all on function public.admin_provider_spend(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_provider_spend(timestamptz, timestamptz) to service_role;

/* ====================================================== provider health */

-- Probe summary per provider: current state, p95 latency, graded uptime, and
-- when the last incident was.
--
-- `p95_ms` uses `percentile_cont`, a continuous interpolation, where the
-- application used a nearest-rank pick. On a dense probe series the two agree
-- to within a millisecond, and the interpolated figure is the standard one --
-- but it is a deliberate change rather than an accident, and it is noted here
-- because a latency number that moves for no visible reason is exactly the
-- kind of thing that costs an operator an afternoon.
--
-- Uptime is graded probes only: an UNKNOWN probe is one we could not judge,
-- and counting it as a failure would report an outage that never happened.
-- Providers with no probes at all are absent from the result, which is how the
-- caller distinguishes "never monitored" from "monitored and healthy".
create or replace function public.admin_provider_check_summary(
  p_since timestamptz
)
returns table (
  provider text,
  latest_status text,
  latest_checked_at timestamptz,
  p95_ms integer,
  graded bigint,
  healthy bigint,
  last_incident_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with scoped as (
    select c.provider, c.status, c.latency_ms, c.checked_at
      from public.platform_provider_checks c
     where c.checked_at >= p_since
  ),
  latest as (
    select distinct on (s.provider) s.provider, s.status, s.checked_at
      from scoped s
     order by s.provider, s.checked_at desc
  )
  select
    a.provider,
    l.status,
    l.checked_at,
    percentile_cont(0.95) within group (
      order by a.latency_ms
    ) filter (where a.latency_ms is not null)::integer,
    count(*) filter (where a.status <> 'UNKNOWN')::bigint,
    count(*) filter (where a.status = 'HEALTHY')::bigint,
    max(a.checked_at) filter (where a.status in ('DEGRADED', 'DOWN'))
    from scoped a
    join latest l on l.provider = a.provider
   group by a.provider, l.status, l.checked_at;
$$;

revoke all on function public.admin_provider_check_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_provider_check_summary(timestamptz) to service_role;

/* ================================================================ indexes */

create index if not exists usage_counters_business_metric_period_idx
  on public.usage_counters (business_id, metric, period_start desc);

create index if not exists audit_log_business_created_idx
  on public.audit_log (business_id, created_at desc);

create index if not exists cost_events_occurred_provider_idx
  on public.cost_events (occurred_at desc, provider);

create index if not exists platform_provider_checks_provider_checked_idx
  on public.platform_provider_checks (provider, checked_at desc);

-- Open work only. A partial index keeps this small permanently: the rows it
-- covers leave it as soon as a job completes, so it does not grow with volume
-- processed the way a full index on `state` would.
create index if not exists jobs_open_state_type_idx
  on public.jobs (state, type)
  where state in ('pending', 'running', 'failed', 'dead');
