-- 0053_acquisition_campaign_wizard: the six-step acquisition campaign wizard,
-- the launch snapshot it freezes, and the runtime counters the sender loop
-- claims against (V4 section 16-18).
--
-- Nothing here is a second campaign engine. `outreach_campaigns`,
-- `outreach_sequences`, `outreach_steps` and `outreach_recipient_runs` from
-- 0029 remain the system of record; this migration adds the configuration the
-- wizard collects, an attributed cost ledger so the budget card reports real
-- allocations rather than a guess, and one atomic claim function so two workers
-- can never both spend the last contact of the day.

-- --------------------------------------------------- campaign configuration
alter table public.outreach_campaigns
  -- Goal. `success_event` is the conversion the optimiser reads; it is stored
  -- on the campaign rather than derived from the goal because a workspace may
  -- legitimately measure a different (compatible) event.
  add column if not exists success_event text,
  -- The goal the wizard collected. `conversion_goal_id` still points at the
  -- workspace's own goal record when one matches, but the campaign must be
  -- able to state its objective even before that record exists.
  add column if not exists conversion_goal_type text
    check (conversion_goal_type is null or conversion_goal_type in
      ('BOOK_APPOINTMENT','BOOK_SITE_VISIT','BOOK_DEMO','REQUEST_QUOTE','PHONE_CALL',
       'DIRECT_SIGNUP','DIRECT_PURCHASE','HUMAN_HANDOVER','CUSTOM')),
  add column if not exists prospect_source text not null default 'BOTH'
    check (prospect_source in ('BOTH','EXISTING_ONLY','NEW_ONLY')),
  add column if not exists search_session_id uuid
    references public.search_sessions(id) on delete set null,
  add column if not exists exclusions_json jsonb not null default '{}'::jsonb,
  add column if not exists named_companies jsonb not null default '[]'::jsonb,
  -- Distinct from `minimum_grade`: the grade decides who the campaign targets,
  -- the threshold decides who is diverted to a human instead of contacted.
  add column if not exists review_threshold integer not null default 70
    check (review_threshold >= 0 and review_threshold <= 100),
  add column if not exists reply_rules_json jsonb not null default '{}'::jsonb,
  add column if not exists promotion_rule text not null default 'MANUAL'
    check (promotion_rule in ('MANUAL','POSITIVE_REPLY','BOOKED_EVENT','CUSTOM')),
  add column if not exists variants_enabled boolean not null default false,
  add column if not exists variants_per_step integer not null default 1
    check (variants_per_step >= 1 and variants_per_step <= 4),
  -- Messages reserved from the tenant allowance for this campaign. A count,
  -- not money, so it is safe for the browser to read.
  add column if not exists communication_allowance integer not null default 0
    check (communication_allowance >= 0),
  add column if not exists auto_optimize_config jsonb not null default '{}'::jsonb,
  -- Frozen at launch so historical reporting survives later config drift.
  add column if not exists scoring_policy_version text,
  add column if not exists compliance_policy_version text,
  add column if not exists launch_mode text not null default 'MANUAL_REVIEW'
    check (launch_mode in ('MANUAL_REVIEW','IMMEDIATE')),
  -- Where the wizard left off, so a draft reopens on the step being edited.
  add column if not exists draft_step text,
  add column if not exists pause_reason text,
  add column if not exists archived_at timestamptz;

create index if not exists outreach_campaigns_archived_idx
  on public.outreach_campaigns (business_id, archived_at)
  where archived_at is null;

-- ------------------------------------------------------ attributed spend
-- The budget card breaks spend down by category. Without an attributed ledger
-- the only honest breakdown is "unknown", so every campaign-attributed cost is
-- written here with the category that caused it. Money columns, so the whole
-- table is withheld from the browser role and read through a definer function.
create table if not exists public.outreach_campaign_costs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  category text not null
    check (category in ('DATA_ENRICHMENT','EMAIL_SENDING','PROVIDER_DATA','OTHER')),
  cost_minor bigint not null default 0,
  quantity numeric(18,4) not null default 1,
  reference text,
  occurred_at timestamptz not null default now()
);

create index if not exists outreach_campaign_costs_campaign_idx
  on public.outreach_campaign_costs (business_id, campaign_id, occurred_at desc);

