-- 0056_affiliate_programme: the partner portal proper (V4 §29-36).
--
-- 0034 laid the tables down; this migration turns them into a programme an
-- affiliate can actually be paid through. Three things it adds:
--
-- 1. **Payout readiness as its own axis.** An affiliate's account status
--    (ACTIVE) and their ability to receive money (Stripe connected, identity
--    verified, tax submitted, threshold met) are genuinely different facts.
--    Conflating them is how a partner ends up staring at "Active" while a
--    payout silently never runs, so `payout_readiness`, `identity_status` and
--    the tax columns live beside `status` rather than inside it.
--
-- 2. **A commission ledger that is append-only in practice.** A reversal is a
--    new row pointing at the one it reverses (`reversal_of_id`), never an edit
--    to a historical amount. `idempotency_key` is unique, so a replayed
--    billing event cannot credit the same money twice.
--
-- 3. **Aggregation in Postgres.** The portal shows the same eight metrics on
--    three pages. They are computed by `affiliate_metrics()` here so the three
--    pages cannot drift into three definitions, and so a dashboard card never
--    means "read every click row this affiliate has ever earned".

-- ------------------------------------------------------------- affiliates
-- The canonical account states. APPLIED/PENDING_REVIEW are pre-decision,
-- APPROVED is decided but not yet live, ACTIVE earns, and the rest are
-- terminal or suspended.
alter table public.affiliates
  drop constraint if exists affiliates_status_check;

alter table public.affiliates
  add constraint affiliates_status_check
  check (status in ('APPLIED','PENDING_REVIEW','APPROVED','ACTIVE','SUSPENDED','REJECTED','CLOSED'));

alter table public.affiliates
  add column if not exists tier text not null default 'STANDARD'
    check (tier in ('STANDARD','PARTNER','PREMIUM')),
  add column if not exists timezone text not null default 'Europe/London',
  add column if not exists phone text,
  add column if not exists preferred_language text not null default 'en-GB',
  add column if not exists suspended_at timestamptz,
  add column if not exists closed_at timestamptz,
  -- Stripe Connect. The account id is server-only: it is never selected into a
  -- page payload, because it is enough to address the connected account in the
  -- Stripe API and an affiliate has no use for it.
  add column if not exists stripe_connect_account_id text unique,
  add column if not exists stripe_connect_status text not null default 'NOT_CONNECTED'
    check (stripe_connect_status in ('NOT_CONNECTED','ONBOARDING','RESTRICTED','READY','DISABLED')),
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_requirements jsonb not null default '[]'::jsonb,
  add column if not exists stripe_synced_at timestamptz,
  -- Identity. Derived from the payout provider where it collects it, so we do
  -- not hold document images ourselves.
  add column if not exists identity_status text not null default 'NOT_STARTED'
    check (identity_status in ('NOT_STARTED','REQUIRED','PENDING','VERIFIED','FAILED','REQUIRES_UPDATE')),
  add column if not exists identity_document_state text,
  add column if not exists identity_selfie_state text,
  add column if not exists identity_address_state text,
  add column if not exists identity_checked_at timestamptz,
  -- Tax. Only the country, entity type and the last four characters of the
  -- identifier are stored. The full identifier is never held here: the payout
  -- provider's hosted flow owns it.
  add column if not exists tax_country text,
  add column if not exists tax_entity_type text
    check (tax_entity_type is null or tax_entity_type in ('INDIVIDUAL','SOLE_TRADER','COMPANY','PARTNERSHIP')),
  add column if not exists tax_identifier_last4 text
    check (tax_identifier_last4 is null or tax_identifier_last4 ~ '^[A-Z0-9]{1,4}$'),
  add column if not exists tax_submitted_at timestamptz,
  add column if not exists payout_readiness text not null default 'ACTION_REQUIRED'
    check (payout_readiness in ('ACTION_REQUIRED','PENDING','READY','BLOCKED')),
  -- Preferences. jsonb rather than columns because these are read as a whole
  -- object by exactly one surface and never queried on.
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb,
  add column if not exists preferences jsonb not null default '{}'::jsonb;

create index if not exists affiliates_connect_idx
  on public.affiliates (stripe_connect_account_id)
  where stripe_connect_account_id is not null;

-- --------------------------------------------------------- affiliate_links
alter table public.affiliate_links
  add column if not exists promo_code_id uuid references public.affiliate_promo_codes(id) on delete set null,
  add column if not exists trial_count integer not null default 0,
  add column if not exists last_click_at timestamptz;

