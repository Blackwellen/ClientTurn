-- 0150-0154 RLS and integrity proof (voice core, voice money, catalogue,
-- quotes, customer invoicing).
--
-- Runs entirely inside ONE transaction that is ROLLED BACK: it creates
-- throwaway workspaces, users, leads and opportunities, exercises the new
-- tables as `authenticated` (two tenants and a non-member, via
-- request.jwt.claims), `anon` and `service_role`, and returns one row per
-- check. Nothing it creates survives.
--
-- Two ways to run it:
--   * against a database where 0150-0154 are applied: send the whole file
--     through the Management API query endpoint (or psql). It begins with
--     `begin;` and ends with the report and `rollback;`.
--   * before they are applied: a runner puts `begin;`, then the migration
--     files, then this file's sections (minus the `@@begin` one). Each
--     `-- @@<name>` line starts a section; `-- @@0150` .. `-- @@0154` hold the
--     fixtures and checks that need that migration, `-- @@act` anonymises one
--     lead and deletes tenant B, and `-- @@<n>.post` checks the aftermath.
--     A run for migration N includes the sections up to N only.
--
-- NEVER commit this. Every check writes to a temp table; the last statement
-- before the rollback reports it.

-- @@begin
begin;

-- @@setup
create temp table proof (id serial primary key, section text, check_name text, pass boolean, evidence text);
create temp table fx (k text primary key, id uuid not null default gen_random_uuid());

create function pg_temp.id(p_k text) returns uuid language sql as $f$
  select id from fx where k = p_k
$f$;

create function pg_temp.ok(p_section text, p_check text, p_pass boolean, p_evidence text) returns void
language sql as $f$
  insert into proof (section, check_name, pass, evidence) values (p_section, p_check, coalesce(p_pass, false), p_evidence)
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

-- anon has no access at all to any of these tables.
create function pg_temp.anon_denied(p_section text, p_tables text[]) returns void
language plpgsql as $f$
declare t text; r text; bad text[] := '{}';
begin
  foreach t in array p_tables loop
    r := pg_temp.q('anon', null, format('select count(*)::text from public.%I', t));
    if r not like 'ERR:42501:%' then bad := bad || (t || '=' || r); end if;
  end loop;
  perform pg_temp.ok(p_section, format('anon cannot read any of the %s new tables', cardinality(p_tables)),
    cardinality(bad) = 0,
    case when cardinality(bad) = 0 then 'every select raised 42501 permission denied' else array_to_string(bad, '; ') end);
end
$f$;

-- Member-read tables: tenant A's user sees none of B's rows and vice versa;
-- a signed-in non-member sees nothing; the browser role cannot write.
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
    if ab <> '0' or ba <> '0' or na <> '0' or w not like 'ERR:42501:%' then
      bad := bad || format('%s: A->B=%s B->A=%s nonmember=%s delete=%s', t, ab, ba, na, w);
    end if;
    seen := seen || format('%s(A sees own %s, B has %s)', t, aa, bb);
  end loop;
  perform pg_temp.ok(p_section,
    format('cross-tenant isolation, non-member sees nothing, browser cannot write (%s member-read tables)', cardinality(p_tables)),
    cardinality(bad) = 0,
    case when cardinality(bad) = 0 then array_to_string(seen, ', ') else array_to_string(bad, '; ') end);
end
$f$;

insert into fx (k) values
  ('uA'), ('uB'), ('uN'), ('bA'), ('bB'), ('lA'), ('lA2'), ('lB'), ('oA'), ('oA2'), ('oB');

insert into auth.users (id, email, aud, role)
select pg_temp.id(k), k || '-' || pg_temp.id(k) || '@proof.invalid', 'authenticated', 'authenticated'
  from unnest(array['uA', 'uB', 'uN']) k;
insert into public.businesses (id, name) values (pg_temp.id('bA'), 'Proof Tenant A'), (pg_temp.id('bB'), 'Proof Tenant B');
insert into public.business_members (business_id, user_id, role, status) values
  (pg_temp.id('bA'), pg_temp.id('uA'), 'owner', 'active'),
  (pg_temp.id('bB'), pg_temp.id('uB'), 'owner', 'active');
insert into public.leads (id, business_id) values
  (pg_temp.id('lA'), pg_temp.id('bA')), (pg_temp.id('lA2'), pg_temp.id('bA')), (pg_temp.id('lB'), pg_temp.id('bB'));
insert into public.opportunities (id, business_id, lead_id, name, close_target) values
  (pg_temp.id('oA'), pg_temp.id('bA'), pg_temp.id('lA'), 'Proof opp A', 'QUOTE'),
  (pg_temp.id('oA2'), pg_temp.id('bA'), pg_temp.id('lA2'), 'Proof opp A2', 'QUOTE'),
  (pg_temp.id('oB'), pg_temp.id('bB'), pg_temp.id('lB'), 'Proof opp B', 'QUOTE');

-- @@0150
insert into fx (k) values ('cA'), ('cA2'), ('cB'), ('nA'), ('nB');

insert into public.voice_settings (business_id, calling_as_name, legal_entity_name, identification_contact, voice_enabled)
values (pg_temp.id('bA'), 'Acme', 'Acme Ltd', '0800 000 000', true),
       (pg_temp.id('bB'), 'Beta', 'Beta Ltd', '1 Beta Street, London', true);
insert into public.telephony_accounts (business_id, subaccount_sid, friendly_name)
values (pg_temp.id('bA'), 'AC' || repeat('a', 32), 'ws-a'), (pg_temp.id('bB'), 'AC' || repeat('b', 32), 'ws-b');
insert into public.number_provisioning_details (business_id, details, fingerprint)
values (pg_temp.id('bA'), '{"rep":"x"}', 'fa'), (pg_temp.id('bB'), '{"rep":"y"}', 'fb');
insert into public.business_numbers (id, business_id, provisioning_state, e164)
values (pg_temp.id('nA'), pg_temp.id('bA'), 'ACTIVE', '+447700900001'),
       (pg_temp.id('nB'), pg_temp.id('bB'), 'ACTIVE', '+447700900002');
insert into public.number_provisioning_events (business_id, business_number_id, from_state, to_state, event, idempotency_key)
values (pg_temp.id('bA'), pg_temp.id('nA'), 'CONFIGURED', 'ACTIVE', 'ACTIVATE', 'proof-a:1'),
       (pg_temp.id('bB'), pg_temp.id('nB'), 'CONFIGURED', 'ACTIVE', 'ACTIVATE', 'proof-b:1');
insert into public.voice_calls (id, business_id, lead_id, direction, route, state, call_key, to_e164, from_e164, provider, provider_call_id)
values (pg_temp.id('cA'), pg_temp.id('bA'), pg_temp.id('lA'), 'OUTBOUND', 'QUALIFICATION', 'COMPLETE', 'proof:a:1', '+447700900101', '+447700900001', 'fake', 'pa1'),
       (pg_temp.id('cA2'), pg_temp.id('bA'), pg_temp.id('lA2'), 'OUTBOUND', 'BOOKING_CLOSE', 'COMPLETE', 'proof:a2:1', '+447700900102', '+447700900001', 'fake', 'pa2'),
       (pg_temp.id('cB'), pg_temp.id('bB'), pg_temp.id('lB'), 'OUTBOUND', 'QUALIFICATION', 'COMPLETE', 'proof:b:1', '+447700900103', '+447700900002', 'fake', 'pb1');
insert into public.voice_call_events (business_id, voice_call_id, provider, event_type, dedupe_key, applied)
select business_id, id, 'fake', 'call_ended', call_key || ':ended', true from public.voice_calls
 where id in (pg_temp.id('cA'), pg_temp.id('cA2'), pg_temp.id('cB'));
insert into public.voice_call_eligibility (business_id, lead_id, voice_call_id, decision, call_kind, consent_basis, consent_evidence, policy_version)
select business_id, lead_id, id, 'ALLOWED', 'AI_AUTOMATED', 'CALL_REQUESTED', '{"wording":"Yes, call me about my enquiry"}', 'proof-v1'
  from public.voice_calls where id in (pg_temp.id('cA'), pg_temp.id('cA2'), pg_temp.id('cB'));
insert into public.voice_call_transcripts (voice_call_id, business_id, segments, object_key)
select id, business_id, '[{"speaker":"lead","text":"my name is Jane"}]',
       'voice/transcripts/' || business_id || '/' || id || '.json'
  from public.voice_calls where id in (pg_temp.id('cA'), pg_temp.id('cA2'), pg_temp.id('cB'));
