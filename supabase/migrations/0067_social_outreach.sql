-- 0067_social_outreach: connect-then-message outreach on LinkedIn, Facebook and
-- Instagram (V4 §16, extending the channel model beyond email).
--
-- Why this needs its own tables rather than reusing the email sequence:
--
-- Social outreach has a **prerequisite the platform enforces**. You cannot
-- message a stranger on LinkedIn — you send a connection request, and only once
-- it is accepted does a message become possible. On Instagram and Facebook a
-- message to a non-follower lands in Message Requests, where it is usually
-- never seen; following first is what makes it arrive.
--
-- So a social "send" is a two-step state machine with an indefinite wait in the
-- middle, controlled by the recipient. `outreach_recipient_runs` models a timed
-- sequence — step 1, wait 3 days, step 2 — which is the wrong shape: the wait
-- here is not a delay we choose, it is a gate somebody else opens. Forcing it
-- into the email model would produce a scheduler that "sends" messages nobody
-- can receive and reports them as delivered.
--
-- The second reason is limits. Email is capped by our own sending reputation;
-- social is capped by the platform, per account, per week, and exceeding it
-- gets the customer's personal account restricted. That is a much worse
-- outcome than a slow campaign, so the caps are first-class columns that the
-- scheduler reads before every action.

-- ------------------------------------------------- social_sending_accounts
create table if not exists public.social_sending_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  platform text not null
    check (platform in ('LINKEDIN','FACEBOOK','INSTAGRAM')),
  -- Which tier this account is on. The single most common explanation for
  -- "why has my campaign stopped", so it is recorded rather than guessed.
  account_tier text not null default 'FREE'
    check (account_tier in ('FREE','PREMIUM','SALES_NAVIGATOR','RECRUITER','BUSINESS_PAGE')),
  display_name text not null,
  /* The platform's own handle for the account. Not a credential. */
  external_handle text,
  /* Null means "use the published default for this platform and tier"; a value
     is an admin override for an account that has been warmed or throttled. */
  daily_connect_cap integer,
  weekly_connect_cap integer,
  monthly_note_cap integer,
  daily_message_cap integer,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','PAUSED','RESTRICTED','DISCONNECTED')),
  /* Set when the platform itself has throttled the account. While this is
     present the scheduler will not act on it at all, whatever the caps say. */
  restricted_until timestamptz,
  restricted_reason text,
  /**
   * How the action actually reaches the platform.
   *
   * ASSISTED — the product prepares the invite and the message and a person
   * sends it. Always available, and never at odds with a platform's terms.
   *
   * PARTNER_API — a compliant partner integration sends it server-side. Only
   * usable where such an integration exists and the workspace has one.
   *
   * Defaulting to ASSISTED is deliberate: automating a personal LinkedIn
   * account without a partner agreement is what gets accounts banned, and the
   * product should not do that to a customer by default.
   */
  send_mode text not null default 'ASSISTED'
    check (send_mode in ('ASSISTED','PARTNER_API')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, platform, external_handle)
);

create trigger social_sending_accounts_set_updated_at
  before update on public.social_sending_accounts
  for each row execute function public.set_updated_at();

create index if not exists social_sending_accounts_business_idx
  on public.social_sending_accounts (business_id, platform, status);

-- ------------------------------------------------- social_connection_states
-- One row per (prospect, platform). The state machine the scheduler reads
-- before it is allowed to do anything.
create table if not exists public.social_connection_states (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  account_id uuid references public.social_sending_accounts(id) on delete set null,
  platform text not null
    check (platform in ('LINKEDIN','FACEBOOK','INSTAGRAM')),
  state text not null default 'NOT_CONNECTED'
    check (state in ('NOT_CONNECTED','INVITE_QUEUED','INVITE_SENT','ACCEPTED',
                     'DECLINED','WITHDRAWN','MESSAGED','REPLIED','BLOCKED')),
  /* The profile being contacted. Public URL, not a scraped record. */
  profile_url text,
  external_ref text,
  /* Whether the invite carried a personalised note. Free accounts get very few,
     so this is counted rather than assumed. */
  note_attached boolean not null default false,
  note_body text,
  invite_sent_at timestamptz,
  accepted_at timestamptz,
  messaged_at timestamptz,
  replied_at timestamptz,
  declined_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prospect_id, platform)
);

