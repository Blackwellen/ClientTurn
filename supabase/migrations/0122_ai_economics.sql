-- 0122_ai_economics: Phase 4 of the core revenue engine -- model tiers and
-- task routes in the database, lifecycle AI budgets, and an append-only log of
-- every spend decision.
--
-- Design: docs/revenue-engine/05-phases-3-6-design.md "Phase 4".
--
-- ## What decides a model call now
--
--   runTask(task)
--     -> checkSpend()            src/lib/ai/budget-service.ts (server)
--          reads ai_budgets + ai_spend_snapshot(), calls decideSpend() (pure,
--          src/lib/ai/budget.ts), writes one ai_budget_decisions row
--          SKIP | TIER_1..TIER_4 | HUMAN
--     -> reserve_ai_tokens()     0116: the token allowance admission, unchanged
--     -> provider call at the chosen tier's deployment
--
-- Every table here is optional at runtime: with no rows, tier-config.ts falls
-- back to the env-configured nano/mini mapping and decideSpend() to "use the
-- default tier", so an empty database behaves exactly as before this migration.
--
-- ## Prices
--
-- Stored in the currency the provider bills in (USD for Azure, matching
-- provider_price_book 0018). Budgets are in GBP minor units; the conversion is
-- one constant in budget.ts, so a price is never silently restated in a second
-- currency here.
--
-- ## Access
--
-- ai_model_tiers, ai_task_routes and ai_budget_decisions are operational
-- detail: RLS enabled and forced, everything revoked from anon/authenticated,
-- service role only. ai_budgets is shown to the workspace (its own ceilings and
-- the platform defaults that apply to it), so members may SELECT their own
-- rows and the platform-default rows (business_id is null). No write grant or
-- policy for anyone but the service role.

-- ------------------------------------------------------------ ai_model_tiers
-- Tier 0 is "no model": the deterministic path. Tiers 1-4 are cheap ->
-- highest. `deployment_alias` is the metering class (ai_runs.deployment and
-- the usage metrics only know nano/mini); `deployment_name` optionally names
-- the provider deployment explicitly, otherwise the alias resolves through the
-- env var in `deployment_env`.
create table public.ai_model_tiers (
  tier smallint primary key check (tier between 0 and 4),
  label text not null,
  provider text not null check (provider in ('none', 'azure_openai')),
  deployment_alias text check (deployment_alias in ('nano', 'mini')),
  deployment_name text,
  deployment_env text,
  price_currency text not null default 'USD' check (price_currency in ('USD', 'GBP')),
  input_price_per_1m numeric(12, 6) not null default 0 check (input_price_per_1m >= 0),
  cached_input_price_per_1m numeric(12, 6) not null default 0 check (cached_input_price_per_1m >= 0),
  output_price_per_1m numeric(12, 6) not null default 0 check (output_price_per_1m >= 0),
  enabled boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  -- A real model tier must say which deployment it is.
  constraint ai_model_tiers_model_check check (
    tier = 0
    or provider = 'none'
    or deployment_alias is not null
  ),
  -- Tiers 3 and 4 have no env var of their own: enabling one requires an
  -- explicit deployment, or it would silently re-use tier 2's model.
  constraint ai_model_tiers_high_tier_deployment_check check (
    tier < 3 or not enabled or deployment_name is not null
  )
);

insert into public.ai_model_tiers
  (tier, label, provider, deployment_alias, deployment_name, deployment_env,
   input_price_per_1m, cached_input_price_per_1m, output_price_per_1m, enabled, notes)
values
  (0, 'Deterministic (no model)', 'none', null, null, null, 0, 0, 0, true,
   'The deterministic path. Never calls a provider.'),
  (1, 'Cheap structured', 'azure_openai', 'nano', null, 'AZURE_OPENAI_DEPLOYMENT_FAST',
   0.20, 0.02, 1.25, true,
   'gpt-5.4-nano. Deployment from env AZURE_OPENAI_DEPLOYMENT_FAST. Prices mirror provider_price_book (0018).'),
  (2, 'Standard generation', 'azure_openai', 'mini', null, 'AZURE_OPENAI_DEPLOYMENT_DEFAULT',
   0.75, 0.075, 4.50, true,
   'gpt-5.4-mini. Deployment from env AZURE_OPENAI_DEPLOYMENT_DEFAULT. Prices mirror provider_price_book (0018).'),
  (3, 'High', 'azure_openai', 'mini', null, null, 0, 0, 0, false,
   'Not configured. Set deployment_name and prices, then enable. Metered as mini.'),
  (4, 'Highest', 'azure_openai', 'mini', null, null, 0, 0, 0, false,
   'Not configured. Set deployment_name and prices, then enable. Metered as mini.');

