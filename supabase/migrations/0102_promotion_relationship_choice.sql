-- Zapier/connector QA audit, continued: 0101 fixed *what* promotion records
-- for a never-replied prospect (IMPORTED instead of the forbidden
-- FOUND_BY_US), but it still guesses on the promoting admin's behalf. The
-- Add Lead wizard (src/components/leads/add-lead/permission-step.tsx) never
-- does that -- it makes a human pick the relationship type and shows them
-- what it unlocks before the lead exists. Promotion should carry the same
-- discipline: IMPORTED remains the safe default so every existing caller
-- keeps working unchanged, but the "Promote to lead" UI can now pass what the
-- admin actually confirmed.
--
-- The reply case is deliberately NOT made choosable: `replied_at` is a fact
-- the system observed, not a claim, so it keeps overriding any passed value
-- with THEY_CONTACTED_US exactly as 0101 left it.
--
-- Adding a parameter changes the signature, so `create or replace` cannot
-- reuse the existing 3-arg function -- Postgres would keep both, and a
-- 3-argument call would then be ambiguous between the old function and this
-- one's defaulted 4th argument. The old one is dropped first so there is
-- exactly one `promote_reviewed_prospect` again.
drop function if exists public.promote_reviewed_prospect(uuid, uuid, uuid);

create function public.promote_reviewed_prospect(
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

  -- A cold Find Leads record (source_run_id set) still needs a reply. A
  -- prospect that arrived already known -- a connector push, a manual add, an
  -- import -- was never cold outreach and has no reply to wait for.
  if p.replied_at is null and p.source_run_id is not null then
    raise exception 'Record engagement before promoting a cold prospect';
  end if;

  if p.replied_at is not null then
    -- Observed fact, not a claim a caller gets to override.
    v_relationship_type := 'THEY_CONTACTED_US';
    v_relationship_detail := 'Promoted from a sourced prospect after they replied';
  elsif p_relationship_type is null then
    v_relationship_type := 'IMPORTED';
    v_relationship_detail := 'Promoted from a prospect already known to the business (connector, import or manual add), approved by a reviewer';
  else
    -- FOUND_BY_US and UNKNOWN are the two values the policy engine treats as
    -- "not actually warm" (src/lib/policy/channel-policy.ts canSend), so a
    -- human confirming a relationship is not allowed to pick either --
    -- checked here, not only in the calling Zod schema, because this
    -- function is reachable directly by any service-role caller.
    if p_relationship_type not in (
      'THEY_CONTACTED_US','EXISTING_CUSTOMER','REFERRAL','REQUESTED_INFORMATION',
      'EXISTING_BUSINESS_RELATIONSHIP','ACCEPTED_SOCIAL_CONNECTION','IMPORTED','OTHER'
    ) then
      raise exception 'Invalid relationship type for promotion';
    end if;
    v_relationship_type := p_relationship_type;
    v_relationship_detail := 'Promoted from a prospect already known to the business, approved by a reviewer who confirmed the relationship';
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
    v_relationship_type,
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

-- Every existing caller (reply-triggered auto-promotion, the manual action)
-- passes exactly `p_business_id, p_prospect_id, p_user_id` and keeps working
-- unchanged: the 4th parameter's default satisfies a 3-argument call, and
-- there is now only one function for Postgres to resolve it against.
revoke all on function public.promote_reviewed_prospect(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.promote_reviewed_prospect(uuid, uuid, uuid, text)
  to service_role;
