-- 0176: AI phone calls placed by an agent (owner feedback 2026-09-28:
-- "it really should also be automated when an agent is created").
--
-- 1. agents.voice_calls_enabled -- "Phone leads with AI", OFF by default.
--    Switching it on never widens what the AI may do: the workspace's
--    "What the AI may do -> Phone leads" permission (commercial_authority.
--    ai_permissions.call) must be on as well, and every call still runs the
--    one calling path (runtime-core requestCall -> decideDial: entitlement,
--    consent, TPS/CTPS, calling hours, attempt caps, opt-outs, one live call).
-- 2. agents.voice_daily_call_cap -- how many calls one agent may request in a
--    UTC day (default 20, 1..100), enforced server-side by voice.request_call.
-- 3. voice_calls.requested_by_agent_id -- which agent asked for a call, so the
--    call card can say "Called by <agent>", the daily cap can be counted, and
--    the agent list can show recent call counts.
--
-- Tenancy: every row already carries business_id and both tables already
-- have RLS (0043 agents, 0150 voice_calls: member read, service-role write).
-- New columns inherit it. The agent a call points at must belong to the same
-- workspace (trigger below), so a call can never name another tenant's agent.
--
-- Idempotent: add column / index if not exists; the trigger is replaced.
-- NOT applied by the change that wrote it.

alter table public.agents
  add column if not exists voice_calls_enabled boolean not null default false;

alter table public.agents
  add column if not exists voice_daily_call_cap integer not null default 20;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agents_voice_daily_call_cap_range'
  ) then
    alter table public.agents
      add constraint agents_voice_daily_call_cap_range
      check (voice_daily_call_cap between 1 and 100);
  end if;
end $$;

-- agents uses column grants (0043: max_cost_per_run_minor stays hidden), so
-- new columns must be granted explicitly to be readable by members.
grant select (voice_calls_enabled, voice_daily_call_cap) on public.agents to authenticated;

alter table public.voice_calls
  add column if not exists requested_by_agent_id uuid
  references public.agents(id) on delete set null;

-- The daily cap and the "calls in the last 7 days" counts.
create index if not exists voice_calls_agent_day_idx
  on public.voice_calls (business_id, requested_by_agent_id, created_at desc)
  where requested_by_agent_id is not null;

-- The agent named on a call must be the same workspace's agent.
create or replace function public.voice_calls_check_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.requested_by_agent_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.agents a
     where a.id = new.requested_by_agent_id
       and a.business_id = new.business_id
  ) then
    raise exception 'voice call agent belongs to another workspace'
      using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function public.voice_calls_check_agent() from public, anon, authenticated;

drop trigger if exists voice_calls_check_agent on public.voice_calls;
create trigger voice_calls_check_agent
  before insert or update of requested_by_agent_id on public.voice_calls
  for each row execute function public.voice_calls_check_agent();
