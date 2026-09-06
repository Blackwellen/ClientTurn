-- 0044_v4_unified_inbox: one inbox across email, WhatsApp, SMS and the social
-- channels the platforms actually permit.
--
-- WHAT IS AND IS NOT POSSIBLE. This matters more here than anywhere else in the
-- product, because a unified inbox is easy to promise and partly impossible to
-- deliver:
--
--   * Email        — the workspace's own mailbox, already connected (0029).
--   * WhatsApp     — WhatsApp Business API via the existing provider. Read and
--                    send both work.
--   * SMS          — existing provider. Read and send both work.
--   * Messenger    — Meta Messenger Platform, against a Facebook Page the
--                    customer administers. Read and send work once the Page is
--                    connected and permissions are granted.
--   * Instagram    — Instagram Messaging API, against a Professional account
--                    linked to that Page. Same conditions.
--   * LinkedIn     — there is NO general API that lets an application read a
--                    member's LinkedIn inbox. The Conversations/Messaging APIs
--                    are restricted to approved partner programmes. So LinkedIn
--                    is modelled here with `can_read = false` and
--                    `can_send = false` by default, and the UI says so plainly
--                    rather than showing an empty inbox that looks broken.
--
-- Modelling the capability per channel — rather than assuming every channel is
-- symmetric — is what keeps the product honest about the last one.

-- ---------------------------------------------------------- inbox_channels
create table public.inbox_channels (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null
    check (channel in ('EMAIL','SMS','WHATSAPP','MESSENGER','INSTAGRAM','LINKEDIN')),
  provider text not null,
  -- The Page, number, mailbox or account this connection speaks for.
  external_account_id text,
  display_name text not null,
  handle text,
  avatar_url text,
  secret_ref text,
  mailbox_connection_id uuid references public.mailbox_connections(id) on delete cascade,

  status text not null default 'REQUIRES_SETUP'
    check (status in ('CONNECTED','DEGRADED','ACTION_REQUIRED','REQUIRES_SETUP','UNAVAILABLE','DISCONNECTED')),
  status_detail text,

  -- Capability, not aspiration. A channel the platform will not let us read
  -- reports can_read = false and the inbox explains why instead of pretending.
  can_read boolean not null default false,
  can_send boolean not null default false,
  unavailable_reason text,

  sync_cursor text,
  last_sync_at timestamptz,
  last_error text,
  unread_count integer not null default 0,
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, channel, external_account_id)
);

create trigger inbox_channels_set_updated_at
  before update on public.inbox_channels
  for each row execute function public.set_updated_at();

create index inbox_channels_business_idx
  on public.inbox_channels (business_id, status);

-- --------------------------------------------- widen the conversation model
-- The V3 conversation already carries lead/prospect linkage and a channel. The
-- social channels join it rather than getting a parallel thread model, so one
-- person who emails and then messages on Instagram is one conversation.
alter table public.conversations
  drop constraint if exists conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check
  check (channel in ('sms','whatsapp','email','multi','messenger','instagram','linkedin'));

alter table public.messages
  drop constraint if exists messages_channel_check;
alter table public.messages
  add constraint messages_channel_check
  check (channel in ('sms','whatsapp','email','messenger','instagram','linkedin'));

alter table public.conversations
  add column if not exists inbox_channel_id uuid references public.inbox_channels(id) on delete set null,
  add column if not exists external_thread_id text,
  add column if not exists counterparty_name text,
  add column if not exists counterparty_handle text,
  add column if not exists counterparty_avatar_url text,
  add column if not exists unread_count integer not null default 0,
  add column if not exists is_archived boolean not null default false,
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
  add column if not exists snoozed_until timestamptz;

-- Provider thread ids are only unique within a channel, so the constraint is
-- scoped by both rather than by id alone.
create unique index if not exists conversations_external_thread_idx
  on public.conversations (business_id, channel, external_thread_id)
  where external_thread_id is not null;

create index if not exists conversations_inbox_idx
  on public.conversations (business_id, is_archived, last_message_at desc);
create index if not exists conversations_unread_idx
  on public.conversations (business_id, unread_count)
  where unread_count > 0;
create index if not exists conversations_assigned_idx
  on public.conversations (business_id, assigned_user_id)
  where assigned_user_id is not null;

alter table public.messages
  add column if not exists inbox_channel_id uuid references public.inbox_channels(id) on delete set null,
  add column if not exists external_message_id text,
  add column if not exists sender_name text,
  add column if not exists sender_handle text,
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists read_at timestamptz;

create unique index if not exists messages_external_id_idx
  on public.messages (business_id, channel, external_message_id)
  where external_message_id is not null;

-- ---------------------------------------------------------------- RLS
alter table public.inbox_channels enable row level security;
alter table public.inbox_channels force row level security;
revoke all on public.inbox_channels from anon;

-- Connection rows name a provider account and reference a secret, so they
-- follow the owner/admin restriction the other connection tables use.
create policy inbox_channels_select_admin on public.inbox_channels
  for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));

-- `secret_ref` is a pointer into the server-only secret store and is never
-- needed by a browser, so it is excluded from the grant.
do $$
declare allowed text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into allowed
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'inbox_channels'
     and column_name not in ('secret_ref','sync_cursor');

  execute format('grant select (%s) on public.inbox_channels to authenticated', allowed);
end $$;

-- ------------------------------------------------------------ inbox counts
-- One round trip for the channel rail's unread badges.
create or replace function public.inbox_channel_counts(p_business_id uuid)
returns table (
  channel text,
  total integer,
  unread integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    c.channel,
    count(*)::int,
    coalesce(sum(c.unread_count), 0)::int
  from public.conversations c
  where c.business_id = p_business_id
    and not c.is_archived
  group by c.channel;
$$;

revoke all on function public.inbox_channel_counts(uuid) from public, anon;
grant execute on function public.inbox_channel_counts(uuid) to authenticated;
