-- 0069_unify_suppression: one suppression list.
--
-- ClientTurn kept two, and they never saw each other:
--
--   * `contact_suppressions` (0003) — written by SMS STOP handling, the agent's
--     apply_suppression tool, manual opt-out and email bounces; read by the
--     warm send guard, the reactivation audience resolver and the manual send
--     action.
--   * `suppression_entries` (0030) — written by the cold reply classifier,
--     prospect actions and admin compliance; read by `check_suppression()`,
--     which the cold dispatcher, the sourcing run and CSV import all use.
--
-- So a lead who texted STOP could still be emailed by an acquisition campaign,
-- and a prospect who replied "unsubscribe" to a cold email could still be sent
-- warm follow-up SMS. `suppressProspect()` even sets channel ALL, with a
-- comment saying an opt-out means every channel — an intent the split silently
-- defeated. For a UK product under PECR and UK GDPR that is the most
-- consequential defect the system-mesh audit found.
--
-- `suppression_entries` wins. It is strictly richer: nullable `business_id` for
-- platform-wide suppression, `expires_at` for a provider's temporary block,
-- separate destination columns rather than one opaque `normalized_contact`,
-- and `source`/`source_reference`/`note` for evidence.
--
-- This migration moves the data. The readers and writers are repointed in the
-- same change, and `contact_suppressions` is left in place — populated but no
-- longer consulted — so a mistake here is recoverable by repointing the code
-- back rather than by restoring a table.

-- ------------------------------------------------------------------ backfill
--
-- `normalized_contact` is one column holding either an address or an E.164
-- number, so the shape decides the destination column: anything with an "@" is
-- an email, everything else is a phone. That is the same rule the application
-- used when it wrote the row.
--
-- `on conflict do nothing` against the partial unique indexes: an address
-- already suppressed on the V4 side keeps its richer entry rather than being
-- overwritten by the thinner V3 one.
insert into public.suppression_entries (
  business_id, email, phone_e164, channel, reason, source, source_reference, note, created_at
)
select
  cs.business_id,
  case when cs.normalized_contact like '%@%' then lower(cs.normalized_contact)::citext end,
  case when cs.normalized_contact not like '%@%' then cs.normalized_contact end,
  case cs.channel
    when 'all' then 'ALL'
    when 'sms' then 'SMS'
    when 'whatsapp' then 'WHATSAPP'
    when 'email' then 'EMAIL'
    else 'ALL'
  end,
  case cs.reason
    when 'opt_out' then 'OPT_OUT'
    when 'complaint' then 'COMPLAINT'
    when 'invalid' then 'INVALID'
    when 'bounce' then 'BOUNCE'
    when 'manual' then 'MANUAL'
    else 'MANUAL'
  end,
  -- The provenance that matters is that this came from the V3 list, so an
  -- entry can be traced back if the backfill is ever questioned.
  'MIGRATED_V3',
  cs.id::text,
  coalesce('Migrated from contact_suppressions. Original source: ' || cs.source,
           'Migrated from contact_suppressions.'),
  cs.created_at
from public.contact_suppressions cs
on conflict do nothing;

-- ---------------------------------------------------------------- deprecation
comment on table public.contact_suppressions is
  'DEPRECATED as of 0069. Superseded by suppression_entries, which is the only '
  'list any send path consults. Rows were backfilled with source=MIGRATED_V3. '
  'Kept for one release so the repointing can be reverted without restoring '
  'data; drop once 0069 has been in production for a full billing period.';

-- --------------------------------------------------------------- destinations
-- The warm path suppresses and lifts by destination rather than by row id — an
-- SMS STOP arrives as a phone number, not as a primary key. `check_suppression`
-- already answers the read side; this is the write side of the same shape.
--
-- Deliberately narrow. It lifts OPT_OUT, which `unsuppress()` refuses, because
-- the two are different acts: a workspace may not overturn someone's opt-out,
-- but the person themselves texting START is exactly that person changing their
-- own mind, and refusing it would leave them unable to resume.
create or replace function public.lift_suppression_for_destination(
  p_business_id uuid,
  p_channel text,
  p_email citext default null,
  p_phone text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  if p_email is null and p_phone is null then
    return 0;
  end if;

  delete from public.suppression_entries s
   where s.business_id = p_business_id
     -- Never a platform-wide entry: those are not one workspace's to lift.
     and s.business_id is not null
     and (s.channel = p_channel or s.channel = 'ALL')
     and s.reason in ('OPT_OUT', 'MANUAL', 'INVALID', 'BOUNCE')
     and (
       (p_email is not null and s.email = p_email)
       or (p_phone is not null and s.phone_e164 = p_phone)
     );

  get diagnostics removed = row_count;
  return removed;
end
$$;

revoke all on function public.lift_suppression_for_destination(uuid, text, citext, text)
  from public, anon, authenticated;
grant execute on function public.lift_suppression_for_destination(uuid, text, citext, text)
  to service_role;
