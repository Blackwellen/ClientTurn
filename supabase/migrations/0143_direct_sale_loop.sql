-- 0143_direct_sale_loop: close the direct-sale loop (checkout sent -> paid ->
-- WON -> thank-you), with tracked checkout links, payment confirmation from
-- the customer's OWN Stripe account or a signed "order paid" webhook, and
-- abandoned-checkout nudges.
--
-- Written, not applied. The app tolerates its absence: tracking, payment
-- confirmation and nudges switch themselves off (isSchemaLag) until it is.
--
--   checkout_attempts   one row per checkout link the assistant sent, with the
--                       opaque tracking token that travels in the URL
--   checkout_payments   every confirmed payment received, matched or not; the
--                       revenue ledger the dashboard reads
--   payment_endpoints   the per-workspace inbound endpoints and their
--                       encrypted signing secrets (server-only)
--   commercial_authority gains the abandoned-checkout settings
--
-- No Stripe Connect: the Stripe endpoint receives events from the customer's
-- own Stripe account, verified with the signing secret they paste in.

-- ------------------------------------------------------ payment_endpoints
-- Server-only. The secret is sealed by src/lib/security/secret-box.ts before
-- it reaches Postgres; there is no browser policy, and the settings screen
-- reads a redacted view through the service role.
create table if not exists public.payment_endpoints (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('STRIPE', 'ORDER_PAID')),
  secret_ciphertext text,
  active boolean not null default true,
  last_received_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_endpoints_one_per_kind unique (business_id, kind)
);

create trigger payment_endpoints_set_updated_at
  before update on public.payment_endpoints
  for each row execute function public.set_updated_at();

alter table public.payment_endpoints enable row level security;
revoke all on public.payment_endpoints from anon, authenticated;

-- ------------------------------------------------------ checkout_attempts
create table if not exists public.checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  -- The approved link's id in commercial_authority.approved_checkout_links.
  link_id text not null check (char_length(link_id) between 1 and 64),
  -- Opaque, random, never the lead id. Alphanumerics, - and _ only, which is
  -- what Stripe's client_reference_id accepts.
  token text not null check (token ~ '^[A-Za-z0-9_-]{16,64}$'),
  tracking_param text not null,
  sent_url text not null,
  channel text not null,
  send_key text not null,
  message_id uuid references public.messages(id) on delete set null,
  agent_run_id uuid,
  sent_at timestamptz not null default now(),
  status text not null default 'SENT'
    check (status in ('SENT', 'PAID', 'ABANDONED', 'EXPIRED')),
  nudges_sent integer not null default 0 check (nudges_sent >= 0),
  last_nudged_at timestamptz,
  -- Set only where a provider tells us (never guessed from a link preview).
  clicked_at timestamptz,
  paid_at timestamptz,
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  recurring boolean,
  recurring_interval text check (recurring_interval is null or recurring_interval in ('day', 'week', 'month', 'year')),
  provider text,
  provider_order_id text,
  provider_event_id text,
  payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_attempts_token_unique unique (token),
  constraint checkout_attempts_send_key_unique unique (business_id, send_key)
);

create index if not exists checkout_attempts_lead_idx
  on public.checkout_attempts (business_id, lead_id, sent_at desc);
create index if not exists checkout_attempts_open_idx
  on public.checkout_attempts (status, sent_at)
  where status in ('SENT', 'ABANDONED');

create trigger checkout_attempts_set_updated_at
  before update on public.checkout_attempts
  for each row execute function public.set_updated_at();

alter table public.checkout_attempts enable row level security;
revoke all on public.checkout_attempts from anon, authenticated;
grant select on public.checkout_attempts to authenticated;
drop policy if exists checkout_attempts_select_member on public.checkout_attempts;
create policy checkout_attempts_select_member on public.checkout_attempts
  for select to authenticated
  using (public.is_business_member(business_id));

