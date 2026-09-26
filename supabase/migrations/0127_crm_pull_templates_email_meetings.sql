-- 0127_crm_pull_templates_email_meetings: closing the remaining Phase 3 gaps of
-- the core revenue engine.
--
-- Design: docs/revenue-engine/05-phases-3-6-design.md (3.1 booking, 3.5
-- channels) and the brief's §29 (CRM pull), §43 (email), §45 (WhatsApp) and
-- §57 (meeting types and rep routing).
--
-- 1. crm_pull_settings: an opt-in inbound sync per connected CRM, off by
--    default. The cursor itself reuses lead_source_cursors (0016), keyed by the
--    same integration id; crm_push_records gains a lookup index so a record we
--    pushed is recognised and never re-ingested as a new lead.
-- 2. whatsapp_templates + whatsapp_step_templates: the approved-template
--    registry (synced from Twilio Content and, for a workspace on Meta's Cloud
--    API, from its WhatsApp Business Account) and the mapping of a follow-up
--    step to a template. messages gains the template actually sent, its
--    variables and its pricing category (cost attribution).
-- 3. Email controls: messages.message_class (TRANSACTIONAL | MARKETING);
--    sender_identities.health_state from the complaint-rate monitor; a capped
--    send-slot claim that takes the mailbox provider's daily ceiling and sets
--    warmup_started_at on a sender's first ever send.
-- 4. meeting_types + bookings.meeting_type_id: duration, buffer and a rep
--    routing rule per kind of meeting. With no meeting types the workspace
--    keeps its single calendar and its business_settings duration/buffer.
--
-- Assumptions about existing data: none of the new columns is NOT NULL
-- without a default, no existing row is rewritten, and no constraint is added
-- that an existing row could fail. sender_identities rows get
-- health_state 'HEALTHY'; the first-use warm-up rule only fires for a sender
-- that has never sent (sent_today_on is null), so an established sender is
-- never pushed back onto a ramp.

