-- 0033_v4_support: customer support tickets and the mailbox ingestion that
-- feeds them (V4 §23, §39-40, §76.26).
--
-- One ticket model serves both sides: the customer sees their own tickets at
-- /app/support, platform admins work the queue at /admin/support. Inbound mail
-- to the support address is threaded onto an existing ticket by Message-ID /
-- In-Reply-To / References before a new ticket is ever opened, so a reply chain
-- does not fan out into duplicates.
--
-- Copilot may draft; a human sends. There is no automation path that emits an
-- external support reply on its own.

-- ------------------------------------------------------------ support_tickets
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  -- Public, human-quotable reference. Populated by the trigger below.
  reference text unique,
  business_id uuid references public.businesses(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  requester_email citext,
  requester_name text,
  category text not null default 'OTHER'
    check (category in ('BILLING','INTEGRATION','LEAD_MESSAGE','SOURCING','ACCOUNT','OTHER')),
  subject text not null,
  status text not null default 'OPEN'
    check (status in ('OPEN','WAITING_CUSTOMER','WAITING_INTERNAL','RESOLVED','CLOSED')),
  priority text not null default 'NORMAL'
    check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  source text not null default 'APP'
    check (source in ('APP','EMAIL','ADMIN')),
  assigned_admin_id uuid references auth.users(id) on delete set null,
  email_thread_key text,
  ai_summary text,
  ai_category_confidence numeric(5,4),
  context_json jsonb not null default '{}'::jsonb,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  last_customer_message_at timestamptz,
  last_admin_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger support_tickets_set_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at();

create sequence if not exists public.support_ticket_reference_seq start 1000;

create or replace function public.set_support_ticket_reference()
returns trigger
language plpgsql
as $$
begin
  if new.reference is null then
    new.reference := 'CT-' || nextval('public.support_ticket_reference_seq')::text;
  end if;
  return new;
end;
$$;

create trigger support_tickets_set_reference
  before insert on public.support_tickets
  for each row execute function public.set_support_ticket_reference();

create index support_tickets_queue_idx
  on public.support_tickets (status, priority, updated_at desc);
create index support_tickets_business_idx
  on public.support_tickets (business_id, status, updated_at desc);
create index support_tickets_thread_idx
  on public.support_tickets (email_thread_key)
  where email_thread_key is not null;
create index support_tickets_assigned_idx
  on public.support_tickets (assigned_admin_id, status)
  where assigned_admin_id is not null;

-- ----------------------------------------------------------- support_messages
-- Customer-visible conversation. `direction` INBOUND is from the customer.
create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  direction text not null
    check (direction in ('INBOUND','OUTBOUND')),
  author_user_id uuid references auth.users(id) on delete set null,
  author_name text,
  author_email citext,
  body text not null,
  body_html text,
  channel text not null default 'APP'
    check (channel in ('APP','EMAIL')),
  provider text,
  provider_message_id text,
  message_id_header text,
  in_reply_to_header text,
  references_header text,
  delivery_state text not null default 'STORED'
    check (delivery_state in ('STORED','QUEUED','SENT','DELIVERED','FAILED')),
  error_message text,
  created_at timestamptz not null default now()
);

create unique index support_messages_provider_idx
  on public.support_messages (provider, provider_message_id)
  where provider_message_id is not null;

create index support_messages_ticket_idx
  on public.support_messages (ticket_id, created_at);

-- -------------------------------------------------------------- support_notes
-- Internal only. Never rendered on a customer surface.
create table public.support_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null,
  is_ai_draft boolean not null default false,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

create index support_notes_ticket_idx
  on public.support_notes (ticket_id, created_at desc);

-- -------------------------------------------------------- support_assignments
create table public.support_assignments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  admin_user_id uuid references auth.users(id) on delete set null,
  assigned_by uuid references auth.users(id) on delete set null,
  action text not null default 'ASSIGNED'
    check (action in ('ASSIGNED','UNASSIGNED','STATUS_CHANGED','PRIORITY_CHANGED','ESCALATED')),
  detail text,
  created_at timestamptz not null default now()
);

create index support_assignments_ticket_idx
  on public.support_assignments (ticket_id, created_at desc);

-- ------------------------------------------------------------ support_articles
-- The help content the customer searches and the Support Copilot may cite.
-- Platform-owned; published articles are readable by any authenticated user.
create table public.support_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  category text not null default 'OTHER',
  summary text,
  body_markdown text not null,
  keywords text[] not null default '{}'::text[],
  status text not null default 'DRAFT'
    check (status in ('DRAFT','PUBLISHED','ARCHIVED')),
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger support_articles_set_updated_at
  before update on public.support_articles
  for each row execute function public.set_updated_at();

create index support_articles_published_idx
  on public.support_articles (status, category)
  where status = 'PUBLISHED';

-- ------------------------------------------------------- support_attachments
create table public.support_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  message_id uuid references public.support_messages(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  filename text not null,
  content_type text,
  size_bytes bigint not null default 0,
  storage_key text not null,
  scan_state text not null default 'PENDING'
    check (scan_state in ('PENDING','CLEAN','BLOCKED','FAILED')),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index support_attachments_ticket_idx
  on public.support_attachments (ticket_id);
