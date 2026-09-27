-- =============================================================================
-- 13 — Quote-to-cash schema DRAFT (Phase P1). NOT A MIGRATION.
--
-- A draft for the future migrations 0152 (catalogue + quote settings), 0153
-- (quotes, revisions, lines, approvals, tokens, signatures, events) and 0154
-- (customer invoicing), per docs/revenue-engine/12 §10. Re-list
-- supabase/migrations before turning any part of this into a migration
-- (memory: parallel sessions collide). Depends on 0143 (checkout_payments) and
-- 0144 (opportunities.service_id) being applied first.
--
-- Mirrors the pure TypeScript in src/lib/{catalogue,quotes,esign,invoicing}:
--   * money is BIGINT minor units, percentages are INTEGER basis points,
--     quantities are BIGINT thousandths (quantity_milli) or NUMERIC(12,3);
--   * every price is computed by src/lib/quotes/calculate.ts and stored as a
--     frozen snapshot; the database never computes a price;
--   * the quote state machine is src/lib/quotes/lifecycle.ts (CHECKs below
--     list the same states).
--
-- RLS patterns (docs/revenue-engine/12 §7.1), copied exactly:
--   MEMBER-READ, SERVICE-ROLE-WRITE: enable + force RLS; revoke all from
--     anon, authenticated; grant select to authenticated; one select policy
--     using public.is_business_member(business_id). Writes go through server
--     actions / SECURITY DEFINER RPCs with the service role.
--   SERVER-ONLY: RLS on, revoke all, no policy (quote_access_tokens).
--   IMMUTABLE: triggers raise on UPDATE/DELETE (revisions once frozen, lines,
--     signatures, events, issued invoice items).
--   PUBLIC ACCESS: ONLY via quote_public_view(p_token), a SECURITY DEFINER
--     function that hashes the presented token, looks it up by hash, and
--     returns customer-facing fields only (the frozen render model).
-- =============================================================================

