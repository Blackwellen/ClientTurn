-- 0034_v4_affiliates: the affiliate programme (V4 §29-35, §41, §76.27-76.28).
--
-- Affiliate data is deliberately separate from customer data: an affiliate is a
-- platform-level actor, not a workspace member, and must never gain visibility
-- into a referred tenant's leads, prospects or messages. The only bridge is
-- affiliate_referrals, which carries lifecycle timestamps and plan key — never
-- operational content.
--
-- Attribution is last-touch within a window, resolved server-side at signup.
-- Self-referral and duplicate attribution are rejected in AffiliateService, and
-- the unique index on (business_id) here makes a second attribution impossible
-- at the storage layer too.

-- ---------------------------------------------------------------- affiliates
create table public.affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  -- Public handle used in referral links. Immutable once active.
  code text not null unique,
  display_name text not null,
  company_name text,
  website_url text,
  contact_email citext not null,
  country text,
  audience_description text,
  promotion_methods text[] not null default '{}'::text[],
  status text not null default 'APPLIED'
    check (status in ('APPLIED','ACTIVE','SUSPENDED','REJECTED')),
  status_reason text,
  commission_plan_id uuid,
  -- Sensitive: payout and tax details. Read only by the affiliate themselves
  -- and by platform admins; never joined into any customer-facing query.
  payment_profile_json jsonb not null default '{}'::jsonb,
  tax_status text not null default 'NOT_PROVIDED'
    check (tax_status in ('NOT_PROVIDED','SUBMITTED','VERIFIED','INVALID')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger affiliates_set_updated_at
  before update on public.affiliates
  for each row execute function public.set_updated_at();

create index affiliates_status_idx on public.affiliates (status, created_at desc);

-- ----------------------------------------------------- affiliate_commission_plans
create table public.affiliate_commission_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  commission_type text not null default 'RECURRING_PERCENT'
    check (commission_type in ('RECURRING_PERCENT','FIRST_PAYMENT_PERCENT','FLAT_AMOUNT')),
  percent numeric(5,2),
  flat_amount_minor bigint,
  currency text not null default 'GBP',
  recurring_months integer,
  attribution_window_days integer not null default 60,
  cookie_window_days integer not null default 60,
  hold_days integer not null default 30,
  minimum_payout_minor bigint not null default 5000,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger affiliate_commission_plans_set_updated_at
  before update on public.affiliate_commission_plans
  for each row execute function public.set_updated_at();

create unique index affiliate_commission_plans_default_idx
  on public.affiliate_commission_plans (is_default)
  where is_default;

alter table public.affiliates
  add constraint affiliates_commission_plan_fk
  foreign key (commission_plan_id) references public.affiliate_commission_plans(id) on delete set null;

-- --------------------------------------------------------- affiliate_campaigns
create table public.affiliate_campaigns (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  name text not null,
  description text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (affiliate_id, name)
);

-- ------------------------------------------------------------- affiliate_links
create table public.affiliate_links (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  campaign_id uuid references public.affiliate_campaigns(id) on delete set null,
  label text not null,
  slug text not null unique,
  destination_path text not null default '/',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  click_count integer not null default 0,
  signup_count integer not null default 0,
  paid_count integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger affiliate_links_set_updated_at
  before update on public.affiliate_links
  for each row execute function public.set_updated_at();

create index affiliate_links_affiliate_idx
  on public.affiliate_links (affiliate_id, archived);

-- -------------------------------------------------------- affiliate_promo_codes
create table public.affiliate_promo_codes (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid references public.affiliates(id) on delete cascade,
  code text not null unique,
  stripe_promotion_code_id text,
  description text,
  discount_percent numeric(5,2),
  discount_amount_minor bigint,
  max_redemptions integer,
  redemption_count integer not null default 0,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','PAUSED','EXPIRED')),
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ affiliate_clicks
-- High volume, append-only. Bot filtering and per-IP throttling happen before
-- insert; `visitor_hash` is a salted hash, never a raw IP.
create table public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  link_id uuid references public.affiliate_links(id) on delete set null,
  campaign_id uuid references public.affiliate_campaigns(id) on delete set null,
  visitor_hash text not null,
  landing_path text,
  referrer_host text,
  country text,
  device_type text,
  is_bot boolean not null default false,
  occurred_at timestamptz not null default now()
);

create index affiliate_clicks_affiliate_idx
  on public.affiliate_clicks (affiliate_id, occurred_at desc);
create index affiliate_clicks_link_idx
  on public.affiliate_clicks (link_id, occurred_at desc);
create index affiliate_clicks_visitor_idx
  on public.affiliate_clicks (visitor_hash, occurred_at desc);

-- ------------------------------------------------------- affiliate_attributions
-- The resolved click that a signup is credited to. One per business, ever.
create table public.affiliate_attributions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  link_id uuid references public.affiliate_links(id) on delete set null,
  promo_code_id uuid references public.affiliate_promo_codes(id) on delete set null,
  business_id uuid references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  visitor_hash text,
  attribution_model text not null default 'LAST_TOUCH'
    check (attribution_model in ('LAST_TOUCH','FIRST_TOUCH','PROMO_CODE')),
  clicked_at timestamptz,
  attributed_at timestamptz not null default now(),
  expires_at timestamptz,
  rejected_reason text
);

create unique index affiliate_attributions_business_idx
  on public.affiliate_attributions (business_id)
  where business_id is not null and rejected_reason is null;

create index affiliate_attributions_affiliate_idx
  on public.affiliate_attributions (affiliate_id, attributed_at desc);

-- --------------------------------------------------------- affiliate_referrals
create table public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  attribution_id uuid references public.affiliate_attributions(id) on delete set null,
  -- Display-only identity. Deliberately not the workspace name where the
  -- affiliate has no relationship with the customer.
  display_label text,
  status text not null default 'SIGNED_UP'
    check (status in ('SIGNED_UP','TRIALING','PAID','CHURNED','REFUNDED','REJECTED')),
  plan_key text,
  signup_at timestamptz,
  trial_at timestamptz,
  paid_at timestamptz,
  churned_at timestamptz,
  attribution_expires_at timestamptz,
  lifetime_revenue_minor bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (affiliate_id, business_id)
);

