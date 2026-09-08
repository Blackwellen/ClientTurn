-- 0074_analytics_rollups: move the remaining aggregates out of JavaScript.
--
-- Five reads in this codebase fetch rows and then count or sum them in Node,
-- under a row cap. That is not a performance note. Past the cap the answer is
-- *wrong* rather than slow, and nothing anywhere says so — no error, no
-- warning, no truncation marker. The chart just draws a smaller line and the
-- meter just reports a smaller number.
--
-- Two of them decide money:
--
--   * `getV4Usage` sums `usage_events.quantity` in JS with no explicit limit,
--     so PostgREST's own cap applies. A workspace past that many events in a
--     billing period has its usage under-reported, `checkCapacity` sees room
--     that is not there, and the allowance silently stops being enforced. The
--     failure mode is one-directional and it favours over-delivery: nobody
--     complains, and the margin quietly goes.
--
--   * `getTrends` reads up to 250,000 timestamps across five queries to draw
--     one chart. At the cap, a busy month is rendered as a quiet one.
--
-- The techniques below are already used elsewhere in this schema
-- (`outreach_campaign_performance`, `reactivation_campaign_results`). Nothing
-- here is novel; it is the same move applied to the reads that were missed.
--
-- Every function is `stable` and `security invoker`, so RLS applies exactly as
-- it does to the query it replaces. The one exception is documented at its
-- definition.

/* ============================================================ usage summing */

-- The billing meter.
--
-- `security definer` and service_role-only, deliberately: it is called from
-- the admin client on the enforcement path, and the amount a workspace has
-- consumed is not a figure a browser session should be able to ask for
-- directly — it is served through the billing surface, which applies its own
-- checks. `coalesce(..., 0)` so an unused metric returns zero rather than
-- null, which is what the caller's arithmetic expects.
create or replace function public.sum_usage_events(
  p_business_id uuid,
  p_metric text,
  p_since timestamptz
)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(u.quantity), 0)::numeric
    from public.usage_events u
   where u.business_id = p_business_id
     and u.metric = p_metric
     and u.occurred_at >= p_since;
$$;

