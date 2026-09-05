-- 0018_ai_usage_billing: AI settings/runs, provider price book, cost ledger,
-- daily/monthly economics rollups, plan entitlement table.
--
-- Scope: "Foundation" pass of the AI + automation + pricing + unit-economics
-- build (see CLAUDE.md task brief). Automation event-catalog tables and the
-- reactivation/qualification AI wiring are later passes; this migration only
-- lays the schema the model router and cost metering need to write to.

-- --------------------------------------------------- business_ai_settings
-- Tenant-editable. Surfaced in Follow-Up > AI Behaviour, per the "keep it
-- simple" UI rule — no temperature/tokens/model/prompt exposed to customers.
create table public.business_ai_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  enabled boolean not null default false,
  tone text not null default 'professional'
    check (tone in ('professional', 'friendly', 'direct')),
  reply_length text not null default 'short'
    check (reply_length in ('short', 'normal')),
  business_description text,
  handover_instruction text,
  fallback_message text,
  allow_ai_reply boolean not null default false,
  allow_ai_interpretation boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger business_ai_settings_set_updated_at
  before update on public.business_ai_settings
  for each row execute function public.set_updated_at();

alter table public.business_ai_settings enable row level security;
alter table public.business_ai_settings force row level security;

create policy business_ai_settings_select on public.business_ai_settings
  for select to authenticated
  using (public.is_business_member(business_id));

create policy business_ai_settings_update on public.business_ai_settings
  for update to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin']))
  with check (public.has_business_role(business_id, array['owner', 'admin']));

grant select, update on public.business_ai_settings to authenticated;
revoke all on public.business_ai_settings from anon;

-- --------------------------------------------------------- ai_prompt_versions
-- Global registry, not tenant-owned. Server/admin managed only; the app code
-- registry in src/lib/ai/prompt-registry.ts is the day-to-day source of truth,
-- this table is the durable audit trail of what a given ai_runs row actually
-- ran with.
create table public.ai_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null,
  version integer not null,
  system_prompt text not null,
  schema_version integer not null default 1,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  unique (prompt_key, version)
);

create unique index ai_prompt_versions_active_idx
  on public.ai_prompt_versions (prompt_key)
  where status = 'active';

alter table public.ai_prompt_versions enable row level security;
alter table public.ai_prompt_versions force row level security;
revoke all on public.ai_prompt_versions from anon, authenticated;

-- ------------------------------------------------------------------ ai_runs
-- Server-only. Every Azure call is metered here regardless of outcome so
-- cost/latency/confidence are always reconstructable per business/lead.
create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  automation_run_id uuid references public.automation_runs(id) on delete set null,
  task_type text not null,
  deployment text not null check (deployment in ('nano', 'mini')),
  prompt_key text,
  prompt_version integer,
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  latency_ms integer,
  confidence numeric(4, 3),
  result_json jsonb,
  status text not null default 'ok'
    check (status in ('ok', 'error', 'fallback', 'low_confidence')),
  error_code text,
  created_at timestamptz not null default now()
);

create index ai_runs_business_idx on public.ai_runs (business_id, created_at desc);
create index ai_runs_task_type_idx on public.ai_runs (task_type, created_at desc);
create index ai_runs_lead_idx on public.ai_runs (lead_id) where lead_id is not null;

alter table public.ai_runs enable row level security;
alter table public.ai_runs force row level security;
revoke all on public.ai_runs from anon, authenticated;

-- ------------------------------------------------------------ provider_price_book
-- Global, effective-dated. Never hardcode a provider unit cost anywhere else.
create table public.provider_price_book (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  product text not null,
  region text,
  currency text not null default 'USD',
  unit text not null,
  unit_cost numeric(14, 8) not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index provider_price_book_lookup_idx
  on public.provider_price_book (provider, product, effective_from desc);

alter table public.provider_price_book enable row level security;
alter table public.provider_price_book force row level security;
revoke all on public.provider_price_book from anon, authenticated;

-- --------------------------------------------------- usage_events (widen)
-- Add the granular metrics the price book / cost engine consume. The four
-- metrics from 0009 stay for backward compatibility with existing callers.
alter table public.usage_events drop constraint usage_events_metric_check;
alter table public.usage_events add constraint usage_events_metric_check
  check (metric in (
    'lead_processed', 'message_sent', 'message_received', 'ai_call', 'campaign_message',
    'sms_outbound_segment', 'sms_inbound_segment', 'whatsapp_message',
    'ai_mini_input_token', 'ai_mini_cached_token', 'ai_mini_output_token',
    'ai_nano_input_token', 'ai_nano_cached_token', 'ai_nano_output_token',
    'email_sent', 'reactivation_contact', 'active_user'
  ));

-- ------------------------------------------------------------------- cost_events
-- Server-only. One row per priced usage_events (or provider-direct) occurrence.
create table public.cost_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete set null,
  provider text not null,
  metric text not null,
  quantity numeric(14, 4) not null,
  currency text not null default 'USD',
  unit_cost numeric(14, 8) not null,
  total_cost numeric(14, 6) not null,
  source_event_id uuid,
  occurred_at timestamptz not null default now(),
  estimated boolean not null default true,
  reconciled boolean not null default false
);

create index cost_events_business_idx on public.cost_events (business_id, occurred_at desc);

