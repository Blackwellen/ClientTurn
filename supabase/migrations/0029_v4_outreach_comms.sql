-- 0029_v4_outreach_comms: acquisition campaigns, cold sequences, the unified
-- cross-channel conversation, and the mailbox/sender/domain health that gates
-- every email send (V4 §16-20, §63-66, §76.16-76.22).
--
-- Two things this schema deliberately separates:
--   * Cold acquisition sequences (outreach_sequences/outreach_steps) are NOT
--     the warm Follow-Up automation. They live inside a campaign and are
--     email-first by policy.
--   * Conversations are shared by prospects and leads. Promotion keeps the same
--     conversation row, so the cold email history is visible the moment a
--     prospect becomes a lead.
--
-- V3 already has `conversations` and `messages` for warm SMS/WhatsApp. Rather
-- than introducing a parallel thread model, those tables are extended here to
-- carry a prospect, an email channel and provider threading fields.

-- ------------------------------------------------------ outreach_campaigns
create table public.outreach_campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','READY','ACTIVE','PAUSED','OPTIMIZING','COMPLETED','STOPPED')),
  conversion_goal_id uuid references public.conversion_goals(id) on delete set null,
  icp_profile_id uuid references public.icp_profiles(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  sender_identity_id uuid,
  audience_json jsonb not null default '{}'::jsonb,
  minimum_grade text not null default 'B'
    check (minimum_grade in ('A+','A','B','C','D')),
  intent_filter_json jsonb not null default '{}'::jsonb,
  intent_required boolean not null default false,
  max_intent_age_days integer,
  review_before_outreach boolean not null default true,
  auto_optimize boolean not null default false,
  auto_overage boolean not null default false,
  priority integer not null default 100,
  -- Caps. Every one of these is a ceiling the scheduler re-checks at send time;
  -- none of them can be raised by the optimizer.
  daily_contact_cap integer not null default 50,
  monthly_contact_cap integer not null default 1000,
  prospects_per_run integer not null default 100,
  max_cost_minor bigint not null default 0,
  spent_cost_minor bigint not null default 0,
  reserved_allowance_minor bigint not null default 0,
  active_sequence_id uuid,
  launch_validated_at timestamptz,
  launched_by uuid references auth.users(id) on delete set null,
  launched_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  stopped_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger outreach_campaigns_set_updated_at
  before update on public.outreach_campaigns
  for each row execute function public.set_updated_at();

create index outreach_campaigns_business_idx
  on public.outreach_campaigns (business_id, status, priority);
create index outreach_campaigns_updated_idx
  on public.outreach_campaigns (business_id, updated_at desc);

alter table public.prospects
  add constraint prospects_campaign_fk
  foreign key (campaign_id) references public.outreach_campaigns(id) on delete set null;

alter table public.sourcing_runs
  add constraint sourcing_runs_campaign_fk
  foreign key (campaign_id) references public.outreach_campaigns(id) on delete set null;

alter table public.recurring_searches
  add constraint recurring_searches_campaign_fk
  foreign key (campaign_id) references public.outreach_campaigns(id) on delete set null;

-- ----------------------------------------------- outreach_campaign_versions
create table public.outreach_campaign_versions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  version integer not null,
  snapshot_json jsonb not null default '{}'::jsonb,
  changed_by text not null default 'USER'
    check (changed_by in ('USER','OPTIMIZATION','SYSTEM')),
  changed_by_user_id uuid references auth.users(id) on delete set null,
  change_summary text,
  created_at timestamptz not null default now(),
  unique (campaign_id, version)
);

-- ------------------------------------------------------ outreach_sequences
create table public.outreach_sequences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','PUBLISHED','ARCHIVED')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (campaign_id, version)
);

alter table public.outreach_campaigns
  add constraint outreach_campaigns_sequence_fk
  foreign key (active_sequence_id) references public.outreach_sequences(id) on delete set null;

-- ---------------------------------------------------------- outreach_steps
create table public.outreach_steps (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  sequence_id uuid not null references public.outreach_sequences(id) on delete cascade,
  position integer not null,
  delay_seconds bigint not null default 0
    check (delay_seconds >= 0),
  -- Cold outreach is email-first. A non-EMAIL channel here is still gated by
  -- ChannelPolicyService at send time and is rejected for cold campaigns.
  channel text not null default 'EMAIL'
    check (channel in ('EMAIL','SMS','WHATSAPP','SOCIAL')),
  subject_template text,
  body_template text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sequence_id, position)
);

