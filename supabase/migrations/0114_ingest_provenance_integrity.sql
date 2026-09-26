-- 0114_ingest_provenance_integrity: attribution, submission time, promotion
-- provenance and Google Places retention (B11, B12, B16, B24).
--
-- Nothing here rewrites history that cannot be reconstructed. Leads attributed
-- to the wrong campaign/ad before this migration (B11) stay as they are: the
-- per-lead ad ids were never stored, so there is nothing to correct them from.

-- ------------------------------------------------------ B12: submission time
-- When the person submitted the lead form, as the ad platform reports it.
-- `created_at` is when a poll happened to fetch it, which for a polled source
-- can be minutes or hours later and is not the speed-to-lead clock.
alter table public.leads
  add column if not exists source_submitted_at timestamptz;

comment on column public.leads.source_submitted_at is
  'Form submission time reported by the ad platform (Google Ads, Meta, LinkedIn). Null when unknown.';

-- ------------------------------------------- B11: one source per ad tuple
-- lead_sources was reused per (provider, form), so every lead from a form
-- inherited the first lead's campaign, ad set and ad. lead-process.ts now keys
-- on the full tuple; this index makes that race-safe (two workers resolving a
-- new ad at once produce one row) and is the `onConflict` target it upserts
-- against. NULLS NOT DISTINCT so a missing page or ad id still matches.
--
-- Rows with an identical tuple can already exist (the old lookup was not
-- race-safe). They are merged onto the oldest row first, or the index could
-- not be built. Identical tuple = identical attribution, so this re-points no
-- lead at a different campaign.
with ranked as (
  select id,
         first_value(id) over (
           partition by business_id, provider, page_id, form_id, campaign_id, adset_id, ad_id
           order by created_at, id
         ) as keeper
    from public.lead_sources
)
update public.leads l
   set source_id = r.keeper
  from ranked r
 where l.source_id = r.id
   and r.id <> r.keeper;

with ranked as (
  select id,
         first_value(id) over (
           partition by business_id, provider, page_id, form_id, campaign_id, adset_id, ad_id
           order by created_at, id
         ) as keeper
    from public.lead_sources
)
delete from public.lead_sources s
 using ranked r
 where s.id = r.id
   and r.id <> r.keeper;

create unique index if not exists lead_sources_attribution_key
  on public.lead_sources (business_id, provider, page_id, form_id, campaign_id, adset_id, ad_id)
  nulls not distinct;

-- ----------------------------------------------- B24: Google Places content
-- Google Maps Platform ToS §3.2.3(a) forbids storing Places content ("business
-- names, addresses" named explicitly); the Service Specific Terms cap cached
-- latitude/longitude at 30 days; only place IDs may be kept indefinitely. The
-- google_places provider now persists only the place ID and a website pointer
-- (see src/lib/find-leads/server/company-provenance.ts).
--
-- Coordinates already stored from Places are removed here. Before this
-- migration the company row did not record which provider found it, so a row
-- is identified through the run that found it: a COMPANY_FOUND result in a run
-- where google_places answered the company search. That can include a company
-- another provider supplied in the same run -- removing its coordinates loses
-- a little precision and breaches nothing, so erring that way is deliberate.
-- Names and address components are NOT touched here: there is no lawful
-- replacement for a name yet and blanking it would break the record; that is
-- reported for a decision rather than guessed at.
update public.prospect_companies pc
   set location_json = pc.location_json || '{"lat": null, "lon": null}'::jsonb
 where (jsonb_typeof(pc.location_json -> 'lat') = 'number'
        or jsonb_typeof(pc.location_json -> 'lon') = 'number')
   and exists (
     select 1
       from public.sourcing_run_results r
       join public.sourcing_run_queries q
         on q.run_id = r.run_id
        and q.business_id = r.business_id
      where r.company_id = pc.id
        and r.business_id = pc.business_id
        and r.outcome = 'COMPANY_FOUND'
        and q.provider = 'google_places'
        and q.stage = 'FINDING_COMPANIES'
        and q.status = 'SUCCESS'
   );

-- -------------------------------------------- B16: promotion provenance
-- 0102's function, byte-for-byte, except that intake_method / created_via are
-- derived from the prospect's origin instead of being hard-coded to sourcing.
-- Same signature, so `create or replace` keeps exactly one function and the
-- grants below are unchanged from 0102.
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

  -- B16: provenance comes from the prospect's own origin. 0102 stamped
  -- CLIENTTURN_SOURCING / SOURCING on every promotion, so a CSV row, a
  -- connector push or a hand-added contact read as cold-sourced for life.
  -- Origin markers, in order of certainty:
  --   source_run_id          a Find Leads sourcing run (sourcing-run.ts)
  --   workspace_app_events   a connector push (process_workspace_app_event)
  --   source_provider        'import' (imports/actions.ts),
  --                          'manual_prospect' (add-lead/actions.ts),
  --                          'meta_webhook' (social/comment-ingest.ts),
  --                          '<platform>_engagement' (engagement-ingest.ts)
  -- Anything unrecognised is recorded as OTHER with no created_via, rather
  -- than guessed.
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
    v_intake_method,
    v_created_via,
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

revoke all on function public.promote_reviewed_prospect(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.promote_reviewed_prospect(uuid, uuid, uuid, text)
  to service_role;
