-- Workspace app installations. This transport is a signed webhook bridge;
-- native OAuth and two-way sync must not be implied by an installation.
create table public.workspace_app_installs (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 app_key text not null,
 secret_ciphertext text not null,
 active boolean not null default true,
 installed_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 last_received_at timestamptz,
 unique(business_id,app_key)
);
alter table public.workspace_app_installs enable row level security;
alter table public.workspace_app_installs force row level security;
revoke all on public.workspace_app_installs from anon,authenticated;
grant select(id,business_id,app_key,active,installed_by,created_at,last_received_at) on public.workspace_app_installs to authenticated;
create policy app_install_read on public.workspace_app_installs for select to authenticated using(public.has_business_role(business_id,array['owner','admin']));

create table public.workspace_app_events (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 install_id uuid not null references public.workspace_app_installs(id) on delete cascade,
 external_event_id text not null,
 payload jsonb not null,
 prospect_id uuid references public.prospects(id),
 created_at timestamptz not null default now(),
 unique(install_id,external_event_id)
);
alter table public.workspace_app_events enable row level security;
alter table public.workspace_app_events force row level security;
revoke all on public.workspace_app_events from anon,authenticated;
create policy app_event_read on public.workspace_app_events for select to authenticated using(public.has_business_role(business_id,array['owner','admin']));
grant select on public.workspace_app_events to authenticated;

-- Durable receipt and queue insertion are atomic. A retry cannot lose a job.
create function public.receive_workspace_app_event(p_install_id uuid,p_event_id text,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare installation public.workspace_app_installs; event_id uuid;
begin
 select * into installation from public.workspace_app_installs where id=p_install_id and active for update;
 if not found then raise exception 'Installation unavailable'; end if;
 insert into public.workspace_app_events(business_id,install_id,external_event_id,payload)
 values(installation.business_id,installation.id,p_event_id,p_payload)
 on conflict(install_id,external_event_id) do nothing returning id into event_id;
 if event_id is not null then
  insert into public.jobs(business_id,type,payload,idempotency_key)
  values(installation.business_id,'app.ingest',jsonb_build_object('eventId',event_id),'app.ingest:'||event_id);
  update public.workspace_app_installs set last_received_at=now() where id=installation.id;
 end if;
 return event_id;
end $$;

create function public.process_workspace_app_event(p_event_id uuid,p_business_id uuid)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare e public.workspace_app_events; app_name text; result_id uuid;
begin
 select * into e from public.workspace_app_events where id=p_event_id and business_id=p_business_id for update;
 if not found then raise exception 'Event not found'; end if;
 if e.prospect_id is not null then return e.prospect_id; end if;
 select app_key into app_name from public.workspace_app_installs where id=e.install_id and business_id=e.business_id and active;
 if not found then return null; end if;
 insert into public.prospects(business_id,first_name,last_name,email,phone_e164,source_provider)
 values(e.business_id,e.payload->>'firstName',e.payload->>'lastName',e.payload->>'email',e.payload->>'phone',app_name)
 returning id into result_id;
 update public.workspace_app_events set prospect_id=result_id where id=e.id;
 return result_id;
end $$;
revoke all on function public.receive_workspace_app_event(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.process_workspace_app_event(uuid,uuid) from public,anon,authenticated;
grant execute on function public.receive_workspace_app_event(uuid,text,jsonb) to service_role;
grant execute on function public.process_workspace_app_event(uuid,uuid) to service_role;
