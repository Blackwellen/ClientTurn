-- 0024c_ai_token_allowance: token-denominated AI allowances, per-tier limits,
-- and self-serve top-up packs.
--
-- What a customer sees is a **token allowance**: a countable thing that goes
-- down as the assistant works and can be topped up. What a customer never sees
-- is what a token costs us -- provider unit costs stay in provider_price_book
-- and cost_events, which remain admin-only. That split is the whole design:
-- the allowance is the product, the unit cost is the business.
--
-- Three tables, and they answer three different questions:
--
--   ai_token_balances  -- "how much is left right now?"  (fast read, one row
--                         per business per billing period)
--   ai_token_ledger    -- "why?"                          (append-only, every
--                         grant, debit and purchase, idempotent)
--   ai_token_purchases -- "what did they buy?"            (Stripe top-ups)
--
-- The balance is a materialised convenience. The ledger is the truth, and a
-- balance can always be rebuilt from it.

-- ======================================================================
-- 1. Balances
-- ======================================================================
create table public.ai_token_balances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- The billing period this allowance belongs to. Included tokens do not roll
  -- over; purchased tokens do (see `purchased_tokens` below).
  period_start date not null,
  period_end date not null,
  plan_key text,

  -- Granted by the plan for this period. Reset each period.
  included_tokens bigint not null default 0,
  -- Bought as top-ups. Carried forward across periods, because a customer who
  -- paid for tokens has not agreed to lose them at a month boundary.
  purchased_tokens bigint not null default 0,
  -- Consumed against this period.
  used_tokens bigint not null default 0,
  -- Held by in-flight calls. Reserve-then-reconcile, so a crash between the
  -- two over-reserves rather than over-spends.
  reserved_tokens bigint not null default 0,

  -- Set when a workspace opts in to being blocked rather than degraded. The
  -- default is to stop AI work at the limit; nothing here ever silently bills.
  blocked_at timestamptz,
  blocked_count integer not null default 0,
  -- Notification watermarks, so a workspace is warned once per threshold
  -- rather than on every single call past it.
  warned_at_percent integer not null default 0,

  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (business_id, period_start),
  constraint ai_token_balances_non_negative
    check (included_tokens >= 0 and purchased_tokens >= 0
           and used_tokens >= 0 and reserved_tokens >= 0)
);

create index ai_token_balances_business_idx
  on public.ai_token_balances (business_id, period_start desc);

create trigger ai_token_balances_set_updated_at
  before update on public.ai_token_balances
  for each row execute function public.set_updated_at();

-- ======================================================================
-- 2. Ledger
-- ======================================================================
create table public.ai_token_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  period_start date not null,
  -- Negative for consumption, positive for a grant or a purchase.
  delta_tokens bigint not null,
  reason text not null
    check (reason in ('PLAN_GRANT', 'PURCHASE', 'CONSUMPTION', 'REFUND',
                      'ADJUSTMENT', 'EXPIRY', 'TRIAL_GRANT')),
  -- What caused it, where a cause exists.
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  agent_run_id uuid references public.conversation_agent_runs(id) on delete set null,
  purchase_id uuid,
  task_type text,
  deployment text,
  -- Stable key so a retried worker cannot debit the same call twice.
  idempotency_key text,
  balance_after bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index ai_token_ledger_idem_idx
  on public.ai_token_ledger (business_id, idempotency_key)
  where idempotency_key is not null;

create index ai_token_ledger_business_idx
  on public.ai_token_ledger (business_id, created_at desc);
create index ai_token_ledger_period_idx
  on public.ai_token_ledger (business_id, period_start, reason);

