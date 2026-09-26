-- 0134_qualification_intelligence: storage for the Qualification Intelligence &
-- Intent Engine (docs/revenue-engine/08-qualification-intelligence.md §B.2).
--
-- Written, not applied. Phase 0 (contracts): the shared TypeScript contract is
-- src/lib/qualification-intelligence/types.ts, and every CHECK list below is
-- asserted equal to it by tests/qualification-intel-contract.test.ts.
--
--   1. lead_intent_signals       one row per observed buying (or anti-buying)
--                                signal, with strength, confidence and decay.
--   2. lead_qualification_facts  what is known per qualification dimension,
--                                CONFIRMED / INFERRED / CONFLICTING / REJECTED,
--                                with provenance. UNKNOWN is the absence of a
--                                live row, never stored.
--   3. lead_assessments          append-only, one current row per lead: intent
--                                state + score, completeness, dimension status
--                                and the structured next-best-action.
--   4. leads                     denormalised intent state / score, completeness
--                                and next action, for list filters.
--   5. services.offer_profile    the per-offer profile (services is the offer).
--   6. qualification_questions   explicit dimension and question-intent mapping.
--   7. CHECK extensions          workspace_sales_overrides.kind += QUALIFICATION_POLICY,
--                                experiments.kind += QUESTION_STRATEGY.
--   8. Data rights               the new tables cascade with the lead on delete,
--                                and are cleared when the lead is anonymised
--                                (trigger on leads.anonymised_at, set by
--                                data_rights_scrub in 0124), and refuse new
--                                rows for an anonymised lead afterwards.
--   9. record_lead_assessment()  atomic, idempotent write of one assessment.
--
-- Every tenant table: business_id, RLS enabled and forced, members SELECT via
-- public.is_business_member(business_id), writes by the service role only
-- (the 0121 / 0131 pattern). Idempotent and additive: nothing is dropped
-- except this migration's own CHECK constraints, which are re-created, and the
-- two kind CHECKs, which are re-created as strict supersets.

-- ================================================== 1. lead_intent_signals
create table if not exists public.lead_intent_signals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  -- The offer the signal is about, when it is about one.
  service_id uuid references public.services(id) on delete set null,
  category text not null,
  signal_type text not null,
  polarity text not null,
  strength numeric(4,3) not null,
  confidence numeric(4,3) not null,
  source text not null,
  -- The message, touch, booking, opportunity or intent_events id it came from.
  source_ref text,
  observed_at timestamptz not null,
  -- null = does not decay (UNSUBSCRIBE).
  half_life_hours integer,
  -- Full strength until then, decay afterwards (TIMEFRAME: stated date + 7 d;
  -- NOT_NOW: resume_at). See contract decision CD-4.
  flat_until timestamptz,
  expires_at timestamptz,
  -- NOT_NOW only: when the lead said to come back.
  resume_at timestamptz,
  -- Plain-language why, e.g. "Asked 'can we book a call Thursday?'".
  reason text not null,
  -- Capped verbatim quote. Personal data: exported with a DSAR, removed on
  -- anonymisation (section 8).
  evidence_excerpt text,
  -- Deterministic per (lead, source event, signal type): a retried job is a no-op.
  dedupe_key text not null,
  rule_version text not null,
  retracted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.lead_intent_signals drop constraint if exists lead_intent_signals_category_check;
alter table public.lead_intent_signals add constraint lead_intent_signals_category_check
  check (category in ('EXPLICIT','BEHAVIOURAL','CONVERSATIONAL','CONTEXT'));