create trigger affiliate_referrals_set_updated_at
  before update on public.affiliate_referrals
  for each row execute function public.set_updated_at();

create index affiliate_referrals_affiliate_idx
  on public.affiliate_referrals (affiliate_id, status, created_at desc);

-- ------------------------------------------------------- affiliate_commissions
-- Accrued per billing event. `stripe_invoice_id` makes accrual idempotent, so a
-- replayed Stripe webhook cannot pay a commission twice.
create table public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  referral_id uuid references public.affiliate_referrals(id) on delete set null,
  business_id uuid references public.businesses(id) on delete set null,
  payout_id uuid,
  commission_plan_id uuid references public.affiliate_commission_plans(id) on delete set null,
  status text not null default 'PENDING'
    check (status in ('PENDING','APPROVED','REVERSED','PAYABLE','PAID')),
  base_amount_minor bigint not null default 0,
  commission_amount_minor bigint not null default 0,
  currency text not null default 'GBP',
  period_month date,
  stripe_invoice_id text,
  reversal_reason text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  reversed_at timestamptz,
  payable_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index affiliate_commissions_invoice_idx
  on public.affiliate_commissions (stripe_invoice_id)
  where stripe_invoice_id is not null;

create index affiliate_commissions_affiliate_idx
  on public.affiliate_commissions (affiliate_id, status, created_at desc);

-- ---------------------------------------------------------- affiliate_payouts
create table public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  batch_reference text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','APPROVED','PROCESSING','PAID','FAILED','CANCELLED')),
  amount_minor bigint not null default 0,
  currency text not null default 'GBP',
  commission_count integer not null default 0,
  method text,
  external_reference text,
  failure_reason text,
  period_start date,
  period_end date,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger affiliate_payouts_set_updated_at
  before update on public.affiliate_payouts
  for each row execute function public.set_updated_at();

alter table public.affiliate_commissions
  add constraint affiliate_commissions_payout_fk
  foreign key (payout_id) references public.affiliate_payouts(id) on delete set null;

create index affiliate_payouts_affiliate_idx
  on public.affiliate_payouts (affiliate_id, status, created_at desc);

-- -------------------------------------------------------- affiliate_resources
-- The brand and enablement hub. Platform-owned and versioned; affiliates read
-- published rows only.
create table public.affiliate_resources (
  id uuid primary key default gen_random_uuid(),
  category text not null
    check (category in ('BRAND','SCREENSHOT','AD_CREATIVE','VIDEO','COPY','EDUCATION','CAMPAIGN_PACK')),
  pack_id uuid,
  title text not null,
  description text,
  resource_type text not null default 'FILE'
    check (resource_type in ('FILE','IMAGE','VIDEO','TEXT','LINK')),
  storage_key text,
  external_url text,
  text_content text,
  preview_key text,
  file_size_bytes bigint,
  dimensions text,
  version text not null default 'v1',
  status text not null default 'DRAFT'
    check (status in ('DRAFT','PUBLISHED','ARCHIVED')),
  sort_order integer not null default 100,
  download_count integer not null default 0,
  keywords text[] not null default '{}'::text[],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger affiliate_resources_set_updated_at
  before update on public.affiliate_resources
  for each row execute function public.set_updated_at();

create index affiliate_resources_published_idx
  on public.affiliate_resources (status, category, sort_order)
  where status = 'PUBLISHED';

-- A campaign pack is itself a resource row, so packs nest naturally.
alter table public.affiliate_resources
  add constraint affiliate_resources_pack_fk
  foreign key (pack_id) references public.affiliate_resources(id) on delete set null;

-- -------------------------------------------------- affiliate_resource_downloads
create table public.affiliate_resource_downloads (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  resource_id uuid not null references public.affiliate_resources(id) on delete cascade,
  downloaded_at timestamptz not null default now()
);

create index affiliate_resource_downloads_idx
  on public.affiliate_resource_downloads (resource_id, downloaded_at desc);
