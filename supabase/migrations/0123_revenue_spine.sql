-- 0123_revenue_spine: Phase 1 of the core revenue engine -- one intake path,
-- identity resolution, per-touch attribution, the domain event outbox,
-- per-channel opt-out and derived contactability states.
--
-- Design: docs/revenue-engine/03-phase1-spine-design.md.
--
-- ## Access
--
--   lead_touches, merge_events, merge_candidates, legitimate_interest_assessments
--     Read by the app (attribution, the merge review queue, the LIA register),
--     so they follow the 0036/0121 member-read pattern: RLS enabled and forced,
--     SELECT granted to `authenticated`, one `_select_member` policy on
--     is_business_member(business_id). No write grant: every write is the
--     service role (ingest, server actions).
--
--   ingest_requests, domain_events
--     Server-only (0036 pattern): RLS enabled and forced, no grants, no
--     policies. The idempotency ledger and the outbox carry request bodies and
--     internal payloads no browser needs.
--
-- ## Race safety for identity (design §2)
--
-- `leads (business_id, email_normalized)` and `(business_id, phone_normalized)`
-- become unique among live, non-test leads. Existing duplicates cannot be
-- merged by a migration -- which record wins is a person's decision -- so they
-- are parked instead of failing the migration:
--
--   1. every duplicate group is reported with RAISE NOTICE;
--   2. each newer row gets a `merge_candidates` row against the oldest (OPEN);
--   3. each newer row is stamped `identity_duplicate_of = <oldest id>`, and the
--      unique indexes exclude stamped rows.
--
-- So the index protects every lead from now on, and the pre-existing
-- duplicates stay exactly as they are until someone resolves the candidate.
-- The alternative -- skip the index when duplicates exist -- would leave every
-- workspace unprotected because of one old pair, which is the unsafe choice.
-- `identity_duplicate_of` is deliberately not a foreign key: deleting the
-- keeper must not null the stamp on several parked rows at once and make them
-- collide with each other.

-- ------------------------------------------------------------------ leads
alter table public.leads
  add column if not exists email_normalized text
    generated always as (nullif(lower(btrim(email)), '')) stored,
  add column if not exists identity_duplicate_of uuid;

comment on column public.leads.email_normalized is
  'lower(trim(email)); the identity key the unique index and ingest matching use.';
comment on column public.leads.identity_duplicate_of is
  'Set by 0123 on a pre-existing duplicate, parked as a merge_candidates row for a person. Excluded from the identity unique indexes.';

