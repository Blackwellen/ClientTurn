-- 0070_admin_rls_coverage: let Platform Readiness measure RLS coverage.
--
-- "Every tenant table carries RLS" is the product's central security claim, and
-- until now nothing could check it — the readiness view would have had to
-- assert it, which is exactly the kind of unverified green tick that makes a
-- readiness page worse than none.
--
-- Reads `pg_class` only. Returns two integers and no table names: an operator
-- needs to know whether coverage is complete, and a list of unprotected tables
-- would be a map for anyone who obtained it.
create or replace function public.admin_rls_coverage()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'total', count(*),
    'enabled', count(*) filter (where c.relrowsecurity)
  )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r';
$$;

-- Platform staff only. This is reached through the admin shell, which already
-- checks `platform_role` server-side and requires step-up; no browser role has
-- any reason to ask how much of the schema is protected.
revoke all on function public.admin_rls_coverage() from public, anon, authenticated;

-- The grant the revoke above makes necessary. Postgres gives EXECUTE to PUBLIC
-- by default, and `service_role` inherits it from there rather than holding it
-- in its own right -- so revoking from PUBLIC takes it away from the admin
-- client too. Without this line the readiness page would call the function,
-- receive permission denied, and fall back to UNKNOWN forever: the RLS
-- coverage check would be permanently silent, which is the failure the
-- function was written to prevent, arriving quietly through the back door.
grant execute on function public.admin_rls_coverage() to service_role;
