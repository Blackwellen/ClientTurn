-- 0150_voice_core: the voice sales agent's workspace settings (with the OD-1
-- identity), per-workspace telephony and numbers, per-call eligibility and
-- consent evidence, calls, call events, transcripts, recording metadata,
-- post-call outcomes and objection occurrences.
--
-- Promoted from docs/revenue-engine/13-voice-schema-draft.sql (design:
-- docs/revenue-engine/12-voice-quote-to-cash-gap-map.md, OD-1 and §5/§7).
-- Column names follow the pure modules under src/lib/voice/ so the wiring is
-- mechanical. Depends on 0143 and 0144 (applied). Money for voice (minutes,
-- reservations, provider cost, route allocations, queue, entitlement rows) is
-- 0151. NOT applied by the author; apply 0150 -> 0154 in order.
--
-- Patterns (gap map §7.1):
--   MEMBER-READ   enable + force RLS; revoke all from anon, authenticated;
--                 grant select to authenticated; one select policy using
--                 is_business_member(business_id). Every write is the service
--                 role (server actions, jobs) or a security-definer function.
--   SERVER-ONLY   RLS on, revoke all, no policy.
--   APPEND-ONLY   a BEFORE UPDATE OR DELETE trigger that refuses a direct
--                 statement (`when (pg_trigger_depth() = 0)`). Work done
--                 inside another trigger -- an FK cascade or set-null from
--                 deleting a workspace or a lead, or an anonymise trigger --
--                 runs at depth >= 1 and passes. A security-definer function
--                 called directly is depth 0 and is refused like anyone else.
--   ANONYMISE     data_rights_scrub (0124) sets leads.anonymised_at; the
--                 trigger at the end clears the person's values here in the
--                 same transaction. A lead delete cascades.
--
-- Additive and idempotent. No existing row is changed except the widened
-- inbox_channels CHECK, which only admits one more value.

-- ================================================================= leads, consent

-- Recipient time zone and number type (calling-hours.ts, destinations.ts,
-- eligibility.ts PhoneSource). Not personal on their own; the row they sit
-- on is redacted by the scrub like every other lead column.
alter table public.leads
  add column if not exists timezone text
    check (timezone is null or char_length(timezone) between 1 and 64),
  add column if not exists uk_region text
    check (uk_region is null or uk_region in ('ENGLAND_AND_WALES', 'SCOTLAND', 'NORTHERN_IRELAND')),
  add column if not exists phone_type text
    check (phone_type is null or phone_type in (
      'UK_GEOGRAPHIC', 'UK_MOBILE', 'NON_GEO_03', 'BLOCKED_PREMIUM', 'BLOCKED_PERSONAL_070',
      'BLOCKED_PAGER_076', 'BLOCKED_SPECIAL_084_087_09_118', 'TOLL_FREE_080', 'NON_UK')),
  add column if not exists phone_source text
    check (phone_source is null or phone_source in (
      'LEAD_FORM', 'LEAD_MESSAGE', 'INBOUND_CALL', 'MANUAL_BY_LEAD_REQUEST', 'ENRICHMENT', 'IMPORT', 'UNKNOWN'));

-- contact_permissions.consent_scope is jsonb (0030), so the call bases
-- (eligibility.ts CONSENT_BASES) need no CHECK change. TPS/CTPS screening
-- results and the call-consent wording shown sit beside them.
alter table public.contact_permissions
  add column if not exists tps_listed boolean,
  add column if not exists ctps_listed boolean,
  add column if not exists tps_checked_at timestamptz,
  add column if not exists call_consent_wording text
    check (call_consent_wording is null or char_length(call_consent_wording) <= 2000);

-- inbox_channels gains VOICE. Current constraint (checked against the live
-- database 2026-09-27): inbox_channels_channel_check, set by 0072 to EMAIL,
-- SMS, WHATSAPP, MESSENGER, INSTAGRAM, LINKEDIN, TIKTOK. Only widened.
alter table public.inbox_channels drop constraint if exists inbox_channels_channel_check;
alter table public.inbox_channels add constraint inbox_channels_channel_check
  check (channel in ('EMAIL', 'SMS', 'WHATSAPP', 'MESSENGER', 'INSTAGRAM', 'LINKEDIN', 'TIKTOK', 'VOICE'));

