-- 0027_v4_search_sourcing: conversational search planning and the budgeted
-- sourcing runs it authorises (V4 §10-11, §55, §76.5-76.8).
--
-- The hard rule this schema exists to enforce: a model suggestion is not
-- authority to spend. A search_strategy must reach status APPROVED (recorded
-- with who approved it and when) before a sourcing_run may call a paid
-- provider. Runs then carry their own budget envelope and reconcile spend as
-- they go, so a run can stop gracefully rather than overrunning.

-- --------------------------------------------------------- search_sessions
create table public.search_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  title text not null default 'New search',
  icp_profile_id uuid references public.icp_profiles(id) on delete set null,
  conversion_goal_id uuid references public.conversion_goals(id) on delete set null,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','ARCHIVED')),
  latest_strategy_id uuid,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger search_sessions_set_updated_at
  before update on public.search_sessions
  for each row execute function public.set_updated_at();

create index search_sessions_business_idx
  on public.search_sessions (business_id, status, updated_at desc);

-- --------------------------------------------------------- search_messages
create table public.search_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  session_id uuid not null references public.search_sessions(id) on delete cascade,
  role text not null
    check (role in ('USER','ASSISTANT','SYSTEM_EVENT')),
  content text not null,
  structured_data jsonb,
  agent_run_id uuid,
  created_at timestamptz not null default now()
);

create index search_messages_session_idx
  on public.search_messages (business_id, session_id, created_at);

-- ------------------------------------------------------- search_strategies
-- The structured plan the customer actually sees and edits. `strategy_json` is
-- validated against the Zod schema in lib/search-sessions/schema.ts before it
-- is written, so no unvalidated model output reaches the orchestrator.
create table public.search_strategies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  session_id uuid not null references public.search_sessions(id) on delete cascade,
  version integer not null default 1,
  strategy_json jsonb not null default '{}'::jsonb,
  estimated_cost_minor bigint not null default 0,
  estimated_provider_calls jsonb not null default '{}'::jsonb,
  estimated_cost_band text not null default 'WITHIN_PLAN'
    check (estimated_cost_band in ('WITHIN_PLAN','NEAR_LIMIT','EXCEEDS_PLAN','REQUIRES_OVERAGE')),
  status text not null default 'DRAFT'
    check (status in ('DRAFT','APPROVED','ARCHIVED','SUPERSEDED')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  agent_run_id uuid,
  created_at timestamptz not null default now(),
  unique (session_id, version)
);

create index search_strategies_session_idx
  on public.search_strategies (business_id, session_id, version desc);

alter table public.search_sessions
  add constraint search_sessions_latest_strategy_fk
  foreign key (latest_strategy_id) references public.search_strategies(id) on delete set null;

-- ------------------------------------------------- search_strategy_versions
-- Immutable diff trail: what changed between two plan versions and who caused
-- it (the user editing, or the Search Agent responding to a message).
create table public.search_strategy_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  strategy_id uuid not null references public.search_strategies(id) on delete cascade,
  version integer not null,
  changed_by text not null default 'USER'
    check (changed_by in ('USER','SEARCH_AGENT','OPTIMIZATION')),
  changed_by_user_id uuid references auth.users(id) on delete set null,
  diff_json jsonb not null default '{}'::jsonb,
  snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index search_strategy_versions_strategy_idx
  on public.search_strategy_versions (business_id, strategy_id, version desc);