-- ------------------------------------------------------------ quote_settings
-- One row per workspace: how quotes and invoices look and behave. The
-- AUTHORITY (what the AI may do) stays in commercial_authority (0125).
create table if not exists public.quote_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  vat_registered boolean not null default false,
  vat_number text check (vat_number is null or vat_number ~ '^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$'),
  legal_name text check (legal_name is null or length(legal_name) between 1 and 200),
  company_number text check (company_number is null or company_number ~ '^[A-Z0-9]{8}$'),
  address_lines text[] not null default '{}' check (cardinality(address_lines) <= 6),
  validity_days integer not null default 30 check (validity_days between 1 and 365),
  payment_terms_days integer not null default 14 check (payment_terms_days between 0 and 120),
  default_deposit_bps integer check (default_deposit_bps is null or default_deposit_bps between 1 and 10000),
  terms_text text not null default '' check (length(terms_text) <= 20000),
  reminder_offsets integer[] not null default '{-3,0,3,7,14}' check (cardinality(reminder_offsets) <= 10),
  -- Stored discount policy (src/lib/quotes/discount-policy.ts), validated in
  -- TS before every write. Lives here until commercial_authority v2 (0155)
  -- absorbs it; then this column is dropped.
  discount_policy jsonb not null default '{}'::jsonb check (jsonb_typeof(discount_policy) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_settings_vat_number_when_registered
    check (vat_registered or vat_number is null)
);
create trigger quote_settings_set_updated_at before update on public.quote_settings
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------- document counters
-- Numbering: per-workspace prefix + sequence. Duplicates never (UNIQUE on the
-- full number of each document table); gaps allowed (a rolled-back
-- allocation is not reused; numbers are allocated at ISSUE, not at draft).
create table if not exists public.document_counters (
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null check (kind in ('QUOTE','INVOICE','CREDIT_NOTE')),
  prefix text not null check (prefix ~ '^[A-Z0-9][A-Z0-9/-]{0,15}$'),
  next_seq bigint not null default 1 check (next_seq >= 1),
  width integer not null default 5 check (width between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (business_id, kind)
);

-- Atomic allocation: one UPDATE ... RETURNING, so two concurrent issuers get
-- two different numbers. Service role only.
create or replace function public.allocate_document_number(p_business_id uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_seq bigint;
  v_width integer;
begin
  insert into public.document_counters (business_id, kind, prefix)
  values (p_business_id, p_kind, case p_kind when 'QUOTE' then 'Q-' when 'INVOICE' then 'INV-' else 'CN-' end)
  on conflict (business_id, kind) do nothing;

  update public.document_counters
     set next_seq = next_seq + 1, updated_at = now()
   where business_id = p_business_id and kind = p_kind
  returning prefix, next_seq - 1, width into v_prefix, v_seq, v_width;

  return v_prefix || lpad(v_seq::text, v_width, '0');
end;
$$;
revoke all on function public.allocate_document_number(uuid, text) from public, anon, authenticated;

-- --------------------------------------------------------------- catalogue
-- `services` (0002) stays the OFFER. Catalogue items are priced lines under it.
create table if not exists public.catalogue_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  -- The stable id calculate.ts and the AI tools refer to (never the uuid).
  key text not null check (key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$'),
  sku text check (sku is null or length(sku) <= 64),
  name text not null check (length(name) between 1 and 160),
  description text check (description is null or length(description) <= 2000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  charge_type text not null check (charge_type in ('ONE_OFF','RECURRING','USAGE')),
  interval_unit text check (interval_unit in ('WEEK','MONTH','QUARTER','YEAR')),
  interval_count integer check (interval_count between 1 and 12),
  unit text not null check (length(unit) between 1 and 40),
  unit_price_minor bigint not null check (unit_price_minor between 0 and 1000000000000),
  -- INTERNAL (margin). Never returned by quote_public_view.
  cost_price_minor bigint check (cost_price_minor is null or cost_price_minor between 0 and 1000000000000),
  vat_rate text not null check (vat_rate in ('STANDARD','REDUCED','ZERO','EXEMPT','OUTSIDE_SCOPE')),
  tier_mode text check (tier_mode in ('VOLUME','GRADUATED')),
  min_quantity numeric(12,3) check (min_quantity is null or min_quantity > 0),
  max_quantity numeric(12,3) check (max_quantity is null or max_quantity > 0),
  -- [{ id, name, unitPriceDeltaMinor, unitCostDeltaMinor? }], validated in TS.
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 30),
  add_on_item_keys text[] not null default '{}' check (cardinality(add_on_item_keys) <= 30),
  add_on_only boolean not null default false,
  -- commercial_authority.approved_checkout_links[].id, for direct close.
  checkout_link_id text check (checkout_link_id is null or length(checkout_link_id) between 1 and 64),
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalogue_items_key_unique unique (business_id, key),
  constraint catalogue_items_interval check (
    (charge_type = 'RECURRING' and interval_unit is not null and interval_count is not null)
    or (charge_type <> 'RECURRING' and interval_unit is null and interval_count is null)),
  constraint catalogue_items_quantity_bounds check (
    min_quantity is null or max_quantity is null or min_quantity <= max_quantity)
);
create index if not exists catalogue_items_service_idx on public.catalogue_items (business_id, service_id) where active;
create trigger catalogue_items_set_updated_at before update on public.catalogue_items
  for each row execute function public.set_updated_at();

create table if not exists public.catalogue_price_tiers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_id uuid not null references public.catalogue_items(id) on delete cascade,
  position integer not null check (position between 0 and 19),
  up_to numeric(12,3) check (up_to is null or up_to > 0),
  unit_price_minor bigint not null check (unit_price_minor between 0 and 1000000000000),
  flat_fee_minor bigint not null default 0 check (flat_fee_minor between 0 and 1000000000000),
  constraint catalogue_price_tiers_position_unique unique (item_id, position)
);
create index if not exists catalogue_price_tiers_business_idx on public.catalogue_price_tiers (business_id);

create table if not exists public.catalogue_bundles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  key text not null check (key ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$'),
  name text not null check (length(name) between 1 and 160),
  description text check (description is null or length(description) <= 2000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  pricing_type text not null check (pricing_type in ('FIXED','PERCENT_OFF')),
  fixed_price_minor bigint check (fixed_price_minor is null or fixed_price_minor between 0 and 1000000000000),
  percent_off_bps integer check (percent_off_bps is null or percent_off_bps between 1 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalogue_bundles_key_unique unique (business_id, key),
  constraint catalogue_bundles_pricing check (
    (pricing_type = 'FIXED' and fixed_price_minor is not null and percent_off_bps is null)
    or (pricing_type = 'PERCENT_OFF' and percent_off_bps is not null and fixed_price_minor is null))
);
create trigger catalogue_bundles_set_updated_at before update on public.catalogue_bundles
  for each row execute function public.set_updated_at();

create table if not exists public.catalogue_bundle_items (
  bundle_id uuid not null references public.catalogue_bundles(id) on delete cascade,
  item_id uuid not null references public.catalogue_items(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete cascade,
  position integer not null check (position between 0 and 29),
  quantity numeric(12,3) not null check (quantity > 0),
  primary key (bundle_id, position)
);
create index if not exists catalogue_bundle_items_item_idx on public.catalogue_bundle_items (item_id);

-- ------------------------------------------------------------------ quotes
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- set null, not cascade: a sent quote and its invoices are financial records
  -- (HMRC: keep 6 years); the lead's PII is cleared by quote_clear_on_anonymise.
  lead_id uuid references public.leads(id) on delete set null,
  -- Quotes attach to the opportunity (per interest, 0144), not the lead.
  opportunity_id uuid references public.opportunities(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  number text not null check (length(number) between 1 and 40),
  title text not null check (length(title) between 1 and 200),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Mirrors the current revision (lifecycle.ts QUOTE_STATES).
  status text not null default 'DRAFT' check (status in (
    'DRAFT','PENDING_APPROVAL','APPROVED','SENT','VIEWED','ACCEPTED','SIGNED',
    'DEPOSIT_PAID','PAID','WON','DECLINED','EXPIRED','REVISED','WITHDRAWN')),
  current_revision_id uuid,
  created_by_kind text not null check (created_by_kind in ('AI','HUMAN','API','LEAD_REQUEST')),
  created_by uuid references auth.users(id) on delete set null,
  -- src/lib/quotes/idempotency.ts quoteRequestKey: one quote per request.
  request_key text check (request_key is null or request_key ~ '^quote-request:v1:[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotes_number_unique unique (business_id, number),
  constraint quotes_request_key_unique unique (business_id, request_key)
);
create index if not exists quotes_opportunity_idx on public.quotes (business_id, opportunity_id);
create index if not exists quotes_lead_idx on public.quotes (business_id, lead_id, created_at desc);
create index if not exists quotes_open_idx on public.quotes (business_id, status)
  where status in ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','VIEWED','ACCEPTED');
create trigger quotes_set_updated_at before update on public.quotes
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------- quote_revisions
-- IMMUTABLE once frozen (sent). A change after SENT is a NEW revision; the old
-- one moves to REVISED and its public tokens are revoked.
create table if not exists public.quote_revisions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_no integer not null check (revision_no >= 1),
  status text not null default 'DRAFT' check (status in (
    'DRAFT','PENDING_APPROVAL','APPROVED','SENT','VIEWED','ACCEPTED','SIGNED',
    'DEPOSIT_PAID','PAID','WON','DECLINED','EXPIRED','REVISED','WITHDRAWN')),
  -- The full calculateQuote input incl. a catalogue snapshot, so the figures
  -- can be recomputed and verified (verifyCalculation) forever.
  calc_input jsonb not null check (jsonb_typeof(calc_input) = 'object'),
  calculation jsonb not null check (jsonb_typeof(calculation) = 'object'),
  calc_version text not null check (calc_version ~ '^quote-calc/[0-9]+$'),
  calculation_hash text not null check (calculation_hash ~ '^[0-9a-f]{64}$'),
  -- Frozen at SEND: the customer-facing model (render-model.ts) and its hash.
  render_model jsonb check (render_model is null or jsonb_typeof(render_model) = 'object'),
  render_hash text check (render_hash is null or render_hash ~ '^[0-9a-f]{64}$'),
  pdf_object_key text check (pdf_object_key is null or pdf_object_key ~ '^quotes/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
  one_off_gross_minor bigint not null check (one_off_gross_minor >= 0),
  total_net_minor bigint not null check (total_net_minor >= 0),
  total_vat_minor bigint not null check (total_vat_minor >= 0),
  total_gross_minor bigint not null check (total_gross_minor = total_net_minor + total_vat_minor),
  deposit_minor bigint not null default 0 check (deposit_minor >= 0 and deposit_minor <= one_off_gross_minor),
  first_payment_minor bigint not null check (first_payment_minor >= 0),
  margin_bps integer,                       -- INTERNAL
  internal_note text check (internal_note is null or length(internal_note) <= 5000), -- INTERNAL
  ai_rationale text check (ai_rationale is null or length(ai_rationale) <= 5000),     -- INTERNAL
  approval_required boolean not null default false,
  valid_until timestamptz,
  frozen_at timestamptz,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  accepted_at timestamptz,
  signed_at timestamptz,
  superseded_by uuid references public.quote_revisions(id) on delete set null,
  created_by_kind text not null check (created_by_kind in ('AI','HUMAN','API')),
  created_at timestamptz not null default now(),
  constraint quote_revisions_no_unique unique (quote_id, revision_no),
  constraint quote_revisions_frozen_has_render check (frozen_at is null or (render_model is not null and render_hash is not null)),
  constraint quote_revisions_signed_is_frozen check (signed_at is null or frozen_at is not null)
);
create index if not exists quote_revisions_quote_idx on public.quote_revisions (quote_id, revision_no desc);
create index if not exists quote_revisions_expiry_idx on public.quote_revisions (valid_until)
  where status in ('PENDING_APPROVAL','APPROVED','SENT','VIEWED');

alter table public.quotes
  add constraint quotes_current_revision_fk foreign key (current_revision_id)
  references public.quote_revisions(id) on delete set null deferrable initially deferred;

-- Guard: nothing priced or shown changes once frozen; nothing but the
-- post-signature status changes once signed; a frozen revision is never deleted.
create or replace function public.quote_revisions_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.frozen_at is not null then
      raise exception 'quote revision % is frozen and cannot be deleted', old.id using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.frozen_at is not null then
    if new.calc_input is distinct from old.calc_input
       or new.calculation is distinct from old.calculation
       or new.calculation_hash is distinct from old.calculation_hash
       or new.calc_version is distinct from old.calc_version
       or new.render_model is distinct from old.render_model
       or new.render_hash is distinct from old.render_hash
       or new.one_off_gross_minor is distinct from old.one_off_gross_minor
       or new.total_net_minor is distinct from old.total_net_minor
       or new.total_vat_minor is distinct from old.total_vat_minor
       or new.total_gross_minor is distinct from old.total_gross_minor
       or new.deposit_minor is distinct from old.deposit_minor
       or new.first_payment_minor is distinct from old.first_payment_minor
       or new.margin_bps is distinct from old.margin_bps
       or new.valid_until is distinct from old.valid_until
       or new.frozen_at is distinct from old.frozen_at
       or new.quote_id is distinct from old.quote_id
       or new.business_id is distinct from old.business_id
       or new.revision_no is distinct from old.revision_no then
      raise exception 'quote revision % was sent; issue a new revision instead', old.id using errcode = 'P0001';
    end if;
    -- PDF key may be written once (render job), never replaced.
    if old.pdf_object_key is not null and new.pdf_object_key is distinct from old.pdf_object_key then
      raise exception 'quote revision % PDF is already rendered', old.id using errcode = 'P0001';
    end if;
  end if;

  if old.status in ('SIGNED','DEPOSIT_PAID','PAID','WON') then
    if new.status not in ('SIGNED','DEPOSIT_PAID','PAID','WON')
       or new.signed_at is distinct from old.signed_at
       or new.accepted_at is distinct from old.accepted_at
       or new.superseded_by is distinct from old.superseded_by
       or new.internal_note is distinct from old.internal_note then
      raise exception 'quote revision % is signed; nothing changes', old.id using errcode = 'P0001';
    end if;
  end if;

  if old.status in ('WON','DECLINED','EXPIRED','REVISED','WITHDRAWN') and new.status is distinct from old.status then
    raise exception 'quote revision % is in terminal state %', old.id, old.status using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger quote_revisions_guard before update or delete on public.quote_revisions
  for each row execute function public.quote_revisions_guard();

-- --------------------------------------------------------- quote_line_items
create table if not exists public.quote_line_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  revision_id uuid not null references public.quote_revisions(id) on delete cascade,
  position integer not null check (position between 0 and 999),
  line_key text not null check (length(line_key) between 1 and 90),
  source_line_key text not null check (length(source_line_key) between 1 and 80),
  parent_line_key text,
  item_id uuid references public.catalogue_items(id) on delete set null,
  item_key text not null,
  bundle_key text,
  description text not null check (length(description) between 1 and 500),
  unit text not null,
  charge_type text not null check (charge_type in ('ONE_OFF','RECURRING','USAGE')),
  interval_unit text check (interval_unit in ('WEEK','MONTH','QUARTER','YEAR')),
  interval_count integer check (interval_count between 1 and 12),
  quantity_milli bigint not null check (quantity_milli > 0),
  unit_price_minor bigint check (unit_price_minor is null or unit_price_minor >= 0),
  list_minor bigint not null check (list_minor >= 0),
  bundle_discount_minor bigint not null default 0 check (bundle_discount_minor >= 0),
  line_discount_minor bigint not null default 0 check (line_discount_minor >= 0),
  line_discount_bps integer check (line_discount_bps is null or line_discount_bps between 0 and 10000),
  quote_discount_minor bigint not null default 0 check (quote_discount_minor >= 0),
  net_minor bigint not null check (net_minor >= 0),
  vat_rate text not null check (vat_rate in ('STANDARD','REDUCED','ZERO','EXEMPT','OUTSIDE_SCOPE')),
  vat_bps integer not null check (vat_bps between 0 and 10000),
  vat_minor bigint not null check (vat_minor >= 0),
  gross_minor bigint not null,
  cost_minor bigint,       -- INTERNAL
  margin_minor bigint,     -- INTERNAL
  constraint quote_line_items_position_unique unique (revision_id, position),
  constraint quote_line_items_key_unique unique (revision_id, line_key),
  constraint quote_line_items_net check (net_minor = list_minor - bundle_discount_minor - line_discount_minor - quote_discount_minor),
  constraint quote_line_items_gross check (gross_minor = net_minor + vat_minor)
);
create index if not exists quote_line_items_item_idx on public.quote_line_items (business_id, item_id);

create or replace function public.quote_line_items_guard()
returns trigger
language plpgsql
as $$
declare
  v_frozen timestamptz;
begin
  select frozen_at into v_frozen from public.quote_revisions
   where id = coalesce(new.revision_id, old.revision_id);
  if v_frozen is not null then
    raise exception 'quote lines of a sent revision are immutable' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger quote_line_items_guard before insert or update or delete on public.quote_line_items
  for each row execute function public.quote_line_items_guard();

-- ---------------------------------------------------------- quote_approvals
create table if not exists public.quote_approvals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_id uuid not null references public.quote_revisions(id) on delete cascade,
  required_role text not null check (required_role in ('admin','owner')),
  reason text not null check (reason in ('APPROVAL_THRESHOLD','MARGIN_FLOOR','TWO_STEP_ESCALATION','MANUAL')),
  matched_rule_ids text[] not null default '{}',
  decision text not null default 'PENDING' check (decision in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  requested_by_kind text not null check (requested_by_kind in ('AI','HUMAN','API')),
  requested_by uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 2000),
  created_at timestamptz not null default now(),
  constraint quote_approvals_decided check (decision = 'CANCELLED' or ((decision = 'PENDING') = (decided_at is null)))
);
create unique index if not exists quote_approvals_one_pending_idx
  on public.quote_approvals (revision_id) where decision = 'PENDING';
create index if not exists quote_approvals_inbox_idx on public.quote_approvals (business_id, decision, created_at desc);

-- ------------------------------------------------------ quote_access_tokens
-- SERVER-ONLY. The raw token never touches the database: only its SHA-256.
create table if not exists public.quote_access_tokens (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_id uuid not null references public.quote_revisions(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  purpose text not null default 'VIEW_AND_SIGN' check (purpose in ('VIEW_AND_SIGN','VIEW_ONLY')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  created_at timestamptz not null default now(),
  constraint quote_access_tokens_hash_unique unique (token_hash)
);
create index if not exists quote_access_tokens_revision_idx on public.quote_access_tokens (revision_id) where revoked_at is null;

-- Revocation on revision: superseding a revision revokes its live tokens.
create or replace function public.quote_revisions_revoke_tokens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('REVISED','WITHDRAWN') and old.status is distinct from new.status then
    update public.quote_access_tokens set revoked_at = now()
     where revision_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;
create trigger quote_revisions_revoke_tokens after update of status on public.quote_revisions
  for each row execute function public.quote_revisions_revoke_tokens();

-- --------------------------------------------------------- quote_signatures
-- A simple electronic signature (src/lib/esign). One per revision. Append-only.
create table if not exists public.quote_signatures (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_id uuid not null references public.quote_revisions(id) on delete restrict,
  signature_type text not null default 'SIMPLE_ELECTRONIC_SIGNATURE'
    check (signature_type = 'SIMPLE_ELECTRONIC_SIGNATURE'),
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  calculation_hash text not null check (calculation_hash ~ '^[0-9a-f]{64}$'),
  signer_name text,            -- cleared on anonymise
  signer_email text,           -- cleared on anonymise
  signer_title text,
  email_verified_at timestamptz,
  method text not null check (method in ('TYPED','DRAWN','TYPED_AND_DRAWN')),
  typed_name text,
  drawn_format text check (drawn_format in ('SVG_PATH','PNG_DATA_URL')),
  drawn_data text check (drawn_data is null or length(drawn_data) <= 200000),
  drawn_sha256 text check (drawn_sha256 is null or drawn_sha256 ~ '^[0-9a-f]{64}$'),
  consent_given boolean not null check (consent_given),
  consent_text text not null,
  consent_sha256 text not null check (consent_sha256 ~ '^[0-9a-f]{64}$'),
  consent_version text not null,
  ip inet,
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  signed_at timestamptz not null,
  audit_trail jsonb not null check (jsonb_typeof(audit_trail) = 'array'),
  record_hash text not null check (record_hash ~ '^[0-9a-f]{64}$'),
  anonymised_at timestamptz,
  created_at timestamptz not null default now(),
  constraint quote_signatures_revision_unique unique (revision_id),
  constraint quote_signatures_has_mark check (typed_name is not null or drawn_data is not null or anonymised_at is not null)
);
create index if not exists quote_signatures_quote_idx on public.quote_signatures (business_id, quote_id);

-- --------------------------------------------------------------- quote_events
-- Append-only timeline + automation source. action_key makes accept / sign /
-- pay idempotent on (revision, action) (idempotency.ts quoteActionKey).
create table if not exists public.quote_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_id uuid references public.quote_revisions(id) on delete cascade,
  event_type text not null check (event_type in (
    'quote.requested','quote.created','quote.approval_requested','quote.approved',
    'quote.sent','quote.viewed','quote.accepted','quote.declined','quote.expired',
    'quote.signed','quote.approval_rejected','quote.revised','quote.withdrawn',
    'quote.deposit_paid','quote.paid','quote.won','quote.reminded')),
  actor_kind text not null check (actor_kind in ('AI','HUMAN','CUSTOMER','SYSTEM','API')),
  actor_id uuid references auth.users(id) on delete set null,
  action_key text check (action_key is null or action_key ~ '^quote-action:v1:[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  occurred_at timestamptz not null default now(),
  constraint quote_events_action_key_unique unique (action_key)
);
create index if not exists quote_events_quote_idx on public.quote_events (quote_id, occurred_at);
create index if not exists quote_events_type_idx on public.quote_events (business_id, event_type, occurred_at desc);

-- Acceptance evidence (accept / decline by the customer), separate from the
-- signature so a decline or an accept-then-sign has its own record.
create table if not exists public.quote_acceptance_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_id uuid not null references public.quote_revisions(id) on delete restrict,
  action text not null check (action in ('ACCEPT','DECLINE')),
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  actor_email text,
  decline_reason text check (decline_reason is null or length(decline_reason) <= 2000),
  ip inet,
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  occurred_at timestamptz not null default now(),
  constraint quote_acceptance_events_once unique (revision_id, action)
);

-- Append-only guard shared by signatures, events and acceptance events.
-- (Anonymisation runs as a SECURITY DEFINER function that sets
-- app.allow_anonymise = 'on' for its own transaction and only nulls PII.)
create or replace function public.forbid_update_delete()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and current_setting('app.allow_anonymise', true) = 'on' then
    return new;
  end if;
  raise exception '% rows are append-only', tg_table_name using errcode = 'P0001';
end;
$$;
create trigger quote_signatures_append_only before update or delete on public.quote_signatures
  for each row execute function public.forbid_update_delete();
create trigger quote_events_append_only before update or delete on public.quote_events
  for each row execute function public.forbid_update_delete();
create trigger quote_acceptance_events_append_only before update or delete on public.quote_acceptance_events
  for each row execute function public.forbid_update_delete();

-- --------------------------------------------------------- payment schedule
create table if not exists public.payment_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  revision_id uuid not null references public.quote_revisions(id) on delete restrict,
  seq integer not null check (seq between 1 and 40),
  kind text not null check (kind in ('DEPOSIT','BALANCE','INSTALMENT','FULL')),
  due_rule jsonb not null check (jsonb_typeof(due_rule) = 'object'),
  due_date date,
  gross_minor bigint not null check (gross_minor > 0),
  net_minor bigint not null check (net_minor >= 0),
  vat_minor bigint not null check (vat_minor >= 0),
  vat_by_rate jsonb not null default '[]'::jsonb check (jsonb_typeof(vat_by_rate) = 'array'),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','INVOICED','PAID','CANCELLED')),
  invoice_id uuid,
  created_at timestamptz not null default now(),
  constraint payment_schedules_seq_unique unique (revision_id, seq),
  constraint payment_schedules_amounts check (gross_minor = net_minor + vat_minor)
);
create index if not exists payment_schedules_due_idx on public.payment_schedules (business_id, due_date) where status = 'SCHEDULED';

-- ----------------------------------------------------------------- invoices
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete set null,
  revision_id uuid references public.quote_revisions(id) on delete restrict,
  lead_id uuid references public.leads(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  kind text not null check (kind in ('DEPOSIT','BALANCE','INSTALMENT','FULL','RECURRING')),
  status text not null default 'DRAFT' check (status in ('DRAFT','OPEN','PARTIALLY_PAID','PAID','VOID','UNCOLLECTIBLE')),
  number text check (number is null or length(number) between 1 and 40),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  vat_registered boolean not null,
  -- Snapshots at issue (HMRC fields must not change if settings change later).
  seller jsonb not null check (jsonb_typeof(seller) = 'object'),
  buyer jsonb not null check (jsonb_typeof(buyer) = 'object'),
  issue_date date,
  supply_date date,
  due_date date,
  period_start date,
  schedule_seq integer,
  net_minor bigint not null check (net_minor >= 0),
  vat_minor bigint not null check (vat_minor >= 0),
  total_minor bigint not null check (total_minor = net_minor + vat_minor),
  vat_by_rate jsonb not null default '[]'::jsonb check (jsonb_typeof(vat_by_rate) = 'array'),
  vat_total_gbp_minor bigint check (vat_total_gbp_minor is null or vat_total_gbp_minor >= 0),
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  credited_minor bigint not null default 0 check (credited_minor >= 0),
  idempotency_key text not null check (idempotency_key ~ '^invoice:v1:[0-9a-f]{64}$'),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_number_unique unique (business_id, number),
  constraint invoices_idempotency_unique unique (business_id, idempotency_key),
  constraint invoices_paid_bounds check (paid_minor <= total_minor),
  constraint invoices_credit_bounds check (credited_minor <= paid_minor),
  constraint invoices_issued_fields check (status = 'DRAFT' or status = 'VOID' or (number is not null and issue_date is not null and due_date is not null)),
  constraint invoices_no_vat_unless_registered check (vat_registered or (vat_minor = 0 and jsonb_array_length(vat_by_rate) = 0)),
  constraint invoices_status_matches_paid check (
    status not in ('OPEN','PARTIALLY_PAID','PAID')
    or (status = 'OPEN' and paid_minor = 0)
    or (status = 'PARTIALLY_PAID' and paid_minor > 0 and paid_minor < total_minor)
    or (status = 'PAID' and paid_minor = total_minor))
);
create index if not exists invoices_due_idx on public.invoices (business_id, due_date) where status in ('OPEN','PARTIALLY_PAID');
create index if not exists invoices_quote_idx on public.invoices (business_id, quote_id);
create trigger invoices_set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.payment_schedules
  add constraint payment_schedules_invoice_fk foreign key (invoice_id) references public.invoices(id) on delete set null;

-- Once issued, the number and every amount/snapshot are fixed.
create or replace function public.invoices_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      raise exception 'issued invoice % cannot be deleted; void or credit it', old.id using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status <> 'DRAFT' then
    if new.number is distinct from old.number
       or new.net_minor is distinct from old.net_minor
       or new.vat_minor is distinct from old.vat_minor
       or new.total_minor is distinct from old.total_minor
       or new.vat_by_rate is distinct from old.vat_by_rate
       or new.seller is distinct from old.seller
       or new.buyer is distinct from old.buyer
       or new.issue_date is distinct from old.issue_date
       or new.currency is distinct from old.currency then
      raise exception 'issued invoice % is immutable; issue a credit note', old.id using errcode = 'P0001';
    end if;
    if old.status = 'VOID' then
      raise exception 'void invoice % cannot change', old.id using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger invoices_guard before update or delete on public.invoices
  for each row execute function public.invoices_guard();

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  position integer not null check (position between 0 and 999),
  description text not null check (length(description) between 1 and 500),
  quantity_milli bigint not null check (quantity_milli > 0),
  unit_net_minor bigint check (unit_net_minor is null or unit_net_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  discount_bps integer check (discount_bps is null or discount_bps between 0 and 10000),
  net_minor bigint not null check (net_minor >= 0),
  vat_rate text not null check (vat_rate in ('STANDARD','REDUCED','ZERO','EXEMPT','OUTSIDE_SCOPE')),
  vat_bps integer not null check (vat_bps between 0 and 10000),
  vat_minor bigint not null check (vat_minor >= 0),
  gross_minor bigint not null,
  apportioned boolean not null default false,
  constraint invoice_items_position_unique unique (invoice_id, position),
  constraint invoice_items_gross check (gross_minor = net_minor + vat_minor)
);

create or replace function public.invoice_items_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is distinct from 'DRAFT' then
    raise exception 'lines of an issued invoice are immutable' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger invoice_items_guard before insert or update or delete on public.invoice_items
  for each row execute function public.invoice_items_guard();

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  provider text not null check (provider in ('stripe','manual','bank_transfer','other')),
  external_payment_id text not null check (length(external_payment_id) between 1 and 200),
  amount_minor bigint not null check (amount_minor > 0),
  received_at timestamptz not null,
  -- 0143 confirmation row, when collected through the customer's Stripe.
  checkout_payment_id uuid references public.checkout_payments(id) on delete set null,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invoice_payments_external_unique unique (business_id, provider, external_payment_id)
);
create index if not exists invoice_payments_invoice_idx on public.invoice_payments (invoice_id);

create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  number text not null check (length(number) between 1 and 40),
  amount_minor bigint not null check (amount_minor > 0),
  net_minor bigint not null check (net_minor >= 0),
  vat_minor bigint not null check (vat_minor >= 0),
  vat_by_rate jsonb not null default '[]'::jsonb check (jsonb_typeof(vat_by_rate) = 'array'),
  reason text not null check (length(reason) between 1 and 2000),
  idempotency_key text not null check (idempotency_key ~ '^credit-note:v1:[0-9a-f]{64}$'),
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  constraint credit_notes_number_unique unique (business_id, number),
  constraint credit_notes_idempotency_unique unique (business_id, idempotency_key),
  constraint credit_notes_amounts check (amount_minor = net_minor + vat_minor)
);
create trigger credit_notes_append_only before update or delete on public.credit_notes
  for each row execute function public.forbid_update_delete();

-- Credits never exceed what was paid: checked with the invoice row locked,
-- then credited_minor kept in step (invoices_credit_bounds re-checks).
create or replace function public.credit_notes_within_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
begin
  select * into v_inv from public.invoices where id = new.invoice_id for update;
  if v_inv.business_id <> new.business_id then
    raise exception 'credit note business mismatch' using errcode = 'P0001';
  end if;
  if v_inv.status in ('DRAFT','VOID') then
    raise exception 'credit notes apply to issued invoices only' using errcode = 'P0001';
  end if;
  if v_inv.credited_minor + new.amount_minor > v_inv.paid_minor then
    raise exception 'credit of % exceeds the % paid less % already credited',
      new.amount_minor, v_inv.paid_minor, v_inv.credited_minor using errcode = 'P0001';
  end if;
  update public.invoices set credited_minor = credited_minor + new.amount_minor where id = new.invoice_id;
  return new;
end;
$$;
create trigger credit_notes_within_paid before insert on public.credit_notes
  for each row execute function public.credit_notes_within_paid();

create table if not exists public.invoice_reminders (
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  step integer not null check (step between 1 and 20),
  outcome text not null check (outcome in ('SENT','SKIPPED','SUPPRESSED')),
  occurred_at timestamptz not null default now(),
  primary key (invoice_id, step)
);

-- ================================================================== RLS
-- MEMBER-READ, SERVICE-ROLE-WRITE on every tenant table except the tokens.
do $$
declare
  t text;
begin
  foreach t in array array[
    'quote_settings','document_counters','catalogue_items','catalogue_price_tiers',
    'catalogue_bundles','catalogue_bundle_items','quotes','quote_revisions',
    'quote_line_items','quote_approvals','quote_signatures','quote_events',
    'quote_acceptance_events','payment_schedules','invoices','invoice_items',
    'invoice_payments','credit_notes','invoice_reminders'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_business_member(business_id))',
      t || '_select_member', t);
  end loop;
