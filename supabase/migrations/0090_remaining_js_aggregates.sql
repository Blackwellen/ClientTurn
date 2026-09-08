-- 0090_remaining_js_aggregates: the last three capped fetches counted in Node.
--
-- Same pattern as 0074, 0075 and 0089, swept out of the three places it was
-- still doing damage. Each of these fetched rows under a `.limit()` and counted
-- or summed them in application code, so past the cap the answer is wrong and
-- nothing anywhere says so.
--
-- One of them is materially worse than the others and is the reason this went
-- to the top of the list:
--
--   **`cost.rollup_daily` persisted the wrong number.** It read up to 20,000
--   `cost_events` for a workspace-day, summed them in JS, and wrote the total
--   to `business_cost_daily`. Every other instance of this pattern produces a
--   wrong figure on a screen, which is corrected the moment the query is fixed.
--   This one **stored** it: the margin reports, the economics page and the
--   six-month spend history all read the stored row, so a single busy day is
--   understated for as long as that row exists, and re-running the rollup with
--   a fixed query is the only thing that would ever repair it.
--
-- All three group in SQL and return a bounded number of rows, so the caller
-- keeps its own mapping logic and loses only the ability to be truncated.

/* --------------------------------------------------------- daily cost roll */

-- Grouped, not bucketed. The caller keeps `categoryFor(row)` -- the mapping
-- from (provider, metric, category) to a spend bucket lives in TypeScript and
-- should stay in one place -- and now applies it to a handful of groups instead
-- of to twenty thousand rows it may not have received.
create or replace function public.cost_events_by_kind(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  provider text,
  metric text,
  category text,
  total_cost numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select e.provider, e.metric, e.category, coalesce(sum(e.total_cost), 0)::numeric
    from public.cost_events e
   where e.business_id = p_business_id
     and e.occurred_at >= p_from
     and e.occurred_at < p_to
   group by e.provider, e.metric, e.category;
$$;

revoke all on function public.cost_events_by_kind(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.cost_events_by_kind(uuid, timestamptz, timestamptz) to service_role;

comment on function public.cost_events_by_kind(uuid, timestamptz, timestamptz) is
  'Spend grouped by provider, metric and category for a window. Used by the daily cost rollup, which previously summed a capped row fetch and persisted the result.';

/* ------------------------------------------------------- usage by month */

-- Six months of usage history for the Billing page, as one row per month per
-- source rather than 100,000 timestamps fetched to be bucketed by their first
-- seven characters.
create or replace function public.usage_history_by_month(
  p_business_id uuid,
  p_from timestamptz
)
returns table (
  month text,
  prospects integer,
  sourcing_runs integer,
  messages integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with rows_by_month as (
    select to_char(p.created_at at time zone 'UTC', 'YYYY-MM') as month, 1 as prospects, 0 as runs, 0 as messages
      from public.prospects p
     where p.business_id = p_business_id and p.is_test = false and p.created_at >= p_from
    union all
    select to_char(r.created_at at time zone 'UTC', 'YYYY-MM'), 0, 1, 0
      from public.sourcing_runs r
     where r.business_id = p_business_id and r.created_at >= p_from
    union all
    select to_char(m.created_at at time zone 'UTC', 'YYYY-MM'), 0, 0, 1
      from public.messages m
     where m.business_id = p_business_id and m.direction = 'outbound' and m.created_at >= p_from
  )
  select month, sum(prospects)::int, sum(runs)::int, sum(messages)::int
    from rows_by_month
   group by month;
$$;

revoke all on function public.usage_history_by_month(uuid, timestamptz) from public, anon;
grant execute on function public.usage_history_by_month(uuid, timestamptz) to authenticated, service_role;

/* --------------------------------------------------- follow-up performance */

-- Why sequences stopped, and how automated messages fared per channel.
--
-- Two groupings rather than two row fetches. The caller still decides which
-- stop reasons are successes -- "the lead replied" ends a sequence and is the
-- outcome it exists for, and calling that a failure would make a working
-- sequence look broken -- but it no longer has to receive every row to count
-- them.
create or replace function public.automation_stop_reasons(
  p_business_id uuid,
  p_since timestamptz
)
returns table (stopped_reason text, runs integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select a.stopped_reason, count(*)::int
    from public.automation_runs a
   where a.business_id = p_business_id
     and a.state = 'STOPPED'
     and a.stopped_reason is not null
     and a.created_at >= p_since
   group by a.stopped_reason;
$$;

revoke all on function public.automation_stop_reasons(uuid, timestamptz) from public, anon;
grant execute on function public.automation_stop_reasons(uuid, timestamptz) to authenticated, service_role;

create or replace function public.automation_message_outcomes(
  p_business_id uuid,
  p_since timestamptz
)
returns table (channel text, status text, messages integer)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select m.channel, m.status, count(*)::int
    from public.messages m
   where m.business_id = p_business_id
     and m.direction = 'outbound'
     and m.origin = 'automation'
     and m.created_at >= p_since
   group by m.channel, m.status;
$$;

revoke all on function public.automation_message_outcomes(uuid, timestamptz) from public, anon;
grant execute on function public.automation_message_outcomes(uuid, timestamptz) to authenticated, service_role;

/* ================================================================ indexes */

create index if not exists cost_events_business_occurred_idx
  on public.cost_events (business_id, occurred_at desc);

create index if not exists automation_runs_business_stopped_idx
  on public.automation_runs (business_id, created_at desc)
  where state = 'STOPPED';

create index if not exists sourcing_runs_business_created_idx
  on public.sourcing_runs (business_id, created_at desc);