-- ----------------------------------------------------------- merge tables
create table public.merge_candidates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- The record that would survive a merge (the older one, by convention).
  lead_a_id uuid not null references public.leads(id) on delete cascade,
  lead_b_id uuid references public.leads(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete cascade,
  reason text not null
    check (reason in ('EXISTING_DUPLICATE_EMAIL','EXISTING_DUPLICATE_PHONE','PHONE_CONFLICT',
                      'WEAK_NAME_COMPANY','PROSPECT_MATCH')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  status text not null default 'OPEN' check (status in ('OPEN','MERGED','DISMISSED')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint merge_candidates_other_side check (lead_b_id is not null or prospect_id is not null),
  constraint merge_candidates_distinct check (lead_b_id is null or lead_b_id <> lead_a_id)
);

create unique index merge_candidates_pair_idx
  on public.merge_candidates (
    business_id, lead_a_id,
    coalesce(lead_b_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(prospect_id, '00000000-0000-0000-0000-000000000000'::uuid),
    reason
  );
create index merge_candidates_open_idx
  on public.merge_candidates (business_id, created_at desc)
  where status = 'OPEN';

-- -------------------------------------------- existing duplicates, parked
do $$
declare
  groups integer;
begin
  select count(*) into groups from (
    select 1 from public.leads
     where archived_at is null and not is_test and email_normalized is not null
     group by business_id, email_normalized having count(*) > 1
  ) g;
  if groups > 0 then
    raise notice '0123: % email duplicate group(s) among live leads; newer rows parked as merge_candidates', groups;
  end if;

  select count(*) into groups from (
    select 1 from public.leads
     where archived_at is null and not is_test
       and phone_normalized is not null and phone_normalized <> ''
     group by business_id, phone_normalized having count(*) > 1
  ) g;
  if groups > 0 then
    raise notice '0123: % phone duplicate group(s) among live leads; newer rows parked as merge_candidates', groups;
  end if;
end $$;

insert into public.merge_candidates (business_id, lead_a_id, lead_b_id, reason, evidence)
select r.business_id, r.keeper, r.id, 'EXISTING_DUPLICATE_EMAIL',
       jsonb_build_object('detected_by', '0123_revenue_spine', 'email', r.email_normalized)
  from (
    select id, business_id, email_normalized,
           first_value(id) over (partition by business_id, email_normalized order by created_at, id) as keeper
      from public.leads
     where archived_at is null and not is_test and email_normalized is not null
  ) r
 where r.id <> r.keeper
on conflict do nothing;

update public.leads l
   set identity_duplicate_of = r.keeper
  from (
    select id,
           first_value(id) over (partition by business_id, email_normalized order by created_at, id) as keeper
      from public.leads
     where archived_at is null and not is_test and email_normalized is not null
  ) r
 where l.id = r.id and r.id <> r.keeper;

insert into public.merge_candidates (business_id, lead_a_id, lead_b_id, reason, evidence)
select r.business_id, r.keeper, r.id, 'EXISTING_DUPLICATE_PHONE',
       jsonb_build_object('detected_by', '0123_revenue_spine', 'phone', r.phone_normalized)
  from (
    select id, business_id, phone_normalized,
           first_value(id) over (partition by business_id, phone_normalized order by created_at, id) as keeper
      from public.leads
     where archived_at is null and not is_test and identity_duplicate_of is null
       and phone_normalized is not null and phone_normalized <> ''
  ) r
 where r.id <> r.keeper
on conflict do nothing;

update public.leads l
   set identity_duplicate_of = r.keeper
  from (
    select id,
           first_value(id) over (partition by business_id, phone_normalized order by created_at, id) as keeper
      from public.leads
     where archived_at is null and not is_test and identity_duplicate_of is null
       and phone_normalized is not null and phone_normalized <> ''
  ) r
 where l.id = r.id and r.id <> r.keeper;

create unique index leads_identity_email_key
  on public.leads (business_id, email_normalized)
  where archived_at is null and not is_test and identity_duplicate_of is null
    and email_normalized is not null;

create unique index leads_identity_phone_key
  on public.leads (business_id, phone_normalized)
  where archived_at is null and not is_test and identity_duplicate_of is null
    and phone_normalized is not null and phone_normalized <> '';

-- ------------------------------------------------------------ lead_touches
-- One row per arrival of a person through a source (design §3). `lead_sources`
-- stays the form registry; the touch carries the per-submission ids, so the
-- attribution of each submission is exact (B11 fixed at the root).
create table public.lead_touches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  -- The provider's own submission time: speed to lead starts here.
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  source_type text not null
    check (source_type in ('AD_FORM','WEB_FORM','CSV','MANUAL','API','MCP','CONNECTOR','SOCIAL_DM','CRM')),
  provider text not null check (length(provider) between 1 and 60),
  provider_record_id text check (provider_record_id is null or length(provider_record_id) between 1 and 300),
  lead_source_id uuid references public.lead_sources(id) on delete set null,
  page_id text, page_name text,
  form_id text, form_name text,
  campaign_id text, campaign_name text,
  adset_id text, adset_name text,
  ad_id text, ad_name text,
  utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
  gclid text, fbclid text,
  referrer text, landing_url text,
  caller_type text not null
    check (caller_type in ('SYSTEM','USER','API_KEY','MCP_CLIENT','CONNECTOR')),
  caller_id text,
  -- Form answers, minimised: question label -> answer text, nothing else.
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  ingest_outcome text not null
    check (ingest_outcome in ('CREATED','MERGED','SUPPRESSED','REVIEW')),
  created_at timestamptz not null default now()
);

create unique index lead_touches_provider_record_idx
  on public.lead_touches (business_id, provider, provider_record_id)
  where provider_record_id is not null;
create index lead_touches_lead_idx
  on public.lead_touches (business_id, lead_id, occurred_at);
create index lead_touches_source_idx
  on public.lead_touches (business_id, lead_source_id)
  where lead_source_id is not null;

-- Attribution models are views, never stored (design §3). security_invoker so
-- the caller's RLS on lead_touches applies.
create view public.lead_first_touch with (security_invoker = true) as
  select distinct on (t.business_id, t.lead_id) t.*
    from public.lead_touches t
   order by t.business_id, t.lead_id, t.occurred_at, t.received_at, t.id;

create view public.lead_last_touch with (security_invoker = true) as
  select distinct on (t.business_id, t.lead_id) t.*
    from public.lead_touches t
   order by t.business_id, t.lead_id, t.occurred_at desc, t.received_at desc, t.id desc;

create view public.lead_touch_linear_credit with (security_invoker = true) as
  select t.*,
         (1.0 / count(*) over (partition by t.business_id, t.lead_id))::numeric(6,5) as credit
    from public.lead_touches t;

-- ----------------------------------------------------------- merge_events
-- Never a silent merge: every fill-in of an existing lead is recorded with a
-- before-snapshot of exactly the fields it changed, so it can be reversed.
create table public.merge_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  touch_id uuid references public.lead_touches(id) on delete set null,
  rule text not null
    check (rule in ('EMAIL','PHONE','PROVIDER_RECORD','PROSPECT_PROMOTION','MANUAL')),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  before jsonb not null default '{}'::jsonb check (jsonb_typeof(before) = 'object'),
  after jsonb not null default '{}'::jsonb check (jsonb_typeof(after) = 'object'),
  actor_type text not null
    check (actor_type in ('SYSTEM','USER','API_KEY','MCP_CLIENT','CONNECTOR')),
  actor_id text,
  reverted_at timestamptz,
  reverted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index merge_events_lead_idx
  on public.merge_events (business_id, lead_id, created_at desc);

-- -------------------------------------------------------- ingest_requests
-- Idempotency ledger for ingestLead(). A repeated key returns the first
-- outcome unchanged.
create table public.ingest_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 1 and 300),
  source_type text not null,
  provider text not null,
  -- sha256 of the normalised input: a key re-used with a different body is
  -- reported, never silently treated as the same request.
  request_hash text,
  outcome text not null
    check (outcome in ('CREATED','MERGED','DUPLICATE','SUPPRESSED','REVIEW')),
  lead_id uuid references public.leads(id) on delete set null,
  touch_id uuid references public.lead_touches(id) on delete set null,
  matched_by text,
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  created_at timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

-- ---------------------------------------------------------- domain_events
-- The outbox (design §4). A row is written in the same unit of work as the
-- change where the change is SQL (the triggers below), or immediately after it
-- by emitDomainEvent() in src/lib/events/outbox.ts; `event.dispatch` then fans
-- it out to the consumers. `dedupe_key` makes a re-emit a no-op.
create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  type text not null check (type ~ '^[a-z_]+\.[a-z_]+$'),
  subject_type text not null
    check (subject_type in ('lead','prospect','booking','message','contact','agent_handoff',
                            'opportunity','integration','qualification_answer')),
  subject_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  causation_id uuid references public.domain_events(id) on delete set null,
  causation_depth integer not null default 0 check (causation_depth >= 0),
  dedupe_key text not null unique check (length(dedupe_key) between 1 and 300),
  dispatched_at timestamptz,
  dispatch_error text,
  created_at timestamptz not null default now()
);