-- ------------------------------------------------------ checkout_payments
-- Every confirmed payment. A payment that matches no lead is kept UNMATCHED
-- and shown to the owner to link by hand; nothing is dropped.
--
--   MATCHED    matched by the tracking token (or a renewal of a subscription
--              already matched); applied (WON, thank-you on the first)
--   REVIEW     matched by email only: a candidate lead, NOT applied until a
--              person confirms it (lower confidence)
--   UNMATCHED  no candidate
--   LINKED     linked to a lead by a person; applied
create table if not exists public.checkout_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null check (provider in ('stripe', 'order_paid')),
  -- For order_paid: shopify, woocommerce, gocardless, paddle, zapier, other.
  source text,
  external_event_id text not null,
  provider_order_id text not null check (char_length(provider_order_id) between 1 and 200),
  reference text,
  email text,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  recurring boolean not null default false,
  recurring_interval text check (recurring_interval is null or recurring_interval in ('day', 'week', 'month', 'year')),
  mrr_minor bigint check (mrr_minor is null or mrr_minor >= 0),
  -- A provider subscription id (Stripe sub_...): later renewals of a
  -- subscription already matched to a lead follow it without a token.
  subscription_id text,
  status text not null default 'UNMATCHED'
    check (status in ('MATCHED', 'REVIEW', 'UNMATCHED', 'LINKED')),
  match_kind text check (match_kind is null or match_kind in ('TOKEN', 'SUBSCRIPTION', 'EMAIL', 'MANUAL')),
  lead_id uuid references public.leads(id) on delete cascade,
  checkout_attempt_id uuid references public.checkout_attempts(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  paid_at timestamptz not null default now(),
  applied_at timestamptz,
  linked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_payments_order_unique unique (business_id, provider, provider_order_id)
);

create index if not exists checkout_payments_lead_idx
  on public.checkout_payments (business_id, lead_id, paid_at desc);
create index if not exists checkout_payments_subscription_idx
  on public.checkout_payments (business_id, subscription_id)
  where subscription_id is not null;
create index if not exists checkout_payments_needs_review_idx
  on public.checkout_payments (business_id, paid_at desc)
  where status in ('REVIEW', 'UNMATCHED');

create trigger checkout_payments_set_updated_at
  before update on public.checkout_payments
  for each row execute function public.set_updated_at();

alter table public.checkout_payments enable row level security;
revoke all on public.checkout_payments from anon, authenticated;
grant select on public.checkout_payments to authenticated;
drop policy if exists checkout_payments_select_member on public.checkout_payments;
create policy checkout_payments_select_member on public.checkout_payments
  for select to authenticated
  using (public.is_business_member(business_id));

-- ------------------------------------------- abandoned-checkout settings
alter table public.commercial_authority
  add column if not exists abandoned_checkout_enabled boolean not null default true,
  add column if not exists abandoned_checkout_delay_hours integer not null default 24
    check (abandoned_checkout_delay_hours between 1 and 336),
  add column if not exists abandoned_checkout_max_nudges integer not null default 2
    check (abandoned_checkout_max_nudges between 0 and 3),
  add column if not exists abandoned_checkout_gap_hours integer not null default 48
    check (abandoned_checkout_gap_hours between 12 and 336);

-- ------------------------------------------------------------ data rights
-- Anonymise (data_rights_scrub, 0124, sets leads.anonymised_at): the email a
-- payment arrived with and the sent URL are cleared in the same transaction.
-- Amounts, currency and outcome stay: they are the workspace's own sales
-- record, the same rule as opportunities. Delete cascades from leads.
create or replace function public.direct_sale_clear_on_anonymise()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.checkout_payments p
     set email = null, reference = null
   where p.business_id = new.business_id and p.lead_id = new.id;
  update public.checkout_attempts a
     set sent_url = '[removed]'
   where a.business_id = new.business_id and a.lead_id = new.id;
  return null;
end
$$;

revoke all on function public.direct_sale_clear_on_anonymise() from public, anon, authenticated;

drop trigger if exists leads_direct_sale_clear_on_anonymise on public.leads;
create trigger leads_direct_sale_clear_on_anonymise
  after update of anonymised_at on public.leads
  for each row when (new.anonymised_at is not null)
  execute function public.direct_sale_clear_on_anonymise();
