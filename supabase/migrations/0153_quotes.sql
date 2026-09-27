-- 0153_quotes: quotes, immutable revisions and lines, approvals, hashed public
-- access tokens, simple electronic signatures, quote events and acceptance
-- evidence, with the functions quote_public_view (the only anonymous way in),
-- quote_transition and quote_record_signature.
--
-- Promoted from docs/revenue-engine/13-quote-schema-draft.sql. Mirrors
-- src/lib/quotes/* (lifecycle.ts states and transitions, tokens.ts hashing,
-- render-model.ts), src/lib/esign/* (signature record). Depends on 0152.
-- NOT applied by the author; apply 0150 -> 0154 in order.
--
-- A quote belongs to an OPPORTUNITY (per interest, 0144), not to the lead
-- directly (gap map §1.3/§5). The opportunity is the retained sales record
-- when a lead is erased (coverage.ts: opportunities RETAIN on delete), so a
-- signed quote survives an erasure attached to a pseudonymous opportunity,
-- with the person's values cleared by the anonymise trigger at the end.
--
-- Immutability. Guards refuse a direct statement and let nested work
-- through: an FK cascade or set-null (deleting a workspace), and the
-- anonymise trigger, run inside another trigger (pg_trigger_depth() > 1
-- inside a guard function, or >= 1 in a trigger's WHEN clause). A
-- security-definer function called directly is not nested and gets the
-- same refusal as anyone else.
--
-- RLS: member-read, service-role write; the tokens are server-only. Cost,
-- margin, internal note, AI rationale and the calculation (which carries
-- cost and margin) are withheld from browser roles by column grant.
--
-- Additive and idempotent.

-- ============================================================ shared guard
create or replace function public.forbid_update_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% rows are append-only', tg_table_name using errcode = 'restrict_violation';
end
$$;
revoke all on function public.forbid_update_delete() from public, anon, authenticated;

-- ======================================================================= quotes
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- Deferred so a workspace delete (which removes opportunities and quotes in
  -- one cascade) passes; deleting an opportunity that still has quotes fails.
  opportunity_id uuid not null,
  service_id uuid references public.services(id) on delete set null,
  number text not null check (char_length(number) between 1 and 40),
  title text not null check (char_length(title) between 1 and 200),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- Mirrors the current revision (lifecycle.ts QUOTE_STATES).
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'VIEWED', 'ACCEPTED', 'SIGNED',
    'DEPOSIT_PAID', 'PAID', 'WON', 'DECLINED', 'EXPIRED', 'REVISED', 'WITHDRAWN')),
  current_revision_id uuid,
  created_by_kind text not null check (created_by_kind in ('AI', 'HUMAN', 'API', 'LEAD_REQUEST')),
  created_by uuid references auth.users(id) on delete set null,
  -- src/lib/quotes/idempotency.ts quoteRequestKey: one quote per request.
  request_key text check (request_key is null or request_key ~ '^quote-request:v1:[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotes_number_unique unique (business_id, number),
  constraint quotes_request_key_unique unique (business_id, request_key),
  constraint quotes_id_business_unique unique (id, business_id),
  constraint quotes_opportunity_fk foreign key (opportunity_id)
    references public.opportunities(id) deferrable initially deferred
);
create index if not exists quotes_opportunity_idx on public.quotes (business_id, opportunity_id);
create index if not exists quotes_open_idx on public.quotes (business_id, status)
  where status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'VIEWED', 'ACCEPTED');
drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

-- ============================================================== quote_revisions
-- Frozen at SEND. A change after that is a NEW revision; the old one moves
-- to REVISED and its public tokens are revoked.
create table if not exists public.quote_revisions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null,
  revision_no integer not null check (revision_no >= 1),
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'VIEWED', 'ACCEPTED', 'SIGNED',
    'DEPOSIT_PAID', 'PAID', 'WON', 'DECLINED', 'EXPIRED', 'REVISED', 'WITHDRAWN')),
  -- INTERNAL: the full calculateQuote input (with a catalogue snapshot that
  -- includes cost) and its output (with margin), so the figures can be
  -- re-verified forever (verifyCalculation).
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
  total_gross_minor bigint not null,
  deposit_minor bigint not null default 0,
  first_payment_minor bigint not null check (first_payment_minor >= 0),
  margin_bps integer,                                                                  -- INTERNAL
  internal_note text check (internal_note is null or char_length(internal_note) <= 5000),  -- INTERNAL
  ai_rationale text check (ai_rationale is null or char_length(ai_rationale) <= 5000),      -- INTERNAL
  approval_required boolean not null default false,
  valid_until timestamptz,
  frozen_at timestamptz,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  accepted_at timestamptz,
  signed_at timestamptz,
  superseded_by uuid references public.quote_revisions(id) on delete set null,
  created_by_kind text not null check (created_by_kind in ('AI', 'HUMAN', 'API')),
  created_at timestamptz not null default now(),
  constraint quote_revisions_no_unique unique (quote_id, revision_no),
  constraint quote_revisions_id_business_unique unique (id, business_id),
  constraint quote_revisions_gross check (total_gross_minor = total_net_minor + total_vat_minor),
  constraint quote_revisions_deposit check (deposit_minor >= 0 and deposit_minor <= one_off_gross_minor),
  constraint quote_revisions_frozen_has_render check (frozen_at is null or (render_model is not null and render_hash is not null)),
  constraint quote_revisions_signed_is_frozen check (signed_at is null or frozen_at is not null),
  constraint quote_revisions_quote_fk foreign key (quote_id, business_id)
    references public.quotes(id, business_id) on delete cascade
);
create index if not exists quote_revisions_quote_idx on public.quote_revisions (quote_id, revision_no desc);
create index if not exists quote_revisions_expiry_idx on public.quote_revisions (valid_until)
  where status in ('PENDING_APPROVAL', 'APPROVED', 'SENT', 'VIEWED');

alter table public.quotes drop constraint if exists quotes_current_revision_fk;
alter table public.quotes
  add constraint quotes_current_revision_fk foreign key (current_revision_id)
  references public.quote_revisions(id) on delete set null deferrable initially deferred;

-- Nothing priced or shown changes once frozen; only the post-signature
-- status moves once signed; a frozen revision is never deleted directly.
-- Timestamps and the PDF key are write-once.
create or replace function public.quote_revisions_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  c_mutable constant text[] := array['status', 'internal_note', 'sent_at', 'first_viewed_at',
                                     'accepted_at', 'signed_at', 'pdf_object_key', 'superseded_by'];
  c_post_sign constant text[] := array['SIGNED', 'DEPOSIT_PAID', 'PAID', 'WON'];
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.frozen_at is not null then
      raise exception 'quote revision % is frozen and cannot be deleted', old.id using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.frozen_at is not null then
    if (to_jsonb(new) - c_mutable) is distinct from (to_jsonb(old) - c_mutable) then
      raise exception 'quote revision % was sent; issue a new revision instead', old.id using errcode = 'restrict_violation';
    end if;
    if (old.sent_at is not null and new.sent_at is distinct from old.sent_at)
       or (old.first_viewed_at is not null and new.first_viewed_at is distinct from old.first_viewed_at)
       or (old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at)
       or (old.signed_at is not null and new.signed_at is distinct from old.signed_at)
       or (old.pdf_object_key is not null and new.pdf_object_key is distinct from old.pdf_object_key)
       or (old.superseded_by is not null and new.superseded_by is distinct from old.superseded_by) then
      raise exception 'quote revision % already records that', old.id using errcode = 'restrict_violation';
    end if;
  end if;

  if old.status = any (c_post_sign) then
    if not (new.status = any (c_post_sign))
       or (to_jsonb(new) - array['status', 'pdf_object_key']) is distinct from (to_jsonb(old) - array['status', 'pdf_object_key']) then
      raise exception 'quote revision % is signed; nothing changes', old.id using errcode = 'restrict_violation';
    end if;
  end if;

  if old.status in ('WON', 'DECLINED', 'EXPIRED', 'REVISED', 'WITHDRAWN') and new.status is distinct from old.status then
    raise exception 'quote revision % is in terminal state %', old.id, old.status using errcode = 'restrict_violation';
  end if;
  return new;
end
$$;
revoke all on function public.quote_revisions_guard() from public, anon, authenticated;
drop trigger if exists quote_revisions_guard on public.quote_revisions;
create trigger quote_revisions_guard
  before update or delete on public.quote_revisions
  for each row execute function public.quote_revisions_guard();

-- Opportunity and current revision belong to this quote's workspace; no new
-- quote for a person who has been anonymised; a quote that has been sent is
-- never deleted directly (withdraw it).
create or replace function public.quotes_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business uuid;
  v_anonymised timestamptz;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if exists (select 1 from public.quote_revisions r where r.quote_id = old.id and r.frozen_at is not null) then
      raise exception 'quote % has been sent and cannot be deleted; withdraw it', old.id using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' or new.opportunity_id is distinct from old.opportunity_id then
    select o.business_id, l.anonymised_at into v_business, v_anonymised
      from public.opportunities o
      left join public.leads l on l.id = o.lead_id
     where o.id = new.opportunity_id;
    if v_business is distinct from new.business_id then
      raise exception 'opportunity % does not belong to workspace %', new.opportunity_id, new.business_id
        using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' and v_anonymised is not null then
      raise exception 'the person on opportunity % is anonymised; no quote may be created', new.opportunity_id
        using errcode = 'check_violation';
    end if;
  end if;

  if new.current_revision_id is not null
     and (tg_op = 'INSERT' or new.current_revision_id is distinct from old.current_revision_id)
     and not exists (select 1 from public.quote_revisions r
                      where r.id = new.current_revision_id and r.quote_id = new.id and r.business_id = new.business_id) then
    raise exception 'revision % is not a revision of quote %', new.current_revision_id, new.id
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
revoke all on function public.quotes_guard() from public, anon, authenticated;
drop trigger if exists quotes_guard on public.quotes;
create trigger quotes_guard
  before insert or update or delete on public.quotes
  for each row execute function public.quotes_guard();

-- ============================================================= quote_line_items
create table if not exists public.quote_line_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  revision_id uuid not null,
  position integer not null check (position between 0 and 999),
  line_key text not null check (char_length(line_key) between 1 and 90),
  source_line_key text not null check (char_length(source_line_key) between 1 and 80),
  parent_line_key text,
  item_id uuid references public.catalogue_items(id) on delete set null,
  item_key text not null,
  bundle_key text,
  description text not null check (char_length(description) between 1 and 500),
  unit text not null,
  charge_type text not null check (charge_type in ('ONE_OFF', 'RECURRING', 'USAGE')),
  interval_unit text check (interval_unit is null or interval_unit in ('WEEK', 'MONTH', 'QUARTER', 'YEAR')),
  interval_count integer check (interval_count is null or interval_count between 1 and 12),
  quantity_milli bigint not null check (quantity_milli > 0),
  unit_price_minor bigint check (unit_price_minor is null or unit_price_minor >= 0),
  list_minor bigint not null check (list_minor >= 0),
  bundle_discount_minor bigint not null default 0 check (bundle_discount_minor >= 0),
  line_discount_minor bigint not null default 0 check (line_discount_minor >= 0),
  line_discount_bps integer check (line_discount_bps is null or line_discount_bps between 0 and 10000),
  quote_discount_minor bigint not null default 0 check (quote_discount_minor >= 0),
  net_minor bigint not null check (net_minor >= 0),
  vat_rate text not null check (vat_rate in ('STANDARD', 'REDUCED', 'ZERO', 'EXEMPT', 'OUTSIDE_SCOPE')),
  vat_bps integer not null check (vat_bps between 0 and 10000),
  vat_minor bigint not null check (vat_minor >= 0),
  gross_minor bigint not null,
  cost_minor bigint,     -- INTERNAL
  margin_minor bigint,   -- INTERNAL
  constraint quote_line_items_position_unique unique (revision_id, position),
  constraint quote_line_items_key_unique unique (revision_id, line_key),
  constraint quote_line_items_net check (net_minor = list_minor - bundle_discount_minor - line_discount_minor - quote_discount_minor),
  constraint quote_line_items_gross check (gross_minor = net_minor + vat_minor),
  constraint quote_line_items_revision_fk foreign key (revision_id, business_id)
    references public.quote_revisions(id, business_id) on delete cascade
);
create index if not exists quote_line_items_item_idx on public.quote_line_items (business_id, item_id);

create or replace function public.quote_line_items_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.quote_revisions r
              where r.id in (new.revision_id, old.revision_id) and r.frozen_at is not null) then
    raise exception 'quote lines of a sent revision are immutable' using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end
$$;
revoke all on function public.quote_line_items_guard() from public, anon, authenticated;
drop trigger if exists quote_line_items_guard on public.quote_line_items;
create trigger quote_line_items_guard
  before insert or update or delete on public.quote_line_items
  for each row execute function public.quote_line_items_guard();

-- ============================================================== quote_approvals
create table if not exists public.quote_approvals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null,
  revision_id uuid not null,
  required_role text not null check (required_role in ('admin', 'owner')),
  reason text not null check (reason in ('APPROVAL_THRESHOLD', 'MARGIN_FLOOR', 'TWO_STEP_ESCALATION', 'MANUAL')),
  matched_rule_ids text[] not null default '{}',
  decision text not null default 'PENDING' check (decision in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by_kind text not null check (requested_by_kind in ('AI', 'HUMAN', 'API')),
  requested_by uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 2000),
  created_at timestamptz not null default now(),
  constraint quote_approvals_decided check (decision = 'CANCELLED' or ((decision = 'PENDING') = (decided_at is null))),
  constraint quote_approvals_quote_fk foreign key (quote_id, business_id)
    references public.quotes(id, business_id) on delete cascade,
  constraint quote_approvals_revision_fk foreign key (revision_id, business_id)
    references public.quote_revisions(id, business_id) on delete cascade
);
create unique index if not exists quote_approvals_one_pending_idx
  on public.quote_approvals (revision_id) where decision = 'PENDING';
create index if not exists quote_approvals_inbox_idx on public.quote_approvals (business_id, decision, created_at desc);

-- ========================================================== quote_access_tokens
-- [SERVER-ONLY] The raw token never reaches the database: only SHA-256 hex.
create table if not exists public.quote_access_tokens (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null,
  revision_id uuid not null,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  purpose text not null default 'VIEW_AND_SIGN' check (purpose in ('VIEW_AND_SIGN', 'VIEW_ONLY')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0 check (view_count >= 0),
  created_at timestamptz not null default now(),
  constraint quote_access_tokens_hash_unique unique (token_hash),
  constraint quote_access_tokens_quote_fk foreign key (quote_id, business_id)
    references public.quotes(id, business_id) on delete cascade,
  constraint quote_access_tokens_revision_fk foreign key (revision_id, business_id)
    references public.quote_revisions(id, business_id) on delete cascade
);
create index if not exists quote_access_tokens_revision_idx
  on public.quote_access_tokens (revision_id) where revoked_at is null;

-- Superseding or withdrawing a revision revokes its live tokens.
create or replace function public.quote_revisions_revoke_tokens()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('REVISED', 'WITHDRAWN') and old.status is distinct from new.status then
    update public.quote_access_tokens
       set revoked_at = now()
     where revision_id = new.id and business_id = new.business_id and revoked_at is null;
  end if;
  return null;
end
$$;
revoke all on function public.quote_revisions_revoke_tokens() from public, anon, authenticated;
drop trigger if exists quote_revisions_revoke_tokens on public.quote_revisions;
create trigger quote_revisions_revoke_tokens
  after update of status on public.quote_revisions
  for each row execute function public.quote_revisions_revoke_tokens();

-- ============================================================= quote_signatures
-- A simple electronic signature (src/lib/esign), one per revision,
-- append-only. The revision FK is deferred, not cascading: a signed revision
-- is never deleted directly (its guard refuses), and a workspace delete
-- removes both in one cascade.
create table if not exists public.quote_signatures (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null,
  revision_id uuid not null,
  signature_type text not null default 'SIMPLE_ELECTRONIC_SIGNATURE'
    check (signature_type = 'SIMPLE_ELECTRONIC_SIGNATURE'),
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  calculation_hash text not null check (calculation_hash ~ '^[0-9a-f]{64}$'),
  signer_name text,             -- cleared on anonymise
  signer_email text,            -- cleared on anonymise
  signer_title text,            -- cleared on anonymise
  email_verified_at timestamptz,
  method text not null check (method in ('TYPED', 'DRAWN', 'TYPED_AND_DRAWN')),
  typed_name text,              -- cleared on anonymise
  drawn_format text check (drawn_format is null or drawn_format in ('SVG_PATH', 'PNG_DATA_URL')),
  drawn_data text check (drawn_data is null or char_length(drawn_data) <= 200000),  -- cleared on anonymise
  drawn_sha256 text check (drawn_sha256 is null or drawn_sha256 ~ '^[0-9a-f]{64}$'),
  consent_given boolean not null check (consent_given),
  consent_text text not null,
  consent_sha256 text not null check (consent_sha256 ~ '^[0-9a-f]{64}$'),
  consent_version text not null,
  ip inet,                      -- cleared on anonymise
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),  -- cleared on anonymise
  signed_at timestamptz not null,
  audit_trail jsonb not null check (jsonb_typeof(audit_trail) = 'array'),
  record_hash text not null check (record_hash ~ '^[0-9a-f]{64}$'),
  anonymised_at timestamptz,
  created_at timestamptz not null default now(),
  constraint quote_signatures_revision_unique unique (revision_id),
  constraint quote_signatures_has_mark check (typed_name is not null or drawn_data is not null or anonymised_at is not null),
  constraint quote_signatures_quote_fk foreign key (quote_id, business_id)
    references public.quotes(id, business_id) on delete cascade,
  constraint quote_signatures_revision_fk foreign key (revision_id, business_id)
    references public.quote_revisions(id, business_id) deferrable initially deferred
);
create index if not exists quote_signatures_quote_idx on public.quote_signatures (business_id, quote_id);
drop trigger if exists quote_signatures_append_only on public.quote_signatures;
create trigger quote_signatures_append_only
  before update or delete on public.quote_signatures
  for each row when (pg_trigger_depth() = 0)
  execute function public.forbid_update_delete();

-- ================================================================= quote_events
-- Append-only timeline and automation source. action_key makes accept, sign
-- and pay idempotent on (revision, action) (idempotency.ts quoteActionKey).
create table if not exists public.quote_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null,
  revision_id uuid references public.quote_revisions(id) on delete cascade,
  event_type text not null check (event_type in (
    'quote.requested', 'quote.created', 'quote.approval_requested', 'quote.approved',
    'quote.sent', 'quote.viewed', 'quote.accepted', 'quote.declined', 'quote.expired',
    'quote.signed', 'quote.approval_rejected', 'quote.revised', 'quote.withdrawn',
    'quote.deposit_paid', 'quote.paid', 'quote.won', 'quote.reminded')),
  actor_kind text not null check (actor_kind in ('AI', 'HUMAN', 'CUSTOMER', 'SYSTEM', 'API')),
  actor_id uuid references auth.users(id) on delete set null,
  action_key text check (action_key is null or action_key ~ '^quote-action:v1:[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  occurred_at timestamptz not null default now(),
  constraint quote_events_action_key_unique unique (action_key),
  constraint quote_events_quote_fk foreign key (quote_id, business_id)
    references public.quotes(id, business_id) on delete cascade
);
create index if not exists quote_events_quote_idx on public.quote_events (quote_id, occurred_at);
create index if not exists quote_events_type_idx on public.quote_events (business_id, event_type, occurred_at desc);
drop trigger if exists quote_events_append_only on public.quote_events;
create trigger quote_events_append_only
  before update or delete on public.quote_events
  for each row when (pg_trigger_depth() = 0)
  execute function public.forbid_update_delete();

-- Acceptance evidence (accept / decline by the customer), separate from the
-- signature so a decline or an accept-then-sign has its own record.
create table if not exists public.quote_acceptance_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  quote_id uuid not null,
  revision_id uuid not null,
  action text not null check (action in ('ACCEPT', 'DECLINE')),
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  actor_email text,             -- cleared on anonymise
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 2000),  -- cleared on anonymise
  ip inet,                      -- cleared on anonymise
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),  -- cleared on anonymise
  occurred_at timestamptz not null default now(),
  constraint quote_acceptance_events_once unique (revision_id, action),
  constraint quote_acceptance_events_quote_fk foreign key (quote_id, business_id)
    references public.quotes(id, business_id) on delete cascade,
  constraint quote_acceptance_events_revision_fk foreign key (revision_id, business_id)
    references public.quote_revisions(id, business_id) deferrable initially deferred
);
drop trigger if exists quote_acceptance_events_append_only on public.quote_acceptance_events;
create trigger quote_acceptance_events_append_only
  before update or delete on public.quote_acceptance_events
  for each row when (pg_trigger_depth() = 0)
  execute function public.forbid_update_delete();

-- ======================================================================== RLS
do $$
declare t text;
begin
  foreach t in array array[
    'quotes', 'quote_revisions', 'quote_line_items', 'quote_approvals',
    'quote_signatures', 'quote_events', 'quote_acceptance_events'
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

alter table public.quote_access_tokens enable row level security;
alter table public.quote_access_tokens force row level security;
revoke all on public.quote_access_tokens from anon, authenticated;

-- Internal columns (draft: cost, margin, notes, AI rationale; plus the
-- calculation and its input, which carry cost and margin) are withheld.
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

-- ================================================================ public access
-- The ONLY way an anonymous visitor reaches a quote. The presented token is
-- hashed here (never stored or compared raw) and looked up by hash; a wrong,
-- expired, revoked or superseded token all return NULL, indistinguishably.
-- Returns customer-facing fields only: the frozen render model (no cost,
-- margin, note or AI field by construction, render-model.ts) plus status,
-- validity and whether it can be signed.
create or replace function public.quote_public_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
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

  select * into v_tok from public.quote_access_tokens t where t.token_hash = v_hash;
  if not found or v_tok.revoked_at is not null or v_tok.expires_at <= now() then
    return null;
  end if;

  select q.current_revision_id into v_current
    from public.quotes q where q.id = v_tok.quote_id and q.business_id = v_tok.business_id;
  if v_current is distinct from v_tok.revision_id then
    return null;
  end if;

  select * into v_rev from public.quote_revisions r
   where r.id = v_tok.revision_id and r.business_id = v_tok.business_id;
  if not found or v_rev.frozen_at is null or v_rev.render_model is null then
    return null;
  end if;

  update public.quote_access_tokens
     set last_viewed_at = now(), view_count = view_count + 1
   where id = v_tok.id;

  return jsonb_build_object(
    'revision_id', v_rev.id,
    'status', case
                when v_rev.status in ('SENT', 'VIEWED', 'PENDING_APPROVAL', 'APPROVED')
                     and v_rev.valid_until is not null and v_rev.valid_until < now() then 'EXPIRED'
                else v_rev.status end,
    'valid_until', v_rev.valid_until,
    'render_model', v_rev.render_model,
    'render_hash', v_rev.render_hash,
    'can_sign', v_tok.purpose = 'VIEW_AND_SIGN'
                and v_rev.status in ('SENT', 'VIEWED', 'ACCEPTED')
                and (v_rev.valid_until is null or v_rev.valid_until >= now())
  );
end
$$;
revoke all on function public.quote_public_view(text) from public;
grant execute on function public.quote_public_view(text) to anon, authenticated, service_role;

-- =========================================================== state transitions
-- Every quote state change except SIGN goes through here: it locks the quote
-- row, refuses another workspace's quote (NOT_FOUND, indistinguishable from
-- a missing one), refuses a stale expected status, re-checks the transition
-- table and actor rules of lifecycle.ts, and records the event with its
-- action key (idempotent). REVISE takes detail.new_revision_id, a DRAFT
-- revision of the same quote with a higher number, which becomes current.
-- Service role only.
create or replace function public.quote_transition(
  p_business_id uuid,
  p_quote_id uuid,
  p_action text,
  p_expected_status text,
  p_actor_kind text,
  p_action_key text default null,
  p_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.quotes%rowtype;
  v_rev public.quote_revisions%rowtype;
  v_new public.quote_revisions%rowtype;
  v_to text;
  v_event text;
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
begin
  if jsonb_typeof(v_detail) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_DETAIL');
  end if;
  if p_actor_kind is null or p_actor_kind not in ('AI', 'HUMAN', 'CUSTOMER', 'SYSTEM', 'API') then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_ACTOR');
  end if;
  if p_action = 'SIGN' then
    return jsonb_build_object('ok', false, 'reason', 'USE_SIGNATURE_FUNCTION');
  end if;

  select * into v_quote from public.quotes q
   where q.id = p_quote_id and q.business_id = p_business_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;

  if p_action_key is not null then
    if exists (select 1 from public.quote_events e where e.action_key = p_action_key and e.quote_id = p_quote_id) then
      return jsonb_build_object('ok', true, 'duplicate', true, 'status', v_quote.status);
    elsif exists (select 1 from public.quote_events e where e.action_key = p_action_key) then
      return jsonb_build_object('ok', false, 'reason', 'ACTION_KEY_CONFLICT');
    end if;
  end if;

  if v_quote.status is distinct from p_expected_status then
    return jsonb_build_object('ok', false, 'reason', 'STALE', 'status', v_quote.status);
  end if;

  if p_action in ('APPROVE', 'REJECT_APPROVAL') and p_actor_kind <> 'HUMAN' then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_NOT_PERMITTED');
  end if;
  if p_action in ('ACCEPT', 'DECLINE') and p_actor_kind <> 'CUSTOMER' then
    return jsonb_build_object('ok', false, 'reason', 'ACTOR_NOT_PERMITTED');
  end if;

  v_to := case v_quote.status || '|' || coalesce(p_action, '')
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
    when 'ACCEPTED|DECLINE' then 'DECLINED'
    when 'SIGNED|RECORD_DEPOSIT_PAID' then 'DEPOSIT_PAID'
    when 'SIGNED|RECORD_PAID' then 'PAID'
    when 'SIGNED|MARK_WON' then 'WON'
    when 'DEPOSIT_PAID|RECORD_PAID' then 'PAID'
    when 'DEPOSIT_PAID|MARK_WON' then 'WON'
    when 'PAID|MARK_WON' then 'WON'
    else null end;
  if v_to is null then
    return jsonb_build_object('ok', false, 'reason', 'ILLEGAL_TRANSITION', 'status', v_quote.status);
  end if;

  select * into v_rev from public.quote_revisions r
   where r.id = v_quote.current_revision_id and r.business_id = p_business_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_CURRENT_REVISION');
  end if;

  if p_action in ('ACCEPT', 'SEND', 'APPROVE') and v_rev.valid_until is not null and v_rev.valid_until < now() then
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;
  if p_action = 'EXPIRE' and (v_rev.valid_until is null or v_rev.valid_until >= now()) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_EXPIRED');
  end if;
  if p_action = 'SEND' and v_quote.status = 'DRAFT' and v_rev.approval_required then
    return jsonb_build_object('ok', false, 'reason', 'APPROVAL_REQUIRED');
  end if;
  if p_action = 'SEND' and v_rev.frozen_at is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FROZEN');
  end if;

  if p_action = 'REVISE' then
    if coalesce(v_detail ->> 'new_revision_id', '') !~ '^[0-9a-f-]{36}$' then
      return jsonb_build_object('ok', false, 'reason', 'NEW_REVISION_REQUIRED');
    end if;
    select * into v_new from public.quote_revisions r
     where r.id = (v_detail ->> 'new_revision_id')::uuid
       and r.quote_id = p_quote_id and r.business_id = p_business_id
     for update;
    if not found or v_new.status <> 'DRAFT' or v_new.revision_no <= v_rev.revision_no then
      return jsonb_build_object('ok', false, 'reason', 'NEW_REVISION_INVALID');
    end if;
    update public.quote_revisions set status = 'REVISED', superseded_by = v_new.id where id = v_rev.id;
    update public.quotes set current_revision_id = v_new.id, status = 'DRAFT' where id = p_quote_id;
  else
    update public.quote_revisions
       set status = v_to,
           sent_at = case when p_action = 'SEND' then coalesce(sent_at, now()) else sent_at end,
           first_viewed_at = case when p_action = 'MARK_VIEWED' then coalesce(first_viewed_at, now()) else first_viewed_at end,
           accepted_at = case when p_action = 'ACCEPT' then coalesce(accepted_at, now()) else accepted_at end
     where id = v_rev.id;
    update public.quotes set status = v_to where id = p_quote_id;
  end if;

  v_event := case p_action
    when 'SUBMIT_FOR_APPROVAL' then 'quote.approval_requested'
    when 'APPROVE' then 'quote.approved'
    when 'REJECT_APPROVAL' then 'quote.approval_rejected'
    when 'SEND' then 'quote.sent'
    when 'MARK_VIEWED' then 'quote.viewed'
    when 'ACCEPT' then 'quote.accepted'
    when 'DECLINE' then 'quote.declined'
    when 'EXPIRE' then 'quote.expired'
    when 'REVISE' then 'quote.revised'
    when 'WITHDRAW' then 'quote.withdrawn'
    when 'RECORD_DEPOSIT_PAID' then 'quote.deposit_paid'
    when 'RECORD_PAID' then 'quote.paid'
    when 'MARK_WON' then 'quote.won'
  end;
  -- A repeat view is not a new event.
  if not (p_action = 'MARK_VIEWED' and v_quote.status = 'VIEWED') then
    insert into public.quote_events (business_id, quote_id, revision_id, event_type, actor_kind, action_key, detail)
    values (p_business_id, p_quote_id, v_rev.id, v_event, p_actor_kind, p_action_key, v_detail);
  end if;

  return jsonb_build_object('ok', true, 'from', v_quote.status,
                            'to', case when p_action = 'REVISE' then 'DRAFT' else v_to end,
                            'revision_id', case when p_action = 'REVISE' then v_new.id else v_rev.id end);
end
$$;
revoke all on function public.quote_transition(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.quote_transition(uuid, uuid, text, text, text, text, jsonb) to service_role;

-- ==================================================================== signing
-- ACCEPTED -> SIGNED, with the signature record (src/lib/esign SignatureRecord,
-- snake_case keys) written in the same transaction. Refuses another
-- workspace's quote, a stale expected status, a revision that is not the
-- current one, an unfrozen or expired revision, and a signature over any
-- document other than this revision's render hash and calculation hash.
-- Idempotent on the action key. Service role only (the public page's server
-- action verifies the token and the e-mail code first).
create or replace function public.quote_record_signature(
  p_business_id uuid,
  p_quote_id uuid,
  p_revision_id uuid,
  p_expected_status text,
  p_action_key text,
  p_signature jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quote public.quotes%rowtype;
  v_rev public.quote_revisions%rowtype;
  v_sig uuid;
  v_signed_at timestamptz;
begin
  if p_signature is null or jsonb_typeof(p_signature) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_SIGNATURE');
  end if;

  select * into v_quote from public.quotes q
   where q.id = p_quote_id and q.business_id = p_business_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;

  if p_action_key is not null then
    if exists (select 1 from public.quote_events e where e.action_key = p_action_key and e.quote_id = p_quote_id) then
      return jsonb_build_object('ok', true, 'duplicate', true, 'status', v_quote.status);
    elsif exists (select 1 from public.quote_events e where e.action_key = p_action_key) then
      return jsonb_build_object('ok', false, 'reason', 'ACTION_KEY_CONFLICT');
    end if;
  end if;

  if v_quote.status is distinct from p_expected_status then
    return jsonb_build_object('ok', false, 'reason', 'STALE', 'status', v_quote.status);
  end if;
  if v_quote.status <> 'ACCEPTED' then
    return jsonb_build_object('ok', false, 'reason', 'ILLEGAL_TRANSITION', 'status', v_quote.status);
  end if;
  if v_quote.current_revision_id is distinct from p_revision_id then
    return jsonb_build_object('ok', false, 'reason', 'REVISION_MISMATCH');
  end if;

  select * into v_rev from public.quote_revisions r
   where r.id = p_revision_id and r.business_id = p_business_id
   for update;
  if not found or v_rev.frozen_at is null then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FROZEN');
  end if;
  if v_rev.valid_until is not null and v_rev.valid_until < now() then
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;
  if (p_signature ->> 'document_hash') is distinct from v_rev.render_hash then
    return jsonb_build_object('ok', false, 'reason', 'DOCUMENT_HASH_MISMATCH');
  end if;
  if (p_signature ->> 'calculation_hash') is distinct from v_rev.calculation_hash then
    return jsonb_build_object('ok', false, 'reason', 'CALCULATION_HASH_MISMATCH');
  end if;

  v_signed_at := coalesce((p_signature ->> 'signed_at')::timestamptz, now());

  insert into public.quote_signatures (
    business_id, quote_id, revision_id, document_hash, calculation_hash,
    signer_name, signer_email, signer_title, email_verified_at, method, typed_name,
    drawn_format, drawn_data, drawn_sha256, consent_given, consent_text, consent_sha256,
    consent_version, ip, user_agent, signed_at, audit_trail, record_hash
  ) values (
    p_business_id, p_quote_id, p_revision_id, p_signature ->> 'document_hash', p_signature ->> 'calculation_hash',
    p_signature ->> 'signer_name', p_signature ->> 'signer_email', p_signature ->> 'signer_title',
    (p_signature ->> 'email_verified_at')::timestamptz, p_signature ->> 'method', p_signature ->> 'typed_name',
    p_signature ->> 'drawn_format', p_signature ->> 'drawn_data', p_signature ->> 'drawn_sha256',
    coalesce((p_signature ->> 'consent_given')::boolean, false), p_signature ->> 'consent_text',
    p_signature ->> 'consent_sha256', p_signature ->> 'consent_version',
    (p_signature ->> 'ip')::inet, p_signature ->> 'user_agent', v_signed_at,
    coalesce(p_signature -> 'audit_trail', '[]'::jsonb), p_signature ->> 'record_hash'
  )
  returning id into v_sig;

  update public.quote_revisions set status = 'SIGNED', signed_at = v_signed_at where id = p_revision_id;
  update public.quotes set status = 'SIGNED' where id = p_quote_id;

  insert into public.quote_events (business_id, quote_id, revision_id, event_type, actor_kind, action_key, detail)
  values (p_business_id, p_quote_id, p_revision_id, 'quote.signed', 'CUSTOMER', p_action_key,
          jsonb_build_object('signature_id', v_sig));

  return jsonb_build_object('ok', true, 'from', 'ACCEPTED', 'to', 'SIGNED', 'signature_id', v_sig);
end
$$;
revoke all on function public.quote_record_signature(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.quote_record_signature(uuid, uuid, uuid, text, text, jsonb) to service_role;

-- ================================================================ data rights
-- The person is reached through the opportunity their quotes belong to
-- (opportunities.lead_id is still set when data_rights_scrub stamps
-- leads.anonymised_at; a later lead delete only nulls it). Cleared: signer
-- name, e-mail, title, typed and drawn marks, IP and user agent; acceptance
-- e-mail, IP, user agent and decline reason; the buyer's name, e-mail and
-- address in the frozen render model; internal note and AI rationale; the
-- quote title. Live links are revoked. Kept: the hashes (the evidence that a
-- signature matched that document), amounts, statuses and timestamps.
create or replace function public.quote_clear_on_anonymise()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.quote_signatures s
     set signer_name = null, signer_email = null, signer_title = null, typed_name = null,
         drawn_data = null, ip = null, user_agent = null, anonymised_at = now()
    from public.quotes q
    join public.opportunities o on o.id = q.opportunity_id
   where s.quote_id = q.id and q.business_id = new.business_id and o.lead_id = new.id
     and s.anonymised_at is null;

  update public.quote_acceptance_events a
     set actor_email = null, ip = null, user_agent = null, decline_reason = null
    from public.quotes q
    join public.opportunities o on o.id = q.opportunity_id
   where a.quote_id = q.id and q.business_id = new.business_id and o.lead_id = new.id;

  update public.quote_revisions r
     set render_model = case
           when r.render_model ? 'buyer' then jsonb_set(r.render_model, '{buyer}', jsonb_build_object(
             'name', '[removed]', 'company', r.render_model -> 'buyer' -> 'company',
             'email', null, 'address', '[]'::jsonb))
           else r.render_model end,
         internal_note = null,
         ai_rationale = null
    from public.quotes q
    join public.opportunities o on o.id = q.opportunity_id
   where r.quote_id = q.id and q.business_id = new.business_id and o.lead_id = new.id;

  update public.quote_access_tokens t
     set revoked_at = now()
    from public.quotes q
    join public.opportunities o on o.id = q.opportunity_id
   where t.quote_id = q.id and q.business_id = new.business_id and o.lead_id = new.id
     and t.revoked_at is null;

  update public.quotes q
     set title = 'Quote ' || q.number
    from public.opportunities o
   where o.id = q.opportunity_id and q.business_id = new.business_id and o.lead_id = new.id;
  return null;
end
$$;
revoke all on function public.quote_clear_on_anonymise() from public, anon, authenticated;

drop trigger if exists leads_quote_clear_on_anonymise on public.leads;
create trigger leads_quote_clear_on_anonymise
  after update of anonymised_at on public.leads
  for each row when (new.anonymised_at is not null)
  execute function public.quote_clear_on_anonymise();
