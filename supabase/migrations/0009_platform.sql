-- 0009_platform: webhook inbox, job queue, usage, subscriptions,
-- notifications, audit, marketing attribution

-- ---------------------------------------------------------- webhook_events
-- Server-only idempotent inbox for every external provider event.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  business_id uuid references public.businesses(id) on delete set null,
  event_type text,
  payload_hash text,
  payload jsonb,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index webhook_events_idempotency_idx
  on public.webhook_events (provider, external_event_id);
create index webhook_events_status_idx
  on public.webhook_events (status, received_at desc);

-- ------------------------------------------------------------------- jobs
-- Server-only durable queue drained by /api/cron/worker.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  business_id uuid references public.businesses(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'pending'
    check (state in ('pending', 'running', 'completed', 'failed', 'dead')),
  priority integer not null default 100,
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  last_error text,
  -- Optional dedupe key so the same logical job is never queued twice.
  idempotency_key text,
  created_at timestamptz not null default now()
);

create index jobs_due_idx on public.jobs (run_at, priority)
  where state = 'pending';
create index jobs_state_idx on public.jobs (state, created_at desc);
create unique index jobs_idempotency_idx on public.jobs (idempotency_key)
  where idempotency_key is not null and state in ('pending', 'running');

-- ------------------------------------------------------------ usage_events
-- Server-only usage/cost ledger.
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  metric text not null
    check (metric in ('lead_processed', 'message_sent', 'message_received',
                      'ai_call', 'campaign_message')),
  quantity numeric(12,4) not null default 1,
  unit_cost numeric(12,6),
  currency text default 'GBP',
  source text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index usage_events_business_idx
  on public.usage_events (business_id, occurred_at desc, metric);

-- ---------------------------------------------------------- subscriptions
-- Mirror of Stripe. Stripe is authoritative; this table is never the source
-- of truth for anything other than fast entitlement reads.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  plan text not null default 'trial'
    check (plan in ('trial', 'starter', 'growth', 'pro', 'enterprise')),
  status text not null default 'TRIALING'
    check (status in ('TRIALING','ACTIVE','PAST_DUE','CANCELLED','UNPAID','INCOMPLETE')),
  billing_interval text check (billing_interval in ('month', 'year')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  -- Entitlement snapshot resolved from the plan, so limit checks are one read.
  lead_limit integer not null default 25,
  user_limit integer not null default 1,
  whatsapp_enabled boolean not null default false,
  campaigns_enabled boolean not null default false,
  ai_assist_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------- notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  type text not null
    check (type in ('handover', 'booking', 'integration_failure', 'message_failed',
                    'campaign_complete', 'billing', 'usage_limit', 'lead_attention')),
  severity text not null default 'info'
    check (severity in ('info', 'warning', 'error')),
  title text not null,
  body text,
  link_url text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx
  on public.notifications (user_id, read_at, created_at desc);

-- --------------------------------------------------------------- audit_log
-- Server-only, append-only.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user'
    check (actor_type in ('user', 'system', 'platform_admin', 'provider')),
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index audit_log_business_idx on public.audit_log (business_id, created_at desc);

-- ------------------------------------------------- marketing attribution
create table public.marketing_sessions (
  id uuid primary key default gen_random_uuid(),
  anonymous_id text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer text,
  landing_path text,
  first_seen_at timestamptz not null default now(),
  converted_user_id uuid references auth.users(id) on delete set null,
  converted_at timestamptz
);

create index marketing_sessions_anon_idx on public.marketing_sessions (anonymous_id);

create table public.marketing_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.marketing_sessions(id) on delete cascade,
  event_name text not null,
  cta_placement text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index marketing_events_session_idx on public.marketing_events (session_id, occurred_at);