alter table public.lead_intent_signals drop constraint if exists lead_intent_signals_signal_type_check;
alter table public.lead_intent_signals add constraint lead_intent_signals_signal_type_check
  check (signal_type in (
    'BOOKING_REQUEST','DEMO_REQUEST','CALLBACK_REQUEST','QUOTE_REQUEST','PRICING_REQUEST',
    'PURCHASE_REQUEST','TRIAL_OR_SIGNUP_REQUEST','IMPLEMENTATION_QUESTION','INBOUND_ENQUIRY',
    'STATED_PROBLEM','GENERAL_QUESTION',
    'URGENCY','TIMEFRAME','DISSATISFACTION_CURRENT','REPLACEMENT_SEARCH','COMPETITOR_COMPARISON',
    'PRICING_CONCERN_ENGAGED','READY_TO_MEET','READY_TO_BUY',
    'CONVERTING_PAGE_PRICING','CONVERTING_PAGE_DEMO','REPEAT_SUBMISSION','FAST_REPLY',
    'BOOKING_LINK_OPENED',
    'FUNDING','HIRING','JOB_CHANGE','TECH_CHANGE','TENDER',
    'NOT_INTERESTED','NO_NEED','WRONG_PERSON','NOT_NOW','UNSUBSCRIBE','COMPLAINT','NON_LEAD',
    'NO_SHOW','OPPORTUNITY_LOST'));

alter table public.lead_intent_signals drop constraint if exists lead_intent_signals_polarity_check;
alter table public.lead_intent_signals add constraint lead_intent_signals_polarity_check
  check (polarity in ('POSITIVE','NEGATIVE','NEUTRAL'));

alter table public.lead_intent_signals drop constraint if exists lead_intent_signals_source_check;
alter table public.lead_intent_signals add constraint lead_intent_signals_source_check
  check (source in ('FORM','REPLY','CLASSIFICATION','BOOKING','OPPORTUNITY','TOUCH',
                    'ENRICHMENT','SOURCING','MANUAL','AI_ASSIST'));

alter table public.lead_intent_signals drop constraint if exists lead_intent_signals_values_check;
alter table public.lead_intent_signals add constraint lead_intent_signals_values_check
  check (
    strength between 0 and 1
    and confidence between 0 and 1
    and (half_life_hours is null or half_life_hours between 1 and 17520)
    and (source_ref is null or char_length(source_ref) between 1 and 200)
    and char_length(reason) between 1 and 200
    and (evidence_excerpt is null or char_length(evidence_excerpt) <= 240)
    and char_length(dedupe_key) between 1 and 200
    and char_length(rule_version) between 1 and 40
    and (expires_at is null or expires_at > observed_at)
    and (resume_at is null or signal_type = 'NOT_NOW')
  );

-- Idempotency: one signal per dedupe key per workspace.
create unique index if not exists lead_intent_signals_dedupe_idx
  on public.lead_intent_signals (business_id, dedupe_key);

-- assessIntent reads a lead's live signals, newest first.
create index if not exists lead_intent_signals_lead_live_idx
  on public.lead_intent_signals (business_id, lead_id, observed_at desc)
  where retracted_at is null;

-- The NOT_NOW resume sweep.
create index if not exists lead_intent_signals_resume_idx
  on public.lead_intent_signals (resume_at)
  where resume_at is not null and retracted_at is null;

comment on table public.lead_intent_signals is
  'Lead-level intent signals (qualification intelligence, 0134). Written by the assessment service only. Separate from intent_events (prospect ICP monitoring), which feed in as CONTEXT inputs.';

-- ============================================= 2. lead_qualification_facts
create table if not exists public.lead_qualification_facts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  dimension text not null,
  value text not null,
  value_normalised text,
  state text not null,
  source text not null,
  source_ref text,
  question_id uuid references public.qualification_questions(id) on delete set null,
  question_intent_key text,
  confidence numeric(4,3) not null,
  observed_at timestamptz not null,
  valid_until timestamptz,
  verified_at timestamptz,
  set_by uuid references auth.users(id) on delete set null,
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.lead_qualification_facts drop constraint if exists lead_qualification_facts_dimension_check;
alter table public.lead_qualification_facts add constraint lead_qualification_facts_dimension_check
  check (dimension in (
    'PROBLEM','USE_CASE','SERVICE_NEEDED','PROJECT_SCOPE','LOCATION','PROPERTY_TYPE','TIMING',
    'TEAM_SIZE','COMPANY_SIZE','CURRENT_SOLUTION','AUTHORITY','BUDGET','VOLUME',
    'PRODUCT_INTEREST','SUITABILITY','STAKEHOLDERS','SUCCESS_METRICS','DECISION_PROCESS',
    'COMPLIANCE_REQUIREMENTS','HIRING_NEED',
    'OUTCOME','AVAILABILITY','DISSATISFACTION','TECHNICAL_REQUIREMENTS',
    'IMPLEMENTATION_READINESS','PURCHASE_READINESS',
    'UNMAPPED'));

