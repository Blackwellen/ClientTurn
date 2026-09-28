-- 0163_automation_rules_pipeline_and_retention: automation rules (gap map
-- §45), pipeline semantics (§46), the data-rights "kept after deletion" list
-- for quotes and invoices, and CRM/list import company facts.
--
-- NOT APPLIED by the change that added it. Apply with the deploy that ships
-- the code, then regenerate database.types.ts. Until it is applied:
--   * emitAutomationEvent: the new event types are refused by the old CHECK
--     and logged (their sources are unaffected), so no rule or pipeline
--     dispatch is queued for them;
--   * automation rules: the list reads empty and a save says the migration is
--     pending (automation_rule.save returns UNAVAILABLE);
--   * pipeline mapping: the defaults apply (pipeline-semantics.ts) and a save
--     is refused with the same message;
--   * list imports: the three new columns are not written (the import still
--     works, and the intent signals are recorded from the parsed row);
--   * data_rights_delete keeps reporting the 0124 retained list.
--
-- Voice recording and transcript retention (the voice.retention job) needs no
-- schema: it uses retain_until, voice_settings.recording_retention_days and
-- voice_object_tombstones from 0150.
--
-- Additive and idempotent.

-- ================================================ automation_events.event_type
-- The full TS catalog (src/lib/automation/event-types.ts).
alter table public.automation_events
  drop constraint if exists automation_events_event_type_check;
alter table public.automation_events
  add constraint automation_events_event_type_check
  check (event_type in (
    'lead.created',
    'lead.updated',
    'lead.replied',
    'lead.opted_out',
    'lead.human_takeover',
    'message.queued',
    'message.sent',
    'message.delivered',
    'message.failed',
    'message.received',
    'automation.started',
    'automation.step_due',
    'automation.step_completed',
    'automation.step_blocked',
    'automation.stopped',
    'automation.failed',
    'qualification.answer_received',
    'qualification.updated',
    'qualification.qualified',
    'qualification.review',
    'qualification.not_qualified',
    'booking.link_sent',
    'booking.created',
    'booking.cancelled',
    'booking.completed',
    'campaign.created',
    'campaign.scheduled',
    'campaign.started',
    'campaign.contact_due',
    'campaign.completed',
    'quote.created',
    'quote.approval_requested',
    'quote.approved',
    'quote.approval_rejected',
    'quote.sent',
    'quote.viewed',
    'quote.accepted',
    'quote.declined',
    'quote.expired',
    'quote.revised',
    'quote.withdrawn',
    'quote.reminded',
    'signature.completed',
    'invoice.issued',
    'invoice.paid',
    'invoice.overdue',
    'invoice.voided',
    'invoice.credited',
    'call.requested',
    'call.started',
    'call.answered',
    'call.missed',
    'call.voicemail',
    'call.qualified',
    'voice.lead_eligible',
    'voice.budget_threshold',
    'intent.threshold_exceeded',
    'quote.requested',
    'invoice.created',
    'payment.direct_sale',
    'human.requested',
    'objection.detected',
    'reactivation.succeeded',
    'usage.exhausted'
  ));

-- ============================================================ automation_rules
-- [MEMBER-READ] Written by the service role only (automation_rule.* in
-- src/lib/services). A rule acts on the authority of `enabled_by`, whose live
-- role is re-read on every run; a rule whose enabler left does nothing and
-- says so. Soft-deleted so the run history keeps its rule.
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  trigger_event text not null check (trigger_event ~ '^[a-z_]+\.[a-z_]+$'),
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object'),
  actions jsonb not null check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) between 1 and 5),
  frequency text not null default 'ONCE_PER_DAY' check (frequency in ('ONCE_PER_LEAD', 'ONCE_PER_DAY', 'EVERY_TIME')),
  enabled boolean not null default false,
  -- The standing confirmation for actions that contact a customer.
  acknowledge_external boolean not null default false,
  enabled_by uuid references auth.users(id) on delete set null,
  enabled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint automation_rules_enabled_has_author check (not enabled or enabled_at is not null)
);
create index if not exists automation_rules_trigger_idx
  on public.automation_rules (business_id, trigger_event) where enabled and deleted_at is null;
drop trigger if exists automation_rules_set_updated_at on public.automation_rules;
create trigger automation_rules_set_updated_at
  before update on public.automation_rules
  for each row execute function public.set_updated_at();