create index domain_events_business_idx
  on public.domain_events (business_id, occurred_at desc);
create index domain_events_subject_idx
  on public.domain_events (business_id, subject_type, subject_id, occurred_at desc);
create index domain_events_undispatched_idx
  on public.domain_events (created_at)
  where dispatched_at is null;

-- ------------------------------------------ legitimate_interest_assessments
-- A workspace's recorded LIA (ICO: purpose, necessity, balancing). The
-- LEGITIMATE_INTERESTS_REVIEWED contactability state requires an ACTIVE row.
create table public.legitimate_interest_assessments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  purpose text not null check (length(purpose) between 1 and 500),
  necessity text not null check (length(necessity) between 1 and 4000),
  balancing text not null check (length(balancing) between 1 and 4000),
  safeguards text check (safeguards is null or length(safeguards) <= 4000),
  channels text[] not null default '{EMAIL}'
    check (channels <@ array['EMAIL','SMS','WHATSAPP','SOCIAL']::text[]),
  status text not null default 'ACTIVE' check (status in ('DRAFT','ACTIVE','WITHDRAWN')),
  reviewer_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  next_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger legitimate_interest_assessments_set_updated_at
  before update on public.legitimate_interest_assessments
  for each row execute function public.set_updated_at();

create index legitimate_interest_assessments_active_idx
  on public.legitimate_interest_assessments (business_id)
  where status = 'ACTIVE';

