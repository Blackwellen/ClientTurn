-- 0124_data_rights: suppression that survives erasure, an erasure executor,
-- an append-only record of every data-rights action, DSAR intake and
-- retention enforcement (Revenue Engine Phase 6, design §§15, 83-87).
--
-- Four distinct acts, and the product must never blur them:
--
--   * ARCHIVE   (exists) hidden from active work, everything retained.
--   * SUPPRESS  never contact again. Destination-keyed; survives everything.
--   * ANONYMISE personal fields replaced, message bodies redacted, AI summaries
--               and extracted facts removed, attribution kept. The person's
--               suppression rows become salted hashes (decision Q5) so they
--               keep blocking contact without holding a readable address.
--   * DELETE    anonymise, then hard-delete what has no retention need.
--               Billing and audit rows survive with pseudonymous ids only.
--
-- Why the executor is SQL and not TypeScript: an erasure touches ~50 tables.
-- Done as fifty PostgREST calls, a failure half way leaves a person partly
-- erased with no record of which half. One security-definer function runs in
-- one transaction: it either all happened, or none of it did, and the
-- data_rights_actions row describing it is written in the same transaction.
-- The TypeScript side (src/lib/data-rights/coverage.ts) holds the rule list
-- and tests/data-rights.test.ts fails when a new table holding personal data
-- about a lead or prospect is added without a rule here.

select set_config('search_path', 'public, extensions', true);

-- ----------------------------------------------------------- platform_secrets
-- Server-only key/value secrets generated inside the database. RLS on and no
-- policy: anon and authenticated reach nothing; only security-definer
-- functions read it. The salt never leaves the database -- hashes are
-- computed by suppression_hash(), never in application code.
create table if not exists public.platform_secrets (
  key text primary key check (length(key) between 1 and 100),
  value text not null,
  created_at timestamptz not null default now()
);

alter table public.platform_secrets enable row level security;
revoke all on public.platform_secrets from public, anon, authenticated;

insert into public.platform_secrets (key, value)
values ('suppression_hash_salt', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- ---------------------------------------------------------- suppression_hash
-- sha256 hex of (salt || normalised value). Normalisation matches
-- src/lib/data-rights/hash.ts, which the tests pin:
--   email  -> lower(trim)
--   phone  -> trim, then only digits and '+'
--   social -> trim
create or replace function public.suppression_hash(p_kind text, p_value text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_norm text;
  v_salt text;
begin
  if p_value is null then
    return null;
  end if;

  v_norm := case p_kind
    when 'email' then lower(btrim(p_value))
    when 'phone' then regexp_replace(btrim(p_value), '[^0-9+]', '', 'g')
    when 'social' then btrim(p_value)
    else null
  end;
  if v_norm is null or v_norm = '' then
    return null;
  end if;

  select s.value into v_salt from public.platform_secrets s where s.key = 'suppression_hash_salt';
  -- Fails closed: check_suppression raising is read by every caller as a
  -- blocked send, never as "not suppressed".
  if v_salt is null then
    raise exception 'suppression hash salt is missing';
  end if;

  return encode(digest(v_salt || v_norm, 'sha256'), 'hex');
end
$$;

revoke all on function public.suppression_hash(text, text) from public, anon, authenticated;
grant execute on function public.suppression_hash(text, text) to service_role;

-- ------------------------------------------------------ suppression_entries
alter table public.suppression_entries
  add column if not exists email_hash text
    check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists phone_hash text
    check (phone_hash is null or phone_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists social_hash text
    check (social_hash is null or social_hash ~ '^[0-9a-f]{64}$');

comment on column public.suppression_entries.email_hash is
  'Set when the person was erased (0124, decision Q5): suppression_hash(''email'', address). The plaintext column is then null.';

-- A row may now carry only a hash. It must still carry *something*.
alter table public.suppression_entries
  drop constraint if exists suppression_entries_destination;
alter table public.suppression_entries
  add constraint suppression_entries_destination
  check (
    email is not null or phone_e164 is not null or social_identifier is not null
    or email_hash is not null or phone_hash is not null or social_hash is not null
  );

create unique index if not exists suppression_entries_email_hash_idx
  on public.suppression_entries (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), email_hash, channel)
  where email_hash is not null;
create unique index if not exists suppression_entries_phone_hash_idx
  on public.suppression_entries (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), phone_hash, channel)
  where phone_hash is not null;
create unique index if not exists suppression_entries_social_hash_idx
  on public.suppression_entries (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), social_hash, channel)
  where social_hash is not null;

-- --------------------------------------------------------- check_suppression
-- Same signature, return shape, ordering and grants as 0037. The only change
-- is that a hashed row matches: an erased person stays suppressed.
create or replace function public.check_suppression(
  p_business_id uuid,
  p_channel text,
  p_email citext default null,
  p_phone text default null,
  p_social text default null
)
returns table (reason text, scope text, created_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with h as (
    select
      public.suppression_hash('email', p_email::text) as email_hash,
      public.suppression_hash('phone', p_phone) as phone_hash,
      public.suppression_hash('social', p_social) as social_hash
  )
  select
    s.reason,
    case when s.business_id is null then 'PLATFORM' else 'WORKSPACE' end,
    s.created_at
  from public.suppression_entries s, h
  where (s.business_id = p_business_id or s.business_id is null)
    and (s.channel = p_channel or s.channel = 'ALL')
    and (s.expires_at is null or s.expires_at > now())
    and (
      (p_email is not null and s.email = p_email)
      or (p_phone is not null and s.phone_e164 = p_phone)
      or (p_social is not null and s.social_identifier = p_social)
      or (h.email_hash is not null and s.email_hash = h.email_hash)
      or (h.phone_hash is not null and s.phone_hash = h.phone_hash)
      or (h.social_hash is not null and s.social_hash = h.social_hash)
    )
  order by (s.business_id is null) desc, s.created_at asc
  limit 1;
$$;

revoke all on function public.check_suppression(uuid, text, citext, text, text) from public, anon, authenticated;

-- ---------------------------------------------------- lead_all_channel_opt_out
-- 0123's derivation of leads.opted_out, extended the same way. Without this,
-- hashing an erased person's opt-out would re-derive any *other* lead holding
-- the same address as no longer opted out.
create or replace function public.lead_all_channel_opt_out(
  p_business_id uuid,
  p_email text,
  p_phone text
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
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
         or (p_email is not null and s.email_hash = public.suppression_hash('email', p_email))
         or (p_phone is not null and s.phone_hash = public.suppression_hash('phone', p_phone))
       )
  );
$$;

revoke all on function public.lead_all_channel_opt_out(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lead_all_channel_opt_out(uuid, text, text) to service_role;

-- ----------------------------------------------------- ai_budget_decisions
-- 0122 made the table append-only with a BEFORE UPDATE trigger, but its
-- lead_id is ON DELETE SET NULL -- which is an UPDATE. Every hard delete of a
-- lead with a budget decision therefore failed. The one update now permitted
-- is exactly that referential action: lead_id to null, nothing else changed.
create or replace function public.ai_budget_decisions_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.lead_id is not null
     and new.lead_id is null
     and (to_jsonb(new) - 'lead_id') = (to_jsonb(old) - 'lead_id') then
    return new;
  end if;
  raise exception 'ai_budget_decisions is append-only';
end;
$$;

-- ------------------------------------------------------ anonymised markers
alter table public.leads
  add column if not exists anonymised_at timestamptz;
alter table public.prospects
  add column if not exists anonymised_at timestamptz;

comment on column public.leads.anonymised_at is
  'Set by data_rights_scrub (0124). The row survives for attribution; every personal field is null.';

-- ------------------------------------------------------- data_rights_actions
-- Append-only. One row per data-rights act, written in the same transaction
-- as the act for ANONYMISE / DELETE / SUPPRESS / RESTRICT. `summary` states
-- exactly what was removed, redacted and retained, per table, and never
-- contains personal data itself. subject_id is kept after a delete: with the
-- lead gone it is a pseudonymous id, which is what "retained with a
-- pseudonymous id" means. No FKs besides business_id, deliberately: an ON
-- DELETE SET NULL is an UPDATE, which the append-only trigger refuses.
create table if not exists public.data_rights_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  subject_type text not null check (subject_type in ('LEAD', 'PROSPECT')),
  subject_id uuid,
  action text not null
    check (action in ('ARCHIVE', 'SUPPRESS', 'ANONYMISE', 'DELETE', 'EXPORT', 'RESTRICT', 'RECTIFY')),
  requested_by uuid,
  caller text check (caller is null or caller in ('UI', 'COPILOT', 'AGENT', 'MCP', 'API', 'SYSTEM')),
  reason text check (reason is null or length(reason) <= 500),
  privacy_request_id uuid,
  performed_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object')
);

