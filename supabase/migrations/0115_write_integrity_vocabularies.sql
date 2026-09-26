-- 0115_write_integrity_vocabularies: stop the database rejecting values the
-- application writes (B14, B15). Both failures were silent: the Supabase client
-- returns a CHECK violation as { error } and the callers never read it.

-- ------------------------------------------------ messages.reply_classification
-- One canonical vocabulary (map D6): the 0029 list, which analytics read, plus
-- the two agent buckets that have no honest equivalent in it. BOOKING_INTENT is
-- stronger than POSITIVE_INTEREST; NOT_INTERESTED is a refusal, and filing it as
-- NOT_NOW would invite a follow-up the person declined. The agent's other
-- buckets are mapped on write (src/lib/agent/types.ts toMessageReplyClassification).
alter table public.messages
  drop constraint if exists messages_reply_classification_check;
alter table public.messages
  add constraint messages_reply_classification_check
  check (reply_classification is null or reply_classification in (
    'POSITIVE_INTEREST','NEUTRAL_QUESTION','BOOKING_INTENT','OBJECTION','NOT_NOW',
    'NOT_INTERESTED','WRONG_PERSON','REFERRAL_TO_OTHER_PERSON','UNSUBSCRIBE',
    'COMPLAINT','BOUNCE','AUTO_RESPONSE','HUMAN_REQUEST','UNKNOWN'));

-- ------------------------------------------------- automation_events.event_type
-- The full TS catalog (src/lib/automation/event-types.ts). 0021 lacked
-- automation.step_blocked, so every blocked-step event was dropped.
alter table public.automation_events
  drop constraint if exists automation_events_event_type_check;
alter table public.automation_events
  add constraint automation_events_event_type_check
  check (event_type in (
    'lead.created',
    'lead.updated',
    'lead.replied',
    'lead.opted_out',
    'lead.human_takeover',
    'message.queued',
    'message.sent',
    'message.delivered',
    'message.failed',
    'message.received',
    'automation.started',
    'automation.step_due',
    'automation.step_completed',
    'automation.step_blocked',
    'automation.stopped',
    'automation.failed',
    'qualification.answer_received',
    'qualification.updated',
    'qualification.qualified',
    'qualification.review',
    'qualification.not_qualified',
    'booking.link_sent',
    'booking.created',
    'booking.cancelled',
    'booking.completed',
    'campaign.created',
    'campaign.scheduled',
    'campaign.started',
    'campaign.contact_due',
    'campaign.completed'
  ));

-- --------------------------------------------------- positive reply definition
-- Identical to 0037 except BOOKING_INTENT now counts as a positive reply,
-- matching POSITIVE_MESSAGE_REPLY_CLASSIFICATIONS. Same signature, so existing
-- grants are kept.
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
                         and m.reply_classification in ('POSITIVE_INTEREST','NEUTRAL_QUESTION','BOOKING_INTENT'))::int
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
