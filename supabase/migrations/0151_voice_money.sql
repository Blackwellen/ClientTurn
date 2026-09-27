-- 0151_voice_money: voice minutes and cost. The minute balance, the
-- immutable minute ledger, per-call reservations, the immutable provider-cost
-- ledger, per-route minute allocations, the dial queue, and the two voice
-- capability metrics in plan_entitlements (0 on every plan).
--
-- Promoted from docs/revenue-engine/13-voice-schema-draft.sql and gap map OD-2.
-- Units are SECONDS in the ledger (src/lib/voice/budget.ts reserve / settle /
-- release); the entitlement is MINUTES a month (OD-2 "200 included minutes").
-- Depends on 0150. NOT applied by the author; apply 0150 -> 0154 in order.
--
-- Shapes copy the AI-token family (0116): balance member-read, ledger
-- member-read and append-only, reservations server-only. Concurrency is not a
-- table: it is the count of voice_calls in an active state (0150
-- voice_calls_active_idx) against voice_settings.workspace_concurrency, taken
-- under a row lock by the dial job. The queue below is what the worker claims.
--
-- Additive and idempotent.

-- ============================================================ voice_minute_balances
-- [MEMBER-READ] One row per workspace. No overage (0141): neither bucket
-- goes below zero.
create table if not exists public.voice_minute_balances (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  included_remaining_sec integer not null default 0 check (included_remaining_sec >= 0),
  pack_remaining_sec integer not null default 0 check (pack_remaining_sec >= 0),
  period_included_sec integer not null default 0 check (period_included_sec >= 0),
  period_start timestamptz,
  period_end timestamptz,
  updated_at timestamptz not null default now(),
  constraint voice_minute_balances_period check (period_start is null or period_end is null or period_start < period_end)
);
drop trigger if exists voice_minute_balances_set_updated_at on public.voice_minute_balances;
create trigger voice_minute_balances_set_updated_at
  before update on public.voice_minute_balances
  for each row execute function public.set_updated_at();

-- ============================================================== voice_minute_ledger
-- [MEMBER-READ] + [APPEND-ONLY]. Every movement of minutes. A correction is a
-- new ADJUSTMENT row. voice_call_id is set null (a depth >= 1 update, which
-- the append-only trigger lets through) when the call goes with its lead.
create table if not exists public.voice_minute_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in (
    'RESERVE', 'SETTLE', 'RELEASE', 'PERIOD_GRANT', 'PERIOD_EXPIRE', 'PACK_PURCHASE', 'PACK_REFUND', 'ADJUSTMENT')),
  voice_call_id uuid references public.voice_calls(id) on delete set null,
  route text check (route is null or route in ('QUALIFICATION', 'BOOKING_CLOSE', 'DIRECT_CLOSE', 'NURTURE', 'REACTIVATION', 'INBOUND')),
  included_delta_sec integer not null default 0,
  pack_delta_sec integer not null default 0,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  reason text check (reason is null or char_length(reason) <= 500),
  -- Pack purchase: a Stripe TEST-mode reference only (CLAUDE.md Stripe safety).
  stripe_ref text check (stripe_ref is null or char_length(stripe_ref) <= 200),
  created_at timestamptz not null default now(),
  constraint voice_minute_ledger_idem unique (business_id, idempotency_key)
);
create index if not exists voice_minute_ledger_business_idx on public.voice_minute_ledger (business_id, created_at desc);
create index if not exists voice_minute_ledger_call_idx on public.voice_minute_ledger (voice_call_id) where voice_call_id is not null;
drop trigger if exists voice_minute_ledger_immutable on public.voice_minute_ledger;
create trigger voice_minute_ledger_immutable
  before update or delete on public.voice_minute_ledger
  for each row when (pg_trigger_depth() = 0)
  execute function public.voice_reject_mutation();

