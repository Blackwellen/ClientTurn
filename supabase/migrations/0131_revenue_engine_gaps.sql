-- 0131_revenue_engine_gaps: the remaining Core Revenue Engine gaps
-- (docs/revenue-engine/06-coverage-tracker.md rows 12-13, 26, 48, 61-63).
--
-- Written, not applied. Every reader and writer of these columns in the app
-- tolerates their absence (isSchemaLag), so a release may reach production
-- before this migration without stopping a send or an ingest.
--
--   1. Email origin (§26): where an address came from, on prospects and leads.
--      Cold dispatch refuses PATTERN_INFERRED addresses that are not verified.
--   2. Opportunity memory (§48): one small structured jsonb per opportunity.
--   3. Outcome features (§61): what each outbound message was, for learning.
--   4. Experiments (§§62-63): warm follow-up / reactivation A/B with holdout,
--      deterministic assignment per lead (no assignments table). Workspace-level only.
--   5. Contactability states (§13): SOFT_OPT_IN and REPLY_WINDOW_OPEN are now
--      derived by the 0123 trigger, in step with policy/contactability-state.ts.

-- ------------------------------------------------------------ 1. email origin
alter table public.prospects
  add column if not exists email_origin text
    check (email_origin is null or email_origin in (
      'FOUND_PUBLICLY','PROVIDED_BY_PROVIDER','CRM_IMPORTED','CUSTOMER_PROVIDED','PATTERN_INFERRED'));

alter table public.leads
  add column if not exists email_origin text
    check (email_origin is null or email_origin in (
      'FOUND_PUBLICLY','PROVIDED_BY_PROVIDER','CRM_IMPORTED','CUSTOMER_PROVIDED','PATTERN_INFERRED'));

-- Back-fill what can be known. Nothing is back-filled as PATTERN_INFERRED:
-- the provider's guess flag was never stored, so claiming it would be invented.
update public.prospects
   set email_origin = case
         when source_provider = 'website_contacts' then 'FOUND_PUBLICLY'
         else 'PROVIDED_BY_PROVIDER'
       end
 where email is not null and email_origin is null;

update public.leads l
   set email_origin = coalesce(
         (select p.email_origin from public.prospects p
           where p.id = l.promoted_from_prospect_id and p.business_id = l.business_id),
         case
           when exists (select 1 from public.lead_touches t
                         where t.lead_id = l.id and t.business_id = l.business_id and t.source_type = 'CRM')
             or l.created_via = 'IMPORT' then 'CRM_IMPORTED'
           else 'CUSTOMER_PROVIDED'
         end)
 where l.email is not null and l.email_origin is null;

-- ------------------------------------------------------ 2. opportunity memory
-- Derived deterministically by src/lib/opportunities/memory.ts; written by the
-- server only (opportunities has no browser write grant).
alter table public.opportunities
  add column if not exists memory jsonb not null default '{}'::jsonb
    check (jsonb_typeof(memory) = 'object' and pg_column_size(memory) <= 16384),
  add column if not exists memory_updated_at timestamptz;

-- The memory holds what the person said (goals, pains, people mentioned,
-- commitments). data_rights_anonymise (0124) renames an anonymised
-- opportunity; this clears its memory in the same statement, and keeps it
-- clear if a later refresh tries to write one.
create or replace function public.opportunities_clear_memory_on_anonymise()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.name = 'Opportunity (anonymised contact)' and new.memory <> '{}'::jsonb then
    new.memory := '{}'::jsonb;
    new.memory_updated_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists opportunities_clear_memory_on_anonymise on public.opportunities;
create trigger opportunities_clear_memory_on_anonymise
  before update on public.opportunities
  for each row execute function public.opportunities_clear_memory_on_anonymise();

update public.opportunities
   set memory = '{}'::jsonb
 where name = 'Opportunity (anonymised contact)' and memory <> '{}'::jsonb;

-- ------------------------------------------------------- 3. outcome features
-- src/lib/learning/features.ts. Outcomes (reply, booking, win, opt-out) are
-- joined from the lead and its messages at read time, never copied here.
alter table public.messages
  add column if not exists features jsonb
    check (features is null or (jsonb_typeof(features) = 'object' and pg_column_size(features) <= 4096));

create index if not exists messages_features_family_idx
  on public.messages (business_id, ((features ->> 'family')), created_at desc)
  where features is not null;

