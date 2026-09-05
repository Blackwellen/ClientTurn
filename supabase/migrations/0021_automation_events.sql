-- 0021_automation_events: append-only automation/lead event log (§19-21).
-- Distinct from audit_log (user-driven actions) — this is the automation
-- engine's own observability trail. Server-only: no browser client, including
-- the customer's own dashboard, ever queries this directly.
create table public.automation_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  automation_run_id uuid references public.automation_runs(id) on delete set null,
  event_type text not null
    check (event_type in (
      'lead.created', 'lead.updated', 'lead.replied', 'lead.opted_out', 'lead.human_takeover',
      'message.queued', 'message.sent', 'message.delivered', 'message.failed', 'message.received',
      'automation.started', 'automation.step_due', 'automation.step_completed',
      'automation.stopped', 'automation.failed',
      'qualification.answer_received', 'qualification.updated', 'qualification.qualified',
      'qualification.review', 'qualification.not_qualified',
      'booking.link_sent', 'booking.created', 'booking.cancelled', 'booking.completed',
      'campaign.created', 'campaign.scheduled', 'campaign.started', 'campaign.contact_due',
      'campaign.completed'
    )),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index automation_events_business_idx
  on public.automation_events (business_id, occurred_at desc);
create index automation_events_lead_idx
  on public.automation_events (lead_id, occurred_at desc)
  where lead_id is not null;
create index automation_events_type_idx
  on public.automation_events (event_type, occurred_at desc);

alter table public.automation_events enable row level security;
alter table public.automation_events force row level security;
revoke all on public.automation_events from anon, authenticated;
