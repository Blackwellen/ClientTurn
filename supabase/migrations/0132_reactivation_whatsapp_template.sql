-- 0132_reactivation_whatsapp_template
--
-- A WhatsApp reactivation campaign writes to people who, almost by
-- definition, have not messaged the business in the last 24 hours. Outside
-- that window WhatsApp delivers only a pre-approved template, and before this
-- migration a campaign had nowhere to name one: every such send was refused by
-- the send path ("the service window has closed").
--
-- The campaign now names the approved template (from the 0127 registry) and
-- which merge field fills each of its variables. The send worker resolves the
-- variables per lead and stores them on the queued message, exactly as a
-- follow-up step does (whatsapp_step_templates); the send path re-checks the
-- template's status at send time and uses it only once the window has closed.

alter table public.campaigns
  add column if not exists whatsapp_template_id uuid
    references public.whatsapp_templates(id) on delete set null,
  add column if not exists whatsapp_template_variables jsonb not null default '{}'::jsonb;

comment on column public.campaigns.whatsapp_template_id is
  'WhatsApp campaigns: the approved template sent once the 24-hour service window has closed.';
comment on column public.campaigns.whatsapp_template_variables is
  'WhatsApp campaigns: template variable -> merge field key (e.g. {"1": "first_name"}).';
