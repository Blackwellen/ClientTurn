-- 0121_sales_intelligence: Phase 2 of the core revenue engine -- business
-- classification, lead scores, lead tags, opportunities and workspace
-- overrides of the sales library.
--
-- Design: docs/revenue-engine/04-phase2-sales-intelligence-design.md.
--
-- ## Where the library lives
--
-- The canonical archetypes, motions, scoring profiles and objection playbooks
-- are code (src/lib/sales-library/, versioned by LIBRARY_VERSION), not rows.
-- The database holds only (a) what each workspace chose, (b) its overrides of
-- the library, and (c) the decisions the library produced, each stamped with
-- the library and scoring versions that produced it.
--
-- ## Access
--
-- lead_scores, lead_tags, opportunities and workspace_sales_overrides are read
-- by the app UI, so they follow the 0036 member-read pattern: RLS enabled and
-- forced, SELECT granted to `authenticated`, one `_select_member` policy on
-- is_business_member(business_id). No INSERT/UPDATE/DELETE grant or policy:
-- every write goes through the service role (scoring worker, server actions).

-- ----------------------------------------------------- business_profiles
-- Classification of the workspace itself (design doc §1). Industry codes are
-- UK SIC 2026 by default, but `primary_industry_system` is free text to match
-- industry_codes.system (0120), so a later taxonomy needs no schema change.
alter table public.business_profiles
  add column if not exists primary_industry_system text,
  add column if not exists primary_industry_code text,
  -- [{ "system": "uk_sic_2026", "code": "73.11" }, ...]
  add column if not exists secondary_industry_codes jsonb not null default '[]'::jsonb,
  add column if not exists archetype_key text,
  add column if not exists sales_motions text[] not null default '{}',
  add column if not exists classification_source text,
  add column if not exists classification_confidence numeric(4,3),
  add column if not exists library_version text;

alter table public.business_profiles
  add constraint business_profiles_industry_pair_check
    check ((primary_industry_system is null) = (primary_industry_code is null)),
  add constraint business_profiles_secondary_codes_array_check
    check (jsonb_typeof(secondary_industry_codes) = 'array'),
  add constraint business_profiles_sales_motions_check
    check (sales_motions <@ array[
      'BOOK_MEETING_B2B','DIRECT_B2B','LOCAL_SERVICE','HIGH_TICKET_B2C',
      'ECOMMERCE_DIRECT','SAAS_SELF_SERVE','ENTERPRISE'
    ]::text[]),
  add constraint business_profiles_classification_source_check
    check (classification_source is null or classification_source in
      ('USER','COMPANIES_HOUSE','WEBSITE','AI_SUGGESTED')),
  add constraint business_profiles_classification_confidence_check
    check (classification_confidence is null or classification_confidence between 0 and 1);

-- ---------------------------------------------------- prospect_companies
-- Register codes exactly as Companies House (or the provider) supplied them,
-- tagged with their system: [{ "system": "uk_sic_2007", "code": "62.01" }].
-- Companies House still files SIC 2007 (01 §1), so 2026 candidates are derived
-- through industry_code_mappings, never stored as if the register said them.
alter table public.prospect_companies
  add column if not exists sic_codes jsonb not null default '[]'::jsonb,
  add column if not exists archetype_key text;

alter table public.prospect_companies
  add constraint prospect_companies_sic_codes_array_check
    check (jsonb_typeof(sic_codes) = 'array');

create index if not exists prospect_companies_archetype_idx
  on public.prospect_companies (business_id, archetype_key)
  where archetype_key is not null;

-- ---------------------------------------------- workspace_sales_overrides
-- A workspace's edits to the canonical library: weight adjustments, reworded
-- questions, extra objections, extra disqualifiers. `payload` is validated in
-- code by the same schemas as the library before it is written. Stamped with
-- the library version it was written against, so an override made for an old
-- library can be flagged for review after an upgrade.
create table public.workspace_sales_overrides (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null
    check (kind in ('SCORING_WEIGHTS','QUALIFICATION_QUESTION','OBJECTION','DISQUALIFIER','ARCHETYPE_SETTINGS')),
  -- What is overridden: an archetype key, a dimension key, an objection key, or
  -- '*' for the workspace default.
  key text not null check (length(key) between 1 and 120),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  library_version text not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, kind, key)
);

