-- 0129_billing_trial_dunning_credits: card-first trials, daily dunning, message
-- top-up credits and enforced messaging limits (Phase 8.9, 8.10, 8.13).
--
-- Design: src/lib/billing/lifecycle.ts (trial state machine, grace policy,
-- dunning schedule) and src/lib/billing/limits.ts (consumption order).
--
-- 1. subscriptions: the verified payment method Checkout collected.
-- 2. terms_acceptances: who accepted which version of the terms, when, from
--    where (signup checkbox and Stripe Checkout consent).
-- 3. billing_dunning: one row per failed subscription invoice; the daily job
--    retries it at most once a day for up to 30 days and stops once paid.
-- 4. Message credits: purchases, balance per channel, append-only ledger, and
--    the two atomic RPCs that credit and consume them.
-- 5. usage_overage_events: messaging overage actually incurred, priced, so
--    the monthly spend cap is a real sum and each charge reaches Stripe once.
-- 6. plan_entitlements: messaging allowances and AI tokens re-seeded from
--    src/lib/billing/plans.ts (a test asserts the two agree).
--
-- Assumptions about existing data: every new column is nullable, nothing is
-- rewritten, and no constraint is added that an existing row could fail.

-- ================================================ 1. subscriptions: card
alter table public.subscriptions
  add column if not exists payment_method_id text,
  add column if not exists payment_method_brand text,
  add column if not exists payment_method_last4 text,
  -- Set when Stripe confirmed the card (SetupIntent succeeded in Checkout).
  add column if not exists payment_method_verified_at timestamptz;

-- ========================================== 2. terms_acceptances
create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  terms_version text not null,
  source text not null check (source in ('signup', 'checkout')),
  accepted_at timestamptz not null default now(),
  -- Where available: the request that accepted (signup) or that returned from
  -- Checkout. Stripe does not expose the consenting browser's IP.
  ip_address inet,
  user_agent text,
  stripe_checkout_session_id text unique,
  created_at timestamptz not null default now()
);

create index if not exists terms_acceptances_business_idx
  on public.terms_acceptances (business_id, accepted_at desc);

alter table public.terms_acceptances enable row level security;
alter table public.terms_acceptances force row level security;
drop policy if exists terms_acceptances_select on public.terms_acceptances;
create policy terms_acceptances_select on public.terms_acceptances
  for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));
grant select on public.terms_acceptances to authenticated;
revoke all on public.terms_acceptances from anon;
-- Written only server-side (signup action, Stripe webhook) via the service role.

-- ============================================== 3. billing_dunning
create table if not exists public.billing_dunning (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  stripe_invoice_id text not null unique,
  stripe_subscription_id text,
  stripe_customer_id text,
  amount_due_minor bigint,
  currency text,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'RECOVERED', 'EXHAUSTED', 'CLOSED')),
  first_failed_at timestamptz not null default now(),
  -- Retries made by the daily job (Stripe's own first attempt is not counted).
  attempts integer not null default 0 check (attempts >= 0),
  -- The UTC day of the last retry: at most one retry per invoice per day.
  last_attempt_on date,
  last_attempt_at timestamptz,
  last_error text,
  -- Notices already sent, so each goes out once: failed, restricted,
  -- final_warning, cancelled, recovered.
  notices_sent text[] not null default '{}',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_dunning_open_idx
  on public.billing_dunning (status, last_attempt_on)
  where status = 'OPEN';
create index if not exists billing_dunning_business_idx
  on public.billing_dunning (business_id, status);

create trigger billing_dunning_set_updated_at
  before update on public.billing_dunning
  for each row execute function public.set_updated_at();

alter table public.billing_dunning enable row level security;
alter table public.billing_dunning force row level security;
drop policy if exists billing_dunning_select on public.billing_dunning;
create policy billing_dunning_select on public.billing_dunning
  for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));
grant select on public.billing_dunning to authenticated;
revoke all on public.billing_dunning from anon;

-- ================================================ 4. message credits
create table if not exists public.message_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  bundle_key text not null,
  channel text not null check (channel in ('sms', 'whatsapp')),
  credits integer not null check (credits > 0),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'GBP',
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  purchased_by uuid references auth.users(id) on delete set null,
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_credit_purchases_business_idx
  on public.message_credit_purchases (business_id, created_at desc);

