-- 0118_places_content_cleanup: remove the Google Places content 0114 left in
-- place (defect B24; decision Q7 in docs/revenue-engine/00 §6).
--
-- Maps Platform ToS §3.2.3(a) forbids storing Places content, naming "business
-- names, addresses" explicitly; only place IDs may be kept indefinitely. 0114
-- removed stored coordinates but left names and address components, because
-- blanking a name breaks the record. This decides what replaces them.
--
-- Rows are identified exactly as in 0114: companies found in a sourcing run
-- where google_places answered the company search.
--
-- * Name. A company the Companies House lookup confirmed keeps its name: the
--   lookup only accepts an exact normalised match, so the stored name equals
--   the registered name -- lawful public data from the register, not from
--   Google. Every other name becomes the company's domain, which is our own
--   pointer to its first-party website (where enrichment can later read the
--   real name).
-- * Address. Region, city and postcode are removed. Country is re-derived
--   from our own evidence rather than kept from Places: 'GB' where the UK
--   register confirmed the company or the domain is a .uk domain, otherwise
--   null. The policy engine needs a country, and a missing one fails closed.

with places_found as (
  select distinct pc.id
    from public.prospect_companies pc
    join public.sourcing_run_results r
      on r.company_id = pc.id and r.business_id = pc.business_id
    join public.sourcing_run_queries q
      on q.run_id = r.run_id and q.business_id = r.business_id
   where r.outcome = 'COMPANY_FOUND'
     and q.provider = 'google_places'
     and q.stage = 'FINDING_COMPANIES'
     and q.status = 'SUCCESS'
)
update public.prospect_companies pc
   set name = case
                when pc.registry_reason like 'Confirmed on the Companies House register as%' then pc.name
                else coalesce(nullif(pc.domain, ''), 'Unnamed company')
              end,
       location_json = jsonb_build_object(
         'country',
         case
           when pc.registry_reason like 'Confirmed on the Companies House register as%' then 'GB'
           when pc.domain ~* '\.uk$' then 'GB'
           else null
         end
       )
  from places_found
 where pc.id = places_found.id;