-- ------------------------------------------------------------ ai_task_routes
-- Which tier a task runs at by default, and which tiers the budget manager may
-- move it to. `task_type` matches src/lib/ai/schemas.ts TASK_TYPES; the code
-- fallback (tiers.ts FALLBACK_ROUTES) covers any task without a row.
create table public.ai_task_routes (
  task_type text primary key,
  default_tier smallint not null references public.ai_model_tiers (tier),
  allowed_tiers smallint[] not null,
  updated_at timestamptz not null default now(),
  constraint ai_task_routes_default_allowed_check check (default_tier = any (allowed_tiers)),
  constraint ai_task_routes_allowed_range_check check (allowed_tiers <@ array[0,1,2,3,4]::smallint[])
);

-- Seeded to today's behaviour: structured tasks on tier 1 (nano), generation
-- on tier 2 (mini). Downgrades are allowed only where nano is known to do the
-- job acceptably; variant generation, the agent and social copy stay on mini.
insert into public.ai_task_routes (task_type, default_tier, allowed_tiers) values
  ('intent_classification',       1, array[1,2]::smallint[]),
  ('answer_extraction',           1, array[1,2]::smallint[]),
  ('social_reply_classification', 1, array[1,2]::smallint[]),
  ('website_contacts',            1, array[1,2]::smallint[]),
  ('reply_generation',            2, array[1,2]::smallint[]),
  ('conversation_summary',        2, array[1,2]::smallint[]),
  ('handover_reasoning',          2, array[2]::smallint[]),
  ('reactivation_copy',           2, array[1,2]::smallint[]),
  ('agent_decision',              2, array[2,3]::smallint[]),
  ('search_planning',             2, array[2]::smallint[]),
  ('research_summary',            2, array[1,2]::smallint[]),
  ('social_message',              2, array[2]::smallint[]),
  ('variant_generation',          2, array[2]::smallint[]),
  ('copilot_turn',                2, array[2]::smallint[]);

-- ---------------------------------------------------------------- ai_budgets
-- A ceiling on AI spend. business_id null = a platform default (plan_key names
-- the plan for PLAN scope). A workspace row of the same scope overrides the
-- default. Either or both ceilings may be set; a null ceiling is "no limit".
--
--   WORKSPACE_MONTH  the workspace's own monthly cap (optional, customer-set)
--   PLAN             the monthly cap for a plan (platform default by plan_key)
--   LEAD             lifetime AI spend on one lead
--   PRE_REPLY        AI spend on a lead before it has replied (kept low)
--   OPPORTUNITY      lifetime AI spend on a lead once it is an opportunity
--   EMERGENCY        hard stop on a workspace's monthly spend, whatever the task
create table public.ai_budgets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  plan_key text,
  scope text not null check (scope in
    ('WORKSPACE_MONTH', 'LEAD', 'PRE_REPLY', 'OPPORTUNITY', 'PLAN', 'EMERGENCY')),
  ceiling_tokens bigint check (ceiling_tokens is null or ceiling_tokens >= 0),
  ceiling_minor bigint check (ceiling_minor is null or ceiling_minor >= 0),
  currency text not null default 'GBP' check (currency = 'GBP'),
  budget_window text not null check (budget_window in ('MONTH', 'LIFETIME')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_budgets_plan_scope_check check ((scope = 'PLAN') = (plan_key is not null)),
  constraint ai_budgets_window_check check (
    (scope in ('WORKSPACE_MONTH', 'PLAN', 'EMERGENCY') and budget_window = 'MONTH')
    or (scope in ('LEAD', 'PRE_REPLY', 'OPPORTUNITY') and budget_window = 'LIFETIME')
  )
);

