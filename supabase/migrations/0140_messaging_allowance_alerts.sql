-- 0140_messaging_allowance_alerts: the watermark behind "you're running low
-- on SMS / WhatsApp, buy a pack" notifications (owner request 2026-09-27:
-- "When SMS runs out, prompt them when coming up to it to buy a pack").
--
-- Design: src/lib/billing/allowance-alerts.ts (the one threshold rule: 75%,
-- 90% and 100% of what was available this period, where available = the
-- plan's allowance left + top-up credit). The meter (limits-service
-- `meterSendBilling`) checks it after every metered send.
--
-- One row per workspace, channel and billing period. `warned_at_percent` is
-- the highest threshold already notified; the meter raises it with a
-- conditional update (only while it is still below the new threshold), so two
-- concurrent sends cannot both notify. A new period is a new row, so every
-- period starts un-warned. A top-up that takes usage back below a threshold
-- lowers the watermark again (no notification), so running low a second
-- time in the same period is still announced.
--
-- Service role only: the in-app banner and the Usage & limits view compute
-- the same rule from live usage and never read this table.
--
-- Additive and idempotent: a new table, nothing existing is touched.

create table if not exists public.messaging_allowance_alerts (
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null check (channel in ('sms', 'whatsapp')),
  period_start timestamptz not null,
  warned_at_percent smallint not null default 0
    check (warned_at_percent in (0, 75, 90, 100)),
  updated_at timestamptz not null default now(),
  primary key (business_id, channel, period_start)
);

alter table public.messaging_allowance_alerts enable row level security;
alter table public.messaging_allowance_alerts force row level security;
revoke all on public.messaging_allowance_alerts from anon, authenticated;
