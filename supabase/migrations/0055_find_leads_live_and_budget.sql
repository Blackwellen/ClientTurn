-- 0052_find_leads_live_and_budget: live updates for the Find Leads surfaces,
-- customer-visible campaign budget, and the cooldown the research refresh needs
-- (V4 §12.9, §13.3, §16.5).
--
-- The realtime decision this migration turns on is the important part.
--
-- The obvious implementation — put `prospects` in the realtime publication and
-- subscribe to it — is wrong here, and dangerously so. Realtime delivers the
-- whole row to every authorised subscriber; it enforces RLS, but it does not
-- apply the column-level SELECT grants that 0050 and 0051 use to withhold
-- `prospects.unsubscribe_token`. That token *is* a capability: whoever holds it
-- can opt a person out without being signed in. Broadcasting prospect rows
-- would hand it to every browser in the workspace and quietly undo two earlier
-- migrations.
--
-- So nothing sensitive is ever published. A narrow, PII-free event table is
-- published instead: it carries a workspace id, an entity type, an entity id
-- and a verb. A client that receives one re-reads through the ordinary
-- RLS-scoped path, where the column grants still apply.

-- ------------------------------------------------- workspace_stream_events
create table if not exists public.workspace_stream_events (
  id bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- Which surface should care. A client subscribes to one and ignores the rest,
  -- so an intent signal does not re-render the campaigns table.
  surface text not null
    check (surface in ('FIND_LEADS','LEADS','FOLLOW_UP','REACTIVATION')),
  entity_type text not null
    check (entity_type in ('PROSPECT','INTENT_EVENT','CAMPAIGN','SOURCING_RUN')),
  -- Deliberately nullable and deliberately *not* a foreign key: the row must
  -- survive its subject being deleted, and a cascade would remove the very
  -- event that told the client to re-read.
  entity_id uuid,
  kind text not null,
  created_at timestamptz not null default now()
);

comment on table public.workspace_stream_events is
  'Change notifications for live UI. Carries NO personal data and NO secrets by design — it is the only table in the realtime publication, and a subscriber re-reads the real row through its own RLS-scoped query. Never add a payload column to this table.';

create index if not exists workspace_stream_events_business_idx
  on public.workspace_stream_events (business_id, id desc);

create index if not exists workspace_stream_events_created_idx
  on public.workspace_stream_events (created_at);

alter table public.workspace_stream_events enable row level security;
alter table public.workspace_stream_events force row level security;

drop policy if exists workspace_stream_events_select on public.workspace_stream_events;
create policy workspace_stream_events_select
  on public.workspace_stream_events
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.business_members m
       where m.business_id = workspace_stream_events.business_id
         and m.user_id = auth.uid()
    )
  );

-- Read-only to the browser. Every row is written by a trigger or by the service
-- role; a client that could insert here could make other sessions re-read on
-- demand.
revoke all on public.workspace_stream_events from anon, authenticated;
grant select on public.workspace_stream_events to authenticated;
revoke all on sequence public.workspace_stream_events_id_seq from anon, authenticated;

-- Realtime needs the row image to include the columns it filters on.
alter table public.workspace_stream_events replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'workspace_stream_events'
  ) then
    alter publication supabase_realtime add table public.workspace_stream_events;
  end if;
end $$;

