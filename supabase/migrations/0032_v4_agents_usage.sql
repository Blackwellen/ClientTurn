-- 0032_v4_agents_usage: bounded agent execution, the provider price book, and
-- the cost/margin ledger that protects contribution margin (V4 §48-52, §96-102,
-- §76.25, §76.30-76.31).
--
-- Two separations matter here:
--   * Customers see allowances (prospects, searches, monitors, sends). Tokens
--     and provider unit costs are internal and admin-only. Nothing in the
--     customer UI reads from cost_events or provider_price_book.
--   * Prices are effective-dated. No provider price is ever hardcoded in
--     application code; a price change is a row, not a deploy.
--
-- V3 already has `ai_usage_events` (0018) for the qualification/follow-up AI
-- and `usage_events` for plan metering. `agent_runs` is the V4 superset for the
-- nine bounded agent profiles, which carry budgets and tool calls that the
-- simpler V3 task metering has no place for.

-- --------------------------------------------------------------- agent_runs
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  agent_type text not null
    check (agent_type in ('BUSINESS_INTELLIGENCE','ICP_STRATEGY','SEARCH','RESEARCH','INTENT',
                          'SCORING','OUTREACH','CONVERSION','OPTIMIZATION','COPILOT','SUPPORT_COPILOT')),
  subject_type text,
  subject_id uuid,
  parent_run_id uuid references public.agent_runs(id) on delete set null,
  deployment text not null,
  prompt_key text not null,
  prompt_version text not null,
  input_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  tool_call_count integer not null default 0,
  provider_cost_minor bigint not null default 0,
  model_cost_minor bigint not null default 0,
  budget_before_minor bigint,
  budget_after_minor bigint,
  confidence numeric(5,4),
  status text not null default 'RUNNING'
    check (status in ('RUNNING','OK','LOW_CONFIDENCE','SCHEMA_INVALID','BUDGET_BLOCKED',
                      'POLICY_BLOCKED','PROVIDER_ERROR','TIMEOUT','CANCELLED','ERROR')),
  error_code text,
  result_json jsonb,
  latency_ms integer,
  trace_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index agent_runs_business_idx
  on public.agent_runs (business_id, agent_type, created_at desc);
create index agent_runs_subject_idx
  on public.agent_runs (business_id, subject_type, subject_id);
create index agent_runs_status_idx
  on public.agent_runs (status, created_at desc)
  where status not in ('OK','LOW_CONFIDENCE');

-- ---------------------------------------------------------- agent_tool_calls
-- What the agent actually asked the system to do. Tool permission is enforced
-- in code before the call; this is the audit of the calls that were allowed.
create table public.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  agent_run_id uuid not null references public.agent_runs(id) on delete cascade,
  tool_name text not null,
  arguments_json jsonb not null default '{}'::jsonb,
  result_summary text,
  status text not null default 'OK'
    check (status in ('OK','DENIED_PERMISSION','DENIED_BUDGET','DENIED_POLICY','ERROR','REQUIRES_APPROVAL')),
  denial_reason text,
  cost_minor bigint not null default 0,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index agent_tool_calls_run_idx
  on public.agent_tool_calls (agent_run_id, created_at);

-- ------------------------------------------------------------ agent_budgets
-- Per-tenant, per-period spend envelope for the agent runtime. The runtime
-- reserves before an expensive call and reconciles after, so a crash between
-- the two over-reserves rather than over-spends.
create table public.agent_budgets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  scope text not null default 'ALL'
    check (scope in ('ALL','SOURCING','INTENT','OUTREACH','CONVERSION','OPTIMIZATION','COPILOT')),
  budget_minor bigint not null default 0,
  reserved_minor bigint not null default 0,
  spent_minor bigint not null default 0,
  blocked_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (business_id, period_start, scope)
);

create trigger agent_budgets_set_updated_at
  before update on public.agent_budgets
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------- prompt_versions
-- Platform-owned prompt registry for the agent profiles. V3's ai_prompt_versions
-- covers the qualification/follow-up tasks; this covers the V4 agents so a
-- result can be reproduced against the exact prompt that produced it.
create table public.agent_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  agent_type text not null,
  prompt_key text not null,
  version text not null,
  system_prompt text not null,
  schema_version integer not null default 1,
  model_hint text,
  max_output_tokens integer not null default 800,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','ACTIVE','RETIRED')),
  notes text,
  created_at timestamptz not null default now(),
  unique (prompt_key, version)
);

