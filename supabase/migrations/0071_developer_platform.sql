-- 0071_developer_platform: workspace API keys and outgoing webhooks.
--
-- ClientTurn could be reached by an MCP client and by nothing else. A customer
-- who wanted to pull their own leads into a spreadsheet, or be told the moment
-- a lead qualified, had no way to do either. This adds the two surfaces that
-- close that, and they are deliberately built on the rules the MCP gateway
-- already enforces rather than a second, looser set:
--
--   * A key is stored as a SHA-256 digest. A leaked database row cannot be
--     replayed, and "show me the key again" is not a feature that can be added
--     later without changing that.
--   * A key carries ONE member's authority. Their live role is re-read on every
--     request, so a demotion or a removal takes effect immediately rather than
--     when the key happens to expire.
--   * Scopes are a ceiling, never a floor. A key can only narrow what its owner
--     could already do.
--   * Every request is logged, allowed or refused, with the key that made it.
--
-- Webhooks are the outbound half. A signing secret is stored sealed rather than
-- hashed because we have to sign with it: the receiver verifies, which means
-- both ends hold the same value. Delivery is a queued job with capped retries,
-- so a customer's endpoint being down never blocks the work that produced the
-- event.

/* ------------------------------------------------------------- api_keys */

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,

  -- The visible half of the key, stored so the UI can show ct_live_a1b2...f9c4
  -- and a customer can match a key in their own configuration to a row here
  -- without either end holding the secret.
  key_prefix text not null,
  key_last_four text not null,

  -- The only copy that survives creation.
  key_hash text not null unique,

  environment text not null default 'live'
    check (environment in ('live','test')),

  scopes text[] not null default '{}'::text[],

  -- The member whose authority this key carries -- not merely who created it.
  -- The gateway re-reads THIS person's live membership on every request, which
  -- is what makes revocation-by-demotion work without anyone revoking a key.
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,

  -- Optional IP allowlist. Empty means "any address", which is the honest
  -- default; a customer who can name their egress addresses should.
  allowed_ips text[] not null default '{}'::text[],

  expires_at timestamptz,
  last_used_at timestamptz,
  last_used_ip text,
  request_count bigint not null default 0,

  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint api_keys_name_length check (char_length(name) between 1 and 80)
);

create trigger api_keys_set_updated_at
  before update on public.api_keys
  for each row execute function public.set_updated_at();

create index api_keys_business_idx
  on public.api_keys (business_id, created_at desc);

-- The hot path: resolve a presented digest to a live key.
create index api_keys_live_idx
  on public.api_keys (key_hash)
  where revoked_at is null;

/* ------------------------------------------------------ api_request_logs */

-- Every authenticated call to the public API, and every refusal. Refusals
-- matter more than successes: a key being denied repeatedly is either a
-- misconfiguration or someone probing, and both are worth being able to see.
create table public.api_request_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  method text not null,
  path text not null,
  status_code integer not null,
  outcome text not null default 'OK'
    check (outcome in ('OK','UNAUTHORIZED','FORBIDDEN_SCOPE','FORBIDDEN_ROLE',
                       'RATE_LIMITED','IP_BLOCKED','NOT_FOUND','INVALID','ERROR')),
  error_code text,
  latency_ms integer,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index api_request_logs_business_idx
  on public.api_request_logs (business_id, created_at desc);
create index api_request_logs_key_idx
  on public.api_request_logs (api_key_id, created_at desc);

/* ------------------------------------------------------ webhook_endpoints */

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  url text not null,
  description text,

  -- Sealed, not hashed: signing requires the value itself, and the receiver
  -- must hold the same one to verify. AES-256-GCM at rest means a database row
  -- on its own is not enough to forge a signature.
  secret_sealed text not null,
  -- Last six characters, so the UI can show which secret is in force without
  -- revealing it.
  secret_hint text not null,

  events text[] not null default '{}'::text[],

  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','PAUSED','DISABLED')),

  -- Set when we disable an endpoint ourselves after sustained failure, so the
  -- customer is told why rather than finding it silently off.
  disabled_reason text,

  consecutive_failures integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (business_id, url)
);

create trigger webhook_endpoints_set_updated_at
  before update on public.webhook_endpoints
  for each row execute function public.set_updated_at();

create index webhook_endpoints_business_idx
  on public.webhook_endpoints (business_id, created_at desc);

-- The dispatch fan-out reads this: live endpoints subscribed to an event type.
create index webhook_endpoints_active_idx
  on public.webhook_endpoints using gin (events)
  where status = 'ACTIVE';

/* ----------------------------------------------------- webhook_deliveries */

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,

  -- One event, fanned out to every subscribed endpoint. The id is stable across
  -- endpoints and across retries, so a receiver can deduplicate on it.
  event_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,

  status text not null default 'PENDING'
    check (status in ('PENDING','SUCCEEDED','FAILED','EXHAUSTED','CANCELLED')),

  attempts integer not null default 0,
  max_attempts integer not null default 6,

  response_status integer,
  -- Truncated by the writer. Enough to debug, not enough to become a log of the
  -- contents of a customer's own system.
  response_body text,
  error text,

  next_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),

  -- Delivering the same event to the same endpoint twice is the one thing a
  -- webhook system must not do by accident.
  unique (endpoint_id, event_id)
);