create trigger message_credit_purchases_set_updated_at
  before update on public.message_credit_purchases
  for each row execute function public.set_updated_at();

create table if not exists public.message_credit_balances (
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null check (channel in ('sms', 'whatsapp')),
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  primary key (business_id, channel)
);

create table if not exists public.message_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null check (channel in ('sms', 'whatsapp')),
  delta integer not null,
  reason text not null check (reason in ('PURCHASE', 'CONSUMPTION', 'ADJUSTMENT')),
  purchase_id uuid references public.message_credit_purchases(id) on delete set null,
  message_id uuid,
  idempotency_key text not null,
  balance_after integer not null,
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

create index if not exists message_credit_ledger_business_idx
  on public.message_credit_ledger (business_id, created_at desc);

-- Credits a paid purchase. Idempotent on idem_key: a replayed webhook or a
-- return-page sync that races the webhook credits once.
create or replace function public.credit_message_credits(
  target_business_id uuid,
  target_channel text,
  credit_amount integer,
  idem_key text,
  source_purchase_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  new_balance integer;
begin
  if credit_amount <= 0 then
    return null;
  end if;

  insert into public.message_credit_balances (business_id, channel, balance)
  values (target_business_id, target_channel, 0)
  on conflict (business_id, channel) do nothing;

  -- Row lock first, then the idempotency check, so two concurrent credits of
  -- the same purchase serialise and the second sees the first's ledger row.
  perform 1 from public.message_credit_balances
   where business_id = target_business_id and channel = target_channel
   for update;

  perform 1 from public.message_credit_ledger
   where business_id = target_business_id and idempotency_key = idem_key;
  if found then
    select balance into new_balance from public.message_credit_balances
     where business_id = target_business_id and channel = target_channel;
    return new_balance;
  end if;

  update public.message_credit_balances
     set balance = balance + credit_amount, updated_at = now()
   where business_id = target_business_id and channel = target_channel
  returning balance into new_balance;

  insert into public.message_credit_ledger (
    business_id, channel, delta, reason, purchase_id, idempotency_key, balance_after
  ) values (
    target_business_id, target_channel, credit_amount, 'PURCHASE',
    source_purchase_id, idem_key, new_balance
  );

  return new_balance;
end;
$$;

revoke all on function public.credit_message_credits(uuid, text, integer, text, uuid)
  from public, anon, authenticated;

-- Spends up to `wanted` credits after a send. Returns how many were actually
-- spent (never more than the balance: the balance cannot go negative).
-- Idempotent on idem_key, so a retried meter never spends twice.
create or replace function public.consume_message_credits(
  target_business_id uuid,
  target_channel text,
  wanted integer,
  idem_key text,
  source_message_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  current_balance integer;
  spent integer;
  prior integer;
begin
  if wanted <= 0 then
    return 0;
  end if;

  select balance into current_balance
    from public.message_credit_balances
   where business_id = target_business_id and channel = target_channel
   for update;

  if not found then
    return 0;
  end if;

  select -delta into prior from public.message_credit_ledger
   where business_id = target_business_id and idempotency_key = idem_key;
  if found then
    return prior;
  end if;

  spent := least(wanted, current_balance);
  if spent <= 0 then
    return 0;
  end if;

  update public.message_credit_balances
     set balance = balance - spent, updated_at = now()
   where business_id = target_business_id and channel = target_channel;

  insert into public.message_credit_ledger (
    business_id, channel, delta, reason, message_id, idempotency_key, balance_after
  ) values (
    target_business_id, target_channel, -spent, 'CONSUMPTION',
    source_message_id, idem_key, current_balance - spent
  );

  return spent;
end;
$$;

revoke all on function public.consume_message_credits(uuid, text, integer, text, uuid)
  from public, anon, authenticated;

alter table public.message_credit_purchases enable row level security;
alter table public.message_credit_purchases force row level security;
drop policy if exists message_credit_purchases_select on public.message_credit_purchases;
create policy message_credit_purchases_select on public.message_credit_purchases
  for select to authenticated
  using (public.is_business_member(business_id));
grant select on public.message_credit_purchases to authenticated;
revoke all on public.message_credit_purchases from anon;

alter table public.message_credit_balances enable row level security;
alter table public.message_credit_balances force row level security;
drop policy if exists message_credit_balances_select on public.message_credit_balances;
create policy message_credit_balances_select on public.message_credit_balances
  for select to authenticated
  using (public.is_business_member(business_id));
grant select on public.message_credit_balances to authenticated;
revoke all on public.message_credit_balances from anon;

-- The ledger is operational detail: service role only.
alter table public.message_credit_ledger enable row level security;
alter table public.message_credit_ledger force row level security;
revoke all on public.message_credit_ledger from anon, authenticated;

-- ============================================ 5. usage_overage_events
create table if not exists public.usage_overage_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null check (channel in ('sms', 'whatsapp')),
  -- First day of the calendar month the overage belongs to (the same period
  -- customer_usage_allocations and its spend cap are keyed on).
  billing_period date not null,
  units integer not null check (units > 0),
  unit_price_pence numeric(10, 4) not null,
  amount_minor bigint not null check (amount_minor >= 0),
  -- One overage record per message, however many times the meter runs.
  message_id uuid not null unique,
  -- Set once the charge has been added to the customer's next Stripe invoice.
  stripe_invoice_item_id text,
  created_at timestamptz not null default now()
);

create index if not exists usage_overage_events_period_idx
  on public.usage_overage_events (business_id, billing_period);
create index if not exists usage_overage_events_unbilled_idx
  on public.usage_overage_events (created_at)
  where stripe_invoice_item_id is null;

alter table public.usage_overage_events enable row level security;
alter table public.usage_overage_events force row level security;
drop policy if exists usage_overage_events_select on public.usage_overage_events;
create policy usage_overage_events_select on public.usage_overage_events
  for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));
