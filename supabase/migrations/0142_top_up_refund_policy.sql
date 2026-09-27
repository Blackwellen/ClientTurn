-- 0142_top_up_refund_policy: top-up credit is non-refundable once usage begins
-- (owner policy 2026-09-27). Covers SMS / WhatsApp credit bundles and AI token
-- packs.
--
--   1. terms_acceptances.source gains 'top_up': the Stripe Checkout terms
--      acceptance recorded with each top-up purchase.
--   2. Purchases record how much credit a refund has reversed
--      (credits_reversed / tokens_reversed).
--   3. message_credit_ledger.reason gains 'REFUND' (ai_token_ledger already
--      allows it).
--   4. Two RPCs reverse ONLY the unused credit of a refunded purchase, under
--      the balance row lock, never below zero, idempotent on a ledger key.
--
-- Attribution is FIFO -- the oldest purchase is consumed first, so the
-- remaining pool belongs to the newest purchases. The same rule, in TypeScript,
-- is src/lib/billing/refundability.ts; keep the two in step.

-- ============================================ 1. terms acceptance source
alter table public.terms_acceptances
  drop constraint if exists terms_acceptances_source_check;
alter table public.terms_acceptances
  add constraint terms_acceptances_source_check
  check (source in ('signup', 'checkout', 'top_up'));

-- ============================================ 2. reversed credit per purchase
alter table public.message_credit_purchases
  add column if not exists credits_reversed integer not null default 0
    check (credits_reversed >= 0);

alter table public.ai_token_purchases
  add column if not exists tokens_reversed bigint not null default 0
    check (tokens_reversed >= 0);

-- ============================================ 3. ledger reason
alter table public.message_credit_ledger
  drop constraint if exists message_credit_ledger_reason_check;
alter table public.message_credit_ledger
  add constraint message_credit_ledger_reason_check
  check (reason in ('PURCHASE', 'CONSUMPTION', 'ADJUSTMENT', 'REFUND'));

-- ============================================ 4a. message credit reversal
-- Reverses the unused credit of a refunded message-credit purchase.
--
--   entitled = floor(credits * amount_refunded / amount)   (full refund = all)
--   unused   = FIFO: the channel balance minus the net credit of every newer
--              purchase, capped at this purchase's net credit
--   reverse  = least(entitled, reversed + unused) - reversed, capped at the
--              balance
--
-- `amount_refunded_minor` is Stripe's cumulative charge.amount_refunded, and
-- idem_key includes it, so a replay reverses nothing more and a second partial
-- refund reverses only the difference. A zero reversal still writes its ledger
-- row, which is what makes the replay a no-op. Returns the credits reversed.
create or replace function public.reverse_message_credit_purchase(
  target_purchase_id uuid,
  amount_refunded_minor bigint,
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
  newer bigint;
  unused integer;
  entitled integer;
  target integer;
  reversing integer;
  prior integer;
begin
  select * into p from public.message_credit_purchases
   where id = target_purchase_id
   for update;
  if not found or p.credited_at is null then
    return 0;
  end if;

  -- Balance lock first, then the idempotency check, so a concurrent consume or
  -- a replayed reversal serialises behind this one.
  select balance into pool from public.message_credit_balances
   where business_id = p.business_id and channel = p.channel
   for update;
  if not found then
    return 0;
  end if;

  select -delta into prior from public.message_credit_ledger
   where business_id = p.business_id and idempotency_key = idem_key;
  if found then
    return 0;
  end if;

  select coalesce(sum(greatest(q.credits - q.credits_reversed, 0)), 0) into newer
    from public.message_credit_purchases q
   where q.business_id = p.business_id
     and q.channel = p.channel
     and q.id <> p.id
     and q.credited_at is not null
     and q.status in ('PAID', 'REFUNDED')
     and (q.credited_at, q.created_at, q.id) > (p.credited_at, p.created_at, p.id);

  unused := least(greatest(pool - newer, 0), greatest(p.credits - p.credits_reversed, 0));
  entitled := case
    when p.amount_minor > 0
      then floor(p.credits::numeric * least(greatest(amount_refunded_minor, 0), p.amount_minor) / p.amount_minor)::integer
    else p.credits
  end;
  target := least(entitled, p.credits_reversed + unused);
  reversing := least(greatest(target - p.credits_reversed, 0), pool);

  if reversing > 0 then
    update public.message_credit_balances
       set balance = balance - reversing, updated_at = now()
     where business_id = p.business_id and channel = p.channel;

    update public.message_credit_purchases
       set credits_reversed = credits_reversed + reversing
     where id = p.id;
  end if;

  insert into public.message_credit_ledger (
    business_id, channel, delta, reason, purchase_id, idempotency_key, balance_after
  ) values (
    p.business_id, p.channel, -reversing, 'REFUND', p.id, idem_key, pool - reversing
  );

  return reversing;
end;
$$;

revoke all on function public.reverse_message_credit_purchase(uuid, bigint, text)
  from public, anon, authenticated;

-- ============================================ 4b. AI token reversal
-- The same rule for an AI token pack. The pool is the purchased tokens still
-- unspent in the current period: included tokens are spent first, and tokens
-- held by in-flight calls count as in use. Only purchased_tokens is reduced,
-- and never by more than that pool, so no column goes negative.
create or replace function public.reverse_ai_token_purchase(
  target_purchase_id uuid,
  target_period_start date,
  amount_refunded_minor bigint,
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
  pool bigint;
  newer bigint;
  unused bigint;
  entitled bigint;
  target bigint;
  reversing bigint;
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

  pool := greatest(
    least(b.included_tokens + b.purchased_tokens - b.used_tokens - b.reserved_tokens, b.purchased_tokens),
    0
  );

  select coalesce(sum(greatest(q.tokens - q.tokens_reversed, 0)), 0) into newer
    from public.ai_token_purchases q
   where q.business_id = p.business_id
     and q.id <> p.id
     and q.credited_at is not null
     and q.status in ('PAID', 'REFUNDED')
     and (q.credited_at, q.created_at, q.id) > (p.credited_at, p.created_at, p.id);

  unused := least(greatest(pool - newer, 0), greatest(p.tokens - p.tokens_reversed, 0));
  entitled := case
    when p.amount_minor > 0
      then floor(p.tokens::numeric * least(greatest(amount_refunded_minor, 0), p.amount_minor) / p.amount_minor)::bigint
    else p.tokens
  end;
  target := least(entitled, p.tokens_reversed + unused);
  reversing := least(greatest(target - p.tokens_reversed, 0), pool);

  if reversing > 0 then
    update public.ai_token_balances
       set purchased_tokens = purchased_tokens - reversing
     where id = b.id;

    update public.ai_token_purchases
       set tokens_reversed = tokens_reversed + reversing
     where id = p.id;
  end if;

  insert into public.ai_token_ledger (
    business_id, period_start, delta_tokens, reason, purchase_id,
    idempotency_key, balance_after, metadata
  ) values (
    p.business_id, target_period_start, -reversing, 'REFUND', p.id, idem_key,
    b.included_tokens + b.purchased_tokens - reversing - b.used_tokens,
    jsonb_build_object('amount_refunded_minor', amount_refunded_minor)
  );

  return reversing;
end;
$$;

revoke all on function public.reverse_ai_token_purchase(uuid, date, bigint, text)
  from public, anon, authenticated;
