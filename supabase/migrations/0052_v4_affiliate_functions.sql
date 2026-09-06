-- 0045_v4_affiliate_functions: the counters and rollups the affiliate portal
-- needs (V4 §29-35, §41).
--
-- The link counters exist as functions rather than as application reads because
-- a click is a concurrent write on a hot row: `update ... set click_count =
-- click_count + 1` in Postgres is atomic, whereas read-modify-write from the
-- app loses counts under load. None of these functions is granted to a browser
-- role -- they are called by the service role from a route handler that has
-- already decided the caller is allowed to cause the increment.

-- ------------------------------------------------- link counter increments
create or replace function public.increment_affiliate_link_click(p_link_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.affiliate_links
     set click_count = click_count + 1
   where id = p_link_id;
$$;

create or replace function public.increment_affiliate_link_signup(p_link_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.affiliate_links
     set signup_count = signup_count + 1
   where id = p_link_id;
$$;

create or replace function public.increment_affiliate_link_paid(p_link_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.affiliate_links
     set paid_count = paid_count + 1
   where id = p_link_id;
$$;

revoke all on function public.increment_affiliate_link_click(uuid) from public, anon, authenticated;
revoke all on function public.increment_affiliate_link_signup(uuid) from public, anon, authenticated;
revoke all on function public.increment_affiliate_link_paid(uuid) from public, anon, authenticated;

-- ------------------------------------------------------ affiliate_summaries
-- One row per affiliate for the platform admin list: clicks, referrals and
-- money, aggregated in Postgres.
--
-- Counting these in the application would mean pulling every click and
-- commission row for every affiliate on the page -- the same truncation trap
-- §21.7 warns about for campaigns.
--
-- A reversed commission contributes to nothing. Counting it anywhere would
-- show earnings that will not be paid.
create or replace function public.affiliate_summaries()
returns table (
  affiliate_id uuid,
  click_count bigint,
  referral_count bigint,
  paying_count bigint,
  pending_minor bigint,
  payable_minor bigint,
  paid_minor bigint,
  lifetime_minor bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id as affiliate_id,
    coalesce(c.clicks, 0) as click_count,
    coalesce(r.referrals, 0) as referral_count,
    coalesce(r.paying, 0) as paying_count,
    coalesce(m.pending_minor, 0) as pending_minor,
    coalesce(m.payable_minor, 0) as payable_minor,
    coalesce(m.paid_minor, 0) as paid_minor,
    coalesce(m.lifetime_minor, 0) as lifetime_minor
  from public.affiliates a
  left join (
    select affiliate_id, count(*) as clicks
      from public.affiliate_clicks
     where not is_bot
     group by affiliate_id
  ) c on c.affiliate_id = a.id
  left join (
    select affiliate_id,
           count(*) as referrals,
           count(*) filter (where status = 'PAID') as paying
      from public.affiliate_referrals
     group by affiliate_id
  ) r on r.affiliate_id = a.id
  left join (
    select affiliate_id,
           sum(commission_amount_minor) filter (where status = 'PENDING') as pending_minor,
           sum(commission_amount_minor) filter (where status in ('APPROVED','PAYABLE')) as payable_minor,
           sum(commission_amount_minor) filter (where status = 'PAID') as paid_minor,
           sum(commission_amount_minor) filter (where status <> 'REVERSED') as lifetime_minor
      from public.affiliate_commissions
     group by affiliate_id
  ) m on m.affiliate_id = a.id;
$$;

-- Platform-admin surface only. An affiliate must never be able to enumerate
-- other partners' earnings, so this is not granted to `authenticated`.
revoke all on function public.affiliate_summaries() from public, anon, authenticated;

-- ------------------------------------------------ approve_due_commissions
-- Moves PENDING commissions past their plan's hold period to APPROVED.
--
-- Idempotent by construction: it only ever reads PENDING rows, so running it
-- twice in the same minute approves nothing the second time. Called from the
-- job worker, never from a request.
create or replace function public.approve_due_commissions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  approved_count integer;
begin
  with due as (
    select ac.id
      from public.affiliate_commissions ac
      join public.affiliate_commission_plans p on p.id = ac.commission_plan_id
     where ac.status = 'PENDING'
       and ac.created_at + make_interval(days => p.hold_days) <= now()
     for update of ac skip locked
  )
  update public.affiliate_commissions ac
     set status = 'APPROVED',
         approved_at = now()
    from due
   where ac.id = due.id;

  get diagnostics approved_count = row_count;
  return approved_count;
end;
$$;

revoke all on function public.approve_due_commissions() from public, anon, authenticated;
