-- 0125_channels_closing_handoff: Phase 3 of the core revenue engine --
-- opportunities wired to the funnel, direct close, the handoff pack, booking
-- reschedules and channel bookkeeping.
--
-- Design: docs/revenue-engine/05-phases-3-6-design.md "Phase 3" (3.1-3.5),
-- decisions Q2 (direct close) and Q3 (opportunities) in 00 §6.
--
-- 1. opportunities: QUALIFIED and CHECKOUT_SENT join the stage vocabulary;
--    ensure_lead_opportunity() creates-or-advances the open opportunity for a
--    lead (forward only, serialised per lead); close_opportunity() records
--    WON/LOST with a reason AND projects it onto leads.status in one
--    transaction, so the two can never disagree.
-- 2. commercial_authority: one row per workspace, off by default. The agent
--    may send only an approved checkout link with its approved price text.
-- 3. agent_handoffs.reason gains BUDGET_EXCEEDED (Phase 4 budget manager
--    handing a live conversation to a person).
-- 4. bookings: reschedule bookkeeping (one `rescheduled` transition keeps one
--    row; no new status, so the active-slot rules of 0113 are untouched).
-- 5. sender_identities.dkim_selector for the daily DNS health probe.
-- 6. inmail_sends: user-sent LinkedIn InMail, for credit tracking (01 §3).
-- 7. ai_task_routes: handoff_brief at tier 2.

-- ---------------------------------------------------------- opportunities
alter table public.opportunities drop constraint if exists opportunities_stage_check;
alter table public.opportunities
  add constraint opportunities_stage_check
  check (stage in ('OPEN','QUALIFYING','QUALIFIED','MEETING_BOOKED','PROPOSAL',
                   'CHECKOUT_SENT','NEGOTIATION','CLOSED'));

alter table public.opportunities
  add column if not exists stage_changed_at timestamptz,
  -- The approved checkout link (commercial_authority.approved_checkout_links[].id)
  -- last sent for this opportunity. Never a URL: the URL lives on the list.
  add column if not exists checkout_link_id text
    check (checkout_link_id is null or length(checkout_link_id) between 1 and 64);

-- Forward order of the open stages. CLOSED is never reached by advancing; it
-- is reached only through close_opportunity().
create or replace function public.opportunity_stage_rank(p_stage text)
returns integer
language sql
immutable
as $$
  select coalesce(array_position(
    array['OPEN','QUALIFYING','QUALIFIED','MEETING_BOOKED','PROPOSAL',
          'CHECKOUT_SENT','NEGOTIATION']::text[], p_stage), 0);
$$;