-- ---------------------------------------------------------- search_feedback
create table public.search_feedback (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  session_id uuid references public.search_sessions(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete cascade,
  verdict text not null
    check (verdict in ('GOOD_FIT','POOR_FIT','WRONG_ROLE','WRONG_LOCATION','WRONG_INDUSTRY','ALREADY_CUSTOMER','OTHER')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index search_feedback_session_idx
  on public.search_feedback (business_id, session_id, created_at desc);

-- ----------------------------------------------------------- sourcing_runs
create table public.sourcing_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  search_strategy_id uuid references public.search_strategies(id) on delete set null,
  session_id uuid references public.search_sessions(id) on delete set null,
  campaign_id uuid,
  started_by uuid references auth.users(id) on delete set null,
  trigger_source text not null default 'MANUAL'
    check (trigger_source in ('MANUAL','RECURRING','CAMPAIGN','COPILOT','MCP')),
  status text not null default 'QUEUED'
    check (status in ('QUEUED','RUNNING','PAUSED','COMPLETED','PARTIAL','CANCELLED','FAILED')),
  budget_state text not null default 'WITHIN_BUDGET'
    check (budget_state in ('WITHIN_BUDGET','NEAR_LIMIT','BUDGET_LIMIT_REACHED','PLAN_LIMIT_REACHED','PROVIDER_LIMIT_REACHED')),
  current_stage text not null default 'UNDERSTANDING_TARGET'
    check (current_stage in ('UNDERSTANDING_TARGET','PLANNING_SEARCH','FINDING_COMPANIES','FINDING_CONTACTS',
                             'PRE_FILTERING','ENRICHING','VERIFYING','DEDUPLICATING','CLASSIFYING',
                             'SCORING','INTENT_MATCHING','PREPARING_OUTREACH','DONE')),
  target_verified integer not null default 0,
  minimum_grade text not null default 'B'
    check (minimum_grade in ('A+','A','B','C','D')),
  review_before_outreach boolean not null default true,
  -- Budget envelope, all authoritative server-side. `spent_cost_minor` is
  -- reconciled from cost_events rather than trusted from the worker's tally.
  max_total_cost_minor bigint not null default 0,
  max_provider_cost_minor bigint not null default 0,
  spent_cost_minor bigint not null default 0,
  limits_json jsonb not null default '{}'::jsonb,
  counts_json jsonb not null default '{}'::jsonb,
  deadline_at timestamptz,
  cancel_requested boolean not null default false,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sourcing_runs_set_updated_at
  before update on public.sourcing_runs
  for each row execute function public.set_updated_at();

create index sourcing_runs_business_idx
  on public.sourcing_runs (business_id, status, created_at desc);
create index sourcing_runs_stage_idx
  on public.sourcing_runs (business_id, current_stage)
  where status in ('QUEUED','RUNNING','PAUSED');

alter table public.prospects
  add constraint prospects_source_run_fk
  foreign key (source_run_id) references public.sourcing_runs(id) on delete set null;

-- --------------------------------------------------- sourcing_run_queries
-- One row per provider call the run planned or made. This is what makes the
-- provider waterfall auditable and what the cost reconciliation joins against.
create table public.sourcing_run_queries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  run_id uuid not null references public.sourcing_runs(id) on delete cascade,
  stage text not null,
  provider text not null,
  capability text not null
    check (capability in ('COMPANY_SEARCH','CONTACT_DISCOVERY','COMPANY_ENRICHMENT',
                          'CONTACT_ENRICHMENT','EMAIL_VERIFICATION','INTENT','WEBSITE_INTELLIGENCE')),
  request_json jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING','SUCCESS','EMPTY','FAILED','SKIPPED','RATE_LIMITED')),
  result_count integer not null default 0,
  cost_minor bigint not null default 0,
  latency_ms integer,
  error_code text,
  -- Stable key so a retried worker cannot double-charge the same provider call.
  idempotency_key text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index sourcing_run_queries_idem_idx
  on public.sourcing_run_queries (run_id, idempotency_key)
  where idempotency_key is not null;

create index sourcing_run_queries_run_idx
  on public.sourcing_run_queries (business_id, run_id, created_at);

-- ---------------------------------------------------- sourcing_run_results
-- Per-candidate outcome, including the ones that were rejected. Keeping the
-- rejects is what lets the run breakdown explain where the funnel lost volume
-- without re-running any provider work.
create table public.sourcing_run_results (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  run_id uuid not null references public.sourcing_runs(id) on delete cascade,
  company_id uuid references public.prospect_companies(id) on delete set null,
  prospect_id uuid references public.prospects(id) on delete set null,
  candidate_name text,
  candidate_domain text,
  outcome text not null
    check (outcome in ('COMPANY_FOUND','CONTACT_FOUND','EMAIL_FOUND','VERIFIED','READY',
                       'DUPLICATE','SUPPRESSED','REVIEW_REQUIRED','REJECTED_FIT',
                       'REJECTED_GEOGRAPHY','REJECTED_ROLE','REJECTED_VERIFICATION','ERROR')),
  reason text,
  score numeric(6,2),
  grade text,
  cost_minor bigint not null default 0,
  created_at timestamptz not null default now()
);

create index sourcing_run_results_run_idx
  on public.sourcing_run_results (business_id, run_id, outcome);

-- ----------------------------------------------------- sourcing_run_issues
create table public.sourcing_run_issues (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  run_id uuid not null references public.sourcing_runs(id) on delete cascade,
  severity text not null default 'WARNING'
    check (severity in ('INFO','WARNING','ERROR')),
  code text not null,
  message text not null,
  detail_json jsonb not null default '{}'::jsonb,
  requires_user_action boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index sourcing_run_issues_run_idx
  on public.sourcing_run_issues (business_id, run_id, severity);

-- ------------------------------------------------------- recurring_searches
-- A previously-approved plan may re-run on a schedule without asking again,
-- but only while its bounds are unchanged: any edit resets approval.
create table public.recurring_searches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  session_id uuid references public.search_sessions(id) on delete set null,
  search_strategy_id uuid not null references public.search_strategies(id) on delete cascade,
  campaign_id uuid,
  cadence text not null default 'WEEKLY'
    check (cadence in ('DAILY','WEEKLY','FORTNIGHTLY','MONTHLY')),
  target_per_run integer not null default 0,
  max_cost_per_run_minor bigint not null default 0,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','PAUSED','STOPPED')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger recurring_searches_set_updated_at
  before update on public.recurring_searches
  for each row execute function public.set_updated_at();

create index recurring_searches_due_idx
  on public.recurring_searches (status, next_run_at)
  where status = 'ACTIVE';
