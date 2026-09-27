-- 0144_lead_interests: a lead can hold more than one open interest, each its
-- own opportunity worked toward its own goal (docs/AGENT_RUNTIME.md "Several
-- interests", docs/revenue-engine/08-qualification-intelligence.md §B.20).
--
-- A lead who wants a subscription (a direct sale) and a website rebuild (a
-- meeting) is two opportunities: one per offer (services row), each with its
-- own resolved goal, motion, stage, close target, qualification state and
-- next best action. Winning one does not close the other.
--
--   1. opportunities: service_id (the offer), goal, qualification_state, nba
--      (a small summary of the interest's next best action), interest_source
--      and assessed_at. Existing lead opportunities are back-filled with the
--      lead's own service, so a single-interest lead is unchanged.
--   2. One OPEN opportunity per (lead, service): a partial unique index. Rows
--      with no service (every row before this migration that the back-fill
--      could not attribute, and prospect-company opportunities) are not
--      constrained, exactly as before.
--   3. ensure_interest_opportunity(): create-or-advance the open opportunity
--      for one (lead, service), forward only, serialised on the lead row.
--   4. ensure_lead_opportunity() (0125) now prefers the open opportunity for
--      the lead's own service, so the legacy callers (qualification, booking)
--      never advance a second interest by accident, and stamps the lead's
--      service on a row it creates.
--   5. close_opportunity() (0125) projects the lead's status only when no
--      other opportunity of the lead is still open. While one is, the lead
--      keeps its funnel status (a WON stamps won_at, first-set-wins) and its
--      follow-up carries on for the open interest. When the last one closes
--      the lead is WON if any of its opportunities was won, else LOST. The
--      result carries open_remaining. The signature is unchanged.
--   6. crm_push_records: deal_opportunity_id (which opportunity the existing
--      external_deal_id is) and external_deal_ids ({opportunity id: deal id})
--      for each further interest pushed as its own deal.
--
-- Written, not applied. The application tolerates its absence (isSchemaLag):
-- without it a lead keeps one opportunity and the engine still plans across
-- interests from the lead's facts; the per-interest opportunity rows, the
-- guarded close projection and the extra CRM deals start once it is applied.

-- ------------------------------------------------------------ 1. columns
alter table public.opportunities
  add column if not exists service_id uuid references public.services(id) on delete set null,
  add column if not exists goal text
    check (goal is null or goal in ('A_QUALIFY_ONLY','B_BOOK_MEETING','C_DIRECT_SALE',
                                    'D_SIGNUP_TRIAL','E_HUMAN_CLOSER','F_NURTURE','G_DISQUALIFY')),
  add column if not exists qualification_state text
    check (qualification_state is null
           or qualification_state in ('PENDING','QUALIFIED','NOT_QUALIFIED','REVIEW')),
  -- { action, rule, reason, question, value } of the interest's last plan.
  -- Engine output only (no lead words): the question is the library rendering.
  add column if not exists nba jsonb
    check (nba is null or (jsonb_typeof(nba) = 'object' and pg_column_size(nba) <= 4096)),
  add column if not exists interest_source text
    check (interest_source is null
           or interest_source in ('LEAD_SERVICE','MESSAGE','FORM','MANUAL','OPPORTUNITY')),
  add column if not exists assessed_at timestamptz;

-- Back-fill: every closed lead opportunity, and the newest open one per lead,
-- belong to the lead's own service. A second open row (a manual one) is left
-- unattributed rather than colliding with the index below.
update public.opportunities o
   set service_id = l.service_id,
       interest_source = coalesce(o.interest_source, 'LEAD_SERVICE')
  from public.leads l
 where o.lead_id = l.id
   and o.business_id = l.business_id
   and o.service_id is null
   and l.service_id is not null
   and (o.outcome <> 'OPEN'
        or o.id = (select o2.id from public.opportunities o2
                    where o2.business_id = o.business_id and o2.lead_id = o.lead_id
                      and o2.outcome = 'OPEN'
                    order by o2.created_at desc limit 1));

-- ------------------------------------------------------------ 2. indexes
create unique index if not exists opportunities_open_interest_idx
  on public.opportunities (business_id, lead_id, service_id)
  where outcome = 'OPEN' and service_id is not null and lead_id is not null;

create index if not exists opportunities_lead_service_idx
  on public.opportunities (business_id, lead_id, service_id)
  where lead_id is not null;

-- ------------------------------------------- 3. ensure_interest_opportunity
-- Creates the open opportunity for (lead, service) if there is none,
-- otherwise advances it, forward only. p_stage 'OPEN' only creates. The
-- service must belong to the workspace. Serialised on the lead row, like
-- ensure_lead_opportunity, so two jobs cannot both create the interest.
--
-- Returns { id, created, advanced, stage, previous_stage }.
create or replace function public.ensure_interest_opportunity(
  p_business_id uuid,
  p_lead_id uuid,
  p_service_id uuid,
  p_stage text,
  p_close_target text,
  p_motion text,
  p_name text,
  p_value numeric default null,
  p_currency text default 'GBP',
  p_goal text default null,
  p_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opp public.opportunities%rowtype;
  v_lead_exists boolean;
  v_service_ok boolean;
begin
  if public.opportunity_stage_rank(p_stage) = 0 then
    raise exception 'ensure_interest_opportunity: % is not an open stage', p_stage;
  end if;

  select true into v_lead_exists
    from public.leads
   where id = p_lead_id and business_id = p_business_id
   for update;
  if not coalesce(v_lead_exists, false) then
    raise exception 'ensure_interest_opportunity: lead not found';
  end if;

  select true into v_service_ok
    from public.services
   where id = p_service_id and business_id = p_business_id;
  if not coalesce(v_service_ok, false) then
    raise exception 'ensure_interest_opportunity: service not found';
  end if;

  select * into v_opp
    from public.opportunities
   where business_id = p_business_id
     and lead_id = p_lead_id
     and service_id = p_service_id
     and outcome = 'OPEN'
   limit 1;

  if not found then
    insert into public.opportunities (
      business_id, lead_id, service_id, name, stage, close_target, motion, value,
      currency, goal, interest_source, stage_changed_at
    ) values (
      p_business_id, p_lead_id, p_service_id, left(p_name, 200), p_stage, p_close_target,
      p_motion, p_value, coalesce(p_currency, 'GBP'), p_goal, p_source, now()
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
           value = coalesce(value, p_value),
           goal = coalesce(p_goal, goal)
     where id = v_opp.id;
    return jsonb_build_object(
      'id', v_opp.id, 'created', false, 'advanced', true,
      'stage', p_stage, 'previous_stage', v_opp.stage);
  end if;

  return jsonb_build_object(
    'id', v_opp.id, 'created', false, 'advanced', false,
    'stage', v_opp.stage, 'previous_stage', v_opp.stage);
end $$;

-- ------------------------------------------ 4. ensure_lead_opportunity (0125)
-- Unchanged contract. The open row it advances is now the one for the lead's
-- own service when there is one (then an unattributed one, then the newest),
-- so a lead with several interests never has the wrong one advanced by the
-- legacy callers. A row it creates carries the lead's service.
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
  v_service_id uuid;
  v_lead_exists boolean;
begin
  if public.opportunity_stage_rank(p_stage) = 0 then
    raise exception 'ensure_lead_opportunity: % is not an open stage', p_stage;
  end if;

  select true, service_id into v_lead_exists, v_service_id
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
   order by (service_id is not distinct from v_service_id) desc,
            (service_id is null) desc,
            created_at desc
   limit 1;

  if not found then
    insert into public.opportunities (
      business_id, lead_id, service_id, name, stage, close_target, motion, value, currency,
      interest_source, stage_changed_at
    ) values (
      p_business_id, p_lead_id, v_service_id, left(p_name, 200), p_stage, p_close_target, p_motion,
      p_value, coalesce(p_currency, 'GBP'),
      case when v_service_id is null then null else 'LEAD_SERVICE' end, now()
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

-- ------------------------------------------------ 5. close_opportunity (0125)
-- Same signature and result keys, plus open_remaining. The lead's status is a
-- projection of ALL its opportunities: while another is open the lead stays
-- in its funnel status (won_at is still stamped on a win: the lead is a
-- customer), and the last close decides WON (any won) or LOST.
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
  v_open integer := 0;
  v_any_won boolean := false;
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
    -- Serialise on the lead: two interests closing at once see each other.
    perform 1 from public.leads
      where id = v_opp.lead_id and business_id = p_business_id
      for update;

    select count(*) filter (where outcome = 'OPEN'),
           coalesce(bool_or(outcome = 'WON'), false)
      into v_open, v_any_won
      from public.opportunities
     where business_id = p_business_id and lead_id = v_opp.lead_id;

    if v_open > 0 then
      update public.leads
         set won_at = case when p_outcome = 'WON' then coalesce(won_at, now()) else won_at end
       where id = v_opp.lead_id and business_id = p_business_id
      returning status into v_status;
    else
      update public.leads
         set status = case when v_any_won then 'WON' else p_outcome end,
             won_at = case when v_any_won then coalesce(won_at, now()) else won_at end,
             lost_at = case when not v_any_won then coalesce(lost_at, now()) else lost_at end
       where id = v_opp.lead_id and business_id = p_business_id
      returning status into v_status;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_opp.id,
    'lead_id', v_opp.lead_id,
    'outcome', p_outcome,
    'previous_stage', v_opp.stage,
    'previous_outcome', v_opp.outcome,
    'lead_status', v_status,
    'open_remaining', v_open);
end $$;

revoke all on function public.ensure_interest_opportunity(uuid, uuid, uuid, text, text, text, text, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ensure_interest_opportunity(uuid, uuid, uuid, text, text, text, text, numeric, text, text, text)
  to service_role;
revoke all on function public.ensure_lead_opportunity(uuid, uuid, text, text, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.ensure_lead_opportunity(uuid, uuid, text, text, text, text, numeric, text)
  to service_role;
revoke all on function public.close_opportunity(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.close_opportunity(uuid, uuid, text, text) to service_role;

-- ------------------------------------------------------ 6. CRM, one deal each
alter table public.crm_push_records
  add column if not exists deal_opportunity_id uuid references public.opportunities(id) on delete set null,
  add column if not exists external_deal_ids jsonb not null default '{}'::jsonb
    check (jsonb_typeof(external_deal_ids) = 'object' and pg_column_size(external_deal_ids) <= 8192);
