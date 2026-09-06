-- 0028_v4_intent: named buying-intent categories, the monitors that watch for
-- them, and the dated evidence they produce (V4 §15, §62, §76.13-76.15).
--
-- Intent is a bounded, deterministic score contribution with an expiry, not a
-- free-text vibe. A signal only influences a prospect's score while it is
-- fresh; once expires_at passes, prospect_intent_matches stops counting it and
-- the next rescore drops the contribution. Sources are provider-based and
-- provenance-aware — this is not a general web scraper.

-- ------------------------------------------------------- intent_categories
create table public.intent_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  signal_types jsonb not null default '[]'::jsonb,
  keywords_entities jsonb not null default '{}'::jsonb,
  freshness_days integer not null default 90
    check (freshness_days > 0 and freshness_days <= 730),
  -- Bounded by design: a single category can never dominate the canonical
  -- score, whatever the customer types in.
  score_impact numeric(5,2) not null default 10
    check (score_impact >= 0 and score_impact <= 25),
  icp_scope jsonb not null default '{"mode":"ALL"}'::jsonb,
  auto_add_to_search boolean not null default false,
  is_platform_template boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create trigger intent_categories_set_updated_at
  before update on public.intent_categories
  for each row execute function public.set_updated_at();

create index intent_categories_business_idx
  on public.intent_categories (business_id, active);

-- --------------------------------------------------------- intent_monitors
create table public.intent_monitors (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  intent_category_id uuid not null references public.intent_categories(id) on delete cascade,
  name text,
  monitor_type text not null default 'ICP'
    check (monitor_type in ('ICP','NAMED_COMPANIES','FIRST_PARTY')),
  target_json jsonb not null default '{}'::jsonb,
  cadence text not null default 'WEEKLY'
    check (cadence in ('DAILY','WEEKLY','FORTNIGHTLY','MONTHLY')),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','PAUSED','STOPPED','PLAN_LIMITED')),
  monthly_budget_minor bigint not null default 0,
  spent_this_period_minor bigint not null default 0,
  period_started_on date,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  events_last_period integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger intent_monitors_set_updated_at
  before update on public.intent_monitors
  for each row execute function public.set_updated_at();

create index intent_monitors_business_idx
  on public.intent_monitors (business_id, status);
create index intent_monitors_due_idx
  on public.intent_monitors (status, next_run_at)
  where status = 'ACTIVE';

-- ----------------------------------------------------------- intent_events
create table public.intent_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  intent_category_id uuid not null references public.intent_categories(id) on delete cascade,
  monitor_id uuid references public.intent_monitors(id) on delete set null,
  company_id uuid references public.prospect_companies(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  signal_type text not null,
  source text not null,
  source_url text,
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confidence numeric(5,4) not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  evidence_summary text,
  score_impact numeric(5,2) not null default 0,
  -- Collapses duplicate reports of the same underlying signal from different
  -- monitor runs or providers.
  dedupe_key text not null,
  agent_run_id uuid,
  cost_minor bigint not null default 0,
  created_at timestamptz not null default now()
);

create unique index intent_events_dedupe_idx
  on public.intent_events (business_id, intent_category_id, dedupe_key);

create index intent_events_category_idx
  on public.intent_events (business_id, intent_category_id, observed_at desc);
create index intent_events_company_idx
  on public.intent_events (business_id, company_id, expires_at)
  where company_id is not null;
create index intent_events_prospect_idx
  on public.intent_events (business_id, prospect_id, expires_at)
  where prospect_id is not null;
create index intent_events_live_idx
  on public.intent_events (business_id, expires_at);

-- -------------------------------------------------- prospect_intent_matches
-- Materialised link between a prospect and a live signal, so the Prospects
-- table can filter and sort on intent without scanning intent_events.
create table public.prospect_intent_matches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  intent_category_id uuid not null references public.intent_categories(id) on delete cascade,
  intent_event_id uuid not null references public.intent_events(id) on delete cascade,
  matched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  score_impact numeric(5,2) not null default 0,
  unique (prospect_id, intent_event_id)
);

create index prospect_intent_matches_prospect_idx
  on public.prospect_intent_matches (business_id, prospect_id, expires_at desc);
create index prospect_intent_matches_category_idx
  on public.prospect_intent_matches (business_id, intent_category_id, expires_at desc);