create index webhook_deliveries_endpoint_idx
  on public.webhook_deliveries (business_id, endpoint_id, created_at desc);

create index webhook_deliveries_pending_idx
  on public.webhook_deliveries (next_attempt_at)
  where status = 'PENDING';

/* ------------------------------------------------------------------ RLS */

do $$
declare t text;
begin
  foreach t in array array[
    'api_keys','api_request_logs','webhook_endpoints','webhook_deliveries'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- key_hash must never be selectable, even by a workspace owner: reading it
-- would let them replay a key they were only ever shown once, and it turns an
-- ordinary read into offline-crackable material. Column grants rather than a
-- policy, because a policy cannot withhold a column.
revoke all on public.api_keys from anon, authenticated;
grant select (id, business_id, name, key_prefix, key_last_four, environment,
              scopes, user_id, created_by, allowed_ips, expires_at, last_used_at,
              last_used_ip, request_count, revoked_at, revoked_by,
              created_at, updated_at)
  on public.api_keys to authenticated;

-- Admins only. The list names every credential holding access to the workspace,
-- which is administrative information, not a personal preference.
create policy api_keys_select_admin on public.api_keys
  for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));

-- Server-written, admin-readable. No writes are granted to any browser role: a
-- client that could insert here could forge the record of its own refusals.
revoke all on public.api_request_logs from anon, authenticated;
grant select on public.api_request_logs to authenticated;
create policy api_request_logs_select_admin on public.api_request_logs
  for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));

-- The signing secret is sealed, but it is still the secret: withhold the column
-- rather than relying on every future query to remember not to select it.
revoke all on public.webhook_endpoints from anon, authenticated;
grant select (id, business_id, url, description, secret_hint, events, status,
              disabled_reason, consecutive_failures, last_success_at,
              last_failure_at, last_error, created_by, created_at, updated_at)
  on public.webhook_endpoints to authenticated;
create policy webhook_endpoints_select_admin on public.webhook_endpoints
  for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));

revoke all on public.webhook_deliveries from anon, authenticated;
grant select on public.webhook_deliveries to authenticated;
create policy webhook_deliveries_select_admin on public.webhook_deliveries
  for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin']));

/* ------------------------------------------------- delivery claim helper */

-- Claims due deliveries the way claim_jobs claims jobs: FOR UPDATE SKIP LOCKED,
-- so two overlapping worker invocations never send the same webhook twice.
-- Doing this in SQL rather than in the handler is what makes that hold under
-- concurrency; a read-then-update in application code would not.
create or replace function public.claim_webhook_deliveries(batch_size integer)
returns setof public.webhook_deliveries
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  return query
  update public.webhook_deliveries d
  set attempts = d.attempts + 1,
      next_attempt_at = null
  where d.id in (
    select c.id
    from public.webhook_deliveries c
    where c.status = 'PENDING'
      and c.next_attempt_at is not null
      and c.next_attempt_at <= now()
    order by c.next_attempt_at
    limit batch_size
    for update skip locked
  )
  returning d.*;
end;
$fn$;

revoke all on function public.claim_webhook_deliveries(integer)
  from public, anon, authenticated;

/* --------------------------------------------------------- key usage touch */

-- Increments in the database rather than read-modify-write in the handler.
-- Two concurrent requests with the same key would otherwise both read the same
-- count and write the same value, quietly losing one -- and a usage counter
-- that undercounts under load is worse than no counter, because it reads as
-- authoritative.
create or replace function public.touch_api_key(p_key_id uuid, p_ip text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $fn$
  update public.api_keys
  set last_used_at = now(),
      last_used_ip = left(p_ip, 60),
      request_count = request_count + 1
  where id = p_key_id;
$fn$;

revoke all on function public.touch_api_key(uuid, text)
  from public, anon, authenticated;

/* ------------------------------------------- MCP over a workspace API key */

-- The MCP gateway now accepts a workspace API key as well as an OAuth-issued
-- MCP token, because a real MCP client (Claude, Codex, Gemini) configures a
-- static bearer header and cannot perform a refresh exchange -- an hour-long
-- token meant the connection worked for an hour and then silently stopped.
--
-- The audit row has to be able to say which credential made the call. Without
-- this column an API-key call would be recorded with no client at all, and
-- "which of my credentials did this" is the first question anyone asks of an
-- audit trail.
alter table public.mcp_audit_logs
  add column if not exists api_key_id uuid
    references public.api_keys(id) on delete set null;

create index if not exists mcp_audit_logs_api_key_idx
  on public.mcp_audit_logs (api_key_id, created_at desc);
