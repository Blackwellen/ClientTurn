-- 13-voice-schema-draft.sql
--
-- DRAFT for a future migration (gap map §10 proposes 0150 voice_foundation and
-- 0151 voice_calls). NOT a migration: it lives under docs/, is not applied, and
-- must be re-numbered and split when it is promoted. Re-list
-- supabase/migrations immediately before creating the real files (memory:
-- "parallel sessions collide"). Depends on 0143 (payment_endpoints pattern) and
-- 0144 (opportunities.service_id) being applied first.
--
-- Written 2026-09-27 for phase P1 (pure modules under src/lib/voice/). Column
-- names follow those modules so the later wiring is mechanical:
--   voice_settings            <- entitlement.ts (identity, kill switch, enabled),
--                                calling-hours.ts (config), opener.ts (version)
--   telephony_accounts        <- numbers/provisioning.ts (subaccount per workspace)
--   business_numbers          <- numbers/provisioning.ts ProvisioningRecord, sender.ts
--   number_provisioning_events<- provisioning.ts StepLogEntry (append-only)
--   voice_calls               <- state-machine.ts CALL_STATES, eligibility.ts keys,
--                                opener.ts OD-1 snapshot, budget.ts
--   voice_call_events         <- providers/types.ts VoiceEvent (append-only)
--   voice_call_queue          <- budget.ts QUEUE_PRIORITY
--   voice_minute_*            <- budget.ts reserve/settle/release (AI-token shape)
--
-- RLS patterns (gap map §7.1), used exactly:
--   [MEMBER-READ]   enable + force RLS; revoke all from anon, authenticated;
--                   grant select to authenticated; policy is_business_member().
--                   All writes by the service role from server actions / jobs.
--   [SERVER-ONLY]   RLS on, revoke all, no browser policy at all. Read through the
--                   service role (a redacted view where the UI needs a summary).
--   [IMMUTABLE]     BEFORE UPDATE OR DELETE trigger raising; corrections are new rows.
--   [ANONYMISE]     AFTER UPDATE OF leads.anonymised_at trigger clears PII; lead
--                   delete cascades.
--
-- Naming note: the gap map §5 proposed `voice_numbers`. The owner's number
-- requirement (2026-09-27) makes the number shared by SMS and voice, so the
-- table is `business_numbers`.

-- =============================================================== contact / leads

-- Recipient time zone and number type (calling-hours.ts, destinations.ts).
alter table public.leads
  add column if not exists timezone text,
  add column if not exists uk_region text
    check (uk_region is null or uk_region in ('ENGLAND_AND_WALES', 'SCOTLAND', 'NORTHERN_IRELAND')),
  add column if not exists phone_type text
    check (phone_type is null or phone_type in (
      'UK_GEOGRAPHIC', 'UK_MOBILE', 'NON_GEO_03', 'BLOCKED_PREMIUM', 'BLOCKED_PERSONAL_070',
      'BLOCKED_PAGER_076', 'BLOCKED_SPECIAL_084_087_09_118', 'TOLL_FREE_080', 'NON_UK')),
  add column if not exists phone_source text
    check (phone_source is null or phone_source in (
      'LEAD_FORM', 'LEAD_MESSAGE', 'INBOUND_CALL', 'MANUAL_BY_LEAD_REQUEST', 'ENRICHMENT', 'IMPORT', 'UNKNOWN'));

-- contact_permissions.consent_scope is jsonb (0030), so the new call bases
-- (CALL_REQUESTED, FORM_CONSENT_TO_CALL, PHONE_NUMBER_PROVIDED) need no CHECK
-- change; the app validates them (eligibility.ts CONSENT_BASES). TPS/CTPS
-- screening results are stored beside them:
alter table public.contact_permissions
  add column if not exists tps_listed boolean,
  add column if not exists ctps_listed boolean,
  add column if not exists tps_checked_at timestamptz,
  add column if not exists call_consent_wording text;

