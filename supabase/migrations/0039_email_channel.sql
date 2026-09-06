-- 0039_email_channel: email as a first-class messaging channel, sent through
-- each workspace's own mailbox.
--
-- Design note. There is no new "email account" table: `integrations` already
-- carries a per-workspace `'email'` provider row, and `integration_secrets`
-- is the server-only, RLS-less table this codebase already uses for provider
-- credentials. SMTP/IMAP/POP3 host settings go in `integrations.config`
-- (non-sensitive) and the two passwords go in `integration_secrets.extra`,
-- encrypted at rest by the application before they are ever written.
--
-- `contact_suppressions` (0008) already accepts channel 'email', so bounce
-- and complaint suppression needs no schema change either.

-- ------------------------------------------------------------ provider ---
-- The workspace's own mailbox uses the 'imap_smtp' provider type that
-- 0038_v4_core_extensions already permits, rather than introducing a second
-- name for the same concept. It stays distinct from the platform 'email'
-- provider, which is the transactional sender for invitations and alerts.
-- No constraint change is needed here.

-- ------------------------------------------------------------- channels ---
-- Widen the three channel constraints. Each is dropped and recreated because
-- Postgres has no "alter check constraint".

-- `conversations` already accepts 'email' (0029_v4_outreach_comms) and also
-- carries 'multi'. It is restated here only so the superset is explicit and
-- this migration is safe to re-run; dropping 'multi' would break the V4
-- outreach threads.
alter table public.conversations
  drop constraint if exists conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check
  check (channel in ('sms', 'whatsapp', 'email', 'multi'));

alter table public.messages
  drop constraint if exists messages_channel_check;
alter table public.messages
  add constraint messages_channel_check
  check (channel in ('sms', 'whatsapp', 'email'));

alter table public.campaigns
  drop constraint if exists campaigns_channel_check;
alter table public.campaigns
  add constraint campaigns_channel_check
  check (channel in ('sms', 'whatsapp', 'email'));

-- ------------------------------------------------------------- subjects ---
-- Email needs a subject line per message. SMS and WhatsApp leave these null.

alter table public.campaigns
  add column if not exists subject_template text,
  add column if not exists followup_subject_template text;

-- A subject is only meaningful on an email campaign, and an email campaign
-- without one is not sendable. Enforced here so no code path can create one.
alter table public.campaigns
  drop constraint if exists campaigns_email_subject_check;
alter table public.campaigns
  add constraint campaigns_email_subject_check
  check (
    channel <> 'email'
    or status = 'DRAFT'
    or (subject_template is not null and length(btrim(subject_template)) > 0)
  );

-- Per-message subject, so a sent email can be reproduced exactly as it went.
alter table public.messages
  add column if not exists subject text;

-- ---------------------------------------------------------- unsubscribe ---
-- Marketing email must carry a working one-click unsubscribe. The token is a
-- random per-lead secret rather than a signed lead id, so a leaked link can
-- be revoked for one lead without rotating an application key.
alter table public.leads
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists leads_unsubscribe_token_idx
  on public.leads (unsubscribe_token);

-- ------------------------------------------------------------- indexes ----

-- The IMAP/POP poller matches an inbound message to a lead by email address.
create index if not exists leads_business_email_idx
  on public.leads (business_id, lower(email))
  where email is not null;

-- The poller records the highest message it has already ingested so a restart
-- cannot replay an entire mailbox.
comment on column public.integrations.config is
  'Non-sensitive provider configuration. For provider_type = ''imap_smtp'' this holds
   from_name, from_email, reply_to, smtp {host, port, secure}, inbound
   {protocol: imap|pop3|none, host, port, secure, mailbox} and cursor
   {uid_validity, last_uid, last_seen_at}. Credentials live in
   integration_secrets.extra, encrypted.';
