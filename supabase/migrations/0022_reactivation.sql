-- 0022_reactivation: fields the Reactivation workspace (/app/reactivation)
-- needs on top of the existing campaign model.
--
-- No new campaign/recipient tables are introduced: `campaigns` and
-- `campaign_contacts` (0007) already carry the campaign, its audience
-- membership and per-contact send/delivery/reply state, and `messages`
-- (0004) already carries the per-message provider events. Reactivation
-- results stay derived from those rows rather than being materialised into a
-- separate results table, matching how every other register in this codebase
-- aggregates.

alter table public.campaigns
  -- Card/list/drawer copy. `audience_label` is the human name for the
  -- audience (`filter_config` stays the machine-readable definition).
  add column if not exists description text,
  add column if not exists audience_label text,
  add column if not exists tags text[] not null default '{}'::text[],
  -- Send window, stored separately from workspace quiet hours: a campaign may
  -- be narrower than the workspace allows, never wider (enforced in code).
  add column if not exists send_window_start time not null default '08:00',
  add column if not exists send_window_end time not null default '20:00',
  add column if not exists timezone text,
  -- Snapshot of the audience size at build time, for cards/lists that must not
  -- re-resolve the audience on every render.
  add column if not exists estimated_audience_size integer not null default 0,
  add column if not exists started_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

-- Backfill so existing rows render with the same fidelity as new ones.
update public.campaigns
   set started_at = coalesce(started_at, launched_at),
       created_by = coalesce(created_by, launched_by),
       updated_by = coalesce(updated_by, launched_by),
       cancelled_at = case
         when status = 'CANCELLED' then coalesce(cancelled_at, completed_at)
         else cancelled_at
       end,
       estimated_audience_size = case
         when estimated_audience_size = 0 then coalesce(
           (select count(*)::int
              from public.campaign_contacts cc
             where cc.campaign_id = campaigns.id),
           0)
         else estimated_audience_size
       end;

-- `completed_at` was previously overloaded to mark cancellation too. Split
-- them so COMPLETED and CANCELLED can be told apart in results and activity.
update public.campaigns
   set completed_at = null
 where status = 'CANCELLED';

create index if not exists campaigns_business_status_idx
  on public.campaigns (business_id, status);

create index if not exists campaigns_business_updated_idx
  on public.campaigns (business_id, updated_at desc);

create index if not exists campaigns_business_scheduled_idx
  on public.campaigns (business_id, scheduled_at)
  where scheduled_at is not null;

-- Audience/eligibility scans read leads by business and booking recency.
create index if not exists leads_business_booked_idx
  on public.leads (business_id, booked_at);

create index if not exists leads_business_qualified_idx
  on public.leads (business_id, qualified_at);

-- ------------------------------------------------- campaign result rollup
-- Reactivation results are aggregated in Postgres, not by pulling every
-- campaign_contact row into the app. A single campaign can hold thousands of
-- contacts, so a client-side scan would silently truncate and under-report.
--
-- `security invoker` keeps RLS in force: the caller only ever sees campaigns
-- and contacts their membership already grants, and the explicit business_id
-- argument is an additional filter, never the only guard.
create or replace function public.reactivation_campaign_results(
  p_business_id uuid,
  p_campaign_id uuid default null
)
returns table (
  campaign_id uuid,
  audience_count integer,
  sent_count integer,
  delivered_count integer,
  reply_count integer,
  qualified_count integer,
  booked_count integer,
  failed_count integer,
  stopped_count integer,
  pending_count integer,
  processed_count integer,
  revenue_amount numeric,
  -- Rolling 30-day windows, for the KPI strip's period-over-period trend.
  recent_reply_count integer,
  previous_reply_count integer,
  recent_qualified_count integer,
  previous_qualified_count integer,
  recent_booked_count integer,
  previous_booked_count integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with scoped as (
    select
      c.id,
      -- A campaign only takes credit for a qualification or booking that
      -- happened after it started contacting the lead.
      coalesce(c.started_at, c.launched_at, c.created_at) as floor_at
    from public.campaigns c
    where c.business_id = p_business_id
      and (p_campaign_id is null or c.id = p_campaign_id)
  )
  select
    s.id,
    count(cc.id)::int,
    count(cc.sent_at)::int,
    count(cc.delivered_at)::int,
    count(cc.replied_at)::int,
    count(*) filter (where l.qualified_at >= s.floor_at)::int,
    count(*) filter (where l.booked_at >= s.floor_at)::int,
    count(*) filter (where cc.state = 'failed')::int,
    count(*) filter (where cc.state in ('stopped', 'suppressed'))::int,
    count(*) filter (where cc.state in ('pending', 'scheduled'))::int,
    count(*) filter (where cc.id is not null
                       and cc.state not in ('pending', 'scheduled'))::int,
    coalesce(sum(sv.average_value)
             filter (where l.booked_at >= s.floor_at), 0)::numeric,
    count(*) filter (where cc.replied_at >= now() - interval '30 days')::int,
    count(*) filter (where cc.replied_at >= now() - interval '60 days'
                       and cc.replied_at < now() - interval '30 days')::int,
    count(*) filter (where l.qualified_at >= s.floor_at
                       and l.qualified_at >= now() - interval '30 days')::int,
    count(*) filter (where l.qualified_at >= s.floor_at
                       and l.qualified_at >= now() - interval '60 days'
                       and l.qualified_at < now() - interval '30 days')::int,
    count(*) filter (where l.booked_at >= s.floor_at
                       and l.booked_at >= now() - interval '30 days')::int,
    count(*) filter (where l.booked_at >= s.floor_at
                       and l.booked_at >= now() - interval '60 days'
                       and l.booked_at < now() - interval '30 days')::int
  from scoped s
  left join public.campaign_contacts cc
    on cc.campaign_id = s.id
   and cc.business_id = p_business_id
  left join public.leads l on l.id = cc.lead_id
  left join public.services sv on sv.id = l.service_id
  group by s.id;
$$;

revoke all on function public.reactivation_campaign_results(uuid, uuid)
  from public, anon;
grant execute on function public.reactivation_campaign_results(uuid, uuid)
  to authenticated, service_role;

-- Supports the join above and the per-campaign audience preview.
create index if not exists campaign_contacts_campaign_lead_idx
  on public.campaign_contacts (campaign_id, lead_id);
