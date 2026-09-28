-- 0166_affiliate_programme_hardening: affiliate audit 17 (docs/revenue-engine/17-affiliate-audit.md).
--
--   1. affiliate_programme_settings  singleton admin switches: payout
--                                    auto-approval and auto-dispatch (both
--                                    OFF), identifier retention.
--   2. affiliate_tiers + history     partner tiers (thresholds by active
--                                    referred customers OR referred MRR, rate
--                                    and recurring-month overrides), history
--                                    of every change, an admin lock.
--   3. affiliate_fraud_flags         the fraud/self-referral review queue.
--                                    Service-role only: an affiliate never
--                                    learns which signal fired.
--   4. affiliate_fingerprints        keyed hashes of the networks/devices an
--                                    affiliate uses the portal from, and of
--                                    their Stripe customers and cards, for
--                                    self-referral checks. Never a raw IP.
--   5. clicks / attributions         ip_hash + suspect reasons on a click;
--                                    signup hashes on an attribution;
--                                    purge_affiliate_identifiers() nulls the
--                                    hashes after 120 days and deletes click
--                                    rows after 400 (GDPR minimisation).
--   6. ledger                        REACCRUAL entry type (a won dispute
--                                    gives back what the dispute took);
--                                    source indexes; approve/claim respect
--                                    `available_at` and skip held referrals.
--
-- Not applied by the agent that wrote it; apply with scripts/apply-migration.mjs.
-- Written after 0165 (billing_invoices, subscriptions.mrr_minor). The application
-- code tolerates this migration being absent (it skips and logs).

