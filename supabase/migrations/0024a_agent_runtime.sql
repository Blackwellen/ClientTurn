-- 0024a_agent_runtime: the ClientTurn conversation agent.
--
-- Numbering note. This lands between 0024_platform_admin_ops (the newest
-- applied migration) and the 0025+ V4 expansion set, which is authored but
-- not yet applied. It deliberately does NOT reuse the name `agent_runs`:
-- 0032_v4_agents_usage defines a table of that name for the nine V4 sourcing
-- agent profiles, which is a different thing with a different shape. The
-- conversation agent gets its own `conversation_agent_*` family so both can
-- exist once V4 lands.
--
-- Design boundary, restated here because it is the whole point of the runtime:
-- the model understands language and proposes; deterministic application code
-- decides, authorises and executes. Nothing in this schema stores hidden model
-- reasoning -- only structured, auditable outcomes.

-- ==========================================================================
-- 1. Conversation ownership (SS63, SS64)
-- ==========================================================================
-- `state` already carries active/closed/handover for the conversation itself.
-- `owner` is a separate axis: who is allowed to speak next. The agent may only
-- send while owner = 'AI_ACTIVE', and it never takes ownership back on its own.

alter table public.conversations
  add column if not exists owner text not null default 'AI_ACTIVE',
  add column if not exists owner_changed_at timestamptz,
  add column if not exists owner_changed_by uuid references auth.users(id) on delete set null,
  -- Monotonic turn counter. An agent turn claims it at the start and releases
  -- it at the end, so two workers racing on two inbound messages cannot both
  -- send a reply.
  add column if not exists agent_turn_seq bigint not null default 0,
  add column if not exists agent_locked_until timestamptz;

alter table public.conversations
  drop constraint if exists conversations_owner_check;
alter table public.conversations
  add constraint conversations_owner_check
  check (owner in ('AI_ACTIVE', 'HUMAN_ACTIVE', 'HANDED_OVER', 'CLOSED'));

create index if not exists conversations_agent_lock_idx
  on public.conversations (agent_locked_until)
  where agent_locked_until is not null;

-- ==========================================================================
-- 2. Messages the agent produced
-- ==========================================================================
-- SUGGEST_ONLY mode writes a DRAFT row: a real message record a human can
-- review and send, never something the send worker will pick up.

alter table public.messages
  drop constraint if exists messages_origin_check;
alter table public.messages
  add constraint messages_origin_check
  check (origin in ('automation', 'manual', 'campaign', 'system', 'agent'));

alter table public.messages
  drop constraint if exists messages_status_check;
alter table public.messages
  add constraint messages_status_check
  check (status in ('DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED', 'DISCARDED'));

alter table public.messages
  add column if not exists agent_run_id uuid;

create index if not exists messages_agent_draft_idx
  on public.messages (business_id, conversation_id, created_at desc)
  where status = 'DRAFT';

-- ==========================================================================
-- 3. Workspace agent settings
-- ==========================================================================
-- Four controls, no more. Model choice, prompts, temperature and step budgets
-- are platform concerns and are deliberately absent from the tenant surface.

alter table public.business_ai_settings
  add column if not exists agent_mode text not null default 'OFF',
  add column if not exists agent_channels text[] not null default array['sms','whatsapp']::text[],
  add column if not exists agent_handover_on_review boolean not null default true,
  add column if not exists agent_answer_service_questions boolean not null default true;

alter table public.business_ai_settings
  drop constraint if exists business_ai_settings_agent_mode_check;
alter table public.business_ai_settings
  add constraint business_ai_settings_agent_mode_check
  check (agent_mode in ('OFF', 'SUGGEST_ONLY', 'AUTO_REPLY'));

-- ==========================================================================
-- 4. Pricing visibility
-- ==========================================================================
-- A service's internal average value is commercial data, not a quotable
-- price. Nothing may be said to a lead about price unless a workspace has
-- explicitly marked it public, so the default is QUOTE_REQUIRED.

alter table public.services
  add column if not exists pricing_visibility text not null default 'QUOTE_REQUIRED',
  add column if not exists public_price_text text;

alter table public.services
  drop constraint if exists services_pricing_visibility_check;
alter table public.services
  add constraint services_pricing_visibility_check
  check (pricing_visibility in ('INTERNAL_ONLY', 'PUBLIC_FIXED', 'PUBLIC_FROM', 'QUOTE_REQUIRED'));

-- A public price band must actually have wording to quote.
alter table public.services
  drop constraint if exists services_public_price_check;
