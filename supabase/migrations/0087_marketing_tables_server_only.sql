-- 0087_marketing_tables_server_only: close the one grant in the schema that
-- promises browser access and delivers none.
--
-- `marketing_sessions` and `marketing_events` are the only two tables in the
-- database with SELECT granted to `authenticated`, RLS enabled, and no policy.
-- Every other browser-readable table has one. The effect today is fail-closed —
-- RLS with no policy denies everything — so nothing is currently exposed.
--
-- The problem is what the grant implies to the next person. `marketing_sessions`
-- has no `business_id` at all: it records pre-signup visitor attribution, which
-- belongs to no tenant. Someone reading "SELECT granted to authenticated" and
-- adding the obvious `using (true)` policy to make it work would, in one line,
-- expose every visitor's referrer and attribution history to every logged-in
-- user of every workspace. The grant is a loaded trap with the safety on.
--
-- Every read and write of these tables goes through the service role:
--   lib/marketing/record.ts, lib/auth/actions.ts,
--   jobs/handlers/retention-cleanup.ts, (marketing)/contact-sales/actions.ts
-- so revoking costs nothing and removes the invitation.

revoke select on public.marketing_sessions from anon, authenticated;
revoke select on public.marketing_events from anon, authenticated;

comment on table public.marketing_sessions is
  'Pre-signup visitor attribution. Server-only: no business_id, so there is no
   tenant predicate that could scope a browser read. Written and read by the
   service role.';

comment on table public.marketing_events is
  'Marketing funnel events tied to a marketing_session. Server-only, for the
   same reason as marketing_sessions.';