create unique index agent_prompt_versions_active_idx
  on public.agent_prompt_versions (prompt_key)
  where status = 'ACTIVE';

-- ============================ existing economics layer ====================
-- V3 (0018_ai_usage_billing) already established provider_price_book,
-- cost_events, business_cost_daily, business_margin_monthly and
-- plan_entitlements, and they are already server-only with RLS forced and no
-- browser grants. V4 does NOT re-create them — it widens them with the
-- acquisition dimensions the sourcing/intent/email work introduces.
--
-- Money stays in the units 0018 chose (numeric cost columns, not minor units)
-- so every existing rollup, admin query and seed row keeps working.

-- ------------------------------------------------------- provider_price_book
-- V4 sources cost per lookup/enrichment/verification, so the price book needs
-- to carry a region (the same enrichment SKU is priced differently per market)
-- and an explicit capability tag the provider adapters resolve against.
alter table public.provider_price_book
  add column if not exists capability text,
  add column if not exists notes text,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

create index if not exists provider_price_book_capability_idx
  on public.provider_price_book (capability, effective_from desc)
  where capability is not null;

-- ---------------------------------------------------------------- cost_events
-- Attribution columns: V3 could always say which tenant a cost belonged to,
-- but not which sourcing run, campaign or agent execution caused it. Cost per
-- verified prospect and cost per reply (§102) are impossible without these.
alter table public.cost_events
  add column if not exists category text,
  add column if not exists product text,
  add column if not exists agent_run_id uuid references public.agent_runs(id) on delete set null,
  add column if not exists sourcing_run_id uuid references public.sourcing_runs(id) on delete set null,
  add column if not exists campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  add column if not exists message_id uuid references public.messages(id) on delete set null,
  add column if not exists price_book_id uuid references public.provider_price_book(id) on delete set null,
  add column if not exists subject_type text,
  add column if not exists subject_id uuid,
  add column if not exists idempotency_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.cost_events drop constraint if exists cost_events_category_check;
alter table public.cost_events add constraint cost_events_category_check
  check (category is null or category in (
    'DISCOVERY','ENRICHMENT','VERIFICATION','AI','EMAIL','SMS','WHATSAPP',
    'INTENT','INFRASTRUCTURE','STRIPE','CRM','OTHER'));

-- A retried worker must never post the same cost twice.
create unique index if not exists cost_events_idem_idx
  on public.cost_events (idempotency_key)
  where idempotency_key is not null;

create index if not exists cost_events_category_idx
  on public.cost_events (business_id, category, occurred_at desc)
  where category is not null;
create index if not exists cost_events_sourcing_run_idx
  on public.cost_events (sourcing_run_id)
  where sourcing_run_id is not null;
create index if not exists cost_events_campaign_idx
  on public.cost_events (campaign_id)
  where campaign_id is not null;

-- Backfill the category from the metric 0018 already records, so historical
-- rows are not stranded outside the new breakdown.
update public.cost_events
   set category = case
     when metric like 'ai_%' then 'AI'
     when metric like 'sms_%' then 'SMS'
     when metric like 'whatsapp%' then 'WHATSAPP'
     when metric like 'email%' then 'EMAIL'
     else 'OTHER'
   end
 where category is null;

-- ----------------------------------------------------------- business_cost_daily
alter table public.business_cost_daily
  add column if not exists discovery_cost numeric(14, 6) not null default 0,
  add column if not exists enrichment_cost numeric(14, 6) not null default 0,
  add column if not exists verification_cost numeric(14, 6) not null default 0,
  add column if not exists intent_cost numeric(14, 6) not null default 0;

-- ------------------------------------------------------ business_margin_monthly
alter table public.business_margin_monthly
  add column if not exists discovery_cost numeric(14, 6) not null default 0,
  add column if not exists enrichment_cost numeric(14, 6) not null default 0,
  add column if not exists verification_cost numeric(14, 6) not null default 0,
  add column if not exists email_cost numeric(14, 6) not null default 0,
  add column if not exists intent_cost numeric(14, 6) not null default 0,
  add column if not exists plan_key text,
  add column if not exists margin_state text not null default 'HEALTHY',
  add column if not exists breakdown_json jsonb not null default '{}'::jsonb;

