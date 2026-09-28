-- 0165_billing_disputes_invoices_mrr: billing batch 2 (gap audit 15).
--
--   1. billing_invoices   every paid Stripe invoice's real amounts (amount
--                         paid, currency, discounts, tax), written by the
--                         webhook on `invoice.paid`. Admin revenue reads this
--                         instead of list prices.
--   2. subscriptions.mrr_* the subscription's real monthly recurring revenue
--                         (net of discounts, before VAT), set from each paid
--                         full-period subscription invoice. Admin MRR reads it,
--                         falling back to list price only where no invoice has
--                         been recorded yet.
--   3. billing_disputes   one row per Stripe dispute: what it was against,
--                         what was clawed back (FIFO, unused units only) and
--                         what was restored when it was won. Idempotent on
--                         the dispute id.
--   4. Two RPCs restoring clawed-back units when a dispute is won, the
--      inverse of 0142's reversal RPCs: under the same row locks, never more
--      than was reversed, idempotent on a ledger key.
--
-- All three tables are service-role only (no member reads): the billing page
-- reads through the server, and admin through its own service client.
-- Not applied by the agent that wrote it; apply with scripts/apply-migration.mjs.

-- ============================================ 1. billing_invoices
create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  stripe_invoice_id text not null unique check (char_length(stripe_invoice_id) between 1 and 200),
  stripe_subscription_id text check (stripe_subscription_id is null or char_length(stripe_subscription_id) <= 200),
  billing_reason text check (billing_reason is null or char_length(billing_reason) <= 60),
  currency text not null default 'gbp' check (char_length(currency) = 3),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_excluding_tax_minor bigint not null default 0 check (total_excluding_tax_minor >= 0),
  amount_paid_minor bigint not null default 0 check (amount_paid_minor >= 0),
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists billing_invoices_business_idx on public.billing_invoices (business_id, paid_at desc);
create index if not exists billing_invoices_paid_idx on public.billing_invoices (paid_at desc);

alter table public.billing_invoices enable row level security;
alter table public.billing_invoices force row level security;
revoke all on public.billing_invoices from anon, authenticated;

-- ============================================ 2. real MRR on the mirror
alter table public.subscriptions
  add column if not exists mrr_minor bigint check (mrr_minor is null or mrr_minor >= 0),
  add column if not exists mrr_currency text check (mrr_currency is null or char_length(mrr_currency) = 3),
  add column if not exists mrr_updated_at timestamptz;

comment on column public.subscriptions.mrr_minor is
  'Monthly recurring revenue actually billed (minor units, net of discounts, before VAT), from the last paid subscription_create/subscription_cycle invoice. Annual / 12. Null until one is recorded.';

-- ============================================ 3. billing_disputes
create table if not exists public.billing_disputes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  stripe_dispute_id text not null unique check (char_length(stripe_dispute_id) between 1 and 200),
  stripe_charge_id text check (stripe_charge_id is null or char_length(stripe_charge_id) <= 200),
  payment_intent_id text check (payment_intent_id is null or char_length(payment_intent_id) <= 200),
  purchase_kind text not null
    check (purchase_kind in ('ai_tokens', 'message_credits', 'voice_pack', 'subscription', 'unknown')),
  -- ai_token_purchases.id or message_credit_purchases.id; null for a voice
  -- pack (its ledger row is keyed by the PaymentIntent) or a subscription.
  purchase_id uuid,
  amount_minor bigint not null default 0 check (amount_minor >= 0),
  currency text check (currency is null or char_length(currency) = 3),
  reason text check (reason is null or char_length(reason) <= 100),
  stripe_status text check (stripe_status is null or char_length(stripe_status) <= 60),
  status text not null default 'OPEN' check (status in ('OPEN', 'WON', 'LOST')),
  -- Units taken back when it opened (tokens, credits or pack seconds) and
  -- units given back when it was won. restored_units <= reversed_units.
  reversed_units bigint not null default 0 check (reversed_units >= 0),
  restored_units bigint not null default 0 check (restored_units >= 0),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint billing_disputes_restore_bound check (restored_units <= reversed_units)
);
create index if not exists billing_disputes_business_idx on public.billing_disputes (business_id, opened_at desc);

