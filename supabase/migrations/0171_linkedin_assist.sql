-- 0171_linkedin_assist: LinkedIn Assist (owner decision 2026-09-28).
--
-- The AI drafts; a person sends. There is no LinkedIn API messaging, no
-- browser extension, no scraping and no automation of anybody's account in
-- anything below. These tables hold a per-user daily task list of drafted
-- LinkedIn actions (connection note, follow-up, InMail, reply) for leads and
-- prospects that have a public LinkedIn profile URL, and the pacing each
-- person has chosen for their own account.
--
--   1. linkedin_assist_settings: one row per (workspace, user). The caps can
--      only be set LOWER than the defaults: the CHECK ceilings are the
--      defaults, well under LinkedIn's own limits (lib/linkedin-assist/types.ts
--      holds the same numbers and tests/linkedin-assist.test.ts asserts they
--      agree).
--   2. linkedin_assist_contacts: one per lead or prospect being worked on
--      LinkedIn, with its state (NOT_STARTED -> INVITED -> MESSAGED -> REPLIED,
--      or STOPPED / FINISHED) and the reason it stopped.
--   3. linkedin_assist_tasks: the day's list. A task is OPEN until the person
--      marks it SENT or SKIPPED, or a stop condition CANCELS it. Follow-ups are
--      tasks with a future due_on, created when the previous step is marked
--      sent. dedupe_key makes every scheduling write idempotent.
--
-- Every table carries business_id; RLS is enabled and forced; the browser role
-- gets SELECT for members only (grants as 0168_rls_grant_hardening). Every
-- write goes through the service layer (lib/services/operations/linkedin-assist.ts).
--
-- Data rights: anonymising a lead or prospect removes its contact and tasks
-- (the drafted text names the person); deleting cascades. See
-- lib/data-rights/coverage.ts.
--
-- Not applied by the author. Additive only.

-- ------------------------------------------------------------ 1. settings
create table if not exists public.linkedin_assist_settings (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_tier text not null default 'FREE'
    check (account_tier in ('FREE', 'PREMIUM', 'SALES_NAVIGATOR')),
  daily_connection_notes integer not null default 15
    check (daily_connection_notes between 0 and 15),
  weekly_connection_requests integer not null default 80
    check (weekly_connection_requests between 0 and 80),
  daily_messages integer not null default 30
    check (daily_messages between 0 and 30),
  monthly_inmail_credits integer not null default 0
    check (monthly_inmail_credits between 0 and 50),
  follow_up_after_days integer not null default 4
    check (follow_up_after_days between 3 and 30),
  max_follow_ups integer not null default 2
    check (max_follow_ups between 0 and 2),
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create trigger linkedin_assist_settings_set_updated_at
  before update on public.linkedin_assist_settings
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ 2. contacts
create table if not exists public.linkedin_assist_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete cascade,
  profile_url text not null
    check (profile_url ~ '^https://www\.linkedin\.com/in/[^/?#[:space:]]{1,100}/$'),
  first_touch text not null default 'CONNECTION_NOTE'
    check (first_touch in ('CONNECTION_NOTE', 'INMAIL')),
  state text not null default 'NOT_STARTED'
    check (state in ('NOT_STARTED', 'INVITED', 'MESSAGED', 'REPLIED', 'FINISHED', 'STOPPED')),
  stopped_reason text
    check (stopped_reason is null or stopped_reason in (
      'OPTED_OUT', 'WON', 'LOST', 'REMOVED', 'SKIPPED', 'NO_RESPONSE',
      'MOVED_TO_EMAIL', 'MOVED_TO_SMS', 'MOVED_TO_CALL')),
  conversation_id uuid references public.conversations(id) on delete set null,
  invited_at timestamptz,
  messaged_at timestamptz,
  replied_at timestamptz,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A prospect promoted on reply keeps its prospect_id and gains a lead_id.
  constraint linkedin_assist_contacts_subject check (lead_id is not null or prospect_id is not null)
);

create unique index if not exists linkedin_assist_contacts_lead_uidx
  on public.linkedin_assist_contacts (business_id, lead_id) where lead_id is not null;
create unique index if not exists linkedin_assist_contacts_prospect_uidx
  on public.linkedin_assist_contacts (business_id, prospect_id) where prospect_id is not null;
create index if not exists linkedin_assist_contacts_owner_idx
  on public.linkedin_assist_contacts (business_id, owner_user_id, state);

create trigger linkedin_assist_contacts_set_updated_at
  before update on public.linkedin_assist_contacts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ 3. tasks