-- ============================================ 1. programme settings
create table if not exists public.affiliate_programme_settings (
  id boolean primary key default true check (id),
  -- A payout raised by the monthly run waits in DRAFT ("pending approval")
  -- for an admin unless this is on.
  auto_approve_payouts boolean not null default false,
  -- Sending also needs AFFILIATE_AUTO_PAYOUT=true in the deployment.
  auto_dispatch_payouts boolean not null default false,
  fingerprint_retention_days integer not null default 120
    check (fingerprint_retention_days between 30 and 400),
  click_retention_days integer not null default 400
    check (click_retention_days between 90 and 1100),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.affiliate_programme_settings (id) values (true) on conflict (id) do nothing;

alter table public.affiliate_programme_settings enable row level security;
alter table public.affiliate_programme_settings force row level security;
revoke all on public.affiliate_programme_settings from anon, authenticated;

-- ============================================ 2. tiers
create table if not exists public.affiliate_tiers (
  key text primary key check (key in ('STANDARD','PARTNER','PREMIUM')),
  name text not null check (char_length(name) between 1 and 40),
  rank integer not null unique,
  min_active_customers integer not null default 0 check (min_active_customers >= 0),
  min_referred_mrr_minor bigint not null default 0 check (min_referred_mrr_minor >= 0),
  -- Null: the partner's plan rate. Never below the plan (enforced in code).
  commission_percent numeric(5,2) check (commission_percent is null or (commission_percent > 0 and commission_percent <= 50)),
  recurring_months integer check (recurring_months is null or recurring_months between 1 and 60),
  description text check (description is null or char_length(description) <= 300),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Placeholder thresholds and NO rate uplift: what a tier pays is an owner
-- decision (audit 17). Admin -> Affiliates -> Tiers edits these.
insert into public.affiliate_tiers (key, name, rank, min_active_customers, min_referred_mrr_minor, description) values
  ('STANDARD', 'Standard', 0, 0, 0, 'Every approved partner.'),
  ('PARTNER', 'Partner', 1, 5, 50000, '5 active referred customers, or £500 referred MRR.'),
  ('PREMIUM', 'Premium', 2, 15, 200000, '15 active referred customers, or £2,000 referred MRR.')
on conflict (key) do nothing;

alter table public.affiliate_tiers enable row level security;
revoke all on public.affiliate_tiers from anon;
grant select on public.affiliate_tiers to authenticated;
drop policy if exists affiliate_tiers_select on public.affiliate_tiers;
create policy affiliate_tiers_select on public.affiliate_tiers
  for select to authenticated
  using (public.is_active_affiliate() or public.is_platform_admin());

alter table public.affiliates
  add column if not exists tier_locked boolean not null default false,
  add column if not exists tier_evaluated_at timestamptz,
  add column if not exists tier_active_customers integer not null default 0,
  add column if not exists tier_referred_mrr_minor bigint not null default 0;

create table if not exists public.affiliate_tier_history (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  from_tier text,
  to_tier text not null,
  active_customers integer not null default 0,
  referred_mrr_minor bigint not null default 0,
  reason text not null check (reason in ('SCHEDULED','ADMIN_OVERRIDE','ADMIN_UNLOCK')),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_tier_history_idx
  on public.affiliate_tier_history (affiliate_id, created_at desc);

alter table public.affiliate_tier_history enable row level security;
revoke all on public.affiliate_tier_history from anon;
grant select on public.affiliate_tier_history to authenticated;
drop policy if exists affiliate_tier_history_select on public.affiliate_tier_history;
create policy affiliate_tier_history_select on public.affiliate_tier_history
  for select to authenticated
  using (affiliate_id = public.current_affiliate_id() or public.is_platform_admin());

-- ============================================ 3. fraud flags
create table if not exists public.affiliate_fraud_flags (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  referral_id uuid references public.affiliate_referrals(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  code text not null check (char_length(code) between 1 and 40),
  severity text not null check (severity in ('BLOCK','REVIEW','INFO')),
  status text not null default 'OPEN' check (status in ('OPEN','CLEARED','CONFIRMED')),
  source text not null default 'SIGNUP' check (source in ('SIGNUP','PAYMENT','CLICK','ADMIN')),
  review_note text check (review_note is null or char_length(review_note) <= 500),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists affiliate_fraud_flags_unique
  on public.affiliate_fraud_flags (referral_id, code) where referral_id is not null;
create index if not exists affiliate_fraud_flags_queue_idx
  on public.affiliate_fraud_flags (status, created_at desc);

alter table public.affiliate_fraud_flags enable row level security;
alter table public.affiliate_fraud_flags force row level security;
revoke all on public.affiliate_fraud_flags from anon, authenticated;

-- ============================================ 4. fingerprints
create table if not exists public.affiliate_fingerprints (
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  kind text not null check (kind in ('IP','DEVICE','STRIPE_CUSTOMER','CARD')),
  -- A keyed HMAC for IP/DEVICE; a Stripe id or card fingerprint otherwise.
  value_hash text not null check (char_length(value_hash) between 8 and 200),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (affiliate_id, kind, value_hash)
);
create index if not exists affiliate_fingerprints_lookup_idx
  on public.affiliate_fingerprints (kind, value_hash);

alter table public.affiliate_fingerprints enable row level security;
alter table public.affiliate_fingerprints force row level security;
revoke all on public.affiliate_fingerprints from anon, authenticated;

-- ============================================ 5. clicks and attributions
alter table public.affiliate_clicks
  add column if not exists ip_hash text,
  add column if not exists suspect_reasons text[] not null default '{}'::text[];

alter table public.affiliate_attributions
  add column if not exists signup_ip_hash text,
  add column if not exists signup_device_hash text,
  add column if not exists payment_checked_at timestamptz;

-- Hashes are minimised after the retention window; click rows go after the
-- longer one. The visitor hash becomes a per-row placeholder so historic
-- unique-click counts stay stable without keeping anything identifying.
create or replace function public.purge_affiliate_identifiers()
returns table (hashes_cleared bigint, clicks_deleted bigint, fingerprints_deleted bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.affiliate_programme_settings%rowtype;
  cleared bigint;
  deleted bigint;
  prints bigint;
begin
  select * into s from public.affiliate_programme_settings where id;
  if not found then
    s.fingerprint_retention_days := 120;
    s.click_retention_days := 400;
  end if;

  update public.affiliate_clicks
     set visitor_hash = 'purged:' || id::text,
         ip_hash = null
   where occurred_at < now() - make_interval(days => s.fingerprint_retention_days)
     and visitor_hash not like 'purged:%';
  get diagnostics cleared = row_count;

  update public.affiliate_attributions
     set visitor_hash = null, signup_ip_hash = null, signup_device_hash = null
   where attributed_at < now() - make_interval(days => s.fingerprint_retention_days)
     and (visitor_hash is not null or signup_ip_hash is not null or signup_device_hash is not null);

  delete from public.affiliate_clicks
   where occurred_at < now() - make_interval(days => s.click_retention_days);
  get diagnostics deleted = row_count;

  delete from public.affiliate_fingerprints
   where kind in ('IP','DEVICE')
     and last_seen_at < now() - make_interval(days => s.fingerprint_retention_days);
  get diagnostics prints = row_count;

  return query select cleared, deleted, prints;
end;
$$;
revoke all on function public.purge_affiliate_identifiers() from public, anon, authenticated;

-- ============================================ 6. ledger
alter table public.affiliate_commissions
  drop constraint if exists affiliate_commissions_entry_type_check;
alter table public.affiliate_commissions
  add constraint affiliate_commissions_entry_type_check
  check (entry_type in ('NEW_CUSTOMER','RENEWAL','ADJUSTMENT','REVERSAL','REACCRUAL'));

-- The refund or dispute a reversal row came from lives in metadata.source_ref
-- (e.g. 'dispute:dp_123'); a flipped accrual records metadata.reversed_by.
-- Indexed for the won-dispute lookup.
create index if not exists affiliate_commissions_source_ref_idx
  on public.affiliate_commissions ((metadata->>'source_ref'))
  where metadata ? 'source_ref';
create index if not exists affiliate_commissions_reversed_by_idx
  on public.affiliate_commissions ((metadata->>'reversed_by'))
  where metadata ? 'reversed_by';

-- Approval honours `available_at` (a re-accrual keeps its original date) and
-- never approves money on a referral held for fraud review.
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
      left join public.affiliate_commission_plans p on p.id = ac.commission_plan_id
      left join public.affiliate_referrals r on r.id = ac.referral_id
     where ac.status = 'PENDING'
       and coalesce(ac.available_at, ac.created_at + make_interval(days => coalesce(p.hold_days, 30))) <= now()
       and (r.id is null or r.flagged_reason is null)
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

-- Claiming skips positive money on a held referral (negative rows are always
-- claimed, so a clawback is never dodged by a flag).
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
    select c.id
      from public.affiliate_commissions c
      left join public.affiliate_referrals r on r.id = c.referral_id
     where c.affiliate_id = p_affiliate_id
       and c.status in ('APPROVED','PAYABLE')
       and c.payout_id is null
       and coalesce(c.available_at, c.created_at) <= now()
       and (c.commission_amount_minor < 0 or r.id is null or r.flagged_reason is null)
     for update of c skip locked
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
revoke all on function public.claim_commissions_for_payout(uuid, uuid) from public, anon, authenticated;
