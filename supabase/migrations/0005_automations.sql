-- 0005_automations: definitions, versions, steps, per-lead runs

create table public.automation_definitions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  type text not null
    check (type in ('new_lead', 'booking_reminder', 'unresponsive')),
  name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, type)
);

create trigger automation_definitions_set_updated_at
  before update on public.automation_definitions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------- automation_versions
create table public.automation_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  automation_id uuid not null references public.automation_definitions(id) on delete cascade,
  version_number integer not null default 1,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (automation_id, version_number)
);

-- At most one PUBLISHED version per automation.
create unique index automation_versions_one_published_idx
  on public.automation_versions (automation_id)
  where status = 'PUBLISHED';

create trigger automation_versions_set_updated_at
  before update on public.automation_versions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------- automation_steps
create table public.automation_steps (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  version_id uuid not null references public.automation_versions(id) on delete cascade,
  position integer not null,
  delay_seconds integer not null default 0 check (delay_seconds >= 0),
  channel text not null check (channel in ('sms', 'whatsapp')),
  template text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version_id, position)
);

create trigger automation_steps_set_updated_at
  before update on public.automation_steps
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------- automation_runs
create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  version_id uuid not null references public.automation_versions(id) on delete cascade,
  state text not null default 'ACTIVE'
    check (state in ('ACTIVE', 'PAUSED', 'COMPLETED', 'STOPPED', 'FAILED')),
  current_step integer not null default 0,
  next_run_at timestamptz,
  stopped_reason text,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active run per lead per automation version.
create unique index automation_runs_active_idx
  on public.automation_runs (lead_id, version_id)
  where state = 'ACTIVE';

-- Partial index for the due-work scan.
create index automation_runs_due_idx
  on public.automation_runs (next_run_at)
  where state = 'ACTIVE';

create trigger automation_runs_set_updated_at
  before update on public.automation_runs
  for each row execute function public.set_updated_at();

alter table public.messages
  add constraint messages_automation_run_fk
  foreign key (automation_run_id) references public.automation_runs(id) on delete set null;
