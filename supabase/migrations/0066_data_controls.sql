-- 0066_data_controls: the workspace's own compliance position.
--
-- The engine that decides whether a contact may be messaged has existed since
-- 0030, and it is good. What has never existed is anywhere for the *customer*
-- to state the facts it should be reasoning from: who they are as a legal
-- entity, which countries they prospect into, whether they contact businesses
-- or individuals, which sources they permit, and on what lawful basis.
--
-- Without this the engine falls back to the country-neutral pack for everyone,
-- which is safe but blunt: a UK company prospecting only UK businesses is held
-- to the same restrictions as one whose jurisdiction is unknown.
--
-- One row per workspace. This is a *statement of position*, not a log: the log
-- of what was decided from it already exists in `contactability_results` and
-- `compliance_decisions`, which is why nothing here needs versioning.

create table if not exists public.business_data_controls (
  business_id uuid primary key references public.businesses(id) on delete cascade,

  /* ------------------------------------------------------- organisation */
  -- Who is the controller. CAN-SPAM and PECR both require a real identity in
  -- marketing mail, and "we'll fill it in later" produces mail that breaches
  -- both.
  legal_name text,
  registered_country text,
  registered_address text,
  privacy_policy_url text,
  privacy_contact_email text,
  -- Only some organisations need one; the field is nullable rather than
  -- required so its presence means something.
  dpo_contact text,

  /* ------------------------------------------------------------ markets */
  -- ISO-3166-1 alpha-2. Drives which jurisdiction pack applies to a prospect
  -- whose own country could not be determined.
  prospect_countries text[] not null default '{}'::text[],

  prospect_type text not null default 'B2B'
    check (prospect_type in ('B2B', 'B2C', 'BOTH')),

  /* ---------------------------------------------------- data provenance */
  -- Which sources this workspace permits. Absent from this list means the
  -- source may not be used, which is why the default is empty rather than
  -- everything: a workspace that has not answered has not consented.
  allowed_sources text[] not null default '{}'::text[],

  /* ------------------------------------------------------- lawful basis */
  marketing_lawful_basis text not null default 'UNSTATED'
    check (marketing_lawful_basis in (
      'UNSTATED', 'CONSENT', 'LEGITIMATE_INTERESTS',
      'EXISTING_CUSTOMER', 'CONTRACTUAL_REQUEST', 'OTHER'
    )),
  lawful_basis_note text,
  -- When the workspace last confirmed this position. A basis asserted three
  -- years ago and never revisited is worth showing as stale.
  basis_reviewed_at timestamptz,

  /* ---------------------------------------------------------- retention */
  -- Days. Null means "keep until deleted by hand", which is a choice someone
  -- has to make rather than a default that quietly accumulates.
  retain_uncontacted_prospects_days integer
    check (retain_uncontacted_prospects_days is null or retain_uncontacted_prospects_days between 7 and 3650),
  retain_inactive_leads_days integer
    check (retain_inactive_leads_days is null or retain_inactive_leads_days between 30 and 3650),
  retain_raw_events_days integer
    check (retain_raw_events_days is null or retain_raw_events_days between 1 and 365),

  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger business_data_controls_set_updated_at
  before update on public.business_data_controls
  for each row execute function public.set_updated_at();

alter table public.business_data_controls enable row level security;
alter table public.business_data_controls force row level security;

-- Readable by any member: the lawful basis and the privacy contact are things
-- anyone writing outreach should be able to look up. Writes go through server
-- actions gated on `admin`, so there is deliberately no update policy.
create policy business_data_controls_select
  on public.business_data_controls
  for select using (public.is_business_member(business_id));

grant select on public.business_data_controls to authenticated;
revoke all on public.business_data_controls from anon;
