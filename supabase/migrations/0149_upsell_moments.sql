-- 0149_upsell_moments: persistence for upsell suggestions and the one-off
-- subscription welcome email.
--
-- Design: docs/upsell-plan.md and src/lib/billing/upsell-moments.ts (the pure
-- rules: owner/admin only, never in a trial, never mid-task, one modal per
-- user per 7 days and per offer per 30 days, dismiss = snooze 30 days).
--
--   * upsell_events: impressions, clicks, dismissals and attributed
--     purchases. The rules read a user's last 30+ days of it; analytics read
--     the impression -> click -> purchase funnel from it. A purchase row
--     carries the Stripe reference, unique, so a webhook retry cannot count a
--     conversion twice.
--   * business_settings.upgrade_suggestions_enabled: the owner's "Show me
--     upgrade suggestions" (Settings -> Billing), default on.
--   * subscription_welcome_emails: the durable "already welcomed" marker, one
--     row per Stripe subscription, so the welcome email is sent once even
--     after the job's idempotency key has been purged.
--
-- Service role only: the app reads and writes these through server code
-- that checks the role first. NOT applied by the author; apply with the others.
--
-- Additive and idempotent.

create table if not exists public.upsell_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  moment text not null check (char_length(moment) between 1 and 80),
  offer text not null check (offer in ('ai_token_pack', 'whatsapp_tokens', 'tier_upgrade')),
  surface text not null check (surface in ('modal', 'banner', 'card')),
  event text not null check (event in ('impression', 'click', 'dismiss', 'purchase')),
  ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists upsell_events_business_user_created_idx
  on public.upsell_events (business_id, user_id, created_at desc);
create index if not exists upsell_events_business_offer_event_idx
  on public.upsell_events (business_id, offer, event, created_at desc);
create unique index if not exists upsell_events_purchase_ref_uidx
  on public.upsell_events (ref)
  where event = 'purchase' and ref is not null;

alter table public.upsell_events enable row level security;
alter table public.upsell_events force row level security;
revoke all on public.upsell_events from anon, authenticated;

alter table public.business_settings
  add column if not exists upgrade_suggestions_enabled boolean not null default true;

create table if not exists public.subscription_welcome_emails (
  stripe_subscription_id text primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  plan text not null,
  queued_at timestamptz not null default now()
);

create index if not exists subscription_welcome_emails_business_idx
  on public.subscription_welcome_emails (business_id);

alter table public.subscription_welcome_emails enable row level security;
alter table public.subscription_welcome_emails force row level security;
revoke all on public.subscription_welcome_emails from anon, authenticated;