-- Creates the lead's open opportunity if it has none, otherwise advances it --
-- forward only, so a late qualification event can never pull a booked
-- opportunity back to QUALIFIED. Serialised on the lead row so two concurrent
-- jobs cannot both create one.
--
-- Returns { id, created, advanced, stage, previous_stage }.
create or replace function public.ensure_lead_opportunity(
  p_business_id uuid,
  p_lead_id uuid,
  p_stage text,
  p_close_target text,
  p_motion text,
  p_name text,
  p_value numeric default null,
  p_currency text default 'GBP'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp public.opportunities%rowtype;
  v_lead_exists boolean;
begin
  if public.opportunity_stage_rank(p_stage) = 0 then
    raise exception 'ensure_lead_opportunity: % is not an open stage', p_stage;
  end if;

  select true into v_lead_exists
    from public.leads
   where id = p_lead_id and business_id = p_business_id
   for update;
  if not coalesce(v_lead_exists, false) then
    raise exception 'ensure_lead_opportunity: lead not found';
  end if;

  select * into v_opp
    from public.opportunities
   where business_id = p_business_id
     and lead_id = p_lead_id
     and outcome = 'OPEN'
   order by created_at desc
   limit 1;

  if not found then
    insert into public.opportunities (
      business_id, lead_id, name, stage, close_target, motion, value, currency,
      stage_changed_at
    ) values (
      p_business_id, p_lead_id, left(p_name, 200), p_stage, p_close_target, p_motion,
      p_value, coalesce(p_currency, 'GBP'), now()
    )
    returning * into v_opp;

    return jsonb_build_object(
      'id', v_opp.id, 'created', true, 'advanced', true,
      'stage', v_opp.stage, 'previous_stage', null);
  end if;

  if public.opportunity_stage_rank(p_stage) > public.opportunity_stage_rank(v_opp.stage) then
    update public.opportunities
       set stage = p_stage,
           stage_changed_at = now(),
           value = coalesce(value, p_value)
     where id = v_opp.id;
    return jsonb_build_object(
      'id', v_opp.id, 'created', false, 'advanced', true,
      'stage', p_stage, 'previous_stage', v_opp.stage);
  end if;

  return jsonb_build_object(
    'id', v_opp.id, 'created', false, 'advanced', false,
    'stage', v_opp.stage, 'previous_stage', v_opp.stage);
end $$;

-- WON / LOST, with a reason, on the opportunity -- and the lead's status as a
-- projection of it, in the same transaction (decision Q3). Lifecycle stamps on
-- the lead are first-set-wins, matching lead.set_status.
--
-- Returns { id, lead_id, outcome, previous_stage, previous_outcome, lead_status }.
create or replace function public.close_opportunity(
  p_business_id uuid,
  p_opportunity_id uuid,
  p_outcome text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp public.opportunities%rowtype;
  v_status text;
begin
  if p_outcome not in ('WON','LOST') then
    raise exception 'close_opportunity: outcome must be WON or LOST';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'close_opportunity: a reason is required';
  end if;

  select * into v_opp
    from public.opportunities
   where id = p_opportunity_id and business_id = p_business_id
   for update;
  if not found then
    raise exception 'close_opportunity: opportunity not found';
  end if;

  update public.opportunities
     set stage = 'CLOSED',
         outcome = p_outcome,
         outcome_reason = left(btrim(p_reason), 500),
         closed_at = coalesce(closed_at, now()),
         stage_changed_at = now()
   where id = v_opp.id;

  if v_opp.lead_id is not null then
    update public.leads
       set status = p_outcome,
           won_at = case when p_outcome = 'WON' then coalesce(won_at, now()) else won_at end,
           lost_at = case when p_outcome = 'LOST' then coalesce(lost_at, now()) else lost_at end
     where id = v_opp.lead_id and business_id = p_business_id
    returning status into v_status;
  end if;

  return jsonb_build_object(
    'id', v_opp.id,
    'lead_id', v_opp.lead_id,
    'outcome', p_outcome,
    'previous_stage', v_opp.stage,
    'previous_outcome', v_opp.outcome,
    'lead_status', v_status);
end $$;

revoke all on function public.ensure_lead_opportunity(uuid, uuid, text, text, text, text, numeric, text)
  from public, anon, authenticated;
revoke all on function public.close_opportunity(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.ensure_lead_opportunity(uuid, uuid, text, text, text, text, numeric, text)
  to service_role;
grant execute on function public.close_opportunity(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------- commercial_authority
-- Decision Q2. Customer-supplied checkout links only; no Stripe Connect, no
-- invented prices. `approved_checkout_links` is
--   [{ id, label, product, url, price_text, currency }]
-- validated by src/lib/commercial/authority.ts before every write.
create table if not exists public.commercial_authority (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled boolean not null default false,
  approved_checkout_links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(approved_checkout_links) = 'array'
           and jsonb_array_length(approved_checkout_links) <= 25),
  max_discount_percent numeric(5,2) not null default 0
    check (max_discount_percent between 0 and 100),
  -- Above this opportunity value (minor units of the link's currency) a person
  -- sends the checkout, not the agent. Null = no value ceiling.
  requires_human_above_value_minor bigint
    check (requires_human_above_value_minor is null or requires_human_above_value_minor >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger commercial_authority_set_updated_at
  before update on public.commercial_authority
  for each row execute function public.set_updated_at();

alter table public.commercial_authority enable row level security;
alter table public.commercial_authority force row level security;
revoke all on public.commercial_authority from anon, authenticated;
grant select on public.commercial_authority to authenticated;
create policy commercial_authority_select_member on public.commercial_authority
  for select to authenticated using (public.is_business_member(business_id));
-- Writes go through the owner/admin server action with the service role.

-- ---------------------------------------------------------- agent_handoffs
alter table public.agent_handoffs drop constraint if exists agent_handoffs_reason_check;
alter table public.agent_handoffs
  add constraint agent_handoffs_reason_check
  check (reason in ('HUMAN_REQUESTED', 'COMPLAINT', 'LOW_CONFIDENCE', 'QUALIFICATION_REVIEW',
                    'PRICING_NOT_CONFIGURED', 'OUT_OF_SCOPE', 'PROVIDER_FAILURE',
                    'TOOL_FAILURE', 'MAX_STEPS_EXCEEDED', 'POLICY', 'EMERGENCY',
                    'HIGH_VALUE', 'NO_NEXT_QUESTION', 'BUDGET_EXCEEDED', 'READY_TO_BUY'));

-- ---------------------------------------------------------------- bookings
-- A Calendly reschedule is invitee.canceled(rescheduled) + invitee.created on
-- a new scheduled event. booking.sync folds the pair into the existing row:
-- external_event_id moves to the new event, the old start is kept here.
alter table public.bookings
  add column if not exists rescheduled_at timestamptz,
  add column if not exists previous_starts_at timestamptz,
  add column if not exists reschedule_count integer not null default 0
    check (reschedule_count >= 0);

-- ------------------------------------------------------- sender_identities
alter table public.sender_identities
  add column if not exists dkim_selector text
    check (dkim_selector is null or dkim_selector ~ '^[A-Za-z0-9._-]{1,63}$');

-- ---------------------------------------------------------------- InMail
-- LinkedIn stays ASSISTED: a person sends the InMail in LinkedIn and records it
-- here. Credits are derived (src/lib/outreach/inmail-credits.ts): 50 a month,
-- rolling over to 150, one back for a reply within 90 days.
create table if not exists public.inmail_sends (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  sent_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz not null default now(),
  replied_at timestamptz,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  check (replied_at is null or replied_at >= sent_at)
);

create index if not exists inmail_sends_business_idx
  on public.inmail_sends (business_id, sent_at desc);
create index if not exists inmail_sends_prospect_idx
  on public.inmail_sends (business_id, prospect_id)
  where prospect_id is not null;

alter table public.inmail_sends enable row level security;
alter table public.inmail_sends force row level security;
revoke all on public.inmail_sends from anon, authenticated;
grant select on public.inmail_sends to authenticated;
create policy inmail_sends_select_member on public.inmail_sends
  for select to authenticated using (public.is_business_member(business_id));

-- ----------------------------------------------------------- ai_task_routes
insert into public.ai_task_routes (task_type, default_tier, allowed_tiers)
values ('handoff_brief', 2, array[2]::smallint[])
on conflict (task_type) do nothing;
