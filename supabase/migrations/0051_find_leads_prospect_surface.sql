-- 0051_find_leads_prospect_surface: what the Prospects inbox, the scoring page
-- and the acquisition Campaigns list need that the schema did not yet carry
-- (V4 §12, §14, §16).
--
-- Three things:
--   1. `prospects.last_intent_at` — so "sort by intent freshness" is an indexed
--      column order rather than a per-row lookup against the match table.
--   2. Suppression reason on the prospect, so the drawer can say *why* a record
--      was suppressed without joining to a destination-scoped entry that may
--      cover several prospects at once.
--   3. The indexes the new filters actually sort and page on.

-- ---------------------------------------------------------- last_intent_at
alter table public.prospects
  add column if not exists last_intent_at timestamptz;

comment on column public.prospects.last_intent_at is
  'When the newest live intent signal for this prospect was observed. Maintained by trigger from prospect_intent_matches; NULL means no signal has ever matched. Not a substitute for the match rows — an expired signal leaves this set, and readers that need "live" must still check expires_at.';

-- Backfill from what is already there, so the column is correct the moment it
-- exists rather than only for prospects matched after this migration.
update public.prospects p
   set last_intent_at = m.newest
  from (
    select prospect_id, max(matched_at) as newest
      from public.prospect_intent_matches
     group by prospect_id
  ) m
 where m.prospect_id = p.id
   and p.last_intent_at is distinct from m.newest;

-- The writer is the match table, so the column is maintained there rather than
-- by whichever code path happens to insert a match. Monotonic: an older match
-- arriving late must not move the marker backwards.
create or replace function public.prospect_touch_last_intent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.prospects
     set last_intent_at = greatest(coalesce(last_intent_at, new.matched_at), new.matched_at)
   where id = new.prospect_id
     and business_id = new.business_id;
  return new;
end $$;

drop trigger if exists prospect_intent_matches_touch_prospect
  on public.prospect_intent_matches;

create trigger prospect_intent_matches_touch_prospect
  after insert or update of matched_at on public.prospect_intent_matches
  for each row execute function public.prospect_touch_last_intent();

-- --------------------------------------------------------- suppression note
-- `suppression_entries` is destination-scoped: one entry covers an address,
-- which may belong to several prospects. The prospect still needs its own
-- record of the decision taken on it, for the drawer and for audit.
alter table public.prospects
  add column if not exists suppression_reason text
    check (suppression_reason is null or suppression_reason in
      ('OPT_OUT','COMPLAINT','INVALID','BOUNCE','LEGAL','MANUAL','PROVIDER'));

alter table public.prospects
  add column if not exists suppressed_at timestamptz;

alter table public.prospects
  add column if not exists suppressed_by uuid references auth.users(id) on delete set null;

-- ----------------------------------------------------------------- indexes
-- Relevance ordering is (eligibility, score desc) inside a workspace, and it is
-- the default sort, so it gets its own index rather than relying on the
-- grade one.
create index if not exists prospects_relevance_idx
  on public.prospects (business_id, outreach_eligibility, score desc nulls last)
  where promoted_to_lead_id is null;

create index if not exists prospects_intent_freshness_idx
  on public.prospects (business_id, last_intent_at desc nulls last)
  where last_intent_at is not null;

create index if not exists prospects_verification_idx
  on public.prospects (business_id, verification_status);

-- Campaign rollups page by campaign and status; the scoring page reads the
-- current score for one prospect.
create index if not exists prospect_scores_prospect_recent_idx
  on public.prospect_scores (business_id, prospect_id, created_at desc);

create index if not exists intent_events_business_observed_idx
  on public.intent_events (business_id, observed_at desc);

-- ------------------------------------------------------------------ grants
-- 0050 replaced the table-wide SELECT grant on `prospects` with an explicit
-- column list. A column added afterwards is therefore NOT granted, and the
-- browser role would get a permission error rather than a null. Re-resolve the
-- allowed set so the columns added above are readable and the withheld one
-- stays withheld.
do $$
declare
  allowed text;
  hidden text[] := array['unsubscribe_token'];
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into allowed
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'prospects'
     and not (c.column_name = any(hidden));

  if allowed is null then
    raise exception 'No selectable columns resolved for prospects';
  end if;

  execute format('revoke select on public.prospects from authenticated');
  execute format('grant select (%s) on public.prospects to authenticated', allowed);
end $$;