insert into public.voice_call_recordings (business_id, voice_call_id, provider, provider_recording_id, status, object_key, content_type, stored_at)
select business_id, id, 'fake', 'rec-' || call_key, 'STORED',
       'voice/recordings/' || business_id || '/' || id || '/call.mp3', 'audio/mpeg', now()
  from public.voice_calls where id in (pg_temp.id('cA'), pg_temp.id('cA2'), pg_temp.id('cB'));
insert into public.voice_call_outcomes (voice_call_id, business_id, lead_id, disposition, summary, facts, next_action)
select id, business_id, lead_id, 'MEETING_BOOKED', 'Jane wants a demo', '{"budget":"5k"}', 'send invite'
  from public.voice_calls where id in (pg_temp.id('cA'), pg_temp.id('cA2'), pg_temp.id('cB'));
insert into public.objection_events (business_id, lead_id, channel, voice_call_id, objection_key, evidence_excerpt)
select business_id, lead_id, 'VOICE', id, 'PRICE_TOO_HIGH', 'Jane said it is too expensive'
  from public.voice_calls where id in (pg_temp.id('cA'), pg_temp.id('cA2'), pg_temp.id('cB'));

select pg_temp.tenant_isolated('0150', array[
  'voice_settings', 'business_numbers', 'number_provisioning_events', 'voice_calls', 'voice_call_eligibility',
  'voice_call_events', 'voice_call_transcripts', 'voice_call_recordings', 'voice_call_outcomes', 'objection_events']);

do $t$
declare r text; r2 text;
begin
  r := pg_temp.q('authenticated', pg_temp.id('uA'), format(
    'select count(*)::text from public.voice_calls where id = %L', pg_temp.id('cB')));
  r2 := pg_temp.q('authenticated', pg_temp.id('uA'), format(
    'select count(*)::text from public.voice_call_recordings where voice_call_id = %L', pg_temp.id('cB')));
  perform pg_temp.ok('0150', 'tenant A cannot see tenant B''s call or its recording by id', r = '0' and r2 = '0',
    format('call=%s recording=%s', r, r2));
  r := pg_temp.q('authenticated', pg_temp.id('uA'), 'select count(*)::text from public.voice_calls');
  perform pg_temp.ok('0150', 'tenant A sees its own calls (not vacuous)', r = '2', 'A sees ' || r || ' calls');

  foreach r2 in array array['telephony_accounts', 'number_provisioning_details', 'voice_object_tombstones'] loop
    r := pg_temp.q('authenticated', pg_temp.id('uA'), format('select count(*)::text from public.%I', r2));
    perform pg_temp.ok('0150', r2 || ' is server-only (member gets permission denied)', r like 'ERR:42501:%', r);
  end loop;

  r := pg_temp.q('authenticated', pg_temp.id('uA'), format(
    'insert into public.voice_calls (business_id, lead_id, direction, route, call_key) values (%L, %L, ''OUTBOUND'', ''NURTURE'', ''browser'') returning id::text',
    pg_temp.id('bA'), pg_temp.id('lA')));
  perform pg_temp.ok('0150', 'a member cannot insert a call from the browser', r like 'ERR:42501:%', r);

  r := pg_temp.q('service_role', null, format(
    'insert into public.voice_calls (business_id, lead_id, direction, route, call_key) values (%L, %L, ''OUTBOUND'', ''NURTURE'', ''cross'') returning id::text',
    pg_temp.id('bA'), pg_temp.id('lB')));
  perform pg_temp.ok('0150', 'a call cannot point at another workspace''s lead', r like 'ERR:23514:%', r);

  r := pg_temp.q('service_role', null, format(
    'update public.voice_settings set calling_as_name = null where business_id = %L', pg_temp.id('bA')));
  perform pg_temp.ok('0150', 'voice cannot be enabled without the OD-1 identity', r like 'ERR:23514:%', r);

  r := pg_temp.q('service_role', null, format(
    'update public.voice_call_events set applied = false where voice_call_id = %L', pg_temp.id('cA')));
  r2 := pg_temp.q('service_role', null, format(
    'delete from public.voice_call_events where voice_call_id = %L', pg_temp.id('cA')));
  perform pg_temp.ok('0150', 'voice_call_events refuses direct UPDATE and DELETE (service role)',
    r like 'ERR:23001:%' and r2 like 'ERR:23001:%', r || ' | ' || r2);

  r := pg_temp.q('service_role', null, format(
    'update public.voice_call_eligibility set decision = ''DENIED'', denials = ''{SUPPRESSED}'' where voice_call_id = %L', pg_temp.id('cA')));
  perform pg_temp.ok('0150', 'eligibility evidence refuses direct UPDATE', r like 'ERR:23001:%', r);

  r := pg_temp.q('service_role', null, format(
    'delete from public.number_provisioning_events where business_number_id = %L', pg_temp.id('nA')));
  perform pg_temp.ok('0150', 'number_provisioning_events refuses direct DELETE', r like 'ERR:23001:%', r);

  select pg_get_constraintdef(oid) into r from pg_constraint
   where conrelid = 'public.inbox_channels'::regclass and conname = 'inbox_channels_channel_check';
  perform pg_temp.ok('0150', 'inbox_channels admits VOICE and keeps the seven existing channels',
    r like '%''VOICE''%' and r like '%''TIKTOK''%' and r like '%''EMAIL''%' and r like '%''LINKEDIN''%', r);
end
$t$;

select pg_temp.anon_denied('0150', array[
  'voice_settings', 'telephony_accounts', 'business_numbers', 'number_provisioning_details',
  'number_provisioning_events', 'voice_calls', 'voice_call_eligibility', 'voice_call_events',
  'voice_object_tombstones', 'voice_call_transcripts', 'voice_call_recordings', 'voice_call_outcomes',
  'objection_events']);

-- @@0151
insert into public.voice_minute_balances (business_id, included_remaining_sec, pack_remaining_sec)
values (pg_temp.id('bA'), 12000, 0), (pg_temp.id('bB'), 6000, 600);
insert into public.voice_minute_ledger (business_id, kind, voice_call_id, route, included_delta_sec, idempotency_key)
values (pg_temp.id('bA'), 'PERIOD_GRANT', null, null, 12000, 'proof:grant:a'),
       (pg_temp.id('bA'), 'SETTLE', pg_temp.id('cA'), 'QUALIFICATION', -120, 'voice:settle:' || pg_temp.id('cA')),
       (pg_temp.id('bB'), 'PERIOD_GRANT', null, null, 6000, 'proof:grant:b'),
       (pg_temp.id('bB'), 'SETTLE', pg_temp.id('cB'), 'QUALIFICATION', -60, 'voice:settle:' || pg_temp.id('cB'));
insert into public.voice_minute_reservations (voice_call_id, business_id, route, held_sec, from_included_sec, from_pack_sec)
values (pg_temp.id('cA'), pg_temp.id('bA'), 'QUALIFICATION', 360, 360, 0),
       (pg_temp.id('cB'), pg_temp.id('bB'), 'QUALIFICATION', 360, 300, 60);
insert into public.voice_cost_ledger (business_id, voice_call_id, provider, metric, quantity, unit_cost, total_cost, idempotency_key)
values (pg_temp.id('bA'), pg_temp.id('cA'), 'retell', 'VOICE_AI_MINUTE', 2, 0.07, 0.14, 'proof:cost:a'),
       (pg_temp.id('bB'), pg_temp.id('cB'), 'retell', 'VOICE_AI_MINUTE', 1, 0.07, 0.07, 'proof:cost:b');
insert into public.voice_route_allocations (business_id, route, percent)
values (pg_temp.id('bA'), 'QUALIFICATION', 60), (pg_temp.id('bA'), 'BOOKING_CLOSE', 40), (pg_temp.id('bB'), 'NURTURE', 50);
insert into public.voice_call_queue (business_id, voice_call_id, priority, priority_rank)
values (pg_temp.id('bA'), pg_temp.id('cA'), 'QUALIFICATION', 4), (pg_temp.id('bB'), pg_temp.id('cB'), 'BOOKING_CLOSE', 2);

select pg_temp.tenant_isolated('0151', array['voice_minute_balances', 'voice_minute_ledger', 'voice_route_allocations']);

