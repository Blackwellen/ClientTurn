-- 0158_insight_and_ops: the P5 insight and ops layer (brief §40-43, §58-59, §61, §70).
--
-- NOT APPLIED by the change that added it. Apply with the deploy that ships
-- the code. Until it is applied the app degrades, it never fabricates:
--   * experiments: promote / rollback report "not available on this database
--     yet" (schema lag); results and the existing start/stop are unchanged,
--     and the send paths serve the deterministic arm exactly as today;
--   * admin voice controls: "pause outbound", "suspend number" and "spending
--     limit" report that the columns are pending; the platform kill switch
--     (voice.admin_disable_workspace, 0150 columns) already works.
-- Attribution, quote/voice analytics, the ROI card and voice GM need NO schema
-- change: they read 0123, 0143, 0144, 0150, 0151, 0153 and 0154 as they are.
-- The voice margin alert reuses economics_alerts MARGIN_BELOW_THRESHOLD with a
-- `YYYY-MM:voice` period key (the 0145 once-per-month index covers it).
--
-- Depends on 0131 (experiments), 0150 (voice_settings, business_numbers) and
-- 0153 (forbid_update_delete). Additive and idempotent.

-- ================================================ 1. experiments: promotion
alter table public.experiments
  add column if not exists promoted_arm text
    check (promoted_arm is null or promoted_arm ~ '^[A-Z0-9_]{1,16}$'),
  add column if not exists promoted_at timestamptz,
  -- Bumped on every promote and rollback; the history rows carry it.
  add column if not exists version integer not null default 1 check (version >= 1),
  -- Default SUGGEST: a winner is only rolled out automatically when an
  -- owner/admin opted this experiment in, and never for opener, disclosure
  -- or pricing changes (src/lib/learning/promotion.ts).
  add column if not exists auto_promote boolean not null default false,
  add column if not exists significance_alpha numeric(4, 3) not null default 0.050
    check (significance_alpha > 0 and significance_alpha <= 0.100);

-- The control ("A") is never promoted over itself: promotion means a variant.
alter table public.experiments drop constraint if exists experiments_promoted_not_control;
alter table public.experiments add constraint experiments_promoted_not_control
  check (promoted_arm is null or promoted_arm <> 'A');
-- A promoted experiment has a promotion time.
alter table public.experiments drop constraint if exists experiments_promoted_has_time;
alter table public.experiments add constraint experiments_promoted_has_time
  check ((promoted_arm is null) = (promoted_at is null));

-- ============================================ 2. experiment_promotions (history)
-- Append-only: every promote and rollback, with the evidence at the time.
create table if not exists public.experiment_promotions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  action text not null check (action in ('PROMOTE', 'ROLLBACK')),
  -- The arm serving everyone after this row ('A' after a rollback).
  arm text not null check (arm ~ '^[A-Z0-9_]{1,16}$'),
  from_arm text check (from_arm is null or from_arm ~ '^[A-Z0-9_]{1,16}$'),
  version integer not null check (version >= 1),
  sample_by_arm jsonb not null default '{}'::jsonb check (jsonb_typeof(sample_by_arm) = 'object'),
  conversion_by_arm jsonb not null default '{}'::jsonb check (jsonb_typeof(conversion_by_arm) = 'object'),
  p_value numeric(8, 6) check (p_value is null or (p_value >= 0 and p_value <= 1)),
  sensitive_fields text[] not null default '{}',
  decided_by_kind text not null check (decided_by_kind in ('HUMAN', 'AUTO')),
  decided_by uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  -- A promotion decided automatically never touches a sensitive field.
  constraint experiment_promotions_auto_not_sensitive
    check (decided_by_kind = 'HUMAN' or cardinality(sensitive_fields) = 0),
  unique (experiment_id, version)
);
create index if not exists experiment_promotions_experiment_idx
  on public.experiment_promotions (experiment_id, created_at desc);
create index if not exists experiment_promotions_business_idx
  on public.experiment_promotions (business_id, created_at desc);

drop trigger if exists experiment_promotions_append_only on public.experiment_promotions;
create trigger experiment_promotions_append_only
  before update or delete on public.experiment_promotions
  for each row when (pg_trigger_depth() = 0)
  execute function public.forbid_update_delete();

alter table public.experiment_promotions enable row level security;
alter table public.experiment_promotions force row level security;
revoke all on public.experiment_promotions from anon, authenticated;
grant select on public.experiment_promotions to authenticated;
drop policy if exists experiment_promotions_select_member on public.experiment_promotions;
create policy experiment_promotions_select_member on public.experiment_promotions
  for select to authenticated using (public.is_business_member(business_id));
-- Writes: experiment.promote / experiment.rollback, service role only.

-- ======================================== 3. voice_settings: admin controls
-- Platform-operator switches, beside 0150's admin_kill_switch. Written only
-- by admin_voice.* operations (service role, platform admin + step-up).
-- The voice runtime must read them before dialling
-- (src/lib/services/operations/admin-voice.ts adminVoiceBlocks()).
alter table public.voice_settings
  add column if not exists admin_outbound_paused boolean not null default false,
  add column if not exists admin_outbound_paused_reason text
    check (admin_outbound_paused_reason is null or char_length(admin_outbound_paused_reason) <= 500),
  -- A ceiling on provider spend this calendar month, GBP. Null = no ceiling.
  add column if not exists admin_spend_limit_gbp_month numeric(10, 2)
    check (admin_spend_limit_gbp_month is null or admin_spend_limit_gbp_month >= 0),
  add column if not exists admin_controls_updated_at timestamptz;

-- ======================================= 4. business_numbers: admin suspend
alter table public.business_numbers
  add column if not exists admin_suspended_at timestamptz,
  add column if not exists admin_suspended_reason text
    check (admin_suspended_reason is null or char_length(admin_suspended_reason) <= 500);
alter table public.business_numbers drop constraint if exists business_numbers_admin_suspend_reason;
alter table public.business_numbers add constraint business_numbers_admin_suspend_reason
  check (admin_suspended_at is null or admin_suspended_reason is not null);
