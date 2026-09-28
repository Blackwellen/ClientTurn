-- 0160_ai_quote_authority_and_locks: quote-to-cash in the AI sales agent
-- (brief §7, §13-14, §53, §72-74).
--
-- NOT APPLIED by the change that added it. Apply with the deploy that ships
-- the code. Until it is applied:
--   * commercial_authority has no v2 columns: every workspace reads the
--     least-privilege defaults (the assistant may qualify and book; it may not
--     draft, send or discount a quote), and the "What the AI may do" card says
--     the settings need this update before they can be saved;
--   * claim_commercial_action does not exist: the agent's quote tools fall
--     back to the per-row idempotency keys alone (quotes.request_key,
--     quote_events.action_key), which still prevent a duplicate quote, send or
--     approval request, but not a person and the assistant acting on one lead
--     in the same minute;
--   * the QUOTE_VIEWED_REPEATEDLY signal insert is refused by the old CHECK
--     (the view is still counted; the intent signal waits).
--
-- 1. commercial_authority v2 (src/lib/commercial/ai-permissions.ts)
--    ai_permissions      {qualify, book, call, create_quote, send_quote,
--                          discount, request_signature, create_invoice,
--                          send_payment_link, mark_won, transfer_human}: bool
--                          Least privilege: only qualify and book default on.
--    ai_discount_policy  {restraint NEVER|ONLY_AFTER_OBJECTION|PROACTIVE,
--                          maxPercent, maxAmountMinor, firstConcessionPercent,
--                          marginFloorPercent, approvalAbovePercent,
--                          approvalAboveAmountMinor, approvalAboveValueMinor,
--                          approvalRole}
--    Both validated by zod before every write (the owner/admin server
--    action); the CHECKs here only hold the shape.
--
-- 2. One actor at a time on a lead (src/lib/commercial/locks.ts)
--    lead_commercial_leases     one row per lead: who holds it (AI, HUMAN,
--                               VOICE) and until when.
--    commercial_action_claims   one row per commercial action key (UNIQUE):
--                               the same action is claimed once.
--    claim_commercial_action()  takes pg_advisory_xact_lock(lead lock id) --
--                               the SAME lock id the voice dial takes
--                               (voice_call_begin_dial, 0157; voiceLeadLockKey)
--                               -- checks the lease, renews or takes it, and
--                               claims the action key.
--    Server-only: RLS on, no policies; the service role calls the RPC.
--
-- 3. lead_intent_signals.signal_type gains QUOTE_VIEWED_REPEATEDLY
--    (behavioural, HIGH): the lead opened their quote three or more times.
--    The list is qualification-intelligence/types.ts SIGNAL_TYPES, in order.

-- ------------------------------------------------ 1. commercial_authority v2
alter table public.commercial_authority
  add column if not exists ai_permissions jsonb not null
    default '{"qualify": true, "book": true}'::jsonb
    check (jsonb_typeof(ai_permissions) = 'object'),
  add column if not exists ai_discount_policy jsonb not null
    default '{"restraint": "NEVER"}'::jsonb
    check (jsonb_typeof(ai_discount_policy) = 'object'
           and coalesce(ai_discount_policy->>'restraint', 'NEVER') in ('NEVER', 'ONLY_AFTER_OBJECTION', 'PROACTIVE'));

comment on column public.commercial_authority.ai_permissions is
  'What the AI may do (v2). Validated by src/lib/commercial/ai-permissions.ts. Absent keys are the least-privilege defaults.';
comment on column public.commercial_authority.ai_discount_policy is
  'The AI discount policy (v2). Mapped onto the quote discount policy by quotes/discount-policy.ts aiDiscountPolicy.';

-- ------------------------------------------------------ 2. leases and claims
create table if not exists public.lead_commercial_leases (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  holder_kind text not null check (holder_kind in ('AI', 'HUMAN', 'VOICE')),
  holder_ref text check (holder_ref is null or char_length(holder_ref) <= 200),
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists lead_commercial_leases_business_idx on public.lead_commercial_leases (business_id);

alter table public.lead_commercial_leases enable row level security;
alter table public.lead_commercial_leases force row level security;
revoke all on public.lead_commercial_leases from anon, authenticated;

create table if not exists public.commercial_action_claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  action_kind text not null check (action_kind in (
    'QUOTE_CREATE', 'QUOTE_SEND', 'QUOTE_APPROVAL_REQUEST', 'QUOTE_DISCOUNT',
    'INVOICE_CREATE', 'PAYMENT_LINK', 'BOOKING', 'VOICE_CALL')),
  action_key text not null check (char_length(action_key) between 1 and 200),
  holder_kind text not null check (holder_kind in ('AI', 'HUMAN', 'VOICE')),
  holder_ref text,
  created_at timestamptz not null default now(),
  unique (business_id, action_key)
);
create index if not exists commercial_action_claims_lead_idx on public.commercial_action_claims (lead_id, created_at desc);

alter table public.commercial_action_claims enable row level security;
alter table public.commercial_action_claims force row level security;
revoke all on public.commercial_action_claims from anon, authenticated;