create index if not exists data_rights_actions_subject_idx
  on public.data_rights_actions (business_id, subject_type, subject_id, performed_at desc);
create index if not exists data_rights_actions_business_idx
  on public.data_rights_actions (business_id, performed_at desc);

create or replace function public.data_rights_actions_reject_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'data_rights_actions is append-only';
end;
$$;

drop trigger if exists data_rights_actions_no_update on public.data_rights_actions;
create trigger data_rights_actions_no_update
  before update on public.data_rights_actions
  for each row execute function public.data_rights_actions_reject_update();

-- Server-only: read behind requireRole('admin') with the service role.
alter table public.data_rights_actions enable row level security;
revoke all on public.data_rights_actions from anon, authenticated;

-- ---------------------------------------------------------- privacy_requests
-- 0057 created the table with no intake. Extended, not duplicated.
alter table public.privacy_requests
  drop constraint if exists privacy_requests_request_type_check;
alter table public.privacy_requests
  add constraint privacy_requests_request_type_check
  check (request_type in (
    -- 0057's vocabulary, kept so existing rows stay valid.
    'EXPORT', 'DELETION', 'ACCESS', 'MARKETING_DATA',
    -- UK GDPR rights and the DUAA complaint route.
    'ERASURE', 'RECTIFICATION', 'RESTRICTION', 'OBJECTION', 'COMPLAINT',
    -- Art 22C: contest a significant solely-automated decision.
    'CONTEST_DECISION'
  ));

