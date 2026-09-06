-- 0036_v4_rls: row level security for every V4 table.
--
-- Same model as 0010:
--   * Every browser-reachable tenant table has RLS enabled + a select policy
--     scoped by public.is_business_member(business_id).
--   * Server-only tables have RLS enabled and NO policies and NO grants, so
--     PostgREST returns nothing to any browser session whatsoever. Only the
--     service role reaches them.
--   * Writes are not granted to `authenticated`. Every V4 mutation goes through
--     a server action that calls requireRole() and then writes with the service
--     role, explicitly scoped to the caller's business_id — the pattern V3 uses
--     throughout. RLS is the backstop, not the only guard.
--
-- Three things are deliberately server-only here, per V4 §90:
--   * agent_* and cost/margin tables — raw provider cost and token counts are
--     never exposed to a customer.
--   * mcp_tokens and mcp_audit_logs — token material and cross-client audit.
--   * usage_reservations — internal reserve/reconcile bookkeeping.

-- ------------------------------------------------------- affiliate helpers
-- An affiliate is a platform-level actor, not a workspace member, so the
-- affiliate surfaces need their own predicate. SECURITY DEFINER for the same
-- reason as is_business_member: the policy on `affiliates` would otherwise
-- recurse into itself.
create or replace function public.current_affiliate_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id
  from public.affiliates a
  where a.user_id = auth.uid()
    and a.status in ('APPLIED','ACTIVE','SUSPENDED')
  limit 1;
$$;

create or replace function public.is_active_affiliate()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.affiliates a
    where a.user_id = auth.uid()
      and a.status = 'ACTIVE'
  );
$$;

revoke all on function public.current_affiliate_id() from public, anon;
revoke all on function public.is_active_affiliate() from public, anon;
grant execute on function public.current_affiliate_id() to authenticated;
grant execute on function public.is_active_affiliate() to authenticated;