-- ======================================================== automation_rule_runs
-- [MEMBER-READ] + [ANONYMISE: removed]. One row per (rule, event, action):
-- SUCCEEDED, SKIPPED with the reason, FAILED, or SCHEDULED (a delayed call).
-- action_index -1 records a rule that did not fire (conditions, frequency).
-- Ids, codes and a short reason only; never a message body.
create table if not exists public.automation_rule_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  automation_event_id uuid not null,
  lead_id uuid references public.leads(id) on delete cascade,
  action_index integer not null check (action_index between -1 and 4),
  action_type text check (action_type is null or char_length(action_type) <= 40),
  operation text check (operation is null or char_length(operation) <= 80),
  status text not null check (status in ('SUCCEEDED', 'SKIPPED', 'FAILED', 'SCHEDULED')),
  reason_code text check (reason_code is null or char_length(reason_code) <= 40),
  reason text check (reason is null or char_length(reason) <= 500),
  entity_id uuid,
  audit_event_id uuid,
  run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_rule_runs_once unique (rule_id, automation_event_id, action_index)
);
create index if not exists automation_rule_runs_rule_idx
  on public.automation_rule_runs (rule_id, created_at desc);
create index if not exists automation_rule_runs_fired_idx
  on public.automation_rule_runs (rule_id, lead_id, created_at desc) where action_index = 0;
drop trigger if exists automation_rule_runs_set_updated_at on public.automation_rule_runs;
create trigger automation_rule_runs_set_updated_at
  before update on public.automation_rule_runs
  for each row execute function public.set_updated_at();

-- ========================================================= pipeline_stage_maps
-- [MEMBER-READ] System semantic -> the workspace's stage (pipeline-semantics.ts).
-- No row = the defaults. Read defensively: an unknown or disallowed entry
-- falls back to its default.
create table if not exists public.pipeline_stage_maps (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['automation_rules', 'automation_rule_runs', 'pipeline_stage_maps'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_business_member(business_id))',
      t || '_select_member', t);
  end loop;
end $$;

-- A rule's run history about a person goes with their anonymisation
-- (coverage.ts: automation_rule_runs REMOVE), in the scrub's transaction.
create or replace function public.automation_rule_runs_clear_on_anonymise()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.automation_rule_runs r where r.business_id = new.business_id and r.lead_id = new.id;
  return null;
end
$$;
revoke all on function public.automation_rule_runs_clear_on_anonymise() from public, anon, authenticated;

drop trigger if exists leads_automation_rule_runs_clear_on_anonymise on public.leads;
create trigger leads_automation_rule_runs_clear_on_anonymise
  after update of anonymised_at on public.leads
  for each row when (new.anonymised_at is not null)
  execute function public.automation_rule_runs_clear_on_anonymise();

-- ============================================================ lead_import_rows
-- Company facts from a CRM or list import (src/lib/imports/company-facts.ts):
-- the renewal date, headcount and technologies the customer's own data states.
-- About the company, not the person.
alter table public.lead_import_rows
  add column if not exists contract_renewal_date date,
  add column if not exists headcount integer,
  add column if not exists technologies text[];
alter table public.lead_import_rows drop constraint if exists lead_import_rows_headcount_check;
alter table public.lead_import_rows
  add constraint lead_import_rows_headcount_check check (headcount is null or headcount between 0 and 10000000);
alter table public.lead_import_rows drop constraint if exists lead_import_rows_technologies_check;
alter table public.lead_import_rows
  add constraint lead_import_rows_technologies_check check (technologies is null or cardinality(technologies) <= 30);

