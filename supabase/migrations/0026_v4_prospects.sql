-- 0026_v4_prospects: the Prospect side of the Prospect/Lead boundary (V4 §1.3,
-- §12-14, §60-61, §76.9-76.12).
--
-- A prospect is a potential buyer who has NOT yet entered the operational
-- conversion relationship. Cold data lives here and never in `leads`; the only
-- route across is LeadPromotionService. Every field a provider supplied carries
-- provenance in prospect_data_sources so a score can always be explained and a
-- source deletion can be propagated.

create extension if not exists citext;

-- ------------------------------------------------------- prospect_companies
create table public.prospect_companies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  domain citext,
  website_url text,
  industry text,
  company_size text,
  employee_count integer,
  registration_id text,
  location_json jsonb not null default '{}'::jsonb,
  description text,
  external_ids jsonb not null default '{}'::jsonb,
  -- Normalised identity used for the dedupe unique index. Computed in code so
  -- the rule stays in one place (lib/prospects/dedupe.ts).
  dedupe_key text not null,
  is_existing_customer boolean not null default false,
  excluded boolean not null default false,
  exclusion_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger prospect_companies_set_updated_at
  before update on public.prospect_companies
  for each row execute function public.set_updated_at();

-- Two companies with the same normalised domain inside one workspace are the
-- same company. Rows without a domain fall back to the name+location key.
create unique index prospect_companies_domain_idx
  on public.prospect_companies (business_id, domain)
  where domain is not null;

create unique index prospect_companies_dedupe_idx
  on public.prospect_companies (business_id, dedupe_key);

-- --------------------------------------------------------------- prospects
create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  company_id uuid references public.prospect_companies(id) on delete set null,
  first_name text,
  last_name text,
  role_title text,
  role_classification text not null default 'UNKNOWN'
    check (role_classification in ('DECISION_MAKER','INFLUENCER','GATEKEEPER','USER','UNKNOWN')),
  email citext,
  phone_e164 text,
  linkedin_url text,
  location_json jsonb not null default '{}'::jsonb,
  status text not null default 'DISCOVERED'
    check (status in ('DISCOVERED','ENRICHING','VERIFIED','READY','APPROVED','OUTREACH_ACTIVE',
                      'REPLIED','CONVERTED','DISQUALIFIED','SUPPRESSED','BOUNCED','UNSUBSCRIBED','REVIEW')),
  grade text
    check (grade is null or grade in ('A+','A','B','C','D')),
  score numeric(6,2),
  verification_status text not null default 'UNKNOWN'
    check (verification_status in ('UNKNOWN','VALID','RISKY','INVALID','CATCH_ALL','UNVERIFIABLE')),
  subscriber_type text not null default 'UNKNOWN'
    check (subscriber_type in ('CORPORATE','SOLE_TRADER','PARTNERSHIP','INDIVIDUAL','UNKNOWN')),
  outreach_eligibility text not null default 'REVIEW'
    check (outreach_eligibility in ('ELIGIBLE','CONSENT_REQUIRED','REVIEW','SUPPRESSED')),
  eligibility_reason text,
  icp_profile_id uuid references public.icp_profiles(id) on delete set null,
  campaign_id uuid,
  conversation_id uuid,
  promoted_to_lead_id uuid references public.leads(id) on delete set null,
  promoted_at timestamptz,
  source_run_id uuid,
  source_provider text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  last_activity_at timestamptz,
  last_contacted_at timestamptz,
  replied_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();

-- One prospect per email address per workspace. Rows without an email are
-- deduped by the contact keys in lib/prospects/dedupe.ts before insert.
create unique index prospects_email_idx
  on public.prospects (business_id, email)
  where email is not null;

create index prospects_business_status_idx on public.prospects (business_id, status);
create index prospects_business_grade_idx on public.prospects (business_id, grade, score desc);
create index prospects_company_idx on public.prospects (business_id, company_id);
create index prospects_campaign_idx on public.prospects (business_id, campaign_id)
  where campaign_id is not null;
create index prospects_run_idx on public.prospects (business_id, source_run_id)
  where source_run_id is not null;
create index prospects_eligibility_idx
  on public.prospects (business_id, outreach_eligibility, grade);
create index prospects_activity_idx on public.prospects (business_id, last_activity_at desc);

