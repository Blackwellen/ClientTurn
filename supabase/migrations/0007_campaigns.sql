-- 0007_campaigns: reactivation campaigns, recipients, CSV imports

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','SCHEDULED','RUNNING','PAUSED','COMPLETED','CANCELLED')),
  channel text not null default 'sms' check (channel in ('sms', 'whatsapp')),
  message_template text,
  followup_template text,
  followup_delay_seconds integer,
  filter_config jsonb not null default '{}'::jsonb,
  -- Snapshot of suppression counts shown at review time, by reason.
  suppression_summary jsonb not null default '{}'::jsonb,
  send_rate_per_minute integer not null default 20,
  scheduled_at timestamptz,
  launched_at timestamptz,
  launched_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaigns_business_idx on public.campaigns (business_id, status, created_at desc);

create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------- campaign_contacts
create table public.campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  state text not null default 'pending'
    check (state in ('pending','scheduled','sent','delivered','replied',
                     'failed','suppressed','stopped')),
  stopped_reason text,
  next_send_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  replied_at timestamptz,
  followup_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);

create index campaign_contacts_state_idx on public.campaign_contacts (campaign_id, state);
create index campaign_contacts_due_idx
  on public.campaign_contacts (next_send_at)
  where state in ('pending', 'scheduled');

create trigger campaign_contacts_set_updated_at
  before update on public.campaign_contacts
  for each row execute function public.set_updated_at();

alter table public.messages
  add constraint messages_campaign_fk
  foreign key (campaign_id) references public.campaigns(id) on delete set null;

-- ---------------------------------------------------------------- imports
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- R2 object key; the file itself is never public.
  file_key text not null,
  original_filename text,
  status text not null default 'pending'
    check (status in ('pending', 'validating', 'ready', 'importing', 'completed', 'failed')),
  row_count integer not null default 0,
  valid_count integer not null default 0,
  invalid_count integer not null default 0,
  imported_count integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger imports_set_updated_at
  before update on public.imports
  for each row execute function public.set_updated_at();
