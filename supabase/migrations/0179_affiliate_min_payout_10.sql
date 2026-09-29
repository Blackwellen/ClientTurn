-- 0179: affiliate minimum payout is £10 (owner decision 2026-09-29).
--
-- The live default commission plan carried £50, and the seed in 0056 (and the
-- code fallback) said £100. Every surface (public programme page, terms,
-- portal, payouts run) reads minimum_payout_minor from the default plan, so
-- setting it here changes them all.
--
-- Scope: only the default plan and plans still sitting on an old programme
-- value (5000 / 10000). A plan an admin deliberately set to another figure is
-- left alone. Payouts already raised are not touched; the new floor applies
-- from the next monthly run.
--
-- Stripe Connect: transfers to connected accounts carry no floor that
-- conflicts with £10 (the code only refuses amounts <= 0).

update public.affiliate_commission_plans
   set minimum_payout_minor = 1000,
       updated_at = now()
 where minimum_payout_minor <> 1000
   and (is_default or minimum_payout_minor in (5000, 10000));

-- New plans default to the programme minimum as well.
alter table public.affiliate_commission_plans
  alter column minimum_payout_minor set default 1000;