-- ------------------------------------------------- campaign budget headroom
-- The Campaigns list shows a budget bar. `max_cost_minor` and `spent_cost_minor`
-- are withheld from the browser role by 0041 and that decision stands — provider
-- spend is admin-only (§90, §114). What a customer legitimately needs is *how
-- full* their own campaign budget is, which is a ratio, not an amount.
--
-- SECURITY DEFINER so it can read the withheld columns, with the membership
-- check done inside rather than relying on the caller's RLS: a definer function
-- runs as its owner, so it must re-establish scope itself.
create or replace function public.outreach_campaign_budget_usage(
  p_business_id uuid
)
returns table (
  campaign_id uuid,
  -- 0-100, or NULL when no cap is set: an uncapped campaign has no "percent
  -- used", and rendering 0% there would read as "nothing spent".
  percent_used integer,
  has_cap boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
      from public.business_members m
     where m.business_id = p_business_id
       and m.user_id = auth.uid()
  ) then
    return;
  end if;

  return query
    select
      c.id,
      case
        when c.max_cost_minor > 0
          then least(100, greatest(0, round(c.spent_cost_minor * 100.0 / c.max_cost_minor)))::int
        else null
      end,
      c.max_cost_minor > 0
    from public.outreach_campaigns c
    where c.business_id = p_business_id;
end $$;

revoke all on function public.outreach_campaign_budget_usage(uuid) from public, anon;
grant execute on function public.outreach_campaign_budget_usage(uuid) to authenticated;

-- -------------------------------------------------- campaign performance 30d
-- The right-rail card is a windowed rollup, which PostgREST cannot express:
-- it has no GROUP BY, so doing this from the client would mean pulling every
-- message row for the window.
create or replace function public.outreach_campaign_performance(
  p_business_id uuid,
  p_days integer default 30
)
returns table (
  contacted integer,
  replies integer,
  qualified integer,
  prior_qualified integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with window_bounds as (
    select
      now() - make_interval(days => greatest(1, least(365, p_days))) as current_from,
      now() - make_interval(days => greatest(1, least(365, p_days)) * 2) as prior_from
  )
  select
    (select count(distinct m.prospect_id)
       from public.messages m, window_bounds w
      where m.business_id = p_business_id
        and m.prospect_id is not null
        and m.direction = 'outbound'
        and m.created_at >= w.current_from)::int,
    (select count(distinct m.prospect_id)
       from public.messages m, window_bounds w
      where m.business_id = p_business_id
        and m.prospect_id is not null
        and m.direction = 'inbound'
        and m.created_at >= w.current_from)::int,
    -- "Qualified" is a prospect that actually became a lead. Anything softer
    -- would be a number the customer cannot reconcile against Leads.
    (select count(*)
       from public.prospects p, window_bounds w
      where p.business_id = p_business_id
        and p.promoted_at >= w.current_from)::int,
    (select count(*)
       from public.prospects p, window_bounds w
      where p.business_id = p_business_id
        and p.promoted_at >= w.prior_from
        and p.promoted_at < w.current_from)::int;
$$;

revoke all on function public.outreach_campaign_performance(uuid, integer) from public, anon;
grant execute on function public.outreach_campaign_performance(uuid, integer) to authenticated;

-- ------------------------------------------------------------ upcoming sends
-- What the scheduler will do next, grouped by campaign. Read from
-- `next_step_due_at` — the same column the dispatcher uses — so the card can
-- never promise a send the scheduler is not actually going to make.
create or replace function public.outreach_upcoming_sends(
  p_business_id uuid,
  p_limit integer default 6
)
returns table (
  campaign_id uuid,
  campaign_name text,
  prospect_count integer,
  due_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    r.campaign_id,
    c.name,
    count(*)::int,
    min(r.next_step_due_at)
  from public.outreach_recipient_runs r
  join public.outreach_campaigns c
    on c.id = r.campaign_id
   and c.business_id = p_business_id
  where r.business_id = p_business_id
    and r.status in ('PENDING','SCHEDULED','ACTIVE')
    and r.next_step_due_at is not null
    and r.next_step_due_at >= now()
    and c.status in ('ACTIVE','OPTIMIZING','READY')
  group by r.campaign_id, c.name
  order by min(r.next_step_due_at)
  limit greatest(1, least(50, p_limit));
$$;

revoke all on function public.outreach_upcoming_sends(uuid, integer) from public, anon;
grant execute on function public.outreach_upcoming_sends(uuid, integer) to authenticated;

-- --------------------------------------------------- intent category defaults
-- The category builder offers a monitoring cadence alongside the category
-- itself, because that is the decision a customer is actually making: "watch
-- for roofing need, daily". The cadence still belongs to the monitor at
-- execution time — this column is the default a new monitor for the category
-- inherits, and the value the builder writes through to that category's
-- existing monitors.
alter table public.intent_categories
  add column if not exists default_cadence text not null default 'WEEKLY'
    check (default_cadence in ('DAILY','WEEKLY','FORTNIGHTLY','MONTHLY'));

-- Keywords and ICP scope already existed but were never written by the app.
-- Nothing to add: the builder now populates keywords_entities and icp_scope.
