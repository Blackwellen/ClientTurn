-- Connector credential model.
--
-- 0045 gave every installation exactly one credential: an HMAC signing
-- secret. That is the right default, but it is not the only way a sender can
-- authenticate, and plenty of no-code automation tools cannot compute an HMAC
-- at all -- so the install form could only ever ask for one thing, and a
-- connector could not declare what it actually needed.
--
-- This widens the row to hold a declared set of credentials for a chosen
-- authentication method, keeps `secret_ciphertext` for the installs that
-- already exist, and records enough operational history for the UI to stop
-- claiming a connection is working purely because a secret was saved.

alter table public.workspace_app_installs
  add column if not exists auth_method text not null default 'hmac_sha256',
  -- One sealed blob rather than a column per field: the field set is declared
  -- in application code and differs per method, and a JSON blob inside the
  -- existing AES-GCM envelope keeps every credential under the same
  -- authentication tag. Nothing here is ever queried on.
  add column if not exists credentials_ciphertext text,
  add column if not exists label text,
  add column if not exists source_id text,
  add column if not exists last_failure_at timestamptz,
  -- A short, non-sensitive reason ('invalid_signature', 'stale_timestamp').
  -- Never the request body and never any part of a credential.
  add column if not exists last_failure_reason text,
  add column if not exists rotated_at timestamptz;

alter table public.workspace_app_installs
  drop constraint if exists workspace_app_installs_auth_method_check;

alter table public.workspace_app_installs
  add constraint workspace_app_installs_auth_method_check
  check (auth_method in ('hmac_sha256', 'bearer', 'api_key_header', 'basic'));

-- The failure columns are readable by owners/admins so Connections can show
-- why a sender is being rejected. `credentials_ciphertext` is deliberately
-- absent from this grant: it never leaves the server, exactly as
-- `secret_ciphertext` never did.
grant select (
  id, business_id, app_key, active, installed_by, created_at, last_received_at,
  auth_method, label, source_id, last_failure_at, last_failure_reason, rotated_at
) on public.workspace_app_installs to authenticated;

-- Records a rejected inbound request against the installation so the customer
-- can see that their sender is misconfigured. Security-definer because the
-- caller is an unauthenticated webhook request with no session, and the write
-- is confined to two non-sensitive columns on one row.
create or replace function public.record_workspace_app_failure(
  p_install_id uuid,
  p_reason text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.workspace_app_installs
     set last_failure_at = now(),
         last_failure_reason = left(p_reason, 60)
   where id = p_install_id;
end $$;

revoke all on function public.record_workspace_app_failure(uuid, text) from public, anon, authenticated;
grant execute on function public.record_workspace_app_failure(uuid, text) to service_role;

-- Deduplicate on ingest.
--
-- The original inserted a prospect for every accepted event, so the same
-- person arriving from two connectors -- or from one connector after the
-- sender changed its event ids -- produced duplicate prospect rows that then
-- got contacted twice. `eventId` idempotency only ever protected against a
-- retry of the *same* event, which is a different question from whether we
-- already know this person.
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
      business_id, first_name, last_name, email, phone_e164, source_provider
    ) values (
      e.business_id,
      e.payload->>'firstName',
      e.payload->>'lastName',
      v_email,
      v_phone,
      install_source
    ) returning id into result_id;
  end if;

  update public.workspace_app_events set prospect_id = result_id where id = e.id;
  return result_id;
end $$;

revoke all on function public.process_workspace_app_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.process_workspace_app_event(uuid, uuid) to service_role;

-- Supports the dedupe lookup above and the Find Leads contact search, which
-- both filter a tenant's prospects by identifier.
create index if not exists prospects_business_email_idx
  on public.prospects (business_id, lower(email)) where email is not null;

create index if not exists prospects_business_phone_idx
  on public.prospects (business_id, phone_e164) where phone_e164 is not null;