-- -------------------------------------------------------------------- RLS
do $$
declare t text;
begin
  foreach t in array array[
    'lead_touches','merge_events','merge_candidates','legitimate_interest_assessments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_business_member(business_id))',
      t || '_select_member', t);
  end loop;

  foreach t in array array['ingest_requests','domain_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- The views run as the caller (security_invoker), so lead_touches' policy is
-- what decides the rows; the grant only lets a member ask.
revoke all on public.lead_first_touch, public.lead_last_touch, public.lead_touch_linear_credit
  from anon, authenticated;
grant select on public.lead_first_touch, public.lead_last_touch, public.lead_touch_linear_credit
  to authenticated;

-- ------------------------------------------------------ emit_domain_event
-- Writes one outbox row and queues its dispatch. Idempotent on dedupe_key:
-- a repeat returns the first row's id with inserted = false and queues
-- nothing.
create or replace function public.emit_domain_event(
  p_business_id uuid,
  p_type text,
  p_subject_type text,
  p_subject_id uuid,
  p_payload jsonb,
  p_dedupe_key text,
  p_causation_id uuid default null,
  p_causation_depth integer default 0,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.domain_events (
    business_id, type, subject_type, subject_id, payload, occurred_at,
    causation_id, causation_depth, dedupe_key
  )
  values (
    p_business_id, p_type, p_subject_type, p_subject_id, coalesce(p_payload, '{}'::jsonb),
    coalesce(p_occurred_at, now()), p_causation_id, coalesce(p_causation_depth, 0), p_dedupe_key
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.domain_events where dedupe_key = p_dedupe_key;
    return jsonb_build_object('id', v_id, 'inserted', false);
  end if;

  insert into public.jobs (business_id, type, payload, priority, idempotency_key)
  values (p_business_id, 'event.dispatch', jsonb_build_object('eventId', v_id), 40,
          'event.dispatch:' || v_id)
  on conflict do nothing;

  return jsonb_build_object('id', v_id, 'inserted', true);
end
$$;

revoke all on function public.emit_domain_event(uuid, text, text, uuid, jsonb, text, uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.emit_domain_event(uuid, text, text, uuid, jsonb, text, uuid, integer, timestamptz)
  to service_role;

-- For triggers: an outbox failure must never fail the business write that
-- caused it. Logged as a WARNING; the write stands.
create or replace function public.emit_domain_event_safe(
  p_business_id uuid,
  p_type text,
  p_subject_type text,
  p_subject_id uuid,
  p_payload jsonb,
  p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null then return; end if;
  perform public.emit_domain_event(p_business_id, p_type, p_subject_type, p_subject_id,
                                   p_payload, p_dedupe_key);
exception when others then
  raise warning 'emit_domain_event % failed: %', p_type, sqlerrm;
end
$$;

revoke all on function public.emit_domain_event_safe(uuid, text, text, uuid, jsonb, text)
  from public, anon, authenticated;

-- --------------------------------------------------- SQL-side emit sites
-- Bookings, suppressions, handoffs, inbound replies and qualification answers
-- are written from many places, several of them owned by other modules (the
-- conversation agent writes pending bookings and handoffs). A trigger is the
-- one emit site that cannot be forgotten by a new writer, and it runs in the
-- same transaction as the change. Each trigger fires once per real change, so
-- the dedupe key includes the transaction id.

create or replace function public.bookings_emit_domain_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
  v_previous text := case when tg_op = 'UPDATE' then old.status else null end;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  v_type := case new.status
    when 'pending' then 'meeting.pending'
    when 'scheduled' then 'meeting.booked'
    when 'cancelled' then 'meeting.cancelled'
    when 'no_show' then 'meeting.no_show'
    else null
  end;
  if v_type is null then return new; end if;

  perform public.emit_domain_event_safe(
    new.business_id, v_type, 'booking', new.id,
    jsonb_build_object(
      'booking_id', new.id, 'lead_id', new.lead_id, 'provider', new.provider,
      'status', new.status, 'previous_status', v_previous,
      'starts_at', new.starts_at, 'ends_at', new.ends_at
    ),
    v_type || ':' || new.id || ':' || txid_current()
  );
  return new;
end
$$;

create trigger bookings_emit_domain_event
  after insert or update of status on public.bookings
  for each row execute function public.bookings_emit_domain_event();

create or replace function public.agent_handoffs_emit_domain_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.emit_domain_event_safe(
    new.business_id, 'ai.escalated', 'lead', new.lead_id,
    jsonb_build_object(
      'handoff_id', new.id, 'lead_id', new.lead_id, 'conversation_id', new.conversation_id,
      'reason', new.reason, 'priority', new.priority
    ),
    'ai.escalated:' || new.id
  );
  return new;
end
$$;

create trigger agent_handoffs_emit_domain_event
  after insert on public.agent_handoffs
  for each row execute function public.agent_handoffs_emit_domain_event();

create or replace function public.messages_emit_domain_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.direction <> 'inbound' or new.lead_id is null then return new; end if;

  if tg_op = 'INSERT' then
    perform public.emit_domain_event_safe(
      new.business_id, 'reply.received', 'message', new.id,
      jsonb_build_object('message_id', new.id, 'lead_id', new.lead_id, 'channel', new.channel,
                         'classification', new.reply_classification),
      'reply.received:' || new.id
    );
  elsif new.reply_classification is not null
        and new.reply_classification is distinct from old.reply_classification then
    -- Internal (not in the webhook catalogue): what re-scores a lead once the
    -- reply has been understood.
    perform public.emit_domain_event_safe(
      new.business_id, 'reply.classified', 'message', new.id,
      jsonb_build_object('message_id', new.id, 'lead_id', new.lead_id,
                         'classification', new.reply_classification),
      'reply.classified:' || new.id || ':' || new.reply_classification
    );
  end if;
  return new;
end
$$;

create trigger messages_emit_domain_event
  after insert or update of reply_classification on public.messages
  for each row execute function public.messages_emit_domain_event();

create or replace function public.qualification_answers_emit_domain_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.answer_value is not distinct from old.answer_value
     and new.evaluation is not distinct from old.evaluation then
    return new;
  end if;
  -- Internal: re-score on a qualification answer.
  perform public.emit_domain_event_safe(
    new.business_id, 'qualification.answered', 'lead', new.lead_id,
    jsonb_build_object('answer_id', new.id, 'lead_id', new.lead_id,
                       'question_id', new.question_id, 'evaluation', new.evaluation),
    'qualification.answered:' || new.id || ':' || txid_current()
  );
  return new;
end
$$;

create trigger qualification_answers_emit_domain_event
  after insert or update of answer_value, evaluation on public.qualification_answers
  for each row execute function public.qualification_answers_emit_domain_event();

-- ------------------------------------------- per-channel opt-out (§5)
-- `leads.opted_out` becomes derived: true iff an ALL-channel OPT_OUT,
-- COMPLAINT or LEGAL suppression stands for one of the lead's addresses. A
-- channel-scoped opt-out (a carrier STOP on SMS) blocks that channel through
-- suppression and leaves the lead-wide flag alone, so START on SMS can
-- re-permit SMS without being defeated by a stored flag.

create index if not exists suppression_entries_all_email_idx
  on public.suppression_entries (email)
  where channel = 'ALL' and email is not null;
create index if not exists suppression_entries_all_phone_idx
  on public.suppression_entries (phone_e164)
  where channel = 'ALL' and phone_e164 is not null;

create or replace function public.lead_all_channel_opt_out(
  p_business_id uuid,
  p_email text,
  p_phone text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.suppression_entries s
     where (s.business_id = p_business_id or s.business_id is null)
       and s.channel = 'ALL'
       and s.reason in ('OPT_OUT', 'COMPLAINT', 'LEGAL')
       and (s.expires_at is null or s.expires_at > now())
       and (
         (p_email is not null and s.email = p_email::citext)
         or (p_phone is not null and s.phone_e164 = p_phone)
       )
  );
$$;

revoke all on function public.lead_all_channel_opt_out(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lead_all_channel_opt_out(uuid, text, text) to service_role;

-- Backfill first, in the safe direction: a lead flagged opted out with no
-- recipient opt-out on the list at all (a flag written before 0069) gets an
-- ALL-channel OPT_OUT, so deriving the flag never un-opts-out anybody. A lead
-- whose opt-outs are already channel-scoped (0111 split an ALL row when they
-- texted START) is left alone: those rows keep blocking their channels, and
-- the lead-wide flag was the bug the Phase 0 log describes.
insert into public.suppression_entries (business_id, email, channel, reason, source, note)
select distinct l.business_id, lower(btrim(l.email))::citext, 'ALL', 'OPT_OUT', 'MIGRATION_0123',
       'Carried over from leads.opted_out when the flag became derived (0123).'
  from public.leads l
 where l.opted_out
   and nullif(btrim(l.email), '') is not null
   and not exists (
     select 1 from public.suppression_entries s
      where (s.business_id = l.business_id or s.business_id is null)
        and s.reason in ('OPT_OUT', 'COMPLAINT', 'LEGAL')
        and (s.email = lower(btrim(l.email))::citext
             or (nullif(l.phone_normalized, '') is not null and s.phone_e164 = l.phone_normalized))
   )
on conflict do nothing;

insert into public.suppression_entries (business_id, phone_e164, channel, reason, source, note)
select distinct l.business_id, l.phone_normalized, 'ALL', 'OPT_OUT', 'MIGRATION_0123',
       'Carried over from leads.opted_out when the flag became derived (0123).'
  from public.leads l
 where l.opted_out
   and nullif(l.phone_normalized, '') is not null
   and not exists (
     select 1 from public.suppression_entries s
      where (s.business_id = l.business_id or s.business_id is null)
        and s.reason in ('OPT_OUT', 'COMPLAINT', 'LEGAL')
        and (s.phone_e164 = l.phone_normalized
             or (nullif(btrim(l.email), '') is not null and s.email = lower(btrim(l.email))::citext))
   )
on conflict do nothing;

create or replace function public.leads_derive_opted_out()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := nullif(lower(btrim(new.email)), '');
  v_phone text := coalesce(nullif(new.phone_normalized, ''), nullif(btrim(new.phone), ''));
begin
  -- A lead with no address at all (a social DM thread) cannot be derived from
  -- the list, so whatever was written stands.
  if v_email is null and v_phone is null then
    return new;
  end if;
  new.opted_out := public.lead_all_channel_opt_out(new.business_id, v_email, v_phone);
  return new;
end
$$;

create trigger leads_derive_opted_out
  before insert or update of opted_out, email, phone, phone_normalized on public.leads
  for each row execute function public.leads_derive_opted_out();

create or replace function public.suppression_entries_sync_leads()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec record;
begin
  -- Re-derive for the addresses on both the old and the new row: a delete (a
  -- START lifting an opt-out) matters as much as an insert.
  for rec in
    select * from (values
      (case when tg_op <> 'INSERT' then old.business_id end,
       case when tg_op <> 'INSERT' then old.email::text end,
       case when tg_op <> 'INSERT' then old.phone_e164 end,
       tg_op <> 'INSERT'),
      (case when tg_op <> 'DELETE' then new.business_id end,
       case when tg_op <> 'DELETE' then new.email::text end,
       case when tg_op <> 'DELETE' then new.phone_e164 end,
       tg_op <> 'DELETE')
    ) as v(business_id, email, phone, present)
  loop
    continue when not rec.present or (rec.email is null and rec.phone is null);

    update public.leads l
       set opted_out = public.lead_all_channel_opt_out(
             l.business_id, nullif(lower(btrim(l.email)), ''),
             coalesce(nullif(l.phone_normalized, ''), nullif(btrim(l.phone), '')))
     where (rec.business_id is null or l.business_id = rec.business_id)
       and (
         (rec.email is not null and l.email_normalized = lower(rec.email))
         or (rec.phone is not null and l.phone_normalized = rec.phone)
       );
  end loop;

  -- contact.unsubscribed / contact.suppressed, per lead the address belongs to.
  if tg_op = 'INSERT' and new.business_id is not null then
    declare
      v_type text := case when new.reason = 'OPT_OUT' then 'contact.unsubscribed' else 'contact.suppressed' end;
      v_lead uuid;
      v_found boolean := false;
    begin
      for v_lead in
        select l.id from public.leads l
         where l.business_id = new.business_id
           and ((new.email is not null and l.email_normalized = lower(new.email::text))
                or (new.phone_e164 is not null and l.phone_normalized = new.phone_e164))
         limit 25
      loop
        v_found := true;
        perform public.emit_domain_event_safe(
          new.business_id, v_type, 'lead', v_lead,
          jsonb_build_object('lead_id', v_lead, 'suppression_id', new.id, 'channel', new.channel,
                             'reason', new.reason, 'source', new.source),
          v_type || ':' || new.id || ':' || v_lead
        );
      end loop;
      if not v_found then
        perform public.emit_domain_event_safe(
          new.business_id, v_type, 'contact', null,
          jsonb_build_object('suppression_id', new.id, 'channel', new.channel, 'reason', new.reason,
                             'source', new.source, 'email', new.email, 'phone', new.phone_e164),
          v_type || ':' || new.id
        );
      end if;
    end;
  end if;

  return null;
end
$$;

create trigger suppression_entries_sync_leads
  after insert or update or delete on public.suppression_entries
  for each row execute function public.suppression_entries_sync_leads();

-- Bring every existing flag into line with the list now that it is derived.
-- Only rows whose flag actually changes are touched (the backfill above means
-- that can only be true -> false for a channel-scoped opt-out).
update public.leads l
   set opted_out = not l.opted_out
 where (nullif(btrim(l.email), '') is not null
        or coalesce(nullif(l.phone_normalized, ''), nullif(btrim(l.phone), '')) is not null)
   and l.opted_out is distinct from public.lead_all_channel_opt_out(
         l.business_id, nullif(lower(btrim(l.email)), ''),
         coalesce(nullif(l.phone_normalized, ''), nullif(btrim(l.phone), '')));

-- ----------------------------------------- contactability states (§6)
alter table public.contactability_results
  add column if not exists state text not null default 'UNKNOWN';

alter table public.contactability_results
  add constraint contactability_results_state_check
  check (state in (
    'PERMITTED','CONSENTED','SOFT_OPT_IN','LEGITIMATE_INTERESTS_REVIEWED','EXISTING_CUSTOMER',
    'REPLY_WINDOW_OPEN','TEMPORARILY_PAUSED','LEGAL_HOLD',
    'OPTED_OUT','UNSUBSCRIBED','DO_NOT_CONTACT','BLOCKED',
    'HARD_BOUNCE','COMPLAINT','INVALID',
    'UNKNOWN'
  ));

-- Derived, never set by hand: whatever a writer passes is overwritten. Kept in
-- step with the pure mirror src/lib/policy/contactability-state.ts
-- (tests/per-channel-opt-out.test.ts asserts the vocabulary matches).
create or replace function public.contactability_results_derive_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_suppression text := new.evidence_json #>> '{suppression,reason}';
  v_consent text := new.evidence_json ->> 'consent_status';
begin
  new.state := case
    when v_suppression is not null then
      case v_suppression
        when 'BOUNCE' then 'HARD_BOUNCE'
        when 'COMPLAINT' then 'COMPLAINT'
        when 'LEGAL' then 'LEGAL_HOLD'
        when 'INVALID' then 'INVALID'
        when 'MANUAL' then 'DO_NOT_CONTACT'
        when 'PROVIDER' then 'BLOCKED'
        else 'OPTED_OUT'
      end
    when new.reason_code = 'BLOCKED_OPT_OUT' or v_consent = 'WITHDRAWN' then 'OPTED_OUT'
    when new.reason_code = 'BLOCKED_INVALID_CONTACT' then 'INVALID'
    when new.reason_code in ('BLOCKED_QUIET_HOURS','BLOCKED_DAILY_LIMIT','BLOCKED_MONTHLY_LIMIT',
                             'BLOCKED_COST_BUDGET','BLOCKED_PROVIDER','BLOCKED_DOMAIN_HEALTH',
                             'BLOCKED_BUSINESS_STATE') then 'TEMPORARILY_PAUSED'
    when new.result = 'ALLOWED' then
      case
        when new.relationship_type = 'EXISTING_CUSTOMER' then 'EXISTING_CUSTOMER'
        when v_consent = 'GRANTED' or new.relationship_type = 'EXPLICIT_MARKETING_CONSENT' then 'CONSENTED'
        when new.relationship_type in ('FOUND_BY_US','UNKNOWN','IMPORTED')
             and exists (
               select 1 from public.legitimate_interest_assessments a
                where a.business_id = new.business_id
                  and a.status = 'ACTIVE'
                  and new.channel = any (a.channels)
             ) then 'LEGITIMATE_INTERESTS_REVIEWED'
        else 'PERMITTED'
      end
    when new.result = 'BLOCKED' then 'BLOCKED'
    else 'UNKNOWN'
  end;
  return new;
end
$$;

create trigger contactability_results_derive_state
  before insert or update on public.contactability_results
  for each row execute function public.contactability_results_derive_state();

update public.contactability_results set evaluated_at = evaluated_at;

-- ------------------------------------ promotion links to an existing lead
-- 0114's function, unchanged except for the block marked "0123": a prospect
-- whose email (or phone, where one side has no email) already belongs to a
-- live lead is linked to that lead instead of creating a duplicate (design §2
-- "a prospect match links the promotion"). A phone shared with a *different*
-- email is a conflict: the new lead is created without the shared phone as
-- its messaging key and the pair is parked for a person.
create or replace function public.promote_reviewed_prospect(
  p_business_id uuid,
  p_prospect_id uuid,
  p_user_id uuid,
  p_relationship_type text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  p public.prospects;
  c public.prospect_companies;
  result_id uuid;
  v_relationship_type text;
  v_relationship_detail text;
  v_app_key text;
  v_intake_method text;
  v_created_via text;
  v_email text;
  v_existing uuid;
  v_existing_email text;
  v_phone_conflict uuid;
begin
  select * into p
    from public.prospects
   where id = p_prospect_id
     and business_id = p_business_id
   for update;

  if not found then
    raise exception 'Prospect not found';
  end if;

  if p.promoted_to_lead_id is not null then
    return p.promoted_to_lead_id;
  end if;

  if p.outreach_eligibility = 'SUPPRESSED' or p.status = 'SUPPRESSED' then
    raise exception 'Suppressed prospects cannot be promoted';
  end if;

  if p.replied_at is null and p.source_run_id is not null then
    raise exception 'Record engagement before promoting a cold prospect';
  end if;

  if p.replied_at is not null then
    v_relationship_type := 'THEY_CONTACTED_US';
    v_relationship_detail := 'Promoted from a sourced prospect after they replied';
  elsif p_relationship_type is null then
    v_relationship_type := 'IMPORTED';
    v_relationship_detail := 'Promoted from a prospect already known to the business (connector, import or manual add), approved by a reviewer';
  else
    if p_relationship_type not in (
      'THEY_CONTACTED_US','EXISTING_CUSTOMER','REFERRAL','REQUESTED_INFORMATION',
      'EXISTING_BUSINESS_RELATIONSHIP','ACCEPTED_SOCIAL_CONNECTION','IMPORTED','OTHER'
    ) then
      raise exception 'Invalid relationship type for promotion';
    end if;
    v_relationship_type := p_relationship_type;
    v_relationship_detail := 'Promoted from a prospect already known to the business, approved by a reviewer who confirmed the relationship';
  end if;

  -- 0123: an existing live lead for the same person is linked, not duplicated.
  v_email := nullif(lower(btrim(p.email)), '');
  if v_email is not null then
    select l.id into v_existing
      from public.leads l
     where l.business_id = p_business_id
       and l.archived_at is null and not l.is_test and l.identity_duplicate_of is null
       and l.email_normalized = v_email
     order by l.created_at
     limit 1;
  end if;
  if v_existing is null and nullif(p.phone_e164, '') is not null then
    select l.id, l.email_normalized into v_existing, v_existing_email
      from public.leads l
     where l.business_id = p_business_id
       and l.archived_at is null and not l.is_test and l.identity_duplicate_of is null
       and l.phone_normalized = p.phone_e164
     order by l.created_at
     limit 1;
    if v_existing is not null and v_email is not null and v_existing_email is not null
       and v_existing_email <> v_email then
      -- Same phone, different email: never merged.
      v_phone_conflict := v_existing;
      v_existing := null;
    end if;
  end if;

  if v_existing is not null then
    update public.prospects
       set status = 'CONVERTED',
           promoted_to_lead_id = v_existing,
           promoted_at = now(),
           approved_by = coalesce(approved_by, p_user_id),
           approved_at = coalesce(approved_at, now())
     where id = p.id;

    update public.conversations set lead_id = v_existing
     where business_id = p.business_id and prospect_id = p.id;
    update public.messages set lead_id = v_existing
     where business_id = p.business_id and prospect_id = p.id;

    insert into public.merge_events (business_id, lead_id, rule, confidence, before, after, actor_type, actor_id)
    values (p_business_id, v_existing, 'PROSPECT_PROMOTION', 1,
            '{}'::jsonb, jsonb_build_object('prospect_id', p.id),
            case when p_user_id is null then 'SYSTEM' else 'USER' end, p_user_id::text);

    return v_existing;
  end if;
  -- end 0123

  if p.source_run_id is null then
    select i.app_key into v_app_key
      from public.workspace_app_events e
      join public.workspace_app_installs i on i.id = e.install_id
     where e.business_id = p.business_id
       and e.prospect_id = p.id
     limit 1;
  end if;

  v_intake_method := case
    when p.source_run_id is not null then 'CLIENTTURN_SOURCING'
    when v_app_key is not null and lower(v_app_key) = 'pipedrive' then 'PIPEDRIVE'
    when v_app_key is not null then 'API'
    when p.source_provider = 'import' then 'IMPORT'
    when p.source_provider = 'manual_prospect' then 'MANUAL'
    when p.source_provider = 'meta_webhook'
      or p.source_provider like 'meta%engagement' then 'META'
    else 'OTHER'
  end;

  v_created_via := case
    when p.source_run_id is not null then 'SOURCING'
    when p.is_test then 'TEST'
    when v_app_key is not null then 'API'
    when p.source_provider = 'import' then 'IMPORT'
    when p.source_provider = 'manual_prospect' then 'MANUAL_WIZARD'
    when p.source_provider = 'meta_webhook'
      or p.source_provider like '%engagement' then 'INBOUND'
    else null
  end;

  if p.company_id is not null then
    select * into c
      from public.prospect_companies
     where id = p.company_id
       and business_id = p_business_id;
  end if;

  insert into public.leads (
    business_id,
    first_name,
    last_name,
    email,
    phone,
    phone_normalized,
    company_name,
    status,
    agent_id,
    automation_active,
    promoted_from_prospect_id,
    promoted_at,
    source_campaign_id,
    sourcing_run_id,
    conversion_goal_id,
    intake_method,
    created_via,
    created_by_user_id,
    relationship_type,
    subscriber_type
  )
  values (
    p.business_id,
    p.first_name,
    p.last_name,
    p.email,
    p.phone_e164,
    -- 0123: a phone already owned by a lead with a different email is not
    -- made this lead's messaging key; the pair goes to review below.
    case when v_phone_conflict is null then p.phone_e164 else null end,
    c.name,
    'NEW',
    p.agent_id,
    false,
    p.id,
    now(),
    p.campaign_id,
    p.source_run_id,
    (select cg.id
       from public.conversion_goals cg
      where cg.business_id = p_business_id
        and cg.is_default
        and cg.active
      limit 1),
    v_intake_method,
    v_created_via,
    p_user_id,
    v_relationship_type,
    p.subscriber_type
  )
  returning id into result_id;

  if v_phone_conflict is not null then
    insert into public.merge_candidates (business_id, lead_a_id, lead_b_id, reason, evidence)
    values (p_business_id, v_phone_conflict, result_id, 'PHONE_CONFLICT',
            jsonb_build_object('phone', p.phone_e164, 'detected_by', 'promote_reviewed_prospect'))
    on conflict do nothing;
  end if;

  insert into public.contact_permissions (
    business_id, subject_type, subject_id, email, phone_e164,
    relationship_type, relationship_detail,
    consent_status, consent_source, lawful_basis_tag,
    subscriber_type, recorded_by
  )
  values (
    p_business_id, 'LEAD', result_id, p.email, p.phone_e164,
    v_relationship_type, v_relationship_detail,
    'UNKNOWN', 'PROMOTION', 'LEGITIMATE_INTEREST_B2B',
    p.subscriber_type, p_user_id
  )
  on conflict (business_id, subject_type, subject_id) do nothing;

  update public.prospects
     set status = 'CONVERTED',
         promoted_to_lead_id = result_id,
         promoted_at = now(),
         approved_by = coalesce(approved_by, p_user_id),
         approved_at = coalesce(approved_at, now())
   where id = p.id;

  update public.conversations
     set lead_id = result_id
   where business_id = p.business_id
     and prospect_id = p.id;

  update public.messages
     set lead_id = result_id
   where business_id = p.business_id
     and prospect_id = p.id;

  return result_id;
end
$$;

revoke all on function public.promote_reviewed_prospect(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.promote_reviewed_prospect(uuid, uuid, uuid, text)
  to service_role;