create trigger workspace_sales_overrides_set_updated_at
  before update on public.workspace_sales_overrides
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ lead_scores
-- Append-only history with exactly one current row per lead (partial unique
-- index). Written only by record_lead_score() below, which flips the previous
-- current row and inserts the new one in one transaction.
--
-- No lead_score_factors table. Unlike prospect_score_factors (whose rows the
-- Find Leads drawer and campaign audience filters query individually), the
-- per-dimension evidence here is always read together with its score, is
-- small (seven dimensions, a few evidence items each), and is never filtered
-- across leads by factor. A child table would multiply every append-only
-- score by seven rows for no query that needs it. If analytics later needs a
-- factor-level view, `jsonb_array_elements(dimensions)` provides one.
create table public.lead_scores (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  total numeric(5,2) not null check (total between 0 and 100),
  grade text not null check (grade in ('A','B','C','D')),
  -- [{ dimension, score, max, evidence: [...], missing: [...], confidence }]
  dimensions jsonb not null check (jsonb_typeof(dimensions) = 'array'),
  -- [{ dimension, feature }]
  missing jsonb not null default '[]'::jsonb check (jsonb_typeof(missing) = 'array'),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  why text not null,
  archetype_key text,
  motion text,
  scoring_version text not null,
  library_version text not null,
  -- e.g. 'lead.processed', 'reply.classified:<message id>', 'booking.no_show:<booking id>'
  trigger_event text not null check (length(trigger_event) between 1 and 200),
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index lead_scores_current_idx
  on public.lead_scores (business_id, lead_id)
  where is_current;

-- The same triggering event scored by the same engine version is one score:
-- this is what makes a retried `lead.score` job a no-op.
create unique index lead_scores_trigger_idx
  on public.lead_scores (business_id, lead_id, trigger_event, scoring_version);

create index lead_scores_history_idx
  on public.lead_scores (business_id, lead_id, created_at desc);

create index lead_scores_current_grade_idx
  on public.lead_scores (business_id, grade)
  where is_current;

-- -------------------------------------------------------------- lead_tags
-- Derived tags (src/lib/scoring/tags.ts). A tag is active while cleared_at is
-- null; clearing keeps the row as history rather than deleting it.
create table public.lead_tags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  tag text not null check (tag ~ '^[A-Z][A-Z_]{1,49}$'),
  reason text not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  source_event text not null,
  rule_version text not null,
  set_at timestamptz not null default now(),
  cleared_at timestamptz,
  check (cleared_at is null or cleared_at >= set_at)
);

create unique index lead_tags_active_idx
  on public.lead_tags (business_id, lead_id, tag)
  where cleared_at is null;

create index lead_tags_by_tag_idx
  on public.lead_tags (business_id, tag)
  where cleared_at is null;

