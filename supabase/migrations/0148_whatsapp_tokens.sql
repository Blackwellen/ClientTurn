-- 0148_whatsapp_tokens: WhatsApp is bought as WhatsApp TOKENS, spent per
-- message by Meta category (owner decisions 2026-09-27: "we must be
-- competitive with WhatsApp specialists"; and tokens, never a £ balance).
--
-- Design: src/lib/billing/whatsapp-tokens.ts; prices and margins in
-- docs/economics.md §5.4 and §10.3.
--
--   service reply / utility template   2 tokens (4p)
--   marketing template (and unknown)   5 tokens (10p)
--   packs: 1,000 / 2,000 / 5,000 tokens at £20 / £40 / £100 (2p a token; inline Stripe prices)
--
-- What this migration does
--
--   1. A one-row guard (billing_unit_conversions) so the conversion below can
--      never run twice, even if this file is re-applied by hand.
--   2. Converts every existing WhatsApp amount from MESSAGE credits to TOKENS
--      at 14 tokens per old credit: ceil(27p a credit / 2p a token) = 14 (28p),
--      so no customer loses value (14 tokens = 7 replies or 2.8 marketing
--      messages, where the old credit was one message of either). Converted together,
--      so FIFO refundability and the ledger's running balance stay consistent:
--        * message_credit_balances.balance
--        * message_credit_purchases.credits and credits_reversed (every status,
--          so a PENDING purchase is credited in tokens when its webhook lands)
--        * message_credit_ledger.delta and balance_after
--      Each converted workspace gets a zero-delta ADJUSTMENT ledger row keyed
--      `unit:whatsapp_tokens:0148` as the audit marker.
--   3. Documents the unit on the columns.
--
-- Unchanged, by design
--
--   * reverse_message_credit_purchase (0142) is unit-agnostic: it works on the
--     purchase's `credits` and the channel balance, which are now both tokens,
--     and prorates by amount_minor, which is unchanged. It needs no change.
--   * consume_message_credits / credit_message_credits (0129): integer units,
--     which are tokens for WhatsApp.
--   * usage_events `whatsapp_message` still counts MESSAGES (one per send);
--     the tokens a send spent are in its metadata and in the credit ledger.
--
-- DEPLOY TOGETHER with the code that ships it. Code without this migration
-- would spend tokens from a message-count balance; this migration without the
-- code would spend one "message" from a token balance and credit new purchases
-- at the old message counts.

-- ============================================ 1. guard
create table if not exists public.billing_unit_conversions (
  key text primary key,
  applied_at timestamptz not null default now(),
  note text
);

alter table public.billing_unit_conversions enable row level security;
alter table public.billing_unit_conversions force row level security;
revoke all on public.billing_unit_conversions from anon, authenticated;
-- Platform bookkeeping, service role only: no policies.

-- ============================================ 2. messages -> tokens
do $$
declare
  tokens_per_credit constant integer := 14;
  applied text;
begin
  insert into public.billing_unit_conversions (key, note)
  values (
    'whatsapp_tokens_0148',
    'WhatsApp message credits -> WhatsApp tokens at 14 tokens per credit (27p / 2p, rounded up)'
  )
  on conflict (key) do nothing
  returning key into applied;

  if applied is null then
    return; -- Already converted.
  end if;

  update public.message_credit_balances
     set balance = balance * tokens_per_credit, updated_at = now()
   where channel = 'whatsapp';

  update public.message_credit_purchases
     set credits = credits * tokens_per_credit,
         credits_reversed = credits_reversed * tokens_per_credit
   where channel = 'whatsapp';

  update public.message_credit_ledger
     set delta = delta * tokens_per_credit,
         balance_after = balance_after * tokens_per_credit
   where channel = 'whatsapp';

  insert into public.message_credit_ledger (
    business_id, channel, delta, reason, idempotency_key, balance_after
  )
  select b.business_id, 'whatsapp', 0, 'ADJUSTMENT', 'unit:whatsapp_tokens:0148', b.balance
    from public.message_credit_balances b
   where b.channel = 'whatsapp'
  on conflict (business_id, idempotency_key) do nothing;
end;
$$;

-- ============================================ 3. units, documented
comment on column public.message_credit_balances.balance is
  'SMS: UK segments. WhatsApp: WhatsApp tokens (0148; 2 per service reply or utility template, 5 per marketing template). Never pence.';
comment on column public.message_credit_purchases.credits is
  'SMS: UK segments. WhatsApp: WhatsApp tokens (0148). Pre-0148 WhatsApp purchases were converted at 14 tokens per message credit.';
comment on column public.message_credit_ledger.delta is
  'SMS: segments. WhatsApp: tokens (0148; earlier rows converted at 14 per message credit).';