create index outreach_steps_sequence_idx
  on public.outreach_steps (business_id, sequence_id, position);

-- ------------------------------------------------------------ outreach_runs
-- One row per campaign execution window. Gives the scheduler an anchor for
-- daily caps and gives the UI something to show as "current activity".
create table public.outreach_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  sequence_id uuid references public.outreach_sequences(id) on delete set null,
  status text not null default 'RUNNING'
    check (status in ('RUNNING','PAUSED','COMPLETED','STOPPED','FAILED')),
  run_date date not null default (now() at time zone 'utc')::date,
  contacts_attempted integer not null default 0,
  contacts_sent integer not null default 0,
  contacts_blocked integer not null default 0,
  cost_minor bigint not null default 0,
  stop_reason text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (campaign_id, run_date)
);

-- ------------------------------------------------- outreach_recipient_runs
-- Per-prospect progress through the sequence. The scheduler's due-work query
-- reads this, and `next_step_due_at` is the only thing that makes a send
-- eligible — never a timestamp derived at read time.
create table public.outreach_recipient_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  sequence_id uuid not null references public.outreach_sequences(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  conversation_id uuid,
  status text not null default 'PENDING'
    check (status in ('PENDING','SCHEDULED','ACTIVE','REPLIED','STOPPED','BOUNCED','SUPPRESSED','COMPLETED','FAILED')),
  current_step_position integer not null default 0,
  steps_sent integer not null default 0,
  next_step_due_at timestamptz,
  stop_reason text,
  last_sent_at timestamptz,
  replied_at timestamptz,
  bounced_at timestamptz,
  stopped_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, prospect_id)
);

create trigger outreach_recipient_runs_set_updated_at
  before update on public.outreach_recipient_runs
  for each row execute function public.set_updated_at();

create index outreach_recipient_runs_due_idx
  on public.outreach_recipient_runs (status, next_step_due_at)
  where status in ('SCHEDULED','ACTIVE');
create index outreach_recipient_runs_campaign_idx
  on public.outreach_recipient_runs (business_id, campaign_id, status);

-- --------------------------------------------------------- experimentation
create table public.campaign_experiments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid not null references public.outreach_campaigns(id) on delete cascade,
  name text not null,
  dimension text not null
    check (dimension in ('SUBJECT','OPENING','CTA','SEND_TIME','SPACING','ROLE_PRIORITY','INTENT_THRESHOLD','GRADE_THRESHOLD')),
  status text not null default 'RUNNING'
    check (status in ('RUNNING','CONCLUDED','ABANDONED')),
  minimum_sample_size integer not null default 100,
  winning_variant_id uuid,
  conclusion text,
  started_at timestamptz not null default now(),
  concluded_at timestamptz
);

create table public.campaign_variants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  experiment_id uuid not null references public.campaign_experiments(id) on delete cascade,
  step_id uuid references public.outreach_steps(id) on delete cascade,
  label text not null,
  content_json jsonb not null default '{}'::jsonb,
  allocation_percent numeric(5,2) not null default 50
    check (allocation_percent >= 0 and allocation_percent <= 100),
  sent_count integer not null default 0,
  delivered_count integer not null default 0,
  reply_count integer not null default 0,
  positive_reply_count integer not null default 0,
  conversion_count integer not null default 0,
  bounce_count integer not null default 0,
  complaint_count integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.campaign_experiments
  add constraint campaign_experiments_winner_fk
  foreign key (winning_variant_id) references public.campaign_variants(id) on delete set null;

create table public.campaign_learnings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid references public.outreach_campaigns(id) on delete cascade,
  dimension text not null,
  finding text not null,
  evidence_json jsonb not null default '{}'::jsonb,
  sample_size integer not null default 0,
  confidence numeric(5,4) not null default 0,
  recommended_action text,
  status text not null default 'PROPOSED'
    check (status in ('PROPOSED','ACCEPTED','REJECTED','APPLIED','EXPIRED')),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