end;
$$;

-- Columns a browser client must never read even as a member: internal cost,
-- margin, notes and AI rationale. Members read quotes through a redacted
-- view; the base-table grant is column-restricted instead of table-wide.
revoke select on public.quote_revisions from authenticated;
grant select (id, business_id, quote_id, revision_no, status, calc_version, calculation_hash,
              render_model, render_hash, pdf_object_key, one_off_gross_minor, total_net_minor,
              total_vat_minor, total_gross_minor, deposit_minor, first_payment_minor,
              approval_required, valid_until, frozen_at, sent_at, first_viewed_at,
              accepted_at, signed_at, superseded_by, created_by_kind, created_at)
  on public.quote_revisions to authenticated;
revoke select on public.quote_line_items from authenticated;
grant select (id, business_id, revision_id, position, line_key, source_line_key, parent_line_key,
              item_id, item_key, bundle_key, description, unit, charge_type, interval_unit,
              interval_count, quantity_milli, unit_price_minor, list_minor, bundle_discount_minor,
              line_discount_minor, line_discount_bps, quote_discount_minor, net_minor, vat_rate,
              vat_bps, vat_minor, gross_minor)
  on public.quote_line_items to authenticated;
-- Margin and cost are read by owner/admin through a service-role server
-- action (the quote detail page), never by a browser query.

