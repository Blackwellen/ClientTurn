-- Zapier/connector QA audit: inbound-connector contacts could never reach
-- qualification, the deterministic follow-up engine, or booking.
--
-- `promote_reviewed_prospect` (0047, corrected by 0063) requires
-- `replied_at is not null` before a prospect can become a lead: "record
-- engagement before promoting a cold prospect." That rule protects the thing
-- it was written for -- a Find Leads cold-sourced record nobody has actually
-- heard back from -- but it also silently applied to every inbound connector
-- install (Zapier, Pipedrive, Attio, Clay, folk, ...), the manual "add
-- prospect" form, and CSV imports. None of those are cold outreach: a person
-- or a system the customer already runs is vouching for the contact by
-- pushing or typing it in, and the Connections page tells the customer their
-- contacts "arrive in Find Leads for review" -- a review with no possible
-- next step, since Promote always raised "Record engagement before promoting
-- a cold prospect" for every one of them.
--
-- The fix distinguishes "cold-sourced" from "already known" the same way the
-- rest of the codebase already does: a Find Leads search/sourcing run always
-- stamps `source_run_id` (see jobs/handlers/sourcing-run.ts); a connector
-- ingest, a manual add, and a CSV import never do (see 0059, leads/add-lead/
-- actions.ts, imports/actions.ts). Promotion of a `source_run_id is null`
-- prospect still requires an admin's own click (`requireFindLeadsAdmin` in
-- `promoteProspectToLeadAction`) -- that click is the engagement being
-- recorded, in place of a reply that was never possible to begin with.
--
-- Everything else below is 0063's function, byte-for-byte, with only that one
-- condition changed. This file is written against 0063, not 0047 -- an
-- earlier draft of this migration mistakenly rebuilt the function from 0047
-- and would have silently reverted the lowercase-status bug, the missing
-- company snapshot, the missing contact_permissions row and the missing
-- provenance columns that 0063 fixed. Recreating that regression here is the
-- one failure mode this migration exists to avoid.
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

  -- A cold Find Leads record (source_run_id set) still needs a reply. A
  -- prospect that arrived already known -- a connector push, a manual add, an
  -- import -- was never cold outreach and has no reply to wait for.
  if p.replied_at is null and p.source_run_id is not null then
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
  -- and no warm send can be justified against it. The detail text is itself a
  -- compliance record, so it says what actually happened rather than always
  -- claiming a reply -- a connector push or a manual add never had one.
  insert into public.contact_permissions (
    business_id, subject_type, subject_id, email, phone_e164,
    relationship_type, relationship_detail,
    consent_status, consent_source, lawful_basis_tag,
    subscriber_type, recorded_by
  )
  values (
    p_business_id, 'LEAD', result_id, p.email, p.phone_e164,
    'FOUND_BY_US',
    case
      when p.replied_at is not null then 'Promoted from a sourced prospect after they replied'
      else 'Promoted from a prospect already known to the business (connector, import or manual add), approved by a reviewer'
    end,
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
