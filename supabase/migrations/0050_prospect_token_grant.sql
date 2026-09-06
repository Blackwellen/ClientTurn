-- 0050_prospect_token_grant: withhold the prospect unsubscribe token from the
-- browser role.
--
-- 0049 added `prospects.unsubscribe_token`. `prospects` carries a table-level
-- SELECT grant to `authenticated`, and a table-level grant confers the
-- privilege on every column — including ones added afterwards. So the new
-- column became readable the moment it existed, which is the same trap 0041
-- was written to close for the cost columns.
--
-- Caught by tests/rls-v4.test.ts ("a prospect's unsubscribe token is never
-- readable from the browser").
--
-- Why it matters. The token *is* the capability: whoever holds it can opt a
-- person out without being signed in at all. RLS keeps it inside the owning
-- workspace, so this is not a cross-tenant leak — but a value that grants an
-- action should not be sitting in a list response that nothing needs it for,
-- and a viewer-role member has no reason to hold it. The unsubscribe route
-- reads it with the service role, which is unaffected.
--
-- The fix is the 0041 pattern: drop the table-wide privilege and re-grant
-- SELECT column by column, resolved from information_schema so a column added
-- to `prospects` later is granted automatically and only the named ones are
-- withheld.

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

  -- Drop the table-wide privilege first; without this the column grant below
  -- is redundant and the hidden column stays readable.
  execute format('revoke select on public.prospects from authenticated');
  execute format('grant select (%s) on public.prospects to authenticated', allowed);
end $$;

-- Leads carry the same kind of token from 0039 and the same table-level grant,
-- so they have the same exposure. Closed here rather than left for the next
-- person to rediscover.
do $$
declare
  allowed text;
  hidden text[] := array['unsubscribe_token'];
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into allowed
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'leads'
     and not (c.column_name = any(hidden));

  if allowed is null then
    raise exception 'No selectable columns resolved for leads';
  end if;

  execute format('revoke select on public.leads from authenticated');
  execute format('grant select (%s) on public.leads to authenticated', allowed);
end $$;
