-- 0169: affiliate commission becomes ONE-OFF; tiers become 6% / 8% / 10%;
-- a WRITE_OFF ledger entry for negative balances at the end of a partnership.
-- Owner decisions of 2026-09-28. Not applied by the agent that wrote it; apply
-- with scripts/apply-migration.mjs after 0168.
--
-- 1. Commission plans. Commission is paid once per referred customer, on the
--    FIRST paid subscription invoice: the rate times that whole payment,
--    VAT-exclusive and after discounts (an annual plan's full annual invoice,
--    not a twelfth). Renewals, add-ons and top-ups earn nothing. The code
--    (ledger-rules.ts `commissionForPayment`) already reads every plan as
--    one-off; this makes the rows say so.
--      * commission_type RECURRING_PERCENT -> FIRST_PAYMENT_PERCENT.
--      * recurring_months is KEPT as a column but forced to 1: nothing reads
--        it any more, and 1 is the only value consistent with a one-off.
--      * percentage plans pay 6% (the Partner tier). Rates are 6-10%, never
--        more: a CHECK caps a percentage plan at 10%.
--
-- 2. Tiers (affiliate_tiers). A tier now sets only the one-off RATE, and is
--    earned by paid referred customers in the last 12 months:
--        STANDARD  "Partner"        0 customers   6%
--        PARTNER   "Pro Partner"    5 customers   8%
--        PREMIUM   "Elite Partner" 15 customers  10%
--    min_referred_mrr_minor is KEPT but set to 0 and no longer read: with a
--    one-off commission a partner earns nothing from later revenue, so an MRR
--    threshold would reward what the programme no longer pays for (see
--    tier-rules.ts). recurring_months is kept, forced to 1. A CHECK caps a
--    tier's rate at 10%. The keys stay (0034's affiliates.tier CHECK).
--
-- 3. Ledger. entry_type gains WRITE_OFF: when a partnership ends with a
--    negative available balance, the deficit is written off (never invoiced)
--    as one positive entry that nets the balance to zero
--    (commissions.ts `closePartnership`).
--
-- 4. Existing data. Commission already accrued on RENEWALS under the old
--    recurring rule is cancelled if it is still unpaid:
--      * PENDING or APPROVED and not in a payout -> REVERSED.
--      * PAYABLE inside a payout that is still DRAFT (pending approval) ->
--        REVERSED, released from that payout, and the draft's amount reduced
--        by the same sum (a draft left at zero or less is CANCELLED).
--      * Anything in an approved, processing or paid payout, or PAID, is left
--        exactly as it is: money already committed is never clawed back for a
--        policy change.
--    First-payment (NEW_CUSTOMER) commission is untouched. Referrals keep their
--    attribution; they simply earn nothing more after their first payment.
--
-- Idempotent: every statement can run twice.

-- ------------------------------------------------------------- 1. plans
update public.affiliate_commission_plans
   set commission_type = 'FIRST_PAYMENT_PERCENT'
 where commission_type = 'RECURRING_PERCENT';

update public.affiliate_commission_plans
   set percent = 6
 where commission_type = 'FIRST_PAYMENT_PERCENT'
   and (percent is null or percent <> 6);

update public.affiliate_commission_plans
   set recurring_months = 1
 where recurring_months is distinct from 1;

update public.affiliate_commission_plans
   set name = 'Partner 6% one-off'
 where is_default and name = 'Standard 20% recurring';

alter table public.affiliate_commission_plans
  drop constraint if exists affiliate_commission_plans_one_off_rate_cap;
alter table public.affiliate_commission_plans
  add constraint affiliate_commission_plans_one_off_rate_cap
  check (commission_type = 'FLAT_AMOUNT' or percent is null or (percent > 0 and percent <= 10));

comment on column public.affiliate_commission_plans.recurring_months is
  'Unused since 0169: commission is one-off (first paid subscription invoice only). Kept, forced to 1.';

-- ------------------------------------------------------------- 2. tiers
insert into public.affiliate_tiers (key, name, rank, min_active_customers, min_referred_mrr_minor, commission_percent, recurring_months, description)
values
  ('STANDARD', 'Partner',       0, 0,  0, 6,  1, 'Every approved partner: 6% one-off commission.'),
  ('PARTNER',  'Pro Partner',   1, 5,  0, 8,  1, '5 paid referred customers in the last 12 months: 8% one-off commission.'),
  ('PREMIUM',  'Elite Partner', 2, 15, 0, 10, 1, '15 paid referred customers in the last 12 months: 10% one-off commission.')
on conflict (key) do update
   set name = excluded.name,
       rank = excluded.rank,
       min_active_customers = excluded.min_active_customers,
       min_referred_mrr_minor = 0,
       commission_percent = excluded.commission_percent,
       recurring_months = 1,
       description = excluded.description,
       updated_at = now();

alter table public.affiliate_tiers
  drop constraint if exists affiliate_tiers_one_off_rate_cap;
alter table public.affiliate_tiers
  add constraint affiliate_tiers_one_off_rate_cap
  check (commission_percent is null or (commission_percent >= 1 and commission_percent <= 10));

comment on column public.affiliate_tiers.min_active_customers is
  'Paid referred customers (first payment in the last 12 months) needed for this tier (0169).';
comment on column public.affiliate_tiers.min_referred_mrr_minor is
  'Unused since 0169: tiers qualify on paid customers only. Kept, set to 0.';
comment on column public.affiliate_tiers.recurring_months is
  'Unused since 0169: commission is one-off. Kept, forced to 1.';

-- ------------------------------------------------------------- 3. ledger
alter table public.affiliate_commissions
  drop constraint if exists affiliate_commissions_entry_type_check;
alter table public.affiliate_commissions
  add constraint affiliate_commissions_entry_type_check
  check (entry_type in ('NEW_CUSTOMER','RENEWAL','ADJUSTMENT','REVERSAL','REACCRUAL','WRITE_OFF'));

-- ------------------------------------------------------------- 4. existing renewal accruals
-- 4a. Unclaimed and unpaid.
update public.affiliate_commissions
   set status = 'REVERSED',
       reversal_reason = coalesce(reversal_reason, 'ONE_OFF_POLICY'),
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cancelled_by', '0169_one_off_commission')
 where entry_type = 'RENEWAL'
   and status in ('PENDING', 'APPROVED')
   and payout_id is null;

-- 4b. Claimed into a payout that is still a draft (not approved, not sent).
with released as (
  update public.affiliate_commissions c
     set status = 'REVERSED',
         reversal_reason = coalesce(c.reversal_reason, 'ONE_OFF_POLICY'),
         metadata = coalesce(c.metadata, '{}'::jsonb)
                    || jsonb_build_object('cancelled_by', '0169_one_off_commission', 'released_from_payout', c.payout_id),
         payout_id = null
    from public.affiliate_payouts p
   where c.payout_id = p.id
     and p.status = 'DRAFT'
     and c.entry_type = 'RENEWAL'
     and c.status = 'PAYABLE'
  returning p.id as payout_id, c.commission_amount_minor
), totals as (
  select payout_id, sum(commission_amount_minor) as removed from released group by payout_id
)
update public.affiliate_payouts p
   set amount_minor = p.amount_minor - t.removed
  from totals t
 where p.id = t.payout_id;

update public.affiliate_payouts
   set status = 'CANCELLED'
 where status = 'DRAFT'
   and amount_minor <= 0
   and not exists (
     select 1 from public.affiliate_commissions c where c.payout_id = affiliate_payouts.id
   );