do $t$
declare r text; r2 text; t text;
begin
  foreach t in array array['voice_minute_reservations', 'voice_cost_ledger', 'voice_call_queue'] loop
    r := pg_temp.q('authenticated', pg_temp.id('uA'), format('select count(*)::text from public.%I', t));
    perform pg_temp.ok('0151', t || ' is server-only (member gets permission denied)', r like 'ERR:42501:%', r);
  end loop;

  r := pg_temp.q('service_role', null, format(
    'update public.voice_minute_ledger set included_delta_sec = 0 where business_id = %L', pg_temp.id('bA')));
  r2 := pg_temp.q('service_role', null, format(
    'delete from public.voice_minute_ledger where business_id = %L', pg_temp.id('bA')));
  perform pg_temp.ok('0151', 'voice_minute_ledger refuses direct UPDATE and DELETE (service role)',
    r like 'ERR:23001:%' and r2 like 'ERR:23001:%', r || ' | ' || r2);

  r := pg_temp.q('service_role', null, 'update public.voice_cost_ledger set total_cost = 0 where idempotency_key = ''proof:cost:a''');
  r2 := pg_temp.q('service_role', null, 'delete from public.voice_cost_ledger where idempotency_key = ''proof:cost:a''');
  perform pg_temp.ok('0151', 'voice_cost_ledger refuses direct UPDATE and DELETE (service role)',
    r like 'ERR:23001:%' and r2 like 'ERR:23001:%', r || ' | ' || r2);

  r := pg_temp.q('service_role', null, format(
    'insert into public.voice_route_allocations (business_id, route, percent) values (%L, ''NURTURE'', 10)', pg_temp.id('bA')));
  perform pg_temp.ok('0151', 'route allocations cannot add up to more than 100 percent', r like 'ERR:23514:%', r);

  r := pg_temp.q('service_role', null, format(
    'update public.voice_call_queue set priority_rank = 0 where voice_call_id = %L', pg_temp.id('cA')));
  perform pg_temp.ok('0151', 'queue rank must match its priority', r like 'ERR:23514:%', r);

  select count(*)::text || ' rows, max hard_limit ' || coalesce(max(hard_limit), -1)::text into r
    from public.plan_entitlements where metric in ('voice_sales_enabled', 'voice_minutes_included');
  perform pg_temp.ok('0151', 'voice capability metrics exist on all 5 plans at 0',
    r = '10 rows, max hard_limit 0.0000' or r = '10 rows, max hard_limit 0', r);
end
$t$;

select pg_temp.anon_denied('0151', array[
  'voice_minute_balances', 'voice_minute_ledger', 'voice_minute_reservations', 'voice_cost_ledger',
  'voice_route_allocations', 'voice_call_queue']);

-- @@0152
insert into fx (k) values ('iA'), ('iB'), ('kB');
insert into public.quote_settings (business_id, vat_registered, vat_number, legal_name)
values (pg_temp.id('bA'), true, 'GB123456789', 'Acme Ltd'), (pg_temp.id('bB'), false, null, 'Beta Ltd');
insert into public.catalogue_items (id, business_id, key, name, currency, charge_type, unit, unit_price_minor, cost_price_minor, vat_rate, options)
values (pg_temp.id('iA'), pg_temp.id('bA'), 'build', 'Website build', 'GBP', 'ONE_OFF', 'project', 10000, 777, 'STANDARD',
        '[{"id":"rush","name":"Rush","unitPriceDeltaMinor":500,"unitCostDeltaMinor":123}]'),
       (pg_temp.id('iB'), pg_temp.id('bB'), 'retainer', 'Retainer', 'GBP', 'ONE_OFF', 'month', 5000, 888, 'STANDARD', '[]');
insert into public.catalogue_price_tiers (business_id, item_id, position, up_to, unit_price_minor)
values (pg_temp.id('bA'), pg_temp.id('iA'), 0, 10, 9000), (pg_temp.id('bB'), pg_temp.id('iB'), 0, 10, 4500);
insert into public.catalogue_bundles (id, business_id, key, name, currency, pricing_type, percent_off_bps)
values (pg_temp.id('kB'), pg_temp.id('bB'), 'bundle', 'Bundle', 'GBP', 'PERCENT_OFF', 1000);
insert into public.catalogue_bundle_items (bundle_id, item_id, business_id, position, quantity)
values (pg_temp.id('kB'), pg_temp.id('iB'), pg_temp.id('bB'), 0, 1);

select pg_temp.tenant_isolated('0152', array[
  'quote_settings', 'catalogue_items', 'catalogue_price_tiers', 'catalogue_bundles', 'catalogue_bundle_items']);

do $t$
declare r text; r2 text; r3 text;
begin
  r := pg_temp.q('authenticated', pg_temp.id('uA'), 'select cost_price_minor::text from public.catalogue_items limit 1');
  r2 := pg_temp.q('authenticated', pg_temp.id('uA'), 'select options::text from public.catalogue_items limit 1');
  r3 := pg_temp.q('authenticated', pg_temp.id('uA'), 'select name from public.catalogue_items limit 1');
  perform pg_temp.ok('0152', 'members cannot read catalogue cost or cost-bearing options, but can read the item',
    r like 'ERR:42501:%' and r2 like 'ERR:42501:%' and r3 = 'Website build', r || ' | ' || r2 || ' | name=' || r3);

  r := pg_temp.q('authenticated', pg_temp.id('uA'), 'select count(*)::text from public.document_counters');
  perform pg_temp.ok('0152', 'document_counters is server-only', r like 'ERR:42501:%', r);

  r := pg_temp.q('service_role', null, format('select public.allocate_document_number(%L, ''QUOTE'')', pg_temp.id('bA')));
  r2 := pg_temp.q('service_role', null, format('select public.allocate_document_number(%L, ''QUOTE'')', pg_temp.id('bA')));
  r3 := pg_temp.q('authenticated', pg_temp.id('uA'), format('select public.allocate_document_number(%L, ''QUOTE'')', pg_temp.id('bA')));
  perform pg_temp.ok('0152', 'numbers allocate in sequence for the service role and never for a browser user',
    r = 'Q-00001' and r2 = 'Q-00002' and r3 like 'ERR:42501:%', r || ', ' || r2 || ' | browser: ' || r3);

  r := pg_temp.q('service_role', null, format(
    'insert into public.catalogue_price_tiers (business_id, item_id, position, unit_price_minor) values (%L, %L, 1, 1)',
    pg_temp.id('bB'), pg_temp.id('iA')));
  perform pg_temp.ok('0152', 'a price tier cannot attach to another workspace''s item', r like 'ERR:23503:%', r);
end
$t$;

select pg_temp.anon_denied('0152', array[
  'quote_settings', 'document_counters', 'catalogue_items', 'catalogue_price_tiers', 'catalogue_bundles', 'catalogue_bundle_items']);

-- @@0153
insert into fx (k) values ('qA'), ('rA1'), ('qA2'), ('rA2'), ('qB'), ('rB1');

-- Tenant A, quote qA: built as a DRAFT, frozen, then moved by quote_transition.
insert into public.quotes (id, business_id, opportunity_id, number, title, currency, created_by_kind)
values (pg_temp.id('qA'), pg_temp.id('bA'), pg_temp.id('oA'), 'Q-PROOF-A1', 'Website for Jane', 'GBP', 'HUMAN');
insert into public.quote_revisions (id, business_id, quote_id, revision_no, calc_input, calculation, calc_version,
  calculation_hash, one_off_gross_minor, total_net_minor, total_vat_minor, total_gross_minor, first_payment_minor,
  margin_bps, internal_note, ai_rationale, valid_until, created_by_kind)
values (pg_temp.id('rA1'), pg_temp.id('bA'), pg_temp.id('qA'), 1,
  '{"catalogue":[{"key":"build","costPriceMinor":777}]}', '{"margin":{"marginBps":4200,"costMinor":777}}',
  'quote-calc/1', repeat('a', 64), 12000, 10000, 2000, 12000, 12000, 4200, 'SECRET-NOTE', 'SECRET-AI-RATIONALE',
  now() + interval '10 days', 'HUMAN');
update public.quotes set current_revision_id = pg_temp.id('rA1') where id = pg_temp.id('qA');
insert into public.quote_line_items (business_id, revision_id, position, line_key, source_line_key, item_id, item_key,
  description, unit, charge_type, quantity_milli, unit_price_minor, list_minor, net_minor, vat_rate, vat_bps, vat_minor,
  gross_minor, cost_minor, margin_minor)
values (pg_temp.id('bA'), pg_temp.id('rA1'), 0, 'l1', 'l1', null, 'build', 'Website build', 'project', 'ONE_OFF', 1000,
  10000, 10000, 10000, 'STANDARD', 2000, 2000, 12000, 777, 9223);
update public.quote_revisions
   set render_model = '{"quote":{"number":"Q-PROOF-A1","revision":1},"seller":{"name":"Acme"},"buyer":{"name":"Jane Buyer","company":"Buyer Ltd","email":"jane@buyer.invalid","address":["1 Road"]},"totals":{"grossMinor":12000},"poweredBy":true}',
       render_hash = repeat('b', 64), frozen_at = now()
 where id = pg_temp.id('rA1');