-- SERVER-ONLY: tokens have no policy and no grant.
alter table public.quote_access_tokens enable row level security;
alter table public.quote_access_tokens force row level security;
revoke all on public.quote_access_tokens from anon, authenticated;

-- ============================================================ public access
-- The ONLY way an anonymous visitor reaches a quote. The presented token is
-- hashed here (never stored or compared raw); every failure returns NULL so a
-- wrong, expired, revoked or superseded token are indistinguishable.
-- Returns customer-facing fields only: the frozen render model (which has no
-- cost, margin, note or AI field by construction) plus status and validity.
create or replace function public.quote_public_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_tok public.quote_access_tokens%rowtype;
  v_rev public.quote_revisions%rowtype;
  v_current uuid;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43,128}$' then
    return null;
  end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  select * into v_tok from public.quote_access_tokens where token_hash = v_hash;
  if not found or v_tok.revoked_at is not null or v_tok.expires_at <= now() then
    return null;
  end if;

  select current_revision_id into v_current from public.quotes where id = v_tok.quote_id;
  if v_current is distinct from v_tok.revision_id then
    return null;
  end if;

  select * into v_rev from public.quote_revisions where id = v_tok.revision_id;
  if v_rev.frozen_at is null or v_rev.render_model is null then
    return null;
  end if;

  update public.quote_access_tokens
     set last_viewed_at = now(), view_count = view_count + 1
   where id = v_tok.id;

  return jsonb_build_object(
    'revision_id', v_rev.id,
    'status', case
                when v_rev.status in ('SENT','VIEWED','PENDING_APPROVAL','APPROVED')
                     and v_rev.valid_until is not null and v_rev.valid_until < now() then 'EXPIRED'
                else v_rev.status end,
    'valid_until', v_rev.valid_until,
    'render_model', v_rev.render_model,
    'render_hash', v_rev.render_hash,
    'can_sign', v_tok.purpose = 'VIEW_AND_SIGN'
                and v_rev.status in ('SENT','VIEWED','ACCEPTED')
                and (v_rev.valid_until is null or v_rev.valid_until >= now())
  );
