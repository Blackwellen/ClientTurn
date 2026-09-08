-- 0089_connector_activity_rollup: the connector counter that stopped counting.
--
-- `ConnectorActivity.importedCount` is documented as "Events accepted, ever.
-- What the connection has actually delivered." It was computed by fetching up
-- to 2,000 `workspace_app_events` rows and incrementing a counter in Node.
--
-- So a connector that has delivered more than 2,000 events reports 2,000 —
-- and keeps reporting 2,000, forever, while the number the customer is looking
-- at is precisely the evidence that the connection is working hard. The same
-- read supplies `lastImportAt`, which stays correct only because the rows are
-- ordered newest-first; the count is the part that silently plateaus.
--
-- `openFailures` had the same shape against a 200-row cap, which is worse in a
-- subtler way: 200 failures ordered by time can all belong to one install, so a
-- second connector failing quietly could report zero.
--
-- This is the fourth instance of the same pattern in this branch (0074, 0075,
-- and the admin scans). Aggregation belongs in the database; a capped fetch
-- counted in application code produces a wrong answer with no error attached.

create or replace function public.connector_install_activity(
  p_business_id uuid,
  p_install_ids uuid[]
)
returns table (
  install_id uuid,
  imported_count integer,
  last_import_at timestamptz,
  open_failures integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    i.install_id,
    coalesce(e.imported_count, 0)::int,
    e.last_import_at,
    coalesce(f.open_failures, 0)::int
    from unnest(p_install_ids) as i(install_id)
    -- Left joins, so an install that has never delivered an event still
    -- appears with a zero rather than vanishing from the map the caller built
    -- for it. "No events yet" and "no such connector" are different answers.
    left join (
      select w.install_id, count(*) as imported_count, max(w.created_at) as last_import_at
        from public.workspace_app_events w
       where w.business_id = p_business_id
         and w.install_id = any(p_install_ids)
       group by w.install_id
    ) e on e.install_id = i.install_id
    left join (
      select c.install_id, count(*) as open_failures
        from public.connector_event_failures c
       where c.business_id = p_business_id
         and c.install_id = any(p_install_ids)
         and c.status = 'OPEN'
       group by c.install_id
    ) f on f.install_id = i.install_id;
$$;

revoke all on function public.connector_install_activity(uuid, uuid[]) from public, anon;
grant execute on function public.connector_install_activity(uuid, uuid[]) to authenticated, service_role;

comment on function public.connector_install_activity(uuid, uuid[]) is
  'Per-install event totals and open failure counts. Replaces counting a capped row fetch in application code, which plateaued at 2,000 events and could report zero failures for a connector whose failures sat behind another''s.';

create index if not exists workspace_app_events_business_install_idx
  on public.workspace_app_events (business_id, install_id, created_at desc);

create index if not exists connector_event_failures_open_idx
  on public.connector_event_failures (business_id, install_id)
  where status = 'OPEN';