-- inbox_channels gains VOICE (0044 CHECK). Look up the CURRENT constraint name
-- and value list first: later migrations may have widened it (e.g. TIKTOK).
-- alter table public.inbox_channels drop constraint inbox_channels_channel_check;
-- alter table public.inbox_channels add constraint inbox_channels_channel_check
--   check (channel in ('EMAIL','SMS','WHATSAPP','MESSENGER','INSTAGRAM','LINKEDIN','TIKTOK','VOICE'));

-- =================================================================== voice_settings
-- [MEMBER-READ] One row per workspace. Owner/admin edit through a server action.
create table if not exists public.voice_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  voice_enabled boolean not null default false,
  admin_kill_switch boolean not null default false,          -- set by platform admin only
  admin_kill_reason text,
  -- OD-1 identity (identity.ts). Required before voice_enabled may be true.
  calling_as_name text check (calling_as_name is null or char_length(calling_as_name) between 1 and 80),
  legal_entity_name text check (legal_entity_name is null or char_length(legal_entity_name) between 1 and 160),
  identification_contact text check (identification_contact is null or char_length(identification_contact) between 1 and 300),
  assistant_persona_name text check (assistant_persona_name is null or char_length(assistant_persona_name) between 1 and 40),
  -- The customer-editable remainder only; the locked opener is never stored here.
  opener_suffix text check (opener_suffix is null or char_length(opener_suffix) <= 240),
  recording_enabled boolean not null default false,
  recording_retention_days integer not null default 90 check (recording_retention_days between 1 and 365),
  voicemail_enabled boolean not null default false,
  calling_hours jsonb,                                        -- calling-hours.ts CallingHoursConfig; null = default
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  workspace_concurrency integer not null default 2 check (workspace_concurrency between 1 and 20),
  route_allocations jsonb not null default '{}'::jsonb,       -- budget.ts RouteAllocations
  transfer_number_e164 text check (transfer_number_e164 is null or transfer_number_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  provider_agent_id text,                                     -- Retell agent id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Voice cannot be switched on without the OD-1 identity (the app checks the
  -- freephone-or-address rule; the database checks presence).
  constraint voice_settings_identity_before_enable check (
    not voice_enabled
    or (calling_as_name is not null and legal_entity_name is not null and identification_contact is not null)
  )
);
create trigger voice_settings_set_updated_at
  before update on public.voice_settings
  for each row execute function public.set_updated_at();
alter table public.voice_settings enable row level security;
alter table public.voice_settings force row level security;
revoke all on public.voice_settings from anon, authenticated;
grant select on public.voice_settings to authenticated;
create policy voice_settings_select_member on public.voice_settings
  for select to authenticated using (public.is_business_member(business_id));

-- ============================================================= telephony_accounts
-- [SERVER-ONLY] Workspace -> Twilio subaccount. The subaccount auth token is
-- NEVER stored in plaintext. Preferred: not stored at all (read with the parent
-- credentials when needed, twilio-voice.ts subCreds). If caching is needed,
-- store it sealed by security/secret-box.ts (as payment_endpoints does) or in
-- Supabase Vault (vault.secrets, referenced by id).
create table if not exists public.telephony_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null default 'twilio' check (provider in ('twilio')),
  subaccount_sid text not null check (subaccount_sid ~ '^AC[0-9a-fA-F]{32}$'),
  friendly_name text not null,
  auth_token_ciphertext text,                                 -- sealed, optional
  auth_token_vault_id uuid,                                   -- alternative to ciphertext
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telephony_accounts_one_per_business unique (business_id, provider),
  constraint telephony_accounts_sid_unique unique (subaccount_sid)
);
create trigger telephony_accounts_set_updated_at
  before update on public.telephony_accounts
  for each row execute function public.set_updated_at();
alter table public.telephony_accounts enable row level security;
alter table public.telephony_accounts force row level security;
revoke all on public.telephony_accounts from anon, authenticated;

