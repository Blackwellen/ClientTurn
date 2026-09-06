-- 0054_v4_expansion: the nine V4 expansion sections (§19-§28).
--
-- Almost everything these sections need already exists: sender_identities,
-- domain_health_snapshots, mailbox_health_snapshots, business_memory_facts,
-- business_knowledge_sources, icp_profiles, conversion_goals,
-- customer_usage_allocations, outreach_sequences/outreach_steps,
-- support_tickets/support_messages/support_attachments and
-- platform_provider_checks were all laid down in 0025-0053. This migration
-- adds only what is genuinely missing:
--
--   1. Email as a warm Follow-Up channel on `automation_steps` (§19).
--   2. Structured outreach guidance on `business_profiles` (§26).
--   3. The Copilot's own session/message/action tables (§28).
--
-- No table is created here that duplicates an existing one.

-- ============================================================ §19 follow-up

-- `automation_steps` predates email (0005) and still refuses it. Widen the
-- constraint and give an email step the two things it cannot send without:
-- a subject line and the identity it goes out as.
alter table public.automation_steps
  drop constraint if exists automation_steps_channel_check;
alter table public.automation_steps
  add constraint automation_steps_channel_check
  check (channel in ('sms', 'whatsapp', 'email'));

alter table public.automation_steps
  add column if not exists subject text,
  add column if not exists sender_identity_id uuid
    references public.sender_identities(id) on delete set null;

-- An email step without a subject is not sendable, so it cannot be stored.
-- SMS and WhatsApp steps must leave it null rather than carrying a subject
-- that would never be used.
alter table public.automation_steps
  drop constraint if exists automation_steps_email_subject_check;
alter table public.automation_steps
  add constraint automation_steps_email_subject_check
  check (
    case
      when channel = 'email'
        then subject is not null and length(btrim(subject)) > 0
      else subject is null
    end
  );

comment on column public.automation_steps.sender_identity_id is
  'Preferred sending identity for an email step. Advisory only: the send path
   re-resolves and re-validates the identity (verification, domain and mailbox
   health, daily cap) immediately before every send.';

-- The Follow-Up editor picks a default sender per workspace rather than per
-- step. Stored beside the other messaging defaults.
alter table public.business_settings
  add column if not exists default_sender_identity_id uuid
    references public.sender_identities(id) on delete set null;

-- Warm follow-up may fall back to another channel when the configured one is
-- unavailable for a given lead. Off by default: a silent channel switch is
-- never acceptable, so this is an explicit, auditable workspace choice.
alter table public.business_settings
  add column if not exists follow_up_fallback_enabled boolean not null default false;

-- ==================================================== §26 outreach guidance

-- Structured guidance the campaign and message generators read. Kept on
-- business_profiles rather than in a memory fact because it is authored by the
-- customer, is always exactly one row, and must never be inferred.
alter table public.business_profiles
  add column if not exists outreach_tone text,
  add column if not exists outreach_key_messages text,
  add column if not exists outreach_value_proposition text,
  add column if not exists outreach_proof_points text,
  add column if not exists outreach_avoid text,
  add column if not exists outreach_call_to_action text,
  add column if not exists outreach_claim_restrictions text,
  add column if not exists outreach_guidance_updated_at timestamptz;

-- ========================================================= §28 copilot

-- A Copilot conversation. Scoped to one workspace and one user: Copilot
-- inherits the acting user's permissions and can never be shared across a
-- workspace boundary.
create table if not exists public.copilot_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  -- The route the session was opened from, so a resumed chat keeps its frame.
  origin_path text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger copilot_sessions_set_updated_at
  before update on public.copilot_sessions
  for each row execute function public.set_updated_at();

create index if not exists copilot_sessions_recent_idx
  on public.copilot_sessions (business_id, user_id, updated_at desc);

