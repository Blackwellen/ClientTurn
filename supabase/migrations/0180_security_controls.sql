-- 0180_security_controls: workspace security policy, session list, audit-log retention.
--
-- NOT YET APPLIED. Enterprise security controls (2026-09-29, internal review
-- IR-06 and IR-09). Code tolerates this migration being absent: the policy
-- reads as "nothing configured", the session list shows as unavailable, and
-- the retention job skips the purge (src/lib/auth/account-security.ts,
-- src/lib/auth/security-queries.ts, src/lib/jobs/handlers/audit-retention.ts).
--
-- 1. workspace_security_settings: one row per workspace, owner-set.
--      require_mfa             every member must have two-factor (TOTP)
--      idle_timeout_minutes    sign a member out after this much inactivity
--      audit_retention_months  how long audit_log rows are kept (plan-capped
--                              in the app: 12 by default, Pro 24, Enterprise 84)
--    Tenant table: carries business_id, RLS enabled and forced, members of
--    the workspace may read their own row, no browser write policy. Writes go
--    through the owner-only Server Action with the service role. Grants as
--    0168: the browser role keeps SELECT only; TRUNCATE revoked (0086/0178).
--
-- 2. my_auth_sessions(): the caller's own rows from auth.sessions (Supabase
--    exposes no session list through the client API). SECURITY DEFINER,
--    restricted to auth.uid(), returns no token material. Used by
--    Settings -> Security and the admin security page.
--
-- 3. audit_log_purge_batch(): deletes at most p_limit audit_log rows older
--    than p_before for one workspace (or platform rows, business_id null).
--    Service role only. Called by the daily `audit.retention` job in batches
--    so a large backlog never becomes one long transaction. Uses the
--    existing (business_id, created_at desc) index from 0009/0075.
--
-- Idempotent: create if not exists / create or replace; policies dropped and
-- recreated; revoking an absent privilege is a no-op.

begin;

-- 1. workspace_security_settings --------------------------------------------
create table if not exists public.workspace_security_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  require_mfa boolean not null default false,
  idle_timeout_minutes integer
    check (idle_timeout_minutes is null or idle_timeout_minutes in (15, 30, 60, 120, 240, 480, 720)),
  audit_retention_months integer not null default 12
    check (audit_retention_months in (6, 12, 24, 36, 60, 84)),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspace_security_settings enable row level security;
alter table public.workspace_security_settings force row level security;

drop policy if exists workspace_security_settings_member_read on public.workspace_security_settings;
create policy workspace_security_settings_member_read
  on public.workspace_security_settings
  for select
  to authenticated
  using (public.is_business_member(business_id));

revoke all on public.workspace_security_settings from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.workspace_security_settings from authenticated;
grant select on public.workspace_security_settings to authenticated;
grant all on public.workspace_security_settings to service_role;

-- 2. my_auth_sessions --------------------------------------------------------
create or replace function public.my_auth_sessions()
returns table (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  refreshed_at timestamptz,
  user_agent text,
  ip text,
  aal text,
  is_current boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         s.created_at,
         s.updated_at,
         s.refreshed_at::timestamptz,
         s.user_agent,
         host(s.ip),
         s.aal::text,
         s.id::text = coalesce(auth.jwt() ->> 'session_id', '')
    from auth.sessions s
   where s.user_id = auth.uid()
     and (s.not_after is null or s.not_after > now())
   order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc
   limit 50;
$$;

revoke all on function public.my_auth_sessions() from public, anon;
grant execute on function public.my_auth_sessions() to authenticated;

-- 3. audit_log_purge_batch ---------------------------------------------------
create or replace function public.audit_log_purge_batch(
  p_business_id uuid,
  p_before timestamptz,
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 1000), 5000));
  n integer;
begin
  if p_before is null or p_before > now() - interval '28 days' then
    -- Guard: never purge anything younger than four weeks, whatever the caller passes.
    raise exception 'audit_log_purge_batch: cutoff % is too recent', p_before
      using errcode = '22023';
  end if;

  if p_business_id is null then
    delete from public.audit_log a
     where a.id in (
       select id from public.audit_log
        where business_id is null
          and created_at < p_before
        order by created_at
        limit v_limit
     );
  else
    delete from public.audit_log a
     where a.id in (
       select id from public.audit_log
        where business_id = p_business_id
          and created_at < p_before
        order by created_at
        limit v_limit
     );
  end if;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.audit_log_purge_batch(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.audit_log_purge_batch(uuid, timestamptz, integer) to service_role;

commit;
