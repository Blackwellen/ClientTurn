-- 0065_connector_event_failures: a failed inbound event a person can act on.
--
-- Today a rejected request updates two columns on the installation
-- (`last_failure_at`, `last_failure_reason`), which answers "is my sender
-- broken?" but not "which events did I lose, and can I get them back?" — and
-- losing a lead silently is the worst failure this product has.
--
-- One deliberate limit shapes this table: **a request that failed
-- authentication has its body discarded.** Only a sender that proved it holds
-- the credential gets its payload stored. Persisting unauthenticated bodies
-- would turn a public endpoint into somewhere anyone can write arbitrary JSON
-- into a customer's workspace and have staff read it back — so a bad signature
-- is recorded as a *count and a reason*, never as content.

create table if not exists public.connector_event_failures (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  install_id uuid not null references public.workspace_app_installs(id) on delete cascade,

  -- Short, non-sensitive: 'invalid_payload', 'queue_failed'. Never any part of
  -- the body or the credential.
  reason text not null,

  -- Present only when the sender authenticated. Null for every auth failure,
  -- which is the point of the table's one rule.
  payload jsonb,

  -- The sender's own id for the event, when the payload carried one. Lets a
  -- replay be deduplicated against events that did arrive.
  external_event_id text,

  status text not null default 'OPEN'
    check (status in ('OPEN', 'REPLAYED', 'DISMISSED')),
  replayed_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists connector_event_failures_open_idx
  on public.connector_event_failures (business_id, install_id, created_at desc)
  where status = 'OPEN';

alter table public.connector_event_failures enable row level security;
alter table public.connector_event_failures force row level security;

-- Owners and admins only, matching `workspace_app_installs`: the payload is a
-- contact record that arrived from outside, and a viewer has no reason to read
-- inbound plumbing.
create policy connector_event_failures_read
  on public.connector_event_failures
  for select to authenticated
  using (public.has_business_role(business_id, array['owner', 'admin']));

grant select on public.connector_event_failures to authenticated;
revoke all on public.connector_event_failures from anon;

/* ------------------------------------------------------------- recording */

-- Security definer because the caller is an unauthenticated webhook request
-- with no session. The write is confined to this one table, and the payload
-- argument is only ever passed by the route after authentication succeeded.
create or replace function public.record_connector_event_failure(
  p_install_id uuid,
  p_reason text,
  p_payload jsonb default null,
  p_external_event_id text default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_business_id uuid;
begin
  select business_id into v_business_id
    from public.workspace_app_installs
   where id = p_install_id;

  if v_business_id is null then
    return;
  end if;

  insert into public.connector_event_failures
    (business_id, install_id, reason, payload, external_event_id)
  values
    (v_business_id, p_install_id, left(p_reason, 60), p_payload, left(p_external_event_id, 150));
end $$;

revoke all on function public.record_connector_event_failure(uuid, text, jsonb, text)
  from public, anon, authenticated;