end;
$$;
revoke all on function public.quote_public_view(text) from public;
grant execute on function public.quote_public_view(text) to anon, authenticated;

-- ======================================================= state transitions
-- Every quote state change goes through one RPC that locks the quote row,
-- checks the expected status (optimistic concurrency) and records the event
-- with its action key (idempotent). The TS lifecycle (lifecycle.ts) decides
-- legality first; this re-checks the table so a bypass cannot skip a state.
create or replace function public.quote_transition(
  p_quote_id uuid,
  p_action text,
  p_expected_status text,
  p_actor_kind text,
  p_action_key text,
  p_event_type text,
  p_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes%rowtype;
  v_to text;
begin
  if p_action_key is not null and exists (select 1 from public.quote_events where action_key = p_action_key) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;
  if v_quote.status <> p_expected_status then
    return jsonb_build_object('ok', false, 'reason', 'STALE', 'status', v_quote.status);
  end if;

  v_to := case v_quote.status || '|' || p_action
    when 'DRAFT|SUBMIT_FOR_APPROVAL' then 'PENDING_APPROVAL'
    when 'DRAFT|SEND' then 'SENT'
    when 'DRAFT|REVISE' then 'REVISED'
    when 'DRAFT|WITHDRAW' then 'WITHDRAWN'
    when 'PENDING_APPROVAL|APPROVE' then 'APPROVED'
    when 'PENDING_APPROVAL|REJECT_APPROVAL' then 'DRAFT'
    when 'PENDING_APPROVAL|EXPIRE' then 'EXPIRED'
    when 'PENDING_APPROVAL|REVISE' then 'REVISED'
    when 'PENDING_APPROVAL|WITHDRAW' then 'WITHDRAWN'
    when 'APPROVED|SEND' then 'SENT'
    when 'APPROVED|EXPIRE' then 'EXPIRED'
    when 'APPROVED|REVISE' then 'REVISED'
    when 'APPROVED|WITHDRAW' then 'WITHDRAWN'
    when 'SENT|MARK_VIEWED' then 'VIEWED'
    when 'SENT|ACCEPT' then 'ACCEPTED'
    when 'SENT|DECLINE' then 'DECLINED'
    when 'SENT|EXPIRE' then 'EXPIRED'
    when 'SENT|REVISE' then 'REVISED'
    when 'SENT|WITHDRAW' then 'WITHDRAWN'
    when 'VIEWED|MARK_VIEWED' then 'VIEWED'
    when 'VIEWED|ACCEPT' then 'ACCEPTED'
    when 'VIEWED|DECLINE' then 'DECLINED'
    when 'VIEWED|EXPIRE' then 'EXPIRED'
    when 'VIEWED|REVISE' then 'REVISED'
    when 'VIEWED|WITHDRAW' then 'WITHDRAWN'
    when 'ACCEPTED|SIGN' then 'SIGNED'
    when 'ACCEPTED|DECLINE' then 'DECLINED'
    when 'SIGNED|RECORD_DEPOSIT_PAID' then 'DEPOSIT_PAID'
    when 'SIGNED|RECORD_PAID' then 'PAID'
    when 'SIGNED|MARK_WON' then 'WON'
    when 'DEPOSIT_PAID|RECORD_PAID' then 'PAID'
    when 'DEPOSIT_PAID|MARK_WON' then 'WON'
    when 'PAID|MARK_WON' then 'WON'
    else null end;
  if v_to is null then
    return jsonb_build_object('ok', false, 'reason', 'ILLEGAL_TRANSITION');
  end if;

  update public.quotes set status = v_to where id = p_quote_id;
  update public.quote_revisions set status = v_to where id = v_quote.current_revision_id;
  if p_event_type is not null then
    insert into public.quote_events (business_id, quote_id, revision_id, event_type, actor_kind, action_key, detail)
    values (v_quote.business_id, p_quote_id, v_quote.current_revision_id, p_event_type, p_actor_kind, p_action_key, p_detail);
  end if;
  return jsonb_build_object('ok', true, 'from', v_quote.status, 'to', v_to);
end;
$$;
revoke all on function public.quote_transition(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;

-- ============================================================ data rights
-- On leads.anonymised_at (0134/0143 pattern): clear signer PII, keep the
-- hashes (the evidence that *a* signature matched *that* document survives).
create or replace function public.quote_clear_on_anonymise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.anonymised_at is not null and old.anonymised_at is null then
    perform set_config('app.allow_anonymise', 'on', true);
    update public.quote_signatures s
       set signer_name = null, signer_email = null, signer_title = null, typed_name = null,
           drawn_data = null, ip = null, user_agent = null, anonymised_at = now()
      from public.quotes q
     where q.id = s.quote_id and q.lead_id = new.id and s.anonymised_at is null;
    update public.quote_acceptance_events a
       set actor_email = null, ip = null, user_agent = null
      from public.quotes q
     where q.id = a.quote_id and q.lead_id = new.id;
    perform set_config('app.allow_anonymise', 'off', true);
  end if;
  return new;
end;
$$;
revoke all on function public.quote_clear_on_anonymise() from public, anon, authenticated;
create trigger leads_quote_clear_on_anonymise after update of anonymised_at on public.leads
  for each row execute function public.quote_clear_on_anonymise();
