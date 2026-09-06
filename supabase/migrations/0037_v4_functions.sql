-- 0037_v4_functions: aggregation done in Postgres rather than by pulling rows
-- into the app.
--
-- The rule this file follows is the one 0022 established for reactivation: a
-- surface that must count thousands of rows (a sourcing run's funnel, a
-- campaign's performance, a tenant's monthly COGS) aggregates in the database.
-- A client-side scan would silently truncate at the PostgREST row cap and
-- under-report, which is worse than being slow.
--
-- Functions that a customer surface calls are `security invoker`, so RLS stays
-- in force and the explicit business_id argument is an extra filter rather than
-- the only guard. Functions that touch cost are `security definer` and are
-- revoked from `authenticated` entirely — the admin console reaches them
-- through the service role.

-- ------------------------------------------------------ sourcing run funnel
create or replace function public.sourcing_run_counters(
  p_business_id uuid,
  p_run_id uuid
)
returns table (
  companies_found integer,
  contacts_found integer,
  emails_discovered integer,
  verified integer,
  duplicates integer,
  suppressed integer,
  review_required integer,
  ready integer,
  rejected integer,
  errors integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where outcome = 'COMPANY_FOUND')::int,
    count(*) filter (where outcome = 'CONTACT_FOUND')::int,
    count(*) filter (where outcome = 'EMAIL_FOUND')::int,
    count(*) filter (where outcome = 'VERIFIED')::int,
    count(*) filter (where outcome = 'DUPLICATE')::int,
    count(*) filter (where outcome = 'SUPPRESSED')::int,
    count(*) filter (where outcome = 'REVIEW_REQUIRED')::int,
    count(*) filter (where outcome = 'READY')::int,
    count(*) filter (where outcome like 'REJECTED%')::int,
    count(*) filter (where outcome = 'ERROR')::int
  from public.sourcing_run_results r
  where r.business_id = p_business_id
    and r.run_id = p_run_id;
$$;

-- --------------------------------------------------- prospect quick counts
-- Backs the Prospects view's quick-filter chips. One round trip instead of
-- seven count queries.
create or replace function public.prospect_quick_counts(p_business_id uuid)
returns table (
  all_count integer,
  a_grade integer,
  intent integer,
  ready integer,
  contacted integer,
  replied integer,
  review integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*)::int,
    count(*) filter (where p.grade in ('A+','A'))::int,
    count(*) filter (where exists (
      select 1 from public.prospect_intent_matches m
      where m.prospect_id = p.id and m.expires_at > now()
    ))::int,
    count(*) filter (where p.status = 'READY')::int,
    count(*) filter (where p.status in ('OUTREACH_ACTIVE','APPROVED'))::int,
    count(*) filter (where p.status = 'REPLIED')::int,
    count(*) filter (where p.status = 'REVIEW' or p.outreach_eligibility = 'REVIEW')::int
  from public.prospects p
  where p.business_id = p_business_id
    and not p.is_test
    and p.promoted_to_lead_id is null;
$$;