alter table public.services
  add constraint services_public_price_check
  check (
    pricing_visibility not in ('PUBLIC_FIXED', 'PUBLIC_FROM')
    or (public_price_text is not null and length(btrim(public_price_text)) > 0)
  );

-- ==========================================================================
-- 5. conversation_agent_runs
-- ==========================================================================
create table public.conversation_agent_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  -- The normalised AgentEvent that triggered this run.
  trigger_event_type text not null,
  trigger_event_id text,
  -- One run per trigger. A retried job re-reads the existing run instead of
  -- starting a second turn.
  idempotency_key text not null,
  mode text not null default 'NEW_LEAD_RESPONSE',
  agent_mode text not null default 'OFF',
  channel text,
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'HANDED_OVER',
                      'SUPPRESSED', 'SKIPPED', 'FAILED')),
  outcome text
    check (outcome is null or outcome in (
      'NO_ACTION', 'MESSAGE_SENT', 'MESSAGE_QUEUED', 'MESSAGE_DRAFTED',
      'QUALIFICATION_UPDATED', 'BOOKING_CREATED', 'BOOKING_OPTIONS_SENT',
      'HANDOVER_CREATED', 'SUPPRESSED', 'WAITING_FOR_USER', 'FAILED')),
  detected_intent text,
  intent_confidence numeric(4,3),
  reply_classification text,
  lifecycle_before text,
  lifecycle_after text,
  qualification_before text,
  qualification_after text,
  step_count integer not null default 0,
  model_provider text,
  model_name text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  duration_ms integer,
  error_code text,
  -- Structured, non-sensitive decision record. Never chain-of-thought.
  decision_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index conversation_agent_runs_idem_idx
  on public.conversation_agent_runs (business_id, idempotency_key);
create index conversation_agent_runs_business_idx
  on public.conversation_agent_runs (business_id, created_at desc);
create index conversation_agent_runs_conversation_idx
  on public.conversation_agent_runs (conversation_id, created_at desc);
create index conversation_agent_runs_lead_idx
  on public.conversation_agent_runs (lead_id, created_at desc);
-- Admin observability reads failures far more often than successes.
create index conversation_agent_runs_failure_idx
  on public.conversation_agent_runs (status, created_at desc)
  where status in ('FAILED', 'HANDED_OVER');

-- ==========================================================================
-- 6. conversation_agent_actions
-- ==========================================================================
-- One row per tool the runtime was asked to run, including the ones the
-- policy engine refused. A denial is the interesting row, not an error.
create table public.conversation_agent_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  agent_run_id uuid not null references public.conversation_agent_runs(id) on delete cascade,
  step_index integer not null default 0,
  tool_name text not null,
  risk_level text not null default 'LOW'
    check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status text not null default 'OK'
    check (status in ('OK', 'DENIED_PERMISSION', 'DENIED_POLICY', 'DENIED_BUDGET',
                      'DENIED_CONFIDENCE', 'ERROR', 'SKIPPED')),
  denial_reason text,
  -- Summaries, not raw arguments: no lead PII beyond what the workspace can
  -- already see, and never a credential or provider detail.
  input_summary jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index conversation_agent_actions_run_idx
  on public.conversation_agent_actions (agent_run_id, step_index);
create index conversation_agent_actions_denied_idx
  on public.conversation_agent_actions (business_id, created_at desc)
  where status <> 'OK';

-- ==========================================================================
-- 7. conversation_agent_extractions
-- ==========================================================================
-- Every candidate field the model proposed, whether or not it was accepted.
-- `accepted = false` rows are how a "why did it not fill the postcode in"
-- question gets answered without re-running anything.
create table public.conversation_agent_extractions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  agent_run_id uuid not null references public.conversation_agent_runs(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  field text not null,
  value_json jsonb,
  confidence numeric(4,3),
  source_message_id uuid references public.messages(id) on delete set null,
  accepted boolean not null default false,
  rejected_reason text,
  created_at timestamptz not null default now()
);

create index conversation_agent_extractions_run_idx
  on public.conversation_agent_extractions (agent_run_id);
create index conversation_agent_extractions_lead_idx
  on public.conversation_agent_extractions (lead_id, created_at desc);

