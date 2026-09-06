-- 0030_v4_compliance: contactability, consent evidence, suppression and the
-- audit trail of every send decision (V4 §67-69, §91, §76.23-76.24).
--
-- This is the layer that answers "may we contact this person on this channel,
-- right now?". Three rules shape it:
--   1. Suppression is checked before EVERY send, whatever the source.
--   2. Every decision stores its policy_version and the evidence snapshot it
--      saw, so an audit can reconstruct why a send was permitted or blocked
--      even after the policy pack changes.
--   3. Nothing here is legal advice. It is a versioned, operable policy engine
--      whose packs must be reviewed by counsel before broad rollout.
--
-- V3 already has `contact_suppressions` (per-lead opt-out). That stays as the
-- lead-scoped record; `suppression_entries` is the destination-scoped global
-- list that also covers prospects and never-seen addresses.

-- ------------------------------------------------------- contact_permissions
-- The relationship and consent evidence a workspace holds for one destination.
create table public.contact_permissions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  subject_type text not null
    check (subject_type in ('LEAD','PROSPECT')),
  subject_id uuid not null,
  email citext,
  phone_e164 text,
  relationship_type text not null default 'UNKNOWN'
    check (relationship_type in ('THEY_CONTACTED_US','EXISTING_CUSTOMER','REFERRAL','REQUESTED_INFORMATION',
                                 'EXPLICIT_MARKETING_CONSENT','EXISTING_BUSINESS_RELATIONSHIP',
                                 'FOUND_BY_US','IMPORTED','OTHER','UNKNOWN')),
  relationship_detail text,
  consent_status text not null default 'UNKNOWN'
    check (consent_status in ('GRANTED','WITHDRAWN','NOT_REQUIRED','UNKNOWN')),
  consent_scope jsonb not null default '[]'::jsonb,
  consent_evidence text,
  consent_source text,
  consent_captured_at timestamptz,
  lawful_basis_tag text,
  subscriber_type text not null default 'UNKNOWN'
    check (subscriber_type in ('CORPORATE','SOLE_TRADER','PARTNERSHIP','INDIVIDUAL','UNKNOWN')),
  country text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, subject_type, subject_id)
);

create trigger contact_permissions_set_updated_at
  before update on public.contact_permissions
  for each row execute function public.set_updated_at();

create index contact_permissions_email_idx
  on public.contact_permissions (business_id, email)
  where email is not null;

-- ----------------------------------------------------- contactability_results
-- Cached evaluation per (subject, channel). Written by ChannelPolicyService on
-- every evaluation, so the UI can explain eligibility without re-running the
-- engine and an auditor can see the decision history.
create table public.contactability_results (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  subject_type text not null
    check (subject_type in ('LEAD','PROSPECT')),
  subject_id uuid not null,
  channel text not null
    check (channel in ('EMAIL','SMS','WHATSAPP','SOCIAL')),
  campaign_type text not null default 'WARM'
    check (campaign_type in ('WARM','COLD','REACTIVATION','TRANSACTIONAL')),
  country text,
  subscriber_type text,
  relationship_type text,
  result text not null
    check (result in ('ALLOWED','BLOCKED','REVIEW_REQUIRED','REQUIRE_CONSENT',
                      'REQUIRE_PRIVACY_NOTICE','REQUIRE_TEMPLATE','REQUIRE_MANUAL_ACTION')),
  reason_code text not null,
  policy_version text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  unique (business_id, subject_type, subject_id, channel, campaign_type)
);

create index contactability_results_subject_idx
  on public.contactability_results (business_id, subject_type, subject_id);

-- ------------------------------------------------------- suppression_entries
-- Destination-scoped and permanent by default. `expires_at` exists only for
-- the narrow provider-imposed temporary blocks; an opt-out never expires.
create table public.suppression_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  email citext,
  phone_e164 text,
  social_identifier text,
  channel text not null default 'ALL'
    check (channel in ('EMAIL','SMS','WHATSAPP','SOCIAL','ALL')),
  reason text not null
    check (reason in ('OPT_OUT','COMPLAINT','INVALID','BOUNCE','LEGAL','MANUAL','PROVIDER')),
  source text not null default 'SYSTEM',
  source_reference text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint suppression_entries_destination
    check (email is not null or phone_e164 is not null or social_identifier is not null)
);

-- Lookup happens before every send, so these indexes are on the hot path.
-- A null business_id row is a platform-wide suppression.
create unique index suppression_entries_email_idx
  on public.suppression_entries (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), email, channel)
  where email is not null;
create unique index suppression_entries_phone_idx
  on public.suppression_entries (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), phone_e164, channel)
  where phone_e164 is not null;
create unique index suppression_entries_social_idx
  on public.suppression_entries (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), social_identifier, channel)
  where social_identifier is not null;

create index suppression_entries_business_idx
  on public.suppression_entries (business_id, created_at desc);

-- ------------------------------------------------------ compliance_decisions
-- Human decisions on the review queue. Separate from contactability_results so
-- an automated re-evaluation can never quietly overwrite a person's judgement.
create table public.compliance_decisions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  subject_type text not null,
  subject_id uuid not null,
  channel text,
  decision text not null
    check (decision in ('APPROVED','REJECTED','SUPPRESSED','ESCALATED','DEFERRED')),
  rationale text,
  policy_version text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  decided_by uuid references auth.users(id) on delete set null,
  decided_by_admin boolean not null default false,
  decided_at timestamptz not null default now()
);

create index compliance_decisions_subject_idx
  on public.compliance_decisions (business_id, subject_type, subject_id, decided_at desc);

-- ---------------------------------------------------- privacy_notice_events
-- Records that a required privacy notice was actually delivered, and when.
create table public.privacy_notice_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  subject_type text not null,
  subject_id uuid not null,
  channel text not null,
  notice_version text not null,
  message_id uuid references public.messages(id) on delete set null,
  delivered_at timestamptz not null default now()
);

create index privacy_notice_events_subject_idx
  on public.privacy_notice_events (business_id, subject_type, subject_id);

-- ------------------------------------------------------ lead_source_evidence
-- Provenance for how a lead or prospect entered the workspace. Written by the
-- manual Add Lead wizard, the import pipeline and the sourcing orchestrator,
-- and retained even if the marketing data is later deleted.
create table public.lead_source_evidence (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  subject_type text not null
    check (subject_type in ('LEAD','PROSPECT')),
  subject_id uuid not null,
  intake_method text not null
    check (intake_method in ('MANUAL','PHONE_CALL','WALK_IN','REFERRAL','EVENT','IMPORT',
                             'PIPEDRIVE','META','WEBFORM','CLIENTTURN_SOURCING','API','OTHER')),
  source_detail text,
  relationship_type text,
  consent_evidence text,
  captured_by uuid references auth.users(id) on delete set null,
  import_id uuid,
  sourcing_run_id uuid references public.sourcing_runs(id) on delete set null,
  campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index lead_source_evidence_subject_idx
  on public.lead_source_evidence (business_id, subject_type, subject_id);

-- --------------------------------------------------------- policy_versions
-- Platform-owned. Country/channel policy packs are versioned so a decision can
-- always be replayed against the pack that produced it.
create table public.compliance_policy_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  name text not null,
  country_codes text[] not null default '{}'::text[],
  channels text[] not null default '{}'::text[],
  rules_json jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','ACTIVE','RETIRED')),
  notes text,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index compliance_policy_versions_active_idx
  on public.compliance_policy_versions (name)
  where status = 'ACTIVE';
