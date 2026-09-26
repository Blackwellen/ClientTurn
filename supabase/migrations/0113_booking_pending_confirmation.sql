-- 0113_booking_pending_confirmation
--
-- B10 (brief §57, decision Q1): never say a meeting is booked until the
-- provider confirms it.
--
-- 1. `pending` joins bookings.status. A time the lead chose that no connected
--    calendar can confirm (manual mode, or a Google write that failed) is
--    recorded as a request awaiting the business's confirmation. The lead is
--    not BOOKED until a person confirms it (pending -> scheduled).
--
-- 2. One active booking per slot. Two leads must not both be given the same
--    time. `pending` holds its slot as firmly as `scheduled`. Scope:
--      * per business and per assignee -- unassigned bookings (every booking
--        the agent makes) share one diary, while bookings assigned to
--        different team members may legitimately run at the same time;
--      * Calendly rows are excluded -- Calendly owns its own availability
--        (including group event types, where several invitees share a start
--        time) and its webhook must never be rejected here, or a real booking
--        would be lost.
--    Replaces nothing: bookings_business_starts_idx stays for range scans.

alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check
  check (status in ('pending', 'scheduled', 'completed', 'cancelled', 'no_show'));

-- Fail loudly, rather than silently skip the protection, if existing data
-- already double-books a slot. Resolve the listed rows by hand and re-run.
do $$
declare
  clashes integer;
begin
  select count(*) into clashes
  from (
    select 1
    from public.bookings
    where status in ('scheduled', 'pending')
      and provider <> 'calendly'
      and starts_at is not null
    group by business_id,
             coalesce(assigned_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
             starts_at
    having count(*) > 1
  ) duplicated;

  if clashes > 0 then
    raise exception
      '0113: % slot(s) already hold more than one active booking; cancel the duplicates before applying this migration.',
      clashes;
  end if;
end $$;

create unique index if not exists bookings_one_active_per_slot_idx
  on public.bookings (
    business_id,
    coalesce(assigned_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    starts_at
  )
  where status in ('scheduled', 'pending')
    and provider <> 'calendly'
    and starts_at is not null;