create temp table tok (k text primary key, raw text not null);
insert into tok values
  ('valid',   'proofValidToken_' || repeat('V', 27)),
  ('expired', 'proofExpiredTok_' || repeat('E', 27)),
  ('revoked', 'proofRevokedTok_' || repeat('R', 27)),
  ('wrong',   'proofWrongToken_' || repeat('W', 27));
insert into public.quote_access_tokens (business_id, quote_id, revision_id, token_hash, expires_at, revoked_at)
select pg_temp.id('bA'), pg_temp.id('qA'), pg_temp.id('rA1'),
       encode(extensions.digest(convert_to(raw, 'UTF8'), 'sha256'), 'hex'),
       case k when 'expired' then now() - interval '1 hour' else now() + interval '7 days' end,
       case k when 'revoked' then now() else null end
  from tok where k in ('valid', 'expired', 'revoked');

-- Tenant A, quote qA2 on the lead that @@act anonymises: signed directly.
insert into public.quotes (id, business_id, opportunity_id, number, title, currency, created_by_kind)
values (pg_temp.id('qA2'), pg_temp.id('bA'), pg_temp.id('oA2'), 'Q-PROOF-A2', 'Proposal for Jane Two', 'GBP', 'AI');
insert into public.quote_revisions (id, business_id, quote_id, revision_no, calc_input, calculation, calc_version,
  calculation_hash, one_off_gross_minor, total_net_minor, total_vat_minor, total_gross_minor, first_payment_minor,
  internal_note, ai_rationale, created_by_kind)
values (pg_temp.id('rA2'), pg_temp.id('bA'), pg_temp.id('qA2'), 1, '{}', '{}', 'quote-calc/1', repeat('a', 64),
  6000, 5000, 1000, 6000, 6000, 'note about Jane Two', 'AI thinks Jane Two will buy', 'AI');
update public.quotes set current_revision_id = pg_temp.id('rA2'), status = 'SIGNED' where id = pg_temp.id('qA2');
update public.quote_revisions
   set render_model = '{"buyer":{"name":"Jane Two","company":"Two Ltd","email":"two@buyer.invalid","address":["2 Road"]}}',
       render_hash = repeat('e', 64), frozen_at = now(), status = 'SIGNED', signed_at = now()
 where id = pg_temp.id('rA2');
insert into public.quote_signatures (business_id, quote_id, revision_id, document_hash, calculation_hash, signer_name,
  signer_email, method, typed_name, consent_given, consent_text, consent_sha256, consent_version, ip, user_agent,
  signed_at, audit_trail, record_hash)
values (pg_temp.id('bA'), pg_temp.id('qA2'), pg_temp.id('rA2'), repeat('e', 64), repeat('a', 64), 'Jane Two',
  'two@buyer.invalid', 'TYPED', 'Jane Two', true, 'I agree to sign this quote electronically.', repeat('c', 64), 'v1',
  '203.0.113.9', 'ProofAgent/1', now(), '[]', repeat('d', 64));
insert into public.quote_acceptance_events (business_id, quote_id, revision_id, action, document_hash, actor_email, ip, user_agent)
values (pg_temp.id('bA'), pg_temp.id('qA2'), pg_temp.id('rA2'), 'ACCEPT', repeat('e', 64), 'two@buyer.invalid', '203.0.113.9', 'ProofAgent/1');
insert into public.quote_access_tokens (business_id, quote_id, revision_id, token_hash, expires_at)
values (pg_temp.id('bA'), pg_temp.id('qA2'), pg_temp.id('rA2'), repeat('f', 64), now() + interval '7 days');

-- Tenant B, quote qB: signed, with events, approval, token, acceptance (for the cascade).
insert into public.quotes (id, business_id, opportunity_id, number, title, currency, created_by_kind)
values (pg_temp.id('qB'), pg_temp.id('bB'), pg_temp.id('oB'), 'Q-PROOF-B1', 'Retainer for Bob', 'GBP', 'HUMAN');
insert into public.quote_revisions (id, business_id, quote_id, revision_no, calc_input, calculation, calc_version,
  calculation_hash, one_off_gross_minor, total_net_minor, total_vat_minor, total_gross_minor, first_payment_minor, created_by_kind)
values (pg_temp.id('rB1'), pg_temp.id('bB'), pg_temp.id('qB'), 1, '{}', '{}', 'quote-calc/1', repeat('a', 64),
  6000, 6000, 0, 6000, 6000, 'HUMAN');
insert into public.quote_line_items (business_id, revision_id, position, line_key, source_line_key, item_key,
  description, unit, charge_type, quantity_milli, list_minor, net_minor, vat_rate, vat_bps, vat_minor, gross_minor, cost_minor)
values (pg_temp.id('bB'), pg_temp.id('rB1'), 0, 'l1', 'l1', 'retainer', 'Retainer', 'month', 'ONE_OFF', 1000, 6000, 6000,
  'ZERO', 0, 0, 6000, 888);
update public.quotes set current_revision_id = pg_temp.id('rB1'), status = 'SIGNED' where id = pg_temp.id('qB');
update public.quote_revisions
   set render_model = '{"buyer":{"name":"Bob"}}', render_hash = repeat('9', 64), frozen_at = now(), status = 'SIGNED', signed_at = now()
 where id = pg_temp.id('rB1');
insert into public.quote_signatures (business_id, quote_id, revision_id, document_hash, calculation_hash, signer_name,
  method, typed_name, consent_given, consent_text, consent_sha256, consent_version, signed_at, audit_trail, record_hash)
values (pg_temp.id('bB'), pg_temp.id('qB'), pg_temp.id('rB1'), repeat('9', 64), repeat('a', 64), 'Bob', 'TYPED', 'Bob',
  true, 'I agree to sign this quote electronically.', repeat('c', 64), 'v1', now(), '[]', repeat('d', 64));
insert into public.quote_events (business_id, quote_id, revision_id, event_type, actor_kind)
values (pg_temp.id('bB'), pg_temp.id('qB'), pg_temp.id('rB1'), 'quote.signed', 'CUSTOMER');
insert into public.quote_acceptance_events (business_id, quote_id, revision_id, action, document_hash)
values (pg_temp.id('bB'), pg_temp.id('qB'), pg_temp.id('rB1'), 'ACCEPT', repeat('9', 64));
insert into public.quote_approvals (business_id, quote_id, revision_id, required_role, reason, decision, requested_by_kind, decided_at)
values (pg_temp.id('bB'), pg_temp.id('qB'), pg_temp.id('rB1'), 'owner', 'MANUAL', 'APPROVED', 'HUMAN', now());
insert into public.quote_access_tokens (business_id, quote_id, revision_id, token_hash, expires_at)
values (pg_temp.id('bB'), pg_temp.id('qB'), pg_temp.id('rB1'), repeat('8', 64), now() + interval '7 days');

do $t$
declare
  r text; r2 text; r3 text; v jsonb;
  k1 text := 'quote-action:v1:' || encode(extensions.digest('proof-send', 'sha256'), 'hex');
  k2 text := 'quote-action:v1:' || encode(extensions.digest('proof-view', 'sha256'), 'hex');
  k3 text := 'quote-action:v1:' || encode(extensions.digest('proof-accept', 'sha256'), 'hex');
  k4 text := 'quote-action:v1:' || encode(extensions.digest('proof-sign', 'sha256'), 'hex');
  sig jsonb;