alter table public.lead_qualification_facts drop constraint if exists lead_qualification_facts_state_check;
alter table public.lead_qualification_facts add constraint lead_qualification_facts_state_check
  check (state in ('CONFIRMED','INFERRED','CONFLICTING','REJECTED'));

alter table public.lead_qualification_facts drop constraint if exists lead_qualification_facts_source_check;
alter table public.lead_qualification_facts add constraint lead_qualification_facts_source_check
  check (source in ('ANSWER','FORM','LEAD_FIELD','ENRICHMENT','REPLY','AI_ASSIST','CRM','MANUAL'));

alter table public.lead_qualification_facts drop constraint if exists lead_qualification_facts_values_check;
alter table public.lead_qualification_facts add constraint lead_qualification_facts_values_check
  check (
    char_length(value) between 1 and 500
    and (value_normalised is null or char_length(value_normalised) between 1 and 200)
    and (source_ref is null or char_length(source_ref) between 1 and 200)
    and confidence between 0 and 1
    and (question_intent_key is null
         or question_intent_key ~ '^[A-Z][A-Z_]{1,39}\.[A-Z][A-Z0-9_]{1,39}$'
         or question_intent_key ~ '^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    -- An UNMAPPED fact mirrors a configured question with no dimension; its
    -- synthetic intent key survives the question being deleted.
    and (dimension <> 'UNMAPPED' or question_intent_key like 'custom:%')
    -- The AI assist may only ever produce an INFERRED fact (CLAUDE.md
    -- resolved conflict 1; design §B.11 / D4).
    and (source <> 'AI_ASSIST' or state in ('INFERRED','CONFLICTING','REJECTED'))
  );

-- The live facts for a lead, per dimension (CONFLICTING = two live rows).
create index if not exists lead_qualification_facts_live_idx
  on public.lead_qualification_facts (business_id, lead_id, dimension)
  where superseded_at is null;

-- Idempotency: the same source event cannot state the same dimension twice.
create unique index if not exists lead_qualification_facts_source_idx
  on public.lead_qualification_facts (business_id, lead_id, dimension, source, source_ref)
  where superseded_at is null and source_ref is not null;

-- Question analytics: "meaningful answer" joins a fact to the inbound message.
create index if not exists lead_qualification_facts_source_ref_idx
  on public.lead_qualification_facts (business_id, source_ref)
  where source_ref is not null;

comment on table public.lead_qualification_facts is
  'What is known per qualification dimension, with state and provenance (0134). qualification_answers remains the engine''s input; facts mirror them and add library dimensions. Written by the assessment service only.';

-- ===================================================== 3. lead_assessments
create table if not exists public.lead_assessments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  intent_state text not null,
  intent_score smallint not null,
  -- { EXPLICIT, BEHAVIOURAL, CONVERSATIONAL, RECENCY, CONSISTENCY } points.
  intent_categories jsonb not null default '{}'::jsonb,
  -- [{ signal_id, signal_type, category, decayed_strength, reason, observed_at }]
  intent_evidence jsonb not null default '[]'::jsonb,
  -- Positive evidence overruled by a negative (never summed).
  intent_contradictions jsonb not null default '[]'::jsonb,
  intent_confidence numeric(4,3) not null,
  -- The next decay boundary: the sweep re-assesses after this.
  valid_until timestamptz,
  goal text not null,
  qualification_completeness numeric(4,3) not null,
  -- [{ dimension, status, fact_ids, material, required }]
  dimension_status jsonb not null default '[]'::jsonb,
  -- The structured next-best-action (types.ts NextBestAction).
  nba jsonb not null default '{}'::jsonb,
  engine_version text not null,
  -- SHADOW: computed and stored beside the legacy selection; LIVE: the agent acts on it.
  engine_mode text not null default 'SHADOW',
  -- SHADOW only: what the legacy selector chose, for the diff report.
  legacy_decision jsonb,
  -- e.g. 'lead.processed', 'reply.classified:<message id>', 'intent.sweep:<iso>'
  trigger_event text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.lead_assessments drop constraint if exists lead_assessments_intent_state_check;
alter table public.lead_assessments add constraint lead_assessments_intent_state_check
  check (intent_state in ('NO_DETECTED_INTENT','LOW','EXPLORATORY','MEDIUM','HIGH',
                          'BOOKING_READY','PURCHASE_READY','NOT_NOW','NEGATIVE'));

alter table public.lead_assessments drop constraint if exists lead_assessments_goal_check;
alter table public.lead_assessments add constraint lead_assessments_goal_check
  check (goal in ('A_QUALIFY_ONLY','B_BOOK_MEETING','C_DIRECT_SALE','D_SIGNUP_TRIAL',
                  'E_HUMAN_CLOSER','F_NURTURE','G_DISQUALIFY'));

alter table public.lead_assessments drop constraint if exists lead_assessments_engine_mode_check;
alter table public.lead_assessments add constraint lead_assessments_engine_mode_check
  check (engine_mode in ('SHADOW','LIVE'));

alter table public.lead_assessments drop constraint if exists lead_assessments_values_check;
alter table public.lead_assessments add constraint lead_assessments_values_check
  check (
    intent_score between 0 and 100
    and intent_confidence between 0 and 1
    and qualification_completeness between 0 and 1
    and jsonb_typeof(intent_categories) = 'object' and pg_column_size(intent_categories) <= 2048
    and jsonb_typeof(intent_evidence) = 'array' and pg_column_size(intent_evidence) <= 16384
    and jsonb_typeof(intent_contradictions) = 'array' and pg_column_size(intent_contradictions) <= 8192
    and jsonb_typeof(dimension_status) = 'array' and pg_column_size(dimension_status) <= 16384
    and jsonb_typeof(nba) = 'object' and pg_column_size(nba) <= 16384
    and (legacy_decision is null
         or (jsonb_typeof(legacy_decision) = 'object' and pg_column_size(legacy_decision) <= 4096))
    and char_length(engine_version) between 1 and 80
    and char_length(trigger_event) between 1 and 200
  );

create unique index if not exists lead_assessments_current_idx
  on public.lead_assessments (business_id, lead_id)
  where is_current;

-- A retried lead.score job for the same event and engine is a no-op.
create unique index if not exists lead_assessments_trigger_idx
  on public.lead_assessments (business_id, lead_id, trigger_event, engine_version);

create index if not exists lead_assessments_history_idx
  on public.lead_assessments (business_id, lead_id, created_at desc);

-- The intent.sweep job: current assessments whose decay boundary has passed.
create index if not exists lead_assessments_valid_until_idx
  on public.lead_assessments (valid_until)
  where is_current and valid_until is not null;

comment on table public.lead_assessments is
  'Append-only qualification-intelligence assessments, one current per lead (0134). The single source of truth for the agent, the Lead page and Copilot. Written by record_lead_assessment() only.';

-- ================================================================ 4. leads
alter table public.leads
  add column if not exists intent_state text,
  add column if not exists intent_score smallint,
  add column if not exists qualification_completeness numeric(4,3),
  add column if not exists next_action text,
  add column if not exists assessed_at timestamptz;

alter table public.leads drop constraint if exists leads_intent_state_check;
alter table public.leads add constraint leads_intent_state_check
  check (intent_state is null or intent_state in (
    'NO_DETECTED_INTENT','LOW','EXPLORATORY','MEDIUM','HIGH',
    'BOOKING_READY','PURCHASE_READY','NOT_NOW','NEGATIVE'));

alter table public.leads drop constraint if exists leads_next_action_check;
alter table public.leads add constraint leads_next_action_check
  check (next_action is null or next_action in (
    'ANSWER','ASK','ANSWER_AND_ASK','INFORM','CTA_BOOK','CTA_CHECKOUT','CTA_SIGNUP',
    'ESCALATE','WAIT','NURTURE','DISQUALIFY','NO_ACTION'));

alter table public.leads drop constraint if exists leads_intent_values_check;
alter table public.leads add constraint leads_intent_values_check
  check ((intent_score is null or intent_score between 0 and 100)
     and (qualification_completeness is null or qualification_completeness between 0 and 1));

-- "Strong intent + incomplete qualification" (lead.search filters).
create index if not exists leads_intent_idx
  on public.leads (business_id, intent_state, intent_score desc)
  where intent_state is not null;

-- leads SELECT is a column grant (0050), so new columns need their own.
-- No UPDATE grant: only record_lead_assessment() writes them.
grant select (intent_state, intent_score, qualification_completeness, next_action, assessed_at)
  on public.leads to authenticated;

comment on column public.leads.intent_state is
  'Denormalised from the current lead_assessments row (0134). Written by record_lead_assessment() only.';

-- ======================================================= 5. offer profile
alter table public.services
  add column if not exists offer_profile jsonb not null default '{}'::jsonb;

alter table public.services drop constraint if exists services_offer_profile_check;
alter table public.services add constraint services_offer_profile_check
  check (jsonb_typeof(offer_profile) = 'object' and pg_column_size(offer_profile) <= 16384);

comment on column public.services.offer_profile is
  'Per-offer profile (0134), validated by offerProfileSchema in src/lib/qualification-intelligence/types.ts. Readers safeParse and fall back to archetype x motion defaults.';

-- ================================================ 6. qualification_questions
alter table public.qualification_questions
  add column if not exists dimension_key text,
  add column if not exists question_intent_key text;

alter table public.qualification_questions drop constraint if exists qualification_questions_dimension_key_check;
alter table public.qualification_questions add constraint qualification_questions_dimension_key_check
  check (dimension_key is null or dimension_key in (
    'PROBLEM','USE_CASE','SERVICE_NEEDED','PROJECT_SCOPE','LOCATION','PROPERTY_TYPE','TIMING',
    'TEAM_SIZE','COMPANY_SIZE','CURRENT_SOLUTION','AUTHORITY','BUDGET','VOLUME',
    'PRODUCT_INTEREST','SUITABILITY','STAKEHOLDERS','SUCCESS_METRICS','DECISION_PROCESS',
    'COMPLIANCE_REQUIREMENTS','HIRING_NEED',
    'OUTCOME','AVAILABILITY','DISSATISFACTION','TECHNICAL_REQUIREMENTS',
    'IMPLEMENTATION_READINESS','PURCHASE_READINESS'));

-- Only library intents; custom:<id> is synthesised in code, never stored here.
alter table public.qualification_questions drop constraint if exists qualification_questions_question_intent_key_check;
alter table public.qualification_questions add constraint qualification_questions_question_intent_key_check
  check (question_intent_key is null
         or question_intent_key ~ '^[A-Z][A-Z_]{1,39}\.[A-Z][A-Z0-9_]{1,39}$');

-- ================================================== 7. CHECK extensions
-- workspace_sales_overrides.kind: 0121 values, plus QUALIFICATION_POLICY
-- (key '*' for the workspace, 'service:<uuid>' for one offer).
alter table public.workspace_sales_overrides drop constraint if exists workspace_sales_overrides_kind_check;
alter table public.workspace_sales_overrides add constraint workspace_sales_overrides_kind_check
  check (kind in ('SCORING_WEIGHTS','QUALIFICATION_QUESTION','OBJECTION','DISQUALIFIER',
                  'ARCHETYPE_SETTINGS','QUALIFICATION_POLICY'));

-- experiments.kind: 0131 values, plus QUESTION_STRATEGY (target_id = the
-- services id for one offer, or the business id for the whole workspace).
alter table public.experiments drop constraint if exists experiments_kind_check;
alter table public.experiments add constraint experiments_kind_check
  check (kind in ('WARM_FOLLOW_UP','REACTIVATION','QUESTION_STRATEGY'));

-- ======================================================================= RLS
do $$
declare t text;
begin
  foreach t in array array[
    'lead_intent_signals','lead_qualification_facts','lead_assessments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_business_member(business_id))',
      t || '_select_member', t);
  end loop;
end $$;

-- Writes: the assessment service and the qualification.* registry operations,
-- service role only.

-- ================================================================ 8. data rights
-- Delete: all three tables reference leads(id) on delete cascade, so they go
-- with the lead (data_rights_delete in 0124).
--
-- Anonymise: data_rights_scrub (0124) sets leads.anonymised_at. The signals
-- hold verbatim excerpts, the facts hold the person's answers, and the
-- assessments hold evidence and reasons built from both, so all three are
-- removed in the same transaction, and the lead's denormalised columns are
-- cleared and kept clear.
create or replace function public.qualification_intel_clear_on_anonymise()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.lead_intent_signals s
   where s.business_id = new.business_id and s.lead_id = new.id;
  delete from public.lead_qualification_facts f
   where f.business_id = new.business_id and f.lead_id = new.id;
  delete from public.lead_assessments a
   where a.business_id = new.business_id and a.lead_id = new.id;
  return null;
end
$$;

drop trigger if exists leads_qualification_intel_clear_on_anonymise on public.leads;
create trigger leads_qualification_intel_clear_on_anonymise
  after update of anonymised_at on public.leads
  for each row when (new.anonymised_at is not null)
  execute function public.qualification_intel_clear_on_anonymise();

create or replace function public.leads_clear_intent_on_anonymise()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.intent_state := null;
  new.intent_score := null;
  new.qualification_completeness := null;
  new.next_action := null;
  new.assessed_at := null;
  return new;
end
$$;

drop trigger if exists leads_clear_intent_on_anonymise on public.leads;
create trigger leads_clear_intent_on_anonymise
  before update on public.leads
  for each row when (
    new.anonymised_at is not null
    and (new.intent_state is not null or new.intent_score is not null
         or new.qualification_completeness is not null or new.next_action is not null
         or new.assessed_at is not null))
  execute function public.leads_clear_intent_on_anonymise();

-- A job that was already running when the lead was anonymised must not write
-- the person back in. The row is skipped, not an error: the job is retry-safe
-- and a failure would only retry into the same refusal.
create or replace function public.qualification_intel_skip_anonymised()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.leads l
              where l.id = new.lead_id and l.anonymised_at is not null) then
    return null;
  end if;
  return new;