-- ================================================================ shared triggers

create or replace function public.voice_reject_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% is append-only; write a new row instead', tg_table_name
    using errcode = 'restrict_violation';
end
$$;
revoke all on function public.voice_reject_mutation() from public, anon, authenticated;

-- ================================================================== voice_settings
-- [MEMBER-READ] One row per workspace. Owner/admin edit it through a server
-- action; admin_kill_switch is set by a platform admin only.
create table if not exists public.voice_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  voice_enabled boolean not null default false,
  admin_kill_switch boolean not null default false,
  admin_kill_reason text check (admin_kill_reason is null or char_length(admin_kill_reason) <= 500),
  -- OD-1 identity (identity.ts). Required before voice_enabled may be true.
  calling_as_name text check (calling_as_name is null or char_length(calling_as_name) between 1 and 80),
  legal_entity_name text check (legal_entity_name is null or char_length(legal_entity_name) between 1 and 160),
  identification_contact text check (identification_contact is null or char_length(identification_contact) between 1 and 300),
  assistant_persona_name text check (assistant_persona_name is null or char_length(assistant_persona_name) between 1 and 40),
  -- The customer-editable remainder only; the locked opener is never stored.
  opener_suffix text check (opener_suffix is null or char_length(opener_suffix) <= 240),
  recording_enabled boolean not null default false,
  recording_retention_days integer not null default 90 check (recording_retention_days between 1 and 365),
  voicemail_enabled boolean not null default false,
  calling_hours jsonb check (calling_hours is null or jsonb_typeof(calling_hours) = 'object'),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  workspace_concurrency integer not null default 2 check (workspace_concurrency between 1 and 20),
  transfer_number_e164 text check (transfer_number_e164 is null or transfer_number_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  provider_agent_id text check (provider_agent_id is null or char_length(provider_agent_id) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The app checks the freephone-or-address rule; the database checks presence.
  constraint voice_settings_identity_before_enable check (
    not voice_enabled
    or (calling_as_name is not null and legal_entity_name is not null and identification_contact is not null)
  )
);
drop trigger if exists voice_settings_set_updated_at on public.voice_settings;
create trigger voice_settings_set_updated_at
  before update on public.voice_settings
  for each row execute function public.set_updated_at();

-- ============================================================== telephony_accounts
-- [SERVER-ONLY] Workspace -> Twilio subaccount. The subaccount auth token is
-- not stored in plaintext: preferably not at all (read with the parent
-- credentials, twilio-voice.ts), else sealed by security/secret-box.ts or held
-- in Supabase Vault and referenced by id.
create table if not exists public.telephony_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null default 'twilio' check (provider in ('twilio')),
  subaccount_sid text not null check (subaccount_sid ~ '^AC[0-9a-fA-F]{32}$'),
  friendly_name text not null check (char_length(friendly_name) between 1 and 64),
  auth_token_ciphertext text,
  auth_token_vault_id uuid,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telephony_accounts_one_per_business unique (business_id, provider),
  constraint telephony_accounts_sid_unique unique (subaccount_sid)
);
drop trigger if exists telephony_accounts_set_updated_at on public.telephony_accounts;
create trigger telephony_accounts_set_updated_at
  before update on public.telephony_accounts
  for each row execute function public.set_updated_at();

