-- 0143-0149 and 0155-0167 RLS proof (gap audit 15 §4).
--
-- Covers every table those migrations create:
--   member-read (tenant isolation):  checkout_attempts, checkout_payments (0143),
--     experiment_promotions (0158), voice_tool_calls (0162),
--     automation_rules, automation_rule_runs, pipeline_stage_maps (0163)
--   own-user read:                   platform_banner_dismissals (0161)
--   own-partner / active-partner:    affiliate_tier_history, affiliate_tiers (0166)
--   server-only (no browser read):   payment_endpoints (0143),
--     billing_unit_conversions (0148), upsell_events,
--     subscription_welcome_emails (0149), lead_commercial_leases,
--     commercial_action_claims (0160), platform_maintenance_windows,
--     platform_banners (0161), billing_invoices, billing_disputes (0165),
--     affiliate_programme_settings, affiliate_fraud_flags,
--     affiliate_fingerprints (0166)
-- 0144-0147, 0155-0157, 0159, 0164 and 0167 create no tables.
--
-- Same style as 0150-0154-rls-proof.sql: ONE transaction that is ROLLED
-- BACK. It creates throwaway users, two workspaces, a signed-in non-member,
-- two affiliates (one ACTIVE, one APPLIED), exercises every table as
-- `authenticated` (via SET LOCAL ROLE and request.jwt.claims) and `anon`, and
-- returns one row per check. Nothing it creates survives.
--
-- A table missing from the database (its migration not applied) is reported
-- as SKIP, never as a pass.
--
-- Run: send the whole file through the Management API query endpoint (or
-- psql). NEVER commit it.

begin;

create temp table proof (id serial primary key, section text, check_name text, status text, evidence text);
create temp table fx (k text primary key, id uuid not null default gen_random_uuid());

create function pg_temp.id(p_k text) returns uuid language sql as $f$
  select id from fx where k = p_k
$f$;

create function pg_temp.ok(p_section text, p_check text, p_pass boolean, p_evidence text) returns void
language sql as $f$
  insert into proof (section, check_name, status, evidence)
  values (p_section, p_check, case when coalesce(p_pass, false) then 'PASS' else 'FAIL' end, p_evidence)
$f$;

create function pg_temp.skip(p_section text, p_check text, p_evidence text) returns void
language sql as $f$
  insert into proof (section, check_name, status, evidence) values (p_section, p_check, 'SKIP', p_evidence)
$f$;

create function pg_temp.exists_table(p_table text) returns boolean language sql as $f$
  select to_regclass('public.' || quote_ident(p_table)) is not null
$f$;

