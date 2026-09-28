-- 0173: invoice pay links and automatic settlement (quote -> pay).
--
-- The workspace is the merchant of record on ITS OWN Stripe account
-- (CLAUDE.md, Resolved conflict 8): no Stripe Connect, no funds held by
-- ClientTurn. The workspace pastes a Payment Link it made in its own Stripe
-- dashboard; ClientTurn sends it with one opaque per-invoice token
-- (client_reference_id on buy.stripe.com, ct_ref otherwise -- the same
-- mechanism as tracked checkout links, 0143) and reads the payment result
-- through the existing payments webhook -> webhook_events -> payment.confirm.
--
-- 1. quote_settings: how invoices are paid (bank transfer only / one
--    workspace link / a link pasted per invoice).
-- 2. invoices: the pay token (set when the invoice is issued, never changed)
--    and the optional per-invoice link.
-- 3. checkout_payments: which invoice a payment settled or is under review
--    for, why a person should look at it, and the PaymentIntent a later
--    refund or dispute names; match_kind gains 'INVOICE'.
--
-- No new table. RLS and grants are re-asserted to the 0152 / 0154 / 0168
-- shape (members read, only the service role writes); new columns inherit
-- the table-level SELECT. Idempotent.

-- ============================================================ quote_settings
alter table public.quote_settings
  add column if not exists invoice_pay_mode text not null default 'NONE',
  add column if not exists invoice_pay_link_url text;

alter table public.quote_settings drop constraint if exists quote_settings_invoice_pay_mode_check;
alter table public.quote_settings
  add constraint quote_settings_invoice_pay_mode_check
  check (invoice_pay_mode in ('NONE', 'WORKSPACE_LINK', 'PER_INVOICE'));

alter table public.quote_settings drop constraint if exists quote_settings_invoice_pay_link_url_check;
alter table public.quote_settings
  add constraint quote_settings_invoice_pay_link_url_check
  check (invoice_pay_link_url is null
         or (invoice_pay_link_url ~ '^https://' and char_length(invoice_pay_link_url) <= 2000));

alter table public.quote_settings drop constraint if exists quote_settings_invoice_pay_link_required;
alter table public.quote_settings
  add constraint quote_settings_invoice_pay_link_required
  check (invoice_pay_mode <> 'WORKSPACE_LINK' or invoice_pay_link_url is not null);

-- ================================================================== invoices
alter table public.invoices
  add column if not exists pay_token text,
  add column if not exists pay_link_url text;

alter table public.invoices drop constraint if exists invoices_pay_token_format;
alter table public.invoices
  add constraint invoices_pay_token_format
  check (pay_token is null or pay_token ~ '^[A-Za-z0-9_-]{16,64}$');

alter table public.invoices drop constraint if exists invoices_pay_link_url_check;
alter table public.invoices
  add constraint invoices_pay_link_url_check
  check (pay_link_url is null or (pay_link_url ~ '^https://' and char_length(pay_link_url) <= 2000));

-- A token names one invoice. Lookups are always scoped to the workspace as
-- well; the global uniqueness just means a token can never be ambiguous.
create unique index if not exists invoices_pay_token_unique
  on public.invoices (pay_token) where pay_token is not null;

-- Once a customer may hold a link with the token, it never changes.
create or replace function public.invoices_pay_token_fixed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.pay_token is not null and new.pay_token is distinct from old.pay_token then
    raise exception 'invoice % pay token is fixed once set', old.id using errcode = 'restrict_violation';
  end if;
  return new;
end
$$;
revoke all on function public.invoices_pay_token_fixed() from public, anon, authenticated;
drop trigger if exists invoices_pay_token_fixed on public.invoices;
create trigger invoices_pay_token_fixed
  before update of pay_token on public.invoices
  for each row execute function public.invoices_pay_token_fixed();

-- ========================================================= checkout_payments
alter table public.checkout_payments
  add column if not exists invoice_id uuid,
  add column if not exists review_reason text,
  add column if not exists provider_payment_intent text;

alter table public.checkout_payments drop constraint if exists checkout_payments_invoice_fk;
alter table public.checkout_payments
  add constraint checkout_payments_invoice_fk foreign key (invoice_id)
  references public.invoices(id) on delete set null;

alter table public.checkout_payments drop constraint if exists checkout_payments_review_reason_check;
alter table public.checkout_payments
  add constraint checkout_payments_review_reason_check
  check (review_reason is null or review_reason in (
    'CURRENCY_MISMATCH', 'ZERO_AMOUNT', 'INVOICE_ALREADY_PAID', 'INVOICE_NOT_PAYABLE',
    'OVERPAID', 'REFUNDED', 'DISPUTED'));

alter table public.checkout_payments drop constraint if exists checkout_payments_payment_intent_check;
alter table public.checkout_payments
  add constraint checkout_payments_payment_intent_check
  check (provider_payment_intent is null or char_length(provider_payment_intent) between 1 and 200);

-- match_kind gains 'INVOICE' (0143 declared the check inline, so its name is
-- generated; drop whichever check mentions match_kind, then add a named one).
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.checkout_payments'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%match_kind%'
  loop
    execute format('alter table public.checkout_payments drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.checkout_payments
  add constraint checkout_payments_match_kind_check
  check (match_kind is null or match_kind in ('TOKEN', 'SUBSCRIPTION', 'EMAIL', 'MANUAL', 'INVOICE'));

-- An invoice payment names its invoice.
alter table public.checkout_payments drop constraint if exists checkout_payments_invoice_match;
alter table public.checkout_payments
  add constraint checkout_payments_invoice_match
  check (match_kind is distinct from 'INVOICE' or invoice_id is not null);

create index if not exists checkout_payments_invoice_idx
  on public.checkout_payments (business_id, invoice_id) where invoice_id is not null;
create index if not exists checkout_payments_payment_intent_idx
  on public.checkout_payments (business_id, provider_payment_intent) where provider_payment_intent is not null;

-- ======================================================================== RLS
-- Re-asserted, not changed: members read their workspace's rows; every write
-- is the service role (0152, 0154, 0143 + 0168).
do $$
declare t text;
begin
  foreach t in array array['quote_settings', 'invoices', 'checkout_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