begin
  -- DRAFT -> SENT through the function.
  r := pg_temp.q('service_role', null, format(
    'select public.quote_transition(%L, %L, ''SEND'', ''DRAFT'', ''HUMAN'', %L)::text', pg_temp.id('bA'), pg_temp.id('qA'), k1));
  perform pg_temp.ok('0153', 'quote_transition sends a frozen draft (DRAFT -> SENT)', r::jsonb ->> 'to' = 'SENT', r);

  -- Public view: valid token -> customer fields only; wrong / expired / revoked / malformed -> nothing.
  r := pg_temp.q('anon', null, format('select public.quote_public_view(%L)::text', (select raw from tok where k = 'valid')));
  v := case when r like 'ERR:%' or r = 'NULL' then null else r::jsonb end;
  perform pg_temp.ok('0153', 'quote_public_view (anon, valid token) returns exactly the customer-facing keys',
    v is not null and (select array_agg(key order by key) from jsonb_object_keys(v) key)
      = array['can_sign', 'render_hash', 'render_model', 'revision_id', 'status', 'valid_until'],
    coalesce((select string_agg(key, ',' order by key) from jsonb_object_keys(v) key), r));
  perform pg_temp.ok('0153', 'quote_public_view leaks no cost, margin, internal note, AI rationale or calculation',
    v is not null and r not like '%SECRET%' and r not like '%777%' and r not like '%4200%' and r not ilike '%margin%'
      and r not ilike '%cost%' and r not like '%calc_input%',
    'status=' || coalesce(v ->> 'status', '?') || ' can_sign=' || coalesce(v ->> 'can_sign', '?'));
  r := pg_temp.q('anon', null, format('select public.quote_public_view(%L)::text', (select raw from tok where k = 'wrong')));
  r2 := pg_temp.q('anon', null, format('select public.quote_public_view(%L)::text', (select raw from tok where k = 'expired')));
  r3 := pg_temp.q('anon', null, format('select public.quote_public_view(%L)::text', (select raw from tok where k = 'revoked')));
  perform pg_temp.ok('0153', 'quote_public_view returns nothing for a wrong, expired or revoked token',
    r = 'NULL' and r2 = 'NULL' and r3 = 'NULL', format('wrong=%s expired=%s revoked=%s', r, r2, r3));
  r := pg_temp.q('anon', null, format('select public.quote_public_view(%L)::text', encode(extensions.digest((select raw from tok where k = 'valid'), 'sha256'), 'hex')));
  r2 := pg_temp.q('anon', null, 'select public.quote_public_view(''short'')::text');
  perform pg_temp.ok('0153', 'quote_public_view refuses the stored hash itself and a malformed token',
    r = 'NULL' and r2 = 'NULL', format('hash-as-token=%s malformed=%s', r, r2));
  select view_count::text into r from public.quote_access_tokens
   where token_hash = encode(extensions.digest(convert_to((select raw from tok where k = 'valid'), 'UTF8'), 'sha256'), 'hex');
  perform pg_temp.ok('0153', 'the token is matched by its SHA-256 (view counted once)', r = '1', 'view_count=' || r);

  -- Browser access.
  r := pg_temp.q('authenticated', pg_temp.id('uB'), format('select count(*)::text from public.quotes where id = %L', pg_temp.id('qA')));
  r2 := pg_temp.q('authenticated', pg_temp.id('uA'), format('select count(*)::text from public.quotes where id = %L', pg_temp.id('qA')));
  perform pg_temp.ok('0153', 'tenant B cannot see tenant A''s quote; tenant A can', r = '0' and r2 = '1', format('B=%s A=%s', r, r2));
  r := pg_temp.q('authenticated', pg_temp.id('uA'), 'select internal_note from public.quote_revisions limit 1');
  r2 := pg_temp.q('authenticated', pg_temp.id('uA'), 'select calculation::text from public.quote_revisions limit 1');
  r3 := pg_temp.q('authenticated', pg_temp.id('uA'), 'select cost_minor::text from public.quote_line_items limit 1');
  perform pg_temp.ok('0153', 'members cannot read internal note, calculation (margin) or line cost',
    r like 'ERR:42501:%' and r2 like 'ERR:42501:%' and r3 like 'ERR:42501:%', r || ' | ' || r2 || ' | ' || r3);
  r := pg_temp.q('authenticated', pg_temp.id('uA'), 'select ai_rationale from public.quote_revisions limit 1');
  r2 := pg_temp.q('authenticated', pg_temp.id('uA'), 'select margin_bps::text from public.quote_revisions limit 1');
  r3 := pg_temp.q('authenticated', pg_temp.id('uA'), format('select render_hash from public.quote_revisions where id = %L', pg_temp.id('rA1')));
  perform pg_temp.ok('0153', 'members cannot read AI rationale or margin, but can read customer fields',
    r like 'ERR:42501:%' and r2 like 'ERR:42501:%' and r3 = repeat('b', 64), r || ' | ' || r2 || ' | render_hash ok=' || (r3 = repeat('b', 64))::text);
  r := pg_temp.q('authenticated', pg_temp.id('uA'), 'select count(*)::text from public.quote_access_tokens');
  perform pg_temp.ok('0153', 'quote_access_tokens is server-only', r like 'ERR:42501:%', r);
  r := pg_temp.q('authenticated', pg_temp.id('uA'), format(
    'select public.quote_transition(%L, %L, ''MARK_VIEWED'', ''SENT'', ''HUMAN'')::text', pg_temp.id('bA'), pg_temp.id('qA')));
  r2 := pg_temp.q('anon', null, format(
    'select public.quote_record_signature(%L, %L, %L, ''ACCEPTED'', null, ''{}'')::text', pg_temp.id('bA'), pg_temp.id('qA'), pg_temp.id('rA1')));
  perform pg_temp.ok('0153', 'browser roles cannot execute quote_transition or quote_record_signature',
    r like 'ERR:42501:%' and r2 like 'ERR:42501:%', r || ' | ' || r2);

  -- Transition refusals.
  r := pg_temp.q('service_role', null, format(
    'select public.quote_transition(%L, %L, ''MARK_VIEWED'', ''SENT'', ''SYSTEM'')::text', pg_temp.id('bB'), pg_temp.id('qA')));
  perform pg_temp.ok('0153', 'quote_transition refuses another tenant''s quote', r::jsonb ->> 'reason' = 'NOT_FOUND', r);
  r := pg_temp.q('service_role', null, format(
    'select public.quote_transition(%L, %L, ''MARK_VIEWED'', ''DRAFT'', ''SYSTEM'')::text', pg_temp.id('bA'), pg_temp.id('qA')));
  perform pg_temp.ok('0153', 'quote_transition refuses a stale expected status', r::jsonb ->> 'reason' = 'STALE', r);
  r := pg_temp.q('service_role', null, format(
    'select public.quote_transition(%L, %L, ''MARK_VIEWED'', ''SENT'', ''SYSTEM'', %L)::text', pg_temp.id('bA'), pg_temp.id('qA'), k2));
  r2 := pg_temp.q('service_role', null, format(
    'select public.quote_transition(%L, %L, ''ACCEPT'', ''VIEWED'', ''AI'')::text', pg_temp.id('bA'), pg_temp.id('qA')));
  r3 := pg_temp.q('service_role', null, format(
    'select public.quote_transition(%L, %L, ''ACCEPT'', ''VIEWED'', ''CUSTOMER'', %L)::text', pg_temp.id('bA'), pg_temp.id('qA'), k3));
  perform pg_temp.ok('0153', 'SENT -> VIEWED; the AI may not accept; the customer accepts (VIEWED -> ACCEPTED)',
    r::jsonb ->> 'to' = 'VIEWED' and r2::jsonb ->> 'reason' = 'ACTOR_NOT_PERMITTED' and r3::jsonb ->> 'to' = 'ACCEPTED',
    r || ' | ' || r2 || ' | ' || r3);
  r := pg_temp.q('service_role', null, format(
    'select public.quote_transition(%L, %L, ''SIGN'', ''ACCEPTED'', ''CUSTOMER'')::text', pg_temp.id('bA'), pg_temp.id('qA')));
  perform pg_temp.ok('0153', 'SIGN cannot bypass the signature function', r::jsonb ->> 'reason' = 'USE_SIGNATURE_FUNCTION', r);

  -- Signing.
  sig := jsonb_build_object(
    'document_hash', repeat('b', 64), 'calculation_hash', repeat('a', 64), 'signer_name', 'Jane Buyer',
    'signer_email', 'jane@buyer.invalid', 'method', 'TYPED', 'typed_name', 'Jane Buyer', 'consent_given', true,
    'consent_text', 'I agree to sign this quote electronically.', 'consent_sha256', repeat('c', 64),
    'consent_version', 'v1', 'ip', '203.0.113.5', 'user_agent', 'ProofAgent/1', 'signed_at', now(),
    'audit_trail', '[]'::jsonb, 'record_hash', repeat('d', 64));
  r := pg_temp.q('service_role', null, format(
    'select public.quote_record_signature(%L, %L, %L, ''ACCEPTED'', %L, %L)::text', pg_temp.id('bB'), pg_temp.id('qA'), pg_temp.id('rA1'), k4, sig));
  perform pg_temp.ok('0153', 'quote_record_signature refuses another tenant''s quote', r::jsonb ->> 'reason' = 'NOT_FOUND', r);
  r := pg_temp.q('service_role', null, format(
    'select public.quote_record_signature(%L, %L, %L, ''VIEWED'', %L, %L)::text', pg_temp.id('bA'), pg_temp.id('qA'), pg_temp.id('rA1'), k4, sig));
  perform pg_temp.ok('0153', 'quote_record_signature refuses a stale expected status', r::jsonb ->> 'reason' = 'STALE', r);
  r := pg_temp.q('service_role', null, format(
    'select public.quote_record_signature(%L, %L, %L, ''ACCEPTED'', %L, %L)::text', pg_temp.id('bA'), pg_temp.id('qA'), pg_temp.id('rA1'), k4,
    sig || jsonb_build_object('document_hash', repeat('0', 64))));
  perform pg_temp.ok('0153', 'quote_record_signature refuses a signature over a different document',
    r::jsonb ->> 'reason' = 'DOCUMENT_HASH_MISMATCH', r);
  r := pg_temp.q('service_role', null, format(
    'select public.quote_record_signature(%L, %L, %L, ''ACCEPTED'', %L, %L)::text', pg_temp.id('bA'), pg_temp.id('qA'), pg_temp.id('rA1'), k4, sig));
  r2 := pg_temp.q('service_role', null, format(
    'select public.quote_record_signature(%L, %L, %L, ''ACCEPTED'', %L, %L)::text', pg_temp.id('bA'), pg_temp.id('qA'), pg_temp.id('rA1'), k4, sig));
  perform pg_temp.ok('0153', 'a valid signature moves ACCEPTED -> SIGNED; a replay is an idempotent duplicate',
    r::jsonb ->> 'to' = 'SIGNED' and (r2::jsonb ->> 'duplicate')::boolean, r || ' | ' || r2);

  -- Signed revision immutability (service role, direct statements).
  r := pg_temp.q('service_role', null, format('update public.quote_revisions set internal_note = ''edited'' where id = %L', pg_temp.id('rA1')));
  r2 := pg_temp.q('service_role', null, format('update public.quote_revisions set total_net_minor = 1, total_gross_minor = 2001 where id = %L', pg_temp.id('rA1')));
  r3 := pg_temp.q('service_role', null, format('update public.quote_revisions set status = ''DRAFT'' where id = %L', pg_temp.id('rA1')));
  perform pg_temp.ok('0153', 'a signed revision cannot be updated (note, amounts, status back)',
    r like 'ERR:23001:%' and r2 like 'ERR:23001:%' and r3 like 'ERR:23001:%', r || ' | ' || r2 || ' | ' || r3);
  r := pg_temp.q('service_role', null, format('update public.quote_revisions set render_model = ''{}'' where id = %L', pg_temp.id('rA1')));
  r2 := pg_temp.q('service_role', null, format('delete from public.quote_revisions where id = %L', pg_temp.id('rA1')));
  r3 := pg_temp.q('service_role', null, format('delete from public.quotes where id = %L', pg_temp.id('qA')));
  perform pg_temp.ok('0153', 'the frozen render model cannot change; a signed revision or sent quote cannot be deleted',
    r like 'ERR:23001:%' and r2 like 'ERR:23001:%' and r3 like 'ERR:23001:%', r || ' | ' || r2 || ' | ' || r3);
  r := pg_temp.q('service_role', null, format('update public.quote_line_items set net_minor = 1 where revision_id = %L', pg_temp.id('rA1')));
  r2 := pg_temp.q('service_role', null, format(
    'insert into public.quote_line_items (business_id, revision_id, position, line_key, source_line_key, item_key, description, unit, charge_type, quantity_milli, list_minor, net_minor, vat_rate, vat_bps, vat_minor, gross_minor) values (%L, %L, 1, ''l2'', ''l2'', ''x'', ''x'', ''x'', ''ONE_OFF'', 1000, 1, 1, ''ZERO'', 0, 0, 1)',
    pg_temp.id('bA'), pg_temp.id('rA1')));
  r3 := pg_temp.q('service_role', null, format('update public.quote_signatures set signer_name = ''forged'' where quote_id = %L', pg_temp.id('qA')));
  perform pg_temp.ok('0153', 'lines of a sent revision and the signature itself are immutable',
    r like 'ERR:23001:%' and r2 like 'ERR:23001:%' and r3 like 'ERR:23001:%', r || ' | ' || r2 || ' | ' || r3);
  r := pg_temp.q('service_role', null, format('delete from public.quote_events where quote_id = %L', pg_temp.id('qA')));
  perform pg_temp.ok('0153', 'quote_events refuses direct DELETE', r like 'ERR:23001:%', r);
  r := pg_temp.q('service_role', null, format(
    'select public.quote_transition(%L, %L, ''RECORD_DEPOSIT_PAID'', ''SIGNED'', ''SYSTEM'')::text', pg_temp.id('bA'), pg_temp.id('qA')));
  perform pg_temp.ok('0153', 'after signing only the post-signature status moves (SIGNED -> DEPOSIT_PAID)', r::jsonb ->> 'to' = 'DEPOSIT_PAID', r);

  r := pg_temp.q('service_role', null, format(
    'insert into public.quotes (business_id, opportunity_id, number, title, currency, created_by_kind) values (%L, %L, ''Q-X'', ''x'', ''GBP'', ''HUMAN'')',
    pg_temp.id('bA'), pg_temp.id('oB')));
  perform pg_temp.ok('0153', 'a quote cannot attach to another workspace''s opportunity', r like 'ERR:23514:%', r);