-- One turn. `content` is the visible message only — model reasoning is never
-- persisted, and there is no column for it.
create table if not exists public.copilot_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.copilot_sessions(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  role text not null check (role in ('USER', 'ASSISTANT', 'TOOL')),
  content text not null default '',
  -- Short, structured summary of any tool results this turn rendered from.
  -- Never raw provider payloads, never credentials.
  tool_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists copilot_messages_session_idx
  on public.copilot_messages (session_id, created_at);

-- Every Copilot tool invocation, read or write. This is the audit surface
-- §28 requires: who asked, which tool, against which object, whether a human
-- confirmed it, and what happened.
create table if not exists public.copilot_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  session_id uuid references public.copilot_sessions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_name text not null,
  kind text not null default 'READ' check (kind in ('READ', 'WRITE')),
  -- The object acted on, as a type + id pair rather than a free-text label.
  object_type text,
  object_id text,
  -- Human-readable one-liner: "Paused Campaign B". Safe to render.
  request_summary text not null default '',
  -- WRITE tools flagged high-impact cannot run without this being true.
  confirmed boolean not null default false,
  outcome text not null default 'PENDING'
    check (outcome in ('PENDING', 'SUCCESS', 'DENIED', 'FAILED')),
  -- Safe error label only. Never a stack trace or a provider response body.
  error_label text,
  created_at timestamptz not null default now()
);

create index if not exists copilot_actions_business_idx
  on public.copilot_actions (business_id, created_at desc);
create index if not exists copilot_actions_session_idx
  on public.copilot_actions (session_id, created_at);

-- --------------------------------------------------------------------- RLS

alter table public.copilot_sessions enable row level security;
alter table public.copilot_messages enable row level security;
alter table public.copilot_actions enable row level security;

-- A Copilot conversation is private to the person who had it. Membership
-- alone is not enough — a colleague must not read someone else's chat.
drop policy if exists copilot_sessions_select on public.copilot_sessions;
create policy copilot_sessions_select on public.copilot_sessions
  for select to authenticated
  using (public.is_business_member(business_id) and user_id = auth.uid());

drop policy if exists copilot_messages_select on public.copilot_messages;
create policy copilot_messages_select on public.copilot_messages
  for select to authenticated
  using (
    public.is_business_member(business_id)
    and exists (
      select 1 from public.copilot_sessions s
      where s.id = copilot_messages.session_id and s.user_id = auth.uid()
    )
  );

-- The action log is workspace-visible: it is an accountability record, not a
-- private conversation, and an owner must be able to see what Copilot did.
drop policy if exists copilot_actions_select on public.copilot_actions;
create policy copilot_actions_select on public.copilot_actions
  for select to authenticated
  using (public.is_business_member(business_id));

-- Writes go through server actions on the service-role client, which apply the
-- permission and confirmation gates. No direct insert grant is issued to
-- `authenticated`, so the browser cannot write a session, a message or —
-- critically — a forged "confirmed" action row.
grant select on public.copilot_sessions to authenticated;
grant select on public.copilot_messages to authenticated;
grant select on public.copilot_actions to authenticated;

-- ================================================== §20 cold sequence schedule

-- When a cold sequence is allowed to send (V4 §20.7).
--
-- These are the customer's stated preferences, not the enforcement: the
-- dispatcher still applies the compliance pack's quiet hours, the sender's
-- daily cap and mailbox health on top. A customer can narrow the window; they
-- cannot widen it past what policy and provider health permit.
alter table public.outreach_campaigns
  add column if not exists send_timezone text not null default 'Europe/London',
  add column if not exists send_window_start time,
  add column if not exists send_window_end time,
  -- Minimum days between two emails to the same prospect. Bounded so a
  -- sequence cannot be configured into a burst.
  add column if not exists min_gap_days integer not null default 2
    check (min_gap_days >= 0 and min_gap_days <= 30);

-- A window is either fully set or fully absent; a start with no end is not a
-- window, and would be interpreted differently by every reader.
alter table public.outreach_campaigns
  drop constraint if exists outreach_campaigns_send_window_check;
alter table public.outreach_campaigns
  add constraint outreach_campaigns_send_window_check
  check (
    (send_window_start is null and send_window_end is null)
    or (send_window_start is not null and send_window_end is not null)
  );