-- ---------------------------------------------------------- opportunities
-- Design doc §7. WON and LOST move here from lead status; leads.status stays
-- as a compatibility projection. An opportunity hangs off a lead, an account
-- (a prospect company), or both.
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  prospect_company_id uuid references public.prospect_companies(id) on delete set null,
  name text not null check (length(name) between 1 and 200),
  stage text not null default 'OPEN'
    check (stage in ('OPEN','QUALIFYING','MEETING_BOOKED','PROPOSAL','NEGOTIATION','CLOSED')),
  outcome text not null default 'OPEN' check (outcome in ('OPEN','WON','LOST')),
  outcome_reason text,
  closed_at timestamptz,
  value numeric(14,2) check (value is null or value >= 0),
  currency char(3) not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  probability numeric(4,3) check (probability is null or probability between 0 and 1),
  close_target text not null
    check (close_target in ('BOOK','BUY','QUOTE','PROPOSAL','TRIAL','APPLY','NEXT_STAGE')),
  motion text check (motion is null or motion in (
    'BOOK_MEETING_B2B','DIRECT_B2B','LOCAL_SERVICE','HIGH_TICKET_B2C',
    'ECOMMERCE_DIRECT','SAAS_SELF_SERVE','ENTERPRISE')),
  expected_close_date date,
  -- MEDDPICC checklist, enterprise motion only (design doc §7; a convention,
  -- not a predictor -- 01 §7).
  meddpicc jsonb check (meddpicc is null or jsonb_typeof(meddpicc) = 'object'),
  crm_provider text,
  crm_external_id text,
  library_version text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lead_id is not null or prospect_company_id is not null),
  check (meddpicc is null or motion = 'ENTERPRISE'),
  check ((outcome = 'OPEN') = (closed_at is null)),
  check (outcome <> 'OPEN' or stage <> 'CLOSED'),
  check ((crm_external_id is null) or (crm_provider is not null))
);

create trigger opportunities_set_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();

create index opportunities_pipeline_idx
  on public.opportunities (business_id, outcome, stage);
create index opportunities_lead_idx
  on public.opportunities (business_id, lead_id)
  where lead_id is not null;
create index opportunities_company_idx
  on public.opportunities (business_id, prospect_company_id)
  where prospect_company_id is not null;
create unique index opportunities_crm_idx
  on public.opportunities (business_id, crm_provider, crm_external_id)
  where crm_external_id is not null;

-- ------------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array[
    'workspace_sales_overrides','lead_scores','lead_tags','opportunities'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_business_member(business_id))',
      t || '_select_member', t);
  end loop;
end $$;