-- What the Optimization Agent actually changed, and within which bound. Any
-- action outside the allowlist in lib/optimization/bounds.ts is rejected before
-- it reaches this table, so an audit here is a record of permitted change only.
create table public.optimization_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_id uuid references public.outreach_campaigns(id) on delete cascade,
  action_type text not null
    check (action_type in ('SEND_TIME','VARIANT_ALLOCATION','CAMPAIGN_PRIORITY','GRADE_THRESHOLD',
                           'ROLE_PRIORITY','FOLLOW_UP_SPACING','CHANNEL_PREFERENCE')),
  before_json jsonb not null default '{}'::jsonb,
  after_json jsonb not null default '{}'::jsonb,
  bound_json jsonb not null default '{}'::jsonb,
  rationale text,
  agent_run_id uuid,
  applied boolean not null default false,
  applied_at timestamptz,
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);

create index optimization_actions_campaign_idx
  on public.optimization_actions (business_id, campaign_id, created_at desc);

-- ----------------------------------------------------- mailbox_connections
-- Credentials never live here. `secret_ref` points at integration_secrets
-- (server-only, no RLS policies), matching how V3 stores provider tokens.
create table public.mailbox_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null
    check (provider in ('GOOGLE','MICROSOFT','IMAP_SMTP')),
  account_email citext not null,
  display_name text,
  secret_ref text,
  status text not null default 'CONNECTED'
    check (status in ('CONNECTED','DEGRADED','ACTION_REQUIRED','DISCONNECTED')),
  status_detail text,
  scopes text[] not null default '{}'::text[],
  sync_cursor text,
  sync_enabled boolean not null default true,
  last_sync_at timestamptz,
  last_send_at timestamptz,
  last_error text,
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, account_email)
);

create trigger mailbox_connections_set_updated_at
  before update on public.mailbox_connections
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------- sender_identities
create table public.sender_identities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  mailbox_connection_id uuid references public.mailbox_connections(id) on delete cascade,
  display_name text not null,
  email citext not null,
  reply_to citext,
  domain text,
  signature_text text,
  postal_footer text,
  logo_key text,
  prefer_plain_text boolean not null default true,
  -- Cold sending is opt-in per sender AND gated by domain/mailbox health.
  cold_enabled boolean not null default false,
  warm_enabled boolean not null default true,
  daily_send_cap integer not null default 200,
  sent_today integer not null default 0,
  sent_today_on date,
  paused_until timestamptz,
  pause_reason text,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, email)
);

create trigger sender_identities_set_updated_at
  before update on public.sender_identities
  for each row execute function public.set_updated_at();

create unique index sender_identities_default_idx
  on public.sender_identities (business_id)
  where is_default;

alter table public.outreach_campaigns
  add constraint outreach_campaigns_sender_fk
  foreign key (sender_identity_id) references public.sender_identities(id) on delete set null;

-- ---------------------------------------------------- health snapshot rolls
create table public.domain_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  domain text not null,
  snapshot_date date not null default (now() at time zone 'utc')::date,
  spf_state text not null default 'UNKNOWN'
    check (spf_state in ('PASS','FAIL','MISSING','UNKNOWN')),
  dkim_state text not null default 'UNKNOWN'
    check (dkim_state in ('PASS','FAIL','MISSING','UNKNOWN')),
  dmarc_state text not null default 'UNKNOWN'
    check (dmarc_state in ('PASS','FAIL','MISSING','UNKNOWN')),
  dmarc_policy text,
  sent_count integer not null default 0,
  bounce_count integer not null default 0,
  complaint_count integer not null default 0,
  bounce_rate numeric(6,4) not null default 0,
  complaint_rate numeric(6,4) not null default 0,
  health_state text not null default 'HEALTHY'
    check (health_state in ('HEALTHY','WATCH','WARNING','PAUSED')),
  created_at timestamptz not null default now(),
  unique (business_id, domain, snapshot_date)
);

create table public.mailbox_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  mailbox_connection_id uuid not null references public.mailbox_connections(id) on delete cascade,
  snapshot_date date not null default (now() at time zone 'utc')::date,
  connection_state text not null default 'CONNECTED',
  sent_count integer not null default 0,
  bounce_count integer not null default 0,
  complaint_count integer not null default 0,
  reply_count integer not null default 0,
  throttled_count integer not null default 0,
  sync_lag_seconds integer,
  health_state text not null default 'HEALTHY'
    check (health_state in ('HEALTHY','WATCH','WARNING','PAUSED')),
  created_at timestamptz not null default now(),
  unique (mailbox_connection_id, snapshot_date)
);

