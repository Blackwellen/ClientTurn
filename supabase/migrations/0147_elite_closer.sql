-- 0147_elite_closer: the lead's own contact-channel preference, and the
-- documented payload shapes for workspace-provided objections and
-- reassurance assets (docs/AGENT_RUNTIME.md "Selling like a person").
--
-- NOT APPLIED by the change that added it. Apply deliberately. The runtime
-- reads the two new lead columns on their own and tolerates their absence
-- (agent/channel-preference-store.ts), so deploying the code first is safe.
--
--   1. leads.preferred_contact_channel: where the lead said they would rather
--      be reached ('sms' | 'whatsapp' | 'email' | 'phone'). Asked at most once,
--      never as the first question (agent/channel-preference.ts). The follow-up
--      channel strategy respects it (follow-up/channel-strategy.ts
--      preferredStepChannel); consent, suppression and quiet hours are still
--      decided per send. 'phone' is also recorded when the lead asks for a
--      call, and marks the booking as a phone call.
--   2. leads.preferred_contact_channel_asked_at: when the assistant asked (or
--      the lead volunteered it). Set = never ask again.
--   3. workspace_sales_overrides kind OBJECTION (0121) is now written by
--      Settings -> AI & selling -> Objections. No schema change: the payload is
--      validated in code (sales-library/workspace-objections.ts) exactly as the
--      table's contract says. The comment records the two shapes. RLS is
--      unchanged: member read, service-role writes only.

alter table public.leads
  add column if not exists preferred_contact_channel text,
  add column if not exists preferred_contact_channel_asked_at timestamptz;

alter table public.leads drop constraint if exists leads_preferred_contact_channel_check;
alter table public.leads add constraint leads_preferred_contact_channel_check
  check (preferred_contact_channel is null or preferred_contact_channel in ('sms','whatsapp','email','phone'));

comment on column public.leads.preferred_contact_channel is
  'Where the lead said they would rather be reached (sms, whatsapp, email, phone). Asked at most once by the assistant. Respected by the follow-up channel strategy; the send guard still decides per send.';
comment on column public.leads.preferred_contact_channel_asked_at is
  'When the assistant asked the lead for their preferred channel, or the lead volunteered it. Set means never ask again.';

comment on table public.workspace_sales_overrides is
  'A workspace''s edits to the canonical sales library, validated in code before writing. kind OBJECTION: key = a library objection key (PRICE, ...) or custom:<slug>, payload {label, phrases[], response, reassuranceIds[], enabled}; key = ''*'', payload {assets: [{id, kind (SLA|GUARANTEE|CASE_STUDY|TESTIMONIAL|RESPONSE_TIME|OTHER), text, source}]}. The assistant may paraphrase a response or asset, never add to it. Member read (RLS), service-role writes only.';
