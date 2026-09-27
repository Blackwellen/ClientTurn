-- 0146_reengagement_loops: intent-driven, frequency-safe, cost-aware re-engagement.
--
-- Code: src/lib/reengagement/* (triggers, frequency guard, send time, outcome
-- metrics), jobs/handlers/reengage.ts, jobs/handlers/send-store.ts (the guard
-- at send time), jobs/handlers/campaign-{expand,send}.ts.
--
-- Every column here is read defensively by the code: before this migration is
-- applied, the defaults below are used (and existing campaigns keep their old
-- behaviour), so the release does not depend on the order.
--
-- No new table and no new browser-exposed surface: RLS is unchanged.

-- ===================================== 1. contact frequency + trigger switches
alter table public.business_settings
  add column if not exists contact_cap_daily integer not null default 1,
  add column if not exists contact_cap_weekly integer not null default 3,
  add column if not exists contact_cap_30d integer not null default 6,
  add column if not exists dead_lead_after_touches integer not null default 4,
  add column if not exists reengage_not_now_enabled boolean not null default true,
  add column if not exists reengage_no_show_enabled boolean not null default true,
  add column if not exists win_back_enabled boolean not null default true;

alter table public.business_settings drop constraint if exists business_settings_contact_caps_check;
alter table public.business_settings
  add constraint business_settings_contact_caps_check check (
    contact_cap_daily between 1 and 3
    and contact_cap_weekly between 1 and 7
    and contact_cap_30d between 1 and 15
    and dead_lead_after_touches between 2 and 10
    and contact_cap_weekly >= contact_cap_daily
    and contact_cap_30d >= contact_cap_weekly
  );

comment on column public.business_settings.contact_cap_daily is
  'Automated touches per lead per rolling 24h, across every loop (sequences, campaigns, triggers, win-back, checkout nudges). Enforced at send time. Manual messages and replies to the lead are exempt.';
comment on column public.business_settings.dead_lead_after_touches is
  'Dead-lead rule: after this many consecutive unanswered automated touches (no reply, no open where known) with intent LOW or below, automated loops stop until the lead engages.';

-- ========================================== 2. reactivation channel + timing
-- Added with the OLD behaviour as the value for existing rows, then the
-- default switched, so only campaigns created from now on are cost-aware and
-- best-time by default.
alter table public.campaigns
  add column if not exists channel_mode text not null default 'sms',
  add column if not exists send_timing text not null default 'immediate';
alter table public.campaigns alter column channel_mode set default 'cost_aware';
alter table public.campaigns alter column send_timing set default 'best_time';

alter table public.campaigns drop constraint if exists campaigns_channel_mode_check;
alter table public.campaigns
  add constraint campaigns_channel_mode_check check (channel_mode in ('cost_aware', 'sms'));
alter table public.campaigns drop constraint if exists campaigns_send_timing_check;
alter table public.campaigns
  add constraint campaigns_send_timing_check check (send_timing in ('best_time', 'immediate'));

comment on column public.campaigns.channel_mode is
  'SMS campaigns only. cost_aware: a lead who has not engaged gets email from the connected mailbox when they have an address; sms: everyone gets SMS.';
comment on column public.campaigns.send_timing is
  'best_time: each contact is sent at the hour they have replied in before (else the workspace''s, else Tue-Thu 10:00), within 14 days. immediate: as soon as the send rate allows.';

-- The channel a contact was actually sent on (cost-aware mode); null = the campaign's.
alter table public.campaign_contacts
  add column if not exists channel text;
alter table public.campaign_contacts drop constraint if exists campaign_contacts_channel_check;
alter table public.campaign_contacts
  add constraint campaign_contacts_channel_check check (channel is null or channel in ('sms', 'email', 'whatsapp'));

-- ============================================================= 3. indexes
-- The frequency guard reads one lead's recent outbound messages on every
-- automated send.
create index if not exists messages_lead_outbound_sent_idx
  on public.messages (lead_id, sent_at desc)
  where direction = 'outbound' and sent_at is not null;

-- A trigger is planned once per source, ever: its job is found by key in any
-- state (jobs_idempotency_idx covers only pending/running rows).
create index if not exists jobs_reengage_key_idx
  on public.jobs (idempotency_key)
  where idempotency_key like 'reengage.%';
