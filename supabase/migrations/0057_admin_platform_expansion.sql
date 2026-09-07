-- 0057_admin_platform_expansion: the state the Platform Administration
-- expansion (V4 §36-§47) genuinely needs and that nothing already records.
--
-- Everything derivable is still derived. Jobs, compliance policy versions,
-- suppression, privacy notices, subscriptions, entitlement grants, cost events
-- and the affiliate ledger all already exist; the admin services read those
-- rather than shadowing them. What is added here is only what has no home:
--
--   1. job cancellation -- the queue could fail and retry a job but had no way
--      to record that an operator asked for it to stop;
--   2. a provider registry -- provider priority, failover order, country
--      availability, unit-cost estimates, hard cost ceilings and rate limits
--      were constants in code, so they could not be changed or audited;
--   3. platform settings + their change log -- AI routing, agent budgets,
--      outreach caps and compliance switches, versioned rather than mutated;
--   4. feature flags;
--   5. an internal account-credit ledger -- Stripe holds the balance, this
--      holds *why*, immutably;
--   6. a data-subject request queue -- privacy_notice_events records notices
--      that were delivered, not requests that must be answered.
--
-- All six are server-only: RLS enabled, no policies, no browser grants. Only
-- the service role, used exclusively behind requirePlatformAdmin(), reads them.

-- ------------------------------------------------------------ job lifecycle
-- A running job holds an external side effect the platform cannot recall, so
-- cancellation is a *request* the worker honours at its next safe point. The
-- column names say so: `cancel_requested_at` is what the operator did,
-- `cancelled_at` is what the worker confirmed.
alter table public.jobs
  drop constraint if exists jobs_state_check;

alter table public.jobs
  add constraint jobs_state_check
  check (state in ('pending', 'running', 'completed', 'failed', 'dead', 'cancelled'));

alter table public.jobs
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  -- Set when an operator re-queues a dead job. Keeps the original row intact
  -- so the failure history is never rewritten by the retry.
  add column if not exists retried_from_job_id uuid references public.jobs(id) on delete set null;

create index if not exists jobs_business_state_idx
  on public.jobs (business_id, state, created_at desc)
  where business_id is not null;

create index if not exists jobs_dead_idx
  on public.jobs (type, created_at desc)
  where state = 'dead';

create index if not exists jobs_cancel_requested_idx
  on public.jobs (cancel_requested_at)
  where cancel_requested_at is not null and cancelled_at is null;