alter table public.cost_events enable row level security;
alter table public.cost_events force row level security;
revoke all on public.cost_events from anon, authenticated;

-- ----------------------------------------------------------- business_cost_daily
-- Server-only aggregate, written by the daily rollup job.
create table public.business_cost_daily (
  business_id uuid not null references public.businesses(id) on delete cascade,
  date date not null,
  ai_cost numeric(14, 6) not null default 0,
  sms_cost numeric(14, 6) not null default 0,
  whatsapp_cost numeric(14, 6) not null default 0,
  email_cost numeric(14, 6) not null default 0,
  infrastructure_allocated_cost numeric(14, 6) not null default 0,
  stripe_cost numeric(14, 6) not null default 0,
  other_cost numeric(14, 6) not null default 0,
  total_cost numeric(14, 6) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (business_id, date)
);

alter table public.business_cost_daily enable row level security;
alter table public.business_cost_daily force row level security;
revoke all on public.business_cost_daily from anon, authenticated;

-- --------------------------------------------------------- business_margin_monthly
-- Server-only, admin economics only. Never exposed to normal customers.
create table public.business_margin_monthly (
  business_id uuid not null references public.businesses(id) on delete cascade,
  billing_period date not null,
  subscription_revenue numeric(14, 2) not null default 0,
  overage_revenue numeric(14, 2) not null default 0,
  total_revenue numeric(14, 2) not null default 0,
  sms_cost numeric(14, 6) not null default 0,
  whatsapp_cost numeric(14, 6) not null default 0,
  ai_cost numeric(14, 6) not null default 0,
  stripe_cost numeric(14, 6) not null default 0,
  allocated_platform_cost numeric(14, 6) not null default 0,
  total_cogs numeric(14, 6) not null default 0,
  gross_contribution numeric(14, 6) not null default 0,
  gross_margin_percent numeric(6, 3),
  updated_at timestamptz not null default now(),
  primary key (business_id, billing_period)
);

alter table public.business_margin_monthly enable row level security;
alter table public.business_margin_monthly force row level security;
revoke all on public.business_margin_monthly from anon, authenticated;

-- ------------------------------------------------------------- plan_entitlements
-- Global, admin-managed. Server-side enforcement reads this; the UI never
-- decides limits on its own.
create table public.plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null,
  metric text not null,
  soft_limit numeric(14, 4),
  hard_limit numeric(14, 4),
  overage_allowed boolean not null default false,
  overage_price numeric(10, 4),
  unit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_key, metric)
);

create trigger plan_entitlements_set_updated_at
  before update on public.plan_entitlements
  for each row execute function public.set_updated_at();

alter table public.plan_entitlements enable row level security;
alter table public.plan_entitlements force row level security;
revoke all on public.plan_entitlements from anon, authenticated;

-- ---------------------------------------------------------------- seed data
-- Provider cost seeds (§36). Reference values, not permanent constants — the
-- Meta WhatsApp per-template fee is deliberately excluded, per instruction.
insert into public.provider_price_book (provider, product, currency, unit, unit_cost) values
  ('azure', 'gpt_5_4_mini_input', 'USD', 'per_million_tokens', 0.75),
  ('azure', 'gpt_5_4_mini_cached_input', 'USD', 'per_million_tokens', 0.075),
  ('azure', 'gpt_5_4_mini_output', 'USD', 'per_million_tokens', 4.50),
  ('azure', 'gpt_5_4_nano_input', 'USD', 'per_million_tokens', 0.20),
  ('azure', 'gpt_5_4_nano_cached_input', 'USD', 'per_million_tokens', 0.02),
  ('azure', 'gpt_5_4_nano_output', 'USD', 'per_million_tokens', 1.25),
  ('twilio', 'uk_sms_outbound_segment', 'USD', 'per_unit', 0.056),
  ('twilio', 'uk_sms_inbound_segment', 'USD', 'per_unit', 0.0075),
  ('twilio', 'uk_mobile_number_month', 'USD', 'per_month', 2.50),
  ('twilio', 'whatsapp_message', 'USD', 'per_unit', 0.005);

-- Plan entitlements (§42) — matches the tiers in src/lib/billing/plans.ts.
insert into public.plan_entitlements (plan_key, metric, soft_limit, hard_limit, overage_allowed, overage_price, unit) values
  ('starter', 'lead_processed', 90, 100, false, null, 'leads/month'),
  ('starter', 'sms_outbound_segment', 200, 250, true, 0.09, 'segments/month'),
  ('starter', 'active_user', 1, 1, false, null, 'users'),
  ('starter', 'reactivation_contact', 100, 100, false, null, 'contacts'),
  ('growth', 'lead_processed', 360, 400, false, null, 'leads/month'),
  ('growth', 'sms_outbound_segment', 700, 800, true, 0.08, 'segments/month'),
  ('growth', 'active_user', 3, 3, false, null, 'users'),
  ('growth', 'reactivation_contact', 500, 500, false, null, 'contacts'),
  ('pro', 'lead_processed', 900, 1000, false, null, 'leads/month'),
  ('pro', 'sms_outbound_segment', 1600, 1800, true, 0.075, 'segments/month'),
  ('pro', 'active_user', 10, 10, false, null, 'users'),
  ('pro', 'reactivation_contact', 2500, 2500, false, null, 'contacts');