end
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'lead_intent_signals','lead_qualification_facts','lead_assessments'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_skip_anonymised', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.qualification_intel_skip_anonymised()',
      t || '_skip_anonymised', t);
  end loop;
end $$;

revoke all on function public.qualification_intel_clear_on_anonymise() from public, anon, authenticated;
revoke all on function public.leads_clear_intent_on_anonymise() from public, anon, authenticated;
revoke all on function public.qualification_intel_skip_anonymised() from public, anon, authenticated;

-- Existing anonymised leads have no rows yet (the tables are new); nothing to back-fill.

-- ===================================================== 9. record_lead_assessment
-- Writes one assessment and its denormalised lead columns, atomically.
--   * Serialised per lead (row lock), like record_lead_score (0121).
--   * Idempotent on (lead, trigger_event, engine_version): a retried job
--     returns the existing row and changes nothing.
--   * An anonymised lead is refused (inserted=false, reason 'anonymised').
--   * The lead's denormalised columns are written in both modes. engine_mode
--     governs only whether the agent acts on the NBA; the assessment itself
--     is shown (Lead page, list filters) either way, so the two never disagree.
-- Returns { assessment_id, inserted, previous_state, intent_state, reason? }.
create or replace function public.record_lead_assessment(
  p_business_id uuid,
  p_lead_id uuid,
  p_assessment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_id uuid;
  new_id uuid;
  prev_state text;
  v_anonymised timestamptz;
  trigger_key text := p_assessment->>'trigger_event';
  version_key text := p_assessment->>'engine_version';
  mode_key text := coalesce(p_assessment->>'engine_mode', 'SHADOW');
begin
  select l.anonymised_at into v_anonymised from public.leads l
   where l.id = p_lead_id and l.business_id = p_business_id
   for update;
  if not found then
    raise exception 'lead % not found in business %', p_lead_id, p_business_id
      using errcode = 'P0002';
  end if;
  if v_anonymised is not null then
    return jsonb_build_object('assessment_id', null, 'inserted', false,
      'previous_state', null, 'intent_state', null, 'reason', 'anonymised');
  end if;

  select id into existing_id
    from public.lead_assessments
   where business_id = p_business_id
     and lead_id = p_lead_id
     and trigger_event = trigger_key
     and engine_version = version_key;

  if existing_id is not null then
    return jsonb_build_object('assessment_id', existing_id, 'inserted', false,
      'previous_state', null, 'intent_state', p_assessment->>'intent_state');
  end if;

  update public.lead_assessments
     set is_current = false
   where business_id = p_business_id
     and lead_id = p_lead_id
     and is_current
  returning intent_state into prev_state;

  insert into public.lead_assessments (
    business_id, lead_id, intent_state, intent_score, intent_categories, intent_evidence,
    intent_contradictions, intent_confidence, valid_until, goal, qualification_completeness,
    dimension_status, nba, engine_version, engine_mode, legacy_decision, trigger_event, is_current
  ) values (
    p_business_id, p_lead_id,
    p_assessment->>'intent_state',
    (p_assessment->>'intent_score')::smallint,
    coalesce(p_assessment->'intent_categories', '{}'::jsonb),
    coalesce(p_assessment->'intent_evidence', '[]'::jsonb),
    coalesce(p_assessment->'intent_contradictions', '[]'::jsonb),
    (p_assessment->>'intent_confidence')::numeric,
    (p_assessment->>'valid_until')::timestamptz,
    p_assessment->>'goal',
    (p_assessment->>'qualification_completeness')::numeric,
    coalesce(p_assessment->'dimension_status', '[]'::jsonb),
    coalesce(p_assessment->'nba', '{}'::jsonb),
    version_key,
    mode_key,
    case when jsonb_typeof(p_assessment->'legacy_decision') = 'object'
         then p_assessment->'legacy_decision' end,
    trigger_key,
    true
  )
  returning id into new_id;

  update public.leads
     set intent_state = p_assessment->>'intent_state',
         intent_score = (p_assessment->>'intent_score')::smallint,
         qualification_completeness = (p_assessment->>'qualification_completeness')::numeric,
         next_action = p_assessment #>> '{nba,next_action}',
         assessed_at = now()
   where id = p_lead_id and business_id = p_business_id;

  return jsonb_build_object('assessment_id', new_id, 'inserted', true,
    'previous_state', prev_state, 'intent_state', p_assessment->>'intent_state');
end
$$;

revoke all on function public.record_lead_assessment(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_lead_assessment(uuid, uuid, jsonb)
  to service_role;
