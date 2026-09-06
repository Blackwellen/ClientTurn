-- 0054_outreach_sequences_variants_warmup: the three things a multi-step cold
-- outreach engine needs that the schema could not yet express.
--
-- 0029 modelled experiments and variants, and the dispatcher already schedules
-- `next_step_due_at` from each step's delay. What was missing was the ability
-- to say *which* variant a particular recipient was sent, and to ramp a new
-- sending domain rather than letting it start at its full cap.

-- ------------------------------------------------------- variant attribution
-- Without this the A/B machinery is authored but unmeasurable: variants can be
-- written and allocated, and nothing records which one a person received, so
-- reply and bounce counts can never be attributed back.
alter table public.outreach_recipient_runs
  add column if not exists campaign_variant_id uuid
    references public.campaign_variants(id) on delete set null;

alter table public.messages
  add column if not exists campaign_variant_id uuid
    references public.campaign_variants(id) on delete set null;

create index if not exists messages_variant_idx
  on public.messages (business_id, campaign_variant_id)
  where campaign_variant_id is not null;

-- --------------------------------------------------------------- warm-up
-- A brand-new sending domain that starts at 200 messages a day gets its
-- reputation burned before the first reply arrives. `warmup_started_at` is the
-- clock the ramp is computed from; null means "no ramp", which is correct for
-- an established mailbox that has been sending for years before it reached us.
alter table public.sender_identities
  add column if not exists warmup_started_at timestamptz,
  add column if not exists warmup_days integer not null default 21
    check (warmup_days between 0 and 90);

-- ------------------------------------------------ the daily cap, with a ramp
-- Replaces the flat-cap version from 0049. Same contract — one atomic
-- statement, returns false when there is no room — but the ceiling is now the
-- lower of the configured cap and today's warm-up allowance.
--
-- The ramp is deliberately simple and readable rather than clever: day 1 gets
-- a twentieth of the cap (minimum 5), and it grows linearly to the full cap by
-- `warmup_days`. A sender with no `warmup_started_at` is not ramping and gets
-- its configured cap.
create or replace function public.sender_daily_allowance(
  p_sender public.sender_identities
)
returns integer
language sql
immutable
as $$
  select case
    when p_sender.warmup_started_at is null then p_sender.daily_send_cap
    when p_sender.warmup_days <= 0 then p_sender.daily_send_cap
    else greatest(
      5,
      least(
        p_sender.daily_send_cap,
        ceil(
          p_sender.daily_send_cap
          * least(
              1.0,
              (extract(epoch from (now() - p_sender.warmup_started_at)) / 86400.0 + 1)
              / p_sender.warmup_days
            )
        )::integer
      )
    )
  end;
$$;

comment on function public.sender_daily_allowance(public.sender_identities) is
  'Today''s send ceiling for a sender: its configured cap, or a linear warm-up
   fraction of it while the sender is still ramping.';

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
  update public.sender_identities s
     set sent_today = case
           when s.sent_today_on is distinct from current_date then 1
           else s.sent_today + 1
         end,
         sent_today_on = current_date
   where s.id = p_sender_id
     and s.business_id = p_business_id
     and s.active
     and (s.paused_until is null or s.paused_until <= now())
     and case
           when s.sent_today_on is distinct from current_date then 0
           else s.sent_today
         end < public.sender_daily_allowance(s)
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_sender_send_slot(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.sender_daily_allowance(public.sender_identities)
  from public, anon, authenticated;

comment on function public.claim_sender_send_slot(uuid, uuid) is
  'Atomically reserves one send against a sender identity''s daily allowance,
   rolling the counter over at midnight and respecting the warm-up ramp.
   Returns false when the allowance is reached.';

-- --------------------------------------------------------------- due work
-- The sequence scheduler asks one question across every campaign: which
-- recipients are due a step now? Without this index that is a scan of every
-- recipient row a workspace has ever enrolled.
create index if not exists outreach_recipient_runs_due_now_idx
  on public.outreach_recipient_runs (next_step_due_at)
  where next_step_due_at is not null
    and status in ('PENDING', 'SCHEDULED', 'ACTIVE');

-- ----------------------------------------------------------------- grants
-- New columns on a table whose SELECT grant is an explicit column list must be
-- added to that list, or the browser role gets a permission error rather than
-- a value. `messages` and `outreach_recipient_runs` carry table-level grants,
-- so nothing is needed for them — but assert it rather than assume, the way
-- 0050 and 0051 had to learn.
do $$
declare
  has_table_grant boolean;
begin
  select exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'sender_identities'
       and grantee = 'authenticated'
       and privilege_type = 'SELECT'
  ) into has_table_grant;

  -- A table-wide grant covers columns added above. Only an explicit
  -- column-list grant would need re-resolving.
  if not has_table_grant then
    execute 'grant select (warmup_started_at, warmup_days) on public.sender_identities to authenticated';
  end if;
end $$;