create trigger social_connection_states_set_updated_at
  before update on public.social_connection_states
  for each row execute function public.set_updated_at();

create index if not exists social_connection_states_business_idx
  on public.social_connection_states (business_id, platform, state);

-- The scheduler's due-work query: who has been accepted but not yet messaged.
create index if not exists social_connection_states_ready_idx
  on public.social_connection_states (business_id, state, accepted_at)
  where state = 'ACCEPTED';

-- ------------------------------------------------------- social_action_log
-- Append-only. Every invite and message, whether a person or an API sent it.
-- This is what the usage counters are derived from, so a limit can never
-- disagree with what actually happened.
create table if not exists public.social_action_log (
  id bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  account_id uuid references public.social_sending_accounts(id) on delete set null,
  prospect_id uuid references public.prospects(id) on delete set null,
  platform text not null,
  action text not null
    check (action in ('INVITE','INVITE_WITH_NOTE','MESSAGE','FOLLOW','WITHDRAW')),
  performed_by text not null default 'ASSISTED'
    check (performed_by in ('ASSISTED','PARTNER_API')),
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index if not exists social_action_log_usage_idx
  on public.social_action_log (business_id, account_id, action, occurred_at desc);

-- ---------------------------------------------------------------------- RLS
alter table public.social_sending_accounts enable row level security;
alter table public.social_sending_accounts force row level security;
alter table public.social_connection_states enable row level security;
alter table public.social_connection_states force row level security;
alter table public.social_action_log enable row level security;
alter table public.social_action_log force row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'social_sending_accounts','social_connection_states','social_action_log'
  ] loop
    execute format($f$
      drop policy if exists %1$s_select on public.%1$s;
      create policy %1$s_select on public.%1$s
        for select to authenticated
        using (exists (
          select 1 from public.business_members m
           where m.business_id = %1$s.business_id
             and m.user_id = auth.uid()
        ));
    $f$, t);

    -- Read-only to the browser. Every write goes through a server action that
    -- checks the caps first; a client that could insert into the action log
    -- could make the limit counters say anything.
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

revoke all on sequence public.social_action_log_id_seq from anon, authenticated;

-- -------------------------------------------------------- usage aggregation
-- The counters the caps are checked against, derived from the log rather than
-- from a column that could drift out of step with it.
create or replace function public.social_account_usage(
  p_business_id uuid,
  p_account_id uuid
)
returns table (
  connects_today integer,
  connects_this_week integer,
  messages_today integer,
  notes_this_month integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*) filter (
      where l.action in ('INVITE','INVITE_WITH_NOTE','FOLLOW')
        and l.occurred_at >= date_trunc('day', now())
    )::int,
    count(*) filter (
      where l.action in ('INVITE','INVITE_WITH_NOTE','FOLLOW')
        and l.occurred_at >= now() - interval '7 days'
    )::int,
    count(*) filter (
      where l.action = 'MESSAGE'
        and l.occurred_at >= date_trunc('day', now())
    )::int,
    count(*) filter (
      where l.action = 'INVITE_WITH_NOTE'
        and l.occurred_at >= date_trunc('month', now())
    )::int
  from public.social_action_log l
  where l.business_id = p_business_id
    and l.account_id = p_account_id;
$$;

revoke all on function public.social_account_usage(uuid, uuid) from public, anon;
grant execute on function public.social_account_usage(uuid, uuid) to authenticated;

-- ------------------------------------------------------------- stream events
-- An acceptance is the moment a prospect becomes messageable, and it arrives
-- from outside the product. The Find Leads surfaces should not need a refresh
-- to notice it.
create or replace function public.social_states_stream_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.state is not distinct from old.state then
    return new;
  end if;

  perform public.emit_stream_event(
    new.business_id, 'FIND_LEADS', 'PROSPECT', new.prospect_id, 'social_' || lower(new.state)
  );
  return new;
end $$;

drop trigger if exists social_connection_states_stream_trg on public.social_connection_states;
create trigger social_connection_states_stream_trg
  after insert or update on public.social_connection_states
  for each row execute function public.social_states_stream_notify();