-- ================================================================ business_numbers
-- [MEMBER-READ] One provisioning record per workspace number, shared by SMS
-- and voice (numbers/provisioning.ts ProvisioningRecord, sender.ts). Bundle
-- and end-user sids are not secrets; the regulatory details are in
-- number_provisioning_details (server-only).
create table if not exists public.business_numbers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  telephony_account_id uuid references public.telephony_accounts(id) on delete set null,
  provisioning_state text not null default 'NOT_REQUESTED' check (provisioning_state in (
    'NOT_REQUESTED', 'DETAILS_REQUIRED', 'SUBACCOUNT_CREATED', 'BUNDLE_SUBMITTED', 'BUNDLE_IN_REVIEW',
    'BUNDLE_APPROVED', 'BUNDLE_REJECTED', 'NUMBER_SEARCHING', 'NUMBER_PURCHASED', 'CONFIGURED', 'ACTIVE',
    'RELEASE_SCHEDULED', 'RELEASED', 'QUARANTINED')),
  e164 text check (e164 is null or e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_number_sid text,
  number_type text not null default 'mobile' check (number_type in ('mobile')),
  capabilities jsonb not null default '{"voice": false, "sms": false, "mms": false}'::jsonb
    check (jsonb_typeof(capabilities) = 'object'),
  messaging_service_sid text,
  bundle_sid text,
  address_sid text,
  end_user_sid text,
  bundle_status text check (bundle_status is null or bundle_status in (
    'DRAFT', 'PENDING_REVIEW', 'IN_REVIEW', 'APPROVED', 'PROVISIONALLY_APPROVED', 'REJECTED')),
  submitted_fingerprint text,
  rejection_reason text,
  rejection_fixable boolean,
  rejection_fingerprint text,
  purchased_at timestamptz,
  configured_at timestamptz,
  activated_at timestamptz,
  release_after timestamptz,
  released_at timestamptz,
  quarantine_until timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  needs_attention boolean not null default false,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_numbers_id_business_unique unique (id, business_id)
);
-- One live record per workspace, one live holder per e164 (a released or
-- quarantined row may sit beside a new tenant's; sender.ts prefers the live one).
create unique index if not exists business_numbers_one_live_per_business
  on public.business_numbers (business_id)
  where provisioning_state not in ('RELEASED', 'QUARANTINED');
create unique index if not exists business_numbers_one_live_per_e164
  on public.business_numbers (e164)
  where e164 is not null and provisioning_state in ('NUMBER_PURCHASED', 'CONFIGURED', 'ACTIVE', 'RELEASE_SCHEDULED');
create index if not exists business_numbers_e164_idx on public.business_numbers (e164) where e164 is not null;
create index if not exists business_numbers_due_idx
  on public.business_numbers (provisioning_state, release_after, quarantine_until);
drop trigger if exists business_numbers_set_updated_at on public.business_numbers;
create trigger business_numbers_set_updated_at
  before update on public.business_numbers
  for each row execute function public.set_updated_at();

-- [SERVER-ONLY] The regulatory details (provisioning-details.ts). The
-- representative's phone and email are personal data about a workspace
-- user, not a lead; members see a redacted summary through the service role.
create table if not exists public.number_provisioning_details (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  fingerprint text not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists number_provisioning_details_set_updated_at on public.number_provisioning_details;
create trigger number_provisioning_details_set_updated_at
  before update on public.number_provisioning_details
  for each row execute function public.set_updated_at();

-- ====================================================== number_provisioning_events
-- [MEMBER-READ] + [APPEND-ONLY]. One row per applied provisioning event
-- (provisioning.ts StepLogEntry). idempotency_key = businessId:version:event.
create table if not exists public.number_provisioning_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  business_number_id uuid not null,
  from_state text not null,
  to_state text not null,
  event text not null,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint number_provisioning_events_idem unique (idempotency_key),
  constraint number_provisioning_events_number_fk foreign key (business_number_id, business_id)
    references public.business_numbers(id, business_id) on delete cascade
);
create index if not exists number_provisioning_events_number_idx
  on public.number_provisioning_events (business_number_id, created_at);
drop trigger if exists number_provisioning_events_immutable on public.number_provisioning_events;
create trigger number_provisioning_events_immutable
  before update or delete on public.number_provisioning_events
  for each row when (pg_trigger_depth() = 0)
  execute function public.voice_reject_mutation();

-- ======================================================================= voice_calls
-- [MEMBER-READ] + [ANONYMISE]. State per state-machine.ts CALL_STATES. The
-- OD-1 identity and opener version are snapshotted per call. Provider cost
-- and per-minute rate are NOT here: they are ClientTurn's cost, kept in the
-- server-only voice_cost_ledger (0151). The summary and transcript live in
-- voice_call_outcomes / voice_call_transcripts below.
create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  business_number_id uuid references public.business_numbers(id) on delete set null,
  direction text not null check (direction in ('OUTBOUND', 'INBOUND')),
  route text not null check (route in ('QUALIFICATION', 'BOOKING_CLOSE', 'DIRECT_CLOSE', 'NURTURE', 'REACTIVATION', 'INBOUND')),
  state text not null default 'REQUESTED' check (state in (
    'REQUESTED', 'ELIGIBILITY_CHECKED', 'QUEUED', 'DIALLING', 'RINGING', 'ANSWERED', 'VOICEMAIL', 'NO_ANSWER',
    'BUSY', 'FAILED', 'IN_CONVERSATION', 'WRAPPING_UP', 'TRANSFERRED', 'ENDED', 'POST_PROCESSING', 'COMPLETE', 'CANCELLED')),
  call_key text not null check (char_length(call_key) between 1 and 200),
  attempt_number integer not null default 1 check (attempt_number between 1 and 5),
  consent_basis text check (consent_basis is null or consent_basis in ('CALL_REQUESTED', 'FORM_CONSENT_TO_CALL', 'PHONE_NUMBER_PROVIDED')),
  eligibility_reasons text[] not null default '{}',
  to_e164 text check (to_e164 is null or to_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  from_e164 text check (from_e164 is null or from_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  destination_class text,
  recipient_timezone text,
  -- OD-1 snapshot
  calling_as_name text,
  legal_entity_name text,
  identification_contact text,
  persona_name text,
  opener_version text,
  recording_enabled boolean not null default false,
  -- Provider
  provider text check (provider is null or provider in ('retell', 'twilio', 'fake')),
  provider_call_id text,
  carrier_call_sid text,
  disconnection_reason text,
  outcome text check (outcome is null or outcome in ('COMPLETED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'FAILED', 'TRANSFERRED', 'CANCELLED')),
  -- Time (budget.ts, time-governor.ts)
  queued_at timestamptz,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_sec integer check (duration_sec is null or duration_sec >= 0),
  billed_sec integer check (billed_sec is null or billed_sec >= 0),
  reserved_sec integer check (reserved_sec is null or reserved_sec >= 0),
  extensions_used integer not null default 0 check (extensions_used between 0 and 2),
  voicemail_left boolean not null default false,
  voicemail_script_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_calls_call_key_unique unique (business_id, call_key),
  constraint voice_calls_provider_id_unique unique (provider, provider_call_id),
  constraint voice_calls_id_business_unique unique (id, business_id)
);
-- One active call per lead (eligibility.ts voiceLeadLockKey backs the same rule).
create unique index if not exists voice_calls_one_active_per_lead
  on public.voice_calls (business_id, lead_id)
  where state in ('DIALLING', 'RINGING', 'ANSWERED', 'IN_CONVERSATION', 'WRAPPING_UP', 'TRANSFERRED');
create index if not exists voice_calls_lead_idx on public.voice_calls (business_id, lead_id, created_at desc);
-- Workspace concurrency = count of calls in these states (budget.ts checkConcurrency).
create index if not exists voice_calls_active_idx
  on public.voice_calls (business_id)
  where state in ('DIALLING', 'RINGING', 'ANSWERED', 'IN_CONVERSATION', 'WRAPPING_UP', 'TRANSFERRED');
drop trigger if exists voice_calls_set_updated_at on public.voice_calls;
create trigger voice_calls_set_updated_at
  before update on public.voice_calls
  for each row execute function public.set_updated_at();

-- No call for an anonymised lead, and never a lead from another workspace.
-- Raises (a dial must not silently vanish).
create or replace function public.voice_calls_check_lead()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid;
  v_anonymised timestamptz;
begin
  select l.business_id, l.anonymised_at into v_business, v_anonymised
    from public.leads l where l.id = new.lead_id;
  if v_business is distinct from new.business_id then
    raise exception 'lead % does not belong to workspace %', new.lead_id, new.business_id
      using errcode = 'check_violation';
  end if;
  if v_anonymised is not null then
    raise exception 'lead % is anonymised; no call may be created', new.lead_id
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function public.voice_calls_check_lead() from public, anon, authenticated;
drop trigger if exists voice_calls_check_lead on public.voice_calls;
create trigger voice_calls_check_lead
  before insert on public.voice_calls
  for each row execute function public.voice_calls_check_lead();

-- ============================================================ voice_call_eligibility
-- [MEMBER-READ] + [APPEND-ONLY] + [ANONYMISE]. The consent/eligibility
-- decision taken before each call attempt (eligibility.ts canCallLead), with
-- its evidence: which basis, what the person was shown, TPS/CTPS result.
-- One row per check; a re-check is a new row.
create table if not exists public.voice_call_eligibility (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  voice_call_id uuid,
  decision text not null check (decision in ('ALLOWED', 'DENIED')),
  call_kind text not null check (call_kind in ('AI_AUTOMATED', 'HUMAN')),
  consent_basis text check (consent_basis is null or consent_basis in ('CALL_REQUESTED', 'FORM_CONSENT_TO_CALL', 'PHONE_NUMBER_PROVIDED')),
  denials text[] not null default '{}',
  phone_type text,
  phone_source text,
  subscriber_type text check (subscriber_type is null or subscriber_type in ('CORPORATE', 'SOLE_TRADER', 'PARTNERSHIP', 'INDIVIDUAL', 'UNKNOWN')),
  tps_listed boolean,
  ctps_listed boolean,
  within_calling_hours boolean,
  recipient_timezone text,
  -- Consent wording shown, the form/message it came from. Cleared on anonymise.
  consent_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(consent_evidence) = 'object'),
  policy_version text not null check (char_length(policy_version) between 1 and 60),
  checked_at timestamptz not null default now(),
  constraint voice_call_eligibility_decision check ((decision = 'ALLOWED') = (cardinality(denials) = 0)),
  constraint voice_call_eligibility_call_fk foreign key (voice_call_id, business_id)
    references public.voice_calls(id, business_id) on delete cascade
);
create index if not exists voice_call_eligibility_lead_idx
  on public.voice_call_eligibility (business_id, lead_id, checked_at desc);
create index if not exists voice_call_eligibility_call_idx
  on public.voice_call_eligibility (voice_call_id) where voice_call_id is not null;
drop trigger if exists voice_call_eligibility_immutable on public.voice_call_eligibility;
create trigger voice_call_eligibility_immutable
  before update or delete on public.voice_call_eligibility
  for each row when (pg_trigger_depth() = 0)
  execute function public.voice_reject_mutation();

-- ================================================================= voice_call_events
-- [MEMBER-READ] + [APPEND-ONLY]. Every normalised provider event (VoiceEvent).
-- Raw webhook bodies stay in webhook_events (server-only); the payload here
-- holds ids and states, never the transcript or the callee's number.
create table if not exists public.voice_call_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  voice_call_id uuid not null,
  provider text not null,
  event_type text not null,
  dedupe_key text not null,
  occurred_at timestamptz,
  applied boolean not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  constraint voice_call_events_dedupe unique (provider, dedupe_key),
  constraint voice_call_events_call_fk foreign key (voice_call_id, business_id)
    references public.voice_calls(id, business_id) on delete cascade
);
create index if not exists voice_call_events_call_idx on public.voice_call_events (voice_call_id, created_at);
drop trigger if exists voice_call_events_immutable on public.voice_call_events;
create trigger voice_call_events_immutable
  before update or delete on public.voice_call_events
  for each row when (pg_trigger_depth() = 0)
  execute function public.voice_reject_mutation();

-- ======================================================= R2 objects to delete later
-- [SERVER-ONLY] A transcript or recording row that goes (anonymise, lead
-- delete, retention, workspace delete) leaves its R2 object key here; the
-- retention job deletes the object and stamps purged_at. No FK to businesses
-- on purpose: the tombstone must outlive a deleted workspace, or its objects
-- would be orphaned in R2. Holds a key and a workspace id, nothing personal.
create table if not exists public.voice_object_tombstones (
  object_key text primary key check (char_length(object_key) between 1 and 400),
  business_id uuid not null,
  kind text not null check (kind in ('RECORDING', 'TRANSCRIPT')),
  created_at timestamptz not null default now(),
  purged_at timestamptz
);
create index if not exists voice_object_tombstones_pending_idx
  on public.voice_object_tombstones (created_at) where purged_at is null;

create or replace function public.voice_tombstone_object()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.object_key is not null then
    insert into public.voice_object_tombstones (object_key, business_id, kind)
    values (old.object_key, old.business_id,
            case tg_table_name when 'voice_call_recordings' then 'RECORDING' else 'TRANSCRIPT' end)
    on conflict (object_key) do nothing;
  end if;
  return old;
end
$$;
revoke all on function public.voice_tombstone_object() from public, anon, authenticated;

-- A post-call job that was already running when the lead was anonymised
-- must not write the person back in: the row is skipped (0134 pattern).
create or replace function public.voice_child_skip_anonymised()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.voice_calls c
               join public.leads l on l.id = c.lead_id
              where c.id = new.voice_call_id and l.anonymised_at is not null) then
    return null;
  end if;
  return new;
end
$$;
revoke all on function public.voice_child_skip_anonymised() from public, anon, authenticated;

-- =========================================================== voice_call_transcripts
-- [MEMBER-READ] + [ANONYMISE: removed]. Short transcripts inline, long ones
-- in R2 (object_key) served only through a short-lived signed URL.
create table if not exists public.voice_call_transcripts (
  voice_call_id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  format text not null default 'SEGMENTS' check (format in ('SEGMENTS')),
  segments jsonb check (segments is null or jsonb_typeof(segments) = 'array'),
  object_key text check (object_key is null or object_key ~ '^voice/transcripts/[0-9a-f-]{36}/[0-9a-f-]{36}\.json$'),
  language text check (language is null or char_length(language) between 2 and 16),
  word_count integer check (word_count is null or word_count >= 0),
  retain_until timestamptz,
  created_at timestamptz not null default now(),
  constraint voice_call_transcripts_has_content check (segments is not null or object_key is not null),
  constraint voice_call_transcripts_call_fk foreign key (voice_call_id, business_id)
    references public.voice_calls(id, business_id) on delete cascade
);
create index if not exists voice_call_transcripts_retention_idx
  on public.voice_call_transcripts (retain_until) where retain_until is not null;
drop trigger if exists voice_call_transcripts_skip_anonymised on public.voice_call_transcripts;
create trigger voice_call_transcripts_skip_anonymised
  before insert on public.voice_call_transcripts
  for each row execute function public.voice_child_skip_anonymised();
drop trigger if exists voice_call_transcripts_tombstone on public.voice_call_transcripts;
create trigger voice_call_transcripts_tombstone
  after delete on public.voice_call_transcripts
  for each row execute function public.voice_tombstone_object();

-- ============================================================ voice_call_recordings
-- [MEMBER-READ] + [ANONYMISE: removed]. Metadata only. The audio is copied
-- from the provider into R2 (voice/recordings/<business>/<call>/<file>) and
-- served only through storage/r2.ts createDownloadUrl (300 s), member-checked.
create table if not exists public.voice_call_recordings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  voice_call_id uuid not null,
  provider text not null check (provider in ('retell', 'twilio', 'fake')),
  provider_recording_id text,
  status text not null default 'PENDING_FETCH' check (status in ('PENDING_FETCH', 'STORED', 'FAILED')),
  object_key text check (object_key is null or object_key ~ '^voice/recordings/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'),
  content_type text check (content_type is null or content_type in ('audio/mpeg', 'audio/wav')),
  duration_sec integer check (duration_sec is null or duration_sec >= 0),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  stored_at timestamptz,
  retain_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_call_recordings_object_unique unique (object_key),
  constraint voice_call_recordings_provider_unique unique (provider, provider_recording_id),
  constraint voice_call_recordings_stored check (status <> 'STORED' or (object_key is not null and stored_at is not null)),
  constraint voice_call_recordings_call_fk foreign key (voice_call_id, business_id)
    references public.voice_calls(id, business_id) on delete cascade
);
create index if not exists voice_call_recordings_call_idx on public.voice_call_recordings (voice_call_id);
create index if not exists voice_call_recordings_retention_idx
  on public.voice_call_recordings (retain_until) where retain_until is not null;
