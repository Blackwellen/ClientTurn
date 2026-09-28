-- 0170: day-90 deletion of cancelled workspaces (docs/BILLING.md §3 gap).
-- Not applied by the agent that wrote it; apply with scripts/apply-migration.mjs
-- after 0169. The application tolerates it being absent: the daily job logs
-- "schema missing" and does nothing (it never deletes without this schedule).
--
-- The policy (billing/cancellation.ts): a workspace whose subscription ended
-- is read-only for 90 days, then its data is deleted, as the privacy policy
-- promises ("90 days after account closure"). Kept: minimised suppression
-- rows, billing and tax records (6 years), and the pseudonymous records
-- `data_rights_delete` retains (audit_log, usage/cost events, ...).
--
-- 1. workspace_deletion_schedule  [SERVER-ONLY] one row per ended workspace:
--    the end date, the day-60 and day-83 notices (idempotent), an admin HOLD
--    for disputes and legal holds, progress, and the final deleted_at.
-- 2. r2_object_tombstones         [SERVER-ONLY] R2 objects (or tenant
--    prefixes: logo/, import/, support/, quotes/) to delete. No FK to the
--    workspace on purpose, like 0150's voice tombstones: the tombstone must
--    outlive what it points at.
-- 3. businesses.deleted_at        the workspace shell is KEPT (its billing,
--    dispute and suppression rows cascade from it and must be retained), but
--    renamed, stripped of contact details and marked deleted.
-- 4. workspace_close_after_retention(business)  the final step, after every
--    lead and prospect has gone through `data_rights_delete`: removes
--    members, credentials and connections, anonymises the business row.
--    Refuses while any lead or prospect remains, so it cannot skip the
--    data-rights path.

-- ------------------------------------------------------------- 1. schedule
create table if not exists public.workspace_deletion_schedule (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  ended_at timestamptz not null,
  notice_day60_sent_at timestamptz,
  notice_day83_sent_at timestamptz,
  hold boolean not null default false,
  hold_reason text check (hold_reason is null or char_length(hold_reason) between 3 and 500),
  held_by uuid references auth.users(id) on delete set null,
  held_at timestamptz,
  deletion_started_at timestamptz,
  deleted_at timestamptz,
  last_run_at timestamptz,
  last_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_deletion_hold_reason check (not hold or hold_reason is not null)
);
create index if not exists workspace_deletion_schedule_due_idx
  on public.workspace_deletion_schedule (ended_at) where deleted_at is null;

alter table public.workspace_deletion_schedule enable row level security;
alter table public.workspace_deletion_schedule force row level security;
revoke all on public.workspace_deletion_schedule from anon, authenticated;

-- ------------------------------------------------------------- 2. R2 tombstones
create table if not exists public.r2_object_tombstones (
  object_key text primary key check (char_length(object_key) between 1 and 400),
  business_id uuid not null,
  kind text not null check (kind in ('OBJECT', 'PREFIX')),
  reason text not null default 'WORKSPACE_DELETED' check (char_length(reason) <= 60),
  created_at timestamptz not null default now(),
  purged_at timestamptz,
  -- A tenant prefix must name the workspace, so a tombstone can never widen
  -- to another tenant's objects or to the whole bucket.
  constraint r2_tombstone_prefix_scoped check (
    kind <> 'PREFIX'
    or object_key ~ '^(logo|import|support|quotes)/[0-9a-f-]{36}/$'
  )
);
create index if not exists r2_object_tombstones_pending_idx
  on public.r2_object_tombstones (created_at) where purged_at is null;

alter table public.r2_object_tombstones enable row level security;
alter table public.r2_object_tombstones force row level security;
revoke all on public.r2_object_tombstones from anon, authenticated;

-- ------------------------------------------------------------- 3. deleted marker
alter table public.businesses add column if not exists deleted_at timestamptz;

-- ------------------------------------------------------------- 4. close
create or replace function public.workspace_close_after_retention(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_leads integer;
  v_prospects integer;
  v_counts jsonb := '{}'::jsonb;
  n integer;
begin
  select count(*) into v_leads from public.leads where business_id = p_business_id;
  select count(*) into v_prospects from public.prospects where business_id = p_business_id;
  if v_leads > 0 or v_prospects > 0 then
    raise exception 'workspace % still has % leads and % prospects: erase them through data_rights_delete first',
      p_business_id, v_leads, v_prospects using errcode = '55000';
  end if;

  -- Credentials and connections: nothing may keep acting for a closed workspace.
  delete from public.api_keys where business_id = p_business_id;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('api_keys', n);
  delete from public.webhook_endpoints where business_id = p_business_id;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('webhook_endpoints', n);
  delete from public.integration_secrets where business_id = p_business_id;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('integration_secrets', n);
  delete from public.integrations where business_id = p_business_id;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('integrations', n);
  delete from public.mailbox_connections where business_id = p_business_id;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('mailbox_connections', n);
  delete from public.sender_identities where business_id = p_business_id;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('sender_identities', n);
  delete from public.payment_endpoints where business_id = p_business_id;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('payment_endpoints', n);

  -- Access: nobody can open the workspace any more.
  delete from public.business_members where business_id = p_business_id;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('business_members', n);

  -- The shell stays for the retained billing, dispute and suppression rows.
  update public.businesses
     set name = 'Deleted workspace',
         slug = 'deleted-' || replace(p_business_id::text, '-', ''),
         industry = null,
         website = null,
         phone = null,
         logo_key = null,
         status = 'cancelled',
         deleted_at = coalesce(deleted_at, now()),
         updated_at = now()
   where id = p_business_id;

  return jsonb_build_object('status', 'CLOSED', 'counts', v_counts);
end
$$;

revoke all on function public.workspace_close_after_retention(uuid) from public, anon, authenticated;
grant execute on function public.workspace_close_after_retention(uuid) to service_role;
