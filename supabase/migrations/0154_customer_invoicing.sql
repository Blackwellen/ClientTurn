-- 0154_customer_invoicing: invoicing the workspace's own customers from a
-- signed quote. Payment schedules, invoices (immutable once issued), invoice
-- items, payments received, credit notes (never more than was paid) and the
-- reminder log.
--
-- Promoted from docs/revenue-engine/13-quote-schema-draft.sql. Mirrors
-- src/lib/invoicing/* (status.ts, credit-notes.ts, from-quote.ts,
-- vat-invoice.ts, reminders.ts). Invoice and credit-note numbers come from
-- allocate_document_number (0152) at ISSUE, never at draft. This is NOT
-- ClientTurn's own billing (lib/billing/invoices.ts). Depends on 0152, 0153.
-- NOT applied by the author; apply 0150 -> 0154 in order.
--
-- Like quotes, an invoice belongs to the opportunity. An issued invoice is a
-- VAT/accounting record (HMRC: keep 6 years), so erasure keeps it attached
-- to the pseudonymous opportunity; the anonymise trigger removes the
-- buyer's contact e-mail, and keeps the name and address the VAT invoice
-- must carry (UK GDPR Art 17(3)(b), legal obligation).
--
-- Guards refuse a direct statement and let nested work through (an FK
-- cascade from deleting a workspace, the anonymise trigger, the payment and
-- credit triggers below), exactly as in 0153.
--
-- RLS: member-read, service-role write. Additive and idempotent.

-- ============================================================ payment_schedules
create table if not exists public.payment_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null,
  revision_id uuid not null,
  seq integer not null check (seq between 1 and 40),
  kind text not null check (kind in ('DEPOSIT', 'BALANCE', 'INSTALMENT', 'FULL')),
  due_rule jsonb not null check (jsonb_typeof(due_rule) = 'object'),
  due_date date,
  gross_minor bigint not null check (gross_minor > 0),
  net_minor bigint not null check (net_minor >= 0),
  vat_minor bigint not null check (vat_minor >= 0),
  vat_by_rate jsonb not null default '[]'::jsonb check (jsonb_typeof(vat_by_rate) = 'array'),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'INVOICED', 'PAID', 'CANCELLED')),
  invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_schedules_seq_unique unique (revision_id, seq),
  constraint payment_schedules_amounts check (gross_minor = net_minor + vat_minor),
  constraint payment_schedules_quote_fk foreign key (quote_id, business_id)
    references public.quotes(id, business_id) on delete cascade,
  constraint payment_schedules_revision_fk foreign key (revision_id, business_id)
    references public.quote_revisions(id, business_id) deferrable initially deferred
);
create index if not exists payment_schedules_due_idx on public.payment_schedules (business_id, due_date) where status = 'SCHEDULED';
drop trigger if exists payment_schedules_set_updated_at on public.payment_schedules;
create trigger payment_schedules_set_updated_at
  before update on public.payment_schedules
  for each row execute function public.set_updated_at();

-- ====================================================================== invoices
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  opportunity_id uuid not null,
  quote_id uuid references public.quotes(id) on delete set null,
  revision_id uuid,
  kind text not null check (kind in ('DEPOSIT', 'BALANCE', 'INSTALMENT', 'FULL', 'RECURRING')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID', 'UNCOLLECTIBLE')),
  number text check (number is null or char_length(number) between 1 and 40),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  vat_registered boolean not null,
  -- Snapshots at issue: HMRC fields must not change when settings change later.
  seller jsonb not null check (jsonb_typeof(seller) = 'object'),
  buyer jsonb not null check (jsonb_typeof(buyer) = 'object'),
  issue_date date,
  supply_date date,
  due_date date,
  period_start date,
  schedule_seq integer,
  net_minor bigint not null check (net_minor >= 0),
  vat_minor bigint not null check (vat_minor >= 0),
  total_minor bigint not null,
  vat_by_rate jsonb not null default '[]'::jsonb check (jsonb_typeof(vat_by_rate) = 'array'),
  vat_total_gbp_minor bigint check (vat_total_gbp_minor is null or vat_total_gbp_minor >= 0),
  -- Kept in step by the invoice_payments / credit_notes triggers below.
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  credited_minor bigint not null default 0 check (credited_minor >= 0),
  idempotency_key text not null check (idempotency_key ~ '^invoice:v1:[0-9a-f]{64}$'),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_number_unique unique (business_id, number),
  constraint invoices_idempotency_unique unique (business_id, idempotency_key),
  constraint invoices_id_business_unique unique (id, business_id),
  constraint invoices_total check (total_minor = net_minor + vat_minor),
  constraint invoices_paid_bounds check (paid_minor <= total_minor),
  constraint invoices_credit_bounds check (credited_minor <= paid_minor),
  constraint invoices_issued_fields check (
    status in ('DRAFT', 'VOID') or (number is not null and issue_date is not null and due_date is not null)),
  constraint invoices_no_vat_unless_registered check (
    vat_registered or (vat_minor = 0 and jsonb_array_length(vat_by_rate) = 0)),
  constraint invoices_status_matches_paid check (
    status not in ('OPEN', 'PARTIALLY_PAID', 'PAID')
    or (status = 'OPEN' and paid_minor = 0)
    or (status = 'PARTIALLY_PAID' and paid_minor > 0 and paid_minor < total_minor)
    or (status = 'PAID' and paid_minor = total_minor)),
  constraint invoices_opportunity_fk foreign key (opportunity_id)
    references public.opportunities(id) deferrable initially deferred,
  constraint invoices_revision_fk foreign key (revision_id)
    references public.quote_revisions(id) deferrable initially deferred
);
create index if not exists invoices_due_idx on public.invoices (business_id, due_date) where status in ('OPEN', 'PARTIALLY_PAID');
create index if not exists invoices_quote_idx on public.invoices (business_id, quote_id);
create index if not exists invoices_opportunity_idx on public.invoices (business_id, opportunity_id);
drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.payment_schedules drop constraint if exists payment_schedules_invoice_fk;
alter table public.payment_schedules
  add constraint payment_schedules_invoice_fk foreign key (invoice_id)
  references public.invoices(id) on delete set null;

-- Once issued, the number and every amount and snapshot are fixed; an issued
-- invoice is voided or credited, never deleted; a void invoice never changes.
-- The opportunity must be this workspace's.
create or replace function public.invoices_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      raise exception 'issued invoice % cannot be deleted; void or credit it', old.id using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if (tg_op = 'INSERT' or new.opportunity_id is distinct from old.opportunity_id)
     and not exists (select 1 from public.opportunities o
                      where o.id = new.opportunity_id and o.business_id = new.business_id) then
    raise exception 'opportunity % does not belong to workspace %', new.opportunity_id, new.business_id
      using errcode = 'check_violation';
  end if;
  if new.revision_id is not null
     and (tg_op = 'INSERT' or new.revision_id is distinct from old.revision_id)
     and not exists (select 1 from public.quote_revisions r
                      where r.id = new.revision_id and r.business_id = new.business_id) then
    raise exception 'revision % does not belong to workspace %', new.revision_id, new.business_id
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' and old.status <> 'DRAFT' then
    if old.status = 'VOID' then
      raise exception 'void invoice % cannot change', old.id using errcode = 'restrict_violation';
    end if;
    if new.number is distinct from old.number
       or new.net_minor is distinct from old.net_minor
       or new.vat_minor is distinct from old.vat_minor
       or new.total_minor is distinct from old.total_minor
       or new.vat_by_rate is distinct from old.vat_by_rate
       or new.seller is distinct from old.seller
       or new.buyer is distinct from old.buyer
       or new.issue_date is distinct from old.issue_date
       or new.supply_date is distinct from old.supply_date
       or new.currency is distinct from old.currency
       or new.vat_registered is distinct from old.vat_registered
       or new.kind is distinct from old.kind
       or new.opportunity_id is distinct from old.opportunity_id
       or new.revision_id is distinct from old.revision_id
       or new.status = 'DRAFT' then
      raise exception 'issued invoice % is immutable; issue a credit note', old.id using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.invoices_guard() from public, anon, authenticated;
drop trigger if exists invoices_guard on public.invoices;
create trigger invoices_guard
  before insert or update or delete on public.invoices
  for each row execute function public.invoices_guard();

-- ================================================================= invoice_items
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null,
  position integer not null check (position between 0 and 999),
  description text not null check (char_length(description) between 1 and 500),
  quantity_milli bigint not null check (quantity_milli > 0),
  unit_net_minor bigint check (unit_net_minor is null or unit_net_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  discount_bps integer check (discount_bps is null or discount_bps between 0 and 10000),
  net_minor bigint not null check (net_minor >= 0),
  vat_rate text not null check (vat_rate in ('STANDARD', 'REDUCED', 'ZERO', 'EXEMPT', 'OUTSIDE_SCOPE')),
  vat_bps integer not null check (vat_bps between 0 and 10000),
  vat_minor bigint not null check (vat_minor >= 0),
  gross_minor bigint not null,
  apportioned boolean not null default false,
  constraint invoice_items_position_unique unique (invoice_id, position),
  constraint invoice_items_gross check (gross_minor = net_minor + vat_minor),
  constraint invoice_items_invoice_fk foreign key (invoice_id, business_id)
    references public.invoices(id, business_id) on delete cascade
);

create or replace function public.invoice_items_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.invoices i
              where i.id in (new.invoice_id, old.invoice_id) and i.status <> 'DRAFT') then
    raise exception 'lines of an issued invoice are immutable' using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end
$$;
revoke all on function public.invoice_items_guard() from public, anon, authenticated;
drop trigger if exists invoice_items_guard on public.invoice_items;
create trigger invoice_items_guard
  before insert or update or delete on public.invoice_items
  for each row execute function public.invoice_items_guard();

-- ============================================================== invoice_payments
-- Append-only. Each payment moves invoices.paid_minor and the status with the
-- invoice row locked; an overpayment or a payment against a draft or void
-- invoice is refused (the caller keeps it for review, as 0143 does).
create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null,
  provider text not null check (provider in ('stripe', 'manual', 'bank_transfer', 'other')),
  external_payment_id text not null check (char_length(external_payment_id) between 1 and 200),
  amount_minor bigint not null check (amount_minor > 0),
  received_at timestamptz not null,
  -- 0143 confirmation row, when collected through the customer's own Stripe.
  checkout_payment_id uuid references public.checkout_payments(id) on delete set null,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invoice_payments_external_unique unique (business_id, provider, external_payment_id),
  constraint invoice_payments_invoice_fk foreign key (invoice_id, business_id)
    references public.invoices(id, business_id) deferrable initially deferred
);
create index if not exists invoice_payments_invoice_idx on public.invoice_payments (invoice_id);
drop trigger if exists invoice_payments_append_only on public.invoice_payments;
create trigger invoice_payments_append_only
  before update or delete on public.invoice_payments
  for each row when (pg_trigger_depth() = 0)
  execute function public.forbid_update_delete();

create or replace function public.invoice_payments_apply()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.invoices%rowtype;
  v_paid bigint;
begin
  select * into v_inv from public.invoices i
   where i.id = new.invoice_id and i.business_id = new.business_id
   for update;
  if not found then
    raise exception 'invoice % not found in workspace %', new.invoice_id, new.business_id using errcode = 'foreign_key_violation';
  end if;
  if v_inv.status not in ('OPEN', 'PARTIALLY_PAID') then
    raise exception 'invoice % is %; payments apply to open invoices only', v_inv.id, v_inv.status
      using errcode = 'check_violation';
  end if;
  v_paid := v_inv.paid_minor + new.amount_minor;
  if v_paid > v_inv.total_minor then
    raise exception 'payment of % exceeds the % still due on invoice %', new.amount_minor,
      v_inv.total_minor - v_inv.paid_minor, v_inv.id using errcode = 'check_violation';
  end if;
  update public.invoices
     set paid_minor = v_paid,
         status = case when v_paid = v_inv.total_minor then 'PAID' else 'PARTIALLY_PAID' end
   where id = v_inv.id;
  return new;
end
$$;
revoke all on function public.invoice_payments_apply() from public, anon, authenticated;
drop trigger if exists invoice_payments_apply on public.invoice_payments;
create trigger invoice_payments_apply
  before insert on public.invoice_payments
  for each row execute function public.invoice_payments_apply();

-- ================================================================== credit_notes
create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null,
  number text not null check (char_length(number) between 1 and 40),
  amount_minor bigint not null check (amount_minor > 0),
  net_minor bigint not null check (net_minor >= 0),
  vat_minor bigint not null check (vat_minor >= 0),
  vat_by_rate jsonb not null default '[]'::jsonb check (jsonb_typeof(vat_by_rate) = 'array'),
  reason text not null check (char_length(reason) between 1 and 2000),
  idempotency_key text not null check (idempotency_key ~ '^credit-note:v1:[0-9a-f]{64}$'),
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  constraint credit_notes_number_unique unique (business_id, number),
  constraint credit_notes_idempotency_unique unique (business_id, idempotency_key),
  constraint credit_notes_amounts check (amount_minor = net_minor + vat_minor),
  constraint credit_notes_invoice_fk foreign key (invoice_id, business_id)
    references public.invoices(id, business_id) deferrable initially deferred
);
create index if not exists credit_notes_invoice_idx on public.credit_notes (invoice_id);
drop trigger if exists credit_notes_append_only on public.credit_notes;
create trigger credit_notes_append_only
  before update or delete on public.credit_notes
  for each row when (pg_trigger_depth() = 0)
  execute function public.forbid_update_delete();

-- Credits never exceed what was paid (credit-notes.ts creditableMinor):
-- checked with the invoice row locked, then credited_minor moved in step
-- (invoices_credit_bounds re-checks the row).
create or replace function public.credit_notes_within_paid()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.invoices%rowtype;
begin
  select * into v_inv from public.invoices i
   where i.id = new.invoice_id and i.business_id = new.business_id
   for update;
  if not found then
    raise exception 'invoice % not found in workspace %', new.invoice_id, new.business_id using errcode = 'foreign_key_violation';
  end if;
  if v_inv.status in ('DRAFT', 'VOID') then
    raise exception 'credit notes apply to issued invoices only' using errcode = 'check_violation';
  end if;
  if v_inv.credited_minor + new.amount_minor > v_inv.paid_minor then
    raise exception 'credit of % exceeds the % paid less % already credited',
      new.amount_minor, v_inv.paid_minor, v_inv.credited_minor using errcode = 'check_violation';
  end if;
  update public.invoices set credited_minor = credited_minor + new.amount_minor where id = v_inv.id;
  return new;
end
$$;
revoke all on function public.credit_notes_within_paid() from public, anon, authenticated;
drop trigger if exists credit_notes_within_paid on public.credit_notes;
create trigger credit_notes_within_paid
  before insert on public.credit_notes
  for each row execute function public.credit_notes_within_paid();

-- ============================================================= invoice_reminders
create table if not exists public.invoice_reminders (
  invoice_id uuid not null,
  business_id uuid not null references public.businesses(id) on delete cascade,
  step integer not null check (step between 1 and 20),
  outcome text not null check (outcome in ('SENT', 'SKIPPED', 'SUPPRESSED')),
  occurred_at timestamptz not null default now(),
  primary key (invoice_id, step),
  constraint invoice_reminders_invoice_fk foreign key (invoice_id, business_id)
    references public.invoices(id, business_id) on delete cascade
);

-- ======================================================================== RLS
do $$
declare t text;
begin
  foreach t in array array[
    'payment_schedules', 'invoices', 'invoice_items', 'invoice_payments', 'credit_notes', 'invoice_reminders'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_member', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_business_member(business_id))',
      t || '_select_member', t);
  end loop;
end $$;

-- ================================================================ data rights
-- Anonymise: remove the buyer's contact e-mail (and any contact or phone key)
-- from each invoice snapshot of the person's opportunities; the name and
-- address stay because a VAT invoice must show them and must be kept.
create or replace function public.invoice_clear_on_anonymise()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.invoices i
     set buyer = i.buyer - array['email', 'contact', 'contactName', 'phone']
    from public.opportunities o
   where o.id = i.opportunity_id and i.business_id = new.business_id and o.lead_id = new.id
     and i.buyer ?| array['email', 'contact', 'contactName', 'phone'];
  return null;
end
$$;
revoke all on function public.invoice_clear_on_anonymise() from public, anon, authenticated;

drop trigger if exists leads_invoice_clear_on_anonymise on public.leads;
create trigger leads_invoice_clear_on_anonymise
  after update of anonymised_at on public.leads
  for each row when (new.anonymised_at is not null)
  execute function public.invoice_clear_on_anonymise();