end
$t$;

select pg_temp.tenant_isolated('0153', array[
  'quotes', 'quote_revisions', 'quote_line_items', 'quote_approvals', 'quote_signatures', 'quote_events', 'quote_acceptance_events']);

select pg_temp.anon_denied('0153', array[
  'quotes', 'quote_revisions', 'quote_line_items', 'quote_approvals', 'quote_access_tokens',
  'quote_signatures', 'quote_events', 'quote_acceptance_events']);

-- @@0154
insert into fx (k) values ('invA'), ('invA2'), ('invB');

insert into public.payment_schedules (business_id, quote_id, revision_id, seq, kind, due_rule, gross_minor, net_minor, vat_minor)
values (pg_temp.id('bA'), pg_temp.id('qA'), pg_temp.id('rA1'), 1, 'FULL', '{"type":"ON_ACCEPTANCE"}', 12000, 10000, 2000),
       (pg_temp.id('bB'), pg_temp.id('qB'), pg_temp.id('rB1'), 1, 'FULL', '{"type":"ON_ACCEPTANCE"}', 6000, 6000, 0);
insert into public.invoices (id, business_id, opportunity_id, quote_id, revision_id, kind, currency, vat_registered, seller, buyer,
  net_minor, vat_minor, total_minor, idempotency_key)
values
  (pg_temp.id('invA'), pg_temp.id('bA'), pg_temp.id('oA'), pg_temp.id('qA'), pg_temp.id('rA1'), 'FULL', 'GBP', true,
   '{"name":"Acme Ltd"}', '{"name":"Buyer Ltd","address":["1 Road"],"email":"jane@buyer.invalid"}', 10000, 2000, 12000,
   'invoice:v1:' || repeat('1', 64)),
  (pg_temp.id('invA2'), pg_temp.id('bA'), pg_temp.id('oA2'), pg_temp.id('qA2'), pg_temp.id('rA2'), 'FULL', 'GBP', true,
   '{"name":"Acme Ltd"}', '{"name":"Two Ltd","address":["2 Road"],"email":"two@buyer.invalid","contactName":"Jane Two"}', 5000, 1000, 6000,
   'invoice:v1:' || repeat('2', 64)),
  (pg_temp.id('invB'), pg_temp.id('bB'), pg_temp.id('oB'), pg_temp.id('qB'), pg_temp.id('rB1'), 'FULL', 'GBP', false,
   '{"name":"Beta Ltd"}', '{"name":"Bob Ltd","address":["3 Road"]}', 6000, 0, 6000, 'invoice:v1:' || repeat('3', 64));
insert into public.invoice_items (business_id, invoice_id, position, description, quantity_milli, net_minor, vat_rate, vat_bps, vat_minor, gross_minor)
values (pg_temp.id('bA'), pg_temp.id('invA'), 0, 'Website build', 1000, 10000, 'STANDARD', 2000, 2000, 12000),
       (pg_temp.id('bA'), pg_temp.id('invA2'), 0, 'Proposal', 1000, 5000, 'STANDARD', 2000, 1000, 6000),
       (pg_temp.id('bB'), pg_temp.id('invB'), 0, 'Retainer', 1000, 6000, 'ZERO', 0, 0, 6000);
update public.invoices
   set status = 'OPEN', number = 'INV-PROOF-' || right(id::text, 6), issue_date = current_date, due_date = current_date + 14
 where id in (pg_temp.id('invA'), pg_temp.id('invA2'), pg_temp.id('invB'));