-- Runs p_sql as p_role (with the JWT claims of p_sub for `authenticated`)
-- and returns the first column of the first row as text, 'NULL' when there
-- is none, or 'ERR:<sqlstate>:<message>'. The role switch is SET LOCAL
-- inside a sub-transaction, so it never leaks past the call.
create function pg_temp.q(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $f$
declare v text;
begin
  begin
    execute format('set local role %I', p_role);
    perform set_config('request.jwt.claims',
      case when p_sub is null then json_build_object('role', p_role)::text
           else json_build_object('sub', p_sub, 'role', p_role)::text end, true);
    execute p_sql into v;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return coalesce(v, 'NULL');
  exception when others then
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end
$f$;

-- anon: every select raises 42501.
create function pg_temp.anon_denied(p_section text, p_tables text[]) returns void
language plpgsql as $f$
declare t text; r text; bad text[] := '{}'; checked int := 0;
begin
  foreach t in array p_tables loop
    if not pg_temp.exists_table(t) then continue; end if;
    checked := checked + 1;
    r := pg_temp.q('anon', null, format('select count(*)::text from public.%I', t));
    if r not like 'ERR:42501:%' then bad := bad || (t || '=' || r); end if;
  end loop;
  perform pg_temp.ok(p_section, format('anon cannot read any of the %s tables', checked),
    cardinality(bad) = 0,
    case when cardinality(bad) = 0 then 'every select raised 42501 permission denied' else array_to_string(bad, '; ') end);
end
$f$;

-- Server-only: a signed-in member and anon both get permission denied, on
-- read and on write.
create function pg_temp.server_only(p_section text, p_table text) returns void
language plpgsql as $f$
declare r text; w text; a text;
begin
  if not pg_temp.exists_table(p_table) then
    perform pg_temp.skip(p_section, p_table || ' is server-only', 'table does not exist in this database (migration not applied)');
    return;
  end if;
  r := pg_temp.q('authenticated', pg_temp.id('uA'), format('select count(*)::text from public.%I', p_table));
  w := pg_temp.q('authenticated', pg_temp.id('uA'), format('delete from public.%I', p_table));
  a := pg_temp.q('anon', null, format('select count(*)::text from public.%I', p_table));
  perform pg_temp.ok(p_section, p_table || ' is server-only (member and anon denied, member cannot write)',
    r like 'ERR:42501:%' and w like 'ERR:42501:%' and a like 'ERR:42501:%',
    format('member read=%s | member delete=%s | anon read=%s', r, w, a));
end
$f$;

-- Member-read: tenant A's user sees none of B's rows and vice versa; a
-- signed-in non-member sees nothing; A sees its own (not vacuous); the
-- browser role cannot write.
create function pg_temp.tenant_isolated(p_section text, p_tables text[]) returns void
language plpgsql as $f$
declare t text; ab text; ba text; na text; aa text; bb text; w text; bad text[] := '{}'; seen text[] := '{}';
begin
  foreach t in array p_tables loop
    ab := pg_temp.q('authenticated', pg_temp.id('uA'), format('select count(*)::text from public.%I where business_id = %L', t, pg_temp.id('bB')));
    ba := pg_temp.q('authenticated', pg_temp.id('uB'), format('select count(*)::text from public.%I where business_id = %L', t, pg_temp.id('bA')));
    na := pg_temp.q('authenticated', pg_temp.id('uN'), format('select count(*)::text from public.%I', t));
    aa := pg_temp.q('authenticated', pg_temp.id('uA'), format('select count(*)::text from public.%I where business_id = %L', t, pg_temp.id('bA')));
    execute format('select count(*)::text from public.%I where business_id = %L', t, pg_temp.id('bB')) into bb;
    w := pg_temp.q('authenticated', pg_temp.id('uA'), format('delete from public.%I where business_id = %L', t, pg_temp.id('bA')));
    if ab <> '0' or ba <> '0' or na <> '0' or aa = '0' or bb = '0' or w not like 'ERR:42501:%' then
      bad := bad || format('%s: A->B=%s B->A=%s nonmember=%s A-own=%s B-has=%s delete=%s', t, ab, ba, na, aa, bb, w);
    end if;
    seen := seen || format('%s(A sees own %s, B has %s)', t, aa, bb);
  end loop;
  perform pg_temp.ok(p_section,
    format('cross-tenant isolation, non-member sees nothing, browser cannot write (%s member-read tables)', cardinality(p_tables)),
    cardinality(bad) = 0,
    case when cardinality(bad) = 0 then array_to_string(seen, ', ') else array_to_string(bad, '; ') end);
end
$f$;

-- --------------------------------------------------------------- fixtures
insert into fx (k) values
  ('uA'), ('uB'), ('uN'), ('uP'), ('uQ'), ('bA'), ('bB'), ('lA'), ('lB'),
  ('eA'), ('eB'), ('cA'), ('cB'), ('rA'), ('rB'), ('pP'), ('pQ');

insert into auth.users (id, email, aud, role)
select pg_temp.id(k), k || '-' || pg_temp.id(k) || '@proof.invalid', 'authenticated', 'authenticated'
  from unnest(array['uA', 'uB', 'uN', 'uP', 'uQ']) k;
insert into public.businesses (id, name) values (pg_temp.id('bA'), 'Proof Tenant A'), (pg_temp.id('bB'), 'Proof Tenant B');
insert into public.business_members (business_id, user_id, role, status) values
  (pg_temp.id('bA'), pg_temp.id('uA'), 'owner', 'active'),
  (pg_temp.id('bB'), pg_temp.id('uB'), 'owner', 'active');
insert into public.leads (id, business_id) values (pg_temp.id('lA'), pg_temp.id('bA')), (pg_temp.id('lB'), pg_temp.id('bB'));

-- 0143
insert into public.checkout_attempts (business_id, lead_id, link_id, token, tracking_param, sent_url, channel, send_key)
values (pg_temp.id('bA'), pg_temp.id('lA'), 'link-a', 'proofTokenAAAAAAAAAA', 'ct', 'https://pay.example/a', 'email', 'proof:a'),
       (pg_temp.id('bB'), pg_temp.id('lB'), 'link-b', 'proofTokenBBBBBBBBBB', 'ct', 'https://pay.example/b', 'email', 'proof:b');
insert into public.checkout_payments (business_id, provider, external_event_id, provider_order_id, amount_minor, currency, lead_id)
values (pg_temp.id('bA'), 'stripe', 'proof_evt_a', 'proof_order_a', 1000, 'GBP', pg_temp.id('lA')),
       (pg_temp.id('bB'), 'stripe', 'proof_evt_b', 'proof_order_b', 2000, 'GBP', pg_temp.id('lB'));

-- 0158
insert into public.experiments (id, business_id, kind, target_id, name, variants)
values (pg_temp.id('eA'), pg_temp.id('bA'), 'WARM_FOLLOW_UP', gen_random_uuid(), 'Proof experiment A', '[{"arm":"A"},{"arm":"B"}]'),
       (pg_temp.id('eB'), pg_temp.id('bB'), 'WARM_FOLLOW_UP', gen_random_uuid(), 'Proof experiment B', '[{"arm":"A"},{"arm":"B"}]');
insert into public.experiment_promotions (business_id, experiment_id, action, arm, version, decided_by_kind, reason)
values (pg_temp.id('bA'), pg_temp.id('eA'), 'PROMOTE', 'B', 1, 'HUMAN', 'proof'),
       (pg_temp.id('bB'), pg_temp.id('eB'), 'PROMOTE', 'B', 1, 'HUMAN', 'proof');

-- 0162
insert into public.voice_calls (id, business_id, lead_id, direction, route, call_key)
values (pg_temp.id('cA'), pg_temp.id('bA'), pg_temp.id('lA'), 'OUTBOUND', 'QUALIFICATION', 'proof:tool:a'),
       (pg_temp.id('cB'), pg_temp.id('bB'), pg_temp.id('lB'), 'OUTBOUND', 'QUALIFICATION', 'proof:tool:b');
insert into public.voice_tool_calls (business_id, voice_call_id, lead_id, tool_call_id, tool, args_hash, status)
values (pg_temp.id('bA'), pg_temp.id('cA'), pg_temp.id('lA'), 'proof-tc-a', 'record_fact', repeat('a', 64), 'OK'),
       (pg_temp.id('bB'), pg_temp.id('cB'), pg_temp.id('lB'), 'proof-tc-b', 'record_fact', repeat('b', 64), 'OK');

-- 0163
insert into public.automation_rules (id, business_id, name, trigger_event, actions)
values (pg_temp.id('rA'), pg_temp.id('bA'), 'Proof rule A', 'lead.created', '[{"type":"add_tag","tag":"proof"}]'),
       (pg_temp.id('rB'), pg_temp.id('bB'), 'Proof rule B', 'lead.created', '[{"type":"add_tag","tag":"proof"}]');
insert into public.automation_rule_runs (business_id, rule_id, automation_event_id, action_index, status)
values (pg_temp.id('bA'), pg_temp.id('rA'), gen_random_uuid(), 0, 'SUCCEEDED'),
       (pg_temp.id('bB'), pg_temp.id('rB'), gen_random_uuid(), 0, 'SUCCEEDED');
insert into public.pipeline_stage_maps (business_id) values (pg_temp.id('bA')), (pg_temp.id('bB'));

-- 0161
insert into public.platform_banner_dismissals (banner_key, user_id)
values (gen_random_uuid()::text, pg_temp.id('uA')), (gen_random_uuid()::text, pg_temp.id('uB'));

-- 0166: partner P is ACTIVE, partner Q only APPLIED.
insert into public.affiliates (id, user_id, code, display_name, contact_email, status)
values (pg_temp.id('pP'), pg_temp.id('uP'), 'PROOFP' || substr(md5(random()::text), 1, 6), 'Proof Partner P', 'p@proof.invalid', 'ACTIVE'),
       (pg_temp.id('pQ'), pg_temp.id('uQ'), 'PROOFQ' || substr(md5(random()::text), 1, 6), 'Proof Partner Q', 'q@proof.invalid', 'APPLIED');
insert into public.affiliate_tier_history (affiliate_id, from_tier, to_tier, reason)
values (pg_temp.id('pP'), 'STANDARD', 'PARTNER', 'SCHEDULED'),
       (pg_temp.id('pQ'), 'STANDARD', 'PARTNER', 'SCHEDULED');

-- ------------------------------------------------------------------ checks
select pg_temp.tenant_isolated('0143', array['checkout_attempts', 'checkout_payments']);
select pg_temp.tenant_isolated('0158', array['experiment_promotions']);
select pg_temp.tenant_isolated('0162', array['voice_tool_calls']);
select pg_temp.tenant_isolated('0163', array['automation_rules', 'automation_rule_runs', 'pipeline_stage_maps']);

do $t$
declare r text; r2 text; r3 text;
begin
  -- 0143: tenant A cannot fetch tenant B's checkout by its token.
  r := pg_temp.q('authenticated', pg_temp.id('uA'),
    'select count(*)::text from public.checkout_attempts where token = ''proofTokenBBBBBBBBBB''');
  perform pg_temp.ok('0143', 'tenant A cannot look up tenant B''s checkout link by token', r = '0', 'A sees ' || r);

  -- 0162: tool calls of B's voice call are invisible to A by call id.
  r := pg_temp.q('authenticated', pg_temp.id('uA'), format(
    'select count(*)::text from public.voice_tool_calls where voice_call_id = %L', pg_temp.id('cB')));
  perform pg_temp.ok('0162', 'tenant A cannot see tool calls on tenant B''s call', r = '0', 'A sees ' || r);

  -- 0163: a member cannot create or enable a rule from the browser.
  r := pg_temp.q('authenticated', pg_temp.id('uA'), format(
    'insert into public.automation_rules (business_id, name, trigger_event, actions) values (%L, ''browser'', ''lead.created'', ''[{"type":"add_tag"}]'') returning id::text',
    pg_temp.id('bA')));
  r2 := pg_temp.q('authenticated', pg_temp.id('uA'), format(
    'update public.automation_rules set enabled = true, enabled_at = now() where id = %L returning id::text', pg_temp.id('rA')));
  perform pg_temp.ok('0163', 'a member cannot insert or enable an automation rule from the browser',
    r like 'ERR:42501:%' and (r2 like 'ERR:42501:%' or r2 = 'NULL'), r || ' | ' || r2);

  -- 0161: dismissals are own-user only.
  r := pg_temp.q('authenticated', pg_temp.id('uA'), 'select count(*)::text from public.platform_banner_dismissals');
  r2 := pg_temp.q('authenticated', pg_temp.id('uA'), format(
    'select count(*)::text from public.platform_banner_dismissals where user_id = %L', pg_temp.id('uB')));
  r3 := pg_temp.q('authenticated', pg_temp.id('uN'), 'select count(*)::text from public.platform_banner_dismissals');
  perform pg_temp.ok('0161', 'platform_banner_dismissals: a user sees only their own dismissals',
    r = '1' and r2 = '0' and r3 = '0', format('A own=%s, A->B=%s, non-member=%s', r, r2, r3));
  r := pg_temp.q('authenticated', pg_temp.id('uA'), format(
    'insert into public.platform_banner_dismissals (banner_key, user_id) values (%L, %L)', gen_random_uuid()::text, pg_temp.id('uB')));
  perform pg_temp.ok('0161', 'a user cannot write a dismissal (for anyone) from the browser', r like 'ERR:42501:%', r);

  -- 0161: the two anon-callable functions answer anon, and the tables behind
  -- them stay closed (checked in the server-only list below).
  r := pg_temp.q('anon', null, 'select count(*)::text from public.platform_marketing_banners()');
  r2 := pg_temp.q('anon', null, 'select count(*)::text from public.platform_maintenance_public()');
  perform pg_temp.ok('0161', 'anon may call the public banner and maintenance functions (by design)',
    r not like 'ERR:%' and r2 not like 'ERR:%', 'marketing=' || r || ' | maintenance=' || r2);

  -- 0166: tier history is own-partner only.
  r := pg_temp.q('authenticated', pg_temp.id('uP'), 'select count(*)::text from public.affiliate_tier_history');
  r2 := pg_temp.q('authenticated', pg_temp.id('uP'), format(
    'select count(*)::text from public.affiliate_tier_history where affiliate_id = %L', pg_temp.id('pQ')));
  r3 := pg_temp.q('authenticated', pg_temp.id('uA'), 'select count(*)::text from public.affiliate_tier_history');
  perform pg_temp.ok('0166', 'affiliate_tier_history: a partner sees only their own history; a customer sees none',
    r = '1' and r2 = '0' and r3 = '0', format('P own=%s, P->Q=%s, customer=%s', r, r2, r3));
  r := pg_temp.q('authenticated', pg_temp.id('uP'), format(
    'with d as (delete from public.affiliate_tier_history where affiliate_id = %L returning 1) select count(*)::text from d',
    pg_temp.id('pP')));
  select count(*)::text into r2 from public.affiliate_tier_history where affiliate_id = pg_temp.id('pP');
  perform pg_temp.ok('0166', 'a partner cannot delete their tier history (RLS: nothing deleted)',
    (r like 'ERR:42501:%' or r = '0') and r2 = '1', 'delete=' || r || ', rows left=' || r2);

  -- 0166: tiers are readable by ACTIVE partners only.
  r := pg_temp.q('authenticated', pg_temp.id('uP'), 'select count(*)::text from public.affiliate_tiers');
  r2 := pg_temp.q('authenticated', pg_temp.id('uQ'), 'select count(*)::text from public.affiliate_tiers');
  r3 := pg_temp.q('authenticated', pg_temp.id('uA'), 'select count(*)::text from public.affiliate_tiers');
  perform pg_temp.ok('0166', 'affiliate_tiers: readable by an active partner only (not an applicant, not a customer)',
    r <> '0' and r not like 'ERR:%' and r2 = '0' and r3 = '0', format('active=%s, applied=%s, customer=%s', r, r2, r3));
  r := pg_temp.q('authenticated', pg_temp.id('uP'),
    'with u as (update public.affiliate_tiers set commission_percent = 99 returning 1) select count(*)::text from u');
  select count(*)::text into r2 from public.affiliate_tiers where commission_percent = 99;
  perform pg_temp.ok('0166', 'a partner cannot change a tier''s rate (RLS: nothing updated)',
    (r like 'ERR:42501:%' or r = '0') and r2 = '0', 'update=' || r || ', rows at 99%=' || r2);
end
$t$;

select pg_temp.server_only('0143', 'payment_endpoints');
select pg_temp.server_only('0148', 'billing_unit_conversions');
select pg_temp.server_only('0149', 'upsell_events');
select pg_temp.server_only('0149', 'subscription_welcome_emails');
select pg_temp.server_only('0160', 'lead_commercial_leases');
select pg_temp.server_only('0160', 'commercial_action_claims');
select pg_temp.server_only('0161', 'platform_maintenance_windows');
select pg_temp.server_only('0161', 'platform_banners');
select pg_temp.server_only('0165', 'billing_invoices');
select pg_temp.server_only('0165', 'billing_disputes');
select pg_temp.server_only('0166', 'affiliate_programme_settings');
select pg_temp.server_only('0166', 'affiliate_fraud_flags');
select pg_temp.server_only('0166', 'affiliate_fingerprints');

select pg_temp.anon_denied('all', array[
  'checkout_attempts', 'checkout_payments', 'experiment_promotions', 'voice_tool_calls', 'automation_rules',
  'automation_rule_runs', 'pipeline_stage_maps', 'platform_banner_dismissals', 'affiliate_tier_history',
  'affiliate_tiers', 'payment_endpoints', 'billing_unit_conversions', 'upsell_events', 'subscription_welcome_emails',
  'lead_commercial_leases', 'commercial_action_claims', 'platform_maintenance_windows', 'platform_banners',
  'billing_invoices', 'billing_disputes', 'affiliate_programme_settings', 'affiliate_fraud_flags',
  'affiliate_fingerprints']);

-- Every table in scope has RLS enabled (belt and braces over the grants).
do $t$
declare t text; bad text[] := '{}'; n int := 0;
begin
  foreach t in array array[
    'checkout_attempts', 'checkout_payments', 'experiment_promotions', 'voice_tool_calls', 'automation_rules',
    'automation_rule_runs', 'pipeline_stage_maps', 'platform_banner_dismissals', 'affiliate_tier_history',
    'affiliate_tiers', 'payment_endpoints', 'billing_unit_conversions', 'upsell_events', 'subscription_welcome_emails',
    'lead_commercial_leases', 'commercial_action_claims', 'platform_maintenance_windows', 'platform_banners',
    'billing_invoices', 'billing_disputes', 'affiliate_programme_settings', 'affiliate_fraud_flags',
    'affiliate_fingerprints'] loop
    if not pg_temp.exists_table(t) then continue; end if;
    n := n + 1;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then bad := bad || t; end if;
  end loop;
  perform pg_temp.ok('all', format('RLS is enabled on all %s tables present', n), cardinality(bad) = 0,
    case when cardinality(bad) = 0 then 'relrowsecurity = true everywhere' else 'missing: ' || array_to_string(bad, ', ') end);
end
$t$;

-- The browser role holds no write privilege at all on any table in scope.
-- RLS already stops row writes, but TRUNCATE is not subject to RLS, so a
-- write grant left over from default privileges is a defect in itself.
do $t$
declare t text; bad text[] := '{}'; n int := 0;
begin
  foreach t in array array[
    'checkout_attempts', 'checkout_payments', 'experiment_promotions', 'voice_tool_calls', 'automation_rules',
    'automation_rule_runs', 'pipeline_stage_maps', 'platform_banner_dismissals', 'affiliate_tier_history',
    'affiliate_tiers', 'payment_endpoints', 'billing_unit_conversions', 'upsell_events', 'subscription_welcome_emails',
    'lead_commercial_leases', 'commercial_action_claims', 'platform_maintenance_windows', 'platform_banners',
    'billing_invoices', 'billing_disputes', 'affiliate_programme_settings', 'affiliate_fraud_flags',
    'affiliate_fingerprints'] loop
    if not pg_temp.exists_table(t) then continue; end if;
    n := n + 1;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE')
       or has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') then
      bad := bad || t;
    end if;
  end loop;
  perform pg_temp.ok('all', format('authenticated holds no INSERT/UPDATE/DELETE/TRUNCATE on any of the %s tables', n),
    cardinality(bad) = 0,
    case when cardinality(bad) = 0 then 'select-only or no grant everywhere' else 'write grants on: ' || array_to_string(bad, ', ') || ' (fixed by 0168)' end);
end
$t$;

-- @@report
select section, check_name, status, evidence from proof order by id;
rollback;