drop trigger if exists billing_disputes_set_updated_at on public.billing_disputes;
create trigger billing_disputes_set_updated_at
  before update on public.billing_disputes
  for each row execute function public.set_updated_at();

alter table public.billing_disputes enable row level security;
alter table public.billing_disputes force row level security;
revoke all on public.billing_disputes from anon, authenticated;

-- ============================================ 4a. restore message credits
-- Gives back up to `units` of what disputes/refunds reversed on a purchase
-- (never more than credits_reversed), under the balance row lock, keyed on
-- `idem_key` in the ledger so a replay restores nothing more.
create or replace function public.restore_disputed_message_credits(
  target_purchase_id uuid,
  units integer,
  idem_key text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  p public.message_credit_purchases%rowtype;
  pool integer;
  restoring integer;
begin
  select * into p from public.message_credit_purchases
   where id = target_purchase_id
   for update;
  if not found or p.credited_at is null then
    return 0;
  end if;

  select balance into pool from public.message_credit_balances
   where business_id = p.business_id and channel = p.channel
   for update;
  if not found then
    return 0;
  end if;

  perform 1 from public.message_credit_ledger
   where business_id = p.business_id and idempotency_key = idem_key;
  if found then
    return 0;
  end if;

  restoring := least(greatest(coalesce(units, 0), 0), p.credits_reversed);

  if restoring > 0 then
    update public.message_credit_balances
       set balance = balance + restoring, updated_at = now()
     where business_id = p.business_id and channel = p.channel;

    update public.message_credit_purchases
       set credits_reversed = credits_reversed - restoring
     where id = p.id;
  end if;

  insert into public.message_credit_ledger (
    business_id, channel, delta, reason, purchase_id, idempotency_key, balance_after
  ) values (
    p.business_id, p.channel, restoring, 'ADJUSTMENT', p.id, idem_key, pool + restoring
  );

  return restoring;
end;
$$;

revoke all on function public.restore_disputed_message_credits(uuid, integer, text)
  from public, anon, authenticated;

-- ============================================ 4b. restore AI tokens
-- The same for an AI token pack, into the given period's purchased pool.
create or replace function public.restore_disputed_ai_tokens(
  target_purchase_id uuid,
  target_period_start date,
  tokens bigint,
  idem_key text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  p public.ai_token_purchases%rowtype;
  b public.ai_token_balances%rowtype;
  restoring bigint;
begin
  select * into p from public.ai_token_purchases
   where id = target_purchase_id
   for update;
  if not found or p.credited_at is null then
    return 0;
  end if;

  select * into b from public.ai_token_balances
   where business_id = p.business_id and period_start = target_period_start
   for update;
  if not found then
    return 0;
  end if;

  perform 1 from public.ai_token_ledger
   where business_id = p.business_id and idempotency_key = idem_key;
  if found then
    return 0;
  end if;

  restoring := least(greatest(coalesce(tokens, 0), 0), p.tokens_reversed);

  if restoring > 0 then
    update public.ai_token_balances
       set purchased_tokens = purchased_tokens + restoring,
           blocked_at = null
     where id = b.id;

    update public.ai_token_purchases
       set tokens_reversed = tokens_reversed - restoring
     where id = p.id;
  end if;

  insert into public.ai_token_ledger (
    business_id, period_start, delta_tokens, reason, purchase_id,
    idempotency_key, balance_after, metadata
  ) values (
    p.business_id, target_period_start, restoring, 'ADJUSTMENT', p.id, idem_key,
    b.included_tokens + b.purchased_tokens + restoring - b.used_tokens,
    jsonb_build_object('dispute_restore', true)
  );

  return restoring;
end;
$$;

revoke all on function public.restore_disputed_ai_tokens(uuid, date, bigint, text)
  from public, anon, authenticated;