-- ======================================================== voice_minute_reservations
-- [SERVER-ONLY] One hold per call, taken before dialling, settled or
-- released once. Reserve / settle / release run in one transaction with the
-- balance row locked (FOR UPDATE) and the ledger row written with its key.
create table if not exists public.voice_minute_reservations (
  voice_call_id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  route text check (route is null or route in ('QUALIFICATION', 'BOOKING_CLOSE', 'DIRECT_CLOSE', 'NURTURE', 'REACTIVATION', 'INBOUND')),
  held_sec integer not null check (held_sec > 0),
  from_included_sec integer not null check (from_included_sec >= 0),
  from_pack_sec integer not null check (from_pack_sec >= 0),
  status text not null default 'HELD' check (status in ('HELD', 'SETTLED', 'RELEASED')),
  billed_sec integer check (billed_sec is null or billed_sec >= 0),
  shortfall_sec integer not null default 0 check (shortfall_sec >= 0),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint voice_minute_reservations_split check (from_included_sec + from_pack_sec = held_sec),
  constraint voice_minute_reservations_closed check ((status = 'HELD') = (closed_at is null)),
  constraint voice_minute_reservations_call_fk foreign key (voice_call_id, business_id)
    references public.voice_calls(id, business_id) on delete cascade
);
create index if not exists voice_minute_reservations_held_idx
  on public.voice_minute_reservations (business_id) where status = 'HELD';

-- ================================================================ voice_cost_ledger
-- [SERVER-ONLY] + [APPEND-ONLY]. ClientTurn's provider cost per call (Retell,
-- Twilio, premium voice), estimated at call end and reconciled from the
-- provider's final call object by a correcting row (reconciles_id), never an
-- UPDATE. Server-only: it is ClientTurn's cost, not the customer's, and feeds
-- admin economics. business_id is set null on workspace delete, like
-- cost_events (0018), so platform economics keep the history.
create table if not exists public.voice_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete set null,
  voice_call_id uuid references public.voice_calls(id) on delete set null,
  business_number_id uuid references public.business_numbers(id) on delete set null,
  provider text not null check (provider in ('retell', 'twilio', 'elevenlabs', 'other')),
  metric text not null check (metric in (
    'VOICE_AI_MINUTE', 'TELEPHONY_MINUTE', 'PREMIUM_VOICE_MINUTE', 'NUMBER_MONTHLY', 'RECORDING_STORAGE', 'OTHER')),
  quantity numeric(14, 4) not null check (quantity >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  unit_cost numeric(14, 6) not null check (unit_cost >= 0),
  total_cost numeric(14, 6) not null,
  estimated boolean not null default true,
  reconciles_id uuid references public.voice_cost_ledger(id) on delete set null,
  provider_ref text check (provider_ref is null or char_length(provider_ref) <= 200),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint voice_cost_ledger_idem unique (idempotency_key)
);
create index if not exists voice_cost_ledger_business_idx on public.voice_cost_ledger (business_id, occurred_at desc);
create index if not exists voice_cost_ledger_call_idx on public.voice_cost_ledger (voice_call_id) where voice_call_id is not null;
drop trigger if exists voice_cost_ledger_immutable on public.voice_cost_ledger;
create trigger voice_cost_ledger_immutable
  before update or delete on public.voice_cost_ledger
  for each row when (pg_trigger_depth() = 0)
  execute function public.voice_reject_mutation();

-- ========================================================== voice_route_allocations
-- [MEMBER-READ] Percent of the period's minutes a route may use (budget.ts
-- RouteAllocations; no row = uncapped). The sum per workspace is at most 100.
create table if not exists public.voice_route_allocations (
  business_id uuid not null references public.businesses(id) on delete cascade,
  route text not null check (route in ('QUALIFICATION', 'BOOKING_CLOSE', 'DIRECT_CLOSE', 'NURTURE', 'REACTIVATION')),
  percent smallint not null check (percent between 0 and 100),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (business_id, route)
);
drop trigger if exists voice_route_allocations_set_updated_at on public.voice_route_allocations;
create trigger voice_route_allocations_set_updated_at
  before update on public.voice_route_allocations
  for each row execute function public.set_updated_at();

-- AFTER ROW triggers run at the end of the statement, so a multi-row update
-- that moves minutes between routes is judged on its final state.
create or replace function public.voice_route_allocations_check_sum()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sum integer;
begin
  select coalesce(sum(percent), 0) into v_sum
    from public.voice_route_allocations where business_id = new.business_id;
  if v_sum > 100 then
    raise exception 'route allocations for % add up to % percent (at most 100)', new.business_id, v_sum
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;
revoke all on function public.voice_route_allocations_check_sum() from public, anon, authenticated;
drop trigger if exists voice_route_allocations_check_sum on public.voice_route_allocations;
create trigger voice_route_allocations_check_sum
  after insert or update on public.voice_route_allocations
  for each row execute function public.voice_route_allocations_check_sum();