create table if not exists public.linkedin_assist_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  contact_id uuid not null references public.linkedin_assist_contacts(id) on delete cascade,
  assignee_user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete cascade,
  kind text not null
    check (kind in ('CONNECTION_NOTE', 'FOLLOW_UP', 'INMAIL', 'REPLY')),
  -- FOLLOW_UP: 1 = the first message after they accept, 2-3 = follow-ups.
  step smallint not null default 1 check (step between 1 and 3),
  status text not null default 'OPEN'
    check (status in ('OPEN', 'SENT', 'SKIPPED', 'CANCELLED')),
  due_on date not null,
  snooze_count smallint not null default 0 check (snooze_count between 0 and 2),
  body text check (body is null or char_length(body) <= 1900),
  body_source text
    check (body_source is null or body_source in ('TEMPLATE', 'AI', 'AGENT', 'PERSON')),
  fallback_reason text check (fallback_reason is null or char_length(fallback_reason) <= 500),
  -- REPLY tasks: the agent's suggested reply (a DRAFT message on the lead's
  -- linkedin conversation) and the reply the person pasted in.
  draft_message_id uuid references public.messages(id) on delete set null,
  inbound_body text check (inbound_body is null or char_length(inbound_body) <= 4000),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  cancelled_reason text check (cancelled_reason is null or char_length(cancelled_reason) <= 200),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkedin_assist_tasks_dedupe unique (business_id, dedupe_key),
  -- LinkedIn's own ceiling on a connection-request note.
  constraint linkedin_assist_tasks_note_length
    check (kind <> 'CONNECTION_NOTE' or body is null or char_length(body) <= 300),
  constraint linkedin_assist_tasks_subject check (lead_id is not null or prospect_id is not null)
);

create index if not exists linkedin_assist_tasks_today_idx
  on public.linkedin_assist_tasks (business_id, assignee_user_id, status, due_on);
create index if not exists linkedin_assist_tasks_contact_idx
  on public.linkedin_assist_tasks (business_id, contact_id, status);
create index if not exists linkedin_assist_tasks_completed_idx
  on public.linkedin_assist_tasks (business_id, assignee_user_id, completed_at)
  where status = 'SENT';

create trigger linkedin_assist_tasks_set_updated_at
  before update on public.linkedin_assist_tasks
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ RLS + grants
alter table public.linkedin_assist_settings enable row level security;
alter table public.linkedin_assist_settings force row level security;
revoke all on public.linkedin_assist_settings from anon, authenticated;
grant select on public.linkedin_assist_settings to authenticated;
drop policy if exists linkedin_assist_settings_select_member on public.linkedin_assist_settings;
create policy linkedin_assist_settings_select_member on public.linkedin_assist_settings
  for select to authenticated
  using (public.is_business_member(business_id));

alter table public.linkedin_assist_contacts enable row level security;
alter table public.linkedin_assist_contacts force row level security;
revoke all on public.linkedin_assist_contacts from anon, authenticated;
grant select on public.linkedin_assist_contacts to authenticated;
drop policy if exists linkedin_assist_contacts_select_member on public.linkedin_assist_contacts;
create policy linkedin_assist_contacts_select_member on public.linkedin_assist_contacts
  for select to authenticated
  using (public.is_business_member(business_id));

alter table public.linkedin_assist_tasks enable row level security;
alter table public.linkedin_assist_tasks force row level security;
revoke all on public.linkedin_assist_tasks from anon, authenticated;
grant select on public.linkedin_assist_tasks to authenticated;
drop policy if exists linkedin_assist_tasks_select_member on public.linkedin_assist_tasks;
create policy linkedin_assist_tasks_select_member on public.linkedin_assist_tasks
  for select to authenticated
  using (public.is_business_member(business_id));

-- ------------------------------------------------------------ data rights
-- Anonymise (data_rights_scrub, 0124, sets anonymised_at on the lead or the
-- prospect): the profile URL and every drafted or pasted message name the
-- person, so the rows go in the same transaction. Delete cascades.
create or replace function public.linkedin_assist_clear_on_anonymise()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'leads' then
    delete from public.linkedin_assist_tasks t
     where t.business_id = new.business_id and t.lead_id = new.id;
    delete from public.linkedin_assist_contacts c
     where c.business_id = new.business_id and c.lead_id = new.id;
  else
    delete from public.linkedin_assist_tasks t
     where t.business_id = new.business_id and t.prospect_id = new.id;
    delete from public.linkedin_assist_contacts c
     where c.business_id = new.business_id and c.prospect_id = new.id;
  end if;
  return null;
end
$$;

revoke all on function public.linkedin_assist_clear_on_anonymise() from public, anon, authenticated;

drop trigger if exists leads_linkedin_assist_clear_on_anonymise on public.leads;
create trigger leads_linkedin_assist_clear_on_anonymise
  after update of anonymised_at on public.leads
  for each row when (new.anonymised_at is not null)
  execute function public.linkedin_assist_clear_on_anonymise();

drop trigger if exists prospects_linkedin_assist_clear_on_anonymise on public.prospects;
create trigger prospects_linkedin_assist_clear_on_anonymise
  after update of anonymised_at on public.prospects
  for each row when (new.anonymised_at is not null)
  execute function public.linkedin_assist_clear_on_anonymise();