-- ---------------------------------------------------- prospect_data_sources
-- Field-level provenance. Every value ClientTurn holds about a prospect can be
-- traced to the provider that supplied it, when, at what cost, and under what
-- data-use restriction. "Publicly available" is not the same as "free to use",
-- so policy_tags travels with the value.
create table public.prospect_data_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete cascade,
  company_id uuid references public.prospect_companies(id) on delete cascade,
  field_name text not null,
  value_json jsonb not null default '{}'::jsonb,
  provider text not null,
  source_type text not null
    check (source_type in ('WEBSITE','REGISTRY','LICENSED_PROVIDER','CRM','IMPORT','FIRST_PARTY','PUBLIC_FEED','MANUAL')),
  source_url text,
  provider_entity_id text,
  confidence numeric(5,4) not null default 0.5
    check (confidence >= 0 and confidence <= 1),
  obtained_at timestamptz not null default now(),
  verified_at timestamptz,
  cost_minor bigint not null default 0,
  policy_tags jsonb not null default '[]'::jsonb,
  constraint prospect_data_sources_subject
    check (prospect_id is not null or company_id is not null)
);

create index prospect_data_sources_prospect_idx
  on public.prospect_data_sources (business_id, prospect_id, field_name);
create index prospect_data_sources_company_idx
  on public.prospect_data_sources (business_id, company_id, field_name);

-- ---------------------------------------------------- prospect_enrichments
create table public.prospect_enrichments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete cascade,
  company_id uuid references public.prospect_companies(id) on delete cascade,
  enrichment_type text not null
    check (enrichment_type in ('COMPANY','CONTACT','ROLE','TECHNOGRAPHIC','WEBSITE','RESEARCH_SUMMARY')),
  provider text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING','SUCCESS','NOT_FOUND','FAILED','SKIPPED_BUDGET','SKIPPED_GATE')),
  result_json jsonb not null default '{}'::jsonb,
  cost_minor bigint not null default 0,
  error_code text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index prospect_enrichments_prospect_idx
  on public.prospect_enrichments (business_id, prospect_id, enrichment_type);

-- --------------------------------------------------- prospect_verifications
create table public.prospect_verifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  channel text not null default 'EMAIL'
    check (channel in ('EMAIL','PHONE')),
  provider text not null,
  result text not null
    check (result in ('VALID','RISKY','INVALID','CATCH_ALL','UNKNOWN','UNVERIFIABLE')),
  score numeric(5,4),
  detail_json jsonb not null default '{}'::jsonb,
  cost_minor bigint not null default 0,
  verified_at timestamptz not null default now()
);

create index prospect_verifications_prospect_idx
  on public.prospect_verifications (business_id, prospect_id, verified_at desc);

-- ---------------------------------------------------------- prospect_scores
-- Deterministic output. The AI layer supplies evidence/features; the arithmetic
-- and the grade band live in lib/prospects/scoring.ts and are versioned so an
-- old score can always be explained against the policy that produced it.
create table public.prospect_scores (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  score_version text not null,
  total_score numeric(6,2) not null,
  grade text not null
    check (grade in ('A+','A','B','C','D')),
  factor_json jsonb not null default '{}'::jsonb,
  explanation text,
  agent_run_id uuid,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index prospect_scores_current_idx
  on public.prospect_scores (business_id, prospect_id)
  where is_current;

-- --------------------------------------------------- prospect_score_factors
-- One row per contributing factor, so the drawer can show positives and
-- negatives with their evidence rather than a bare number.
create table public.prospect_score_factors (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  prospect_score_id uuid not null references public.prospect_scores(id) on delete cascade,
  factor text not null
    check (factor in ('ICP_FIT','ROLE_AUTHORITY','GEOGRAPHY','NEED','INTENT','DATA_QUALITY')),
  weight numeric(5,4) not null,
  raw_value numeric(6,4) not null,
  contribution numeric(6,2) not null,
  direction text not null default 'POSITIVE'
    check (direction in ('POSITIVE','NEGATIVE','NEUTRAL')),
  evidence_summary text,
  evidence_source text,
  evidence_url text,
  observed_at timestamptz,
  confidence numeric(5,4) not null default 0.5
);

create index prospect_score_factors_score_idx
  on public.prospect_score_factors (business_id, prospect_score_id);