grant select on public.usage_overage_events to authenticated;
revoke all on public.usage_overage_events from anon;

-- ============================================ 6. plan_entitlements
-- Values are src/lib/billing/plans.ts (TRIAL and PLANS); overage_price is in
-- GBP pounds per unit, as 0018 seeded it (plans.ts holds pence).
insert into public.plan_entitlements (plan_key, metric, soft_limit, hard_limit, overage_allowed, overage_price, unit)
values
  ('trial',      'sms_outbound_segment',     40,     50, false, null,   'segments/month'),
  ('starter',    'sms_outbound_segment',    200,    250, true,  0.09,   'segments/month'),
  ('growth',     'sms_outbound_segment',    640,    800, true,  0.08,   'segments/month'),
  ('pro',        'sms_outbound_segment',   1440,   1800, true,  0.075,  'segments/month'),
  ('enterprise', 'sms_outbound_segment',  80000, 100000, true,  0.07,   'segments/month'),
  ('trial',      'whatsapp_message',          0,      0, false, null,   'messages/month'),
  ('starter',    'whatsapp_message',          0,      0, false, null,   'messages/month'),
  ('growth',     'whatsapp_message',        800,   1000, true,  0.06,   'messages/month'),
  ('pro',        'whatsapp_message',       2400,   3000, true,  0.05,   'messages/month'),
  ('enterprise', 'whatsapp_message',      80000, 100000, true,  0.04,   'messages/month'),
  ('trial',      'ai_tokens',             80000,   100000, false, null, 'tokens/month'),
  ('starter',    'ai_tokens',            800000,  1000000, false, null, 'tokens/month'),
  ('growth',     'ai_tokens',           3200000,  4000000, false, null, 'tokens/month'),
  ('pro',        'ai_tokens',           9600000, 12000000, false, null, 'tokens/month'),
  ('enterprise', 'ai_tokens',          32000000, 40000000, false, null, 'tokens/month')
on conflict (plan_key, metric) do update
  set soft_limit = excluded.soft_limit,
      hard_limit = excluded.hard_limit,
      overage_allowed = excluded.overage_allowed,
      overage_price = excluded.overage_price,
      unit = excluded.unit;