drop trigger if exists voice_call_recordings_set_updated_at on public.voice_call_recordings;
create trigger voice_call_recordings_set_updated_at
  before update on public.voice_call_recordings
  for each row execute function public.set_updated_at();
drop trigger if exists voice_call_recordings_skip_anonymised on public.voice_call_recordings;
create trigger voice_call_recordings_skip_anonymised
  before insert on public.voice_call_recordings
  for each row execute function public.voice_child_skip_anonymised();
drop trigger if exists voice_call_recordings_tombstone on public.voice_call_recordings;
create trigger voice_call_recordings_tombstone
  after delete on public.voice_call_recordings
  for each row execute function public.voice_tombstone_object();

-- ============================================================== voice_call_outcomes
-- [MEMBER-READ] + [ANONYMISE: summary, facts, next action cleared]. The
-- post-call result (voice.post_call job). The disposition stays: it is the
-- workspace's own record and feeds route analytics. lead_id is carried so a
-- lead delete cascades directly and the lead timeline reads it by index.
create table if not exists public.voice_call_outcomes (
  voice_call_id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  disposition text not null check (disposition in (
    'CONVERSATION', 'MEETING_BOOKED', 'CHECKOUT_LINK_SENT', 'QUOTE_REQUESTED', 'CALLBACK_REQUESTED',
    'NOT_INTERESTED', 'WRONG_PERSON', 'OPTED_OUT', 'TRANSFERRED_TO_HUMAN', 'NO_CONVERSATION')),
  summary text check (summary is null or char_length(summary) <= 4000),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  next_action text check (next_action is null or char_length(next_action) <= 500),
  callback_requested_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_call_outcomes_call_fk foreign key (voice_call_id, business_id)
    references public.voice_calls(id, business_id) on delete cascade
);
create index if not exists voice_call_outcomes_lead_idx on public.voice_call_outcomes (business_id, lead_id);
drop trigger if exists voice_call_outcomes_set_updated_at on public.voice_call_outcomes;
create trigger voice_call_outcomes_set_updated_at
  before update on public.voice_call_outcomes
  for each row execute function public.set_updated_at();