-- ------------------------------------- extend V3 conversations and messages
-- Prospects and leads now share one thread. `prospect_id` is nullable so every
-- existing warm conversation row stays valid untouched.
--
-- V3 modelled a conversation as (lead, channel). A prospect thread is
-- cross-channel by definition, so it takes channel 'multi' and the per-channel
-- uniqueness is re-expressed as a partial index that only applies to leads.
-- On promotion the SAME conversation row gains a lead_id and every message in
-- it is stamped with that lead_id, which is what makes the cold email history
-- appear in the Lead Drawer immediately (the drawer reads messages by lead_id).
alter table public.conversations
  add column if not exists prospect_id uuid references public.prospects(id) on delete cascade,
  add column if not exists subject text,
  add column if not exists provider_thread_id text;

alter table public.conversations alter column lead_id drop not null;

alter table public.conversations
  drop constraint if exists conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check
  check (channel in ('sms', 'whatsapp', 'email', 'multi'));

-- A conversation belongs to a lead, a prospect, or both (after promotion).
alter table public.conversations
  drop constraint if exists conversations_subject_present;
alter table public.conversations
  add constraint conversations_subject_present
  check (lead_id is not null or prospect_id is not null);

alter table public.conversations drop constraint if exists conversations_lead_id_channel_key;

create unique index if not exists conversations_lead_channel_idx
  on public.conversations (lead_id, channel)
  where lead_id is not null and channel <> 'multi';

create unique index if not exists conversations_prospect_uniq_idx
  on public.conversations (prospect_id)
  where prospect_id is not null;

create index if not exists conversations_prospect_idx
  on public.conversations (business_id, prospect_id)
  where prospect_id is not null;

alter table public.prospects
  add constraint prospects_conversation_fk
  foreign key (conversation_id) references public.conversations(id) on delete set null;

alter table public.outreach_recipient_runs
  add constraint outreach_recipient_runs_conversation_fk
  foreign key (conversation_id) references public.conversations(id) on delete set null;

alter table public.messages
  add column if not exists prospect_id uuid references public.prospects(id) on delete cascade,
  add column if not exists campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  add column if not exists outreach_step_id uuid references public.outreach_steps(id) on delete set null,
  add column if not exists variant_id uuid references public.campaign_variants(id) on delete set null,
  add column if not exists sender_identity_id uuid references public.sender_identities(id) on delete set null,
  add column if not exists subject text,
  add column if not exists provider_thread_id text,
  add column if not exists message_id_header text,
  add column if not exists in_reply_to_header text,
  add column if not exists references_header text,
  add column if not exists reply_classification text,
  add column if not exists reply_confidence numeric(5,4),
  add column if not exists opened_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists complained_at timestamptz;

-- Cold outreach messages exist before any lead does.
alter table public.messages alter column lead_id drop not null;

alter table public.messages
  drop constraint if exists messages_subject_present;
alter table public.messages
  add constraint messages_subject_present
  check (lead_id is not null or prospect_id is not null);

-- Bounce and complaint are terminal delivery states an email can reach that
-- SMS never could, and 'outreach' distinguishes cold acquisition sends from
-- the warm automation, manual and reactivation origins V3 already knows.
alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages
  add constraint messages_status_check
  check (status in ('QUEUED','SENT','DELIVERED','FAILED','RECEIVED','BOUNCED','COMPLAINED'));

alter table public.messages drop constraint if exists messages_origin_check;
alter table public.messages
  add constraint messages_origin_check
  check (origin in ('automation','manual','campaign','system','outreach'));

alter table public.messages
  drop constraint if exists messages_reply_classification_check;
alter table public.messages
  add constraint messages_reply_classification_check
  check (reply_classification is null or reply_classification in (
    'POSITIVE_INTEREST','NEUTRAL_QUESTION','OBJECTION','NOT_NOW','WRONG_PERSON',
    'REFERRAL_TO_OTHER_PERSON','UNSUBSCRIBE','COMPLAINT','BOUNCE','AUTO_RESPONSE',
    'HUMAN_REQUEST','UNKNOWN'));

create index if not exists messages_prospect_idx
  on public.messages (business_id, prospect_id, created_at desc)
  where prospect_id is not null;
create index if not exists messages_campaign_idx
  on public.messages (business_id, campaign_id, created_at desc)
  where campaign_id is not null;
create index if not exists messages_message_id_header_idx
  on public.messages (business_id, message_id_header)
  where message_id_header is not null;
