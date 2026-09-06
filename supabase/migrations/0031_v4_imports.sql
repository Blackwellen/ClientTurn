-- 0031_v4_imports: the CSV/XLSX intake pipeline (V4 §7, §76 "Manual intake").
--
-- The point of this pipeline is that an existing customer database can be
-- brought in WITHOUT cold rows silently becoming warm leads. Every row is
-- classified into IMPORT_AS_LEAD / IMPORT_AS_PROSPECT / REVIEW / SKIP before
-- anything is written to `leads` or `prospects`, and the classification is
-- re-derived server-side at commit time rather than trusted from the browser.
--
-- V3 already has an `imports` table used by the reactivation CSV path. That is
-- left alone; this is the richer, mapped, per-row pipeline V4 requires.

-- ------------------------------------------------------------ lead_imports
create table public.lead_imports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  filename text not null,
  file_key text,
  file_size_bytes bigint not null default 0,
  content_type text,
  delimiter text,
  encoding text not null default 'utf-8',
  status text not null default 'UPLOADED'
    check (status in ('UPLOADED','PARSING','MAPPING','VALIDATING','CLASSIFYING','REVIEW',
                      'IMPORTING','COMPLETED','PARTIAL','FAILED','CANCELLED')),
  mapping_json jsonb not null default '{}'::jsonb,
  default_relationship_type text,
  default_source_detail text,
  default_service_id uuid references public.services(id) on delete set null,
  default_conversion_goal_id uuid references public.conversion_goals(id) on delete set null,
  start_follow_up boolean not null default false,
  -- Counters. Maintained by the import worker; the UI never recomputes them
  -- from the row table, which can hold tens of thousands of rows.
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  lead_rows integer not null default 0,
  prospect_rows integer not null default 0,
  review_rows integer not null default 0,
  skip_rows integer not null default 0,
  imported_lead_count integer not null default 0,
  imported_prospect_count integer not null default 0,
  failed_row_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger lead_imports_set_updated_at
  before update on public.lead_imports
  for each row execute function public.set_updated_at();

create index lead_imports_business_idx
  on public.lead_imports (business_id, status, created_at desc);

alter table public.lead_source_evidence
  add constraint lead_source_evidence_import_fk
  foreign key (import_id) references public.lead_imports(id) on delete set null;

-- -------------------------------------------------------- lead_import_rows
create table public.lead_import_rows (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  import_id uuid not null references public.lead_imports(id) on delete cascade,
  row_number integer not null,
  raw_json jsonb not null default '{}'::jsonb,
  -- Normalised fields, produced by the same helpers the manual wizard uses so
  -- the two intake paths dedupe against one another correctly.
  first_name text,
  last_name text,
  company_name text,
  email citext,
  phone_e164 text,
  postcode text,
  role_title text,
  relationship_type text,
  source_detail text,
  notes text,
  classification text not null default 'REVIEW'
    check (classification in ('IMPORT_AS_LEAD','IMPORT_AS_PROSPECT','REVIEW','SKIP')),
  classification_reason text,
  -- User overrides survive re-classification; the worker only recomputes rows
  -- the user has not explicitly decided on.
  user_classification text
    check (user_classification is null or user_classification in ('IMPORT_AS_LEAD','IMPORT_AS_PROSPECT','SKIP')),
  validation_flags text[] not null default '{}'::text[],
  duplicate_of_lead_id uuid references public.leads(id) on delete set null,
  duplicate_of_prospect_id uuid references public.prospects(id) on delete set null,
  import_state text not null default 'PENDING'
    check (import_state in ('PENDING','IMPORTED','SKIPPED','FAILED')),
  created_lead_id uuid references public.leads(id) on delete set null,
  created_prospect_id uuid references public.prospects(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  unique (import_id, row_number)
);

create index lead_import_rows_import_idx
  on public.lead_import_rows (business_id, import_id, classification);
create index lead_import_rows_state_idx
  on public.lead_import_rows (import_id, import_state)
  where import_state = 'PENDING';
create index lead_import_rows_email_idx
  on public.lead_import_rows (import_id, email)
  where email is not null;

-- ---------------------------------------------------- lead_import_mappings
-- Saved column mappings, so a workspace importing the same export monthly does
-- not remap it every time.
create table public.lead_import_mappings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  source_signature text,
  mapping_json jsonb not null default '{}'::jsonb,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create trigger lead_import_mappings_set_updated_at
  before update on public.lead_import_mappings
  for each row execute function public.set_updated_at();

create index lead_import_mappings_signature_idx
  on public.lead_import_mappings (business_id, source_signature)
  where source_signature is not null;