-- ------------------------------------------------------------------ emitter
create or replace function public.emit_stream_event(
  p_business_id uuid,
  p_surface text,
  p_entity_type text,
  p_entity_id uuid,
  p_kind text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.workspace_stream_events
    (business_id, surface, entity_type, entity_id, kind)
  values (p_business_id, p_surface, p_entity_type, p_entity_id, p_kind);
$$;

revoke all on function public.emit_stream_event(uuid, text, text, uuid, text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------- triggers
-- Triggers rather than call sites. A prospect's status is moved by server
-- actions, by the dispatcher, by the reply handler and by three job handlers;
-- asking each to remember to emit is how half of them end up not doing it.
create or replace function public.prospects_stream_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  verb text;
begin
  if tg_op = 'INSERT' then
    verb := 'sourced';
  elsif new.promoted_to_lead_id is distinct from old.promoted_to_lead_id
        and new.promoted_to_lead_id is not null then
    verb := 'promoted';
  elsif new.status is distinct from old.status then
    verb := 'status_changed';
  elsif new.outreach_eligibility is distinct from old.outreach_eligibility then
    verb := 'eligibility_changed';
  elsif new.verification_status is distinct from old.verification_status then
    verb := 'verified';
  elsif new.score is distinct from old.score then
    verb := 'scored';
  elsif new.campaign_id is distinct from old.campaign_id then
    verb := 'campaign_changed';
  else
    -- A touched `updated_at` is not news. Emitting for it would make every
    -- background write re-render every open table.
    return coalesce(new, old);
  end if;

  perform public.emit_stream_event(
    new.business_id, 'FIND_LEADS', 'PROSPECT', new.id, verb
  );
  return new;
end $$;

drop trigger if exists prospects_stream_notify_trg on public.prospects;
create trigger prospects_stream_notify_trg
  after insert or update on public.prospects
  for each row execute function public.prospects_stream_notify();

create or replace function public.intent_events_stream_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.emit_stream_event(
    new.business_id, 'FIND_LEADS', 'INTENT_EVENT', new.id, 'detected'
  );
  return new;
end $$;

drop trigger if exists intent_events_stream_notify_trg on public.intent_events;
create trigger intent_events_stream_notify_trg
  after insert on public.intent_events
  for each row execute function public.intent_events_stream_notify();

create or replace function public.outreach_campaigns_stream_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.spent_cost_minor is not distinct from old.spent_cost_minor then
    return new;
  end if;

  perform public.emit_stream_event(
    new.business_id,
    'FIND_LEADS',
    'CAMPAIGN',
    new.id,
    case when tg_op = 'INSERT' then 'created' else 'changed' end
  );
  return new;
end $$;

drop trigger if exists outreach_campaigns_stream_notify_trg on public.outreach_campaigns;
create trigger outreach_campaigns_stream_notify_trg
  after insert or update on public.outreach_campaigns
  for each row execute function public.outreach_campaigns_stream_notify();

-- ---------------------------------------------------------------- retention
-- The table is a signal, not a log — the audit trail lives in `audit_logs`.
-- Anything a client missed is recovered by its next ordinary read, so there is
-- no reason to keep an hour-old notification.
create or replace function public.prune_workspace_stream_events()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  delete from public.workspace_stream_events
   where created_at < now() - interval '2 hours';
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke all on function public.prune_workspace_stream_events()
  from public, anon, authenticated;

-- ------------------------------------------------------- campaign budget £
-- 0041 withholds `max_cost_minor` and `spent_cost_minor` from the browser role,
-- and that grant stays exactly as it is. What this function exposes is a
-- deliberately narrower thing than the grant covered: a campaign's *own* budget
-- cap, which the customer set, and how much of it that campaign has consumed.
--
-- The line 0041 draws is around provider economics — unit costs, per-provider
-- spend, margin — which remain admin-only and are not returned here. A customer
-- being unable to see how much of their own £500 cap is gone cannot manage the
-- campaign, and answering it in pounds is not the same disclosure as exposing
-- what each enrichment call cost to serve.
--
-- SECURITY DEFINER, so membership is re-established inside rather than relying
-- on the caller's RLS.
create or replace function public.outreach_campaign_budget(
  p_business_id uuid
)
returns table (
  campaign_id uuid,
  budget_cap_minor bigint,
  budget_spent_minor bigint,
  percent_used integer,
  has_cap boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
      from public.business_members m
     where m.business_id = p_business_id
       and m.user_id = auth.uid()
  ) then
    return;
  end if;

  return query
    select
      c.id,
      c.max_cost_minor,
      c.spent_cost_minor,
      case
        when c.max_cost_minor > 0
          then least(100, greatest(0,
            round(c.spent_cost_minor * 100.0 / c.max_cost_minor)))::int
        else null
      end,
      c.max_cost_minor > 0
    from public.outreach_campaigns c
    where c.business_id = p_business_id;
end $$;

revoke all on function public.outreach_campaign_budget(uuid) from public, anon;
grant execute on function public.outreach_campaign_budget(uuid) to authenticated;

-- --------------------------------------------------------- research cooldown
-- "Refresh research" is rate-limited per prospect, and the limit is read from
-- the enrichment rows themselves rather than a separate counter that could
-- disagree with what actually ran.
create index if not exists prospect_enrichments_recent_idx
  on public.prospect_enrichments (business_id, prospect_id, requested_at desc);

-- The owner of a campaign, for the Owner filter. `created_by` already exists;
-- this is only the index the filter needs.
create index if not exists outreach_campaigns_owner_idx
  on public.outreach_campaigns (business_id, created_by);
