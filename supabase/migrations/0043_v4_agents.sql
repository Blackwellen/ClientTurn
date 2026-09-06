-- 0043_v4_agents: customer-facing Agents.
--
-- NAMING. There are now two "agent" concepts and they must not be confused:
--
--   * `agent_runs` / `agent_tool_calls` / `agent_budgets` (0032) are the
--     INTERNAL ledger of bounded LLM executions. A customer never sees them.
--   * `agents` (this file) is the CUSTOMER-FACING object: a configured
--     background worker with a name, a type, sources, a schedule and a queue.
--     One agent may cause many agent_runs.
--
-- An Agent is the thing a customer switches on and leaves running. It owns the
-- targeting, the permitted sources, the enrichment settings and the safety
-- envelope; the existing sourcing/outreach engines do the work underneath.
--
-- Everything an agent produces is a Prospect. Crossing into `leads` remains
-- LeadPromotionService's job, gated on engagement and contactability — an agent
-- with `auto_promote_to_leads` still cannot promote a record the policy engine
-- has not cleared.

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  agent_type text not null
    check (agent_type in ('SOURCING','BOOKING','REENGAGEMENT','COMBINED')),
  status text not null default 'DRAFT'
    check (status in ('DRAFT','ACTIVE','PAUSED','STOPPED','NEEDS_ATTENTION','ERROR')),
  status_reason text,

  -- Targeting. A sourcing agent without an ICP is not runnable, which the
  -- wizard enforces before it will let the agent leave DRAFT.
  icp_profile_id uuid references public.icp_profiles(id) on delete set null,
  conversion_goal_id uuid references public.conversion_goals(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  search_strategy_id uuid references public.search_strategies(id) on delete set null,
  campaign_id uuid references public.outreach_campaigns(id) on delete set null,

  -- Enrichment. Each is a separate switch because they carry different
  -- obligations: a discovered work email and a discovered mobile number are not
  -- equivalent under UK/EU rules, and finding a number never implies consent to
  -- ring or text it. ChannelPolicyService still gates every send.
  enrich_email boolean not null default true,
  enrich_phone boolean not null default false,
  verify_email boolean not null default true,

  -- Autonomy. AUTO never means "unsupervised": it means the agent may act
  -- without a per-record click, still inside policy, budget and caps.
  autonomy text not null default 'REVIEW_ALL'
    check (autonomy in ('REVIEW_ALL','REVIEW_NEW','AUTO')),
  auto_promote_to_leads boolean not null default false,
  minimum_grade text not null default 'B'
    check (minimum_grade in ('A+','A','B','C','D')),

  -- Schedule.
  cadence text not null default 'MANUAL'
    check (cadence in ('MANUAL','HOURLY','DAILY','WEEKLY')),
  run_window_start time not null default '08:00',
  run_window_end time not null default '20:00',
  timezone text,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_status text,

  -- Safety envelope. Ceilings the agent can never raise for itself.
  daily_prospect_cap integer not null default 50,
  monthly_prospect_cap integer not null default 500,
  max_cost_per_run_minor bigint not null default 0,

  -- Denormalised counters so the card grid never aggregates on render.
  total_prospects integer not null default 0,
  total_leads integer not null default 0,
  total_conversions integer not null default 0,
  pending_review_count integer not null default 0,

  created_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger agents_set_updated_at
  before update on public.agents
  for each row execute function public.set_updated_at();

create index agents_business_idx on public.agents (business_id, status, agent_type);
create index agents_due_idx on public.agents (status, next_run_at)
  where status = 'ACTIVE' and cadence <> 'MANUAL';
create index agents_updated_idx on public.agents (business_id, updated_at desc);

-- ------------------------------------------------------------ agent_sources
-- Per-agent, per-source configuration and health. A row exists for every source
-- the agent could use, enabled or not, so the Sources tab can explain WHY a
-- source is unavailable rather than silently omitting it.
--
-- `source_key` deliberately names permitted, official routes only. There is no
-- key for scraping a social network: V4 §113/§114 forbid it, and a source that
-- cannot be obtained within a platform's terms does not get an adapter.
create table public.agent_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  source_key text not null
    check (source_key in (
      'GOOGLE_PLACES',      -- Places API: local business discovery
      'GOOGLE_SEARCH',      -- Programmable Search: permitted public pages
      'COMPANY_REGISTRY',   -- Companies House and equivalents
      'WEBSITE',            -- the company's own site, fetched politely
      'META_LEAD_ADS',      -- inbound leads from the workspace's own ad account
      'LINKEDIN_ADS',       -- inbound leads from the workspace's own ad account
      'DATA_PROVIDER',      -- licensed B2B contact data
      'CUSTOMER_IMPORT',    -- the customer's own list
      'CRM_SYNC'            -- a connected CRM
    )),
  enabled boolean not null default false,
  config_json jsonb not null default '{}'::jsonb,
  status text not null default 'REQUIRES_SETUP'
    check (status in ('AVAILABLE','REQUIRES_SETUP','UNAVAILABLE','ERROR','RATE_LIMITED')),
  status_detail text,
  last_run_at timestamptz,
  prospects_found integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, source_key)
);

create trigger agent_sources_set_updated_at
  before update on public.agent_sources
  for each row execute function public.set_updated_at();

create index agent_sources_agent_idx on public.agent_sources (business_id, agent_id);

