-- 0172: finer team permissions for large workspaces (enterprise readiness,
-- todo.md "Enterprise readiness", 2026-09-28).
--
-- The four roles (owner, admin, member, viewer) are unchanged; viewer remains
-- the read-only / analyst seat. On top of the role, each membership can carry
-- an explicit allow/deny for three capabilities:
--
--   can_send_outbound        messages, campaigns, quotes/invoices, AI calls
--   can_manage_integrations  connect/disconnect/configure integrations
--   can_manage_billing       plan, purchases, billing portal
--
-- NULL means "role default", and every existing row is NULL, so effective
-- permissions after this migration are exactly the role checks before it
-- (src/lib/auth/capabilities.ts ROLE_DEFAULTS, asserted in
-- tests/enterprise-permissions.test.ts).
--
-- The audit-log export (Settings -> Data Controls) needs no schema: it reads
-- audit_log with the service role, scoped to one business_id, using the
-- existing (business_id, created_at desc) index from 0009/0075.
--
-- Tenant scoping and RLS: no new table. business_members already carries
-- business_id, has RLS on (0010) with a member-read policy and no browser
-- write policy, and TRUNCATE was revoked schema-wide in 0086. Writes to these
-- columns go through the `member.set_permissions` service operation (service
-- role). Grants below are kept consistent with 0168: the browser role keeps
-- SELECT only.
--
-- Not applied by the author. Never edit after it has run; add a new migration.

alter table public.business_members
  add column if not exists can_send_outbound boolean,
  add column if not exists can_manage_integrations boolean,
  add column if not exists can_manage_billing boolean;

comment on column public.business_members.can_send_outbound is
  'Per-person override. NULL = role default (owner/admin/member yes, viewer no).';
comment on column public.business_members.can_manage_integrations is
  'Per-person override. NULL = role default (owner/admin yes, member/viewer no).';
comment on column public.business_members.can_manage_billing is
  'Per-person override. NULL = role default (owner only). May be granted to an admin only.';

-- The owner always holds everything and a viewer holds nothing, so neither
-- may carry an override; billing may never be delegated to a member.
alter table public.business_members
  drop constraint if exists business_members_capability_overrides_chk;
alter table public.business_members
  add constraint business_members_capability_overrides_chk check (
    (
      role not in ('owner', 'viewer')
      or (can_send_outbound is null and can_manage_integrations is null and can_manage_billing is null)
    )
    and (role <> 'member' or can_manage_billing is null)
  );

-- A role change clears the overrides, so a permission granted for one role is
-- never silently carried into another (e.g. billing granted to an admin who is
-- later demoted and re-promoted). BEFORE UPDATE, so it runs ahead of the
-- CHECK above and a transfer of ownership never trips it.
create or replace function public.business_members_clear_overrides_on_role_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role then
    new.can_send_outbound := null;
    new.can_manage_integrations := null;
    new.can_manage_billing := null;
  end if;
  return new;
end;
$$;

revoke all on function public.business_members_clear_overrides_on_role_change() from public, anon, authenticated;

drop trigger if exists business_members_clear_overrides on public.business_members;
create trigger business_members_clear_overrides
  before update of role on public.business_members
  for each row execute function public.business_members_clear_overrides_on_role_change();

-- Belt and braces, consistent with 0168: the browser role reads memberships
-- through the 0010 select policy and never writes them.
revoke insert, update, delete, truncate, references, trigger
  on public.business_members from authenticated;
revoke all on public.business_members from anon;
