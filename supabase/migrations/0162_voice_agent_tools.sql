-- 0162_voice_agent_tools: voice phase P3. The call becomes an execution
-- surface of the AI sales agent (docs/VOICE.md §16): Retell's hosted LLM
-- calls ClientTurn's custom functions (/api/voice/tools/*) during a call, and
-- every call goes through the service registry as caller AGENT.
--
--   voice_tool_calls           one row per (call, provider tool call id): the
--                              idempotency record for a tool call and the
--                              audit of what the assistant did mid-call.
--                              [MEMBER-READ], service-role write only.
--   voice_call_outcomes        attribution_spoken, closing_version (the fixed
--                              closing line, owner decision 2026-09-28).
--   voice_calls columns        brief_version (the call brief the agent ran
--                              on), voicemail_script_version (the fixed
--                              voicemail planned for this call, §26),
--                              carrier_call_sid_source (how the carrier id
--                              was learned: Retell's telephony identifier or
--                              the number-pair match).
--
-- Additive and idempotent. NOT applied by the author: apply with the Supabase
-- MCP or CLI against project losieaikadkadtmezini, then regenerate
-- database.types.ts. Until it is applied, the tool endpoint answers
-- "unavailable" (the idempotency row cannot be written, so no tool acts) and
-- the dial path simply does not record the two new columns.

-- ================================================================ voice_tool_calls
create table if not exists public.voice_tool_calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  voice_call_id uuid not null references public.voice_calls(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  -- The provider's id for this tool invocation (Retell sends one per call to
  -- a custom function). With the call id it makes a retried tool call a no-op.
  tool_call_id text not null check (char_length(tool_call_id) between 1 and 200),
  tool text not null check (tool in (
    'record_fact', 'check_availability', 'book_meeting', 'calculate_quote', 'send_quote',
    'send_checkout_link', 'send_booking_link', 'transfer_to_human', 'schedule_callback', 'opt_out',
    'log_objection', 'end_call_summary', 'get_call_status')),
  -- SHA-256 of the canonical arguments: the same id with different arguments
  -- is refused (a replay must be a replay).
  args_hash text not null check (args_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('IN_PROGRESS', 'OK', 'REFUSED', 'FAILED')),
  -- The service operation that ran (service registry name), if any.
  operation text check (operation is null or char_length(operation) <= 80),
  -- What the assistant was told: never a secret, never the model's reasoning.
  result jsonb not null default '{}'::jsonb,
  refusal_code text check (refusal_code is null or char_length(refusal_code) <= 80),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint voice_tool_calls_once unique (voice_call_id, tool_call_id)
);
create index if not exists voice_tool_calls_call_idx on public.voice_tool_calls (voice_call_id, created_at);
create index if not exists voice_tool_calls_business_idx on public.voice_tool_calls (business_id, created_at desc);

alter table public.voice_tool_calls enable row level security;
alter table public.voice_tool_calls force row level security;
revoke all on public.voice_tool_calls from anon, authenticated;
grant select on public.voice_tool_calls to authenticated;
drop policy if exists voice_tool_calls_member_read on public.voice_tool_calls;
create policy voice_tool_calls_member_read on public.voice_tool_calls
  for select to authenticated
  using (public.is_business_member(business_id));

-- A tool row for another workspace's lead, or for an anonymised lead, is
-- refused/skipped by the same check the other voice lead rows use (0150).
drop trigger if exists voice_tool_calls_lead_check on public.voice_tool_calls;
create trigger voice_tool_calls_lead_check
  before insert on public.voice_tool_calls
  for each row execute function public.voice_lead_row_check();

-- ================================================================ data rights
-- Delete: voice_tool_calls references leads(id) and voice_calls(id) on delete
-- cascade. Anonymise: the result (which can quote what the person said: a
-- fact, a summary, an objection excerpt) is cleared; the tool, its status and
-- the timings stay (the workspace's record of what the assistant did).
create or replace function public.voice_tool_calls_clear_on_anonymise()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.voice_tool_calls t
     set result = '{}'::jsonb
   where t.business_id = new.business_id and t.lead_id = new.id and t.result <> '{}'::jsonb;
  return null;
end
$$;
revoke all on function public.voice_tool_calls_clear_on_anonymise() from public, anon, authenticated;

drop trigger if exists leads_voice_tool_calls_clear_on_anonymise on public.leads;
create trigger leads_voice_tool_calls_clear_on_anonymise
  after update of anonymised_at on public.leads
  for each row when (new.anonymised_at is not null)
  execute function public.voice_tool_calls_clear_on_anonymise();

-- ================================================================ voice_calls
alter table public.voice_calls add column if not exists brief_version text
  check (brief_version is null or char_length(brief_version) <= 60);
alter table public.voice_calls add column if not exists voicemail_script_version text
  check (voicemail_script_version is null or char_length(voicemail_script_version) <= 60);
alter table public.voice_calls add column if not exists carrier_call_sid_source text
  check (carrier_call_sid_source is null or carrier_call_sid_source in ('RETELL_TELEPHONY_ID', 'NUMBER_PAIR_MATCH'));

-- ================================================================ voice_call_outcomes
-- Owner decision 2026-09-28 (amends OD-1): every call ends with a fixed,
-- versioned attribution line ("... AI assistant, powered by ClientTurn")
-- unless the workspace is white label. Whether it was actually spoken is read
-- from the transcript (never from the model) and stored here.
alter table public.voice_call_outcomes add column if not exists attribution_spoken boolean;
alter table public.voice_call_outcomes add column if not exists closing_version text
  check (closing_version is null or char_length(closing_version) <= 60);

-- ================================================================ voice profile
-- How the assistant sounds (owner request 2026-09-28): the Retell voice and
-- the conversation feel, sent per call (voice/voice-profile.ts). A premium
-- (ElevenLabs) voice is used only with the +£0.20/min surcharge accepted,
-- and a call on it is marked premium_voice so its minutes settle at the
-- premium factor.
alter table public.voice_settings add column if not exists voice_profile jsonb not null default '{}'::jsonb;
alter table public.voice_calls add column if not exists premium_voice boolean not null default false;

-- Twilio status callbacks are matched on the carrier id (P2 gap: nothing
-- wrote it). A partial index keeps the lookup cheap.
create index if not exists voice_calls_carrier_sid_idx on public.voice_calls (carrier_call_sid)
  where carrier_call_sid is not null;
