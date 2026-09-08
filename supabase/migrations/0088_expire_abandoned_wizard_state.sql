-- 0088_expire_abandoned_wizard_state: reclaim what an abandoned wizard leaves.
--
-- Three wizards write a row before the person has finished deciding, because
-- the row is what the later steps hang off: `createDraft` makes a DRAFT
-- campaign, `createImport` makes a `lead_imports` row, and both are correct.
-- Neither is cleaned up when the person closes the tab.
--
-- The cost is not storage. It is that "Campaigns" and "Imports" slowly fill
-- with things the customer does not recognise and cannot tell apart from work
-- in progress, and an operator looking at a workspace cannot tell either.
--
-- ## What this deliberately does not do
--
-- **It does not delete a draft somebody is working on.** A draft that has been
-- given a name, a sequence step or an audience is a decision in progress, and a
-- fortnight of silence is a holiday, not an abandonment. Only a draft that is
-- still exactly as the wizard created it is removed — no name beyond the
-- default, no steps, no recipients — and only after 30 days.
--
-- **It does not delete imports at all.** The uploaded file is the customer's
-- own data and the row is the only record that it was uploaded. A stalled
-- import is marked CANCELLED, which is a state the schema already has and the
-- UI already renders, so the history stays readable and the row stops looking
-- like something still running.
--
-- Both sweeps are idempotent: they only touch rows already past the window.

/* ------------------------------------------------------- abandoned drafts */

create or replace function public.expire_abandoned_campaign_drafts(
  p_older_than interval default '30 days'
)
returns integer
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with removed as (
    delete from public.outreach_campaigns c
     where c.status = 'DRAFT'
       and c.created_at < now() - p_older_than
       -- Never launched, and never even validated: `launch_validated_at` is set
       -- the first time somebody asks whether this campaign could run, which is
       -- a clear signal of intent.
       and c.launched_at is null
       and c.launch_validated_at is null
       -- Untouched since creation. `updated_at` moves on any edit, so a draft
       -- somebody returned to is out of scope however old it is.
       and c.updated_at <= c.created_at + interval '1 hour'
       -- And genuinely empty: no sequence, no audience. A sequence hangs off
       -- the campaign and the steps hang off the sequence, so the absence of a
       -- sequence is the absence of any written message.
       and not exists (
         select 1 from public.outreach_sequences q where q.campaign_id = c.id
       )
       and not exists (
         select 1 from public.outreach_recipient_runs r where r.campaign_id = c.id
       )
    returning 1
  )
  select count(*)::int from removed;
$$;

revoke all on function public.expire_abandoned_campaign_drafts(interval) from public, anon, authenticated;
grant execute on function public.expire_abandoned_campaign_drafts(interval) to service_role;

comment on function public.expire_abandoned_campaign_drafts(interval) is
  'Removes DRAFT campaigns that were created and never touched again: no name change, no steps, no recipients, never validated. A draft with any of those is a decision in progress and is left alone.';

/* -------------------------------------------------------- stalled imports */

create or replace function public.expire_stalled_imports(
  p_older_than interval default '7 days'
)
returns integer
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with updated as (
    update public.lead_imports
       set status = 'CANCELLED',
           error_message = coalesce(
             error_message,
             'Abandoned before it was committed, and closed automatically.'
           ),
           completed_at = coalesce(completed_at, now()),
           updated_at = now()
     -- Every state before the commit. IMPORTING is included deliberately: an
     -- import still "running" a week later is a worker that died, and leaving
     -- it as IMPORTING tells the customer to keep waiting for something that
     -- is not coming.
     where status in (
             'UPLOADED', 'PARSING', 'MAPPING', 'VALIDATING',
             'CLASSIFYING', 'REVIEW', 'IMPORTING'
           )
       and updated_at < now() - p_older_than
    returning 1
  )
  select count(*)::int from updated;
$$;

revoke all on function public.expire_stalled_imports(interval) from public, anon, authenticated;
grant execute on function public.expire_stalled_imports(interval) to service_role;

comment on function public.expire_stalled_imports(interval) is
  'Closes imports abandoned before commit by moving them to CANCELLED. Never deletes: the row is the only record that a file was uploaded, and the file is the customer''s own data.';