-- Tenant B: paid, credited, reminded (for the cascade).
insert into public.invoice_payments (business_id, invoice_id, provider, external_payment_id, amount_minor, received_at)
values (pg_temp.id('bB'), pg_temp.id('invB'), 'manual', 'proof-b-pay', 6000, now());
insert into public.credit_notes (business_id, invoice_id, number, amount_minor, net_minor, vat_minor, reason, idempotency_key)
values (pg_temp.id('bB'), pg_temp.id('invB'), 'CN-PROOF-B1', 1000, 1000, 0, 'goodwill', 'credit-note:v1:' || repeat('3', 64));
insert into public.invoice_reminders (invoice_id, business_id, step, outcome)
values (pg_temp.id('invB'), pg_temp.id('bB'), 1, 'SENT');
update public.payment_schedules set invoice_id = pg_temp.id('invB'), status = 'PAID' where business_id = pg_temp.id('bB');

do $t$
declare r text; r2 text; r3 text;
begin
  r := pg_temp.q('service_role', null, format(
    'insert into public.invoice_payments (business_id, invoice_id, provider, external_payment_id, amount_minor, received_at) values (%L, %L, ''manual'', ''proof-a-pay-1'', 5000, now()) returning id::text',
    pg_temp.id('bA'), pg_temp.id('invA')));
  select status || ' paid=' || paid_minor into r2 from public.invoices where id = pg_temp.id('invA');
  perform pg_temp.ok('0154', 'a payment moves paid_minor and status (OPEN -> PARTIALLY_PAID)',
    r not like 'ERR:%' and r2 = 'PARTIALLY_PAID paid=5000', r2);

  r := pg_temp.q('service_role', null, format(
    'insert into public.credit_notes (business_id, invoice_id, number, amount_minor, net_minor, vat_minor, reason, idempotency_key) values (%L, %L, ''CN-PROOF-A1'', 3000, 2500, 500, ''partial refund'', %L) returning id::text',
    pg_temp.id('bA'), pg_temp.id('invA'), 'credit-note:v1:' || repeat('a', 64)));
  r2 := pg_temp.q('service_role', null, format(
    'insert into public.credit_notes (business_id, invoice_id, number, amount_minor, net_minor, vat_minor, reason, idempotency_key) values (%L, %L, ''CN-PROOF-A2'', 2500, 2500, 0, ''too much'', %L) returning id::text',
    pg_temp.id('bA'), pg_temp.id('invA'), 'credit-note:v1:' || repeat('b', 64)));
  r3 := pg_temp.q('service_role', null, format(
    'insert into public.credit_notes (business_id, invoice_id, number, amount_minor, net_minor, vat_minor, reason, idempotency_key) values (%L, %L, ''CN-PROOF-A3'', 2000, 2000, 0, ''the rest'', %L) returning id::text',
    pg_temp.id('bA'), pg_temp.id('invA'), 'credit-note:v1:' || repeat('c', 64)));
  perform pg_temp.ok('0154', 'credit notes cannot exceed the amount paid (3000 ok, then 2500 of the 2000 left refused, 2000 ok)',
    r not like 'ERR:%' and r2 like 'ERR:23514:%' and r3 not like 'ERR:%',
    'first=' || left(r, 8) || ' | second=' || r2 || ' | third=' || left(r3, 8)
      || ' | credited=' || (select credited_minor::text from public.invoices where id = pg_temp.id('invA')));

  r := pg_temp.q('service_role', null, format(
    'insert into public.invoice_payments (business_id, invoice_id, provider, external_payment_id, amount_minor, received_at) values (%L, %L, ''manual'', ''proof-a-over'', 8000, now())',
    pg_temp.id('bA'), pg_temp.id('invA')));
  perform pg_temp.ok('0154', 'an overpayment is refused', r like 'ERR:23514:%', r);

  r := pg_temp.q('service_role', null, format('update public.invoices set total_minor = 1, net_minor = 1, vat_minor = 0 where id = %L', pg_temp.id('invA')));
  r2 := pg_temp.q('service_role', null, format('delete from public.invoices where id = %L', pg_temp.id('invA')));
  r3 := pg_temp.q('service_role', null, format(
    'insert into public.invoice_items (business_id, invoice_id, position, description, quantity_milli, net_minor, vat_rate, vat_bps, vat_minor, gross_minor) values (%L, %L, 5, ''extra'', 1000, 1, ''ZERO'', 0, 0, 1)',
    pg_temp.id('bA'), pg_temp.id('invA')));
  perform pg_temp.ok('0154', 'an issued invoice cannot be edited, deleted or given new lines',
    r like 'ERR:23001:%' and r2 like 'ERR:23001:%' and r3 like 'ERR:23001:%', r || ' | ' || r2 || ' | ' || r3);
  r := pg_temp.q('service_role', null, format('update public.credit_notes set amount_minor = 1 where invoice_id = %L', pg_temp.id('invA')));
  r2 := pg_temp.q('service_role', null, format('delete from public.invoice_payments where invoice_id = %L', pg_temp.id('invA')));
  perform pg_temp.ok('0154', 'credit notes and payments are append-only', r like 'ERR:23001:%' and r2 like 'ERR:23001:%', r || ' | ' || r2);

  r := pg_temp.q('authenticated', pg_temp.id('uB'), format('select count(*)::text from public.invoices where id = %L', pg_temp.id('invA')));
  r2 := pg_temp.q('authenticated', pg_temp.id('uA'), format('select count(*)::text from public.invoices where id = %L', pg_temp.id('invA')));
  perform pg_temp.ok('0154', 'tenant B cannot see tenant A''s invoice; tenant A can', r = '0' and r2 = '1', format('B=%s A=%s', r, r2));

  r := pg_temp.q('service_role', null, format(
    'insert into public.invoices (business_id, opportunity_id, kind, currency, vat_registered, seller, buyer, net_minor, vat_minor, total_minor, idempotency_key) values (%L, %L, ''FULL'', ''GBP'', false, ''{}'', ''{}'', 1, 0, 1, %L)',
    pg_temp.id('bA'), pg_temp.id('oB'), 'invoice:v1:' || repeat('9', 64)));
  perform pg_temp.ok('0154', 'an invoice cannot attach to another workspace''s opportunity', r like 'ERR:23514:%', r);
end
$t$;

select pg_temp.tenant_isolated('0154', array[
  'payment_schedules', 'invoices', 'invoice_items', 'invoice_payments', 'credit_notes', 'invoice_reminders']);

select pg_temp.anon_denied('0154', array[
  'payment_schedules', 'invoices', 'invoice_items', 'invoice_payments', 'credit_notes', 'invoice_reminders']);

-- @@act
-- Anonymise lead A2 the way data_rights_scrub does (it sets anonymised_at),
-- then delete tenant B's whole workspace, then force every deferred FK check.
update public.leads set anonymised_at = now() where id = pg_temp.id('lA2');

do $t$
begin
  begin
    delete from public.businesses where id = pg_temp.id('bB');
    set constraints all immediate;
    perform pg_temp.ok('act', 'deleting tenant B''s workspace cascades through every new table (ledgers, signed and issued records included) and every deferred FK holds',
      not exists (select 1 from public.businesses where id = pg_temp.id('bB')), 'delete + set constraints all immediate succeeded');
  exception when others then
    perform pg_temp.ok('act', 'deleting tenant B''s workspace cascades through every new table', false, sqlstate || ': ' || sqlerrm);
  end;
end
$t$;

