-- 0041_v4_cost_column_grants: actually withhold provider spend from the browser.
--
-- 0036 tried to do this with:
--
--     grant select on public.<table> to authenticated;
--     revoke select (cost_column) on public.<table> from authenticated;
--
-- which does nothing. In PostgreSQL a table-level SELECT grant confers the
-- privilege on every column, and a column-level REVOKE does not subtract from
-- it — the column-level privilege system only narrows a grant that was itself
-- made at column level. The revokes in 0036 therefore succeeded silently while
-- leaving `spent_cost_minor`, `max_cost_minor` and the rest fully readable.
--
-- Caught by tests/rls-v4.test.ts ("a sourcing run's spend columns are not
-- readable, though the run is").
--
-- The fix is to drop the table-level grant and re-grant SELECT on the allowed
-- columns only. Doing it from information_schema rather than by listing columns
-- means a column added to one of these tables later is granted automatically,
-- and only a column whose name matches the money pattern is withheld.

do $$
declare
  spec record;
  allowed text;
begin
  for spec in
    select * from (values
      ('prospect_enrichments',   array['cost_minor']),
      ('prospect_verifications', array['cost_minor']),
      ('sourcing_runs',          array['max_total_cost_minor','max_provider_cost_minor','spent_cost_minor']),
      ('sourcing_run_results',   array['cost_minor']),
      ('intent_events',          array['cost_minor']),
      ('intent_monitors',        array['monthly_budget_minor','spent_this_period_minor']),
      ('outreach_campaigns',     array['max_cost_minor','spent_cost_minor','reserved_allowance_minor']),
      ('outreach_runs',          array['cost_minor']),
      ('search_strategies',      array['estimated_cost_minor']),
      ('recurring_searches',     array['max_cost_per_run_minor'])
    ) as t(table_name, hidden_columns)
  loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
      into allowed
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = spec.table_name
       and not (c.column_name = any(spec.hidden_columns));

    if allowed is null then
      raise exception 'No selectable columns resolved for %', spec.table_name;
    end if;

    -- Drop the table-wide privilege first; without this the column grant below
    -- is redundant and the hidden columns stay readable.
    execute format('revoke select on public.%I from authenticated', spec.table_name);
    execute format('grant select (%s) on public.%I to authenticated', allowed, spec.table_name);
  end loop;
end $$;

-- Belt and braces for the two tables 0036 already handled with explicit column
-- grants: re-assert them here so this migration is the single place that
-- describes the customer-visible column set for cost-bearing tables.
do $$
declare
  spec record;
  allowed text;
begin
  for spec in
    select * from (values
      ('prospect_data_sources', array['cost_minor']),
      ('sourcing_run_queries',  array['cost_minor'])
    ) as t(table_name, hidden_columns)
  loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
      into allowed
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = spec.table_name
       and not (c.column_name = any(spec.hidden_columns));

    execute format('revoke select on public.%I from authenticated', spec.table_name);
    execute format('grant select (%s) on public.%I to authenticated', allowed, spec.table_name);
  end loop;
end $$;

-- `anon` never had a reason to read any of these.
do $$
declare t text;
begin
  foreach t in array array[
    'prospect_enrichments','prospect_verifications','sourcing_runs','sourcing_run_results',
    'intent_events','intent_monitors','outreach_campaigns','outreach_runs',
    'search_strategies','recurring_searches','prospect_data_sources','sourcing_run_queries'
  ] loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