-- ==========================================================================
-- 8. conversation_summaries
-- ==========================================================================
-- Rolling compressed memory for long conversations. `last_message_id` is the
-- watermark: everything up to it is in the summary, everything after it is
-- still passed verbatim.
create table public.conversation_summaries (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  summary_json jsonb not null default '{}'::jsonb,
  last_message_id uuid references public.messages(id) on delete set null,
  message_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create trigger conversation_summaries_set_updated_at
  before update on public.conversation_summaries
  for each row execute function public.set_updated_at();

create index conversation_summaries_business_idx
  on public.conversation_summaries (business_id, updated_at desc);

-- ==========================================================================
-- 9. agent_handoffs
-- ==========================================================================
create table public.agent_handoffs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  agent_run_id uuid references public.conversation_agent_runs(id) on delete set null,
  reason text not null
    check (reason in ('HUMAN_REQUESTED', 'COMPLAINT', 'LOW_CONFIDENCE', 'QUALIFICATION_REVIEW',
                      'PRICING_NOT_CONFIGURED', 'OUT_OF_SCOPE', 'PROVIDER_FAILURE',
                      'TOOL_FAILURE', 'MAX_STEPS_EXCEEDED', 'POLICY', 'EMERGENCY',
                      'HIGH_VALUE', 'NO_NEXT_QUESTION')),
  priority text not null default 'NORMAL'
    check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  -- {intent, service, qualificationStatus, keyAnswers, bookingIntent,
  --  unresolvedIssue, sentiment, summary} -- factual only.
  summary_json jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED')),
  assigned_user_id uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

-- One open handoff per conversation. A second reason updates the existing row
-- rather than flooding the team with duplicates.
create unique index agent_handoffs_open_idx
  on public.agent_handoffs (conversation_id)
  where status in ('OPEN', 'ACKNOWLEDGED') and conversation_id is not null;

create index agent_handoffs_queue_idx
  on public.agent_handoffs (business_id, status, priority, created_at desc);
create index agent_handoffs_lead_idx
  on public.agent_handoffs (lead_id, created_at desc);

-- ==========================================================================
-- 10. RLS
-- ==========================================================================
-- Runs and handoffs are workspace-visible outcomes -- they carry no prompts,
-- no tool arguments and no provider detail. Actions, extractions and
-- summaries are operational internals: RLS on, no policies, service role only.

alter table public.conversation_agent_runs enable row level security;
alter table public.conversation_agent_runs force row level security;
create policy conversation_agent_runs_select on public.conversation_agent_runs
  for select to authenticated
  using (public.is_business_member(business_id));
grant select on public.conversation_agent_runs to authenticated;
revoke all on public.conversation_agent_runs from anon;

alter table public.agent_handoffs enable row level security;
alter table public.agent_handoffs force row level security;
create policy agent_handoffs_select on public.agent_handoffs
  for select to authenticated
  using (public.is_business_member(business_id));
-- Acknowledge/resolve is a member action; creation stays server-side so a
-- handoff always carries a runtime-generated summary.
create policy agent_handoffs_update on public.agent_handoffs
  for update to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));
grant select, update on public.agent_handoffs to authenticated;
revoke all on public.agent_handoffs from anon;

alter table public.conversation_agent_actions enable row level security;
alter table public.conversation_agent_actions force row level security;
revoke all on public.conversation_agent_actions from anon, authenticated;

alter table public.conversation_agent_extractions enable row level security;
alter table public.conversation_agent_extractions force row level security;
revoke all on public.conversation_agent_extractions from anon, authenticated;

alter table public.conversation_summaries enable row level security;
alter table public.conversation_summaries force row level security;
revoke all on public.conversation_summaries from anon, authenticated;

-- ==========================================================================
-- 11. Turn lock
-- ==========================================================================
-- Claims the right to run one agent turn on a conversation. Returns the turn
-- sequence the caller must present when it finishes; a caller that loses the
-- race gets null and drops its turn rather than sending a second reply.
create or replace function public.claim_agent_turn(
  target_conversation_id uuid,
  lock_seconds integer default 120
)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  claimed bigint;
begin
  update public.conversations c
     set agent_turn_seq = c.agent_turn_seq + 1,
         agent_locked_until = now() + make_interval(secs => lock_seconds)
   where c.id = target_conversation_id
     and (c.agent_locked_until is null or c.agent_locked_until < now())
  returning c.agent_turn_seq into claimed;

  return claimed;
end;
$$;

revoke all on function public.claim_agent_turn(uuid, integer) from public, anon, authenticated;

create or replace function public.release_agent_turn(
  target_conversation_id uuid,
  turn_seq bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  released boolean;
begin
  update public.conversations
     set agent_locked_until = null
   where id = target_conversation_id
     and agent_turn_seq = turn_seq
  returning true into released;

  return coalesce(released, false);
end;
$$;

revoke all on function public.release_agent_turn(uuid, bigint) from public, anon, authenticated;
