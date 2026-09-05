-- 0001_core: tenancy foundation
-- profiles, businesses, business_members, business_settings

create extension if not exists "pgcrypto";

-- Shared updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  phone text,
  avatar_url text,
  platform_role text not null default 'user'
    check (platform_role in ('user', 'platform_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------- businesses
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  industry text,
  website text,
  phone text,
  logo_key text,
  timezone text not null default 'Europe/London',
  status text not null default 'onboarding'
    check (status in ('onboarding', 'active', 'suspended', 'cancelled')),
  onboarding_state jsonb not null default '{}'::jsonb,
  onboarding_step text not null default 'business',
  activated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------- business_members
create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'active'
    check (status in ('active', 'invited', 'suspended', 'removed')),
  invited_email text,
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create unique index business_members_user_business_idx
  on public.business_members (user_id, business_id);
create index business_members_business_idx
  on public.business_members (business_id, status);

create trigger business_members_set_updated_at
  before update on public.business_members
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------- business_settings
create table public.business_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  service_area_description text,
  allowed_postcode_prefixes text[] not null default '{}',
  blocked_postcode_prefixes text[] not null default '{}',
  business_hours jsonb not null default '{}'::jsonb,
  quiet_hours_start time not null default '20:00',
  quiet_hours_end time not null default '08:00',
  quiet_hours_enabled boolean not null default true,
  message_signature text,
  opt_out_wording text not null default 'Reply STOP to opt out.',
  default_channel text not null default 'sms'
    check (default_channel in ('sms', 'whatsapp')),
  fallback_channel text check (fallback_channel in ('sms', 'whatsapp')),
  booking_mode text not null default 'handover'
    check (booking_mode in ('calendly', 'google_calendar', 'handover')),
  ai_assist_enabled boolean not null default false,
  notify_handover boolean not null default true,
  notify_booking boolean not null default true,
  notify_integration_failure boolean not null default true,
  notify_campaign_complete boolean not null default true,
  notify_daily_summary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger business_settings_set_updated_at
  before update on public.business_settings
  for each row execute function public.set_updated_at();
