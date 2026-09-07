-- 0062_usage_ledger: make usage_events an authoritative, append-only ledger.
--
-- The table has been a ledger in spirit since 0009 and has been widened twice
-- (0018, 0038), but three things were still missing for it to be the single
-- source of truth Billing & Usage aggregates from:
--
--   1. **Traceability.** A row recorded "one enrichment_unit" without saying
--      which record it enriched, which provider was paid, or which product
--      surface asked. A bill nobody can explain back to an operation is a bill
--      that gets argued about.
--   2. **Idempotency.** A retried worker charged twice. Every other ledger in
--      this codebase (ai_token_ledger, jobs) already carries an idempotency
--      key; this one did not.
--   3. **Immutability.** Nothing stopped an UPDATE. A ledger you can rewrite is
--      not a ledger, and the refund path has to be a compensating entry.
--
-- Nothing here drops a metric or narrows a constraint: rows already written
-- must stay valid and stay meaningful.

/* ------------------------------------------------------------ new metrics */
-- The union of everything 0038 permitted plus the units the agent runtime, the
-- MCP gateway, the integration layer and per-kind enrichment need. Enrichment
-- keeps `enrichment_unit` for history while the three specific kinds take over
-- new writes, because the commercial model prices them separately.
alter table public.usage_events drop constraint if exists usage_events_metric_check;
alter table public.usage_events add constraint usage_events_metric_check
  check (metric in (
    'lead_processed', 'message_sent', 'message_received', 'ai_call', 'campaign_message',
    'sms_outbound_segment', 'sms_inbound_segment', 'whatsapp_message',
    'ai_mini_input_token', 'ai_mini_cached_token', 'ai_mini_output_token',
    'ai_nano_input_token', 'ai_nano_cached_token', 'ai_nano_output_token',
    'email_sent', 'reactivation_contact', 'active_user',
    'verified_prospect', 'search_run', 'intent_monitor_run', 'prospect_promoted',
    'social_touch', 'cold_email_sent', 'enrichment_unit', 'verification_unit',
    'discovery_lookup',
    -- added by 0062
    'enrichment_email', 'enrichment_phone', 'enrichment_company',
    'agent_run', 'mcp_call', 'integration_api_call'
  ));

alter table public.usage_counters drop constraint if exists usage_counters_metric_check;
alter table public.usage_counters add constraint usage_counters_metric_check
  check (metric in (
    'lead_processed', 'message_sent', 'message_received', 'ai_call', 'campaign_message',
    'sms_outbound_segment', 'sms_inbound_segment', 'whatsapp_message',
    'ai_mini_input_token', 'ai_mini_cached_token', 'ai_mini_output_token',
    'ai_nano_input_token', 'ai_nano_cached_token', 'ai_nano_output_token',
    'email_sent', 'reactivation_contact', 'active_user',
    'verified_prospect', 'search_run', 'intent_monitor_run', 'prospect_promoted',
    'social_touch', 'cold_email_sent', 'enrichment_unit', 'verification_unit',
    'discovery_lookup',
    'enrichment_email', 'enrichment_phone', 'enrichment_company',
    'agent_run', 'mcp_call', 'integration_api_call'
  ));

/* --------------------------------------------------------- provenance */
-- All nullable: 200k existing rows predate them, and backfilling a guess would
-- put invented provenance in the one table that is supposed to be evidence.

alter table public.usage_events
  add column if not exists unit text,
  add column if not exists feature text,
  add column if not exists provider text,
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists operation_id text,
  -- Points at the operation this entry reverses. Set only on adjustments, and
  -- the reason a refund is a new row rather than an edit to the old one.
  add column if not exists adjusts_operation_id text;

comment on column public.usage_events.unit is
  'What one unit of quantity is: message, token, lookup, run, call.';
comment on column public.usage_events.feature is
  'The product surface that caused the charge (copilot, agents, follow_up, find_leads, outreach, enrichment, mcp).';
comment on column public.usage_events.operation_id is
  'Stable key for the operation being charged. A retry presenting the same key is charged once.';
comment on column public.usage_events.adjusts_operation_id is
  'Set on a compensating entry; names the operation_id it reverses.';

-- Idempotency. Partial, so the many historical rows without a key do not
-- collide with each other.
create unique index if not exists usage_events_operation_idx
  on public.usage_events (business_id, operation_id)
  where operation_id is not null;

create index if not exists usage_events_feature_idx
  on public.usage_events (business_id, feature, occurred_at desc)
  where feature is not null;

create index if not exists usage_events_entity_idx
  on public.usage_events (business_id, entity_type, entity_id)
  where entity_id is not null;

/* ------------------------------------------------------------ immutability */
-- UPDATE is refused outright: a charge is corrected by posting the opposite
-- entry, never by editing the original.
--
-- DELETE is deliberately NOT blocked. usage_events cascades from businesses,
-- and a workspace deletion or an erasure request has to be able to remove the
-- rows. Blocking it would trade a compliance obligation for a bookkeeping
-- preference.
create or replace function public.usage_events_reject_update()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'usage_events is append-only; post a compensating entry with adjusts_operation_id instead of updating %',
    old.id
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists usage_events_no_update on public.usage_events;
create trigger usage_events_no_update
  before update on public.usage_events
  for each row execute function public.usage_events_reject_update();