drop trigger if exists voice_call_outcomes_skip_anonymised on public.voice_call_outcomes;
create trigger voice_call_outcomes_skip_anonymised
  before insert on public.voice_call_outcomes
  for each row execute function public.voice_child_skip_anonymised();

-- ================================================================= objection_events
-- [MEMBER-READ] + [ANONYMISE: excerpt cleared]. One row per objection raised,
-- on any channel (gap map §1.1: one taxonomy, sales-library OBJECTION_KEYS;
-- this table records occurrences, not a second taxonomy).
create table if not exists public.objection_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  channel text not null check (channel in ('VOICE', 'SMS', 'WHATSAPP', 'EMAIL', 'MESSENGER', 'INSTAGRAM', 'LINKEDIN', 'TIKTOK')),
  voice_call_id uuid references public.voice_calls(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  objection_key text not null check (objection_key ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'),
  handled_outcome text check (handled_outcome is null or handled_outcome in (
    'RESOLVED', 'PARTIALLY_RESOLVED', 'UNRESOLVED', 'ESCALATED', 'LOST')),
  -- The words that raised it. Cleared on anonymise.
  evidence_excerpt text check (evidence_excerpt is null or char_length(evidence_excerpt) <= 500),
  classifier text check (classifier is null or char_length(classifier) <= 60),
  confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists objection_events_lead_idx on public.objection_events (business_id, lead_id, occurred_at desc);
create index if not exists objection_events_key_idx on public.objection_events (business_id, objection_key, occurred_at desc);

-- New objection/eligibility rows for an anonymised lead are skipped; a lead
-- from another workspace is refused.
create or replace function public.voice_lead_row_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid;
  v_anonymised timestamptz;
begin
  select l.business_id, l.anonymised_at into v_business, v_anonymised
    from public.leads l where l.id = new.lead_id;
  if v_business is distinct from new.business_id then
    raise exception 'lead % does not belong to workspace %', new.lead_id, new.business_id
      using errcode = 'check_violation';
  end if;
  if v_anonymised is not null then
    return null;
  end if;
  return new;
end
$$;
revoke all on function public.voice_lead_row_check() from public, anon, authenticated;
drop trigger if exists objection_events_lead_check on public.objection_events;
create trigger objection_events_lead_check
  before insert on public.objection_events
  for each row execute function public.voice_lead_row_check();
drop trigger if exists voice_call_eligibility_lead_check on public.voice_call_eligibility;
create trigger voice_call_eligibility_lead_check
  before insert on public.voice_call_eligibility
  for each row execute function public.voice_lead_row_check();

-- ======================================================================== RLS
do $$
declare t text;
begin
  -- MEMBER-READ, SERVICE-ROLE-WRITE
  foreach t in array array[
    'voice_settings', 'business_numbers', 'number_provisioning_events', 'voice_calls',
    'voice_call_eligibility', 'voice_call_events', 'voice_call_transcripts',
    'voice_call_recordings', 'voice_call_outcomes', 'objection_events'
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
  -- SERVER-ONLY
  foreach t in array array[
    'telephony_accounts', 'number_provisioning_details', 'voice_object_tombstones'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ================================================================= data rights
-- Delete: voice_calls, voice_call_eligibility, voice_call_outcomes and
-- objection_events reference leads(id) on delete cascade; transcripts,
-- recordings and events cascade from voice_calls (and leave R2 tombstones).
--
-- Anonymise: clear the callee's number, remove transcripts and recordings
-- (their R2 objects are tombstoned for the retention job), and clear the
-- summary, extracted facts, consent evidence and objection excerpts. Route,
-- state, outcome, disposition and durations stay: they are the workspace's
-- own record and feed minutes and economics.
create or replace function public.voice_clear_on_anonymise()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.voice_calls c
     set to_e164 = null
   where c.business_id = new.business_id and c.lead_id = new.id and c.to_e164 is not null;

  delete from public.voice_call_transcripts t
   using public.voice_calls c
   where c.id = t.voice_call_id and c.business_id = new.business_id and c.lead_id = new.id;

  delete from public.voice_call_recordings r
   using public.voice_calls c
   where c.id = r.voice_call_id and c.business_id = new.business_id and c.lead_id = new.id;

  update public.voice_call_outcomes o
     set summary = null, facts = '{}'::jsonb, next_action = null
   where o.business_id = new.business_id and o.lead_id = new.id;

  update public.voice_call_eligibility e
     set consent_evidence = '{}'::jsonb
   where e.business_id = new.business_id and e.lead_id = new.id and e.consent_evidence <> '{}'::jsonb;

  update public.objection_events x
     set evidence_excerpt = null
   where x.business_id = new.business_id and x.lead_id = new.id and x.evidence_excerpt is not null;
  return null;
end
$$;
revoke all on function public.voice_clear_on_anonymise() from public, anon, authenticated;

drop trigger if exists leads_voice_clear_on_anonymise on public.leads;
create trigger leads_voice_clear_on_anonymise
  after update of anonymised_at on public.leads
  for each row when (new.anonymised_at is not null)
  execute function public.voice_clear_on_anonymise();