-- One row per (owner, scope, plan). coalesce() so the platform-default rows
-- (null business_id) are unique too.
create unique index ai_budgets_owner_scope_key
  on public.ai_budgets (
    coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid),
    scope,
    coalesce(plan_key, '')
  );

-- Platform defaults. Pence. Sized against gpt-5.4 prices: a nano
-- classification costs ~0.02p, an agent turn on mini ~0.5p.
insert into public.ai_budgets (business_id, plan_key, scope, ceiling_minor, budget_window) values
  (null, null,         'PRE_REPLY',   20,    'LIFETIME'),  -- 20p before a reply
  (null, null,         'LEAD',        200,   'LIFETIME'),  -- £2 per lead
  (null, null,         'OPPORTUNITY', 1000,  'LIFETIME'),  -- £10 per opportunity
  (null, null,         'EMERGENCY',   50000, 'MONTH'),     -- £500/month hard stop
  (null, 'trial',      'PLAN',        300,   'MONTH'),
  (null, 'starter',    'PLAN',        1500,  'MONTH'),
  (null, 'growth',     'PLAN',        5000,  'MONTH'),
  (null, 'pro',        'PLAN',        15000, 'MONTH');
  -- enterprise: no PLAN ceiling; EMERGENCY still applies.

-- ------------------------------------------------------- ai_budget_decisions
-- Append-only. One row per checkSpend() -- allowed calls included, so the log
-- shows what was spent where as well as what was refused and why.
create table public.ai_budget_decisions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  task_type text not null,
  stage text check (stage is null or stage in ('PRE_REPLY', 'ENGAGED', 'OPPORTUNITY')),
  decision text not null check (decision in
    ('SKIP', 'TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'HUMAN')),
  reason text not null,
  expected_value_minor numeric(14, 4),
  est_cost_minor numeric(14, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index ai_budget_decisions_business_idx
  on public.ai_budget_decisions (business_id, created_at desc);
create index ai_budget_decisions_lead_idx
  on public.ai_budget_decisions (lead_id, created_at desc)
  where lead_id is not null;

-- Append-only, enforced rather than promised.
create or replace function public.ai_budget_decisions_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'ai_budget_decisions is append-only';
end;
$$;

create trigger ai_budget_decisions_no_update
  before update on public.ai_budget_decisions
  for each row execute function public.ai_budget_decisions_immutable();

-- ------------------------------------------------------ ai_spend_snapshot
-- What has been spent, for the budget check: this workspace since `since`
-- (the budget month) and, when given, one lead over its lifetime. Summed from
-- ai_runs, which already holds the priced cost of every call.
create or replace function public.ai_spend_snapshot(
  target_business_id uuid,
  target_lead_id uuid,
  since timestamptz
)
returns table (
  workspace_cost_usd numeric,
  workspace_tokens bigint,
  lead_cost_usd numeric,
  lead_tokens bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce((select sum(r.estimated_cost_usd) from public.ai_runs r
               where r.business_id = target_business_id and r.created_at >= since), 0),
    coalesce((select sum(r.input_tokens + r.cached_input_tokens + r.output_tokens)::bigint
                from public.ai_runs r
               where r.business_id = target_business_id and r.created_at >= since), 0),
    coalesce((select sum(r.estimated_cost_usd) from public.ai_runs r
               where target_lead_id is not null
                 and r.business_id = target_business_id and r.lead_id = target_lead_id), 0),
    coalesce((select sum(r.input_tokens + r.cached_input_tokens + r.output_tokens)::bigint
                from public.ai_runs r
               where target_lead_id is not null
                 and r.business_id = target_business_id and r.lead_id = target_lead_id), 0);
$$;

revoke all on function public.ai_spend_snapshot(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_spend_snapshot(uuid, uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array['ai_model_tiers', 'ai_task_routes', 'ai_budget_decisions', 'ai_budgets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

grant select on public.ai_budgets to authenticated;
create policy ai_budgets_select_member on public.ai_budgets
  for select to authenticated
  using (business_id is null or public.is_business_member(business_id));
