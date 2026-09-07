-- 0063_fix_prospect_promotion: make prospect -> lead promotion work, and make it
-- preserve the provenance it exists to preserve.
--
-- Two defects in 0047:
--
--   1. The routine inserted `status = 'new'`. `leads.status` has carried an
--      uppercase-only CHECK since 0003, so EVERY call raised 23514 and no
--      prospect has ever been promoted. Both callers swallowed the exception,
--      and the manual one reported it as "record engagement first", which is a
--      plausible sentence about a completely different cause.
--
--   2. 0038 added the lineage columns (`promoted_from_prospect_id`,
--      `promoted_at`, `company_name`, `source_campaign_id`, `sourcing_run_id`,
--      `intake_method`, `relationship_type`, `subscriber_type`) and built
--      `leads_promoted_from_idx` to query them. The routine wrote none of them,
--      so a promoted lead had no traceable origin, no company and no lawful
--      basis -- which is the one thing promotion is for.
--
-- Everything that was already right is kept unchanged: the row lock that stops
-- two reviewers creating two leads, the idempotent early return, the refusal to
-- promote a suppressed or unengaged prospect, and the re-stamping of the
-- conversation and its messages so the cold history appears in the Lead drawer
-- rather than being copied.

create or replace function public.promote_reviewed_prospect(
  p_business_id uuid,
  p_prospect_id uuid,
  p_user_id uuid
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
begin
  select * into p
    from public.prospects
   where id = p_prospect_id
     and business_id = p_business_id
   for update;

  if not found then
    raise exception 'Prospect not found';
  end if;

  -- Idempotent: a replayed reply, or a second reviewer, gets the same lead.
  if p.promoted_to_lead_id is not null then
    return p.promoted_to_lead_id;
  end if;

  if p.outreach_eligibility = 'SUPPRESSED' or p.status = 'SUPPRESSED' then
    raise exception 'Suppressed prospects cannot be promoted';
  end if;

  if p.replied_at is null then
    raise exception 'Record engagement before promoting a cold prospect';
  end if;

  -- The company is a snapshot, not a link: `leads` deliberately holds the name
  -- it had at promotion, so editing the sourced company later cannot silently
  -- rewrite the history of a lead that has already been worked.
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
    -- Already E.164 on the prospect. Duplicate detection and SMS addressing
    -- both read `phone_normalized`, so leaving it null made a promoted lead
    -- invisible to the duplicate check.
    p.phone_e164,
    c.name,
    'NEW',
    p.agent_id,
    -- Never auto-started. A person decides that a promoted lead should be
    -- messaged, exactly as they do for a lead added by hand.
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
    'CLIENTTURN_SOURCING',
    'SOURCING',
    p_user_id,
    'FOUND_BY_US',
    p.subscriber_type
  )
  returning id into result_id;

  -- The lawful basis that justified the cold contact travels with the person.
  -- Without this row the lead evaluates as UNKNOWN from the moment it exists,
  -- and no warm send can be justified against it.
  insert into public.contact_permissions (
    business_id, subject_type, subject_id, email, phone_e164,
    relationship_type, relationship_detail,
    consent_status, consent_source, lawful_basis_tag,
    subscriber_type, recorded_by
  )
  values (
    p_business_id, 'LEAD', result_id, p.email, p.phone_e164,
    'FOUND_BY_US',
    'Promoted from a sourced prospect after they replied',
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

  -- The same conversation gains a lead, rather than a second thread being
  -- created. Every message in it is stamped so the Lead drawer, which reads by
  -- lead_id, shows the cold history immediately.
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

revoke all on function public.promote_reviewed_prospect(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.promote_reviewed_prospect(uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------- invariants
-- The states below were reachable and meaningless. Each is now refused by the
-- database rather than relied upon not to happen.
--
-- Both are repaired before they are enforced, and both are added as ordinary
-- (validating) constraints because the repair above guarantees no violating row
-- survives. A NOT VALID constraint would leave the existing rows unchecked,
-- which is the situation that produced these states in the first place.

-- CONVERTED means promoted. Promotion has never succeeded, so any CONVERTED row
-- without a lead is a state nothing legitimately produced.
update public.prospects
   set status = 'REPLIED'
 where status = 'CONVERTED'
   and promoted_to_lead_id is null;

alter table public.prospects
  drop constraint if exists prospects_converted_has_lead_check;
alter table public.prospects
  add constraint prospects_converted_has_lead_check
  check (status <> 'CONVERTED' or promoted_to_lead_id is not null);

-- A score and a grade are written together by the scoring stage; one without
-- the other is a half-written row. Clearing both is safe -- the scoring stage
-- recomputes them, and a null grade reads as "not scored yet" everywhere.
update public.prospects
   set score = null, grade = null
 where (score is null) <> (grade is null);

alter table public.prospects
  drop constraint if exists prospects_score_grade_check;
alter table public.prospects
  add constraint prospects_score_grade_check
  check ((score is null) = (grade is null));
