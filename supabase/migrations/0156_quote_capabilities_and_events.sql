-- 0156_quote_capabilities_and_events: capability entitlements for quote-to-cash,
-- two quote_settings switches, and the automation event CHECK for quote,
-- signature and invoice events.
--
-- NOT APPLIED by the change that added it (P2 quote-to-cash). Apply with the
-- deploy that ships the code. Until it is applied:
--   * can() falls back to the identical defaults in
--     src/lib/billing/capability-rules.ts (tests/capabilities.test.ts holds
--     the rows below and that table together), so quoting works;
--   * the two quote_settings switches read as their defaults and a save says
--     so (quote_settings.update returns a pending_migration warning);
--   * every quote/invoice automation event insert is refused by the old CHECK
--     and logged by emitAutomationEvent (the webhook copy still goes out).
--
-- Capability rows (owner decision 2026-09-27; reasoning in capability-rules.ts
-- and docs/revenue-engine/14-quote-to-cash-capabilities.md): quotes,
-- e-signature and invoicing on every paid plan and off in the trial;
-- approvals on plans with more than one user (growth+); AI drafting on every
-- paid plan (it also needs aiAssistAllowed and the workspace AI switch);
-- direct close as today; white-label off everywhere (a grant, later an
-- add-on). The voice capabilities are 0151's rows and are not touched here.
-- 'do nothing' on conflict: a row an operator already tuned is kept.
--
-- Additive and idempotent.

-- ========================================================= plan_entitlements
insert into public.plan_entitlements (plan_key, metric, soft_limit, hard_limit, overage_allowed, overage_price, unit, description)
values
  ('trial', 'quote_builder_enabled', 0, 0, false, null, 'boolean', 'Quotes: catalogue, quote builder, public quote page and PDF'),
  ('starter', 'quote_builder_enabled', 1, 1, false, null, 'boolean', 'Quotes: catalogue, quote builder, public quote page and PDF'),
  ('growth', 'quote_builder_enabled', 1, 1, false, null, 'boolean', 'Quotes: catalogue, quote builder, public quote page and PDF'),
  ('pro', 'quote_builder_enabled', 1, 1, false, null, 'boolean', 'Quotes: catalogue, quote builder, public quote page and PDF'),
  ('enterprise', 'quote_builder_enabled', 1, 1, false, null, 'boolean', 'Quotes: catalogue, quote builder, public quote page and PDF'),
  ('trial', 'quote_ai_enabled', 0, 0, false, null, 'boolean', 'The assistant may draft quotes (also needs AI assist and the workspace AI switch)'),
  ('starter', 'quote_ai_enabled', 1, 1, false, null, 'boolean', 'The assistant may draft quotes (also needs AI assist and the workspace AI switch)'),
  ('growth', 'quote_ai_enabled', 1, 1, false, null, 'boolean', 'The assistant may draft quotes (also needs AI assist and the workspace AI switch)'),
  ('pro', 'quote_ai_enabled', 1, 1, false, null, 'boolean', 'The assistant may draft quotes (also needs AI assist and the workspace AI switch)'),
  ('enterprise', 'quote_ai_enabled', 1, 1, false, null, 'boolean', 'The assistant may draft quotes (also needs AI assist and the workspace AI switch)'),
  ('trial', 'quote_approval_enabled', 0, 0, false, null, 'boolean', 'Quote approval rules and the approval step (plans with more than one user)'),
  ('starter', 'quote_approval_enabled', 0, 0, false, null, 'boolean', 'Quote approval rules and the approval step (plans with more than one user)'),
  ('growth', 'quote_approval_enabled', 1, 1, false, null, 'boolean', 'Quote approval rules and the approval step (plans with more than one user)'),
  ('pro', 'quote_approval_enabled', 1, 1, false, null, 'boolean', 'Quote approval rules and the approval step (plans with more than one user)'),
  ('enterprise', 'quote_approval_enabled', 1, 1, false, null, 'boolean', 'Quote approval rules and the approval step (plans with more than one user)'),
  ('trial', 'esign_enabled', 0, 0, false, null, 'boolean', 'Simple electronic signature with audit trail on quotes'),
  ('starter', 'esign_enabled', 1, 1, false, null, 'boolean', 'Simple electronic signature with audit trail on quotes'),
  ('growth', 'esign_enabled', 1, 1, false, null, 'boolean', 'Simple electronic signature with audit trail on quotes'),
  ('pro', 'esign_enabled', 1, 1, false, null, 'boolean', 'Simple electronic signature with audit trail on quotes'),
  ('enterprise', 'esign_enabled', 1, 1, false, null, 'boolean', 'Simple electronic signature with audit trail on quotes'),
  ('trial', 'invoicing_enabled', 0, 0, false, null, 'boolean', 'Invoices from signed quotes: deposits, instalments, reminders, credit notes'),
  ('starter', 'invoicing_enabled', 1, 1, false, null, 'boolean', 'Invoices from signed quotes: deposits, instalments, reminders, credit notes'),
  ('growth', 'invoicing_enabled', 1, 1, false, null, 'boolean', 'Invoices from signed quotes: deposits, instalments, reminders, credit notes'),
  ('pro', 'invoicing_enabled', 1, 1, false, null, 'boolean', 'Invoices from signed quotes: deposits, instalments, reminders, credit notes'),
  ('enterprise', 'invoicing_enabled', 1, 1, false, null, 'boolean', 'Invoices from signed quotes: deposits, instalments, reminders, credit notes'),
  ('trial', 'direct_close_enabled', 1, 1, false, null, 'boolean', 'Direct close: approved checkout links (already available to every workspace)'),
  ('starter', 'direct_close_enabled', 1, 1, false, null, 'boolean', 'Direct close: approved checkout links (already available to every workspace)'),
  ('growth', 'direct_close_enabled', 1, 1, false, null, 'boolean', 'Direct close: approved checkout links (already available to every workspace)'),
  ('pro', 'direct_close_enabled', 1, 1, false, null, 'boolean', 'Direct close: approved checkout links (already available to every workspace)'),
  ('enterprise', 'direct_close_enabled', 1, 1, false, null, 'boolean', 'Direct close: approved checkout links (already available to every workspace)'),
  ('trial', 'white_label_public_pages', 0, 0, false, null, 'boolean', 'Remove the Powered by ClientTurn badge from public pages (granted as an add-on)'),
  ('starter', 'white_label_public_pages', 0, 0, false, null, 'boolean', 'Remove the Powered by ClientTurn badge from public pages (granted as an add-on)'),
  ('growth', 'white_label_public_pages', 0, 0, false, null, 'boolean', 'Remove the Powered by ClientTurn badge from public pages (granted as an add-on)'),
  ('pro', 'white_label_public_pages', 0, 0, false, null, 'boolean', 'Remove the Powered by ClientTurn badge from public pages (granted as an add-on)'),
  ('enterprise', 'white_label_public_pages', 0, 0, false, null, 'boolean', 'Remove the Powered by ClientTurn badge from public pages (granted as an add-on)')
on conflict (plan_key, metric) do nothing;

-- ============================================================ quote_settings
-- require_drawn_signature: ask for a drawn signature as well as the typed name.
-- quote_nudges_enabled: remind a customer who has not accepted a sent quote
-- (through the re-engagement frequency guard).
alter table public.quote_settings
  add column if not exists require_drawn_signature boolean not null default false,
  add column if not exists quote_nudges_enabled boolean not null default true;

-- The browser reads settings through the member-read policy (0152 granted
-- select on the table, so new columns are readable without a new grant).

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
    'invoice.credited'
  ));