-- -------------------------------------------------- acquisition campaign funnel
create or replace function public.outreach_campaign_results(
  p_business_id uuid,
  p_campaign_id uuid default null
)
returns table (
  campaign_id uuid,
  audience_count integer,
  contacted_count integer,
  delivered_count integer,
  bounced_count integer,
  reply_count integer,
  positive_reply_count integer,
  opt_out_count integer,
  promoted_count integer,
  converted_count integer,
  stopped_count integer,
  pending_count integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with scoped as (
    select c.id
    from public.outreach_campaigns c
    where c.business_id = p_business_id
      and (p_campaign_id is null or c.id = p_campaign_id)
  ),
  recipients as (
    select
      r.campaign_id,
      count(*)::int as audience_count,
      count(*) filter (where r.steps_sent > 0)::int as contacted_count,
      count(*) filter (where r.status = 'REPLIED')::int as reply_count,
      count(*) filter (where r.status = 'BOUNCED')::int as bounced_count,
      count(*) filter (where r.status = 'SUPPRESSED')::int as opt_out_count,
      count(*) filter (where r.status = 'STOPPED')::int as stopped_count,
      count(*) filter (where r.status in ('PENDING','SCHEDULED'))::int as pending_count
    from public.outreach_recipient_runs r
    join scoped s on s.id = r.campaign_id
    where r.business_id = p_business_id
    group by r.campaign_id
  ),
  outcomes as (
    select
      p.campaign_id,
      count(*) filter (where p.promoted_to_lead_id is not null)::int as promoted_count,
      count(*) filter (where p.status = 'CONVERTED')::int as converted_count
    from public.prospects p
    join scoped s on s.id = p.campaign_id
    where p.business_id = p_business_id
    group by p.campaign_id
  ),
  delivery as (
    select
      m.campaign_id,
      count(*) filter (where m.status in ('DELIVERED','SENT'))::int as delivered_count,
      count(*) filter (where m.direction = 'inbound'
                         and m.reply_classification in ('POSITIVE_INTEREST','NEUTRAL_QUESTION'))::int
        as positive_reply_count
    from public.messages m
    join scoped s on s.id = m.campaign_id
    where m.business_id = p_business_id
    group by m.campaign_id
  )
  select
    s.id,
    coalesce(r.audience_count, 0),
    coalesce(r.contacted_count, 0),
    coalesce(d.delivered_count, 0),
    coalesce(r.bounced_count, 0),
    coalesce(r.reply_count, 0),
    coalesce(d.positive_reply_count, 0),
    coalesce(r.opt_out_count, 0),
    coalesce(o.promoted_count, 0),
    coalesce(o.converted_count, 0),
    coalesce(r.stopped_count, 0),
    coalesce(r.pending_count, 0)
  from scoped s
  left join recipients r on r.campaign_id = s.id
  left join outcomes o on o.campaign_id = s.id
  left join delivery d on d.campaign_id = s.id;
$$;

-- ------------------------------------------------------- live intent lookup
-- Highest live intent per prospect, for the Prospects table's Intent column.
create or replace function public.prospect_live_intent(
  p_business_id uuid,
  p_prospect_ids uuid[]
)
returns table (
  prospect_id uuid,
  intent_category_id uuid,
  category_name text,
  observed_at timestamptz,
  expires_at timestamptz,
  score_impact numeric,
  match_count integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select distinct on (m.prospect_id)
    m.prospect_id,
    m.intent_category_id,
    c.name,
    e.observed_at,
    m.expires_at,
    m.score_impact,
    (select count(*)::int
       from public.prospect_intent_matches m2
      where m2.prospect_id = m.prospect_id and m2.expires_at > now())
  from public.prospect_intent_matches m
  join public.intent_categories c on c.id = m.intent_category_id
  join public.intent_events e on e.id = m.intent_event_id
  where m.business_id = p_business_id
    and m.prospect_id = any(p_prospect_ids)
    and m.expires_at > now()
  order by m.prospect_id, m.score_impact desc, e.observed_at desc;
$$;

-- --------------------------------------------------- expire stale intent
-- Called by the daily cron. A signal past its freshness window stops
-- contributing to score; the event row is kept as evidence.
create or replace function public.expire_intent_matches()
returns integer
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with deleted as (
    delete from public.prospect_intent_matches
    where expires_at <= now()
    returning 1
  )
  select count(*)::int from deleted;
$$;

-- ------------------------------------------------------- daily cost rollup
-- Recomputes one tenant-day from cost_events, including the acquisition
-- categories V4 adds. Idempotent: re-running for the same day overwrites rather
-- than accumulates, so a retried job is harmless.
--
-- Column names and units are 0018's (`date`, `*_cost` numerics), not new ones:
-- the existing daily rollup handler and admin economics queries already read
-- this table and must keep working.
create or replace function public.rollup_business_cost_daily(
  p_business_id uuid,
  p_date date
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  agg record;
begin
  select
    coalesce(sum(total_cost) filter (where category = 'DISCOVERY'), 0)      as discovery,
    coalesce(sum(total_cost) filter (where category = 'ENRICHMENT'), 0)     as enrichment,
    coalesce(sum(total_cost) filter (where category = 'VERIFICATION'), 0)   as verification,
    coalesce(sum(total_cost) filter (where category = 'AI'), 0)             as ai,
    coalesce(sum(total_cost) filter (where category = 'EMAIL'), 0)          as email,
    coalesce(sum(total_cost) filter (where category = 'SMS'), 0)            as sms,
    coalesce(sum(total_cost) filter (where category = 'WHATSAPP'), 0)       as whatsapp,
    coalesce(sum(total_cost) filter (where category = 'INTENT'), 0)         as intent,
    coalesce(sum(total_cost) filter (where category = 'INFRASTRUCTURE'), 0) as infra,
    coalesce(sum(total_cost) filter (where category = 'STRIPE'), 0)         as stripe,
    coalesce(sum(total_cost) filter (where category in ('CRM','OTHER')
                                       or category is null), 0)            as other,
    coalesce(sum(total_cost), 0)                                           as total
  into agg
  from public.cost_events
  where business_id = p_business_id
    and occurred_at >= p_date::timestamptz
    and occurred_at < (p_date + 1)::timestamptz;

  insert into public.business_cost_daily (
    business_id, date, discovery_cost, enrichment_cost, verification_cost,
    ai_cost, email_cost, sms_cost, whatsapp_cost, intent_cost,
    infrastructure_allocated_cost, stripe_cost, other_cost, total_cost, updated_at
  ) values (
    p_business_id, p_date, agg.discovery, agg.enrichment, agg.verification,
    agg.ai, agg.email, agg.sms, agg.whatsapp, agg.intent,
    agg.infra, agg.stripe, agg.other, agg.total, now()
  )
  on conflict (business_id, date) do update set
    discovery_cost = excluded.discovery_cost,
    enrichment_cost = excluded.enrichment_cost,
    verification_cost = excluded.verification_cost,
    ai_cost = excluded.ai_cost,
    email_cost = excluded.email_cost,
    sms_cost = excluded.sms_cost,
    whatsapp_cost = excluded.whatsapp_cost,
    intent_cost = excluded.intent_cost,
    infrastructure_allocated_cost = excluded.infrastructure_allocated_cost,
    stripe_cost = excluded.stripe_cost,
    other_cost = excluded.other_cost,
    total_cost = excluded.total_cost,
    updated_at = now();
end;
$$;

-- ----------------------------------------------------- monthly margin snapshot
create or replace function public.rollup_business_margin_monthly(
  p_business_id uuid,
  p_month date
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  costs record;
  v_revenue numeric(14,2);
  v_overage numeric(14,2);
  v_plan text;
  v_contribution numeric(14,6);
  v_margin numeric(6,3);
  v_state text;
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  select
    coalesce(sum(total_cost), 0)         as total,
    coalesce(sum(ai_cost), 0)            as ai,
    coalesce(sum(sms_cost), 0)           as sms,
    coalesce(sum(whatsapp_cost), 0)      as whatsapp,
    coalesce(sum(email_cost), 0)         as email,
    coalesce(sum(stripe_cost), 0)        as stripe,
    coalesce(sum(discovery_cost), 0)     as discovery,
    coalesce(sum(enrichment_cost), 0)    as enrichment,
    coalesce(sum(verification_cost), 0)  as verification,
    coalesce(sum(intent_cost), 0)        as intent,
    coalesce(sum(infrastructure_allocated_cost), 0) as infra
  into costs
  from public.business_cost_daily
  where business_id = p_business_id
    and date >= v_start and date < v_end;

  select s.plan, coalesce(s.plan_amount_minor, 0) / 100.0
  into v_plan, v_revenue
  from public.subscriptions s
  where s.business_id = p_business_id;

  v_revenue := coalesce(v_revenue, 0);

  -- Overage revenue is recorded as a usage_event, not a cost, so it is read
  -- from the ledger rather than inferred from spend.
  select coalesce(sum(quantity * coalesce(unit_cost, 0)), 0) into v_overage
  from public.usage_events
  where business_id = p_business_id
    and metadata->>'kind' = 'overage_revenue'
    and occurred_at >= v_start::timestamptz and occurred_at < v_end::timestamptz;

  v_overage := coalesce(v_overage, 0);
  v_contribution := (v_revenue + v_overage) - costs.total;

  -- A tenant with no revenue this month is not a margin failure — it is a
  -- trial or a lapsed subscription, and reporting it as CRITICAL would drown
  -- the genuine alerts.
  if (v_revenue + v_overage) = 0 then
    v_margin := null;
    v_state := 'NO_REVENUE';
  else
    v_margin := round((v_contribution / (v_revenue + v_overage)) * 100, 3);
    v_state := case
      when v_margin >= 75 then 'HEALTHY'
      when v_margin >= 65 then 'WATCH'
      when v_margin >= 55 then 'WARNING'
      else 'CRITICAL'
    end;
  end if;

  insert into public.business_margin_monthly (
    business_id, billing_period, plan_key, subscription_revenue, overage_revenue,
    total_revenue, sms_cost, whatsapp_cost, ai_cost, email_cost, stripe_cost,
    discovery_cost, enrichment_cost, verification_cost, intent_cost,
    allocated_platform_cost, total_cogs, gross_contribution, gross_margin_percent,
    margin_state, updated_at
  ) values (
    p_business_id, v_start, v_plan, v_revenue, v_overage,
    v_revenue + v_overage, costs.sms, costs.whatsapp, costs.ai, costs.email, costs.stripe,
    costs.discovery, costs.enrichment, costs.verification, costs.intent,
    costs.infra, costs.total, v_contribution, v_margin, v_state, now()
  )
  on conflict (business_id, billing_period) do update set
    plan_key = excluded.plan_key,
    subscription_revenue = excluded.subscription_revenue,
    overage_revenue = excluded.overage_revenue,
    total_revenue = excluded.total_revenue,
    sms_cost = excluded.sms_cost,
    whatsapp_cost = excluded.whatsapp_cost,
    ai_cost = excluded.ai_cost,
    email_cost = excluded.email_cost,
    stripe_cost = excluded.stripe_cost,
    discovery_cost = excluded.discovery_cost,
    enrichment_cost = excluded.enrichment_cost,
    verification_cost = excluded.verification_cost,
    intent_cost = excluded.intent_cost,
    allocated_platform_cost = excluded.allocated_platform_cost,
    total_cogs = excluded.total_cogs,
    gross_contribution = excluded.gross_contribution,
    gross_margin_percent = excluded.gross_margin_percent,
    margin_state = excluded.margin_state,
    updated_at = now();
end;
$$;

-- ------------------------------------------------------ suppression lookup
-- The single hot-path check every send makes. Returns the blocking row's reason
-- or null. `security definer` because a worker may be checking a destination
-- that has a platform-wide (business_id null) suppression.
create or replace function public.check_suppression(
  p_business_id uuid,
  p_channel text,
  p_email citext default null,
  p_phone text default null,
  p_social text default null
)
returns table (reason text, scope text, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    s.reason,
    case when s.business_id is null then 'PLATFORM' else 'WORKSPACE' end,
    s.created_at
  from public.suppression_entries s
  where (s.business_id = p_business_id or s.business_id is null)
    and (s.channel = p_channel or s.channel = 'ALL')
    and (s.expires_at is null or s.expires_at > now())
    and (
      (p_email is not null and s.email = p_email)
      or (p_phone is not null and s.phone_e164 = p_phone)
      or (p_social is not null and s.social_identifier = p_social)
    )
  order by (s.business_id is null) desc, s.created_at asc
  limit 1;
$$;

-- ------------------------------------------------- release stale reservations
-- A worker that dies between reserving and committing must not permanently
-- consume a customer's allowance.
create or replace function public.expire_usage_reservations()
returns integer
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with updated as (
    update public.usage_reservations
    set status = 'EXPIRED', settled_at = now()
    where status = 'RESERVED' and expires_at <= now()
    returning 1
  )
  select count(*)::int from updated;
$$;

-- --------------------------------------------------------------------- grants
-- Customer-facing aggregations only. Everything that reads cost stays with the
-- service role.
revoke all on function public.sourcing_run_counters(uuid, uuid) from public, anon;
revoke all on function public.prospect_quick_counts(uuid) from public, anon;
revoke all on function public.outreach_campaign_results(uuid, uuid) from public, anon;
revoke all on function public.prospect_live_intent(uuid, uuid[]) from public, anon;
grant execute on function public.sourcing_run_counters(uuid, uuid) to authenticated;
grant execute on function public.prospect_quick_counts(uuid) to authenticated;
grant execute on function public.outreach_campaign_results(uuid, uuid) to authenticated;
grant execute on function public.prospect_live_intent(uuid, uuid[]) to authenticated;

revoke all on function public.expire_intent_matches() from public, anon, authenticated;
revoke all on function public.rollup_business_cost_daily(uuid, date) from public, anon, authenticated;
revoke all on function public.rollup_business_margin_monthly(uuid, date) from public, anon, authenticated;
revoke all on function public.check_suppression(uuid, text, citext, text, text) from public, anon, authenticated;
revoke all on function public.expire_usage_reservations() from public, anon, authenticated;
