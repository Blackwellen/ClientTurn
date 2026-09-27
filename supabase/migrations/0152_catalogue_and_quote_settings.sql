-- 0152_catalogue_and_quote_settings: the priced catalogue under `services`
-- (items, price tiers, bundles), the per-workspace quote settings, and the
-- document counters that number quotes, invoices and credit notes.
--
-- Promoted from docs/revenue-engine/13-quote-schema-draft.sql (placement:
-- gap map §4 -- `services` stays the offer; catalogue_items are priced lines
-- under it; commercial_authority stays the AI's authority). Mirrors
-- src/lib/catalogue/* and src/lib/invoicing/numbering.ts: money is BIGINT
-- minor units, percentages INTEGER basis points, quantities NUMERIC(12,3).
-- The database never computes a price (src/lib/quotes/calculate.ts does).
--
-- The counters are here rather than with invoices (0154) because quotes
-- (0153) are numbered from the same function. NOT applied by the author;
-- apply 0150 -> 0154 in order.
--
-- RLS: member-read, service-role write (prices are never browser-writable,
-- gap map §4). Cost columns are withheld from browser roles by column grant:
-- catalogue_items.cost_price_minor, and `options`, whose entries carry a
-- unitCostDeltaMinor. A browser query must name its columns (`select *` is
-- refused); owner/admin read cost through a service-role server action.
--
-- Additive and idempotent.

-- ================================================================ quote_settings
-- One row per workspace: how quotes and invoices look and behave.
create table if not exists public.quote_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  vat_registered boolean not null default false,
  vat_number text check (vat_number is null or vat_number ~ '^GB([0-9]{9}|[0-9]{12}|GD[0-9]{3}|HA[0-9]{3})$'),
  legal_name text check (legal_name is null or char_length(legal_name) between 1 and 200),
  company_number text check (company_number is null or company_number ~ '^[A-Z0-9]{8}$'),
  address_lines text[] not null default '{}' check (cardinality(address_lines) <= 6),
  validity_days integer not null default 30 check (validity_days between 1 and 365),
  payment_terms_days integer not null default 14 check (payment_terms_days between 0 and 120),
  default_deposit_bps integer check (default_deposit_bps is null or default_deposit_bps between 1 and 10000),
  terms_text text not null default '' check (char_length(terms_text) <= 20000),
  reminder_offsets integer[] not null default '{-3,0,3,7,14}' check (cardinality(reminder_offsets) <= 10),
  -- src/lib/quotes/discount-policy.ts, validated in TS before every write.
  discount_policy jsonb not null default '{}'::jsonb check (jsonb_typeof(discount_policy) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_settings_vat_number_when_registered check (vat_registered or vat_number is null)
);
drop trigger if exists quote_settings_set_updated_at on public.quote_settings;
create trigger quote_settings_set_updated_at
  before update on public.quote_settings
  for each row execute function public.set_updated_at();

-- ============================================================= document_counters
-- [SERVER-ONLY] Per-workspace prefix + sequence (numbering.ts). Duplicates
-- never (UNIQUE on each document's full number); gaps allowed (a rolled-back
-- allocation is not reused).
create table if not exists public.document_counters (
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('QUOTE', 'INVOICE', 'CREDIT_NOTE')),
  prefix text not null check (prefix ~ '^[A-Z0-9][A-Z0-9/-]{0,15}$'),
  next_seq bigint not null default 1 check (next_seq >= 1),
  width integer not null default 5 check (width between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (business_id, kind)
);

-- Atomic allocation: one UPDATE ... RETURNING under the row lock, so two
-- concurrent issuers get two different numbers. Service role only.
create or replace function public.allocate_document_number(p_business_id uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_seq bigint;
  v_width integer;
begin
  if p_kind is null or p_kind not in ('QUOTE', 'INVOICE', 'CREDIT_NOTE') then
    raise exception 'unknown document kind %', p_kind using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.businesses b where b.id = p_business_id) then
    raise exception 'no such workspace' using errcode = 'foreign_key_violation';
  end if;

  insert into public.document_counters (business_id, kind, prefix)
  values (p_business_id, p_kind, case p_kind when 'QUOTE' then 'Q-' when 'INVOICE' then 'INV-' else 'CN-' end)
  on conflict (business_id, kind) do nothing;

  update public.document_counters
     set next_seq = next_seq + 1, updated_at = now()
   where business_id = p_business_id and kind = p_kind
  returning prefix, next_seq - 1, width into v_prefix, v_seq, v_width;

  return v_prefix || lpad(v_seq::text, v_width, '0');
end
$$;
revoke all on function public.allocate_document_number(uuid, text) from public, anon, authenticated;
grant execute on function public.allocate_document_number(uuid, text) to service_role;

-- =============================================================== catalogue_items
create table if not exists public.catalogue_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  -- The stable id calculate.ts and the AI tools refer to (never the uuid).
  key text not null check (key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$'),
  sku text check (sku is null or char_length(sku) <= 64),
  name text not null check (char_length(name) between 1 and 160),
  description text check (description is null or char_length(description) <= 2000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  charge_type text not null check (charge_type in ('ONE_OFF', 'RECURRING', 'USAGE')),
  interval_unit text check (interval_unit is null or interval_unit in ('WEEK', 'MONTH', 'QUARTER', 'YEAR')),
  interval_count integer check (interval_count is null or interval_count between 1 and 12),
  unit text not null check (char_length(unit) between 1 and 40),
  unit_price_minor bigint not null check (unit_price_minor between 0 and 1000000000000),
  -- INTERNAL (margin). Withheld from browser roles; never in a render model.
  cost_price_minor bigint check (cost_price_minor is null or cost_price_minor between 0 and 1000000000000),
  vat_rate text not null check (vat_rate in ('STANDARD', 'REDUCED', 'ZERO', 'EXEMPT', 'OUTSIDE_SCOPE')),
  tier_mode text check (tier_mode is null or tier_mode in ('VOLUME', 'GRADUATED')),
  min_quantity numeric(12, 3) check (min_quantity is null or min_quantity > 0),
  max_quantity numeric(12, 3) check (max_quantity is null or max_quantity > 0),
  -- [{ id, name, unitPriceDeltaMinor, unitCostDeltaMinor? }], validated in TS.
  -- Carries cost deltas, so it is withheld from browser roles as well.
  options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 30),
  add_on_item_keys text[] not null default '{}' check (cardinality(add_on_item_keys) <= 30),
  add_on_only boolean not null default false,
  -- commercial_authority.approved_checkout_links[].id, for direct close.
  checkout_link_id text check (checkout_link_id is null or char_length(checkout_link_id) between 1 and 64),
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalogue_items_key_unique unique (business_id, key),
  constraint catalogue_items_id_business_unique unique (id, business_id),
  constraint catalogue_items_interval check (
    (charge_type = 'RECURRING' and interval_unit is not null and interval_count is not null)
    or (charge_type <> 'RECURRING' and interval_unit is null and interval_count is null)),
  constraint catalogue_items_quantity_bounds check (
    min_quantity is null or max_quantity is null or min_quantity <= max_quantity)
);
create index if not exists catalogue_items_service_idx on public.catalogue_items (business_id, service_id) where active;
drop trigger if exists catalogue_items_set_updated_at on public.catalogue_items;
create trigger catalogue_items_set_updated_at
  before update on public.catalogue_items
  for each row execute function public.set_updated_at();

-- ========================================================= catalogue_price_tiers
create table if not exists public.catalogue_price_tiers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_id uuid not null,
  position integer not null check (position between 0 and 19),
  up_to numeric(12, 3) check (up_to is null or up_to > 0),
  unit_price_minor bigint not null check (unit_price_minor between 0 and 1000000000000),
  flat_fee_minor bigint not null default 0 check (flat_fee_minor between 0 and 1000000000000),
  constraint catalogue_price_tiers_position_unique unique (item_id, position),
  constraint catalogue_price_tiers_item_fk foreign key (item_id, business_id)
    references public.catalogue_items(id, business_id) on delete cascade
);
create index if not exists catalogue_price_tiers_business_idx on public.catalogue_price_tiers (business_id);

-- ============================================================= catalogue_bundles
create table if not exists public.catalogue_bundles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  key text not null check (key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$'),
  name text not null check (char_length(name) between 1 and 160),
  description text check (description is null or char_length(description) <= 2000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  pricing_type text not null check (pricing_type in ('FIXED', 'PERCENT_OFF')),
  fixed_price_minor bigint check (fixed_price_minor is null or fixed_price_minor between 0 and 1000000000000),
  percent_off_bps integer check (percent_off_bps is null or percent_off_bps between 1 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalogue_bundles_key_unique unique (business_id, key),
  constraint catalogue_bundles_id_business_unique unique (id, business_id),
  constraint catalogue_bundles_pricing check (
    (pricing_type = 'FIXED' and fixed_price_minor is not null and percent_off_bps is null)
    or (pricing_type = 'PERCENT_OFF' and percent_off_bps is not null and fixed_price_minor is null))
);
drop trigger if exists catalogue_bundles_set_updated_at on public.catalogue_bundles;
create trigger catalogue_bundles_set_updated_at
  before update on public.catalogue_bundles
  for each row execute function public.set_updated_at();

-- An item in a bundle cannot be deleted while the bundle holds it (archive
-- it instead). The check is deferred to commit so that deleting a whole
-- workspace, which removes bundles and items in the same cascade, succeeds
-- whatever order the cascade takes.
create table if not exists public.catalogue_bundle_items (
  bundle_id uuid not null,
  item_id uuid not null,
  business_id uuid not null references public.businesses(id) on delete cascade,
  position integer not null check (position between 0 and 29),
  quantity numeric(12, 3) not null check (quantity > 0),
  primary key (bundle_id, position),
  constraint catalogue_bundle_items_bundle_fk foreign key (bundle_id, business_id)
    references public.catalogue_bundles(id, business_id) on delete cascade,
  constraint catalogue_bundle_items_item_fk foreign key (item_id, business_id)
    references public.catalogue_items(id, business_id) deferrable initially deferred
);
create index if not exists catalogue_bundle_items_item_idx on public.catalogue_bundle_items (item_id);

-- ======================================================================== RLS
do $$
declare t text;
begin
  foreach t in array array[
    'quote_settings', 'catalogue_items', 'catalogue_price_tiers', 'catalogue_bundles', 'catalogue_bundle_items'
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

alter table public.document_counters enable row level security;
alter table public.document_counters force row level security;
revoke all on public.document_counters from anon, authenticated;

-- Cost and cost-bearing options are not readable by browser roles.
revoke select on public.catalogue_items from authenticated;
grant select (id, business_id, service_id, key, sku, name, description, currency, charge_type,
              interval_unit, interval_count, unit, unit_price_minor, vat_rate, tier_mode,
              min_quantity, max_quantity, add_on_item_keys, add_on_only, checkout_link_id,
              active, archived_at, created_at, updated_at)
  on public.catalogue_items to authenticated;
