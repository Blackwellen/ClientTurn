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