-- ------------------------------------------------------- agent_queue_items
-- The Queue tab. Work the agent has lined up, is doing, or is blocked on.
-- Blocked items are the important ones: they are how an agent asks for a human
-- rather than failing quietly or proceeding without permission.
create table public.agent_queue_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  item_type text not null
    check (item_type in ('DISCOVER','ENRICH_EMAIL','ENRICH_PHONE','VERIFY','REVIEW',
                         'PROMOTE','OUTREACH','BOOKING','REENGAGE')),
  status text not null default 'PENDING'
    check (status in ('PENDING','IN_PROGRESS','DONE','FAILED','BLOCKED','CANCELLED','SKIPPED')),
  subject_type text
    check (subject_type is null or subject_type in ('PROSPECT','LEAD','COMPANY','CAMPAIGN')),
  subject_id uuid,
  subject_label text,
  priority integer not null default 100,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  -- Why a human is needed. Rendered verbatim in the Queue tab.
  blocked_reason text,
  error_message text,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index agent_queue_agent_idx
  on public.agent_queue_items (business_id, agent_id, status, priority);
create index agent_queue_due_idx
  on public.agent_queue_items (status, scheduled_for)
  where status = 'PENDING';
create index agent_queue_blocked_idx
  on public.agent_queue_items (business_id, agent_id)
  where status = 'BLOCKED';

-- --------------------------------------------------- agent_activity_events
-- Append-only. The Activity tab reads this directly, so an agent's history is
-- what it actually did rather than a reconstruction from current state.
create table public.agent_activity_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  event_type text not null,
  severity text not null default 'INFO'
    check (severity in ('INFO','SUCCESS','WARNING','ERROR')),
  title text not null,
  detail text,
  subject_type text,
  subject_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index agent_activity_agent_idx
  on public.agent_activity_events (business_id, agent_id, created_at desc);
create index agent_activity_severity_idx
  on public.agent_activity_events (business_id, agent_id, severity, created_at desc)
  where severity in ('WARNING','ERROR');

-- ------------------------------------------------------------- attribution
-- Which agent produced a record. Nullable everywhere: the overwhelming majority
-- of leads still arrive without an agent involved.
alter table public.sourcing_runs
  add column if not exists agent_id uuid references public.agents(id) on delete set null;
alter table public.prospects
  add column if not exists agent_id uuid references public.agents(id) on delete set null;
alter table public.leads
  add column if not exists agent_id uuid references public.agents(id) on delete set null;

create index if not exists sourcing_runs_agent_idx
  on public.sourcing_runs (business_id, agent_id)
  where agent_id is not null;
create index if not exists prospects_agent_idx
  on public.prospects (business_id, agent_id)
  where agent_id is not null;
create index if not exists leads_agent_idx
  on public.leads (business_id, agent_id)
  where agent_id is not null;

-- ------------------------------------------------------------------- RLS
alter table public.agents enable row level security;
alter table public.agents force row level security;
alter table public.agent_sources enable row level security;
alter table public.agent_sources force row level security;
alter table public.agent_queue_items enable row level security;
alter table public.agent_queue_items force row level security;
alter table public.agent_activity_events enable row level security;
alter table public.agent_activity_events force row level security;

-- Members read; every write goes through a server action that checks the role
-- and then writes with the service role, as everywhere else in this codebase.
do $$
declare t text;
begin
  foreach t in array array[
    'agents','agent_sources','agent_queue_items','agent_activity_events'
  ] loop
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_business_member(business_id))',
      t || '_select_member', t);
  end loop;
end $$;

-- `max_cost_per_run_minor` is provider spend and stays admin-only, so `agents`
-- gets a column grant rather than a table grant (see 0041 for why a
-- table-level grant plus a column revoke does nothing).
do $$
declare allowed text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into allowed
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'agents'
     and column_name <> 'max_cost_per_run_minor';

  execute format('grant select (%s) on public.agents to authenticated', allowed);
end $$;

grant select on public.agent_sources to authenticated;
grant select on public.agent_queue_items to authenticated;
grant select on public.agent_activity_events to authenticated;

-- ------------------------------------------------------------ agent summary
-- One round trip for the card grid's live numbers. `security invoker` keeps RLS
-- in force; the business_id argument is an extra filter, never the only guard.
create or replace function public.agent_summaries(p_business_id uuid)
returns table (
  agent_id uuid,
  queued integer,
  blocked integer,
  failed integer,
  prospects_7d integer,
  leads_7d integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    a.id,
    coalesce(q.queued, 0)::int,
    coalesce(q.blocked, 0)::int,
    coalesce(q.failed, 0)::int,
    coalesce(p.recent, 0)::int,
    coalesce(l.recent, 0)::int
  from public.agents a
  left join (
    select agent_id,
           count(*) filter (where status in ('PENDING','IN_PROGRESS')) as queued,
           count(*) filter (where status = 'BLOCKED') as blocked,
           count(*) filter (where status = 'FAILED') as failed
      from public.agent_queue_items
     where business_id = p_business_id
     group by agent_id
  ) q on q.agent_id = a.id
  left join (
    select agent_id, count(*) as recent
      from public.prospects
     where business_id = p_business_id
       and agent_id is not null
       and created_at > now() - interval '7 days'
     group by agent_id
  ) p on p.agent_id = a.id
  left join (
    select agent_id, count(*) as recent
      from public.leads
     where business_id = p_business_id
       and agent_id is not null
       and created_at > now() - interval '7 days'
     group by agent_id
  ) l on l.agent_id = a.id
  where a.business_id = p_business_id;
$$;

revoke all on function public.agent_summaries(uuid) from public, anon;
grant execute on function public.agent_summaries(uuid) to authenticated;