-- ---------------------------------------------------- affiliate_promo_codes
-- Affiliates never invent a discount. They request a code from an approved
-- offer template, and the template carries the commercial terms.
create table if not exists public.affiliate_promo_offers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null,
  discount_percent numeric(5,2),
  discount_amount_minor bigint,
  duration_months integer,
  stripe_coupon_id text,
  max_redemptions integer,
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.affiliate_promo_codes
  add column if not exists offer_id uuid references public.affiliate_promo_offers(id) on delete set null;

create index if not exists affiliate_promo_codes_affiliate_idx
  on public.affiliate_promo_codes (affiliate_id, status);

-- ----------------------------------------------------- affiliate_referrals
-- The design shows trial, payment and commission as three independent columns,
-- because they genuinely are: a referral can be a converted trial whose
-- commission is still in review. One rolled-up `status` cannot express that,
-- so the three axes are stored separately and `status` remains the headline.
alter table public.affiliate_referrals
  add column if not exists source_link_id uuid references public.affiliate_links(id) on delete set null,
  add column if not exists promo_code_id uuid references public.affiliate_promo_codes(id) on delete set null,
  add column if not exists trial_state text not null default 'NOT_STARTED'
    check (trial_state in ('NOT_STARTED','ACTIVE_TRIAL','CONVERTED','EXPIRED','CANCELLED')),
  add column if not exists paid_state text not null default 'NOT_PAID'
    check (paid_state in ('NOT_PAID','PAID','REFUNDED','CHARGEBACK','CANCELLED')),
  add column if not exists renewed_at timestamptz,
  add column if not exists renewal_count integer not null default 0,
  add column if not exists flagged_reason text;

create index if not exists affiliate_referrals_signup_idx
  on public.affiliate_referrals (affiliate_id, signup_at desc);
create index if not exists affiliate_referrals_paid_idx
  on public.affiliate_referrals (affiliate_id, paid_at desc);

-- --------------------------------------------------- affiliate_commissions
alter table public.affiliate_commissions
  add column if not exists entry_type text not null default 'NEW_CUSTOMER'
    check (entry_type in ('NEW_CUSTOMER','RENEWAL','ADJUSTMENT','REVERSAL')),
  add column if not exists reversal_of_id uuid references public.affiliate_commissions(id) on delete set null,
  add column if not exists idempotency_key text,
  add column if not exists available_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- The real double-credit guard. `stripe_invoice_id` alone was not enough once
-- a single invoice can produce both an accrual and a later reversal.
create unique index if not exists affiliate_commissions_idempotency_idx
  on public.affiliate_commissions (idempotency_key)
  where idempotency_key is not null;

create index if not exists affiliate_commissions_available_idx
  on public.affiliate_commissions (affiliate_id, available_at)
  where status in ('APPROVED','PAYABLE');
create index if not exists affiliate_commissions_referral_idx
  on public.affiliate_commissions (referral_id);

-- ------------------------------------------------------ affiliate_payouts
alter table public.affiliate_payouts
  add column if not exists gross_amount_minor bigint not null default 0,
  add column if not exists adjustments_minor bigint not null default 0,
  add column if not exists processor_payout_id text,
  add column if not exists scheduled_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists notes text,
  add column if not exists idempotency_key text;