-- ------------------------------------------------------------- enable RLS
do $$
declare t text;
begin
  foreach t in array array[
    'business_profiles','business_memory_facts','business_knowledge_sources',
    'business_learning_events','business_playbooks','icp_profiles','icp_segments',
    'conversion_goals','prospect_companies','prospects','prospect_data_sources',
    'prospect_enrichments','prospect_verifications','prospect_scores',
    'prospect_score_factors','search_sessions','search_messages','search_strategies',
    'search_strategy_versions','search_feedback','sourcing_runs','sourcing_run_queries',
    'sourcing_run_results','sourcing_run_issues','recurring_searches','intent_categories',
    'intent_monitors','intent_events','prospect_intent_matches','outreach_campaigns',
    'outreach_campaign_versions','outreach_sequences','outreach_steps','outreach_runs',
    'outreach_recipient_runs','campaign_experiments','campaign_variants','campaign_learnings',
    'optimization_actions','mailbox_connections','sender_identities',
    'domain_health_snapshots','mailbox_health_snapshots','contact_permissions',
    'contactability_results','suppression_entries','compliance_decisions',
    'privacy_notice_events','lead_source_evidence','compliance_policy_versions',
    'lead_imports','lead_import_rows','lead_import_mappings','agent_runs',
    'agent_tool_calls','agent_budgets','agent_prompt_versions','provider_price_book',
    'cost_events','business_cost_daily','business_margin_monthly','economics_alerts',
    'plan_entitlements','business_entitlement_grants','customer_usage_allocations',
    'usage_reservations','support_tickets','support_messages','support_notes',
    'support_assignments','support_articles','support_attachments','affiliates',
    'affiliate_commission_plans','affiliate_campaigns','affiliate_links',
    'affiliate_promo_codes','affiliate_clicks','affiliate_attributions',
    'affiliate_referrals','affiliate_commissions','affiliate_payouts',
    'affiliate_resources','affiliate_resource_downloads','mcp_clients','mcp_scopes',
    'mcp_tokens','mcp_audit_logs','mcp_approvals','external_connections',
    'external_entity_links','sync_runs','sync_conflicts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ------------------------------------------------------- server-only tables
-- No grants at all. Provider cost, token usage, MCP token material and internal
-- reservation bookkeeping never reach a browser role.
do $$
declare t text;
begin
  foreach t in array array[
    'agent_runs','agent_tool_calls','agent_budgets','agent_prompt_versions',
    'provider_price_book','cost_events','business_cost_daily','business_margin_monthly',
    'economics_alerts','plan_entitlements','usage_reservations','mcp_tokens',
    'mcp_audit_logs','compliance_decisions','affiliate_clicks','affiliate_attributions',
    'affiliate_commission_plans','affiliate_promo_codes','support_notes',
    'support_assignments'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------ provenance without pricing
-- The Prospect Drawer's Research view and the Sourcing Run's provider activity
-- summary are customer-facing: a score that cannot be traced to its evidence is
-- exactly what V4 §14.3 forbids. But `cost_minor` on these rows is raw provider
-- cost, which §90 keeps admin-only. Column-level grants give the customer the
-- provenance and withhold the price.
revoke all on public.prospect_data_sources from anon, authenticated;
grant select (id, business_id, prospect_id, company_id, field_name, value_json,
              provider, source_type, source_url, provider_entity_id, confidence,
              obtained_at, verified_at, policy_tags)
  on public.prospect_data_sources to authenticated;
create policy prospect_data_sources_select_member on public.prospect_data_sources
  for select to authenticated
  using (public.is_business_member(business_id));

revoke all on public.sourcing_run_queries from anon, authenticated;
grant select (id, business_id, run_id, stage, provider, capability, status,
              result_count, latency_ms, error_code, created_at, completed_at)
  on public.sourcing_run_queries to authenticated;
create policy sourcing_run_queries_select_member on public.sourcing_run_queries
  for select to authenticated
  using (public.is_business_member(business_id));

-- ------------------------------------------------- member-readable tenant set
do $$
declare t text;
begin
  foreach t in array array[
    'business_profiles','business_memory_facts','business_knowledge_sources',
    'business_learning_events','business_playbooks','icp_profiles','icp_segments',
    'conversion_goals','prospect_companies','prospects','prospect_enrichments',
    'prospect_verifications','prospect_scores','prospect_score_factors',
    'search_sessions','search_messages','search_strategies','search_strategy_versions',
    'search_feedback','sourcing_runs','sourcing_run_results','sourcing_run_issues',
    'recurring_searches','intent_categories','intent_monitors','intent_events',
    'prospect_intent_matches','outreach_campaigns','outreach_campaign_versions',
    'outreach_sequences','outreach_steps','outreach_runs','outreach_recipient_runs',
    'campaign_experiments','campaign_variants','campaign_learnings','optimization_actions',
    'sender_identities','domain_health_snapshots','mailbox_health_snapshots',
    'contact_permissions','contactability_results','suppression_entries',
    'privacy_notice_events','lead_source_evidence','lead_imports','lead_import_rows',
    'lead_import_mappings','customer_usage_allocations','business_entitlement_grants',
    'external_entity_links','sync_runs','sync_conflicts'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_business_member(business_id))',
      t || '_select_member', t);
  end loop;
end $$;

-- ------------------------------------------------- withhold the money columns
-- These tables are member-readable, but the minor-unit cost and budget columns
-- on them are raw provider spend. V4 §112 is explicit that no customer page
-- exposes provider unit costs, so the columns are revoked from the browser role
-- and the customer-facing budget meters read a derived percentage produced
-- server-side instead. `customer_usage_allocations.overage_cap_minor` is
-- deliberately NOT revoked: that is the customer's own cap, in their own money.
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('prospect_enrichments',   array['cost_minor']),
      ('prospect_verifications', array['cost_minor']),
      ('sourcing_runs',          array['max_total_cost_minor','max_provider_cost_minor','spent_cost_minor']),
      ('sourcing_run_results',   array['cost_minor']),
      ('intent_events',          array['cost_minor']),
      ('intent_monitors',        array['monthly_budget_minor','spent_this_period_minor']),
      ('outreach_campaigns',     array['max_cost_minor','spent_cost_minor','reserved_allowance_minor']),
      ('outreach_runs',          array['cost_minor']),
      ('search_strategies',      array['estimated_cost_minor']),
      ('recurring_searches',     array['max_cost_per_run_minor'])
    ) as t(table_name, columns)
  loop
    execute format(
      'revoke select (%s) on public.%I from authenticated',
      (select string_agg(quote_ident(c), ', ') from unnest(spec.columns) as c),
      spec.table_name);
  end loop;
