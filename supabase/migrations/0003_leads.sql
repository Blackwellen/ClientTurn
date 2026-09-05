-- 0003_leads: lead records, attribution, assignment, answers, suppression

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null default 'meta'
    check (provider in ('meta', 'csv', 'manual', 'test', 'webform')),
  page_id text,
  page_name text,
  form_id text,
  form_name text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  source_name text,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index lead_sources_business_idx on public.lead_sources (business_id, provider);
create index lead_sources_form_idx on public.lead_sources (business_id, form_id);

-- ------------------------------------------------------------------ leads
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  external_id text,
  first_name text,
  last_name text,
  phone text,
  phone_normalized text,
  email text,
  postcode text,
  service_id uuid references public.services(id) on delete set null,
  source_id uuid references public.lead_sources(id) on delete set null,
  status text not null default 'NEW'
    check (status in ('NEW','CONTACTED','RESPONDED','QUALIFIED','BOOKED','WON','LOST')),
  qualification_state text not null default 'PENDING'
    check (qualification_state in ('PENDING','QUALIFIED','NOT_QUALIFIED','REVIEW')),
  qualification_reason jsonb not null default '[]'::jsonb,
  assigned_user_id uuid references auth.users(id) on delete set null,
  needs_attention boolean not null default false,
  attention_reason text,
  automation_active boolean not null default true,
  human_takeover boolean not null default false,
  opted_out boolean not null default false,
  is_test boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_contacted_at timestamptz,
  first_replied_at timestamptz,
  qualified_at timestamptz,
  booked_at timestamptz,
  won_at timestamptz,
  lost_at timestamptz,
  last_contact_at timestamptz,
  unique (business_id, external_id)
);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------- lead_assignments
create table public.lead_assignments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz
);

create index lead_assignments_lead_idx on public.lead_assignments (lead_id, assigned_at desc);

-- ---------------------------------------------------- qualification_answers
create table public.qualification_answers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  question_id uuid not null references public.qualification_questions(id) on delete cascade,
  answer_text text,
  answer_value text,
  evaluation text not null default 'not_evaluated'
    check (evaluation in ('not_evaluated', 'meets', 'does_not_meet', 'review')),
  -- Provenance: how the value was derived. 'ai_assist' is a proposal only;
  -- deterministic rules still decide the outcome.
  source text not null default 'reply'
    check (source in ('reply', 'form', 'manual', 'ai_assist')),
  confidence numeric(4,3),
  answered_at timestamptz not null default now(),
  unique (lead_id, question_id)
);

create index qualification_answers_lead_idx on public.qualification_answers (lead_id);

-- ---------------------------------------------------- contact_suppressions
create table public.contact_suppressions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  normalized_contact text not null,
  channel text not null check (channel in ('sms', 'whatsapp', 'email', 'all')),
  reason text not null
    check (reason in ('opt_out', 'invalid', 'complaint', 'manual', 'bounce')),
  source text,
  created_at timestamptz not null default now(),
  unique (business_id, normalized_contact, channel)
);

create index contact_suppressions_lookup_idx
  on public.contact_suppressions (business_id, normalized_contact);
