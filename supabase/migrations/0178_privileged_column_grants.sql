-- 0178: close self-service writes to privileged columns (backend QA 2026-09-28).
--
-- NOT YET APPLIED. Found by scripts/rls-live-check.mjs against the live project.
--
-- 1. CRITICAL. `profiles.platform_role` was writable by every signed-in user.
--    0010 meant to allow only `grant update (first_name, last_name, phone,
--    avatar_url)`, but Supabase's default privileges had already given
--    `authenticated` a TABLE-level UPDATE, and 0086 kept every table-level
--    grant that had a matching policy (`profiles_update_self`). A column grant
--    does not narrow a table grant, so
--      PATCH /rest/v1/profiles?id=eq.<own id>  {"platform_role":"platform_admin"}
--    passed RLS (the row is their own) and made them a platform admin: the
--    admin guard (lib/admin/guard.ts, lib/auth/session.ts) trusts that column,
--    and admin step-up only re-asks for their own password.
--    Every app write to `profiles` uses the service role (settings/actions.ts,
--    tour/actions.ts), so the browser role goes back to the four columns 0010
--    intended.
--
-- 2. HIGH. `businesses` had the same table-level UPDATE, gated only by
--    `businesses_update_admin` (owner/admin of the row). A workspace owner
--    could reverse a platform suspension (`status` suspended -> active), clear
--    `job_claims_paused` (the operator's per-workspace job pause), and edit
--    `deleted_at`, `activated_at`, `created_by`, `slug`. Every app write uses
--    the service role (settings, onboarding, follow-up actions), so the
--    browser role keeps only the profile fields a Settings form shows.
--
-- 3. Guard triggers as a second lock: even with a stray grant in future, the
--    browser roles cannot change `platform_role`, `businesses.status`,
--    `deleted_at` or `job_claims_paused`. The service role and migrations are
--    unaffected (current_user is not authenticated/anon for them).
--
-- 4. TRUNCATE (not subject to RLS) had come back on tables created after 0086
--    (billing_dunning, message_credit_balances, message_credit_purchases,
--    terms_acceptances, usage_overage_events, industry_codes,
--    industry_code_mappings, industry_aliases). Revoked again, and the
--    default privileges for tables created later are fixed at the source.
--    Row-level INSERT/UPDATE/DELETE grants with no matching policy (already
--    denied by RLS) are swept exactly as 0086 did.
--
-- 5. Data rights. `voice_clear_on_anonymise` (0150) removed the number an
--    OUTBOUND call rang (`to_e164`), but on an INBOUND call the lead's own
--    number is `from_e164` (the caller), which survived an erasure. The
--    function is replaced with the same body plus that line. (Outbound
--    `from_e164` is the workspace's own number and stays.)
--
-- Idempotent: revoking an absent privilege is a no-op; functions and
-- triggers are created or replaced.

begin;

-- 1. profiles --------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant update (first_name, last_name, phone, avatar_url) on public.profiles to authenticated;

-- 2. businesses ------------------------------------------------------------
revoke update on public.businesses from authenticated;
grant update (name, industry, website, phone, logo_key, timezone) on public.businesses to authenticated;

-- 3. guard triggers --------------------------------------------------------
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.platform_role is distinct from old.platform_role then
    raise exception 'platform_role can only be changed by ClientTurn'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

create or replace function public.guard_business_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.status is distinct from old.status
    or new.deleted_at is distinct from old.deleted_at
    or new.job_claims_paused is distinct from old.job_claims_paused
    or new.activated_at is distinct from old.activated_at
    or new.created_by is distinct from old.created_by
    or new.id is distinct from old.id
  ) then
    raise exception 'that workspace field can only be changed by ClientTurn'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_guard_privileged on public.businesses;
create trigger businesses_guard_privileged
  before update on public.businesses
  for each row execute function public.guard_business_privileged_columns();

revoke all on function public.guard_profile_privileged_columns() from public, anon, authenticated;
revoke all on function public.guard_business_privileged_columns() from public, anon, authenticated;

-- 5. data rights: the caller's number on an inbound call -------------------
create or replace function public.voice_clear_on_anonymise()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.voice_calls c
     set to_e164 = null
   where c.business_id = new.business_id and c.lead_id = new.id and c.to_e164 is not null;

  -- 0178: on an inbound call the lead is the caller.
  update public.voice_calls c
     set from_e164 = null
   where c.business_id = new.business_id and c.lead_id = new.id
     and c.direction = 'INBOUND' and c.from_e164 is not null;

  delete from public.voice_call_transcripts t
   using public.voice_calls c
   where c.id = t.voice_call_id and c.business_id = new.business_id and c.lead_id = new.id;

  delete from public.voice_call_recordings r
   using public.voice_calls c
   where c.id = r.voice_call_id and c.business_id = new.business_id and c.lead_id = new.id;

  update public.voice_call_outcomes o
     set summary = null, facts = '{}'::jsonb, next_action = null
   where o.business_id = new.business_id and o.lead_id = new.id;

  update public.voice_call_eligibility e
     set consent_evidence = '{}'::jsonb
   where e.business_id = new.business_id and e.lead_id = new.id and e.consent_evidence <> '{}'::jsonb;

  update public.objection_events x
     set evidence_excerpt = null
   where x.business_id = new.business_id and x.lead_id = new.id and x.evidence_excerpt is not null;
  return null;
end
$$;
revoke all on function public.voice_clear_on_anonymise() from public, anon, authenticated;

-- 4. TRUNCATE and policy-less row writes -----------------------------------
revoke truncate on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate on tables from authenticated;
alter default privileges for role postgres in schema public revoke truncate on tables from authenticated;

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
       and c.relkind in ('r', 'p')
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
        execute format('revoke %s on public.%I from authenticated', cmd.name, target.relname);
      end if;
    end loop;
  end loop;
end
$$;

commit;
