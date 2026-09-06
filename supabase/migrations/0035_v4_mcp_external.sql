-- 0035_v4_mcp_external: the ClientTurn MCP gateway and generic external-system
-- synchronisation (V4 §87-88, §76.29).
--
-- MCP exposes ClientTurn as a scoped tool server. The rules the schema enforces:
--   * A client is authorised BY a user, FOR one business. Its scopes can never
--     exceed that user's own permissions — checked at call time, not just at
--     grant time.
--   * Tokens are stored hashed. A leaked database row cannot be replayed.
--   * High-impact tools require an explicit approval row before they execute.
--   * Every tool call is audited, allowed or denied.

-- --------------------------------------------------------------- mcp_clients
create table public.mcp_clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  oauth_client_id text not null unique,
  -- Hash only. The secret is shown once at creation and never stored in clear.
  client_secret_hash text,
  redirect_uris text[] not null default '{}'::text[],
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','SUSPENDED','REVOKED')),
  created_by uuid references auth.users(id) on delete set null,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger mcp_clients_set_updated_at
  before update on public.mcp_clients
  for each row execute function public.set_updated_at();

create index mcp_clients_business_idx
  on public.mcp_clients (business_id, status);

-- ---------------------------------------------------------------- mcp_scopes
create table public.mcp_scopes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid not null references public.mcp_clients(id) on delete cascade,
  scope text not null,
  tool_name text,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (client_id, scope)
);

create index mcp_scopes_client_idx
  on public.mcp_scopes (client_id)
  where revoked_at is null;

-- ---------------------------------------------------------------- mcp_tokens
create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid not null references public.mcp_clients(id) on delete cascade,
  -- The authorising user. Their role at call time is the ceiling on what the
  -- token may do, so a demoted user's token loses reach immediately.
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  token_type text not null default 'ACCESS'
    check (token_type in ('ACCESS','REFRESH','AUTHORIZATION_CODE')),
  scopes text[] not null default '{}'::text[],
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index mcp_tokens_live_idx
  on public.mcp_tokens (client_id, token_type, expires_at)
  where revoked_at is null;

-- ------------------------------------------------------------ mcp_audit_logs
create table public.mcp_audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  client_id uuid references public.mcp_clients(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  tool_name text not null,
  tool_kind text not null default 'READ'
    check (tool_kind in ('READ','WRITE','APPROVAL_GATED')),
  arguments_json jsonb not null default '{}'::jsonb,
  result text not null default 'OK'
    check (result in ('OK','DENIED_SCOPE','DENIED_ROLE','DENIED_POLICY','DENIED_BUDGET',
                      'AWAITING_APPROVAL','ERROR','NOT_FOUND')),
  denial_reason text,
  approval_id uuid,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index mcp_audit_logs_business_idx
  on public.mcp_audit_logs (business_id, created_at desc);
create index mcp_audit_logs_client_idx
  on public.mcp_audit_logs (client_id, created_at desc);

-- ------------------------------------------------------------ mcp_approvals
-- High-impact tools (send_message, launch_campaign, increase_budget,
-- bulk_approve, change_overage_cap) park here until a human in the workspace
-- approves. The request expires rather than lingering indefinitely.
create table public.mcp_approvals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid references public.mcp_clients(id) on delete set null,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  tool_name text not null,
  arguments_json jsonb not null default '{}'::jsonb,
  summary text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING','APPROVED','REJECTED','EXPIRED','EXECUTED','FAILED')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  executed_at timestamptz,
  execution_error text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create index mcp_approvals_pending_idx
  on public.mcp_approvals (business_id, status, created_at desc)
  where status = 'PENDING';

alter table public.mcp_audit_logs
  add constraint mcp_audit_logs_approval_fk
  foreign key (approval_id) references public.mcp_approvals(id) on delete set null;

-- ------------------------------------------------------- external_connections
-- Generic outward integration record for CRM-style systems (Pipedrive first).
-- Distinct from V3 `integrations`, which models lead sources and messaging.
-- Credentials still live in integration_secrets.
create table public.external_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null
    check (provider in ('PIPEDRIVE','HUBSPOT','SALESFORCE','ZOHO_CRM','OTHER')),
  account_label text,
  external_account_id text,
  secret_ref text,
  status text not null default 'CONNECTED'
    check (status in ('CONNECTED','DEGRADED','ACTION_REQUIRED','DISCONNECTED')),
  status_detail text,
  sync_direction text not null default 'BIDIRECTIONAL'
    check (sync_direction in ('INBOUND','OUTBOUND','BIDIRECTIONAL')),
  sync_config jsonb not null default '{}'::jsonb,
  sync_cursor text,
  last_sync_at timestamptz,
  last_error text,
  connected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, provider)
);

create trigger external_connections_set_updated_at
  before update on public.external_connections
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------ external_entity_links
-- Maps a ClientTurn record to its counterpart in the external system, so a
-- repeated sync updates rather than duplicates.
create table public.external_entity_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  connection_id uuid not null references public.external_connections(id) on delete cascade,
  local_type text not null
    check (local_type in ('LEAD','PROSPECT','COMPANY','BOOKING','CONVERSION','SERVICE','USER')),
  local_id uuid not null,
  external_type text not null,
  external_id text not null,
  last_pushed_at timestamptz,
  last_pulled_at timestamptz,
  local_version text,
  external_version text,
  created_at timestamptz not null default now(),
  unique (connection_id, local_type, local_id),
  unique (connection_id, external_type, external_id)
);

create index external_entity_links_local_idx
  on public.external_entity_links (business_id, local_type, local_id);

-- ------------------------------------------------------------------ sync_runs
create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  connection_id uuid not null references public.external_connections(id) on delete cascade,
  direction text not null
    check (direction in ('INBOUND','OUTBOUND')),
  entity_type text not null,
  status text not null default 'RUNNING'
    check (status in ('RUNNING','COMPLETED','PARTIAL','FAILED','CANCELLED')),
  records_read integer not null default 0,
  records_written integer not null default 0,
  records_skipped integer not null default 0,
  conflict_count integer not null default 0,
  error_message text,
  cursor_before text,
  cursor_after text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index sync_runs_connection_idx
  on public.sync_runs (business_id, connection_id, started_at desc);

-- ------------------------------------------------------------ sync_conflicts
-- Never silently resolved. A conflicting high-confidence identity waits for a
-- human, matching the merge policy in §60.3.
create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  connection_id uuid not null references public.external_connections(id) on delete cascade,
  sync_run_id uuid references public.sync_runs(id) on delete set null,
  local_type text not null,
  local_id uuid,
  external_type text,
  external_id text,
  field_name text,
  local_value jsonb,
  external_value jsonb,
  conflict_kind text not null default 'FIELD_MISMATCH'
    check (conflict_kind in ('FIELD_MISMATCH','DUPLICATE_IDENTITY','MISSING_LOCAL','MISSING_EXTERNAL','POLICY_BLOCKED')),
  status text not null default 'OPEN'
    check (status in ('OPEN','RESOLVED_LOCAL','RESOLVED_EXTERNAL','IGNORED')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index sync_conflicts_open_idx
  on public.sync_conflicts (business_id, status, created_at desc)
  where status = 'OPEN';
