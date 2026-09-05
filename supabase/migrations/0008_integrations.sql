-- 0008_integrations: provider connections, selected objects, field mappings
-- Secrets live in a separate table that is never exposed to the browser.

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider_type text not null
    check (provider_type in ('meta', 'twilio_sms', 'twilio_whatsapp',
                             'whatsapp_cloud', 'google_calendar', 'calendly', 'email')),
  status text not null default 'DISCONNECTED'
    check (status in ('HEALTHY','DEGRADED','ACTION_REQUIRED','DISCONNECTED','TESTING')),
  external_account_id text,
  display_name text,
  -- Non-sensitive configuration only. Tokens go in integration_secrets.
  config jsonb not null default '{}'::jsonb,
  scopes text[] not null default '{}',
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  last_error_message text,
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, provider_type)
);

create trigger integrations_set_updated_at
  before update on public.integrations
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------ integration_secrets
-- Server-only. No RLS policy is ever created for this table, so PostgREST
-- returns nothing to any browser client regardless of session.
create table public.integration_secrets (
  integration_id uuid primary key references public.integrations(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  webhook_secret text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger integration_secrets_set_updated_at
  before update on public.integration_secrets
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------ integration_objects
create table public.integration_objects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  object_type text not null
    check (object_type in ('meta_page', 'meta_form', 'google_calendar',
                           'calendly_event_type', 'phone_number')),
  external_id text not null,
  name text,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, object_type, external_id)
);

create index integration_objects_lookup_idx
  on public.integration_objects (object_type, external_id)
  where enabled;

create trigger integration_objects_set_updated_at
  before update on public.integration_objects
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------- field_mappings
-- Server-only: controls how provider payloads become lead fields.
create table public.field_mappings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  integration_object_id uuid not null
    references public.integration_objects(id) on delete cascade,
  external_field text not null,
  internal_field text not null
    check (internal_field in ('first_name','last_name','full_name','phone',
                              'email','postcode','service','ignore')),
  transform text,
  created_at timestamptz not null default now(),
  unique (integration_object_id, external_field)
);