-- =============================================================== business_numbers
-- [MEMBER-READ] One provisioning record per workspace number (SMS + voice).
-- Mirrors numbers/provisioning.ts ProvisioningRecord. Bundle and end-user sids
-- are not secrets; the regulatory details themselves live in
-- number_provisioning_details (server-only) below.
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
  capabilities jsonb not null default '{"voice": false, "sms": false, "mms": false}'::jsonb,
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
  last_error text,
  needs_attention boolean not null default false,
  version integer not null default 0,                         -- optimistic concurrency (expected_version)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One live record per workspace, and one live holder per e164 (a quarantined
-- or released row may sit beside a new tenant's; sender.ts prefers the live one).
create unique index if not exists business_numbers_one_live_per_business
  on public.business_numbers (business_id)
  where provisioning_state not in ('RELEASED', 'QUARANTINED');
create unique index if not exists business_numbers_one_live_per_e164
  on public.business_numbers (e164)
  where e164 is not null and provisioning_state in ('NUMBER_PURCHASED', 'CONFIGURED', 'ACTIVE', 'RELEASE_SCHEDULED');
create index if not exists business_numbers_e164_idx on public.business_numbers (e164) where e164 is not null;
create index if not exists business_numbers_due_idx
  on public.business_numbers (provisioning_state, release_after, quarantine_until);
create trigger business_numbers_set_updated_at
  before update on public.business_numbers
  for each row execute function public.set_updated_at();
alter table public.business_numbers enable row level security;
alter table public.business_numbers force row level security;
revoke all on public.business_numbers from anon, authenticated;
grant select on public.business_numbers to authenticated;
create policy business_numbers_select_member on public.business_numbers
  for select to authenticated using (public.is_business_member(business_id));

-- [SERVER-ONLY] The regulatory details (provisioning-details.ts): the
-- representative's phone and email are personal data; members see a redacted
-- summary through the service role.
create table if not exists public.number_provisioning_details (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  details jsonb not null,                                     -- provisioningDetailsSchema
  fingerprint text not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger number_provisioning_details_set_updated_at
  before update on public.number_provisioning_details
  for each row execute function public.set_updated_at();
alter table public.number_provisioning_details enable row level security;
alter table public.number_provisioning_details force row level security;
revoke all on public.number_provisioning_details from anon, authenticated;

-- ===================================================== number_provisioning_events
-- [MEMBER-READ] + [IMMUTABLE]. One row per applied provisioning event
-- (provisioning.ts StepLogEntry). idempotency_key = businessId:version:event.
create table if not exists public.number_provisioning_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  business_number_id uuid not null references public.business_numbers(id) on delete cascade,
  from_state text not null,
  to_state text not null,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint number_provisioning_events_idem unique (idempotency_key)
);
create index if not exists number_provisioning_events_number_idx
  on public.number_provisioning_events (business_number_id, created_at);

create or replace function public.voice_reject_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only; write a new row instead', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

-- `pg_trigger_depth() = 0`: a direct UPDATE/DELETE is refused, while the FK
-- cascade from deleting a workspace (or a lead, for the tables below) still
-- runs, since cascades fire at trigger depth >= 1 (verify in the migration test).
create trigger number_provisioning_events_immutable
  before update or delete on public.number_provisioning_events
  for each row when (pg_trigger_depth() = 0)
  execute function public.voice_reject_mutation();
alter table public.number_provisioning_events enable row level security;
alter table public.number_provisioning_events force row level security;
revoke all on public.number_provisioning_events from anon, authenticated;
grant select on public.number_provisioning_events to authenticated;
create policy number_provisioning_events_select_member on public.number_provisioning_events
  for select to authenticated using (public.is_business_member(business_id));

-- ====================================================================== voice_calls
-- [MEMBER-READ] + [ANONYMISE]. State per state-machine.ts. The OD-1 identity
-- and opener version are SNAPSHOTTED per call (gap map OD-1).
create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  direction text not null check (direction in ('OUTBOUND', 'INBOUND')),
  route text not null check (route in ('QUALIFICATION', 'BOOKING_CLOSE', 'DIRECT_CLOSE', 'NURTURE', 'REACTIVATION', 'INBOUND')),
  state text not null default 'REQUESTED' check (state in (
    'REQUESTED', 'ELIGIBILITY_CHECKED', 'QUEUED', 'DIALLING', 'RINGING', 'ANSWERED', 'VOICEMAIL', 'NO_ANSWER',
    'BUSY', 'FAILED', 'IN_CONVERSATION', 'WRAPPING_UP', 'TRANSFERRED', 'ENDED', 'POST_PROCESSING', 'COMPLETE', 'CANCELLED')),
  call_key text not null,                                     -- eligibility.ts voiceCallKey (idempotent dial)
  attempt_number integer not null default 1 check (attempt_number between 1 and 5),
  consent_basis text check (consent_basis in ('CALL_REQUESTED', 'FORM_CONSENT_TO_CALL', 'PHONE_NUMBER_PROVIDED')),
  eligibility_reasons text[] not null default '{}',
  to_e164 text,                                               -- cleared on anonymise
  from_e164 text,
  destination_class text,
  rate_usd_per_min numeric(8, 4),
  recipient_timezone text,
  -- OD-1 snapshot
  calling_as_name text,
  legal_entity_name text,
  identification_contact text,
  persona_name text,
  opener_version text,
  recording_enabled boolean not null default false,
  -- Provider
  provider text check (provider in ('retell', 'twilio', 'fake')),
  provider_call_id text,
  carrier_call_sid text,
  disconnection_reason text,
  outcome text check (outcome is null or outcome in ('COMPLETED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'FAILED', 'TRANSFERRED', 'CANCELLED')),
  -- Time and minutes (budget.ts, time-governor.ts)
  queued_at timestamptz,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_sec integer check (duration_sec is null or duration_sec >= 0),
  billed_sec integer check (billed_sec is null or billed_sec >= 0),
  reserved_sec integer check (reserved_sec is null or reserved_sec >= 0),
  extensions_used integer not null default 0 check (extensions_used between 0 and 2),
  -- Content (cleared on anonymise; recording object deleted from R2 by a job)
  summary text,
  transcript jsonb,
  recording_key text,
  voicemail_left boolean not null default false,
  voicemail_script_version text,
  cost_cents numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_calls_call_key_unique unique (business_id, call_key),
  constraint voice_calls_provider_id_unique unique (provider, provider_call_id)
);
-- One active call per lead (eligibility.ts voiceLeadLockKey backs the same rule).
create unique index if not exists voice_calls_one_active_per_lead
  on public.voice_calls (business_id, lead_id)
  where state in ('DIALLING', 'RINGING', 'ANSWERED', 'IN_CONVERSATION', 'WRAPPING_UP', 'TRANSFERRED');
create index if not exists voice_calls_lead_idx on public.voice_calls (business_id, lead_id, created_at desc);
create index if not exists voice_calls_active_idx
  on public.voice_calls (business_id)
  where state in ('DIALLING', 'RINGING', 'ANSWERED', 'IN_CONVERSATION', 'WRAPPING_UP', 'TRANSFERRED');
create trigger voice_calls_set_updated_at
  before update on public.voice_calls
  for each row execute function public.set_updated_at();
alter table public.voice_calls enable row level security;
alter table public.voice_calls force row level security;
revoke all on public.voice_calls from anon, authenticated;
grant select on public.voice_calls to authenticated;
create policy voice_calls_select_member on public.voice_calls
  for select to authenticated using (public.is_business_member(business_id));

-- State changes go through ONE security-definer RPC that locks the row and
-- checks the expected state (gap map §73), never a bare UPDATE from app code:
--   voice_call_transition(p_call_id uuid, p_expected text, p_next text, p_patch jsonb)
-- The transition table itself is enforced in state-machine.ts; the RPC refuses
-- when state <> p_expected (a concurrent writer won).

-- ================================================================ voice_call_events
-- [MEMBER-READ] + [IMMUTABLE]. Every normalised provider event (VoiceEvent).
-- Raw webhook bodies stay in webhook_events (server-only), not here.
create table if not exists public.voice_call_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  voice_call_id uuid not null references public.voice_calls(id) on delete cascade,
  provider text not null,
  event_type text not null,
  dedupe_key text not null,
  occurred_at timestamptz,
  applied boolean not null,                                   -- false = stale (applyObservedState)
  payload jsonb not null default '{}'::jsonb,                 -- normalised, no PII beyond ids
  created_at timestamptz not null default now(),
  constraint voice_call_events_dedupe unique (provider, dedupe_key)
);
create index if not exists voice_call_events_call_idx on public.voice_call_events (voice_call_id, created_at);
create trigger voice_call_events_immutable
  before update or delete on public.voice_call_events
  for each row when (pg_trigger_depth() = 0)
  execute function public.voice_reject_mutation();
alter table public.voice_call_events enable row level security;
alter table public.voice_call_events force row level security;
revoke all on public.voice_call_events from anon, authenticated;
grant select on public.voice_call_events to authenticated;
create policy voice_call_events_select_member on public.voice_call_events
  for select to authenticated using (public.is_business_member(business_id));

-- ================================================================= voice_call_queue
-- [SERVER-ONLY] The dial queue (budget.ts QUEUE_PRIORITY), claimed by the worker.
create table if not exists public.voice_call_queue (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  voice_call_id uuid not null references public.voice_calls(id) on delete cascade,
  priority text not null check (priority in (
    'INBOUND_CALLBACK', 'CALL_REQUESTED_FRESH', 'BOOKING_CLOSE', 'DIRECT_CLOSE', 'QUALIFICATION', 'NURTURE', 'REACTIVATION')),
  priority_rank smallint not null check (priority_rank between 0 and 6),
  not_before timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  created_at timestamptz not null default now(),
  constraint voice_call_queue_one_per_call unique (voice_call_id)
);
create index if not exists voice_call_queue_due_idx
  on public.voice_call_queue (priority_rank, not_before, created_at)
  where claimed_at is null;
alter table public.voice_call_queue enable row level security;
alter table public.voice_call_queue force row level security;
revoke all on public.voice_call_queue from anon, authenticated;

-- ===================================================================== voice minutes
-- Copies the AI token shape (0116): balance (member-read), ledger (member-read,
-- immutable), reservations (server-only). Units are SECONDS (budget.ts).
create table if not exists public.voice_minute_balances (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  included_remaining_sec integer not null default 0,
  pack_remaining_sec integer not null default 0 check (pack_remaining_sec >= 0),
  period_included_sec integer not null default 0 check (period_included_sec >= 0),
  period_start timestamptz,
  period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.voice_minute_balances enable row level security;
alter table public.voice_minute_balances force row level security;
revoke all on public.voice_minute_balances from anon, authenticated;
grant select on public.voice_minute_balances to authenticated;
create policy voice_minute_balances_select_member on public.voice_minute_balances
  for select to authenticated using (public.is_business_member(business_id));

create table if not exists public.voice_minute_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in (
    'RESERVE', 'SETTLE', 'RELEASE', 'PERIOD_GRANT', 'PERIOD_EXPIRE', 'PACK_PURCHASE', 'PACK_REFUND', 'ADJUSTMENT')),
  voice_call_id uuid references public.voice_calls(id) on delete set null,
  included_delta_sec integer not null default 0,
  pack_delta_sec integer not null default 0,
  idempotency_key text not null,                              -- voice:reserve|settle|release:<callId>
  reason text,
  stripe_ref text,                                            -- pack purchase: TEST mode only
  created_at timestamptz not null default now(),
  constraint voice_minute_ledger_idem unique (business_id, idempotency_key)
);
create index if not exists voice_minute_ledger_business_idx on public.voice_minute_ledger (business_id, created_at desc);
create trigger voice_minute_ledger_immutable
  before update or delete on public.voice_minute_ledger
  for each row when (pg_trigger_depth() = 0)
  execute function public.voice_reject_mutation();
