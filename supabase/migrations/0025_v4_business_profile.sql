-- 0025_v4_business_profile: what ClientTurn knows about the customer's own
-- business, and the targeting/conversion definitions derived from it.
--
-- V4 §26, §54, §76.1-76.4. This is the "Learn" layer's system of record. It is
-- deliberately inspectable and editable by the customer: no hidden LLM memory
-- decides who gets contacted or what gets claimed on the business's behalf.

-- ------------------------------------------------------- business_profiles
create table public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  website_url text,
  business_type text,
  sales_model text
    check (sales_model is null or sales_model in ('SERVICE','SAAS','ECOMMERCE','MARKETPLACE','AGENCY','OTHER')),
  summary text,
  profile_version integer not null default 1,
  analysis_status text not null default 'NOT_STARTED'
    check (analysis_status in ('NOT_STARTED','QUEUED','RUNNING','READY','PARTIAL','FAILED')),
  analysis_error text,
  pages_analysed integer not null default 0,
  last_analysed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger business_profiles_set_updated_at
  before update on public.business_profiles
  for each row execute function public.set_updated_at();

-- --------------------------------------------------- business_memory_facts
-- One row per semantic fact. `locked` is the customer's veto: optimization and
-- agents may propose but never overwrite a fact the customer has pinned.
create table public.business_memory_facts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  fact_key text not null,
  value_json jsonb not null default '{}'::jsonb,
  source_type text not null default 'USER'
    check (source_type in ('USER','WEBSITE','INTEGRATION','PERFORMANCE','AI')),
  source_id text,
  confidence numeric(5,4) not null default 1.0
    check (confidence >= 0 and confidence <= 1),
  verified_by_user boolean not null default false,
  locked boolean not null default false,
  valid_from timestamptz,
  valid_to timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, fact_key)
);

create trigger business_memory_facts_set_updated_at
  before update on public.business_memory_facts
  for each row execute function public.set_updated_at();

-- ----------------------------------------------- business_knowledge_sources
create table public.business_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  source_type text not null default 'WEBSITE_PAGE'
    check (source_type in ('WEBSITE_PAGE','DOCUMENT','INTEGRATION','MANUAL_NOTE')),
  label text not null,
  url text,
  content_hash text,
  extract_summary text,
  status text not null default 'PENDING'
    check (status in ('PENDING','FETCHING','READY','FAILED','EXCLUDED')),
  error_message text,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger business_knowledge_sources_set_updated_at
  before update on public.business_knowledge_sources
  for each row execute function public.set_updated_at();

-- ------------------------------------------------ business_learning_events
-- Append-only trail of what the Learn layer concluded and why. Every derived
-- learning records its sample size so a two-lead "insight" cannot masquerade
-- as a finding.
create table public.business_learning_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  learning_type text not null
    check (learning_type in ('ICP_HYPOTHESIS','PERFORMANCE','NEGATIVE','MESSAGE','TIMING','CHANNEL','SOURCE')),
  subject_type text,
  subject_id uuid,
  title text not null,
  detail text,
  evidence_json jsonb not null default '{}'::jsonb,
  sample_size integer not null default 0,
  confidence numeric(5,4) not null default 0
    check (confidence >= 0 and confidence <= 1),
  applied boolean not null default false,
  applied_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------ business_playbooks
-- Reusable outreach guidance: tone, value propositions, approved proof points
-- and the claims the business must never make.
create table public.business_playbooks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  tone text,
  value_propositions jsonb not null default '[]'::jsonb,
  proof_points jsonb not null default '[]'::jsonb,
  prohibited_claims jsonb not null default '[]'::jsonb,
  notes text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger business_playbooks_set_updated_at
  before update on public.business_playbooks
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ icp_profiles
create table public.icp_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  industries jsonb not null default '[]'::jsonb,
  company_filters jsonb not null default '{}'::jsonb,
  locations jsonb not null default '[]'::jsonb,
  roles jsonb not null default '[]'::jsonb,
  exclusions jsonb not null default '{}'::jsonb,
  default_intent_category_ids uuid[] not null default '{}'::uuid[],
  source text not null default 'USER'
    check (source in ('USER','AI_PROPOSED','PERFORMANCE')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger icp_profiles_set_updated_at
  before update on public.icp_profiles
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ icp_segments
create table public.icp_segments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  icp_profile_id uuid not null references public.icp_profiles(id) on delete cascade,
  name text not null,
  criteria_json jsonb not null default '{}'::jsonb,
  priority integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------- conversion_goals
-- The destination a lead or prospect is being driven toward. `destination_config`
-- can carry provider references, so it is never exposed to the browser wholesale.
create table public.conversion_goals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  type text not null
    check (type in ('BOOK_APPOINTMENT','BOOK_SITE_VISIT','BOOK_DEMO','REQUEST_QUOTE',
                    'PHONE_CALL','DIRECT_SIGNUP','DIRECT_PURCHASE','HUMAN_HANDOVER','CUSTOM')),
  service_scope jsonb not null default '{"mode":"ALL"}'::jsonb,
  destination_type text not null default 'URL'
    check (destination_type in ('CALENDLY','GOOGLE_CALENDAR','URL','WEBHOOK','PHONE','TEAM_HANDOVER')),
  destination_config jsonb not null default '{}'::jsonb,
  success_event text not null default 'conversion.goal_reached',
  qualification_required boolean not null default true,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger conversion_goals_set_updated_at
  before update on public.conversion_goals
  for each row execute function public.set_updated_at();

-- Exactly one default goal, and one default playbook, per workspace.
create unique index conversion_goals_default_idx
  on public.conversion_goals (business_id)
  where is_default;

create unique index business_playbooks_default_idx
  on public.business_playbooks (business_id)
  where is_default;

create index business_memory_facts_business_idx
  on public.business_memory_facts (business_id, source_type);
create index business_knowledge_sources_business_idx
  on public.business_knowledge_sources (business_id, status);
create index business_learning_events_business_idx
  on public.business_learning_events (business_id, learning_type, created_at desc);
create index icp_profiles_business_idx on public.icp_profiles (business_id, active);
create index icp_segments_profile_idx on public.icp_segments (business_id, icp_profile_id);
create index conversion_goals_business_idx on public.conversion_goals (business_id, active);
