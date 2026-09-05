-- 0010_rls: helpers, grants and policies.
--
-- Model:
--   * Every browser-exposed tenant table has RLS enabled with explicit policies.
--   * Server-only tables have RLS enabled and NO policies, so PostgREST returns
--     nothing to any browser session. Only the service role (which bypasses RLS)
--     can reach them.
--   * Helpers are SECURITY DEFINER so that policies on business_members do not
--     recurse into themselves.

-- ------------------------------------------------------------------ helpers
create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.business_members bm
    where bm.business_id = target_business_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
  );
$$;

create or replace function public.has_business_role(
  target_business_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.business_members bm
    where bm.business_id = target_business_id
      and bm.user_id = auth.uid()
      and bm.status = 'active'
      and bm.role = any(allowed_roles)
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.platform_role = 'platform_admin'
  );
$$;

revoke all on function public.is_business_member(uuid) from public, anon;
revoke all on function public.has_business_role(uuid, text[]) from public, anon;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_business_member(uuid) to authenticated;
grant execute on function public.has_business_role(uuid, text[]) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;

-- ------------------------------------------------------------ enable RLS
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','businesses','business_members','business_settings','services',
    'qualification_questions','qualification_options','qualification_rules',
    'qualification_answers','leads','lead_sources','lead_assignments',
    'contact_suppressions','conversations','messages','message_events',
    'automation_definitions','automation_versions','automation_steps',
    'automation_runs','bookings','campaigns','campaign_contacts','imports',
    'integrations','integration_secrets','integration_objects','field_mappings',
    'webhook_events','jobs','usage_events','subscriptions','notifications',
    'audit_log','marketing_sessions','marketing_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- --------------------------------------------------------------- grants
-- Server-only tables: no grants to browser roles at all.
do $$
declare t text;
begin
  foreach t in array array[
    'integration_secrets','field_mappings','webhook_events','jobs',
    'usage_events','audit_log'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Tenant tables readable by authenticated users (RLS still filters rows).
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','businesses','business_members','business_settings','services',
    'qualification_questions','qualification_options','qualification_rules',
    'qualification_answers','leads','lead_sources','lead_assignments',
    'contact_suppressions','conversations','messages','message_events',
    'automation_definitions','automation_versions','automation_steps',
    'automation_runs','bookings','campaigns','campaign_contacts','imports',
    'integrations','integration_objects','subscriptions','notifications'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ------------------------------------------------------------- profiles
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

grant update (first_name, last_name, phone, avatar_url) on public.profiles to authenticated;

-- ----------------------------------------------------------- businesses
create policy businesses_select_member on public.businesses
  for select to authenticated
  using (public.is_business_member(id));

create policy businesses_update_admin on public.businesses
  for update to authenticated
  using (public.has_business_role(id, array['owner','admin']))
  with check (public.has_business_role(id, array['owner','admin']));

grant update (name, industry, website, phone, logo_key, timezone,
              onboarding_state, onboarding_step) on public.businesses to authenticated;

-- ----------------------------------------------------- business_members
create policy business_members_select on public.business_members
  for select to authenticated
  using (public.is_business_member(business_id) or user_id = auth.uid());

-- Invites and role changes go through server actions so that seat limits and
-- owner-transfer rules are enforced; no direct client insert/update/delete.

-- ---------------------------------------------------- business_settings
create policy business_settings_select on public.business_settings
  for select to authenticated
  using (public.is_business_member(business_id));

create policy business_settings_update on public.business_settings
  for update to authenticated
  using (public.has_business_role(business_id, array['owner','admin']))
  with check (public.has_business_role(business_id, array['owner','admin']));

grant update on public.business_settings to authenticated;

-- -------------------------------------------------------------- services
create policy services_select on public.services
  for select to authenticated
  using (public.is_business_member(business_id));

create policy services_insert on public.services
  for insert to authenticated
  with check (public.has_business_role(business_id, array['owner','admin']));

create policy services_update on public.services
  for update to authenticated
  using (public.has_business_role(business_id, array['owner','admin']))
  with check (public.has_business_role(business_id, array['owner','admin']));

create policy services_delete on public.services
  for delete to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));

grant insert, update, delete on public.services to authenticated;

