-- 0060_campaign_audience_geography: count a campaign's audience by distance
-- rather than by matching city names as text (V4 section 16.9).
--
-- "Bournemouth + 25 miles" is a geographic claim. Matching `city ILIKE
-- '%Bournemouth%'` answers a different question: it misses every company in
-- Poole and Christchurch that is plainly inside the radius, and it silently
-- looks like it worked. `prospect_companies.location_json` already carries the
-- lat/lon the sourcing pipeline resolved, so the honest count is available.
--
-- Great-circle distance, with a cheap bounding-box prefilter first so the
-- trigonometry only runs on rows that could plausibly qualify.

create or replace function public.outreach_audience_geo_count(
  p_business_id uuid,
  p_lat double precision,
  p_lon double precision,
  p_radius_km double precision,
  p_industries text[] default null,
  p_company_sizes text[] default null,
  p_roles text[] default null,
  p_exclude_customers boolean default true
)
returns table (
  grade text,
  prospect_count integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  with bounds as (
    select
      -- One degree of latitude is ~111.045 km everywhere. Longitude narrows
      -- with latitude, and the cosine guard keeps the box finite near a pole.
      p_lat - (p_radius_km / 111.045) as min_lat,
      p_lat + (p_radius_km / 111.045) as max_lat,
      p_lon - (p_radius_km / (111.045 * greatest(cos(radians(p_lat)), 0.01))) as min_lon,
      p_lon + (p_radius_km / (111.045 * greatest(cos(radians(p_lat)), 0.01))) as max_lon
  ),
  candidates as (
    select
      p.id,
      p.grade,
      (c.location_json ->> 'lat')::double precision as lat,
      (c.location_json ->> 'lon')::double precision as lon
    from public.prospects p
    join public.prospect_companies c
      on c.id = p.company_id
     and c.business_id = p_business_id
    cross join bounds b
    where p.business_id = p_business_id
      and p.is_test = false
      and p.promoted_to_lead_id is null
      and p.email is not null
      and p.status in ('DISCOVERED','VERIFIED','READY','APPROVED','REVIEW')
      and (p_industries is null or c.industry = any(p_industries))
      and (p_company_sizes is null or c.company_size = any(p_company_sizes))
      and (p_roles is null or p.role_title ilike any(p_roles))
      and (not p_exclude_customers or c.is_existing_customer = false)
      -- Bounding box first: cheap, and it discards almost everything.
      and (c.location_json ->> 'lat') is not null
      and (c.location_json ->> 'lon') is not null
      and (c.location_json ->> 'lat')::double precision between b.min_lat and b.max_lat
      and (c.location_json ->> 'lon')::double precision between b.min_lon and b.max_lon
  ),
  inside as (
    select id, grade
    from candidates
    where 2 * 6371 * asin(
            least(1, sqrt(
              sin(radians(lat - p_lat) / 2) ^ 2
              + cos(radians(p_lat)) * cos(radians(lat))
                * sin(radians(lon - p_lon) / 2) ^ 2
            ))
          ) <= p_radius_km
  )
  select coalesce(grade, 'UNGRADED') as grade, count(*)::int
    from inside
   group by coalesce(grade, 'UNGRADED');
$fn$;

revoke all on function public.outreach_audience_geo_count(
  uuid, double precision, double precision, double precision, text[], text[], text[], boolean
) from public, anon;
grant execute on function public.outreach_audience_geo_count(
  uuid, double precision, double precision, double precision, text[], text[], text[], boolean
) to authenticated;

-- Supports the bounding-box scan. A partial index, because a company with no
-- coordinates can never satisfy a radius filter and only bloats the tree.
create index if not exists prospect_companies_geo_idx
  on public.prospect_companies (
    business_id,
    ((location_json ->> 'lat')::double precision),
    ((location_json ->> 'lon')::double precision)
  )
  where location_json ? 'lat' and location_json ? 'lon';
