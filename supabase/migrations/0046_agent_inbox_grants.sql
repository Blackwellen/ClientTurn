-- Supabase default table grants must be removed before column grants can hide
-- server-only spend or credential references. RLS alone does not hide columns.
revoke all on public.agents,public.agent_sources,public.agent_queue_items,public.agent_activity_events,public.inbox_channels from authenticated;
grant select on public.agent_sources,public.agent_queue_items,public.agent_activity_events to authenticated;
do $$ declare allowed text; begin
 select string_agg(quote_ident(column_name),', ' order by ordinal_position) into allowed from information_schema.columns where table_schema='public' and table_name='agents' and column_name<>'max_cost_per_run_minor';
 execute format('grant select (%s) on public.agents to authenticated',allowed);
 select string_agg(quote_ident(column_name),', ' order by ordinal_position) into allowed from information_schema.columns where table_schema='public' and table_name='inbox_channels' and column_name not in ('secret_ref','sync_cursor');
 execute format('grant select (%s) on public.inbox_channels to authenticated',allowed);
end $$;
