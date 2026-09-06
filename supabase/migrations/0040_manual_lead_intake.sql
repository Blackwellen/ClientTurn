-- 0040 — Manual lead intake (Add Lead wizard).
--
-- The V4 core extension (0038) already gave leads `intake_method`,
-- `relationship_type`, `company_name`, `estimated_value` and
-- `conversion_goal_id`. What manual intake still needs is the provenance of
-- *who* typed the record and *what* they said about where it came from, plus
-- the second phone number the wizard collects.
--
-- Provenance is written once at creation and never rewritten: a lead that was
-- typed by a human must still read as human-typed after any later automation
-- touches it.

alter table public.leads
  add column if not exists telephone text,
  add column if not exists intake_detail text,
  add column if not exists created_via text,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists conversion_goal_type text;

-- The goal the operator was aiming for, recorded even when the workspace has
-- no matching `conversion_goals` row yet. `conversion_goal_id` still links to
-- that row whenever one of this type exists, so the two never disagree.
alter table public.leads drop constraint if exists leads_conversion_goal_type_check;
alter table public.leads add constraint leads_conversion_goal_type_check
  check (conversion_goal_type is null or conversion_goal_type in
    ('BOOK_APPOINTMENT','BOOK_SITE_VISIT','BOOK_DEMO','REQUEST_QUOTE','PHONE_CALL',
     'DIRECT_SIGNUP','DIRECT_PURCHASE','HUMAN_HANDOVER','CUSTOM'));

comment on column public.leads.telephone is
  'Secondary landline. Never used as an SMS/WhatsApp destination — `phone` is the messaging number.';
comment on column public.leads.intake_detail is
  'Free-text provenance the operator supplied (e.g. "Inbound call from yard sign"). Never grants permission on its own.';

alter table public.leads drop constraint if exists leads_created_via_check;
alter table public.leads add constraint leads_created_via_check
  check (created_via is null or created_via in
    ('MANUAL_WIZARD','INBOUND','IMPORT','SOURCING','API','TEST'));

-- Duplicate search reads normalised email, normalised phone and company inside
-- one workspace. lower(email) and phone_normalized are already indexed on
-- leads (0011, 0039); these fill the gaps on the other two sides of the check.
create index if not exists leads_company_name_idx
  on public.leads (business_id, lower(company_name))
  where company_name is not null;

create index if not exists leads_created_via_idx
  on public.leads (business_id, created_via)
  where created_via is not null;

create index if not exists prospects_phone_idx
  on public.prospects (business_id, phone_e164)
  where phone_e164 is not null;

create index if not exists prospect_companies_name_idx
  on public.prospect_companies (business_id, lower(name));

-- The wizard writes every one of these columns through the service role after
-- a server-side role check, so the narrow authenticated column grant on
-- public.leads (0010) is deliberately left as it is.