-- @@0150.post
do $t$
declare r text; t text; left_over text[] := '{}';
begin
  select coalesce(to_e164, 'null') into r from public.voice_calls where id = pg_temp.id('cA2');
  perform pg_temp.ok('0150.post', 'anonymise clears the callee''s number and keeps the call record', r = 'null', 'to_e164=' || r);
  select format('transcripts=%s recordings=%s tombstones=%s',
    (select count(*) from public.voice_call_transcripts where voice_call_id = pg_temp.id('cA2')),
    (select count(*) from public.voice_call_recordings where voice_call_id = pg_temp.id('cA2')),
    (select count(*) from public.voice_object_tombstones where object_key like '%' || pg_temp.id('cA2') || '%'))
    into r;
  perform pg_temp.ok('0150.post', 'anonymise removes transcript and recording rows and tombstones both R2 objects',
    r = 'transcripts=0 recordings=0 tombstones=2', r);
  select format('summary=%s facts=%s next=%s evidence=%s excerpt=%s disposition=%s',
    coalesce(o.summary, 'null'), o.facts, coalesce(o.next_action, 'null'),
    (select consent_evidence::text from public.voice_call_eligibility where voice_call_id = pg_temp.id('cA2')),
    coalesce((select evidence_excerpt from public.objection_events where voice_call_id = pg_temp.id('cA2')), 'null'),
    o.disposition)
    into r from public.voice_call_outcomes o where o.voice_call_id = pg_temp.id('cA2');
  perform pg_temp.ok('0150.post', 'anonymise clears summary, facts, consent evidence and objection excerpt; keeps the disposition',
    r = 'summary=null facts={} next=null evidence={} excerpt=null disposition=MEETING_BOOKED', r);
  select coalesce((select summary from public.voice_call_outcomes where voice_call_id = pg_temp.id('cA')), 'null') into r;
  perform pg_temp.ok('0150.post', 'another lead''s call in the same workspace is untouched', r = 'Jane wants a demo', r);
  r := pg_temp.q('service_role', null, format(
    'insert into public.voice_calls (business_id, lead_id, direction, route, call_key) values (%L, %L, ''OUTBOUND'', ''NURTURE'', ''after-anon'')',
    pg_temp.id('bA'), pg_temp.id('lA2')));
  perform pg_temp.ok('0150.post', 'no new call may be created for an anonymised lead', r like 'ERR:23514:%', r);

  foreach t in array array['voice_settings', 'telephony_accounts', 'business_numbers', 'number_provisioning_details',
    'number_provisioning_events', 'voice_calls', 'voice_call_eligibility', 'voice_call_events', 'voice_call_transcripts',
    'voice_call_recordings', 'voice_call_outcomes', 'objection_events'] loop
    execute format('select count(*)::text from public.%I where business_id = %L', t, pg_temp.id('bB')) into r;
    if r <> '0' then left_over := left_over || (t || '=' || r); end if;
  end loop;
  select count(*)::text into r from public.voice_object_tombstones where business_id = pg_temp.id('bB');
  perform pg_temp.ok('0150.post', 'tenant B''s voice rows are gone (append-only events and evidence included) and its R2 objects are tombstoned',
    cardinality(left_over) = 0 and r = '2',
    case when cardinality(left_over) = 0 then 'all 0; tombstones for B=' || r else array_to_string(left_over, ', ') end);
end
$t$;

-- @@0151.post
do $t$
declare r text; t text; left_over text[] := '{}';
begin
  foreach t in array array['voice_minute_balances', 'voice_minute_ledger', 'voice_minute_reservations',
    'voice_route_allocations', 'voice_call_queue'] loop
    execute format('select count(*)::text from public.%I where business_id = %L', t, pg_temp.id('bB')) into r;
    if r <> '0' then left_over := left_over || (t || '=' || r); end if;
  end loop;
  select format('business_id=%s voice_call_id=%s', coalesce(business_id::text, 'null'), coalesce(voice_call_id::text, 'null'))
    into r from public.voice_cost_ledger where idempotency_key = 'proof:cost:b';
  perform pg_temp.ok('0151.post', 'business delete cascades the append-only minute ledger; the cost ledger row survives with its links set null',
    cardinality(left_over) = 0 and r = 'business_id=null voice_call_id=null',
    case when cardinality(left_over) = 0 then 'minute tables empty for B; cost row ' || r else array_to_string(left_over, ', ') end);
  select format('%s', count(*)) into r from public.voice_minute_ledger where business_id = pg_temp.id('bA');
  perform pg_temp.ok('0151.post', 'tenant A''s ledger is untouched', r = '2', 'A ledger rows=' || r);
end
$t$;

-- @@0152.post
do $t$
declare r text; t text; left_over text[] := '{}';
begin
  foreach t in array array['quote_settings', 'document_counters', 'catalogue_items', 'catalogue_price_tiers',
    'catalogue_bundles', 'catalogue_bundle_items'] loop
    execute format('select count(*)::text from public.%I where business_id = %L', t, pg_temp.id('bB')) into r;
    if r <> '0' then left_over := left_over || (t || '=' || r); end if;
  end loop;
  perform pg_temp.ok('0152.post', 'tenant B''s catalogue is gone (the deferred bundle-item FK held)',
    cardinality(left_over) = 0, case when cardinality(left_over) = 0 then 'all 0' else array_to_string(left_over, ', ') end);
end
$t$;

-- @@0153.post
do $t$
declare r text; t text; left_over text[] := '{}';
begin
  select format('name=%s email=%s typed=%s ip=%s anonymised=%s doc_hash_kept=%s',
      coalesce(signer_name, 'null'), coalesce(signer_email, 'null'), coalesce(typed_name, 'null'),
      coalesce(host(ip), 'null'), (anonymised_at is not null)::text, (document_hash = repeat('e', 64))::text)
    into r from public.quote_signatures where quote_id = pg_temp.id('qA2');
  perform pg_temp.ok('0153.post', 'anonymise clears the signer''s PII and keeps the document hash',
    r = 'name=null email=null typed=null ip=null anonymised=true doc_hash_kept=true', r);
  select format('actor_email=%s ip=%s', coalesce(actor_email, 'null'), coalesce(host(ip), 'null'))
    into r from public.quote_acceptance_events where quote_id = pg_temp.id('qA2');
  perform pg_temp.ok('0153.post', 'anonymise clears the acceptance e-mail and IP', r = 'actor_email=null ip=null', r);
  select format('buyer=%s note=%s ai=%s', render_model -> 'buyer', coalesce(internal_note, 'null'), coalesce(ai_rationale, 'null'))
    into r from public.quote_revisions where id = pg_temp.id('rA2');
  perform pg_temp.ok('0153.post', 'anonymise redacts the buyer in the frozen render model and the internal note and AI rationale',
    r = 'buyer={"name": "[removed]", "email": null, "address": [], "company": "Two Ltd"} note=null ai=null', r);
  select format('title=%s token_revoked=%s', q.title,
      (select bool_and(revoked_at is not null) from public.quote_access_tokens where quote_id = q.id)::text)
    into r from public.quotes q where q.id = pg_temp.id('qA2');
  perform pg_temp.ok('0153.post', 'anonymise replaces the quote title and revokes its live links',
    r = 'title=Quote Q-PROOF-A2 token_revoked=true', r);
  select coalesce(internal_note, 'null') into r from public.quote_revisions where id = pg_temp.id('rA1');
  perform pg_temp.ok('0153.post', 'another person''s quote is untouched', r = 'SECRET-NOTE', r);
  r := pg_temp.q('service_role', null, format(
    'insert into public.quotes (business_id, opportunity_id, number, title, currency, created_by_kind) values (%L, %L, ''Q-AFTER'', ''x'', ''GBP'', ''AI'')',
    pg_temp.id('bA'), pg_temp.id('oA2')));
  perform pg_temp.ok('0153.post', 'no new quote may be created for an anonymised person', r like 'ERR:23514:%', r);

  foreach t in array array['quotes', 'quote_revisions', 'quote_line_items', 'quote_approvals', 'quote_access_tokens',
    'quote_signatures', 'quote_events', 'quote_acceptance_events'] loop
    execute format('select count(*)::text from public.%I where business_id = %L', t, pg_temp.id('bB')) into r;
    if r <> '0' then left_over := left_over || (t || '=' || r); end if;
  end loop;
  perform pg_temp.ok('0153.post', 'tenant B''s signed quote, signature, events and acceptance are gone with the workspace',
    cardinality(left_over) = 0, case when cardinality(left_over) = 0 then 'all 0' else array_to_string(left_over, ', ') end);
end
$t$;

-- @@0154.post
do $t$
declare r text; t text; left_over text[] := '{}';
begin
  select buyer::text into r from public.invoices where id = pg_temp.id('invA2');
  perform pg_temp.ok('0154.post', 'anonymise removes the buyer''s e-mail and contact name and keeps the VAT-required name and address',
    r = '{"name": "Two Ltd", "address": ["2 Road"]}', r);
  foreach t in array array['payment_schedules', 'invoices', 'invoice_items', 'invoice_payments', 'credit_notes', 'invoice_reminders'] loop
    execute format('select count(*)::text from public.%I where business_id = %L', t, pg_temp.id('bB')) into r;
    if r <> '0' then left_over := left_over || (t || '=' || r); end if;
  end loop;
  perform pg_temp.ok('0154.post', 'tenant B''s issued invoice, payment, credit note and reminder are gone with the workspace',
    cardinality(left_over) = 0, case when cardinality(left_over) = 0 then 'all 0' else array_to_string(left_over, ', ') end);
end
$t$;

-- @@report
select section, check_name, pass, evidence from proof order by id;
rollback;
