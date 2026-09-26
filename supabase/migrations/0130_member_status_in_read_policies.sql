-- 0130_member_status_in_read_policies: honour membership status in every
-- browser read policy (coverage tracker 8.15).
--
-- 0010's helpers (`is_business_member`, `has_business_role`) only admit an
-- ACTIVE membership, and almost every policy uses them. Seven later tables
-- wrote the membership check inline and left out `status = 'active'`, so a
-- person who had been removed, suspended, or merely invited could still read
-- them with their own session token straight from PostgREST -- including the
-- realtime stream of workspace events. The app itself never shows these to
-- such a person (the session requires an active membership), which is why the
-- gap was invisible; the database is the layer that must not rely on that.
--
-- Each policy is replaced, same name, with the shared helper. Grants are
-- untouched: these tables stay read-only to the browser.

do $$
declare t text;
begin
  foreach t in array array[
    'social_sending_accounts',
    'social_connection_states',
    'social_action_log',
    'social_outbound_messages',
    'social_inbound_replies',
    'sourcing_signals',
    'workspace_stream_events'
  ] loop
    execute format($f$
      drop policy if exists %1$s_select on public.%1$s;
      create policy %1$s_select on public.%1$s
        for select to authenticated
        using (public.is_business_member(business_id));
    $f$, t);
  end loop;
end $$;