-- ================================================================= voice_call_queue
-- [SERVER-ONLY] The dial queue, claimed by the worker (budget.ts
-- QUEUE_PRIORITY; rank 0 = highest). The rank is derived from the priority
-- so the two cannot disagree.
create table if not exists public.voice_call_queue (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  voice_call_id uuid not null,
  priority text not null check (priority in (
    'INBOUND_CALLBACK', 'CALL_REQUESTED_FRESH', 'BOOKING_CLOSE', 'DIRECT_CLOSE', 'QUALIFICATION', 'NURTURE', 'REACTIVATION')),
  priority_rank smallint not null,
  not_before timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text check (claimed_by is null or char_length(claimed_by) <= 120),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  constraint voice_call_queue_one_per_call unique (voice_call_id),
  constraint voice_call_queue_rank check (priority_rank = array_position(array[
    'INBOUND_CALLBACK', 'CALL_REQUESTED_FRESH', 'BOOKING_CLOSE', 'DIRECT_CLOSE', 'QUALIFICATION', 'NURTURE', 'REACTIVATION'
  ]::text[], priority) - 1),
  constraint voice_call_queue_claim check ((claimed_at is null) = (claimed_by is null)),
  constraint voice_call_queue_call_fk foreign key (voice_call_id, business_id)
    references public.voice_calls(id, business_id) on delete cascade
);
create index if not exists voice_call_queue_due_idx
  on public.voice_call_queue (priority_rank, not_before, created_at)
  where claimed_at is null;
create index if not exists voice_call_queue_business_idx on public.voice_call_queue (business_id);

-- ======================================================================== RLS
do $$
declare t text;
begin
  foreach t in array array['voice_minute_balances', 'voice_minute_ledger', 'voice_route_allocations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_business_member(business_id))',
      t || '_select_member', t);
  end loop;
  foreach t in array array['voice_minute_reservations', 'voice_cost_ledger', 'voice_call_queue'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ================================================================= entitlements
-- OD-2: voice is a separate Stripe subscription item plus capability grants,
-- never a plan_key. Every plan row is 0; the Pro voice item and the
-- Starter/Growth packs grant through business_entitlement_grants
-- (reason 'STRIPE_ITEM:<si_...>' / 'VOICE_PACK'), written by the Stripe
-- webhook later. `do nothing` so a re-run never overwrites an edited row.
insert into public.plan_entitlements (plan_key, metric, soft_limit, hard_limit, overage_allowed, overage_price, unit, description)
values
  ('trial',      'voice_sales_enabled',    0, 0, false, null, 'boolean',       'Voice sales agent available (granted by the voice item or a pack, never by the plan)'),
  ('starter',    'voice_sales_enabled',    0, 0, false, null, 'boolean',       'Voice sales agent available (granted by the voice item or a pack, never by the plan)'),
  ('growth',     'voice_sales_enabled',    0, 0, false, null, 'boolean',       'Voice sales agent available (granted by the voice item or a pack, never by the plan)'),
  ('pro',        'voice_sales_enabled',    0, 0, false, null, 'boolean',       'Voice sales agent available (granted by the voice item or a pack, never by the plan)'),
  ('enterprise', 'voice_sales_enabled',    0, 0, false, null, 'boolean',       'Voice sales agent available (granted by the voice item or a pack, never by the plan)'),
  ('trial',      'voice_minutes_included', 0, 0, false, null, 'minutes/month', 'Included voice minutes a month (granted by the voice item, never by the plan)'),
  ('starter',    'voice_minutes_included', 0, 0, false, null, 'minutes/month', 'Included voice minutes a month (granted by the voice item, never by the plan)'),
  ('growth',     'voice_minutes_included', 0, 0, false, null, 'minutes/month', 'Included voice minutes a month (granted by the voice item, never by the plan)'),
  ('pro',        'voice_minutes_included', 0, 0, false, null, 'minutes/month', 'Included voice minutes a month (granted by the voice item, never by the plan)'),
  ('enterprise', 'voice_minutes_included', 0, 0, false, null, 'minutes/month', 'Included voice minutes a month (granted by the voice item, never by the plan)')
on conflict (plan_key, metric) do nothing;