-- -------------------------------------------------------- provider registry
-- One row per configured provider. `priority` orders the waterfall within a
-- capability; `failover_order` is the position a provider takes when the
-- preferred one is unavailable. Credentials are never stored here -- only the
-- *name* of the environment variable or vault entry that holds them.
create table if not exists public.platform_providers (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique,
  label text not null,
  provider_type text not null
    check (provider_type in (
      'ENRICHMENT','PROSPECT_SEARCH','EMAIL_VERIFICATION','AI_MODEL','MESSAGING',
      'SOCIAL','EMAIL_INFRA','CRM','CALENDAR','DATABASE','PAYMENTS','OTHER'
    )),
  enabled boolean not null default true,
  priority integer not null default 1 check (priority between 1 and 99),
  failover_order integer check (failover_order between 1 and 99),
  -- Empty array means global. A provider is never silently available in a
  -- country the policy engine has not cleared.
  country_codes text[] not null default '{}'::text[],
  capabilities text[] not null default '{}'::text[],
  currency text not null default 'USD',
  -- Internal estimate used for margin maths, not a price shown to anyone.
  unit_cost_estimate numeric(14,8),
  unit_basis text
    check (unit_basis in ('REQUEST','RECORD','THOUSAND','MESSAGE','SEGMENT','TOKEN','MINUTE')),
  -- Spend stops here. A ceiling of null means "no ceiling configured", which
  -- the settings surface reports as a risk rather than as unlimited headroom.
  hard_cost_ceiling numeric(14,8),
  rate_limit_per_minute integer check (rate_limit_per_minute > 0),
  rate_limit_per_hour integer check (rate_limit_per_hour > 0),
  rate_limit_per_day integer check (rate_limit_per_day > 0),
  max_concurrency integer check (max_concurrency > 0),
  -- Reference only: e.g. 'env:CLEARBIT_API_KEY'. Never a secret value.
  credential_ref text,
  credential_environment text not null default 'production',
  credential_rotated_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists platform_providers_set_updated_at on public.platform_providers;
create trigger platform_providers_set_updated_at
  before update on public.platform_providers
  for each row execute function public.set_updated_at();

create index if not exists platform_providers_type_idx
  on public.platform_providers (provider_type, priority);

-- -------------------------------------------------------- platform settings
-- Namespaced JSON documents: 'ai', 'outreach', 'compliance', 'economics'.
-- `version` increments on every write so a change can be pointed at.
create table if not exists public.platform_settings (
  namespace text primary key,
  value_json jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Append-only. A settings change is a platform-wide act and stays readable
-- after the value it produced has been superseded.
create table if not exists public.platform_setting_changes (
  id uuid primary key default gen_random_uuid(),
  namespace text not null,
  version integer not null,
  summary text not null,
  before_json jsonb,
  after_json jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists platform_setting_changes_idx
  on public.platform_setting_changes (created_at desc);

-- ------------------------------------------------------------ feature flags
create table if not exists public.platform_feature_flags (
  key text primary key,
  label text not null,
  description text,
  status text not null default 'DISABLED'
    check (status in ('ENABLED','BETA','DISABLED')),
  -- 0-100. Only consulted while status = 'BETA'.
  rollout_percent integer not null default 0
    check (rollout_percent between 0 and 100),
  -- Explicit allow-list of workspaces, applied regardless of rollout percent.
  business_ids uuid[] not null default '{}'::uuid[],
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------- credits ledger
-- Stripe holds the balance; this holds the reason, the operator and the
-- approval. Rows are never updated or deleted -- a mistake is corrected by
-- posting the opposite entry, which is why `reverses_entry_id` exists.
create table if not exists public.billing_credit_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  entry_type text not null
    check (entry_type in ('CREDIT','DEBIT','ADJUSTMENT','REVERSAL')),
  -- Minor units, always positive. `entry_type` carries the direction.
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'GBP',
  reason text not null,
  support_reference text,
  stripe_balance_transaction_id text unique,
  state text not null default 'APPLIED'
    check (state in ('PENDING','APPLIED','FAILED','REVERSED')),
  failure_reason text,
  reverses_entry_id uuid references public.billing_credit_entries(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists billing_credit_entries_business_idx
  on public.billing_credit_entries (business_id, created_at desc);

-- --------------------------------------------------------- privacy requests
-- Data-subject requests. Distinct from privacy_notice_events, which records
-- the notices the platform *sent*; this records what it has been *asked*.
create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  reference text unique,
  business_id uuid references public.businesses(id) on delete set null,
  request_type text not null
    check (request_type in ('EXPORT','DELETION','ACCESS','MARKETING_DATA')),
  subject_email citext,
  subject_name text,
  status text not null default 'PENDING'
    check (status in ('PENDING','IN_PROGRESS','COMPLETED','REJECTED')),
  -- Statutory clock. Set on receipt so an overdue request is visible.
  due_at timestamptz,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  resolution_note text,
  handled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create sequence if not exists public.privacy_request_reference_seq start 1000;

create or replace function public.set_privacy_request_reference()
returns trigger
language plpgsql
as $fn$
begin
  if new.reference is null then
    new.reference := 'DSR-' || nextval('public.privacy_request_reference_seq')::text;
  end if;
  return new;
end;
$fn$;

drop trigger if exists privacy_requests_set_reference on public.privacy_requests;
create trigger privacy_requests_set_reference
  before insert on public.privacy_requests
  for each row execute function public.set_privacy_request_reference();

create index if not exists privacy_requests_status_idx
  on public.privacy_requests (status, received_at desc);

-- ------------------------------------------------------------------- RLS
-- Server-only, exactly like platform_provider_checks in 0024: RLS on and no
-- policy at all, so the anon and authenticated roles can reach none of it and
-- only the service role -- always behind requirePlatformAdmin() -- can read.
alter table public.platform_providers enable row level security;
alter table public.platform_settings enable row level security;
alter table public.platform_setting_changes enable row level security;
alter table public.platform_feature_flags enable row level security;
alter table public.billing_credit_entries enable row level security;
alter table public.privacy_requests enable row level security;

revoke all on public.platform_providers from anon, authenticated;
revoke all on public.platform_settings from anon, authenticated;
revoke all on public.platform_setting_changes from anon, authenticated;
revoke all on public.platform_feature_flags from anon, authenticated;
revoke all on public.billing_credit_entries from anon, authenticated;
revoke all on public.privacy_requests from anon, authenticated;
