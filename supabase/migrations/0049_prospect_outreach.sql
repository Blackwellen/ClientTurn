-- 0049_prospect_outreach: what cold outreach to a prospect needs that the
-- schema did not yet carry.
--
-- Auto-contact could reach the point of "this prospect is approved and in a
-- campaign" and then had nowhere to go: prospects had no unsubscribe token, so
-- there was no lawful way to send them a marketing email. A one-click
-- unsubscribe is not a nicety for cold B2B email — it is the thing that makes
-- the send defensible, and it has to resolve to a real suppression.

-- --------------------------------------------------------------- prospects
-- A random per-prospect secret rather than a signed id, matching what 0039 did
-- for leads: a leaked link can be revoked for one prospect without rotating an
-- application key.
alter table public.prospects
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists prospects_unsubscribe_token_idx
  on public.prospects (unsubscribe_token);

-- ---------------------------------------------------- outreach dispatch use
-- The dispatcher repeatedly asks "which prospects in this campaign have not
-- been contacted yet". Without this it is a sequential scan per batch.
create index if not exists prospects_campaign_ready_idx
  on public.prospects (business_id, campaign_id, status)
  where campaign_id is not null;

-- Recipient runs are looked up by campaign to find who is already enrolled,
-- and by due time to advance a sequence.
create index if not exists outreach_recipient_runs_campaign_idx
  on public.outreach_recipient_runs (business_id, campaign_id, status);

create index if not exists outreach_recipient_runs_due_idx
  on public.outreach_recipient_runs (business_id, next_step_due_at)
  where status in ('ACTIVE', 'SCHEDULED');

-- ------------------------------------------------------- sender day rollover
-- `sent_today` is only meaningful alongside the day it counts. Resetting it is
-- otherwise a race between every worker that sends.
create or replace function public.claim_sender_send_slot(
  p_business_id uuid,
  p_sender_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed boolean;
begin
  -- One statement, so two workers cannot both read the same count and both
  -- decide there is room for the last send of the day.
  update public.sender_identities
     set sent_today = case
           when sent_today_on is distinct from current_date then 1
           else sent_today + 1
         end,
         sent_today_on = current_date
   where id = p_sender_id
     and business_id = p_business_id
     and active
     and (paused_until is null or paused_until <= now())
     and case
           when sent_today_on is distinct from current_date then 0
           else sent_today
         end < daily_send_cap
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_sender_send_slot(uuid, uuid)
  from public, anon, authenticated;

comment on function public.claim_sender_send_slot(uuid, uuid) is
  'Atomically reserves one send against a sender identity daily cap, rolling
   the counter over at midnight. Returns false when the cap is reached.';