create unique index if not exists affiliate_payouts_idempotency_idx
  on public.affiliate_payouts (idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------- affiliate_resources
alter table public.affiliate_resources
  add column if not exists usage_rights text not null default 'Commercial use allowed',
  add column if not exists published_at timestamptz,
  add column if not exists supersedes_resource_id uuid references public.affiliate_resources(id) on delete set null,
  add column if not exists file_type_label text;

update public.affiliate_resources
   set published_at = coalesce(published_at, updated_at)
 where status = 'PUBLISHED' and published_at is null;

create index if not exists affiliate_resources_category_idx
  on public.affiliate_resources (category, status, published_at desc);

-- A partner's own shortlist. Scoped to them, so it is safe under the same
-- `current_affiliate_id()` policy as everything else they own.
create table if not exists public.affiliate_resource_saves (
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  resource_id uuid not null references public.affiliate_resources(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (affiliate_id, resource_id)
);

-- -------------------------------------------------- affiliate_notifications
-- The events the programme raises. Separate from the customer notification
-- table, which is workspace-scoped and would have nowhere to put an actor who
-- has no workspace.
create table if not exists public.affiliate_notifications (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_notifications_idx
  on public.affiliate_notifications (affiliate_id, created_at desc);

-- ------------------------------------------------------------------ RLS
alter table public.affiliate_promo_offers enable row level security;
alter table public.affiliate_resource_saves enable row level security;
alter table public.affiliate_notifications enable row level security;

-- Offer templates are commercial terms. An affiliate sees the active ones so
-- they can request a code, and nothing else about them.
grant select on public.affiliate_promo_offers to authenticated;
revoke all on public.affiliate_promo_offers from anon;
drop policy if exists affiliate_promo_offers_select on public.affiliate_promo_offers;
create policy affiliate_promo_offers_select on public.affiliate_promo_offers
  for select to authenticated
  using (active and public.is_active_affiliate());

grant select on public.affiliate_resource_saves to authenticated;
revoke all on public.affiliate_resource_saves from anon;
drop policy if exists affiliate_resource_saves_select on public.affiliate_resource_saves;
create policy affiliate_resource_saves_select on public.affiliate_resource_saves
  for select to authenticated
  using (affiliate_id = public.current_affiliate_id() or public.is_platform_admin());

grant select on public.affiliate_notifications to authenticated;
revoke all on public.affiliate_notifications from anon;
drop policy if exists affiliate_notifications_select on public.affiliate_notifications;
create policy affiliate_notifications_select on public.affiliate_notifications
  for select to authenticated
  using (affiliate_id = public.current_affiliate_id() or public.is_platform_admin());

-- ------------------------------------------------------- affiliate_metrics
-- The one definition of the eight headline numbers.
--
-- Every portal surface that shows "clicks", "conversion rate" or "approved
-- commission" reads this function for the window it is displaying. That is the
-- whole point: the dashboard, the referrals page and the performance page
-- showed three subtly different conversion rates in every prior draft of this
-- product, and the only durable fix is for there to be one place the number
-- can come from.
--
-- Canonical definitions, fixed here:
--   clicks          non-bot clicks in the window
--   unique_clicks   distinct visitor hashes among those
--   signups         referrals whose signup_at falls in the window
--   trials          referrals whose trial_at falls in the window
--   paid_customers  referrals whose paid_at falls in the window
--   conversion_rate paid_customers / unique_clicks   <- programme definition
--   *_commission    ledger sums by state, reversals excluded from all of them
create or replace function public.affiliate_metrics(
  p_affiliate_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  clicks bigint,
  unique_clicks bigint,
  signups bigint,
  trials bigint,
  paid_customers bigint,
  renewals bigint,
  conversion_rate numeric,
  pending_minor bigint,
  approved_minor bigint,
  paid_minor bigint,
  reversed_minor bigint,
  revenue_attributed_minor bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select count(*) as clicks,
           count(distinct visitor_hash) as unique_clicks
      from public.affiliate_clicks
     where affiliate_id = p_affiliate_id
       and not is_bot
       and occurred_at >= p_from and occurred_at < p_to
  ),
  r as (
    select
      count(*) filter (where signup_at >= p_from and signup_at < p_to) as signups,
      count(*) filter (where trial_at  >= p_from and trial_at  < p_to) as trials,
      count(*) filter (where paid_at   >= p_from and paid_at   < p_to) as paid_customers,
      coalesce(sum(renewal_count) filter (where renewed_at >= p_from and renewed_at < p_to), 0) as renewals,
      coalesce(sum(lifetime_revenue_minor) filter (where paid_at >= p_from and paid_at < p_to), 0) as revenue
      from public.affiliate_referrals
     where affiliate_id = p_affiliate_id
  ),
  m as (
    select
      coalesce(sum(commission_amount_minor) filter (where status = 'PENDING'), 0) as pending,
      coalesce(sum(commission_amount_minor) filter (where status in ('APPROVED','PAYABLE')), 0) as approved,
      coalesce(sum(commission_amount_minor) filter (where status = 'PAID'), 0) as paid,
      coalesce(sum(commission_amount_minor) filter (where status = 'REVERSED'), 0) as reversed
      from public.affiliate_commissions
     where affiliate_id = p_affiliate_id
       and created_at >= p_from and created_at < p_to
  )
  select
    c.clicks,
    c.unique_clicks,
    r.signups,
    r.trials,
    r.paid_customers,
    r.renewals,
    -- Null rather than zero when nothing has been clicked: "0%" claims a
    -- measurement that was never taken.
    case when c.unique_clicks > 0
         then round((r.paid_customers::numeric / c.unique_clicks::numeric), 6)
         else null end as conversion_rate,
    m.pending, m.approved, m.paid, m.reversed,
    r.revenue
  from c, r, m;
$$;

revoke all on function public.affiliate_metrics(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

-- -------------------------------------------------- affiliate_daily_series
-- Daily buckets for the trend charts, generated in SQL so a 90-day range does
-- not mean shipping 90 days of raw click rows to the app to be counted there.
create or replace function public.affiliate_daily_series(
  p_affiliate_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  day date,
  clicks bigint,
  signups bigint,
  paid_customers bigint,
  pending_minor bigint,
  approved_minor bigint,
  paid_minor bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select generate_series(
      date_trunc('day', p_from),
      date_trunc('day', p_to - interval '1 microsecond'),
      interval '1 day'
    )::date as day
  )
  select
    d.day,
    coalesce(cl.n, 0) as clicks,
    coalesce(su.n, 0) as signups,
    coalesce(pd.n, 0) as paid_customers,
    coalesce(cm.pending, 0) as pending_minor,
    coalesce(cm.approved, 0) as approved_minor,
    coalesce(cm.paid, 0) as paid_minor
  from days d
  left join (
    select occurred_at::date as day, count(*) as n
      from public.affiliate_clicks
     where affiliate_id = p_affiliate_id and not is_bot
       and occurred_at >= p_from and occurred_at < p_to
     group by 1
  ) cl on cl.day = d.day
  left join (
    select signup_at::date as day, count(*) as n
      from public.affiliate_referrals
     where affiliate_id = p_affiliate_id
       and signup_at >= p_from and signup_at < p_to
     group by 1
  ) su on su.day = d.day
  left join (
    select paid_at::date as day, count(*) as n
      from public.affiliate_referrals
     where affiliate_id = p_affiliate_id
       and paid_at >= p_from and paid_at < p_to
     group by 1
  ) pd on pd.day = d.day
  left join (
    select created_at::date as day,
           coalesce(sum(commission_amount_minor) filter (where status = 'PENDING'), 0) as pending,
           coalesce(sum(commission_amount_minor) filter (where status in ('APPROVED','PAYABLE')), 0) as approved,
           coalesce(sum(commission_amount_minor) filter (where status = 'PAID'), 0) as paid
      from public.affiliate_commissions
     where affiliate_id = p_affiliate_id
       and created_at >= p_from and created_at < p_to
     group by 1
  ) cm on cm.day = d.day
  order by d.day;
$$;

revoke all on function public.affiliate_daily_series(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ------------------------------------------------ affiliate_link_metrics
-- Per-link performance for the window, including the commission each link's
-- referrals actually earned. Doing this in the app would mean one query per
-- link per page render.
create or replace function public.affiliate_link_metrics(
  p_affiliate_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  link_id uuid,
  label text,
  slug text,
  destination_path text,
  utm_campaign text,
  promo_code text,
  campaign_name text,
  clicks bigint,
  signups bigint,
  trials bigint,
  paid_customers bigint,
  commission_minor bigint,
  revenue_minor bigint,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    l.label,
    l.slug,
    l.destination_path,
    l.utm_campaign,
    pc.code,
    ca.name,
    coalesce(cl.n, 0),
    coalesce(rf.signups, 0),
    coalesce(rf.trials, 0),
    coalesce(rf.paid, 0),
    coalesce(cm.commission, 0),
    coalesce(rf.revenue, 0),
    l.updated_at
  from public.affiliate_links l
  left join public.affiliate_promo_codes pc on pc.id = l.promo_code_id
  left join public.affiliate_campaigns ca on ca.id = l.campaign_id
  left join (
    select link_id, count(*) as n
      from public.affiliate_clicks
     where affiliate_id = p_affiliate_id and not is_bot
       and occurred_at >= p_from and occurred_at < p_to
     group by 1
  ) cl on cl.link_id = l.id
  left join (
    select source_link_id,
           count(*) filter (where signup_at >= p_from and signup_at < p_to) as signups,
           count(*) filter (where trial_at  >= p_from and trial_at  < p_to) as trials,
           count(*) filter (where paid_at   >= p_from and paid_at   < p_to) as paid,
           coalesce(sum(lifetime_revenue_minor) filter (where paid_at >= p_from and paid_at < p_to), 0) as revenue
      from public.affiliate_referrals
     where affiliate_id = p_affiliate_id
     group by 1
  ) rf on rf.source_link_id = l.id
  left join (
    select r.source_link_id, coalesce(sum(c.commission_amount_minor), 0) as commission
      from public.affiliate_commissions c
      join public.affiliate_referrals r on r.id = c.referral_id
     where c.affiliate_id = p_affiliate_id
       and c.status <> 'REVERSED'
       and c.created_at >= p_from and c.created_at < p_to
     group by 1
  ) cm on cm.source_link_id = l.id
  where l.affiliate_id = p_affiliate_id
    and not l.archived
  order by coalesce(cl.n, 0) desc, l.created_at desc;
$$;

revoke all on function public.affiliate_link_metrics(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ------------------------------------------------ affiliate_balances
-- The only place a payable balance is computed.
--
-- AVAILABLE is deliberately narrower than APPROVED: approved money that has
-- not yet passed its `available_at` is confirmed but not yet payable, and a
-- payout run that ignored that distinction would pay commission still inside
-- its clearing window.
create or replace function public.affiliate_balances(p_affiliate_id uuid)
returns table (
  pending_minor bigint,
  approved_minor bigint,
  available_minor bigint,
  paid_minor bigint,
  reversed_minor bigint,
  lifetime_minor bigint,
  available_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(commission_amount_minor) filter (where status = 'PENDING'), 0),
    coalesce(sum(commission_amount_minor) filter (where status in ('APPROVED','PAYABLE')), 0),
    coalesce(sum(commission_amount_minor) filter (
      where status in ('APPROVED','PAYABLE')
        and payout_id is null
        and coalesce(available_at, created_at) <= now()
    ), 0),
    coalesce(sum(commission_amount_minor) filter (where status = 'PAID'), 0),
    coalesce(sum(commission_amount_minor) filter (where status = 'REVERSED'), 0),
    coalesce(sum(commission_amount_minor) filter (where status <> 'REVERSED'), 0),
    coalesce(count(*) filter (
      where status in ('APPROVED','PAYABLE')
        and payout_id is null
        and coalesce(available_at, created_at) <= now()
    ), 0)::integer
  from public.affiliate_commissions
 where affiliate_id = p_affiliate_id;
$$;

revoke all on function public.affiliate_balances(uuid) from public, anon, authenticated;

-- ------------------------------------------------ claim_commissions_for_payout
-- Attaches every currently-available commission to a payout, atomically.
--
-- `payout_id is null` inside the update is what makes this safe to run twice:
-- a second concurrent run finds nothing to claim rather than moving the same
-- money into two payouts. Returns the amount actually claimed, which is what
-- the payout must be worth -- the caller never supplies an amount.
create or replace function public.claim_commissions_for_payout(
  p_affiliate_id uuid,
  p_payout_id uuid
)
returns table (claimed_minor bigint, claimed_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint;
  n integer;
begin
  with claimable as (
    select id
      from public.affiliate_commissions
     where affiliate_id = p_affiliate_id
       and status in ('APPROVED','PAYABLE')
       and payout_id is null
       and coalesce(available_at, created_at) <= now()
     for update skip locked
  ),
  updated as (
    update public.affiliate_commissions c
       set payout_id = p_payout_id,
           status = 'PAYABLE'
      from claimable
     where c.id = claimable.id
    returning c.commission_amount_minor
  )
  select coalesce(sum(commission_amount_minor), 0), count(*)::integer
    into total, n
    from updated;

  return query select total, n;
end;
$$;

revoke all on function public.claim_commissions_for_payout(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------- default policy
-- The programme's own terms. Attribution is 90 days last-touch, commission is
-- 20% recurring for 12 months, held 30 days against refunds, paid monthly once
-- £100 has cleared. Every surface reads these from here.
insert into public.affiliate_commission_plans (
  name, description, commission_type, percent, currency, recurring_months,
  attribution_window_days, cookie_window_days, hold_days, minimum_payout_minor,
  is_default, active
)
select
  'ClientTurn Partner Programme',
  '20% of every payment for the first 12 months of each referred customer.',
  'RECURRING_PERCENT', 20.00, 'GBP', 12,
  90, 90, 30, 10000,
  true, true
where not exists (
  select 1 from public.affiliate_commission_plans where is_default
);

-- An existing default from an earlier environment is brought up to the terms
-- the programme page and the FAQ now state.
update public.affiliate_commission_plans
   set attribution_window_days = 90,
       cookie_window_days = 90
 where is_default and attribution_window_days < 90;
