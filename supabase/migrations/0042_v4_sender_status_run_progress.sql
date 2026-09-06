-- 0042_v4_sender_status_run_progress: three columns the V4 schema should have
-- had from the start.
--
-- 0029 gave `sender_identities` capability flags (`active`, `cold_enabled`,
-- `warm_enabled`) but no lifecycle state, which conflated two different
-- questions: "is this sender switched on?" and "has this sender been proved to
-- work?". A sender that has been created but whose SPF/DKIM has never passed is
-- not the same as one the customer deliberately disabled, and outreach launch
-- validation (§17.7) has to be able to tell them apart.
--
-- `sourcing_runs` likewise recorded why a run FAILED but not why it PAUSED, and
-- recomputed progress on every read. Both are cheap to store and awkward to
-- derive.

-- --------------------------------------------------------- sender lifecycle
alter table public.sender_identities
  add column if not exists status text not null default 'UNVERIFIED',
  add column if not exists verified_at timestamptz,
  add column if not exists last_test_at timestamptz,
  add column if not exists last_test_error text;

alter table public.sender_identities drop constraint if exists sender_identities_status_check;
alter table public.sender_identities add constraint sender_identities_status_check
  check (status in ('UNVERIFIED','VERIFYING','VERIFIED','ACTION_REQUIRED','PAUSED','DISABLED'));

-- Existing rows were created by a path that only sets `active`, so they inherit
-- a state consistent with that flag rather than being stranded as UNVERIFIED.
update public.sender_identities
   set status = case when active then 'VERIFIED' else 'DISABLED' end,
       verified_at = case when active then coalesce(verified_at, created_at) else verified_at end
 where status = 'UNVERIFIED';

create index if not exists sender_identities_status_idx
  on public.sender_identities (business_id, status)
  where status = 'VERIFIED';

-- ------------------------------------------------------------ run progress
alter table public.sourcing_runs
  add column if not exists progress_percent integer not null default 0,
  add column if not exists paused_reason text;

alter table public.sourcing_runs drop constraint if exists sourcing_runs_progress_check;
alter table public.sourcing_runs add constraint sourcing_runs_progress_check
  check (progress_percent >= 0 and progress_percent <= 100);

-- `progress_percent` is a customer-facing number derived from the target, not
-- from spend, so it stays readable by the browser role while the cost columns
-- next to it remain revoked (0041).
comment on column public.sourcing_runs.progress_percent is
  'Share of the run''s verified-prospect target reached, 0-100. Derived from counts, never from cost.';
comment on column public.sourcing_runs.paused_reason is
  'Why a run is PAUSED, as opposed to error_message which explains a FAILED run.';

-- 0041 replaced the table-level grant on sourcing_runs and sender_identities
-- with a column list, so columns added afterwards are not granted. Re-run the
-- same derivation to pick these up.
do $$
declare
  spec record;
  allowed text;
begin
  for spec in
    select * from (values
      ('sourcing_runs', array['max_total_cost_minor','max_provider_cost_minor','spent_cost_minor'])
    ) as t(table_name, hidden_columns)
  loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
      into allowed
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name = spec.table_name
       and not (c.column_name = any(spec.hidden_columns));

    execute format('revoke select on public.%I from authenticated', spec.table_name);
    execute format('grant select (%s) on public.%I to authenticated', allowed, spec.table_name);
  end loop;
end $$;
