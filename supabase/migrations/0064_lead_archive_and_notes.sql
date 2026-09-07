-- 0064_lead_archive_and_notes: what the service layer needs to own leads.
--
-- Two gaps the core service layer exposed:
--
--   1. **There was no way to archive a lead.** The programme requires full CRUD
--      including archive/restore, and `leads` had no column for it, so the only
--      available "remove" was a delete — which destroys the follow-up history a
--      compliance question would later be answered from.
--   2. **A note had nowhere to go.** `leads.notes` is a single text column: an
--      appended note loses who wrote it and when, which is precisely what makes
--      a note worth reading. `lead.add_note` is a first-class audited operation,
--      so it needs a first-class row.

/* --------------------------------------------------------------- archiving */

alter table public.leads
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

comment on column public.leads.archived_at is
  'Set when a lead is archived. The row is kept: archiving hides a lead and stops its follow-up, it does not destroy the contact history.';

-- Every list view filters on this, and almost every lead is not archived, so a
-- partial index keeps the common query reading only the live rows.
create index if not exists leads_live_idx
  on public.leads (business_id, created_at desc)
  where archived_at is null;

/* ------------------------------------------------------------- lead_notes */

create table if not exists public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  -- Null when written by an automation rather than a person. The distinction
  -- matters on a timeline: "Priya noted" and "ClientTurn noted" are not the
  -- same claim.
  author_user_id uuid references auth.users(id) on delete set null,
  -- Which surface wrote it: UI, COPILOT, AGENT, MCP, SYSTEM. A note that an
  -- assistant added on someone's behalf should say so.
  author_kind text not null default 'UI'
    check (author_kind in ('UI', 'COPILOT', 'AGENT', 'MCP', 'SYSTEM')),
  created_at timestamptz not null default now()
);

create index if not exists lead_notes_lead_idx
  on public.lead_notes (business_id, lead_id, created_at desc);

alter table public.lead_notes enable row level security;
alter table public.lead_notes force row level security;

-- Members of the workspace read their own notes. Writes go through the service
-- layer under the service role, which is where the permission, audit and
-- correlation are applied — so there is deliberately no insert policy here.
create policy lead_notes_select on public.lead_notes
  for select using (public.is_business_member(business_id));

grant select on public.lead_notes to authenticated;
revoke all on public.lead_notes from anon;

/* ------------------------------------------------------- archive column grant */

-- Read-only to the browser, consistent with the rest of `leads`: the archive
-- state is changed through `lead.archive`, never by a direct client update.
grant select (archived_at, archived_by) on public.leads to authenticated;
