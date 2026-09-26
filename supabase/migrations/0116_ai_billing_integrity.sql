-- 0116_ai_billing_integrity: atomic AI admission with a bounded overdraw, and
-- per-agent-run usage accumulation.
--
-- Two defects closed here:
--
-- B21  Unbounded overdraw. `hasTokenCapacity` was a plain read followed later
--      by `consume_ai_tokens(allow_overdraw => true)`. Any number of workers
--      could read the same balance, all decide there was room, all call the
--      model, and all be debited -- the allowance had no floor. Now:
--        * `reserve_ai_tokens` admits a call only if the allowance covers its
--          estimate after every call already in flight is counted, under a row
--          lock, so concurrent admissions are serialised.
--        * `consume_ai_tokens_bounded` settles the call. A call that already
--          happened is always recorded (hiding real usage is worse than an
--          overshoot), but the overshoot can now only come from the gap between
--          estimate and actual on admitted calls. A debit that still lands past
--          the emergency ceiling -- `overdraw_ceiling_ratio` x included_tokens,
--          default 10% -- is flagged OVER_CEILING in the ledger metadata for
--          admin follow-up.
--      Reservations expire (default 5 minutes), so a worker that crashes
--      between admission and settlement holds tokens briefly, never forever.
--
-- B20  conversation_agent_runs token/cost columns were never written.
--      `add_agent_run_usage` increments them atomically, once per model call,
--      so a turn with several calls accumulates rather than overwrites.
--
-- The original `consume_ai_tokens` is left in place, unchanged, for callers
-- not yet moved across.

-- ======================================================================
-- 1. Reservations
-- ======================================================================
create table if not exists public.ai_token_reservations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  period_start date not null,
  tokens bigint not null check (tokens > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists ai_token_reservations_active_idx
  on public.ai_token_reservations (business_id, period_start, expires_at);

-- Operational detail: server role only.
alter table public.ai_token_reservations enable row level security;
alter table public.ai_token_reservations force row level security;
revoke all on public.ai_token_reservations from anon, authenticated;

-- ======================================================================
-- 2. Admission
-- ======================================================================
-- Returns the reservation id, or null when the call must not start. A null is
-- a billing state, not an error: the caller degrades to its deterministic path.
create or replace function public.reserve_ai_tokens(
  target_business_id uuid,
  target_period_start date,
  tokens bigint,
  ttl_seconds integer default 300
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  granted bigint;
  used bigint;
  held bigint;
  reservation uuid;
begin
  if tokens <= 0 then
    return null;
  end if;

  -- The lock is what serialises two workers admitting at the same instant.
  select b.included_tokens + b.purchased_tokens, b.used_tokens
    into granted, used
    from public.ai_token_balances b
   where b.business_id = target_business_id
     and b.period_start = target_period_start
   for update;

  if not found then
    return null;
  end if;

  delete from public.ai_token_reservations r
   where r.business_id = target_business_id
     and r.expires_at <= now();

  select coalesce(sum(r.tokens), 0)
    into held
    from public.ai_token_reservations r
   where r.business_id = target_business_id
     and r.period_start = target_period_start;

  if granted - used - held < tokens then
    return null;
  end if;

  insert into public.ai_token_reservations (business_id, period_start, tokens, expires_at)
  values (
    target_business_id, target_period_start, tokens,
    now() + make_interval(secs => greatest(ttl_seconds, 1))
  )
  returning id into reservation;

  return reservation;
end;
$$;

revoke all on function public.reserve_ai_tokens(uuid, date, bigint, integer)
  from public, anon, authenticated;

-- Releases a hold without debiting (the call failed before the provider
-- billed anything).
create or replace function public.release_ai_token_reservation(
  target_business_id uuid,
  reservation_id uuid
)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  delete from public.ai_token_reservations
   where id = reservation_id and business_id = target_business_id;
$$;

revoke all on function public.release_ai_token_reservation(uuid, uuid)
  from public, anon, authenticated;

-- ======================================================================
-- 3. Settlement with a bounded overdraw
-- ======================================================================
create or replace function public.consume_ai_tokens_bounded(
  target_business_id uuid,
  target_period_start date,
  tokens bigint,
  consume_reason text default 'CONSUMPTION',
  idem_key text default null,
  source_ai_run_id uuid default null,
  source_agent_run_id uuid default null,
  source_task_type text default null,
  source_deployment text default null,
  reservation_id uuid default null,
  overdraw_ceiling_ratio numeric default 0.10
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  included bigint;
  granted bigint;
  used bigint;
  remaining bigint;
  ceiling bigint;
begin
  -- Settling releases the hold whatever else happens.
  if reservation_id is not null then
    delete from public.ai_token_reservations
     where id = reservation_id and business_id = target_business_id;
  end if;

  if tokens <= 0 then
    return null;
  end if;

  -- Locked before the idempotency check, so two retries of the same call
  -- racing each other cannot both miss the ledger row and both debit.
  select b.included_tokens, b.included_tokens + b.purchased_tokens, b.used_tokens
    into included, granted, used
    from public.ai_token_balances b
   where b.business_id = target_business_id
     and b.period_start = target_period_start
   for update;

  if not found then
    return null;
  end if;

  if idem_key is not null then
    perform 1 from public.ai_token_ledger l
     where l.business_id = target_business_id
       and l.idempotency_key = idem_key;
    if found then
      return granted - used;
    end if;
  end if;

  ceiling := floor(greatest(included, 0) * greatest(overdraw_ceiling_ratio, 0));
  remaining := granted - (used + tokens);

  update public.ai_token_balances b
     set used_tokens = b.used_tokens + tokens,
         blocked_at = case when remaining <= 0 then coalesce(b.blocked_at, now()) else b.blocked_at end
   where b.business_id = target_business_id
     and b.period_start = target_period_start;

  insert into public.ai_token_ledger (
    business_id, period_start, delta_tokens, reason, ai_run_id, agent_run_id,
    task_type, deployment, idempotency_key, balance_after, metadata
  ) values (
    target_business_id, target_period_start, -tokens, consume_reason,
    source_ai_run_id, source_agent_run_id, source_task_type, source_deployment,
    idem_key, remaining,
    case when remaining < -ceiling
      then jsonb_build_object('over_ceiling', true, 'ceiling', ceiling)
      else '{}'::jsonb
    end
  );

  return remaining;
end;
$$;

revoke all on function public.consume_ai_tokens_bounded(uuid, date, bigint, text, text, uuid, uuid, text, text, uuid, numeric)
  from public, anon, authenticated;

-- ======================================================================
-- 4. Per-agent-run usage
-- ======================================================================
-- Incremented, not overwritten: one agent turn can make several model calls
-- (decision, summary), and each adds its share.
create or replace function public.add_agent_run_usage(
  target_run_id uuid,
  target_business_id uuid,
  add_input_tokens bigint,
  add_output_tokens bigint,
  add_cost_usd numeric,
  source_model_provider text default null,
  source_model_name text default null
)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update public.conversation_agent_runs r
     set input_tokens = r.input_tokens + greatest(add_input_tokens, 0),
         output_tokens = r.output_tokens + greatest(add_output_tokens, 0),
         estimated_cost_usd = r.estimated_cost_usd + greatest(add_cost_usd, 0),
         model_provider = coalesce(source_model_provider, r.model_provider),
         model_name = coalesce(source_model_name, r.model_name)
   where r.id = target_run_id
     and r.business_id = target_business_id;
$$;

revoke all on function public.add_agent_run_usage(uuid, uuid, bigint, bigint, numeric, text, text)
  from public, anon, authenticated;
