-- 0024_platform_admin_ops: the two support models Platform Administration
-- genuinely needs, plus the indexes the admin surfaces read through.
--
-- Deliberately small. Operational events and platform errors are *derived*
-- from the tables that already record them (webhook_events, jobs, messages,
-- integrations) by a service layer — duplicating every event into a second
-- store would create a parallel source of truth. What cannot be derived is:
--
--   1. platform provider probe history — nothing records how long the Meta or
--      Stripe API took to answer, so p95 latency and 30-day uptime need their
--      own append-only series;
--   2. error triage state — the underlying rows carry the failure but no
--      concept of "an operator looked at this and resolved it".
--
-- Both are server-only: RLS on, no policies, no browser grants. Only the
-- service role (used exclusively behind requirePlatformAdmin) can read them.

-- ------------------------------------------------- platform provider checks
create table if not exists public.platform_provider_checks (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  status text not null
    check (status in ('HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN')),
  -- Round-trip time of the probe request. Null when the provider was not
  -- configured, so it is excluded from percentile maths rather than counted
  -- as a zero.
  latency_ms integer,
  -- Short, non-sensitive: an HTTP status or a stable slug. Never a response
  -- body, never a header, never a credential.
  error_code text,
  checked_at timestamptz not null default now()
);

create index if not exists platform_provider_checks_provider_idx
  on public.platform_provider_checks (provider, checked_at desc);

create index if not exists platform_provider_checks_checked_idx
  on public.platform_provider_checks (checked_at desc);

-- ------------------------------------------------------------ error triage
create table if not exists public.platform_error_triage (
  -- The grouping key: a stable hash of area + normalised message + workspace,
  -- computed by the errors service. Matches Sentry's fingerprint concept so a
  -- future Sentry integration can key on the same value.
  fingerprint text primary key,
  business_id uuid references public.businesses(id) on delete set null,
  area text not null,
  severity text not null
    check (severity in ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  status text not null default 'OPEN'
    check (status in ('OPEN', 'INVESTIGATING', 'RESOLVED', 'IGNORED')),
  -- Operator-facing short reference (e.g. JOB-93014). Derived, stored so it
  -- stays stable if the derivation ever changes.
  reference text not null,
  -- Only set when a Sentry integration actually supplies one. Never invented.
  sentry_issue_url text,
  note text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_error_triage_status_idx
  on public.platform_error_triage (status, severity, updated_at desc);

create index if not exists platform_error_triage_business_idx
  on public.platform_error_triage (business_id);

create unique index if not exists platform_error_triage_reference_idx
  on public.platform_error_triage (reference);

create trigger platform_error_triage_set_updated_at
  before update on public.platform_error_triage
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------- rls
do $$
declare t text;
begin
  foreach t in array array[
    'platform_provider_checks', 'platform_error_triage'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- --------------------------------------------------- admin read paths
-- Every index below backs a query the Platform Administration area runs on
-- each render. None duplicates an existing index (see 0011 and 0023).

-- Overview signup counts and Customers default ordering.
create index if not exists businesses_created_idx
  on public.businesses (created_at desc);

create index if not exists businesses_status_idx
  on public.businesses (status);

-- Customers: resolving the owner of each workspace on the page.
create index if not exists business_members_business_role_idx
  on public.business_members (business_id, role) where status = 'active';

-- Customers filter chips and the Overview MRR mirror.
create index if not exists subscriptions_status_idx
  on public.subscriptions (status);

-- System → Health: integration roll-up and the degraded-workspaces table.
create index if not exists integrations_status_idx
  on public.integrations (status);

-- System → Events: the operational feed, filtered by provider/status and
-- always ordered by arrival time.
create index if not exists webhook_events_status_received_idx
  on public.webhook_events (status, received_at desc);

create index if not exists webhook_events_provider_received_idx
  on public.webhook_events (provider, received_at desc);

-- System → Health and Overview: failed-job counts and the queue table.
create index if not exists jobs_state_created_idx
  on public.jobs (state, created_at desc);

create index if not exists jobs_type_state_idx
  on public.jobs (type, state);

-- System → Events and Errors: outbound delivery failures across tenants.
create index if not exists messages_status_created_idx
  on public.messages (status, created_at desc);

-- Overview daily series (leads/bookings processed per bucket).
create index if not exists leads_created_idx
  on public.leads (created_at desc) where is_test = false;

create index if not exists bookings_created_idx
  on public.bookings (created_at desc);

-- ------------------------------------------------------- overview series
-- The Overview sparklines need per-bucket counts across five tables. Doing
-- that in the application means either one COUNT per bucket (120 round trips)
-- or streaming every row to Node (hundreds of thousands on a 90-day window).
-- One bucketed aggregate answers all of it in a single query.
--
-- SECURITY INVOKER: the service role bypasses RLS, and browser roles are
-- revoked below, so this never widens what a tenant session can read.
create or replace function public.admin_event_series(
  p_start timestamptz,
  p_end timestamptz,
  p_buckets integer
)
returns table (metric text, bucket integer, event_count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with sources as (
    select 'signups'::text as metric, b.created_at as at
      from public.businesses b
      where b.created_at >= p_start and b.created_at < p_end
    union all
    select 'leads', l.created_at
      from public.leads l
      where l.is_test = false
        and l.created_at >= p_start and l.created_at < p_end
    union all
    select 'messages', m.created_at
      from public.messages m
      where m.created_at >= p_start and m.created_at < p_end
    union all
    select 'bookings', bk.created_at
      from public.bookings bk
      where bk.created_at >= p_start and bk.created_at < p_end
    union all
    select 'failed_jobs', j.created_at
      from public.jobs j
      where j.state in ('failed', 'dead')
        and j.created_at >= p_start and j.created_at < p_end
  )
  select
    s.metric,
    least(
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
    )::integer as bucket,
    count(*) as event_count
  from sources s
  group by 1, 2;
$$;

revoke all on function public.admin_event_series(timestamptz, timestamptz, integer)
  from anon, authenticated;
