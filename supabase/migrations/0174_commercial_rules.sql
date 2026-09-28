-- 0174_commercial_rules: agent offer targeting and competitor positioning
-- (docs/AGENT_RUNTIME.md "Commercial rules").
--
--   1. agents.offer_scope / target_service_ids / target_catalogue_item_ids:
--      what an agent sells. CATALOGUE (the default, and every existing agent)
--      is the whole catalogue, exactly the behaviour before this migration;
--      SELECTED names offers (`services`) and/or priced lines
--      (`catalogue_items`, 0152). Ids are validated against the workspace by
--      the `agent.set_offer_target` operation before they are written; an id
--      whose row is later deleted is simply ignored when the target is read
--      (src/lib/agents/offer-target.ts), which is the safe direction: the
--      agent sells less, never more. The legacy `agents.service_id` (0043)
--      is read as a one-offer target when no scope has been chosen.
--   2. workspace_competitors: the competitors a workspace's leads mention,
--      with the factual comparison points it has approved and the lines never
--      to say. The conversation agent may use an approved point word for word
--      when a lead names the competitor (detected deterministically by name
--      or alias) and nothing else; the reply validator enforces it
--      (src/lib/sales-library/competitors.ts). The payload is validated in
--      code, as workspace_sales_overrides' is.
--
-- The best-fit recommendation needs no schema: it is computed on read from
-- facts already stored (src/lib/commercial/best-fit.ts).
--
-- RLS: business_id on every row; enabled and forced; the browser role gets
-- SELECT for members only (grants as 0168_rls_grant_hardening). Every write
-- goes through the service layer (src/lib/services/operations/commercial-rules.ts)
-- with the service role. `agents` keeps its column grant (0043/0046), so the
-- three new columns are granted by name.
--
-- 0171-0173 are taken by other work; this is the next free number.
-- Not applied by the author. Additive and idempotent.

-- ------------------------------------------------------ 1. agent targeting
alter table public.agents
  add column if not exists offer_scope text not null default 'CATALOGUE',
  add column if not exists target_service_ids uuid[] not null default '{}',
  add column if not exists target_catalogue_item_ids uuid[] not null default '{}';

alter table public.agents drop constraint if exists agents_offer_scope_check;
alter table public.agents add constraint agents_offer_scope_check
  check (offer_scope in ('CATALOGUE', 'SELECTED'));

alter table public.agents drop constraint if exists agents_offer_target_size_check;
alter table public.agents add constraint agents_offer_target_size_check
  check (cardinality(target_service_ids) <= 50 and cardinality(target_catalogue_item_ids) <= 100);

-- SELECTED needs something selected; CATALOGUE carries no stale lists.
alter table public.agents drop constraint if exists agents_offer_target_shape_check;
alter table public.agents add constraint agents_offer_target_shape_check
  check (
    (offer_scope = 'CATALOGUE' and cardinality(target_service_ids) = 0 and cardinality(target_catalogue_item_ids) = 0)
    or (offer_scope = 'SELECTED' and cardinality(target_service_ids) + cardinality(target_catalogue_item_ids) > 0)
  );

grant select (offer_scope, target_service_ids, target_catalogue_item_ids) on public.agents to authenticated;

-- ------------------------------------------------- 2. workspace_competitors
create table if not exists public.workspace_competitors (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- The stable id the settings form and the operations use.
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,40}$'),
  name text not null check (char_length(name) between 2 and 80),
  aliases text[] not null default '{}' check (cardinality(aliases) <= 10),
  approved_points text[] not null default '{}' check (cardinality(approved_points) <= 8),
  never_say text[] not null default '{}' check (cardinality(never_say) <= 10),
  enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_competitors_slug_unique unique (business_id, slug)
);

create index if not exists workspace_competitors_business_idx
  on public.workspace_competitors (business_id) where enabled;

drop trigger if exists workspace_competitors_set_updated_at on public.workspace_competitors;
create trigger workspace_competitors_set_updated_at
  before update on public.workspace_competitors
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ RLS + grants
alter table public.workspace_competitors enable row level security;
alter table public.workspace_competitors force row level security;
revoke all on public.workspace_competitors from anon, authenticated;
grant select on public.workspace_competitors to authenticated;
drop policy if exists workspace_competitors_select_member on public.workspace_competitors;
create policy workspace_competitors_select_member on public.workspace_competitors
  for select to authenticated
  using (public.is_business_member(business_id));
