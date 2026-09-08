-- 0079_read_policies_for_ui_tables: two panels that could never fill.
--
-- 186 of 186 public tables have RLS enabled. That is the number
-- `admin_rls_coverage()` reports and it is the product's central security
-- claim, and it is not the whole question: **47 of those tables have RLS
-- enabled and no policy at all.**
--
-- For most of them that is exactly right. `jobs`, `webhook_events`,
-- `integration_secrets`, `mcp_tokens`, `ai_token_ledger`, `cost_events` — these
-- are server-only, reached through the service-role client, and RLS-on with no
-- policy is the strongest configuration available: it denies every browser role
-- outright rather than relying on a policy being written correctly.
--
-- It is wrong for a table the product reads through the *user's* session.
-- There the read does not fail; it returns zero rows, silently, forever. No
-- error reaches the page, no warning reaches a log. The panel renders its empty
-- state and looks like a workspace that has not done anything yet.
--
-- Three such reads exist, found by cross-referencing the policy-less tables
-- against every `.from()` call made through `@/lib/supabase/server`:
--
--   * `qualification/queries.ts` reads `audit_log` for `qualification.published`
--     to show who last published the qualification rules, and when. Always
--     blank.
--   * `campaigns/reactivation-queries.ts` reads the last 50 `audit_log` rows for
--     a campaign, to show its activity history. Always blank.
--   * `integrations/queries.ts` counts `field_mappings` per integration object.
--     Always zero.
--
-- Both tables also had no `grant` to `authenticated` at all, so a policy alone
-- would not have been enough — the read would have failed on the privilege
-- before RLS was ever consulted.

/* ============================================================== audit_log */

-- Read-only, and not every column.
--
-- `metadata` and `ip_address` are deliberately excluded. The two surfaces that
-- need this read only `action`, `entity_type`, `entity_id`, `actor_user_id`,
-- `actor_type` and `created_at`; `metadata` can carry the detail of a billing
-- change or a member removal, and `ip_address` is personal data about a
-- colleague. Granting the whole row to satisfy a query that wants six columns
-- would be a disclosure nobody asked for, and this schema already grants at
-- column granularity where it matters (`profiles` since 0010).
grant select (
  id, business_id, actor_user_id, actor_type, action, entity_type, entity_id, created_at
) on public.audit_log to authenticated;

drop policy if exists audit_log_select_member on public.audit_log;
create policy audit_log_select_member on public.audit_log
  for select to authenticated
  using (public.is_business_member(business_id));

-- No insert, update or delete grant, and no policy for them. The audit trail
-- stays append-only from the server: a browser session can read what happened
-- in its own workspace and cannot write, alter or erase a line of it. That
-- property is the entire value of an audit log, and it is enforced by the
-- absence of a grant rather than by an application remembering not to.

comment on table public.audit_log is
  'Append-only workspace audit trail. Members may read their own workspace''s rows except metadata and ip_address; only the service role writes.';

/* ========================================================= field_mappings */

-- The integrations page counts these per object. Member-readable for the same
-- reason the integration list is: it says how a connection is configured, not
-- what flows through it. Writes stay server-side, where the mapping is
-- validated against the provider's actual field set.
grant select on public.field_mappings to authenticated;

drop policy if exists field_mappings_select_member on public.field_mappings;
create policy field_mappings_select_member on public.field_mappings
  for select to authenticated
  using (public.is_business_member(business_id));

/* ================================================================= anon */

-- Belt and braces. Neither table has ever granted anything to `anon`, and
-- neither should: an unauthenticated visitor has no workspace and therefore no
-- rows, but the grant is what decides that, not the policy.
revoke all on public.audit_log from anon;
revoke all on public.field_mappings from anon;
