-- 0004_messaging: conversations, messages, delivery events

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel text not null check (channel in ('sms', 'whatsapp')),
  state text not null default 'active'
    check (state in ('active', 'closed', 'handover')),
  current_question_id uuid references public.qualification_questions(id) on delete set null,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, channel)
);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------- messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  channel text not null check (channel in ('sms', 'whatsapp')),
  body text not null,
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED')),
  provider text,
  provider_message_id text,
  -- Client-generated key so a retried send can never duplicate a message.
  send_key text,
  error_code text,
  error_message text,
  cost_amount numeric(10,5),
  cost_currency text default 'GBP',
  origin text not null default 'automation'
    check (origin in ('automation', 'manual', 'campaign', 'system')),
  automation_run_id uuid,
  campaign_id uuid,
  scheduled_for timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index messages_provider_id_idx
  on public.messages (provider, provider_message_id)
  where provider_message_id is not null;

create unique index messages_send_key_idx
  on public.messages (business_id, send_key)
  where send_key is not null;

create trigger messages_set_updated_at
  before update on public.messages
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------- message_events
create table public.message_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  event_type text not null,
  provider_status text,
  error_code text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index message_events_message_idx
  on public.message_events (message_id, occurred_at desc);