alter table public.business_margin_monthly drop constraint if exists business_margin_monthly_state_check;
alter table public.business_margin_monthly add constraint business_margin_monthly_state_check
  check (margin_state in ('HEALTHY','WATCH','WARNING','CRITICAL','NO_REVENUE'));

create index if not exists business_margin_monthly_state_idx
  on public.business_margin_monthly (billing_period desc, margin_state);

-- ------------------------------------------------------------- plan_entitlements
-- 0018 keyed entitlements on (plan_key, metric) with soft/hard limits, which
-- already expresses everything V4 needs. The V4 allowances are seeded as new
-- metric rows in 0038 rather than as a second table with a rival shape.
alter table public.plan_entitlements
  add column if not exists description text,
  add column if not exists text_value text,
  add column if not exists boolean_value boolean,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

-- ------------------------------------------------------------ economics_alerts
create table public.economics_alerts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  alert_type text not null
    check (alert_type in ('MARGIN_BELOW_THRESHOLD','SOURCING_COST_ANOMALY','AI_COST_ANOMALY',
                          'MESSAGING_SPIKE','VERIFICATION_FAILURE_RATE','PROVIDER_PRICE_CHANGE',
                          'MAILBOX_HEALTH','OVERAGE_APPROACHING_CAP')),
  severity text not null default 'WARNING'
    check (severity in ('INFO','WARNING','CRITICAL')),
  title text not null,
  detail text,
  metrics_json jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN'
    check (status in ('OPEN','ACKNOWLEDGED','RESOLVED','MUTED')),
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index economics_alerts_open_idx
  on public.economics_alerts (status, severity, created_at desc);

-- Per-tenant grants that override the plan default (support-approved trials,
-- temporary uplifts). Always expiring unless deliberately made permanent.
create table public.business_entitlement_grants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  entitlement_key text not null,
  numeric_value numeric(18,4),
  boolean_value boolean,
  text_value text,
  reason text not null,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  unique (business_id, entitlement_key)
);

create index business_entitlement_grants_live_idx
  on public.business_entitlement_grants (business_id)
  where revoked_at is null;

-- -------------------------------------------------- customer_usage_allocations
-- The customer-facing communication allocation. Percentages, never raw costs.
-- Overage is off by default and can only be enabled deliberately, with a cap.
create table public.customer_usage_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  billing_period date not null,
  email_percent numeric(5,2) not null default 60
    check (email_percent >= 0 and email_percent <= 100),
  sms_percent numeric(5,2) not null default 25
    check (sms_percent >= 0 and sms_percent <= 100),
  whatsapp_percent numeric(5,2) not null default 15
    check (whatsapp_percent >= 0 and whatsapp_percent <= 100),
  overage_enabled boolean not null default false,
  overage_cap_minor bigint not null default 0,
  daily_caps_json jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (business_id, billing_period),
  constraint customer_usage_allocations_sum
    check (email_percent + sms_percent + whatsapp_percent = 100)
);

create trigger customer_usage_allocations_set_updated_at
  before update on public.customer_usage_allocations
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ usage_reservations
-- Reserve-then-reconcile for billable sends and sourcing units. A reservation
-- that is never reconciled expires, so a crashed worker cannot permanently
-- consume a customer's allowance.
create table public.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  billing_period date not null,
  metric text not null
    check (metric in ('EMAIL_SEND','SMS_SEGMENT','WHATSAPP_MESSAGE','VERIFIED_PROSPECT',
                      'SEARCH_RUN','INTENT_MONITOR_RUN')),
  quantity numeric(18,4) not null default 1,
  estimated_cost_minor bigint not null default 0,
  actual_cost_minor bigint,
  status text not null default 'RESERVED'
    check (status in ('RESERVED','COMMITTED','RELEASED','EXPIRED')),
  subject_type text,
  subject_id uuid,
  idempotency_key text,
  reserved_at timestamptz not null default now(),
  settled_at timestamptz,
  expires_at timestamptz not null default (now() + interval '1 hour')
);

create unique index usage_reservations_idem_idx
  on public.usage_reservations (business_id, idempotency_key)
  where idempotency_key is not null;

create index usage_reservations_open_idx
  on public.usage_reservations (business_id, billing_period, metric)
  where status = 'RESERVED';
create index usage_reservations_expiry_idx
  on public.usage_reservations (expires_at)
  where status = 'RESERVED';
