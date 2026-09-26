-- 0111_lift_opt_out_for_channel: START re-permits one channel, nothing more.
--
-- `lift_suppression_for_destination` (0069) was called for every "start"
-- reply, on any channel, and deleted OPT_OUT, MANUAL, INVALID and BOUNCE rows
-- on the given channel *and* on ALL. So a recipient typing "Start" in an email
-- undid a workspace's manual suppression, a hard bounce and an opt-out from
-- every channel at once.
--
-- START is an SMS/WhatsApp carrier keyword. What it can honestly mean is "you
-- may text me again on this channel", so this function does exactly that:
--
--   * only SMS or WHATSAPP;
--   * only reason OPT_OUT — MANUAL is the workspace's decision, INVALID and
--     BOUNCE are facts about the address, COMPLAINT and LEGAL are never the
--     recipient's keyword to reverse;
--   * only this workspace's rows — never a platform-wide entry;
--   * an ALL-channel OPT_OUT is not deleted but *split*: it is replaced by
--     channel-specific OPT_OUT rows for every other channel, so the person is
--     re-permitted on the channel they texted START on and remains opted out
--     everywhere else.
--
-- It also reports how many recipient opt-outs remain for the destination, so
-- the caller only clears `leads.opted_out` when nothing is left.
--
-- 0069's function is left in place (no callers after this change) rather than
-- dropped, so a rollback of the application code does not need a migration.

create or replace function public.lift_opt_out_for_channel(
  p_business_id uuid,
  p_channel text,
  p_phone text,
  p_email citext default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lifted integer := 0;
  split integer := 0;
  remaining integer := 0;
begin
  if p_business_id is null or p_phone is null or p_channel not in ('SMS', 'WHATSAPP') then
    return jsonb_build_object('lifted', 0, 'split', 0, 'remaining', null);
  end if;

  -- 1. The channel's own opt-out.
  delete from public.suppression_entries s
   where s.business_id = p_business_id
     and s.phone_e164 = p_phone
     and s.channel = p_channel
     and s.reason = 'OPT_OUT';
  get diagnostics lifted = row_count;

  -- 2. An everything-opt-out becomes an opt-out from everything else.
  --    `on conflict do nothing`: a channel that already carries its own row
  --    (a bounce, a manual block) keeps it and stays suppressed either way.
  insert into public.suppression_entries (
    business_id, email, phone_e164, social_identifier, channel, reason,
    source, source_reference, note, created_by, created_at, expires_at
  )
  select
    s.business_id, s.email, s.phone_e164, s.social_identifier, c.channel, 'OPT_OUT',
    s.source, s.source_reference,
    coalesce(s.note || ' ', '') || 'Split from an ALL-channel opt-out when the '
      || 'recipient re-permitted ' || p_channel || ' by keyword.',
    s.created_by, s.created_at, s.expires_at
  from public.suppression_entries s
  cross join (values ('EMAIL'), ('SMS'), ('WHATSAPP'), ('SOCIAL')) as c(channel)
  where s.business_id = p_business_id
    and s.phone_e164 = p_phone
    and s.channel = 'ALL'
    and s.reason = 'OPT_OUT'
    and c.channel <> p_channel
  on conflict do nothing;

  delete from public.suppression_entries s
   where s.business_id = p_business_id
     and s.phone_e164 = p_phone
     and s.channel = 'ALL'
     and s.reason = 'OPT_OUT';
  get diagnostics split = row_count;

  -- 3. What the recipient has still opted out of, on any channel, for either
  --    destination the lead holds. Platform rows count: they still block.
  select count(*)::int into remaining
    from public.suppression_entries s
   where (s.business_id = p_business_id or s.business_id is null)
     and s.reason in ('OPT_OUT', 'COMPLAINT', 'LEGAL')
     and (s.expires_at is null or s.expires_at > now())
     and (
       s.phone_e164 = p_phone
       or (p_email is not null and s.email = p_email)
     );

  return jsonb_build_object('lifted', lifted, 'split', split, 'remaining', remaining);
end
$$;

revoke all on function public.lift_opt_out_for_channel(uuid, text, text, citext)
  from public, anon, authenticated;
grant execute on function public.lift_opt_out_for_channel(uuid, text, text, citext)
  to service_role;