-- Returns {ok: true, duplicate: bool} or {ok: false, reason: 'HELD', held_by, until}.
create or replace function public.claim_commercial_action(
  p_business_id uuid,
  p_lead_id uuid,
  p_lead_lock_id integer,
  p_holder_kind text,
  p_holder_ref text,
  p_action_kind text,
  p_action_key text,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lease public.lead_commercial_leases%rowtype;
  v_inserted uuid;
begin
  if p_holder_kind not in ('AI', 'HUMAN', 'VOICE') then
    raise exception 'claim_commercial_action: unknown holder %', p_holder_kind;
  end if;
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'claim_commercial_action: lease must be 1..3600 seconds';
  end if;
  if not exists (select 1 from public.leads l where l.id = p_lead_id and l.business_id = p_business_id) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  end if;

  -- The lead's lock: the same id a voice dial takes (0157), so a dial and a
  -- commercial action on one lead never interleave.
  perform pg_advisory_xact_lock(p_lead_lock_id);

  select * into v_lease from public.lead_commercial_leases where lead_id = p_lead_id for update;
  if found and v_lease.expires_at > now() and (
       v_lease.holder_kind <> p_holder_kind
       or (v_lease.holder_kind = 'VOICE' and v_lease.holder_ref is distinct from p_holder_ref)
     ) then
    return jsonb_build_object('ok', false, 'reason', 'HELD', 'held_by', v_lease.holder_kind, 'until', v_lease.expires_at);
  end if;

  insert into public.lead_commercial_leases (lead_id, business_id, holder_kind, holder_ref, acquired_at, expires_at)
  values (p_lead_id, p_business_id, p_holder_kind, p_holder_ref, now(), now() + make_interval(secs => p_lease_seconds))
  on conflict (lead_id) do update
    set holder_kind = excluded.holder_kind,
        holder_ref = excluded.holder_ref,
        acquired_at = case when public.lead_commercial_leases.holder_kind = excluded.holder_kind
                            and public.lead_commercial_leases.expires_at > now()
                           then public.lead_commercial_leases.acquired_at else now() end,
        expires_at = excluded.expires_at;

  insert into public.commercial_action_claims (business_id, lead_id, action_kind, action_key, holder_kind, holder_ref)
  values (p_business_id, p_lead_id, p_action_kind, p_action_key, p_holder_kind, p_holder_ref)
  on conflict (business_id, action_key) do nothing
  returning id into v_inserted;

  return jsonb_build_object('ok', true, 'duplicate', v_inserted is null);
end
$$;
revoke all on function public.claim_commercial_action(uuid, uuid, integer, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_commercial_action(uuid, uuid, integer, text, text, text, text, integer) to service_role;

-- Data rights: both tables hold ids, action kinds, hashed keys and times, no
-- personal values; they are removed with the person all the same
-- (src/lib/data-rights/coverage.ts): on anonymise by this trigger, in the
-- scrub's transaction, and on delete by the cascade from leads.
create or replace function public.commercial_locks_clear_on_anonymise()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.lead_commercial_leases l where l.business_id = new.business_id and l.lead_id = new.id;
  delete from public.commercial_action_claims c where c.business_id = new.business_id and c.lead_id = new.id;
  return new;
end
$$;
revoke all on function public.commercial_locks_clear_on_anonymise() from public, anon, authenticated;

drop trigger if exists leads_commercial_locks_clear_on_anonymise on public.leads;
create trigger leads_commercial_locks_clear_on_anonymise
  after update of anonymised_at on public.leads
  for each row when (new.anonymised_at is not null)
  execute function public.commercial_locks_clear_on_anonymise();

-- Releases a lease early (a person finished; an AI turn ended). Only the holder kind releases it.
create or replace function public.release_commercial_lease(p_business_id uuid, p_lead_id uuid, p_holder_kind text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.lead_commercial_leases
   where lead_id = p_lead_id and business_id = p_business_id and holder_kind = p_holder_kind;
$$;
revoke all on function public.release_commercial_lease(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.release_commercial_lease(uuid, uuid, text) to service_role;

-- ------------------------------------------------ 3. the quote view signal
alter table public.lead_intent_signals drop constraint if exists lead_intent_signals_signal_type_check;
alter table public.lead_intent_signals add constraint lead_intent_signals_signal_type_check
  check (signal_type in (
    'BOOKING_REQUEST','DEMO_REQUEST','CALLBACK_REQUEST','QUOTE_REQUEST','PRICING_REQUEST',
    'PURCHASE_REQUEST','TRIAL_OR_SIGNUP_REQUEST','IMPLEMENTATION_QUESTION','INBOUND_ENQUIRY',
    'STATED_PROBLEM','GENERAL_QUESTION',
    'URGENCY','TIMEFRAME','DISSATISFACTION_CURRENT','REPLACEMENT_SEARCH','COMPETITOR_COMPARISON',
    'PRICING_CONCERN_ENGAGED','READY_TO_MEET','READY_TO_BUY',
    'CONVERTING_PAGE_PRICING','CONVERTING_PAGE_DEMO','REPEAT_SUBMISSION','FAST_REPLY',
    'BOOKING_LINK_OPENED','QUOTE_VIEWED_REPEATEDLY',
    'FUNDING','HIRING','JOB_CHANGE','TECH_CHANGE','TENDER',
    'EXPANSION','LEADERSHIP_HIRE','KEY_DEPARTURE','ACQUISITION','REBRAND','WEBSITE_RELAUNCH',
    'PRODUCT_LAUNCH','AWARD','PARTNERSHIP','FILING_DEADLINE','ACCOUNTS_GROWTH','CONTRACT_RENEWAL',
    'NOT_INTERESTED','NO_NEED','WRONG_PERSON','NOT_NOW','UNSUBSCRIBE','COMPLAINT','NON_LEAD',
    'NO_SHOW','OPPORTUNITY_LOST'));
