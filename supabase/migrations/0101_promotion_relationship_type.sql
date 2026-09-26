-- Zapier/connector QA audit, continued: 0100 let a connector/manual/import
-- prospect (source_run_id is null) be promoted to a lead -- but promotion
-- has always written `contact_permissions.relationship_type = 'FOUND_BY_US'`
-- unconditionally (0063), for every promotion, including the one path that
-- already worked (a cold prospect who replied). `FOUND_BY_US` is documented
-- in code as "the one answer that must never produce a Lead"
-- (src/lib/policy/types.ts, `isProspectRelationship`), and the warm-channel
-- policy gate (src/lib/policy/channel-policy.ts `canSend`) treats it exactly
-- like `UNKNOWN`: `hasRelationship` is false, `hasConsent` is false (consent
-- is stamped `UNKNOWN` too), so `requireRelationship` packs -- which is every
-- seeded warm pack -- refuse every send with `BLOCKED_NO_PERMISSION`.
--
-- Net effect, found while verifying 0100 end-to-end against the real agent/
-- policy stack: every promoted lead, connector-sourced or cold-replied, has
-- been permanently unmessageable on a warm channel since 0063 shipped. A
-- human could promote a prospect and never learn why follow-up silently
-- never sent -- the same failure mode CLAUDE.md's send-guard rules exist to
-- prevent, just triggered from data instead of a stop condition.
--
-- The fix records what is actually true instead of a value the policy layer
-- was written to always refuse:
--
--   * `replied_at is not null` -- they messaged the business first. That is
--     literally the definition of `THEY_CONTACTED_US`, already a warm
--     relationship type, and it stays the outcome regardless of source.
--   * `replied_at is null` (connector, manual add, import) -- the business
--     brought this contact in from outside ClientTurn's own cold sourcing.
--     `IMPORTED` ("Imported from another system") is the accurate label for
--     that, it is not `FOUND_BY_US`, and `canSend`'s `hasRelationship` check
--     only excludes `UNKNOWN`/`FOUND_BY_US` -- so `IMPORTED` clears the gate
--     without overclaiming a consent status nobody has confirmed.
--
-- `consent_status` stays `UNKNOWN` in both cases: nothing about promotion
-- itself is evidence of marketing consent, and the policy engine already
-- treats a genuine relationship as sufficient on its own.
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
    v_relationship_type := 'THEY_CONTACTED_US';
    v_relationship_detail := 'Promoted from a sourced prospect after they replied';
  else
    v_relationship_type := 'IMPORTED';
    v_relationship_detail := 'Promoted from a prospect already known to the business (connector, import or manual add), approved by a reviewer';
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

revoke all on function public.promote_reviewed_prospect(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.promote_reviewed_prospect(uuid, uuid, uuid)
  to service_role;

-- Existing promoted leads were stamped FOUND_BY_US/UNKNOWN by 0063 and 0100
-- and have been unmessageable on every warm channel since the day they were
-- promoted. Repair the ones the reply case would have produced correctly had
-- this fix shipped with 0063; a connector/manual/import promotion cannot be
-- told apart retroactively (the prospect's source_run_id is still on the row,
-- but nothing recorded whether *this specific* contact_permissions row came
-- from a reply), so only the unambiguous case is auto-repaired here.
update public.contact_permissions cp
   set relationship_type = 'THEY_CONTACTED_US',
       relationship_detail = 'Promoted from a sourced prospect after they replied'
  from public.leads l, public.prospects p
 where cp.subject_type = 'LEAD'
   and cp.subject_id = l.id
   and l.promoted_from_prospect_id = p.id
   and p.replied_at is not null
   and cp.relationship_type = 'FOUND_BY_US'
   and cp.consent_status = 'UNKNOWN';

update public.leads l
   set relationship_type = 'THEY_CONTACTED_US'
  from public.prospects p
 where l.promoted_from_prospect_id = p.id
   and p.replied_at is not null
   and l.relationship_type = 'FOUND_BY_US';