revoke all on function public.sum_usage_events(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.sum_usage_events(uuid, text, timestamptz) to service_role;

comment on function public.sum_usage_events(uuid, text, timestamptz) is
  'Total quantity of one metric since a timestamp. The authoritative figure for entitlement enforcement; replaces summing fetched rows in application code.';

/* ============================================================= daily trends */

-- The analytics trends chart, as one query instead of five capped reads.
--
-- Days with no activity are absent rather than zero-filled: the caller already
-- generates the axis from the range bounds, and a series that invented its own
-- days would disagree with that axis at the boundaries.
--
-- Test rows are excluded on the two tables that carry the flag, matching the
-- queries this replaces. `won_at` is counted on its own day, not the lead's
-- creation day, because "converted on the 14th" is the claim the chart makes.
create or replace function public.analytics_daily_trends(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  day date,
  prospects integer,
  contacts_sent integer,
  replies integer,
  leads integer,
  converted integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with days as (
    select
      (p.created_at at time zone 'UTC')::date as day,
      1 as prospects,
      0 as contacts_sent,
      0 as replies,
      0 as leads,
      0 as converted
      from public.prospects p
     where p.business_id = p_business_id
       and p.is_test = false
       and p.created_at >= p_from
       and p.created_at < p_to
    union all
    select (m.created_at at time zone 'UTC')::date, 0,
           case when m.direction = 'outbound' then 1 else 0 end,
           case when m.direction = 'inbound' then 1 else 0 end,
           0, 0
      from public.messages m
     where m.business_id = p_business_id
       and m.created_at >= p_from
       and m.created_at < p_to
       and m.direction in ('outbound', 'inbound')
    union all
    select (l.created_at at time zone 'UTC')::date, 0, 0, 0, 1, 0
      from public.leads l
     where l.business_id = p_business_id
       and l.is_test = false
       and l.created_at >= p_from
       and l.created_at < p_to
    union all
    select (l.won_at at time zone 'UTC')::date, 0, 0, 0, 0, 1
      from public.leads l
     where l.business_id = p_business_id
       and l.is_test = false
       and l.won_at >= p_from
       and l.won_at < p_to
  )
  select
    days.day,
    sum(days.prospects)::int,
    sum(days.contacts_sent)::int,
    sum(days.replies)::int,
    sum(days.leads)::int,
    sum(days.converted)::int
    from days
   group by days.day
   order by days.day;
$$;

revoke all on function public.analytics_daily_trends(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_daily_trends(uuid, timestamptz, timestamptz) to authenticated, service_role;

comment on function public.analytics_daily_trends(uuid, timestamptz, timestamptz) is
  'One row per day with activity, for the analytics trends chart. Replaces five capped row fetches bucketed in application code.';

/* ========================================================= conversion goals */

-- Booked leads grouped by the goal they were created against.
--
-- A lead with no goal is returned with a null `goal_id` rather than dropped,
-- because the shares have to sum to the total or the chart is lying about a
-- denominator the customer can count themselves on the Leads page.
create or replace function public.analytics_conversion_goal_counts(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (goal_id uuid, booked integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select l.conversion_goal_id, count(*)::int
    from public.leads l
   where l.business_id = p_business_id
     and l.is_test = false
     and l.booked_at is not null
     and l.booked_at >= p_from
     and l.booked_at < p_to
   group by l.conversion_goal_id;
$$;

revoke all on function public.analytics_conversion_goal_counts(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_conversion_goal_counts(uuid, timestamptz, timestamptz) to authenticated, service_role;

/* ======================================================= provider waterfall */

-- Enrichment provider usage, with the verified share, in one pass.
--
-- The query this replaces read up to 50,000 source rows, de-duplicated the
-- prospect ids in Node, and then issued one `in (...)` count per 500 of them --
-- so a wide window cost dozens of round trips *and* still truncated. The join
-- does both halves at once and cannot truncate.
--
-- The three figures are deliberately counted differently, and matching the
-- application exactly is the point of this function existing:
--
--   * `candidates` is distinct prospects. A provider that supplied six fields
--     for one prospect supplied one candidate, not six.
--   * `verified` is distinct prospects that came out VALID. Counting rows here
--     would report a yield above 100%.
--   * `enriched_fields` is rows, and only those the provider actually returned
--     a value for -- it is the unit the provider is paid in.
--
-- Dropped rather than replaced: `create or replace` cannot change the name or
-- type of an OUT column, and this function shipped minutes earlier in this same
-- migration with a different result shape.
drop function if exists public.analytics_provider_waterfall(uuid, timestamptz, timestamptz);

create function public.analytics_provider_waterfall(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  provider text,
  candidates integer,
  verified integer,
  enriched_fields integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    s.provider,
    count(distinct s.prospect_id)::int,
    count(distinct s.prospect_id) filter (
      where p.verification_status = 'VALID'
    )::int,
    count(*) filter (where s.verified_at is not null)::int
    from public.prospect_data_sources s
    join public.prospects p
      on p.id = s.prospect_id
     and p.business_id = s.business_id
   where s.business_id = p_business_id
     and s.prospect_id is not null
     and s.obtained_at >= p_from
     and s.obtained_at < p_to
   group by s.provider
   order by count(distinct s.prospect_id) desc;
$$;

revoke all on function public.analytics_provider_waterfall(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_provider_waterfall(uuid, timestamptz, timestamptz) to authenticated, service_role;

/* ==================================================== campaign promotions */

-- How many of a campaign's recipients became leads.
--
-- Two hops — recipient run to prospect to promotion — which the application
-- was doing as a fetch-then-chunk. In SQL it is a join, and `count(distinct)`
-- makes a prospect contacted on several steps count once.
create or replace function public.outreach_campaign_promoted(
  p_business_id uuid,
  p_campaign_id uuid
)
returns integer
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select count(distinct r.prospect_id)::int
    from public.outreach_recipient_runs r
    join public.prospects p
      on p.id = r.prospect_id
     and p.business_id = r.business_id
   where r.business_id = p_business_id
     and r.campaign_id = p_campaign_id
     and p.promoted_to_lead_id is not null;
$$;

revoke all on function public.outreach_campaign_promoted(uuid, uuid) from public, anon;
grant execute on function public.outreach_campaign_promoted(uuid, uuid) to authenticated, service_role;

/* ============================================================ ICP counts */

-- Prospects per ICP profile, for the business profile panel.
--
-- Replaces `select icp_profile_id ... limit 5000` counted in Node, which
-- reported a plateau at exactly 5,000 prospects and gave no sign it had.
create or replace function public.prospect_counts_by_icp(
  p_business_id uuid
)
returns table (icp_profile_id uuid, prospects integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.icp_profile_id, count(*)::int
    from public.prospects p
   where p.business_id = p_business_id
     and p.icp_profile_id is not null
   group by p.icp_profile_id;
$$;

revoke all on function public.prospect_counts_by_icp(uuid) from public, anon;
grant execute on function public.prospect_counts_by_icp(uuid) to authenticated, service_role;

/* ================================================================= indexes */

-- The reads above are all (business_id, timestamp) range scans. These indexes
-- are what keep them from becoming sequential scans on the tables that grow
-- per-message and per-prospect. `if not exists` throughout: several may
-- already be present from earlier migrations, and a re-run must be harmless.

create index if not exists usage_events_business_metric_occurred_idx
  on public.usage_events (business_id, metric, occurred_at desc);

create index if not exists messages_business_created_direction_idx
  on public.messages (business_id, created_at desc, direction);

create index if not exists leads_business_won_at_idx
  on public.leads (business_id, won_at desc)
  where won_at is not null;

create index if not exists leads_business_booked_at_idx
  on public.leads (business_id, booked_at desc)
  where booked_at is not null;

create index if not exists prospect_data_sources_business_obtained_idx
  on public.prospect_data_sources (business_id, obtained_at desc);

create index if not exists prospects_business_icp_idx
  on public.prospects (business_id, icp_profile_id)
  where icp_profile_id is not null;
