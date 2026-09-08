-- 0094_social_profile_visit_and_signals: the warming touch, and signals that
-- can be seen and triggered individually.
--
-- Two additions that are unrelated in the code and related in the product: both
-- exist because a customer could not see, or could not act on, something the
-- system was already doing.

-- ==========================================================================
-- 1. Visiting a profile before asking to connect
-- ==========================================================================
-- A connection request from a stranger who has never looked at your profile is
-- the coldest possible approach. Viewing first produces a "someone viewed your
-- profile" notification, which is a real, permitted, no-cost touch -- the
-- recipient often looks back, and the invite that follows lands on somebody who
-- has already seen the name.
--
-- It is modelled as an action rather than a state because it does not change
-- what may happen next: a visit neither opens nor closes the messaging gate,
-- which is `ACCEPTED`'s job alone. What it changes is only the *order* of the
-- steps, and whether the invite is the first thing the person sees.
--
-- Counted in the action log for the same reason invites are: profile views are
-- rate-limited by LinkedIn too, and a limit that is not counted from what
-- actually happened is not a limit.

alter table public.social_action_log
  drop constraint if exists social_action_log_action_check;
alter table public.social_action_log
  add constraint social_action_log_action_check
  check (action in ('INVITE','INVITE_WITH_NOTE','MESSAGE','FOLLOW','WITHDRAW','VISIT'));

alter table public.social_connection_states
  -- When the profile was viewed as a warming step. Distinct from a visit that
  -- happens later in a sequence: this one is specifically the pre-invite touch,
  -- and its presence is what stops the sequencer visiting twice.
  add column if not exists warmed_at timestamptz;

alter table public.social_connection_states
  drop constraint if exists social_connection_states_next_action_check;
alter table public.social_connection_states
  add constraint social_connection_states_next_action_check
  check (next_action is null or next_action in ('INVITE','MESSAGE','FOLLOW_UP','WITHDRAW','VISIT'));

alter table public.business_data_controls
  -- Off by default. It is an extra action against the account's own rate
  -- limits, and a workspace should choose to spend them that way.
  add column if not exists social_warm_before_invite boolean not null default false,
  -- Hours between the profile view and the invite. Too short and the two land
  -- together and read as automation; too long and the view is forgotten.
  add column if not exists social_warm_delay_hours integer not null default 24;

alter table public.business_data_controls
  drop constraint if exists business_data_controls_warm_delay_check;
alter table public.business_data_controls
  add constraint business_data_controls_warm_delay_check
  check (social_warm_delay_hours between 1 and 168);

-- ==========================================================================
-- 2. Signals as things a customer can see and trigger
-- ==========================================================================
-- The sourcing waterfall already runs "signals" -- a recently-funded search, a
-- competitor's followers, a job-change feed -- but they existed only as
-- provider calls inside a run. A customer could see that 354 leads arrived and
-- not which signal produced them, could not tell a productive signal from a
-- dead one, and could not run one on demand.
--
-- This makes each signal a row: what it is, how it is doing, when it next runs,
-- and whether it is on. That is what turns "the agent found some leads" into
-- something a person can actually manage.

create table if not exists public.sourcing_signals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- The source this signal feeds. Null for a workspace-level signal that is not
  -- attached to a specific saved search.
  agent_id uuid references public.agents(id) on delete cascade,

  name text not null,
  /**
   * What kind of signal this is. Shown to the customer as the subtitle, and
   * used to decide which provider capability serves it.
   */
  kind text not null
    check (kind in (
      'ENGAGEMENT',        -- people who interacted with the workspace's own posts
      'COMPETITOR',        -- a named competitor's audience
      'JOB_CHANGE',        -- recently changed roles
      'FUNDING',           -- recently raised
      'HIRING',            -- currently hiring for a relevant role
      'KEYWORD',           -- a phrase in a profile or page
      'ICP_TOP',           -- the best-scoring slice of the ICP
      'WEBSITE_SIGNAL'     -- something on the company's own site
    )),
  /** The phrase, competitor handle or filter this signal runs on. */
  query text,

  active boolean not null default true,

  /* ------------------------------------------------------------ health */
  -- Denormalised deliberately. The Sources list shows these for every signal on
  -- every render, and deriving them from `prospects` each time is a scan per
  -- row. Written by the run that produced them.
  leads_found integer not null default 0,
  leads_found_this_week integer not null default 0,
  last_run_at timestamptz,
  next_run_at timestamptz,
  /** Why the last run produced nothing, when it produced nothing. */
  last_result text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, agent_id, name)
);

drop trigger if exists sourcing_signals_set_updated_at on public.sourcing_signals;
create trigger sourcing_signals_set_updated_at
  before update on public.sourcing_signals
  for each row execute function public.set_updated_at();

create index if not exists sourcing_signals_due_idx
  on public.sourcing_signals (next_run_at)
  where active and next_run_at is not null;

create index if not exists sourcing_signals_business_idx
  on public.sourcing_signals (business_id, active);

alter table public.sourcing_signals enable row level security;
alter table public.sourcing_signals force row level security;

drop policy if exists sourcing_signals_select on public.sourcing_signals;
create policy sourcing_signals_select on public.sourcing_signals
  for select to authenticated
  using (exists (
    select 1 from public.business_members m
     where m.business_id = sourcing_signals.business_id
       and m.user_id = auth.uid()
  ));

-- Read-only to the browser. Launching a signal costs provider money, so it goes
-- through a server action that checks the budget first.
revoke all on public.sourcing_signals from anon, authenticated;
grant select on public.sourcing_signals to authenticated;