-- ============================================================ 1. CRM pull
create table if not exists public.crm_pull_settings (
  integration_id uuid primary key references public.integrations(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider_type text not null
    check (provider_type in ('hubspot', 'salesforce', 'zoho_crm')),
  -- Off by default: pulling a CRM's contacts in is an explicit choice (§29).
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  last_run_at timestamptz,
  last_run_status text
    check (last_run_status is null or last_run_status in ('OK', 'PARTIAL', 'FAILED')),
  last_run_error text check (last_run_error is null or length(last_run_error) <= 500),
  last_run_ingested integer not null default 0 check (last_run_ingested >= 0),
  last_run_skipped integer not null default 0 check (last_run_skipped >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_pull_settings_enabled_idx
  on public.crm_pull_settings (business_id)
  where enabled;

create trigger crm_pull_settings_set_updated_at
  before update on public.crm_pull_settings
  for each row execute function public.set_updated_at();

alter table public.crm_pull_settings enable row level security;
alter table public.crm_pull_settings force row level security;
revoke all on public.crm_pull_settings from anon, authenticated;
grant select on public.crm_pull_settings to authenticated;
create policy crm_pull_settings_select_member on public.crm_pull_settings
  for select to authenticated using (public.is_business_member(business_id));

-- Loop prevention: "is this CRM record one we pushed?" is asked once per
-- pulled record, by (workspace, provider, external id).
create index if not exists crm_push_records_external_idx
  on public.crm_push_records (business_id, provider_type, external_contact_id)
  where external_contact_id is not null;

-- ======================================================= 2. WhatsApp templates
-- business_id is null for a template on the platform's own Twilio account
-- (Twilio Content is account-wide, and every workspace not on the Cloud API
-- sends through that account). A Meta Cloud API template belongs to the one
-- workspace whose WhatsApp Business Account holds it.
create table if not exists public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  provider text not null check (provider in ('twilio', 'meta')),
  -- Twilio: the Content SID (HX...). Meta: the template's own id.
  external_id text not null check (length(external_id) between 1 and 200),
  name text not null check (length(name) between 1 and 512),
  language text not null check (length(language) between 2 and 20),
  category text not null check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  status text not null
    check (status in ('APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'UNKNOWN')),
  body text check (body is null or length(body) <= 4096),
  -- Positional variable keys in the order the template declares them ("1", "2", ...).
  variables text[] not null default '{}',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_templates_identity unique nulls not distinct (business_id, provider, external_id)
);

create index if not exists whatsapp_templates_business_idx
  on public.whatsapp_templates (business_id, provider, status);

create trigger whatsapp_templates_set_updated_at
  before update on public.whatsapp_templates
  for each row execute function public.set_updated_at();

alter table public.whatsapp_templates enable row level security;
alter table public.whatsapp_templates force row level security;
revoke all on public.whatsapp_templates from anon, authenticated;
grant select on public.whatsapp_templates to authenticated;
-- A platform template (business_id null) carries no tenant data: it is the
-- operator's approved wording, readable by any signed-in member.
create policy whatsapp_templates_select_member on public.whatsapp_templates
  for select to authenticated
  using (business_id is null or public.is_business_member(business_id));

-- The template a follow-up step sends when the 24-hour window has closed.
-- Keyed by (automation, position) rather than by automation_steps.id: saving a
-- draft rewrites the step rows, and a mapping keyed on a row id would be lost
-- on every edit of the sequence.
create table if not exists public.whatsapp_step_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  automation_id uuid not null references public.automation_definitions(id) on delete cascade,
  step_position integer not null check (step_position between 1 and 100),
  template_id uuid not null references public.whatsapp_templates(id) on delete cascade,
  -- { "1": "first_name", "2": "business_name" }: template variable -> merge field.
  variable_map jsonb not null default '{}'::jsonb
    check (jsonb_typeof(variable_map) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (automation_id, step_position)
);

create index if not exists whatsapp_step_templates_business_idx
  on public.whatsapp_step_templates (business_id);

create trigger whatsapp_step_templates_set_updated_at
  before update on public.whatsapp_step_templates
  for each row execute function public.set_updated_at();

alter table public.whatsapp_step_templates enable row level security;
alter table public.whatsapp_step_templates force row level security;
revoke all on public.whatsapp_step_templates from anon, authenticated;
grant select on public.whatsapp_step_templates to authenticated;
create policy whatsapp_step_templates_select_member on public.whatsapp_step_templates
  for select to authenticated using (public.is_business_member(business_id));

-- What was actually sent. No foreign key on the template id: a template
-- deleted at the provider must not erase the record of what a lead received.
alter table public.messages
  add column if not exists whatsapp_template_id uuid,
  add column if not exists template_variables jsonb,
  add column if not exists template_category text
    check (template_category is null
           or template_category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  -- ========================================== 3a. transactional vs marketing
  -- Null on every row written before this migration, and on non-email rows.
  add column if not exists message_class text
    check (message_class is null or message_class in ('TRANSACTIONAL', 'MARKETING'));

-- ============================================================ 3. email
alter table public.sender_identities
  add column if not exists health_state text not null default 'HEALTHY'
    check (health_state in ('HEALTHY', 'WATCH', 'WARNING', 'PAUSED')),
  add column if not exists health_reason text
    check (health_reason is null or length(health_reason) <= 300),
  add column if not exists complaint_rate_7d numeric(8,6)
    check (complaint_rate_7d is null or complaint_rate_7d >= 0),
  add column if not exists sent_7d integer check (sent_7d is null or sent_7d >= 0),
  add column if not exists complaints_7d integer check (complaints_7d is null or complaints_7d >= 0),
  add column if not exists health_checked_at timestamptz;

-- The capped claim. Same contract as claim_sender_send_slot (0058) -- one
-- atomic statement, false when there is no room -- plus:
--   * p_ceiling: the connected mailbox provider's safe daily limit
--     (src/lib/email/account.ts MAILBOX_SEND_LIMITS). The effective allowance
--     is the lower of the warm-up allowance and the ceiling. Null = no ceiling.
--   * a sender the complaint monitor PAUSED gets no slot.
--   * warmup_started_at is set on the sender's first ever send (never on an
--     established sender, identified by having sent before).
create or replace function public.claim_sender_send_slot_capped(
  p_business_id uuid,
  p_sender_id uuid,
  p_ceiling integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed boolean;
begin
  update public.sender_identities s
     set sent_today = case
           when s.sent_today_on is distinct from current_date then 1
           else s.sent_today + 1
         end,
         sent_today_on = current_date,
         warmup_started_at = case
           when s.warmup_started_at is null and s.sent_today_on is null then now()
           else s.warmup_started_at
         end
   where s.id = p_sender_id
     and s.business_id = p_business_id
     and s.active
     and s.health_state <> 'PAUSED'
     and (s.paused_until is null or s.paused_until <= now())
     and case
           when s.sent_today_on is distinct from current_date then 0
           else s.sent_today
         end < least(
           public.sender_daily_allowance(s),
           coalesce(nullif(p_ceiling, 0), public.sender_daily_allowance(s))
         )
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_sender_send_slot_capped(uuid, uuid, integer)
  from public, anon, authenticated;

comment on function public.claim_sender_send_slot_capped(uuid, uuid, integer) is
  'Atomically reserves one send against a sender identity: the lower of its
   warm-up allowance and the mailbox provider ceiling, refused while the
   complaint monitor has it PAUSED. Sets warmup_started_at on first use.';

-- The two-argument form keeps its callers working and gains the same rules.
create or replace function public.claim_sender_send_slot(
  p_business_id uuid,
  p_sender_id uuid
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.claim_sender_send_slot_capped(p_business_id, p_sender_id, null);
$$;

revoke all on function public.claim_sender_send_slot(uuid, uuid)
  from public, anon, authenticated;

-- ======================================================= 4. meeting types
create table if not exists public.meeting_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 240),
  assignee_rule text not null default 'ROUND_ROBIN'
    check (assignee_rule in ('ROUND_ROBIN', 'SPECIALISM', 'OWNER')),
  -- Workspace members who may take this meeting. Empty = nobody is assigned
  -- (the booking is the workspace's, as before meeting types existed).
  eligible_user_ids uuid[] not null default '{}',
  -- Services this meeting type is for; empty = any service.
  service_ids uuid[] not null default '{}',
  -- SPECIALISM: { "<user id>": ["<service id>", ...] }.
  specialisms jsonb not null default '{}'::jsonb
    check (jsonb_typeof(specialisms) = 'object'),
  -- The calendar availability is read from. Null = the workspace booking mode's.
  calendar_integration_id uuid references public.integrations(id) on delete set null,
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(eligible_user_ids) <= 50),
  check (cardinality(service_ids) <= 50)
);

create index if not exists meeting_types_business_idx
  on public.meeting_types (business_id)
  where active;
create unique index if not exists meeting_types_default_idx
  on public.meeting_types (business_id)
  where is_default and active;

create trigger meeting_types_set_updated_at
  before update on public.meeting_types
  for each row execute function public.set_updated_at();

alter table public.meeting_types enable row level security;
alter table public.meeting_types force row level security;
revoke all on public.meeting_types from anon, authenticated;
grant select on public.meeting_types to authenticated;
create policy meeting_types_select_member on public.meeting_types
  for select to authenticated using (public.is_business_member(business_id));

alter table public.bookings
  add column if not exists meeting_type_id uuid
    references public.meeting_types(id) on delete set null;

-- Round robin counts each eligible rep's bookings over the next seven days.
create index if not exists bookings_assignee_upcoming_idx
  on public.bookings (business_id, assigned_user_id, starts_at)
  where assigned_user_id is not null;
