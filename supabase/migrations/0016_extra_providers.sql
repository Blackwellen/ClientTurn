-- 0016_extra_providers: additional lead sources and CRM push destinations.
--
-- Google Ads, Microsoft Advertising and TikTok have native lead-form ad
-- products like Meta's. LinkedIn does too, gated behind partner approval.
-- Slack is a notification target. HubSpot and Zoho are CRM push destinations.
-- Reddit and Pinterest have no native lead-gen form product, and Salesforce /
-- ZoomInfo require a paid tier, so none of those five are added here.

alter table public.integrations drop constraint integrations_provider_type_check;
alter table public.integrations add constraint integrations_provider_type_check
  check (provider_type in (
    'meta', 'twilio_sms', 'twilio_whatsapp', 'whatsapp_cloud',
    'google_calendar', 'calendly', 'email',
    'google_ads', 'microsoft_ads', 'tiktok_ads', 'linkedin_ads',
    'slack', 'hubspot', 'zoho_crm'
  ));

-- Generic OAuth state row, so the callback can verify the request that reached
-- the provider actually originated from this workspace and has not expired.
create table if not exists public.integration_oauth_states (
  state text primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider_type text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_step text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

create index if not exists integration_oauth_states_business_idx
  on public.integration_oauth_states (business_id);

alter table public.integration_oauth_states enable row level security;
alter table public.integration_oauth_states force row level security;
revoke all on public.integration_oauth_states from anon, authenticated;

create or replace function public.prune_oauth_states()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.integration_oauth_states where expires_at < now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_oauth_states() from public, anon, authenticated;

-- CRM push queue: leads pushed to HubSpot/Zoho, tracked so a retry never
-- double-creates a contact.
create table if not exists public.crm_push_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  provider_type text not null check (provider_type in ('hubspot', 'zoho_crm')),
  external_contact_id text,
  external_deal_id text,
  status text not null default 'pending'
    check (status in ('pending', 'pushed', 'failed')),
  last_error text,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, lead_id, provider_type)
);

create index if not exists crm_push_records_business_idx
  on public.crm_push_records (business_id, status);

create trigger crm_push_records_set_updated_at
  before update on public.crm_push_records
  for each row execute function public.set_updated_at();

alter table public.crm_push_records enable row level security;
alter table public.crm_push_records force row level security;

create policy crm_push_records_select on public.crm_push_records
  for select using (public.is_business_member(business_id));

grant select on public.crm_push_records to authenticated;

-- Lead-form ad platforms without a working push webhook fall back to polling;
-- this remembers the high-water mark per integration so a poll never re-fetches
-- the same lead twice.
create table if not exists public.lead_source_cursors (
  integration_id uuid primary key references public.integrations(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  external_object_id text,
  cursor_value text,
  last_polled_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.lead_source_cursors enable row level security;
alter table public.lead_source_cursors force row level security;
revoke all on public.lead_source_cursors from anon, authenticated;