-- ----------------------------------------------------------- 4. experiments
create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('WARM_FOLLOW_UP', 'REACTIVATION')),
  -- WARM_FOLLOW_UP: the automation_definitions id; REACTIVATION: the campaigns id.
  target_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'RUNNING', 'STOPPED')),
  -- Share of leads who receive no message from the target (the baseline).
  holdout_percent smallint not null default 0 check (holdout_percent between 0 and 50),
  -- [{ "key": "A", "label": "...", "templates": { "<step position>": "<body>" } }, ...]
  -- Arm "A" with no templates is the control (the target's own copy).
  variants jsonb not null default '[]'::jsonb
    check (jsonb_typeof(variants) = 'array' and jsonb_array_length(variants) between 2 and 4),
  -- §63: raw replies are never an optimisation target.
  primary_metric text not null default 'BOOKING'
    check (primary_metric in ('POSITIVE_REPLY', 'BOOKING', 'WIN')),
  min_sample_per_arm integer not null default 100 check (min_sample_per_arm >= 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  stopped_at timestamptz
);

-- One running experiment per target: two would fight over the same message.
create unique index if not exists experiments_one_running_per_target
  on public.experiments (business_id, kind, target_id) where status = 'RUNNING';

-- No assignments table: a lead's arm is a deterministic hash of (experiment,
-- lead) (src/lib/learning/experiments.ts). Exposure is already recorded where
-- data-rights rules cover it: messages.features {experimentId, arm} for sent
-- variants, and automation_runs.stopped_reason 'experiment_holdout:<id>' for
-- holdout leads.

alter table public.experiments enable row level security;
alter table public.experiments force row level security;
revoke all on public.experiments from anon, authenticated;
grant select on public.experiments to authenticated;
create policy experiments_select_member on public.experiments
  for select to authenticated using (public.is_business_member(business_id));

-- Writes: the experiment.* registry operations, service role.

-- ------------------------------------------------ 5. contactability states
-- The inbound lookup REPLY_WINDOW_OPEN needs.
create index if not exists messages_lead_inbound_recent_idx
  on public.messages (business_id, lead_id, created_at desc)
  where direction = 'inbound';

create or replace function public.contactability_results_derive_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_suppression text := new.evidence_json #>> '{suppression,reason}';
  v_consent text := new.evidence_json ->> 'consent_status';
  v_individual boolean := coalesce(new.subscriber_type, '') in ('INDIVIDUAL', 'SOLE_TRADER', 'PARTNERSHIP');
begin
  new.state := case
    when v_suppression is not null then
      case v_suppression
        when 'BOUNCE' then 'HARD_BOUNCE'
        when 'COMPLAINT' then 'COMPLAINT'
        when 'LEGAL' then 'LEGAL_HOLD'
        when 'INVALID' then 'INVALID'
        when 'MANUAL' then 'DO_NOT_CONTACT'
        when 'PROVIDER' then 'BLOCKED'
        else 'OPTED_OUT'
      end
    when new.reason_code = 'BLOCKED_OPT_OUT' or v_consent = 'WITHDRAWN' then 'OPTED_OUT'
    when new.reason_code = 'BLOCKED_INVALID_CONTACT' then 'INVALID'
    when new.reason_code in ('BLOCKED_QUIET_HOURS','BLOCKED_DAILY_LIMIT','BLOCKED_MONTHLY_LIMIT',
                             'BLOCKED_COST_BUDGET','BLOCKED_PROVIDER','BLOCKED_DOMAIN_HEALTH',
                             'BLOCKED_BUSINESS_STATE') then 'TEMPORARILY_PAUSED'
    when new.result = 'ALLOWED' then
      case
        -- The lead wrote in on this messaging channel within 24 hours: the
        -- channel's service window is open (WhatsApp; Messenger/Instagram).
        when new.subject_type = 'LEAD'
             and new.channel in ('WHATSAPP', 'SOCIAL')
             and exists (
               select 1 from public.messages m
                where m.business_id = new.business_id
                  and m.lead_id = new.subject_id
                  and m.direction = 'inbound'
                  and m.channel = any (case when new.channel = 'WHATSAPP'
                                            then array['whatsapp']
                                            else array['messenger', 'instagram'] end)
                  and m.created_at > coalesce(new.evaluated_at, now()) - interval '24 hours'
             ) then 'REPLY_WINDOW_OPEN'
        -- Soft opt-in (PECR reg 22(3)): an individual subscriber whose details
        -- came from a sale or negotiations for one. Evidence is an opportunity
        -- that was won or reached proposal / checkout / negotiation.
        when new.relationship_type = 'EXISTING_CUSTOMER'
             and v_individual
             and new.subject_type = 'LEAD'
             and exists (
               select 1 from public.opportunities o
                where o.business_id = new.business_id
                  and o.lead_id = new.subject_id
                  and (o.outcome = 'WON' or o.stage in ('PROPOSAL', 'CHECKOUT_SENT', 'NEGOTIATION'))
             ) then 'SOFT_OPT_IN'
        when new.relationship_type = 'EXISTING_CUSTOMER' then 'EXISTING_CUSTOMER'
        when v_consent = 'GRANTED' or new.relationship_type = 'EXPLICIT_MARKETING_CONSENT' then 'CONSENTED'
        when new.relationship_type in ('FOUND_BY_US','UNKNOWN','IMPORTED')
             and exists (
               select 1 from public.legitimate_interest_assessments a
                where a.business_id = new.business_id
                  and a.status = 'ACTIVE'
                  and new.channel = any (a.channels)
             ) then 'LEGITIMATE_INTERESTS_REVIEWED'
        else 'PERMITTED'
      end
    when new.result = 'BLOCKED' then 'BLOCKED'
    else 'UNKNOWN'
  end;
  return new;
end
$$;
