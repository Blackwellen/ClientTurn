-- 0041_find_leads_workspace: the pieces the Find Leads workspace needs that
-- 0025-0027 did not model — the customer-visible 12-stage run trail, resumable
-- run checkpoints, and the website-analysis job that populates the acquisition
-- profile.
--
-- Nothing here changes the Prospect/Lead boundary or the budget authority
-- established in 0027. It adds the observable surface around them: a run must
-- be explainable to the person who paid for it, and resumable by a worker that
-- restarted mid-flight.

-- --------------------------------------------------------- sourcing_runs (+)
alter table public.sourcing_runs
  add column if not exists title text,
  -- Percent is stored rather than derived so the run page and the Discover
  -- rail agree without either re-deriving stage weights.
  add column if not exists progress_percent integer not null default 0,
  add column if not exists paused_at timestamptz,
  add column if not exists stopped_at timestamptz,
  add column if not exists paused_reason text,
  -- Resume point. A worker that dies mid-stage restarts from here, never from
  -- stage 1, so a crash cannot re-spend budget that has already been spent.
  add column if not exists checkpoint_json jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sourcing_runs_progress_range'
  ) then
    alter table public.sourcing_runs
      add constraint sourcing_runs_progress_range
      check (progress_percent between 0 and 100);
  end if;
end $$;

-- --------------------------------------------------- sourcing_run_stages
-- Exactly twelve rows per run: the canonical stage list the customer sees.
-- The internal provider waterfall is more granular than this, deliberately —
-- V4 90 keeps raw provider queries out of the customer view, and this table
-- is the sanctioned summary.
create table if not exists public.sourcing_run_stages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  run_id uuid not null references public.sourcing_runs(id) on delete cascade,
  stage_number integer not null check (stage_number between 1 and 12),
  stage_key text not null
    check (stage_key in ('UNDERSTANDING_TARGET','PLANNING_SEARCH','FINDING_COMPANIES','FINDING_CONTACTS',
                         'PRE_FILTERING','ENRICHING','VERIFYING','DEDUPLICATING','CLASSIFYING',
                         'SCORING','INTENT_MATCHING','PREPARING_OUTREACH')),
  status text not null default 'PENDING'
    check (status in ('PENDING','RUNNING','COMPLETED','SKIPPED','FAILED','PAUSED')),
  -- User-facing sentence only. Never a provider query, parameter or credential.
  safe_summary text,
  record_count integer not null default 0,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  created_at timestamptz not null default now(),
  unique (run_id, stage_number)
);

create index if not exists sourcing_run_stages_run_idx
  on public.sourcing_run_stages (business_id, run_id, stage_number);

-- ------------------------------------------------------ search_sessions (+)
alter table public.search_sessions
  -- Denormalised so the sessions rail renders without aggregating every run.
  -- Maintained by the run worker on completion; never written from the browser.
  add column if not exists prospects_found integer not null default 0,
  add column if not exists last_run_id uuid references public.sourcing_runs(id) on delete set null;

-- ------------------------------------------------- business_analysis_jobs
-- The controlled crawl behind "Analyse business". One row per request, so a
-- customer can see progress and a failure is recoverable rather than silent.
create table if not exists public.business_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  website_url text not null,
  status text not null default 'QUEUED'
    check (status in ('QUEUED','FETCHING','EXTRACTING','REVIEW','READY','PARTIAL','FAILED','CANCELLED')),
  pages_targeted integer not null default 0,
  pages_analysed integer not null default 0,
  facts_found integer not null default 0,
  verification_state text not null default 'UNVERIFIED'
    check (verification_state in ('UNVERIFIED','PARTIALLY_VERIFIED','VERIFIED')),
  error_code text,
  error_message text,
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists business_analysis_jobs_set_updated_at on public.business_analysis_jobs;
create trigger business_analysis_jobs_set_updated_at
  before update on public.business_analysis_jobs
  for each row execute function public.set_updated_at();

create index if not exists business_analysis_jobs_business_idx
  on public.business_analysis_jobs (business_id, created_at desc);

-- Only one analysis may be in flight per workspace: a customer clicking the
-- button twice must not double-crawl.
create unique index if not exists business_analysis_jobs_active_idx
  on public.business_analysis_jobs (business_id)
  where status in ('QUEUED','FETCHING','EXTRACTING');

-- ------------------------------------------------ business_analysis_facts
-- Candidate facts, pending human review. They become business_memory_facts
-- only when the customer accepts them — an AI reading of a website is a
-- proposal, not a fact about someone's business.
create table if not exists public.business_analysis_facts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  analysis_id uuid not null references public.business_analysis_jobs(id) on delete cascade,
  category text not null
    check (category in ('BUSINESS_TYPE','SERVICES','TERRITORIES','TARGET_CUSTOMERS',
                        'PRICE_BAND','SALES_MODEL','CONTACT','PROOF_POINT','VALUE_PROPOSITION')),
  value_json jsonb not null default '{}'::jsonb,
  source_url text,
  confidence numeric(5,4) not null default 0
    check (confidence >= 0 and confidence <= 1),
  verification_state text not null default 'UNVERIFIED'
    check (verification_state in ('UNVERIFIED','PARTIALLY_VERIFIED','VERIFIED')),
  accepted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists business_analysis_facts_analysis_idx
  on public.business_analysis_facts (business_id, analysis_id, category);

-- ------------------------------------------------------------------- RLS
-- Same model as 0036: members read, nobody writes from the browser. Every
-- mutation goes through a server action that checks the role and writes with
-- the service role scoped to the caller's own business_id.
do $$
declare t text;
begin
  foreach t in array array[
    'sourcing_run_stages','business_analysis_jobs','business_analysis_facts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_select_member'
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.is_business_member(business_id))',
        t || '_select_member', t);
    end if;
  end loop;
end $$;

-- --------------------------------------------------------------- indexes
create index if not exists prospects_run_status_idx
  on public.prospects (business_id, source_run_id, status)
  where source_run_id is not null;

create index if not exists sourcing_run_issues_open_idx
  on public.sourcing_run_issues (business_id, run_id, created_at desc)
  where resolved_at is null;