-- ======================================================================
-- 3. Purchases
-- ======================================================================
create table public.ai_token_purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  pack_key text not null,
  tokens bigint not null check (tokens > 0),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'GBP',
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'EXPIRED')),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  purchased_by uuid references auth.users(id) on delete set null,
  -- Set when the tokens were actually credited, so a replayed webhook cannot
  -- credit twice even if the row is seen again.
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ai_token_purchases_session_idx
  on public.ai_token_purchases (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create index ai_token_purchases_business_idx
  on public.ai_token_purchases (business_id, created_at desc);

create trigger ai_token_purchases_set_updated_at
  before update on public.ai_token_purchases
  for each row execute function public.set_updated_at();

alter table public.ai_token_ledger
  add constraint ai_token_ledger_purchase_fk
  foreign key (purchase_id) references public.ai_token_purchases(id) on delete set null;

-- ======================================================================
-- 4. Atomic consumption
-- ======================================================================
-- Debits tokens and writes the ledger row in one statement, so two workers
-- finishing at the same instant cannot both read the same remaining balance
-- and both decide there was room.
--
-- Returns the remaining balance, or null when the debit was refused. A refusal
-- is not an error: the caller degrades to a deterministic reply rather than
-- failing the turn.
create or replace function public.consume_ai_tokens(
  target_business_id uuid,
  target_period_start date,
  tokens bigint,
  consume_reason text default 'CONSUMPTION',
  idem_key text default null,
  source_ai_run_id uuid default null,
  source_agent_run_id uuid default null,
  source_task_type text default null,
  source_deployment text default null,
  allow_overdraw boolean default false
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  remaining bigint;
  granted bigint;
begin
  if tokens <= 0 then
    return null;
  end if;

  -- A replayed debit is a no-op that reports the current balance, never a
  -- second deduction.
  if idem_key is not null then
    select b.included_tokens + b.purchased_tokens - b.used_tokens
      into remaining
      from public.ai_token_ledger l
      join public.ai_token_balances b
        on b.business_id = l.business_id and b.period_start = l.period_start
     where l.business_id = target_business_id
       and l.idempotency_key = idem_key
     limit 1;

    if found then
      return remaining;
    end if;
  end if;

  update public.ai_token_balances b
     set used_tokens = b.used_tokens + tokens,
         -- The reservation, if any, is released as the real cost lands.
         reserved_tokens = greatest(b.reserved_tokens - tokens, 0),
         blocked_at = case
           when b.included_tokens + b.purchased_tokens - (b.used_tokens + tokens) <= 0
             then now()
           else b.blocked_at
         end
   where b.business_id = target_business_id
     and b.period_start = target_period_start
     and (
       allow_overdraw
       or b.included_tokens + b.purchased_tokens - b.used_tokens >= tokens
     )
  returning b.included_tokens + b.purchased_tokens - b.used_tokens,
            b.included_tokens + b.purchased_tokens
    into remaining, granted;

  if not found then
    return null;
  end if;

  insert into public.ai_token_ledger (
    business_id, period_start, delta_tokens, reason, ai_run_id, agent_run_id,
    task_type, deployment, idempotency_key, balance_after
  ) values (
    target_business_id, target_period_start, -tokens, consume_reason,
    source_ai_run_id, source_agent_run_id, source_task_type, source_deployment,
    idem_key, remaining
  )
  on conflict do nothing;

  return remaining;
end;
$$;

revoke all on function public.consume_ai_tokens(uuid, date, bigint, text, text, uuid, uuid, text, text, boolean)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------
-- Credits: a plan grant at period rollover, or a paid top-up.
create or replace function public.credit_ai_tokens(
  target_business_id uuid,
  target_period_start date,
  tokens bigint,
  credit_reason text,
  idem_key text default null,
  source_purchase_id uuid default null,
  -- Plan grants replace the period's included allowance; purchases add to the
  -- carried-forward purchased pool. They are different pots on purpose.
  credit_purchased boolean default true
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  remaining bigint;
begin
  if tokens <= 0 then
    return null;
  end if;

  if idem_key is not null then
    perform 1 from public.ai_token_ledger
     where business_id = target_business_id and idempotency_key = idem_key;
    if found then
      select included_tokens + purchased_tokens - used_tokens
        into remaining
        from public.ai_token_balances
       where business_id = target_business_id and period_start = target_period_start;
      return remaining;
    end if;
  end if;

  update public.ai_token_balances
     set purchased_tokens = purchased_tokens + case when credit_purchased then tokens else 0 end,
         included_tokens = included_tokens + case when credit_purchased then 0 else tokens end,
         -- Money in unblocks the workspace immediately.
         blocked_at = null
   where business_id = target_business_id
     and period_start = target_period_start
  returning included_tokens + purchased_tokens - used_tokens into remaining;

  if not found then
    return null;
  end if;

  insert into public.ai_token_ledger (
    business_id, period_start, delta_tokens, reason, purchase_id,
    idempotency_key, balance_after
  ) values (
    target_business_id, target_period_start, tokens, credit_reason,
    source_purchase_id, idem_key, remaining
  )
  on conflict do nothing;

  return remaining;
end;
$$;

revoke all on function public.credit_ai_tokens(uuid, date, bigint, text, text, uuid, boolean)
  from public, anon, authenticated;

-- ======================================================================
-- 5. RLS
-- ======================================================================
-- A workspace may read its own balance and its own purchases -- both are
-- things it is entitled to see and to act on. The ledger is operational
-- detail: server role only.

alter table public.ai_token_balances enable row level security;
alter table public.ai_token_balances force row level security;
create policy ai_token_balances_select on public.ai_token_balances
  for select to authenticated
  using (public.is_business_member(business_id));
grant select on public.ai_token_balances to authenticated;
revoke all on public.ai_token_balances from anon;

alter table public.ai_token_purchases enable row level security;
alter table public.ai_token_purchases force row level security;
create policy ai_token_purchases_select on public.ai_token_purchases
  for select to authenticated
  using (public.is_business_member(business_id));
grant select on public.ai_token_purchases to authenticated;
revoke all on public.ai_token_purchases from anon;

alter table public.ai_token_ledger enable row level security;
alter table public.ai_token_ledger force row level security;
revoke all on public.ai_token_ledger from anon, authenticated;

-- ======================================================================
-- 6. Plan allowances
-- ======================================================================
-- Changing a tier's allowance is a row edit, not a deploy. `hard_limit` is the
-- monthly token grant; overage is deliberately off -- a workspace tops up
-- explicitly rather than being billed for going over.
insert into public.plan_entitlements (plan_key, metric, soft_limit, hard_limit, overage_allowed, unit)
values
  ('trial',      'ai_tokens',    90000,   100000, false, 'tokens/month'),
  ('starter',    'ai_tokens',   900000,  1000000, false, 'tokens/month'),
  ('growth',     'ai_tokens',  3600000,  4000000, false, 'tokens/month'),
  ('pro',        'ai_tokens', 10800000, 12000000, false, 'tokens/month'),
  ('enterprise', 'ai_tokens', 36000000, 40000000, false, 'tokens/month')
on conflict (plan_key, metric) do update
  set soft_limit = excluded.soft_limit,
      hard_limit = excluded.hard_limit,
      overage_allowed = excluded.overage_allowed,
      unit = excluded.unit;

comment on table public.ai_token_balances is
  'Customer-facing AI token allowance per billing period. Included tokens reset
   each period; purchased tokens carry forward. Provider unit costs are NOT
   represented here -- see provider_price_book and cost_events, both admin-only.';
