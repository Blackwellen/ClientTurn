-- 0177: a person's own "Call with AI" is not held by the human-takeover check.
--
-- voice_call_begin_dial (0157) returns HUMAN_ACTIVE whenever the lead has
-- human_takeover set, and the dial job then waits 30 minutes and tries again,
-- forever. That hold exists so the AI never phones a lead a person is working.
-- When that person pressed "Call with AI" themselves the hold is wrong: the
-- owner's first live test call never rang (2026-09-28).
--
-- p_person_requested (default false) skips ONLY the takeover check. The app
-- sets it only for a call a signed-in person requested in the app
-- (runtime-core.ts requestCall: entry point OUTBOUND_DIAL + requestedBy, not a
-- retry); automated, agent, API/MCP and retry calls never do. Every other check
-- here (state, lead busy, platform and workspace concurrency) is unchanged.
--
-- The 6-argument function is replaced by one with a defaulted 7th argument, so
-- a caller that does not pass it behaves exactly as before.

drop function if exists public.voice_call_begin_dial(uuid, uuid, integer, integer, integer, integer);

create or replace function public.voice_call_begin_dial(
  p_call_id uuid,
  p_business_id uuid,
  p_lead_lock_id integer,
  p_workspace_lock_id integer,
  p_workspace_limit integer,
  p_platform_limit integer,
  p_person_requested boolean default false
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_state text;
  v_takeover boolean;
  v_workspace_active integer;
  v_platform_active integer;
  v_active constant text[] := array['DIALLING', 'RINGING', 'ANSWERED', 'IN_CONVERSATION', 'WRAPPING_UP', 'TRANSFERRED'];
begin
  -- Lead first, then workspace: every caller takes them in this order.
  perform pg_advisory_xact_lock(p_lead_lock_id);
  perform pg_advisory_xact_lock(p_workspace_lock_id);

  select c.lead_id, c.state into v_lead, v_state
    from public.voice_calls c
   where c.id = p_call_id and c.business_id = p_business_id
   for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  if v_state <> 'QUEUED' then
    return 'NOT_QUEUED';
  end if;

  if not coalesce(p_person_requested, false) then
    select l.human_takeover into v_takeover from public.leads l where l.id = v_lead;
    if coalesce(v_takeover, false) then
      return 'HUMAN_ACTIVE';
    end if;
  end if;

  if exists (
    select 1 from public.voice_calls c
     where c.business_id = p_business_id and c.lead_id = v_lead and c.id <> p_call_id
       and c.state = any (v_active)
  ) then
    return 'LEAD_BUSY';
  end if;

  select count(*) into v_platform_active from public.voice_calls c where c.state = any (v_active);
  if v_platform_active >= p_platform_limit then
    return 'PLATFORM_FULL';
  end if;

  select count(*) into v_workspace_active
    from public.voice_calls c
   where c.business_id = p_business_id and c.state = any (v_active);
  if v_workspace_active >= p_workspace_limit then
    return 'WORKSPACE_FULL';
  end if;

  update public.voice_calls
     set state = 'DIALLING',
         started_at = coalesce(started_at, now())
   where id = p_call_id and state = 'QUEUED';
  return 'OK';
end
$$;
revoke all on function public.voice_call_begin_dial(uuid, uuid, integer, integer, integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.voice_call_begin_dial(uuid, uuid, integer, integer, integer, integer, boolean)
  to service_role;
