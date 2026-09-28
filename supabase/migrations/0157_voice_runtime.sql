-- 0157_voice_runtime: the two atomic steps the voice runtime (phase P2) cannot
-- do safely from the application alone, plus a voice-only opt-out.
--
--   voice_minutes_apply    one compare-and-swap on the minute balance, its
--                          append-only ledger row and the per-call reservation,
--                          in one transaction with the balance row locked. The
--                          arithmetic is NOT here: src/lib/voice/budget.ts
--                          (reserve / settle / release, pure and tested)
--                          computes the deltas, and this function only applies
--                          them if the balance is still what the caller read
--                          ('CONFLICT' otherwise, and the caller re-reads).
--                          The ledger's (business_id, idempotency_key) makes a
--                          replay a no-op ('REPLAY'). One algorithm, one place.
--   voice_call_begin_dial  the only way a call moves QUEUED -> DIALLING. Takes
--                          the per-lead advisory lock (eligibility.ts
--                          voiceLeadLockKey / advisoryLockId) and a per-workspace
--                          one, then refuses when another call to the same lead
--                          is live, when a person has taken the lead over, or
--                          when the workspace or platform concurrency is full.
--                          A second dial of the same call finds it no longer
--                          QUEUED ('NOT_QUEUED'): a double dial is impossible.
--   voice_settings         gains transfer_mode (Settings, Voice: "Human
--                          transfer: number, when"). The app tolerates the
--                          column being absent until this is applied.
--   suppression_entries    the channel CHECK gains VOICE, so "don't call me"
--                          stops calls without stopping the texts the person
--                          still wants. Only widened.
--
-- Both functions are service-role only (the voice jobs). Depends on 0150 and
-- 0151 (applied). Additive and idempotent. NOT applied by the author.

-- ============================================================ voice_minutes_apply
create or replace function public.voice_minutes_apply(
  p_business_id uuid,
  p_expected_included integer,
  p_expected_pack integer,
  p_included_delta integer,
  p_pack_delta integer,
  p_ledger jsonb,
  p_reservation jsonb default null,
  p_period jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_included integer;
  v_pack integer;
  v_key text := p_ledger->>'idempotency_key';
  v_status text;
begin
  if v_key is null or char_length(v_key) = 0 then
    raise exception 'voice_minutes_apply needs a ledger idempotency_key' using errcode = 'check_violation';
  end if;

  insert into public.voice_minute_balances (business_id)
  values (p_business_id)
  on conflict (business_id) do nothing;

  select b.included_remaining_sec, b.pack_remaining_sec
    into v_included, v_pack
    from public.voice_minute_balances b
   where b.business_id = p_business_id
   for update;

  if exists (
    select 1 from public.voice_minute_ledger l
     where l.business_id = p_business_id and l.idempotency_key = v_key
  ) then
    return 'REPLAY';
  end if;

  if v_included is distinct from p_expected_included or v_pack is distinct from p_expected_pack then
    return 'CONFLICT';
  end if;

  -- No overage (0141): neither bucket may go below zero.
  if v_included + p_included_delta < 0 or v_pack + p_pack_delta < 0 then
    return 'INSUFFICIENT';
  end if;

  update public.voice_minute_balances
     set included_remaining_sec = v_included + p_included_delta,
         pack_remaining_sec = v_pack + p_pack_delta,
         period_included_sec = coalesce((p_period->>'period_included_sec')::integer, period_included_sec),
         period_start = coalesce((p_period->>'period_start')::timestamptz, period_start),
         period_end = coalesce((p_period->>'period_end')::timestamptz, period_end)
   where business_id = p_business_id;

  insert into public.voice_minute_ledger (
    business_id, kind, voice_call_id, route, included_delta_sec, pack_delta_sec,
    idempotency_key, reason, stripe_ref
  ) values (
    p_business_id,
    p_ledger->>'kind',
    nullif(p_ledger->>'voice_call_id', '')::uuid,
    nullif(p_ledger->>'route', ''),
    p_included_delta,
    p_pack_delta,
    v_key,
    nullif(p_ledger->>'reason', ''),
    nullif(p_ledger->>'stripe_ref', '')
  );

  if p_reservation is not null then
    v_status := coalesce(p_reservation->>'status', 'HELD');
    insert into public.voice_minute_reservations (
      voice_call_id, business_id, route, held_sec, from_included_sec, from_pack_sec,
      status, billed_sec, shortfall_sec, closed_at
    ) values (
      (p_reservation->>'voice_call_id')::uuid,
      p_business_id,
      nullif(p_reservation->>'route', ''),
      (p_reservation->>'held_sec')::integer,
      (p_reservation->>'from_included_sec')::integer,
      (p_reservation->>'from_pack_sec')::integer,
      v_status,
      nullif(p_reservation->>'billed_sec', '')::integer,
      coalesce(nullif(p_reservation->>'shortfall_sec', '')::integer, 0),
      case when v_status = 'HELD' then null else now() end
    )
    on conflict (voice_call_id) do update
       set status = excluded.status,
           billed_sec = excluded.billed_sec,
           shortfall_sec = excluded.shortfall_sec,
           closed_at = excluded.closed_at
     where public.voice_minute_reservations.status = 'HELD';
  end if;

  return 'APPLIED';
end
$$;
revoke all on function public.voice_minutes_apply(uuid, integer, integer, integer, integer, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.voice_minutes_apply(uuid, integer, integer, integer, integer, jsonb, jsonb, jsonb)
  to service_role;

-- ========================================================== voice_call_begin_dial
create or replace function public.voice_call_begin_dial(
  p_call_id uuid,
  p_business_id uuid,
  p_lead_lock_id integer,
  p_workspace_lock_id integer,
  p_workspace_limit integer,
  p_platform_limit integer
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_state text;
  v_takeover boolean;
  v_workspace_active integer;
  v_platform_active integer;
  v_active constant text[] := array['DIALLING', 'RINGING', 'ANSWERED', 'IN_CONVERSATION', 'WRAPPING_UP', 'TRANSFERRED'];
begin
  -- Lead first, then workspace: every caller takes them in this order.
  perform pg_advisory_xact_lock(p_lead_lock_id);
  perform pg_advisory_xact_lock(p_workspace_lock_id);

  select c.lead_id, c.state into v_lead, v_state
    from public.voice_calls c
   where c.id = p_call_id and c.business_id = p_business_id
   for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  if v_state <> 'QUEUED' then
    return 'NOT_QUEUED';
  end if;

  select l.human_takeover into v_takeover from public.leads l where l.id = v_lead;
  if coalesce(v_takeover, false) then
    return 'HUMAN_ACTIVE';
  end if;

  if exists (
    select 1 from public.voice_calls c
     where c.business_id = p_business_id and c.lead_id = v_lead and c.id <> p_call_id
       and c.state = any (v_active)
  ) then
    return 'LEAD_BUSY';
  end if;

  select count(*) into v_platform_active from public.voice_calls c where c.state = any (v_active);
  if v_platform_active >= p_platform_limit then
    return 'PLATFORM_FULL';
  end if;

  select count(*) into v_workspace_active
    from public.voice_calls c
   where c.business_id = p_business_id and c.state = any (v_active);
  if v_workspace_active >= p_workspace_limit then
    return 'WORKSPACE_FULL';
  end if;

  update public.voice_calls
     set state = 'DIALLING',
         started_at = coalesce(started_at, now())
   where id = p_call_id and state = 'QUEUED';
  return 'OK';
end
$$;
revoke all on function public.voice_call_begin_dial(uuid, uuid, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.voice_call_begin_dial(uuid, uuid, integer, integer, integer, integer)
  to service_role;

-- ================================================= suppression_entries: VOICE
-- Current constraint: suppression_entries_channel_check (0030), EMAIL, SMS,
-- WHATSAPP, SOCIAL, ALL. Only widened.
alter table public.suppression_entries drop constraint if exists suppression_entries_channel_check;
alter table public.suppression_entries add constraint suppression_entries_channel_check
  check (channel in ('EMAIL', 'SMS', 'WHATSAPP', 'SOCIAL', 'VOICE', 'ALL'));

-- ======================================================= voice_settings.transfer_mode
alter table public.voice_settings
  add column if not exists transfer_mode text not null default 'ON_REQUEST'
    check (transfer_mode in ('ON_REQUEST', 'ON_REQUEST_OR_ESCALATION', 'NEVER'));
