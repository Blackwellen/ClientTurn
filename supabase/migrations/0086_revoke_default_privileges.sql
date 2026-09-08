-- 0086_revoke_default_privileges: take back the grants nobody issued.
--
-- `0083_social_due_actions_least_privilege` found this on one view: Supabase
-- ships a default-privileges rule granting ALL on new objects in `public` to
-- `anon` and `authenticated`, so `grant select ... to authenticated` reads like
-- least privilege while being purely **additive** to a grant of everything.
--
-- It was never one view. Across this schema:
--
--   * **Seven tables grant every privilege to `anon`** — `copilot_sessions`,
--     `copilot_messages`, `copilot_actions`, `crm_push_records`,
--     `marketing_events`, `marketing_sessions`, `usage_counters` — including
--     DELETE and TRUNCATE.
--   * 121 tables carry INSERT, UPDATE or DELETE for `authenticated` that no
--     migration asked for.
--
-- ## Why this is not "RLS covers it"
--
-- For SELECT, INSERT, UPDATE and DELETE, it very nearly is: there are **zero**
-- policies anywhere in this schema naming `anon`, so RLS denies it every row of
-- every table regardless of what it has been granted.
--
-- **TRUNCATE is the exception, and it is the whole reason this migration
-- exists.** Postgres row-level security governs SELECT, INSERT, UPDATE and
-- DELETE. It does not govern TRUNCATE. A role holding TRUNCATE can empty a
-- table with RLS enabled, no policy, and no rows it is permitted to see — the
-- backstop everything else in this schema leans on simply is not in the path.
-- `usage_counters` is billing state; `copilot_*` is customer conversation
-- history.
--
-- Nothing today can reach a TRUNCATE as `anon` — PostgREST exposes no such
-- verb, and that is what makes this a latent hole rather than an incident. It
-- is also exactly the kind of grant nobody re-examines once a new front end,
-- a direct connection or a future PostgREST feature changes what is reachable.
--
-- ## Why this is behaviour-neutral
--
-- Verified against the live database before writing, not assumed:
--
--   * Zero policies name `anon`, so no read, insert, update or delete by `anon`
--     succeeds today and none will stop succeeding.
--   * The only writers of `marketing_events` and `marketing_sessions` —
--     `/api/marketing/track` via `lib/marketing/record.ts` — use the
--     **service-role** client, which bypasses both grants and RLS.
--   * The `authenticated` clause below touches only tables with RLS enabled and
--     **no policy at all**, where every one of those commands is already denied.
--     The grants being removed are provably dead.
--
-- Tables with real policies are deliberately untouched: a grant paired with a
-- policy is a decision somebody made, and revoking it here would break a
-- working feature to tidy a list.

/* ------------------------------------------------------------------ anon */

-- The blunt instrument is the right one. `anon` is the unauthenticated role;
-- this application serves anonymous visitors marketing pages and a status page,
-- and reaches every table through the server. There is no table in `public` it
-- should hold a privilege on.
do $$
declare
  target record;
begin
  for target in
    select distinct g.table_name
      from information_schema.role_table_grants g
     where g.table_schema = 'public'
       and g.grantee = 'anon'
  loop
    execute format('revoke all on public.%I from anon', target.table_name);
  end loop;
end
$$;

-- And stop the rule that produced them, so the next `create table` does not
-- quietly reintroduce what this migration just removed. Without this the fix
-- lasts until the next migration and no further.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

/* --------------------------------------------------------- authenticated */

-- TRUNCATE, everywhere, unconditionally.
--
-- This is the one that matters. Row-level security does not gate TRUNCATE, so
-- the "RLS covers it" argument that makes every other stray grant harmless does
-- not apply — and the grant was present on `usage_counters` (billing state),
-- `leads`, `businesses` and `copilot_sessions`, whose policies cover SELECT and
-- UPDATE and nothing else.
--
-- No browser session has any business truncating a table. `service_role` keeps
-- its grants and is what every server-side path already uses.
revoke truncate on all tables in schema public from authenticated;

-- INSERT, UPDATE and DELETE, but only where no policy covers that command.
--
-- A grant paired with a policy is a decision somebody made — `businesses` is
-- updatable by an admin, `leads` by a member — and revoking those would break
-- working features to tidy a list. A grant with no policy for the same command
-- is already denied by RLS, so removing it changes nothing that works and
-- removes a privilege that would become live the moment a policy is added for
-- an unrelated reason.
--
-- `polcmd`: r = SELECT, a = INSERT, w = UPDATE, d = DELETE, * = ALL.
do $$
declare
  target record;
  cmd record;
begin
  for target in
    select c.oid, c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity
  loop
    for cmd in
      select * from (values ('INSERT', 'a'), ('UPDATE', 'w'), ('DELETE', 'd'))
        as t(name, code)
    loop
      if not exists (
        select 1 from pg_policy p
         where p.polrelid = target.oid
           and p.polcmd in (cmd.code, '*')
      ) then
        execute format(
          'revoke %s on public.%I from authenticated', cmd.name, target.relname
        );
      end if;
    end loop;
  end loop;
end
$$;

-- SELECT is deliberately left alone throughout. Where there is no policy it is
-- denied by the same absent policy, and revoking it would change the error a
-- future policy author sees from "no rows" to "permission denied" — which is a
-- materially worse thing to debug, and the reason the panels in 0079 took as
-- long to find as they did.
