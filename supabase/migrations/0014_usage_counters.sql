-- 0014_usage_counters: period roll-ups of usage_events.
--
-- usage_events is an append-only ledger; scanning it on every dashboard read
-- gets expensive, so the worker rolls each billing period into one row per
-- metric. The ledger stays authoritative — this table is derived and can be
-- rebuilt at any time.

create table if not exists public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  metric text not null
    check (metric in ('lead_processed', 'message_sent', 'message_received',
                      'ai_call', 'campaign_message')),
  quantity numeric(14,4) not null default 0,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, period_start, metric)
);

create index if not exists usage_counters_business_idx
  on public.usage_counters (business_id, period_start desc);

create trigger usage_counters_set_updated_at
  before update on public.usage_counters
  for each row execute function public.set_updated_at();

alter table public.usage_counters enable row level security;

create policy usage_counters_select on public.usage_counters
  for select using (public.is_business_member(business_id));

grant select on public.usage_counters to authenticated;