end $$;

-- -------------------------------------------- admin/owner-only tenant tables
-- Connection rows carry a secret_ref and provider account identity, so they
-- follow the same owner/admin restriction V3 puts on `integrations`.
do $$
declare t text;
begin
  foreach t in array array[
    'mailbox_connections','external_connections','mcp_clients','mcp_scopes','mcp_approvals'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_business_role(business_id, array[''owner'',''admin'']))',
      t || '_select_admin', t);
  end loop;
end $$;

-- --------------------------------------------------------- support surfaces
-- A customer sees their own workspace's tickets. Platform admins see all of
-- them; the admin console still reads through the service role, but the policy
-- means a platform admin's own session is not artificially blinded either.
grant select on public.support_tickets to authenticated;
revoke all on public.support_tickets from anon;
create policy support_tickets_select on public.support_tickets
  for select to authenticated
  using (
    (business_id is not null and public.is_business_member(business_id))
    or created_by_user_id = auth.uid()
    or public.is_platform_admin()
  );

grant select on public.support_messages to authenticated;
revoke all on public.support_messages from anon;
create policy support_messages_select on public.support_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.support_tickets t
      where t.id = support_messages.ticket_id
        and (
          (t.business_id is not null and public.is_business_member(t.business_id))
          or t.created_by_user_id = auth.uid()
          or public.is_platform_admin()
        )
    )
  );

grant select on public.support_attachments to authenticated;
revoke all on public.support_attachments from anon;
create policy support_attachments_select on public.support_attachments
  for select to authenticated
  using (
    exists (
      select 1 from public.support_tickets t
      where t.id = support_attachments.ticket_id
        and (
          (t.business_id is not null and public.is_business_member(t.business_id))
          or t.created_by_user_id = auth.uid()
          or public.is_platform_admin()
        )
    )
  );

-- Published help content is readable by any signed-in user.
grant select on public.support_articles to authenticated;
revoke all on public.support_articles from anon;
create policy support_articles_select on public.support_articles
  for select to authenticated
  using (status = 'PUBLISHED' or public.is_platform_admin());

-- ---------------------------------------------------------- compliance packs
-- The active policy pack is not a secret: the customer is entitled to see which
-- rules governed a decision about their own outreach.
grant select on public.compliance_policy_versions to authenticated;
revoke all on public.compliance_policy_versions from anon;
create policy compliance_policy_versions_select on public.compliance_policy_versions
  for select to authenticated
  using (status = 'ACTIVE' or public.is_platform_admin());

-- ------------------------------------------------------------- affiliates
-- An affiliate reads only their own programme data. Nothing here joins to a
-- referred customer's operational tables.
grant select on public.affiliates to authenticated;
revoke all on public.affiliates from anon;
create policy affiliates_select_self on public.affiliates
  for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());

do $$
declare t text;
begin
  foreach t in array array[
    'affiliate_campaigns','affiliate_links','affiliate_referrals',
    'affiliate_commissions','affiliate_payouts','affiliate_resource_downloads'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (affiliate_id = public.current_affiliate_id() or public.is_platform_admin())',
      t || '_select_self', t);
  end loop;
end $$;

-- The resource hub is shared: every active affiliate sees the published assets.
grant select on public.affiliate_resources to authenticated;
revoke all on public.affiliate_resources from anon;
create policy affiliate_resources_select on public.affiliate_resources
  for select to authenticated
  using (
    (status = 'PUBLISHED' and public.is_active_affiliate())
    or public.is_platform_admin()
  );
