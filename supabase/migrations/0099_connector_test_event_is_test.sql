-- Zapier/connector QA audit: "Send test event" (Settings -> Connections) posts a
-- synthetic, correctly-signed event through the real ingest route on purpose --
-- see connector-ops.ts sendTestEvent -- so it proves the actual endpoint, not a
-- stand-in for it. But `process_workspace_app_event` (0059) never marked the
-- resulting row is_test, so every click left a permanent, indistinguishable
-- fake prospect in Find Leads: countable in analytics, eligible for automated
-- follow-up, and matchable by dedupe against a real contact who happens to
-- reuse test@example.com.
--
-- The route's public payload schema deliberately has no `isTest` field --
-- accepting one would let an authenticated but compromised sender mark real
-- leads as test to hide them from analytics and usage billing. Instead this
-- recognises the test path by the two markers only `sendTestEvent` produces:
-- the reserved address and its own event-id prefix.
create or replace function public.process_workspace_app_event(
  p_event_id uuid,
  p_business_id uuid
) returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  e public.workspace_app_events;
  app_name text;
  install_source text;
  v_email text;
  v_phone text;
  v_is_test boolean;
  result_id uuid;
begin
  select * into e from public.workspace_app_events
    where id = p_event_id and business_id = p_business_id for update;
  if not found then raise exception 'Event not found'; end if;
  if e.prospect_id is not null then return e.prospect_id; end if;

  select app_key, coalesce(source_id, app_key) into app_name, install_source
    from public.workspace_app_installs
   where id = e.install_id and business_id = e.business_id and active;
  if not found then return null; end if;

  v_email := nullif(lower(trim(e.payload->>'email')), '');
  v_phone := nullif(trim(e.payload->>'phone'), '');
  v_is_test := v_email = 'test@example.com' and e.external_event_id like 'clientturn-test-%';

  -- Match on either identifier. A contact who arrives with only a phone this
  -- time and only an email the last time stays two rows; merging those needs
  -- a human decision and belongs in the review queue, not in an ingest path.
  select id into result_id
    from public.prospects
   where business_id = e.business_id
     and (
       (v_email is not null and lower(email) = v_email)
       or (v_phone is not null and phone_e164 = v_phone)
     )
   limit 1;

  if result_id is null then
    insert into public.prospects(
      business_id, first_name, last_name, email, phone_e164, source_provider, is_test
    ) values (
      e.business_id,
      e.payload->>'firstName',
      e.payload->>'lastName',
      v_email,
      v_phone,
      install_source,
      v_is_test
    ) returning id into result_id;
  end if;

  update public.workspace_app_events set prospect_id = result_id where id = e.id;
  return result_id;
end $$;

revoke all on function public.process_workspace_app_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.process_workspace_app_event(uuid, uuid) to service_role;