-- ------------------------------------------------------ record_lead_score
-- Writes one score and reconciles the lead's derived tags, atomically.
--
--   * Serialised per lead (row lock on the lead), so two scoring jobs for the
--     same lead cannot both believe they hold the current row.
--   * Idempotent on (lead, trigger_event, scoring_version): a retried job
--     returns the existing row and changes nothing.
--   * Tags: every tag in p_managed_tags that is active but absent from p_tags
--     is cleared; every tag in p_tags not yet active is set; active tags still
--     present keep their set_at and get the latest reason/confidence.
--
-- Returns { score_id, inserted, previous_grade, grade }.
create or replace function public.record_lead_score(
  p_business_id uuid,
  p_lead_id uuid,
  p_score jsonb,
  p_tags jsonb,
  p_managed_tags text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_id uuid;
  new_id uuid;
  prev_grade text;
  trigger_key text := p_score->>'trigger_event';
  version_key text := p_score->>'scoring_version';
  t_row jsonb;
begin
  perform 1 from public.leads
   where id = p_lead_id and business_id = p_business_id
   for update;
  if not found then
    raise exception 'lead % not found in business %', p_lead_id, p_business_id
      using errcode = 'P0002';
  end if;

  select id into existing_id
    from public.lead_scores
   where business_id = p_business_id
     and lead_id = p_lead_id
     and trigger_event = trigger_key
     and scoring_version = version_key;

  if existing_id is not null then
    return jsonb_build_object(
      'score_id', existing_id, 'inserted', false,
      'previous_grade', null, 'grade', p_score->>'grade');
  end if;

  update public.lead_scores
     set is_current = false
   where business_id = p_business_id
     and lead_id = p_lead_id
     and is_current
  returning grade into prev_grade;

  insert into public.lead_scores (
    business_id, lead_id, total, grade, dimensions, missing, confidence, why,
    archetype_key, motion, scoring_version, library_version, trigger_event, is_current
  ) values (
    p_business_id, p_lead_id,
    (p_score->>'total')::numeric,
    p_score->>'grade',
    coalesce(p_score->'dimensions', '[]'::jsonb),
    coalesce(p_score->'missing', '[]'::jsonb),
    (p_score->>'confidence')::numeric,
    p_score->>'why',
    p_score->>'archetype_key',
    p_score->>'motion',
    version_key,
    p_score->>'library_version',
    trigger_key,
    true
  )
  returning id into new_id;

  -- Clear managed tags that no longer hold.
  update public.lead_tags lt
     set cleared_at = greatest(now(), lt.set_at)
   where lt.business_id = p_business_id
     and lt.lead_id = p_lead_id
     and lt.cleared_at is null
     and lt.tag = any(p_managed_tags)
     and not exists (
       select 1 from jsonb_array_elements(coalesce(p_tags, '[]'::jsonb)) t
        where t->>'tag' = lt.tag);

  -- Refresh the ones that still hold, set the new ones.
  for t_row in select * from jsonb_array_elements(coalesce(p_tags, '[]'::jsonb)) loop
    update public.lead_tags
       set reason = t_row->>'reason',
           confidence = (t_row->>'confidence')::numeric,
           rule_version = t_row->>'rule_version',
           source_event = trigger_key
     where business_id = p_business_id
       and lead_id = p_lead_id
       and lead_tags.tag = t_row->>'tag'
       and cleared_at is null;
    if not found then
      insert into public.lead_tags (
        business_id, lead_id, tag, reason, confidence, source_event, rule_version
      ) values (
        p_business_id, p_lead_id, t_row->>'tag', t_row->>'reason',
        (t_row->>'confidence')::numeric, trigger_key, t_row->>'rule_version'
      );
    end if;
  end loop;

  return jsonb_build_object(
    'score_id', new_id, 'inserted', true,
    'previous_grade', prev_grade, 'grade', p_score->>'grade');
end
$$;

revoke all on function public.record_lead_score(uuid, uuid, jsonb, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.record_lead_score(uuid, uuid, jsonb, jsonb, text[])
  to service_role;

-- ------------------------------------------------------ industry_aliases
-- Plain-language names for the archetypes (src/lib/sales-library/archetypes.ts),
-- each attached to its archetype's primary SIC 2026 code. Generated from the
-- library; the join on industry_codes means an alias can only land on a code
-- that exists, so a stale prefix is skipped rather than failing the migration.
insert into public.industry_aliases (system, code, alias)
select 'uk_sic_2026', v.code, v.alias
  from (values
  ('62.12', 'b2b saas'),
  ('62.12', 'saas'),
  ('62.12', 'software as a service'),
  ('62.12', 'business software'),
  ('62.12', 'saas platform'),
  ('62.12', 'vertical saas'),
  ('62.13', 'consumer app'),
  ('62.13', 'b2c saas'),
  ('62.13', 'mobile app'),
  ('62.13', 'subscription app'),
  ('62.13', 'product-led'),
  ('62.13', 'plg'),
  ('62.13', 'freemium software'),
  ('62.13', 'self-serve software'),
  ('62.13', 'free trial software'),
  ('62.12', 'enterprise software'),
  ('62.12', 'enterprise saas'),
  ('62.12', 'enterprise platform'),
  ('62.12/5', 'fintech'),
  ('62.12/5', 'payments platform'),
  ('62.12/5', 'financial technology'),
  ('62.12/5', 'open banking'),
  ('62.12/9', 'hr software'),
  ('62.12/9', 'hr tech'),
  ('62.12/9', 'payroll software'),
  ('62.12/9', 'hris'),
  ('62.12/9', 'people platform'),
  ('62.20/9', 'msp'),
  ('62.20/9', 'managed it'),
  ('62.20/9', 'managed service provider'),
  ('62.20/9', 'it support'),
  ('62.20/9', 'outsourced it'),
  ('62.20/9', 'it services'),
  ('62.20/1', 'it consultancy'),
  ('62.20/1', 'it consultant'),
  ('62.20/1', 'technology consultancy'),
  ('62.20/1', 'digital transformation'),
  ('62.20/1', 'cybersecurity'),
  ('62.20/1', 'cyber security'),
  ('62.20/1', 'penetration testing'),
  ('62.20/1', 'pen testing'),
  ('62.20/1', 'cyber essentials'),
  ('62.20/1', 'soc'),
  ('61', 'telecoms'),
  ('61', 'telecom'),
  ('61', 'business broadband'),
  ('61', 'voip'),
  ('61', 'phone systems'),
  ('61', 'connectivity'),
  ('73.11', 'marketing agency'),
  ('73.11', 'digital marketing agency'),
  ('73.11', 'digital agency'),
  ('73.11', 'growth agency'),
  ('73.11', 'performance marketing'),
  ('73.11', 'social media agency'),
  ('73.11', 'pr agency'),
  ('73.11', 'advertising agency'),
  ('73.11', 'ad agency'),
  ('73.11', 'media buying'),
  ('73.11', 'ppc agency'),
  ('73.11', 'paid social agency'),
  ('73.11', 'creative agency'),
  ('73.11', 'seo agency'),
  ('73.11', 'seo'),
  ('73.11', 'search engine optimisation'),
  ('73.11', 'search engine optimization'),
  ('73.11', 'content marketing agency'),
  ('74.12', 'web design'),
  ('74.12', 'web designer'),
  ('74.12', 'web development'),
  ('74.12', 'web developer'),
  ('74.12', 'web studio'),
  ('74.12', 'design studio'),
  ('74.12', 'branding agency'),
  ('74.12', 'ux agency'),
  ('74.12', 'shopify agency'),
  ('74.12', 'wordpress developer'),
  ('58.1', 'publisher'),
  ('58.1', 'media company'),
  ('58.1', 'video production'),
  ('58.1', 'podcast production'),
  ('58.1', 'film production'),
  ('69.20/1', 'accountant'),
  ('69.20/1', 'accountants'),
  ('69.20/1', 'accountancy'),
  ('69.20/1', 'chartered accountants'),
  ('69.20/1', 'tax advisor'),
  ('69.20/1', 'tax adviser'),
  ('69.20/2', 'bookkeeper'),
  ('69.20/2', 'bookkeeping'),
  ('69.20/2', 'payroll bureau'),
  ('69.10', 'solicitor'),
  ('69.10', 'solicitors'),
  ('69.10', 'law firm'),
  ('69.10', 'lawyer'),
  ('69.10', 'legal services'),
  ('69.10', 'barrister'),
  ('70.20', 'management consultancy'),
  ('70.20', 'management consultant'),
  ('70.20', 'consultancy'),
  ('70.20', 'strategy consultancy'),
  ('70.20', 'business consultant'),
  ('70.20', 'operations consultancy'),
  ('71.11', 'architect'),
  ('71.11', 'architects'),
  ('71.11', 'architectural practice'),
  ('71.11', 'planning consultant'),
  ('71.12', 'engineering consultancy'),
  ('71.12', 'structural engineer'),
  ('71.12', 'civil engineering consultant'),
  ('71.12', 'quantity surveyor'),
  ('82.10', 'virtual assistant'),
  ('82.10', 'outsourcing'),
  ('82.10', 'call centre'),
  ('82.10', 'translation services'),
  ('82.10', 'business support'),
  ('78.10', 'recruitment agency'),
  ('78.10', 'recruiter'),
  ('78.10', 'recruitment consultancy'),
  ('78.10', 'headhunter'),
  ('78.10', 'executive search'),
  ('78.10', 'talent acquisition'),
  ('78.20', 'staffing agency'),
  ('78.20', 'temp agency'),
  ('78.20', 'temporary staff'),
  ('78.20', 'labour supply'),
  ('78.20', 'contract staffing'),
  ('66.19/9', 'financial adviser'),
  ('66.19/9', 'financial advisor'),
  ('66.19/9', 'ifa'),
  ('66.19/9', 'wealth management'),
  ('66.19/9', 'financial planning'),
  ('66.22', 'insurance broker'),
  ('66.22', 'business insurance'),
  ('66.22', 'commercial insurance'),
  ('66.22', 'insurance agent'),
  ('66.19/9', 'mortgage broker'),
  ('66.19/9', 'mortgage adviser'),
  ('66.19/9', 'mortgage advisor'),
  ('66.19/9', 'remortgage'),
  ('68.32', 'property management'),
  ('68.32', 'block management'),
  ('68.32', 'property manager'),
  ('68.32', 'managing agent'),
  ('68.31', 'estate agent'),
  ('68.31', 'estate agency'),
  ('68.31', 'property valuation'),
  ('68.31', 'sell my house'),
  ('68.31', 'letting agent'),
  ('68.31', 'lettings agency'),
  ('68.31', 'lettings'),
  ('68.31', 'landlord services'),
  ('68.12', 'property developer'),
  ('68.12', 'housebuilder'),
  ('68.12', 'real estate developer'),
  ('68.12', 'property development'),
  ('41', 'building contractor'),
  ('41', 'main contractor'),
  ('41', 'builder'),
  ('41', 'construction company'),
  ('41', 'civil engineering contractor'),
  ('43', 'subcontractor'),
  ('43', 'specialist contractor'),
  ('43', 'groundworks'),
  ('43', 'scaffolding'),
  ('43', 'plastering'),
  ('43', 'bricklayer'),
  ('43.22/9', 'plumber'),
  ('43.22/9', 'plumbing'),
  ('43.22/9', 'bathroom fitter'),
  ('43.22/9', 'leak repair'),
  ('43.21', 'electrician'),
  ('43.21', 'electrical contractor'),
  ('43.21', 'rewiring'),
  ('43.21', 'ev charger installer'),
  ('43.21', 'solar installer'),
  ('43.41', 'roofer'),
  ('43.41', 'roofing'),
  ('43.41', 'roof repair'),
  ('43.41', 'flat roofing'),
  ('43.22', 'hvac'),
  ('43.22', 'heating engineer'),
  ('43.22', 'boiler installer'),
  ('43.22', 'air conditioning'),
  ('43.22', 'heat pump installer'),
  ('43.22', 'gas engineer'),
  ('81.30', 'landscaper'),
  ('81.30', 'landscaping'),
  ('81.30', 'garden design'),
  ('81.30', 'gardener'),
  ('81.30', 'grounds maintenance'),
  ('81.21', 'cleaning company'),
  ('81.21', 'commercial cleaning'),
  ('81.21', 'office cleaning'),
  ('81.21', 'window cleaning'),
  ('81.21', 'cleaners'),
  ('81.10', 'facilities management'),
  ('81.10', 'fm provider'),
  ('81.10', 'building services'),
  ('81.23/1', 'pest control'),
  ('81.23/1', 'exterminator'),
  ('81.23/1', 'rodent control'),
  ('80.01/2', 'security company'),
  ('80.01/2', 'security guards'),
  ('80.01/2', 'manned guarding'),
  ('80.01/2', 'alarm installer'),
  ('80.01/2', 'cctv installer'),
  ('95.31', 'garage'),
  ('95.31', 'mechanic'),
  ('95.31', 'mot centre'),
  ('95.31', 'car servicing'),
  ('95.31', 'body shop'),
  ('47.81', 'car dealership'),
  ('47.81', 'car dealer'),
  ('47.81', 'van dealer'),
  ('47.81', 'motorcycle dealer'),
  ('47.81', 'used cars'),
  ('52.25', 'logistics'),
  ('52.25', '3pl'),
  ('52.25', 'fulfilment'),
  ('52.25', 'fulfillment'),
  ('52.25', 'warehousing'),
  ('49.41', 'haulage'),
  ('49.41', 'freight forwarder'),
  ('49.41', 'freight'),
  ('49.41', 'road haulage'),
  ('49.41', 'shipping agent'),
  ('53.20', 'courier'),
  ('53.20', 'same day courier'),
  ('53.20', 'parcel delivery'),
  ('53.20', 'delivery service'),
  ('10', 'manufacturer'),
  ('10', 'manufacturing'),
  ('10', 'factory'),
  ('10', 'fabrication'),
  ('10', 'contract manufacturer'),
  ('46.2', 'wholesaler'),
  ('46.2', 'wholesale'),
  ('46.2', 'cash and carry'),
  ('46.2', 'trade supplier'),
  ('46.1', 'distributor'),
  ('46.1', 'distribution company'),
  ('46.1', 'sales agent'),
  ('46.1', 'reseller'),
  ('47.1', 'retailer'),
  ('47.1', 'shop'),
  ('47.1', 'retail store'),
  ('47.1', 'boutique'),
  ('47.1', 'ecommerce'),
  ('47.1', 'e-commerce'),
  ('47.1', 'online shop'),
  ('47.1', 'online store'),
  ('47.1', 'dtc brand'),
  ('47.1', 'direct to consumer'),
  ('47.1', 'shopify store'),
  ('47.1', 'subscription box'),
  ('47.1', 'subscription ecommerce'),
  ('47.1', 'subscribe and save'),
  ('47.1', 'membership box'),
  ('47.91', 'marketplace'),
  ('47.91', 'online marketplace'),
  ('47.91', 'booking platform'),
  ('47.91', 'two-sided platform'),
  ('56.30', 'pub'),
  ('56.30', 'bar'),
  ('56.30', 'holiday let'),
  ('56.30', 'glamping'),
  ('56.30', 'hospitality venue'),
  ('56.30', 'wedding venue'),
  ('55.10', 'hotel'),
  ('55.10', 'boutique hotel'),
  ('55.10', 'b&b'),
  ('55.10', 'guest house'),
  ('56.11', 'restaurant'),
  ('56.11', 'cafe'),
  ('56.11', 'takeaway'),
  ('56.11', 'street food'),
  ('56.21', 'caterer'),
  ('56.21', 'catering'),
  ('56.21', 'event catering'),
  ('56.21', 'contract catering'),
  ('82.30', 'event management'),
  ('82.30', 'event planner'),
  ('82.30', 'conference organiser'),
  ('82.30', 'exhibition organiser'),
  ('82.30', 'wedding planner'),
  ('85.5', 'training provider'),
  ('85.5', 'training company'),
  ('85.5', 'online course'),
  ('85.5', 'tutor'),
  ('85.5', 'tutoring'),
  ('85.5', 'corporate training'),
  ('85.59', 'coach'),
  ('85.59', 'business coach'),
  ('85.59', 'executive coach'),
  ('85.59', 'life coach'),
  ('85.59', 'coaching'),
  ('86.21', 'private clinic'),
  ('86.21', 'physiotherapy'),
  ('86.21', 'physio'),
  ('86.21', 'private gp'),
  ('86.21', 'therapist'),
  ('86.21', 'counselling'),
  ('86.23', 'dentist'),
  ('86.23', 'dental practice'),
  ('86.23', 'orthodontist'),
  ('86.23', 'dental implants'),
  ('86.23', 'invisalign'),
  ('96.22', 'aesthetics clinic'),
  ('96.22', 'aesthetics'),
  ('96.22', 'beauty clinic'),
  ('96.22', 'skin clinic'),
  ('96.22', 'salon'),
  ('96.22', 'spa'),
  ('93.13', 'gym'),
  ('93.13', 'personal trainer'),
  ('93.13', 'fitness studio'),
  ('93.13', 'pilates studio'),
  ('93.13', 'yoga studio'),
  ('87', 'care home'),
  ('87', 'home care'),
  ('87', 'domiciliary care'),
  ('87', 'care provider'),
  ('87', 'nursing home'),
  ('94.11', 'membership organisation'),
  ('94.11', 'trade association'),
  ('94.11', 'professional body'),
  ('94.11', 'sports club'),
  ('94.11', 'members club'),
  ('94.99', 'charity'),
  ('94.99', 'non-profit'),
  ('94.99', 'nonprofit'),
  ('94.99', 'social enterprise'),
  ('94.99', 'cic')
  ) as v(code, alias)
  join public.industry_codes c
    on c.system = 'uk_sic_2026' and c.code = v.code
on conflict do nothing;