alter table public.privacy_requests
  add column if not exists subject_phone text
    check (subject_phone is null or length(subject_phone) <= 40),
  add column if not exists subject_context text
    check (subject_context is null or length(subject_context) <= 2000),
  add column if not exists details text
    check (details is null or length(details) <= 4000),
  add column if not exists source text not null default 'ADMIN'
    check (source in ('PUBLIC_FORM', 'WORKSPACE', 'ADMIN')),
  add column if not exists verification_status text not null default 'NOT_REQUIRED'
    check (verification_status in ('PENDING', 'VERIFIED', 'NOT_REQUIRED', 'EXPIRED')),
  -- sha256 hex of the emailed token. The token itself is never stored.
  add column if not exists verification_token_hash text
    check (verification_token_hash is null or verification_token_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists verification_expires_at timestamptz,
  add column if not exists verified_at timestamptz,
  -- DUAA: acknowledge a data-protection complaint within 30 days of receipt.
  add column if not exists acknowledge_by timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists subject_lead_id uuid references public.leads(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists privacy_requests_verification_token_idx
  on public.privacy_requests (verification_token_hash)
  where verification_token_hash is not null;
create index if not exists privacy_requests_business_idx
  on public.privacy_requests (business_id, status, received_at desc);

-- The clocks are set by the database so no writer can forget them:
--   acknowledge_by = received + 30 days (DUAA complaint acknowledgement)
--   due_at         = received + 1 month  (UK GDPR Art 12(3) response)
create or replace function public.privacy_requests_set_clocks()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.received_at := coalesce(new.received_at, now());
  if new.acknowledge_by is null then
    new.acknowledge_by := new.received_at + interval '30 days';
  end if;
  if new.due_at is null then
    new.due_at := new.received_at + interval '1 month';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists privacy_requests_set_clocks on public.privacy_requests;
create trigger privacy_requests_set_clocks
  before insert or update on public.privacy_requests
  for each row execute function public.privacy_requests_set_clocks();

update public.privacy_requests
   set acknowledge_by = received_at + interval '30 days'
 where acknowledge_by is null;

-- ------------------------------------------------------------- scrub helpers
create or replace function public.data_rights_count(
  p_counts jsonb, p_table text, p_verb text, p_rows integer
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_rows, 0) = 0 then p_counts
    else p_counts || jsonb_build_object(
      p_table,
      coalesce(p_counts -> p_table, '{}'::jsonb)
        || jsonb_build_object(p_verb, coalesce((p_counts -> p_table ->> p_verb)::integer, 0) + p_rows)
    )
  end;
$$;

-- Keys removed from audit_log.metadata and domain_events.payload. Everything
-- else in those rows (action, ids, risk, caller, timestamps) is retained.
create or replace function public.data_rights_personal_keys()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select array[
    'before', 'after', 'email', 'phone', 'phone_e164', 'name', 'first_name',
    'last_name', 'full_name', 'body', 'note', 'notes', 'subject', 'summary',
    'to', 'from', 'message', 'address', 'postcode', 'company_name', 'answers'
  ]::text[];
$$;

-- --------------------------------------------------------- data_rights_scrub
-- Anonymises one person in one workspace, in place. Idempotent: a second run
-- matches nothing new and returns zero counts. Returns null when the subject
-- does not exist in this workspace.
--
-- The rule for every table is declared in src/lib/data-rights/coverage.ts; a
-- table named there with REDACT / REMOVE must appear in this body, and one
-- marked RETAIN must appear in the retained list at the end.
create or replace function public.data_rights_scrub(
  p_business_id uuid,
  p_subject_type text,
  p_subject_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_lead_id uuid;
  v_lead_email text;
  v_lead_phone text;
  v_lead_phone_normalized text;
  v_lead_telephone text;
  v_lead_external_id text;
  v_lead_from_prospect uuid;
  v_prospects uuid[] := '{}';
  v_conversations uuid[] := '{}';
  v_messages uuid[] := '{}';
  v_agent_runs uuid[] := '{}';
  v_v4_runs uuid[] := '{}';
  v_emails text[] := '{}';
  v_phones text[] := '{}';
  v_socials text[] := '{}';
  v_needles text[] := '{}';
  v_counts jsonb := '{}'::jsonb;
  v_keys text[] := public.data_rights_personal_keys();
  n integer;
begin
  if p_subject_type not in ('LEAD', 'PROSPECT') then
    raise exception 'unknown subject type %', p_subject_type;
  end if;

  -- A prospect that became a lead is the same person: erase the lead.
  if p_subject_type = 'PROSPECT' then
    select p.promoted_to_lead_id into v_lead_id
      from public.prospects p
     where p.id = p_subject_id and p.business_id = p_business_id;
    if not found then
      return null;
    end if;
    if v_lead_id is null then
      v_prospects := array[p_subject_id];
    end if;
  else
    v_lead_id := p_subject_id;
  end if;

  if v_lead_id is not null then
    -- Scalars rather than a record: a record left unassigned on the prospect
    -- path would raise when its fields are referenced below.
    select l.email, l.phone, l.phone_normalized, l.telephone, l.external_id,
           l.promoted_from_prospect_id
      into v_lead_email, v_lead_phone, v_lead_phone_normalized, v_lead_telephone,
           v_lead_external_id, v_lead_from_prospect
      from public.leads l
     where l.id = v_lead_id and l.business_id = p_business_id
     for update;
    if not found then
      return null;
    end if;

    select coalesce(array_agg(distinct p.id), '{}') into v_prospects
      from public.prospects p
     where p.business_id = p_business_id
       and (p.promoted_to_lead_id = v_lead_id or p.id = v_lead_from_prospect);
  end if;

  select coalesce(array_agg(c.id), '{}') into v_conversations
    from public.conversations c
   where c.business_id = p_business_id
     and ((v_lead_id is not null and c.lead_id = v_lead_id) or c.prospect_id = any(v_prospects));

  select coalesce(array_agg(m.id), '{}') into v_messages
    from public.messages m
   where m.business_id = p_business_id
     and (m.conversation_id = any(v_conversations)
          or (v_lead_id is not null and m.lead_id = v_lead_id)
          or m.prospect_id = any(v_prospects));

  -- ------------------------------------------------ the person's addresses
  select coalesce(array_agg(distinct e), '{}') into v_emails
    from (
      select nullif(lower(btrim(v_lead_email)), '') as e
      union select lower(btrim(p.email::text)) from public.prospects p
       where p.id = any(v_prospects) and p.email is not null
      union select lower(btrim(cp.email::text)) from public.contact_permissions cp
       where cp.business_id = p_business_id and cp.email is not null
         and ((cp.subject_type = 'LEAD' and cp.subject_id = v_lead_id)
              or (cp.subject_type = 'PROSPECT' and cp.subject_id = any(v_prospects)))
    ) x
   where e is not null and e <> '';

  select coalesce(array_agg(distinct ph), '{}') into v_phones
    from (
      select nullif(v_lead_phone_normalized, '') as ph
      union select nullif(btrim(v_lead_phone), '')
      union select nullif(btrim(v_lead_telephone), '')
      union select p.phone_e164 from public.prospects p
       where p.id = any(v_prospects) and p.phone_e164 is not null
      union select cp.phone_e164 from public.contact_permissions cp
       where cp.business_id = p_business_id and cp.phone_e164 is not null
         and ((cp.subject_type = 'LEAD' and cp.subject_id = v_lead_id)
              or (cp.subject_type = 'PROSPECT' and cp.subject_id = any(v_prospects)))
    ) x
   where ph is not null and ph <> '';

  -- A social thread's suppression key is the conversation's external thread
  -- id (send-store.socialThreadAddress).
  select coalesce(array_agg(distinct c.external_thread_id), '{}') into v_socials
    from public.conversations c
   where c.id = any(v_conversations) and c.external_thread_id is not null;

  v_needles := v_emails || v_phones;
  if coalesce(length(v_lead_external_id), 0) >= 6 then
    v_needles := v_needles || lower(v_lead_external_id);
  end if;

  -- ------------------------------------ suppression: plaintext -> salted hash
  -- Only this workspace's rows. A platform-wide row (business_id null) is
  -- ClientTurn's own list, not the workspace's to transform.
  --
  -- A plaintext row whose hashed twin already exists (an earlier erasure of
  -- the same address) is removed rather than hashed into a unique-index
  -- collision -- the twin keeps blocking.
  delete from public.suppression_entries s
   where s.business_id = p_business_id
     and s.email is not null and lower(s.email::text) = any(v_emails)
     and s.phone_e164 is null and s.social_identifier is null
     and s.phone_hash is null and s.social_hash is null
     and exists (select 1 from public.suppression_entries t
                  where t.business_id = s.business_id and t.channel = s.channel
                    and t.email_hash = public.suppression_hash('email', s.email::text));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'suppression_entries', 'merged_into_hash', n);

  update public.suppression_entries s
     set email_hash = case
           when exists (select 1 from public.suppression_entries t
                         where t.business_id = s.business_id and t.channel = s.channel
                           and t.id <> s.id
                           and t.email_hash = public.suppression_hash('email', s.email::text))
           then s.email_hash
           else public.suppression_hash('email', s.email::text)
         end,
         email = null
   where s.business_id = p_business_id
     and s.email is not null and lower(s.email::text) = any(v_emails);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'suppression_entries', 'hashed', n);

  delete from public.suppression_entries s
   where s.business_id = p_business_id
     and s.phone_e164 is not null and s.phone_e164 = any(v_phones)
     and s.email is null and s.social_identifier is null
     and s.email_hash is null and s.social_hash is null
     and exists (select 1 from public.suppression_entries t
                  where t.business_id = s.business_id and t.channel = s.channel
                    and t.phone_hash = public.suppression_hash('phone', s.phone_e164));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'suppression_entries', 'merged_into_hash', n);

  update public.suppression_entries s
     set phone_hash = case
           when exists (select 1 from public.suppression_entries t
                         where t.business_id = s.business_id and t.channel = s.channel
                           and t.id <> s.id
                           and t.phone_hash = public.suppression_hash('phone', s.phone_e164))
           then s.phone_hash
           else public.suppression_hash('phone', s.phone_e164)
         end,
         phone_e164 = null
   where s.business_id = p_business_id
     and s.phone_e164 is not null and s.phone_e164 = any(v_phones);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'suppression_entries', 'hashed', n);

  delete from public.suppression_entries s
   where s.business_id = p_business_id
     and s.social_identifier is not null and s.social_identifier = any(v_socials)
     and s.email is null and s.phone_e164 is null
     and s.email_hash is null and s.phone_hash is null
     and exists (select 1 from public.suppression_entries t
                  where t.business_id = s.business_id and t.channel = s.channel
                    and t.social_hash = public.suppression_hash('social', s.social_identifier));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'suppression_entries', 'merged_into_hash', n);

  update public.suppression_entries s
     set social_hash = case
           when exists (select 1 from public.suppression_entries t
                         where t.business_id = s.business_id and t.channel = s.channel
                           and t.id <> s.id
                           and t.social_hash = public.suppression_hash('social', s.social_identifier))
           then s.social_hash
           else public.suppression_hash('social', s.social_identifier)
         end,
         social_identifier = null
   where s.business_id = p_business_id
     and s.social_identifier is not null and s.social_identifier = any(v_socials);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'suppression_entries', 'hashed', n);

  -- The deprecated V3 list (0069) still holds plaintext addresses. Nothing
  -- consults it; the person's rows go. Reported as legacy_suppression_list.
  delete from public.contact_suppressions cs
   where cs.business_id = p_business_id
     and (lower(cs.normalized_contact) = any(v_emails) or cs.normalized_contact = any(v_phones));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'legacy_suppression_list', 'removed', n);

  -- ------------------------------------------------------------- the lead
  if v_lead_id is not null then
    -- email and phone null => leads_derive_opted_out (0123) leaves opted_out
    -- as written, so the explicit true below stands.
    update public.leads l
       set first_name = null, last_name = null, email = null, phone = null,
           phone_normalized = null, telephone = null, postcode = null, notes = null,
           company_name = null, external_id = null, intake_detail = null,
           qualification_reason = '[]'::jsonb,
           opted_out = true, automation_active = false,
           needs_attention = false, attention_reason = null,
           anonymised_at = coalesce(l.anonymised_at, now())
     where l.id = v_lead_id
       and (l.anonymised_at is null or l.first_name is not null or l.last_name is not null
            or l.email is not null or l.phone is not null or l.phone_normalized is not null
            or l.telephone is not null or l.postcode is not null or l.notes is not null
            or l.company_name is not null or l.external_id is not null);
    get diagnostics n = row_count;
    v_counts := public.data_rights_count(v_counts, 'leads', 'redacted', n);
  end if;

  update public.prospects p
     set first_name = null, last_name = null, role_title = null, email = null,
         phone_e164 = null, linkedin_url = null, location_json = '{}'::jsonb,
         social_handle = null, social_profile_url = null, social_external_id = null,
         avatar_url = null, social_comment_id = null,
         anonymised_at = coalesce(p.anonymised_at, now())
   where p.id = any(v_prospects)
     and (p.anonymised_at is null or p.email is not null or p.first_name is not null
          or p.last_name is not null or p.phone_e164 is not null or p.linkedin_url is not null);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'prospects', 'redacted', n);

  -- -------------------------------------------------- conversations/messages
  update public.conversations c
     set counterparty_name = null, counterparty_handle = null,
         counterparty_avatar_url = null, subject = null,
         external_thread_id = null, provider_thread_id = null
   where c.id = any(v_conversations)
     and (c.counterparty_name is not null or c.counterparty_handle is not null
          or c.counterparty_avatar_url is not null or c.subject is not null
          or c.external_thread_id is not null or c.provider_thread_id is not null);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'conversations', 'redacted', n);

  -- Anything still waiting to go must not go out as "[removed]".
  update public.messages m
     set status = 'DISCARDED'
   where m.id = any(v_messages) and m.status in ('DRAFT', 'QUEUED');
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'messages', 'discarded_unsent', n);

  update public.messages m
     set body = '[removed]', subject = null, sender_name = null, sender_handle = null,
         attachments = '[]'::jsonb, error_message = null, message_id_header = null,
         in_reply_to_header = null, references_header = null
   where m.id = any(v_messages)
     and (m.body is distinct from '[removed]' or m.subject is not null
          or m.sender_name is not null or m.sender_handle is not null);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'messages', 'redacted', n);

  update public.message_events me
     set payload = '{}'::jsonb
   where me.message_id = any(v_messages) and me.payload <> '{}'::jsonb;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'message_events', 'redacted', n);

  -- ------------------------------------------------------ AI memory/summaries
  delete from public.conversation_summaries cs where cs.conversation_id = any(v_conversations);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'conversation_summaries', 'removed', n);

  select coalesce(array_agg(r.id), '{}') into v_agent_runs
    from public.conversation_agent_runs r
   where r.business_id = p_business_id
     and ((v_lead_id is not null and r.lead_id = v_lead_id) or r.conversation_id = any(v_conversations));

  update public.conversation_agent_runs r
     set decision_json = '{}'::jsonb
   where r.id = any(v_agent_runs) and r.decision_json <> '{}'::jsonb;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'conversation_agent_runs', 'redacted', n);

  update public.conversation_agent_actions a
     set input_summary = '{}'::jsonb, result_summary = '{}'::jsonb
   where a.agent_run_id = any(v_agent_runs)
     and (a.input_summary <> '{}'::jsonb or a.result_summary <> '{}'::jsonb);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'conversation_agent_actions', 'redacted', n);

  delete from public.conversation_agent_extractions x
   where x.business_id = p_business_id
     and ((v_lead_id is not null and x.lead_id = v_lead_id) or x.agent_run_id = any(v_agent_runs));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'conversation_agent_extractions', 'removed', n);

  update public.agent_handoffs h
     set summary_json = '{}'::jsonb, resolution_note = null
   where h.business_id = p_business_id and v_lead_id is not null and h.lead_id = v_lead_id
     and (h.summary_json <> '{}'::jsonb or h.resolution_note is not null);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'agent_handoffs', 'redacted', n);

  update public.ai_runs r
     set result_json = null
   where r.business_id = p_business_id
     and ((v_lead_id is not null and r.lead_id = v_lead_id) or r.conversation_id = any(v_conversations))
     and r.result_json is not null;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'ai_runs', 'redacted', n);

  select coalesce(array_agg(r.id), '{}') into v_v4_runs
    from public.agent_runs r
   where r.business_id = p_business_id
     and ((upper(r.subject_type) = 'LEAD' and r.subject_id = v_lead_id)
          or (upper(r.subject_type) = 'PROSPECT' and r.subject_id = any(v_prospects)));

  update public.agent_runs r
     set result_json = null
   where r.id = any(v_v4_runs) and r.result_json is not null;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'agent_runs', 'redacted', n);

  update public.agent_tool_calls t
     set arguments_json = '{}'::jsonb, result_summary = null
   where t.agent_run_id = any(v_v4_runs)
     and (t.arguments_json <> '{}'::jsonb or t.result_summary is not null);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'agent_tool_calls', 'redacted', n);

  update public.agent_queue_items q
     set subject_label = null, error_message = null
   where q.business_id = p_business_id
     and ((q.subject_type = 'LEAD' and q.subject_id = v_lead_id)
          or (q.subject_type = 'PROSPECT' and q.subject_id = any(v_prospects)))
     and (q.subject_label is not null or q.error_message is not null);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'agent_queue_items', 'redacted', n);

  update public.agent_activity_events e
     set title = 'Activity about an anonymised contact', detail = null, metadata = '{}'::jsonb
   where e.business_id = p_business_id
     and ((upper(e.subject_type) = 'LEAD' and e.subject_id = v_lead_id)
          or (upper(e.subject_type) = 'PROSPECT' and e.subject_id = any(v_prospects)))
     and (e.title <> 'Activity about an anonymised contact' or e.detail is not null
          or e.metadata <> '{}'::jsonb);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'agent_activity_events', 'redacted', n);

  update public.business_learning_events b
     set detail = null, evidence_json = '{}'::jsonb
   where b.business_id = p_business_id
     and ((upper(b.subject_type) = 'LEAD' and b.subject_id = v_lead_id)
          or (upper(b.subject_type) = 'PROSPECT' and b.subject_id = any(v_prospects)))
     and (b.detail is not null or b.evidence_json <> '{}'::jsonb);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'business_learning_events', 'redacted', n);

  -- ---------------------------------------------------- qualification/notes
  -- Deleted rather than redacted: the answers are the person's own words, and
  -- redacting answer_value would fire 0123's re-score trigger for nothing.
  -- The outcome survives on leads.qualification_state.
  delete from public.qualification_answers qa
   where qa.business_id = p_business_id and v_lead_id is not null and qa.lead_id = v_lead_id;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'qualification_answers', 'removed', n);

  delete from public.lead_notes ln
   where ln.business_id = p_business_id and v_lead_id is not null and ln.lead_id = v_lead_id;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'lead_notes', 'removed', n);

  -- status is untouched, so 0123's booking trigger does not fire.
  update public.bookings b
     set location = null, notes = null, booking_url = null, reschedule_url = null, cancel_url = null
   where b.business_id = p_business_id and v_lead_id is not null and b.lead_id = v_lead_id
     and (b.location is not null or b.notes is not null or b.booking_url is not null
          or b.reschedule_url is not null or b.cancel_url is not null);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'bookings', 'redacted', n);

  -- --------------------------------------------------- scores/opportunities
  update public.lead_scores s
     set why = '[removed]'
   where s.business_id = p_business_id and v_lead_id is not null and s.lead_id = v_lead_id
     and s.why <> '[removed]';
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'lead_scores', 'redacted', n);

  update public.opportunities o
     set name = 'Opportunity (anonymised contact)', meddpicc = null
   where o.business_id = p_business_id and v_lead_id is not null and o.lead_id = v_lead_id
     and (o.name <> 'Opportunity (anonymised contact)' or o.meddpicc is not null);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'opportunities', 'redacted', n);

  update public.prospect_scores s
     set explanation = null
   where s.prospect_id = any(v_prospects) and s.explanation is not null;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'prospect_scores', 'redacted', n);

  update public.intent_events i
     set evidence_summary = null, source_url = null
   where i.business_id = p_business_id
     and ((v_lead_id is not null and i.lead_id = v_lead_id) or i.prospect_id = any(v_prospects))
     and (i.evidence_summary is not null or i.source_url is not null);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'intent_events', 'redacted', n);

  -- ------------------------------------------------------------ automation
  update public.automation_runs r
     set state = 'STOPPED', stopped_reason = 'data_rights', stopped_at = now()
   where r.business_id = p_business_id and v_lead_id is not null and r.lead_id = v_lead_id
     and r.state in ('ACTIVE', 'PAUSED');
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'automation_runs', 'stopped', n);

  update public.automation_events e
     set payload = '{}'::jsonb
   where e.business_id = p_business_id and v_lead_id is not null and e.lead_id = v_lead_id
     and e.payload <> '{}'::jsonb;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'automation_events', 'redacted', n);

  update public.campaign_contacts cc
     set state = 'stopped', stopped_reason = 'data_rights'
   where cc.business_id = p_business_id and v_lead_id is not null and cc.lead_id = v_lead_id
     and cc.state in ('pending', 'scheduled');
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'campaign_contacts', 'stopped', n);

  update public.outreach_recipient_runs r
     set status = 'STOPPED', stop_reason = 'data_rights', stopped_at = now()
   where r.business_id = p_business_id and r.prospect_id = any(v_prospects)
     and r.status in ('PENDING', 'SCHEDULED', 'ACTIVE');
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'outreach_recipient_runs', 'stopped', n);

  update public.crm_push_records r
     set last_error = null
   where r.business_id = p_business_id and v_lead_id is not null and r.lead_id = v_lead_id
     and r.last_error is not null;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'crm_push_records', 'redacted', n);

  update public.jobs j
     set state = 'cancelled', cancelled_at = now()
   where j.business_id = p_business_id and j.state = 'pending'
     and ((v_lead_id is not null and (j.payload ->> 'leadId' = v_lead_id::text
                                      or j.payload ->> 'lead_id' = v_lead_id::text))
          or j.payload ->> 'prospectId' = any(select unnest(v_prospects)::text));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'jobs', 'cancelled', n);

  -- ------------------------------------------------------ intake/provenance
  update public.lead_touches t
     set answers = '{}'::jsonb, referrer = null, landing_url = null, gclid = null, fbclid = null
   where t.business_id = p_business_id and v_lead_id is not null and t.lead_id = v_lead_id
     and (t.answers <> '{}'::jsonb or t.referrer is not null or t.landing_url is not null
          or t.gclid is not null or t.fbclid is not null);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'lead_touches', 'redacted', n);

  update public.merge_events me
     set before = '{}'::jsonb, after = '{}'::jsonb
   where me.business_id = p_business_id and v_lead_id is not null and me.lead_id = v_lead_id
     and (me.before <> '{}'::jsonb or me.after <> '{}'::jsonb);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'merge_events', 'redacted', n);

  update public.merge_candidates mc
     set evidence = '{}'::jsonb
   where mc.business_id = p_business_id
     and ((v_lead_id is not null and (mc.lead_a_id = v_lead_id or mc.lead_b_id = v_lead_id))
          or mc.prospect_id = any(v_prospects))
     and mc.evidence <> '{}'::jsonb;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'merge_candidates', 'redacted', n);

  update public.ingest_requests r
     set request_hash = null
   where r.business_id = p_business_id and v_lead_id is not null and r.lead_id = v_lead_id
     and r.request_hash is not null;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'ingest_requests', 'redacted', n);

  update public.lead_import_rows r
     set raw_json = '{}'::jsonb, first_name = null, last_name = null, email = null,
         phone_e164 = null, postcode = null, role_title = null, notes = null
   where r.business_id = p_business_id
     and ((v_lead_id is not null and (r.created_lead_id = v_lead_id or r.duplicate_of_lead_id = v_lead_id))
          or r.created_prospect_id = any(v_prospects) or r.duplicate_of_prospect_id = any(v_prospects))
     and (r.raw_json <> '{}'::jsonb or r.email is not null or r.first_name is not null
          or r.last_name is not null or r.phone_e164 is not null);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'lead_import_rows', 'redacted', n);

  update public.contact_permissions cp
     set email = null, phone_e164 = null, relationship_detail = null,
         consent_evidence = case when cp.consent_evidence is null then null else '[removed]' end
   where cp.business_id = p_business_id
     and ((cp.subject_type = 'LEAD' and cp.subject_id = v_lead_id)
          or (cp.subject_type = 'PROSPECT' and cp.subject_id = any(v_prospects)))
     and (cp.email is not null or cp.phone_e164 is not null or cp.relationship_detail is not null
          or cp.consent_evidence is distinct from '[removed]');
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'contact_permissions', 'redacted', n);

  update public.contactability_results cr
     set evidence_json = '{}'::jsonb
   where cr.business_id = p_business_id
     and ((cr.subject_type = 'LEAD' and cr.subject_id = v_lead_id)
          or (cr.subject_type = 'PROSPECT' and cr.subject_id = any(v_prospects)))
     and cr.evidence_json <> '{}'::jsonb;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'contactability_results', 'redacted', n);

  update public.compliance_decisions cd
     set evidence_json = '{}'::jsonb,
         rationale = case when cd.rationale is null then null else '[removed]' end
   where cd.business_id = p_business_id
     and ((upper(cd.subject_type) = 'LEAD' and cd.subject_id = v_lead_id)
          or (upper(cd.subject_type) = 'PROSPECT' and cd.subject_id = any(v_prospects)))
     and (cd.evidence_json <> '{}'::jsonb or cd.rationale is distinct from '[removed]');
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'compliance_decisions', 'redacted', n);

  update public.lead_source_evidence e
     set evidence_json = '{}'::jsonb, source_detail = null,
         consent_evidence = case when e.consent_evidence is null then null else '[removed]' end
   where e.business_id = p_business_id
     and ((e.subject_type = 'LEAD' and e.subject_id = v_lead_id)
          or (e.subject_type = 'PROSPECT' and e.subject_id = any(v_prospects)))
     and (e.evidence_json <> '{}'::jsonb or e.source_detail is not null
          or e.consent_evidence is distinct from '[removed]');
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'lead_source_evidence', 'redacted', n);

  -- ------------------------------------------------------------ prospects
  update public.prospect_data_sources d
     set value_json = '{"redacted": true}'::jsonb, source_url = null, provider_entity_id = null
   where d.prospect_id = any(v_prospects)
     and (d.value_json <> '{"redacted": true}'::jsonb or d.source_url is not null
          or d.provider_entity_id is not null);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'prospect_data_sources', 'redacted', n);

  update public.prospect_enrichments e
     set result_json = '{"redacted": true}'::jsonb
   where e.prospect_id = any(v_prospects) and e.result_json <> '{"redacted": true}'::jsonb;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'prospect_enrichments', 'redacted', n);

  update public.prospect_verifications v
     set detail_json = '{}'::jsonb
   where v.prospect_id = any(v_prospects) and v.detail_json <> '{}'::jsonb;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'prospect_verifications', 'redacted', n);

  update public.search_feedback f
     set note = null
   where f.prospect_id = any(v_prospects) and f.note is not null;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'search_feedback', 'redacted', n);

  update public.sourcing_run_results r
     set candidate_name = null
   where r.prospect_id = any(v_prospects) and r.candidate_name is not null;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'sourcing_run_results', 'redacted', n);

  update public.social_connection_states s
     set profile_url = null, external_ref = null, note_body = null,
         next_action = null, next_action_at = null, autopilot = false
   where s.prospect_id = any(v_prospects)
     and (s.profile_url is not null or s.external_ref is not null or s.note_body is not null
          or s.next_action is not null or s.autopilot);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'social_connection_states', 'redacted', n);

  update public.social_outbound_messages m
     set status = 'DISCARDED', discarded_reason = 'data_rights'
   where m.prospect_id = any(v_prospects) and m.status = 'DRAFT';
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'social_outbound_messages', 'discarded_unsent', n);

  update public.social_outbound_messages m
     set body = '[removed]'
   where m.prospect_id = any(v_prospects) and m.body <> '[removed]';
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'social_outbound_messages', 'redacted', n);

  -- inmail_sends arrives in 0125; plpgsql resolves the name when this runs,
  -- not when it is created, so the order of the two files does not matter.
  update public.inmail_sends i
     set note = null
   where i.business_id = p_business_id
     and ((v_lead_id is not null and i.lead_id = v_lead_id) or i.prospect_id = any(v_prospects))
     and i.note is not null;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'inmail_sends', 'redacted', n);

  update public.social_inbound_replies r
     set body = '[removed]'
   where r.prospect_id = any(v_prospects) and r.body <> '[removed]';
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'social_inbound_replies', 'redacted', n);

  update public.workspace_app_events w
     set payload = '{}'::jsonb
   where w.business_id = p_business_id and w.payload <> '{}'::jsonb
     and (w.prospect_id = any(v_prospects)
          or exists (select 1 from unnest(v_needles) x where position(x in lower(w.payload::text)) > 0));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'workspace_app_events', 'redacted', n);

  -- -------------------------------------------- raw inbound/outbound events
  update public.webhook_events w
     set payload = null
   where w.business_id = p_business_id and w.payload is not null
     and w.status not in ('received', 'processing')
     and exists (select 1 from unnest(v_needles) x where position(x in lower(w.payload::text)) > 0);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'webhook_events', 'redacted', n);

  update public.connector_event_failures f
     set payload = null
   where f.business_id = p_business_id and f.payload is not null
     and exists (select 1 from unnest(v_needles) x where position(x in lower(f.payload::text)) > 0);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'connector_event_failures', 'redacted', n);

  update public.webhook_deliveries d
     set payload = jsonb_build_object('type', d.payload -> 'type', 'redacted', true),
         response_body = null
   where d.business_id = p_business_id and v_lead_id is not null
     and d.payload -> 'data' ->> 'lead_id' = v_lead_id::text
     and not coalesce((d.payload ->> 'redacted')::boolean, false);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'webhook_deliveries', 'redacted', n);

  update public.domain_events d
     set payload = d.payload - v_keys
   where d.business_id = p_business_id
     and (
       (v_lead_id is not null and d.subject_type = 'lead' and d.subject_id = v_lead_id)
       or (v_lead_id is not null and d.payload ->> 'lead_id' = v_lead_id::text)
       or (d.subject_type = 'prospect' and d.subject_id = any(v_prospects))
       or (d.subject_type = 'contact'
           and (lower(d.payload ->> 'email') = any(v_emails) or d.payload ->> 'phone' = any(v_phones)))
     )
     and d.payload ?| v_keys;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'domain_events', 'redacted', n);

  delete from public.notifications nt
   where nt.business_id = p_business_id
     and ((v_lead_id is not null and nt.entity_id = v_lead_id) or nt.entity_id = any(v_prospects));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'notifications', 'removed', n);

  -- The audit trail is retained; only the personal values inside it go.
  update public.audit_log a
     set metadata = (a.metadata - v_keys) || jsonb_build_object('data_rights_redacted', true)
   where a.business_id = p_business_id
     and ((v_lead_id is not null and a.entity_id = v_lead_id)
          or a.entity_id = any(v_prospects)
          or (v_lead_id is not null and (a.metadata ->> 'lead_id' = v_lead_id::text
                                         or a.metadata ->> 'leadId' = v_lead_id::text)))
     and a.metadata ?| v_keys;
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'audit_log', 'redacted', n);

  return jsonb_build_object(
    'lead_id', v_lead_id,
    'prospect_ids', to_jsonb(v_prospects),
    'counts', v_counts,
    -- Kept untouched: they hold no personal values, only ids, amounts,
    -- outcomes and timestamps. Named so the summary can say so.
    'retained', to_jsonb(array[
      'lead_assignments', 'lead_tags', 'ai_budget_decisions', 'privacy_notice_events',
      'usage_reservations', 'cost_events', 'usage_events', 'prospect_intent_matches',
      'social_action_log', 'workspace_stream_events', 'privacy_requests',
      'data_rights_actions'
    ]::text[])
  );