-- ------------------------------------------------------- runtime counters
-- One row per campaign. Daily and monthly contact counts live here rather than
-- being recounted from `messages` at send time: the cap has to be claimed
-- atomically, and an aggregate over a growing table cannot be.
create table if not exists public.outreach_campaign_usage (
  campaign_id uuid primary key references public.outreach_campaigns(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  daily_contact_count integer not null default 0,
  daily_contact_on date,
  monthly_contact_count integer not null default 0,
  monthly_contact_month date,
  provider_cost_reserved_minor bigint not null default 0,
  provider_cost_actual_minor bigint not null default 0,
  communication_reserved integer not null default 0,
  communication_used integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists outreach_campaign_usage_business_idx
  on public.outreach_campaign_usage (business_id);

-- ---------------------------------------------------------- state history
-- Every transition, with who caused it and why. The Activity tab reads this,
-- and an auto-pause writes here before it writes anywhere else.
create table if not exists public.outreach_campaign_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  actor_type text not null default 'USER'
    check (actor_type in ('USER','SYSTEM','OPTIMIZATION')),
  actor_user_id uuid references auth.users(id) on delete set null,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists outreach_campaign_events_idx
  on public.outreach_campaign_events (business_id, campaign_id, created_at desc);

-- ------------------------------------------------------------------- RLS
alter table public.outreach_campaign_costs enable row level security;
alter table public.outreach_campaign_costs force row level security;
alter table public.outreach_campaign_usage enable row level security;
alter table public.outreach_campaign_usage force row level security;
alter table public.outreach_campaign_events enable row level security;
alter table public.outreach_campaign_events force row level security;

-- Cost rows are money. No browser role reads them at all; the breakdown is
-- served by the definer function below.
revoke all on public.outreach_campaign_costs from anon, authenticated;

grant select on public.outreach_campaign_events to authenticated;
revoke all on public.outreach_campaign_events from anon;

drop policy if exists outreach_campaign_events_select_member on public.outreach_campaign_events;
create policy outreach_campaign_events_select_member
  on public.outreach_campaign_events for select to authenticated
  using (public.is_business_member(business_id));

-- Usage carries reserved provider spend, so only the non-money columns are
-- granted, matching how 0041 treats `outreach_campaigns`.
revoke all on public.outreach_campaign_usage from anon, authenticated;
grant select (campaign_id, business_id, daily_contact_count, daily_contact_on,
              monthly_contact_count, monthly_contact_month, communication_reserved,
              communication_used, updated_at)
  on public.outreach_campaign_usage to authenticated;

drop policy if exists outreach_campaign_usage_select_member on public.outreach_campaign_usage;
create policy outreach_campaign_usage_select_member
  on public.outreach_campaign_usage for select to authenticated
  using (public.is_business_member(business_id));

-- 0041 replaced the table-wide grant on `outreach_campaigns` with a column
-- list. The columns added above are not in that list, so the grant has to be
-- recomputed or the whole wizard reads NULL through the browser role.
do $grant$
declare
  allowed text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into allowed
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'outreach_campaigns'
     and c.column_name not in ('max_cost_minor','spent_cost_minor','reserved_allowance_minor');

  execute 'revoke select on public.outreach_campaigns from authenticated';
  execute format('grant select (%s) on public.outreach_campaigns to authenticated', allowed);
end $grant$;

-- ----------------------------------------------- atomic contact-slot claim
-- Cost-race protection. Two workers must never both see the last contact of
-- the day and each take it. The counters are rolled over and incremented
-- inside a single UPDATE, so the row lock decides the winner.
create or replace function public.claim_campaign_contact_slot(
  p_business_id uuid,
  p_campaign_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_daily_cap integer;
  v_monthly_cap integer;
  v_today date := (now() at time zone 'utc')::date;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_claimed boolean;
begin
  select c.daily_contact_cap, c.monthly_contact_cap
    into v_daily_cap, v_monthly_cap
    from public.outreach_campaigns c
   where c.business_id = p_business_id
     and c.id = p_campaign_id
     and c.status in ('ACTIVE','OPTIMIZING');

  if v_daily_cap is null then
    return false;
  end if;

  insert into public.outreach_campaign_usage (campaign_id, business_id, daily_contact_on, monthly_contact_month)
  values (p_campaign_id, p_business_id, v_today, v_month)
  on conflict (campaign_id) do nothing;

  update public.outreach_campaign_usage u
     set daily_contact_count =
           case when u.daily_contact_on is distinct from v_today then 1
                else u.daily_contact_count + 1 end,
         daily_contact_on = v_today,
         monthly_contact_count =
           case when u.monthly_contact_month is distinct from v_month then 1
                else u.monthly_contact_count + 1 end,
         monthly_contact_month = v_month,
         updated_at = now()
   where u.campaign_id = p_campaign_id
     and u.business_id = p_business_id
     -- The cap test and the increment are the same statement, which is what
     -- makes this safe under concurrency.
     and (case when u.daily_contact_on is distinct from v_today then 0
               else u.daily_contact_count end) < v_daily_cap
     and (case when u.monthly_contact_month is distinct from v_month then 0
               else u.monthly_contact_count end) < v_monthly_cap
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end $fn$;

revoke all on function public.claim_campaign_contact_slot(uuid, uuid) from public, anon, authenticated;

-- Releases a claimed slot when the send did not happen after all, so a policy
-- block or a provider failure does not silently consume the day's capacity.
create or replace function public.release_campaign_contact_slot(
  p_business_id uuid,
  p_campaign_id uuid
)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $fn$
  update public.outreach_campaign_usage u
     set daily_contact_count = greatest(0, u.daily_contact_count - 1),
         monthly_contact_count = greatest(0, u.monthly_contact_count - 1),
         updated_at = now()
   where u.campaign_id = p_campaign_id
     and u.business_id = p_business_id;
$fn$;

revoke all on function public.release_campaign_contact_slot(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------- campaign budget detail
-- The customer's own campaign cap and what has been spent against it, broken
-- down by the category that caused each cost. Definer, because the underlying
-- columns are withheld; scoped inside, because a definer runs as its owner.
create or replace function public.outreach_campaign_budget_detail(
  p_business_id uuid,
  p_campaign_id uuid
)
returns table (
  cap_minor bigint,
  spent_minor bigint,
  reserved_minor bigint,
  category text,
  category_minor bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not exists (
    select 1 from public.business_members m
     where m.business_id = p_business_id and m.user_id = auth.uid()
  ) then
    return;
  end if;

  return query
    with campaign as (
      select c.max_cost_minor as cap, c.spent_cost_minor as spent,
             c.reserved_allowance_minor as reserved
        from public.outreach_campaigns c
       where c.business_id = p_business_id and c.id = p_campaign_id
    ),
    buckets as (
      select k.category as cat,
             coalesce(sum(x.cost_minor), 0)::bigint as cat_minor
        from (values ('DATA_ENRICHMENT'),('EMAIL_SENDING'),('PROVIDER_DATA'),('OTHER')) as k(category)
        left join public.outreach_campaign_costs x
               on x.category = k.category
              and x.business_id = p_business_id
              and x.campaign_id = p_campaign_id
       group by k.category
    )
    select c.cap, c.spent, c.reserved, b.cat, b.cat_minor
      from campaign c cross join buckets b;
end $fn$;

revoke all on function public.outreach_campaign_budget_detail(uuid, uuid) from public, anon;
grant execute on function public.outreach_campaign_budget_detail(uuid, uuid) to authenticated;

-- ------------------------------------------------------ daily performance
-- The Current performance chart. A per-day rollup PostgREST cannot express,
-- and one the page must not compute by pulling every message row.
create or replace function public.outreach_campaign_daily_series(
  p_business_id uuid,
  p_campaign_id uuid,
  p_days integer default 30
)
returns table (
  day date,
  contacts_sent integer,
  replies integer,
  qualified integer,
  booked integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  with span as (
    select generate_series(
      (now() at time zone 'utc')::date - (greatest(1, least(365, p_days)) - 1),
      (now() at time zone 'utc')::date,
      interval '1 day'
    )::date as day
  )
  select
    s.day,
    (select count(*) from public.messages m
      where m.business_id = p_business_id
        and m.campaign_id = p_campaign_id
        and m.direction = 'outbound'
        and (m.created_at at time zone 'utc')::date = s.day)::int,
    (select count(*) from public.messages m
      where m.business_id = p_business_id
        and m.campaign_id = p_campaign_id
        and m.direction = 'inbound'
        and (m.created_at at time zone 'utc')::date = s.day)::int,
    (select count(*) from public.prospects p
      where p.business_id = p_business_id
        and p.campaign_id = p_campaign_id
        and p.promoted_at is not null
        and (p.promoted_at at time zone 'utc')::date = s.day)::int,
    (select count(*) from public.bookings b
      join public.prospects p
        on p.promoted_to_lead_id = b.lead_id
       and p.business_id = p_business_id
       and p.campaign_id = p_campaign_id
      where b.business_id = p_business_id
        and (b.created_at at time zone 'utc')::date = s.day)::int
  from span s
  order by s.day;
$fn$;

revoke all on function public.outreach_campaign_daily_series(uuid, uuid, integer) from public, anon;
grant execute on function public.outreach_campaign_daily_series(uuid, uuid, integer) to authenticated;

-- ------------------------------------------------------------ booked count
-- Bookings attributable to a campaign, for the Booked KPI and the funnel.
create or replace function public.outreach_campaign_bookings(
  p_business_id uuid,
  p_campaign_id uuid
)
returns integer
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  select count(*)::int
    from public.bookings b
    join public.prospects p
      on p.promoted_to_lead_id = b.lead_id
     and p.business_id = p_business_id
     and p.campaign_id = p_campaign_id
   where b.business_id = p_business_id;
$fn$;

revoke all on function public.outreach_campaign_bookings(uuid, uuid) from public, anon;
grant execute on function public.outreach_campaign_bookings(uuid, uuid) to authenticated;

-- --------------------------------------------------- auto-pause notification
-- An auto-pause has to reach the customer without them going looking for it,
-- and 'campaign_complete' would be the wrong word for "we stopped this to
-- protect your domain".
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('handover', 'booking', 'integration_failure', 'message_failed',
                  'campaign_complete', 'campaign_paused', 'billing', 'usage_limit',
                  'lead_attention'));