alter table public.voice_minute_ledger enable row level security;
alter table public.voice_minute_ledger force row level security;
revoke all on public.voice_minute_ledger from anon, authenticated;
grant select on public.voice_minute_ledger to authenticated;
create policy voice_minute_ledger_select_member on public.voice_minute_ledger
  for select to authenticated using (public.is_business_member(business_id));

create table if not exists public.voice_minute_reservations (
  voice_call_id uuid primary key references public.voice_calls(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  held_sec integer not null check (held_sec > 0),
  from_included_sec integer not null check (from_included_sec >= 0),
  from_pack_sec integer not null check (from_pack_sec >= 0),
  status text not null default 'HELD' check (status in ('HELD', 'SETTLED', 'RELEASED')),
  billed_sec integer check (billed_sec is null or billed_sec >= 0),
  shortfall_sec integer not null default 0 check (shortfall_sec >= 0),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint voice_minute_reservations_split check (from_included_sec + from_pack_sec = held_sec)
);
create index if not exists voice_minute_reservations_held_idx
  on public.voice_minute_reservations (business_id) where status = 'HELD';
alter table public.voice_minute_reservations enable row level security;
alter table public.voice_minute_reservations force row level security;
revoke all on public.voice_minute_reservations from anon, authenticated;
-- reserve / settle / release are SECURITY DEFINER RPCs that lock the balance
-- row (FOR UPDATE), apply budget.ts arithmetic, and write the ledger row with
-- its idempotency key in the same transaction.

-- ======================================================================= data rights
-- [ANONYMISE] Clear the call PII when a lead is anonymised (0124
-- data_rights_scrub sets leads.anonymised_at). Outcome, duration, cost and
-- route stay: they are the workspace's own record and feed economics. The
-- recording object in R2 is deleted by the retention job, keyed from
-- recording_key before it is cleared (the job reads a tombstone list).
create table if not exists public.voice_recording_tombstones (
  recording_key text primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.voice_recording_tombstones enable row level security;
alter table public.voice_recording_tombstones force row level security;
revoke all on public.voice_recording_tombstones from anon, authenticated;

create or replace function public.voice_clear_on_anonymise()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.voice_recording_tombstones (recording_key, business_id)
  select c.recording_key, c.business_id
    from public.voice_calls c
   where c.business_id = new.business_id and c.lead_id = new.id and c.recording_key is not null
  on conflict do nothing;
  update public.voice_calls c
     set to_e164 = null,
         summary = null,
         transcript = null,
         recording_key = null
   where c.business_id = new.business_id and c.lead_id = new.id;
  return null;
end
$$;
revoke all on function public.voice_clear_on_anonymise() from public, anon, authenticated;

drop trigger if exists leads_voice_clear_on_anonymise on public.leads;
create trigger leads_voice_clear_on_anonymise
  after update of anonymised_at on public.leads
  for each row when (new.anonymised_at is not null)
  execute function public.voice_clear_on_anonymise();

-- Refuse NEW calls for an anonymised lead (the 0134 pattern).
create or replace function public.voice_calls_refuse_anonymised()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.leads l where l.id = new.lead_id and l.anonymised_at is not null) then
    raise exception 'lead % is anonymised; no call may be created', new.lead_id using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function public.voice_calls_refuse_anonymised() from public, anon, authenticated;
create trigger voice_calls_refuse_anonymised
  before insert on public.voice_calls
  for each row execute function public.voice_calls_refuse_anonymised();

-- Retention: extend data_rights_retention_candidates() (0124) with voice_calls
-- older than voice_settings.recording_retention_days that still hold a
-- transcript or recording_key; the retention job clears them and tombstones
-- the R2 object, exactly as the anonymise hook does.

-- ======================================================================= entitlements
-- plan_entitlements rows (unit boolean / numeric), all 0 on plan rows: the Pro
-- voice ITEM and the add-on packs grant them via business_entitlement_grants
-- (gap map OD-2 implementation map). Metric keys:
--   voice_sales_enabled (boolean), voice_minutes_included (numeric, seconds or
--   minutes: decide once; budget.ts works in seconds).