-- ------------------------------------------------ qualification config
do $$
declare t text;
begin
  foreach t in array array[
    'qualification_questions','qualification_options','qualification_rules'
  ] loop
    execute format($p$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (public.is_business_member(business_id));
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (public.has_business_role(business_id, array['owner','admin']));
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (public.has_business_role(business_id, array['owner','admin']))
        with check (public.has_business_role(business_id, array['owner','admin']));
      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (public.has_business_role(business_id, array['owner','admin']));
    $p$, t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ----------------------------------------------------------------- leads
create policy leads_select on public.leads
  for select to authenticated
  using (public.is_business_member(business_id));

-- Members may edit operational fields only. Ingestion-owned fields
-- (external_id, source_id, is_test, timestamps) are not grantable below.
create policy leads_update on public.leads
  for update to authenticated
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

grant update (first_name, last_name, phone, email, postcode, service_id,
              assigned_user_id, needs_attention, notes) on public.leads to authenticated;

-- Status transitions, takeover and opt-out go through server actions so that
-- automation runs and audit entries stay consistent.

create policy lead_sources_select on public.lead_sources
  for select to authenticated
  using (public.is_business_member(business_id));

create policy lead_assignments_select on public.lead_assignments
  for select to authenticated
  using (public.is_business_member(business_id));

create policy qualification_answers_select on public.qualification_answers
  for select to authenticated
  using (public.is_business_member(business_id));

create policy contact_suppressions_select on public.contact_suppressions
  for select to authenticated
  using (public.is_business_member(business_id));

-- ---------------------------------------------------------- messaging
create policy conversations_select on public.conversations
  for select to authenticated
  using (public.is_business_member(business_id));

create policy messages_select on public.messages
  for select to authenticated
  using (public.is_business_member(business_id));

create policy message_events_select on public.message_events
  for select to authenticated
  using (public.is_business_member(business_id));

-- No client insert on messages: every outbound send goes through the server
-- so provider dispatch, suppression and usage metering cannot be bypassed.

-- --------------------------------------------------------- automations
create policy automation_definitions_select on public.automation_definitions
  for select to authenticated
  using (public.is_business_member(business_id));

create policy automation_versions_select on public.automation_versions
  for select to authenticated
  using (public.is_business_member(business_id));

create policy automation_runs_select on public.automation_runs
  for select to authenticated
  using (public.is_business_member(business_id));

create policy automation_steps_select on public.automation_steps
  for select to authenticated
  using (public.is_business_member(business_id));

-- Draft steps are editable in place; publishing is a server action.
create policy automation_steps_insert on public.automation_steps
  for insert to authenticated
  with check (
    public.has_business_role(business_id, array['owner','admin'])
    and exists (
      select 1 from public.automation_versions v
      where v.id = version_id and v.status = 'DRAFT'
    )
  );

create policy automation_steps_update on public.automation_steps
  for update to authenticated
  using (
    public.has_business_role(business_id, array['owner','admin'])
    and exists (
      select 1 from public.automation_versions v
      where v.id = version_id and v.status = 'DRAFT'
    )
  )
  with check (public.has_business_role(business_id, array['owner','admin']));

create policy automation_steps_delete on public.automation_steps
  for delete to authenticated
  using (
    public.has_business_role(business_id, array['owner','admin'])
    and exists (
      select 1 from public.automation_versions v
      where v.id = version_id and v.status = 'DRAFT'
    )
  );

grant insert, update, delete on public.automation_steps to authenticated;

-- ------------------------------------------------------------ bookings
create policy bookings_select on public.bookings
  for select to authenticated
  using (public.is_business_member(business_id));

-- ----------------------------------------------------------- campaigns
create policy campaigns_select on public.campaigns
  for select to authenticated
  using (public.is_business_member(business_id));

-- Draft campaigns are editable; launch/cancel are server actions.
create policy campaigns_insert on public.campaigns
  for insert to authenticated
  with check (public.has_business_role(business_id, array['owner','admin']));

create policy campaigns_update_draft on public.campaigns
  for update to authenticated
  using (
    public.has_business_role(business_id, array['owner','admin'])
    and status = 'DRAFT'
  )
  with check (public.has_business_role(business_id, array['owner','admin']));

create policy campaigns_delete_draft on public.campaigns
  for delete to authenticated
  using (
    public.has_business_role(business_id, array['owner','admin'])
    and status = 'DRAFT'
  );

grant insert, update, delete on public.campaigns to authenticated;

create policy campaign_contacts_select on public.campaign_contacts
  for select to authenticated
  using (public.is_business_member(business_id));

create policy imports_select on public.imports
  for select to authenticated
  using (public.is_business_member(business_id));

-- -------------------------------------------------------- integrations
-- Metadata only. Tokens live in integration_secrets, which has no policies.
create policy integrations_select on public.integrations
  for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));

create policy integration_objects_select on public.integration_objects
  for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));

-- ------------------------------------------------------- subscriptions
create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));

-- Written only by the Stripe webhook via the service role.

-- ------------------------------------------------------- notifications
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = auth.uid() and public.is_business_member(business_id));

create policy notifications_update_read on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant update (read_at) on public.notifications to authenticated;