end
$$;

revoke all on function public.data_rights_scrub(uuid, text, uuid) from public, anon, authenticated;

-- ------------------------------------------------------ data_rights_anonymise
create or replace function public.data_rights_anonymise(
  p_business_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_requested_by uuid default null,
  p_caller text default null,
  p_reason text default null,
  p_privacy_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_result jsonb;
  v_action uuid;
begin
  v_result := public.data_rights_scrub(p_business_id, p_subject_type, p_subject_id);
  if v_result is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;

  insert into public.data_rights_actions (
    business_id, subject_type, subject_id, action, requested_by, caller, reason,
    privacy_request_id, summary
  ) values (
    p_business_id, p_subject_type, p_subject_id, 'ANONYMISE', p_requested_by, p_caller,
    left(p_reason, 500), p_privacy_request_id,
    v_result || jsonb_build_object('mode', 'ANONYMISE')
  )
  returning id into v_action;

  return v_result || jsonb_build_object('status', 'DONE', 'action_id', v_action, 'mode', 'ANONYMISE');
end
$$;

revoke all on function public.data_rights_anonymise(uuid, text, uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.data_rights_anonymise(uuid, text, uuid, uuid, text, text, uuid)
  to service_role;

-- --------------------------------------------------------- data_rights_delete
-- Anonymise, then hard-delete what has no retention need. Retained with
-- pseudonymous ids: audit_log, usage_events, cost_events, ai_runs,
-- conversation_agent_runs, automation_events, opportunities, ai_budget_decisions,
-- privacy_notice_events, compliance_decisions, data_rights_actions and the
-- hashed suppression rows.
create or replace function public.data_rights_delete(
  p_business_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_requested_by uuid default null,
  p_caller text default null,
  p_reason text default null,
  p_privacy_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_result jsonb;
  v_counts jsonb;
  v_lead_id uuid;
  v_prospects uuid[];
  v_action uuid;
  n integer;
begin
  v_result := public.data_rights_scrub(p_business_id, p_subject_type, p_subject_id);
  if v_result is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;

  v_counts := v_result -> 'counts';
  v_lead_id := nullif(v_result ->> 'lead_id', '')::uuid;
  select coalesce(array_agg(value::uuid), '{}') into v_prospects
    from jsonb_array_elements_text(v_result -> 'prospect_ids');

  -- Subject-keyed rows have no FK to cascade from; without this they would
  -- outlive the subject as orphans.
  delete from public.contact_permissions cp
   where cp.business_id = p_business_id
     and ((cp.subject_type = 'LEAD' and cp.subject_id = v_lead_id)
          or (cp.subject_type = 'PROSPECT' and cp.subject_id = any(v_prospects)));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'contact_permissions', 'removed', n);

  delete from public.contactability_results cr
   where cr.business_id = p_business_id
     and ((cr.subject_type = 'LEAD' and cr.subject_id = v_lead_id)
          or (cr.subject_type = 'PROSPECT' and cr.subject_id = any(v_prospects)));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'contactability_results', 'removed', n);

  delete from public.lead_source_evidence e
   where e.business_id = p_business_id
     and ((e.subject_type = 'LEAD' and e.subject_id = v_lead_id)
          or (e.subject_type = 'PROSPECT' and e.subject_id = any(v_prospects)));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'lead_source_evidence', 'removed', n);

  delete from public.agent_queue_items q
   where q.business_id = p_business_id
     and ((q.subject_type = 'LEAD' and q.subject_id = v_lead_id)
          or (q.subject_type = 'PROSPECT' and q.subject_id = any(v_prospects)));
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'agent_queue_items', 'removed', n);

  -- 0045's prospect_id has no ON DELETE action and would block the delete.
  update public.workspace_app_events w
     set prospect_id = null
   where w.prospect_id = any(v_prospects);

  -- The prospect goes first: a CONVERTED prospect may not lose its lead id
  -- (0063), so it cannot outlive the lead it points at.
  delete from public.prospects p where p.id = any(v_prospects);
  get diagnostics n = row_count;
  v_counts := public.data_rights_count(v_counts, 'prospects', 'removed', n);

  if v_lead_id is not null then
    -- Cascades: conversations, messages, message_events, qualification_answers,
    -- bookings, automation_runs, campaign_contacts, crm_push_records,
    -- agent_handoffs, intent_events, lead_notes, lead_scores, lead_tags,
    -- lead_assignments, lead_touches, merge_events, merge_candidates.
    delete from public.leads l where l.id = v_lead_id and l.business_id = p_business_id;
    get diagnostics n = row_count;
    v_counts := public.data_rights_count(v_counts, 'leads', 'removed', n);
  end if;

  v_result := jsonb_set(v_result, '{counts}', v_counts)
    || jsonb_build_object(
      'retained', to_jsonb(array[
        'audit_log', 'usage_events', 'cost_events', 'usage_reservations', 'ai_runs',
        'conversation_agent_runs', 'agent_runs', 'automation_events', 'opportunities',
        'ai_budget_decisions', 'privacy_notice_events', 'compliance_decisions',
        'suppression_entries', 'ingest_requests', 'domain_events', 'webhook_deliveries',
        'agent_activity_events', 'privacy_requests', 'data_rights_actions',
        'lead_import_rows', 'sourcing_run_results', 'workspace_app_events',
        'business_learning_events', 'conversation_agent_actions', 'agent_tool_calls',
        'jobs', 'webhook_events', 'connector_event_failures', 'workspace_stream_events',
        'social_action_log', 'inmail_sends'
      ]::text[])
    );

  insert into public.data_rights_actions (
    business_id, subject_type, subject_id, action, requested_by, caller, reason,
    privacy_request_id, summary
  ) values (
    p_business_id, p_subject_type, p_subject_id, 'DELETE', p_requested_by, p_caller,
    left(p_reason, 500), p_privacy_request_id,
    v_result || jsonb_build_object('mode', 'DELETE')
  )
  returning id into v_action;

  return v_result || jsonb_build_object('status', 'DONE', 'action_id', v_action, 'mode', 'DELETE');