-- ========================================================== data_rights_delete
-- The 0124 definition, unchanged except for the retained list, which now names
-- the quote and invoice records kept after an erasure (0153, 0154):
-- coverage.ts retainedOnDelete() and this list are held equal by
-- tests/data-rights.test.ts, which reads the latest definition of the function.
create or replace function public.data_rights_delete(
  p_business_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_requested_by uuid default null,
  p_caller text default null,
  p_reason text default null,
  p_privacy_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_result jsonb;
  v_counts jsonb;
  v_lead_id uuid;
  v_prospects uuid[];
  v_action uuid;
  n integer;
begin
  v_result := public.data_rights_scrub(p_business_id, p_subject_type, p_subject_id);
  if v_result is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;

  v_counts := v_result -> 'counts';
  v_lead_id := nullif(v_result ->> 'lead_id', '')::uuid;
  select coalesce(array_agg(value::uuid), '{}') into v_prospects
    from jsonb_array_elements_text(v_result -> 'prospect_ids');

  -- Subject-keyed rows have no FK to cascade from; without this they would
  -- outlive the subject as orphans.
  delete from public.contact_permissions cp
   where cp.business_id = p_business_id
     and ((cp.subject_type = 'LEAD' and cp.subject_id = v_lead_id)
          or (cp.subject_type = 'PROSPECT' and cp.subject_id = any(v_prospects)));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'contact_permissions', 'removed', n);

  delete from public.contactability_results cr
   where cr.business_id = p_business_id
     and ((cr.subject_type = 'LEAD' and cr.subject_id = v_lead_id)
          or (cr.subject_type = 'PROSPECT' and cr.subject_id = any(v_prospects)));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'contactability_results', 'removed', n);

  delete from public.lead_source_evidence e
   where e.business_id = p_business_id
     and ((e.subject_type = 'LEAD' and e.subject_id = v_lead_id)
          or (e.subject_type = 'PROSPECT' and e.subject_id = any(v_prospects)));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'lead_source_evidence', 'removed', n);

  delete from public.agent_queue_items q
   where q.business_id = p_business_id
     and ((q.subject_type = 'LEAD' and q.subject_id = v_lead_id)
          or (q.subject_type = 'PROSPECT' and q.subject_id = any(v_prospects)));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'agent_queue_items', 'removed', n);

  -- 0045's prospect_id has no ON DELETE action and would block the delete.
  update public.workspace_app_events w
     set prospect_id = null
   where w.prospect_id = any(v_prospects);

  -- The prospect goes first: a CONVERTED prospect may not lose its lead id
  -- (0063), so it cannot outlive the lead it points at.
  delete from public.prospects p where p.id = any(v_prospects);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'prospects', 'removed', n);

  if v_lead_id is not null then
    -- Cascades: conversations, messages, message_events, qualification_answers,
    -- bookings, automation_runs, campaign_contacts, crm_push_records,
    -- agent_handoffs, intent_events, lead_notes, lead_scores, lead_tags,
    -- lead_assignments, lead_touches, merge_events, merge_candidates.
    delete from public.leads l where l.id = v_lead_id and l.business_id = p_business_id;
    get diagnostics n = row_count;
    v_counts := public.data_rights_count(v_counts, 'leads', 'removed', n);
  end if;

  v_result := jsonb_set(v_result, '{counts}', v_counts)
    || jsonb_build_object(
      'retained', to_jsonb(array[
        'audit_log', 'usage_events', 'cost_events', 'usage_reservations', 'ai_runs',
        'conversation_agent_runs', 'agent_runs', 'automation_events', 'opportunities',
        'ai_budget_decisions', 'privacy_notice_events', 'compliance_decisions',
        'suppression_entries', 'ingest_requests', 'domain_events', 'webhook_deliveries',
        'agent_activity_events', 'privacy_requests', 'data_rights_actions',
        'lead_import_rows', 'sourcing_run_results', 'workspace_app_events',
        'business_learning_events', 'conversation_agent_actions', 'agent_tool_calls',
        'jobs', 'webhook_events', 'connector_event_failures', 'workspace_stream_events',
        'social_action_log', 'inmail_sends',
        -- 0153/0154 (added by 0163): a signed quote and an issued invoice stay
        -- attached to the retained, pseudonymous opportunity, with the
        -- person's values cleared by the quote/invoice anonymise triggers.
        'quotes', 'quote_revisions', 'quote_signatures', 'quote_acceptance_events',
        'quote_access_tokens', 'invoices'
      ]::text[])
    );

  insert into public.data_rights_actions (
    business_id, subject_type, subject_id, action, requested_by, caller, reason,
    privacy_request_id, summary
  ) values (
    p_business_id, p_subject_type, p_subject_id, 'DELETE', p_requested_by, p_caller,
    left(p_reason, 500), p_privacy_request_id,
    v_result || jsonb_build_object('mode', 'DELETE')
  )
  returning id into v_action;

  return v_result || jsonb_build_object('status', 'DONE', 'action_id', v_action, 'mode', 'DELETE');
end
$$;

revoke all on function public.data_rights_delete(uuid, text, uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.data_rights_delete(uuid, text, uuid, uuid, text, text, uuid)
  to service_role;