end
$$;

revoke all on function public.data_rights_delete(uuid, text, uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.data_rights_delete(uuid, text, uuid, uuid, text, text, uuid)
  to service_role;

-- ------------------------------------------------------- data_rights_suppress
-- Suppresses every destination held for the person. p_reason LEGAL on channel
-- ALL is a restriction (Art 18): 0123 maps it to the LEGAL_HOLD
-- contactability state, and lead_all_channel_opt_out counts LEGAL, so the
-- policy engine blocks contact with no new engine code.
create or replace function public.data_rights_suppress(
  p_business_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_channel text,
  p_reason text,
  p_requested_by uuid default null,
  p_caller text default null,
  p_note text default null,
  p_privacy_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_lead_id uuid;
  v_prospect_id uuid;
  v_emails text[] := '{}';
  v_phones text[] := '{}';
  v_socials text[] := '{}';
  v_channel text := upper(p_channel);
  v_inserted integer := 0;
  n integer;
  v_action uuid;
  v_kind text;
begin
  if p_reason not in ('MANUAL', 'OPT_OUT', 'LEGAL') then
    raise exception 'unsupported suppression reason %', p_reason;
  end if;
  if v_channel not in ('ALL', 'EMAIL', 'SMS', 'WHATSAPP', 'SOCIAL') then
    raise exception 'unsupported channel %', p_channel;
  end if;
  -- A restriction is on processing, not on one channel.
  if p_reason = 'LEGAL' then
    v_channel := 'ALL';
  end if;

  if p_subject_type = 'LEAD' then
    select l.id into v_lead_id from public.leads l
     where l.id = p_subject_id and l.business_id = p_business_id;
    if not found then
      return jsonb_build_object('status', 'NOT_FOUND');
    end if;
    select coalesce(array_agg(distinct e), '{}') into v_emails from (
      select nullif(lower(btrim(l.email)), '') e from public.leads l where l.id = v_lead_id
    ) x where e is not null;
    select coalesce(array_agg(distinct ph), '{}') into v_phones from (
      select coalesce(nullif(l.phone_normalized, ''), nullif(btrim(l.phone), '')) ph
        from public.leads l where l.id = v_lead_id
    ) x where ph is not null;
    select coalesce(array_agg(distinct c.external_thread_id), '{}') into v_socials
      from public.conversations c
     where c.business_id = p_business_id and c.lead_id = v_lead_id
       and c.external_thread_id is not null
       and c.channel in ('messenger', 'instagram', 'linkedin', 'tiktok');
  elsif p_subject_type = 'PROSPECT' then
    select p.id into v_prospect_id from public.prospects p
     where p.id = p_subject_id and p.business_id = p_business_id;
    if not found then
      return jsonb_build_object('status', 'NOT_FOUND');
    end if;
    select coalesce(array_agg(distinct lower(btrim(p.email::text))) filter (where p.email is not null), '{}'),
           coalesce(array_agg(distinct p.phone_e164) filter (where p.phone_e164 is not null), '{}')
      into v_emails, v_phones
      from public.prospects p where p.id = v_prospect_id;
  else
    raise exception 'unknown subject type %', p_subject_type;
  end if;

  if v_channel in ('ALL', 'EMAIL') and cardinality(v_emails) > 0 then
    insert into public.suppression_entries (business_id, email, channel, reason, source, source_reference, note, created_by)
    select p_business_id, e::citext, v_channel, p_reason, 'DATA_RIGHTS', p_subject_id::text, left(p_note, 500), p_requested_by
      from unnest(v_emails) e
    on conflict do nothing;
    get diagnostics n = row_count; v_inserted := v_inserted + n;
  end if;

  if v_channel in ('ALL', 'SMS', 'WHATSAPP') and cardinality(v_phones) > 0 then
    insert into public.suppression_entries (business_id, phone_e164, channel, reason, source, source_reference, note, created_by)
    select p_business_id, ph, v_channel, p_reason, 'DATA_RIGHTS', p_subject_id::text, left(p_note, 500), p_requested_by
      from unnest(v_phones) ph
    on conflict do nothing;
    get diagnostics n = row_count; v_inserted := v_inserted + n;
  end if;

  if v_channel in ('ALL', 'SOCIAL') and cardinality(v_socials) > 0 then
    insert into public.suppression_entries (business_id, social_identifier, channel, reason, source, source_reference, note, created_by)
    select p_business_id, s, v_channel, p_reason, 'DATA_RIGHTS', p_subject_id::text, left(p_note, 500), p_requested_by
      from unnest(v_socials) s
    on conflict do nothing;
    get diagnostics n = row_count; v_inserted := v_inserted + n;
  end if;

  -- Follow-up stops now rather than at the next send-time check.
  if v_lead_id is not null and v_channel = 'ALL' then
    update public.leads l set automation_active = false
     where l.id = v_lead_id and l.automation_active;
  end if;

  v_kind := case when p_reason = 'LEGAL' then 'RESTRICT' else 'SUPPRESS' end;

  insert into public.data_rights_actions (
    business_id, subject_type, subject_id, action, requested_by, caller, reason,
    privacy_request_id, summary
  ) values (
    p_business_id, p_subject_type, p_subject_id, v_kind, p_requested_by, p_caller,
    left(p_note, 500), p_privacy_request_id,
    jsonb_build_object(
      'channel', v_channel,
      'reason', p_reason,
      'destinations', jsonb_build_object(
        'email', cardinality(v_emails), 'phone', cardinality(v_phones), 'social', cardinality(v_socials)
      ),
      'entries_added', v_inserted
    )
  )
  returning id into v_action;

  return jsonb_build_object(
    'status', case when cardinality(v_emails) + cardinality(v_phones) + cardinality(v_socials) = 0
                   then 'NO_DESTINATION' else 'DONE' end,
    'action_id', v_action,
    'mode', v_kind,
    'channel', v_channel,
    'entries_added', v_inserted,
    'destinations', jsonb_build_object(
      'email', cardinality(v_emails), 'phone', cardinality(v_phones), 'social', cardinality(v_socials)
    )
  );
end
$$;

revoke all on function public.data_rights_suppress(uuid, text, uuid, text, text, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.data_rights_suppress(uuid, text, uuid, text, text, uuid, text, text, uuid)
  to service_role;

-- --------------------------------------------- data_rights_subject_suppressions
-- For a subject-access export: every suppression row that applies to the
-- person, plaintext or hashed. Hashes are reported as "hashed", never shown.
create or replace function public.data_rights_subject_suppressions(
  p_business_id uuid,
  p_email text default null,
  p_phone text default null
)
returns table (channel text, reason text, source text, created_at timestamptz, stored_as text, scope text)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select s.channel, s.reason, s.source, s.created_at,
         case when s.email_hash is not null or s.phone_hash is not null or s.social_hash is not null
              then 'HASHED' else 'PLAINTEXT' end,
         case when s.business_id is null then 'PLATFORM' else 'WORKSPACE' end
    from public.suppression_entries s
   where (s.business_id = p_business_id or s.business_id is null)
     and (
       (p_email is not null and (s.email = p_email::citext
                                 or s.email_hash = public.suppression_hash('email', p_email)))
       or (p_phone is not null and (s.phone_e164 = p_phone
                                    or s.phone_hash = public.suppression_hash('phone', p_phone)))
     )
   order by s.created_at;
$$;

revoke all on function public.data_rights_subject_suppressions(uuid, text, text) from public, anon, authenticated;
grant execute on function public.data_rights_subject_suppressions(uuid, text, text) to service_role;

-- ------------------------------------------------------------------ retention
-- One predicate, used by both the settings dry run and the daily cron, so the
-- preview can never promise something the enforcement does differently.
--
-- INACTIVE_LEADS excludes WON (a customer relationship has its own basis),
-- a future pending/scheduled booking, an open privacy request about the lead
-- and a LEGAL restriction (Art 18: the person may need the data kept).
create or replace function public.data_rights_retention_candidates(
  p_business_id uuid,
  p_kind text,
  p_limit integer default 200
)
returns table (subject_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.id
    from public.leads l
    join public.business_data_controls c on c.business_id = l.business_id
   where p_kind = 'INACTIVE_LEADS'
     and c.retain_inactive_leads_days is not null
     and l.business_id = p_business_id
     and l.anonymised_at is null
     and not l.is_test
     and l.status <> 'WON'
     and greatest(
           l.created_at,
           coalesce(l.last_contact_at, l.created_at),
           coalesce(l.first_replied_at, l.created_at),
           coalesce(l.qualified_at, l.created_at),
           coalesce(l.booked_at, l.created_at),
           coalesce(l.lost_at, l.created_at)
         ) < now() - make_interval(days => c.retain_inactive_leads_days)
     and not exists (
       select 1 from public.bookings b
        where b.lead_id = l.id and b.starts_at > now() and b.status in ('pending', 'scheduled'))
     and not exists (
       select 1 from public.privacy_requests r
        where r.subject_lead_id = l.id and r.status in ('PENDING', 'IN_PROGRESS'))
     and not exists (
       select 1 from public.suppression_entries s
        where s.business_id = l.business_id and s.reason = 'LEGAL'
          and ((l.email_normalized is not null and s.email = l.email_normalized::citext)
               or (nullif(l.phone_normalized, '') is not null and s.phone_e164 = l.phone_normalized)))
  union all
  select p.id
    from public.prospects p
    join public.business_data_controls c on c.business_id = p.business_id
   where p_kind = 'UNCONTACTED_PROSPECTS'
     and c.retain_uncontacted_prospects_days is not null
     and p.business_id = p_business_id
     and p.anonymised_at is null
     and p.promoted_to_lead_id is null
     and p.last_contacted_at is null
     and p.created_at < now() - make_interval(days => c.retain_uncontacted_prospects_days)
  limit greatest(p_limit, 0);
$$;

revoke all on function public.data_rights_retention_candidates(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.data_rights_retention_candidates(uuid, text, integer) to service_role;

-- Raw inbound payloads past retain_raw_events_days: counted (dry run) or
-- redacted. The row and its status survive; only the payload goes.
create or replace function public.data_rights_raw_event_retention(
  p_business_id uuid,
  p_dry_run boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer;
  v_cutoff timestamptz;
  v_total integer := 0;
  n integer;
begin
  select c.retain_raw_events_days into v_days
    from public.business_data_controls c where c.business_id = p_business_id;
  if v_days is null then
    return 0;
  end if;
  v_cutoff := now() - make_interval(days => v_days);

  if p_dry_run then
    select count(*) into n from public.webhook_events w
     where w.business_id = p_business_id and w.received_at < v_cutoff and w.payload is not null
       and w.status not in ('received', 'processing');
    v_total := v_total + n;
    select count(*) into n from public.connector_event_failures f
     where f.business_id = p_business_id and f.created_at < v_cutoff and f.payload is not null;
    v_total := v_total + n;
    select count(*) into n from public.workspace_app_events w
     where w.business_id = p_business_id and w.created_at < v_cutoff and w.payload <> '{}'::jsonb;
    return v_total + n;
  end if;

  update public.webhook_events w set payload = null
   where w.business_id = p_business_id and w.received_at < v_cutoff and w.payload is not null
     and w.status not in ('received', 'processing');
  get diagnostics n = row_count; v_total := v_total + n;
  update public.connector_event_failures f set payload = null
   where f.business_id = p_business_id and f.created_at < v_cutoff and f.payload is not null;
  get diagnostics n = row_count; v_total := v_total + n;
  update public.workspace_app_events w set payload = '{}'::jsonb
   where w.business_id = p_business_id and w.created_at < v_cutoff and w.payload <> '{}'::jsonb;
  get diagnostics n = row_count;
  return v_total + n;
end
$$;

revoke all on function public.data_rights_raw_event_retention(uuid, boolean) from public, anon, authenticated;
grant execute on function public.data_rights_raw_event_retention(uuid, boolean) to service_role;

create or replace function public.data_rights_retention_preview(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'inactive_leads',
      (select count(*) from public.data_rights_retention_candidates(p_business_id, 'INACTIVE_LEADS', 1000000)),
    'uncontacted_prospects',
      (select count(*) from public.data_rights_retention_candidates(p_business_id, 'UNCONTACTED_PROSPECTS', 1000000)),
    'raw_events',
      public.data_rights_raw_event_retention(p_business_id, true)
  );
$$;

revoke all on function public.data_rights_retention_preview(uuid) from public, anon, authenticated;
grant execute on function public.data_rights_retention_preview(uuid) to service_role;
