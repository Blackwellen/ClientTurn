-- 0096_meta_data_deletion_requests: the record behind Meta's data-deletion
-- callback.
--
-- Meta requires an app that touches user data to publish a **Data Deletion
-- Callback**: a URL it POSTs a `signed_request` to when somebody asks for their
-- data to be removed. The response must carry a status URL and a confirmation
-- code, and the person must be able to visit that URL and see where their
-- request got to. It is checked at App Review, and an app without one is
-- refused.
--
-- Neither the callback nor anything backing it existed. This is the table.
--
-- ## Why a request row rather than deleting inline
--
-- The callback has to answer Meta in a single request, and it has to answer
-- with a code the person can look up afterwards. Deleting inline would mean
-- either doing the work before responding — an unbounded amount of it, on a
-- request Meta will time out — or responding first and hoping, with nothing
-- recorded if the process died in between.
--
-- So the callback records the request and answers immediately; a job does the
-- deletion and stamps the row. That is also what makes the status URL honest:
-- it reports what actually happened rather than what was intended.
--
-- ## Why the code is random
--
-- `confirmation_code` is generated from random bytes, never derived from the
-- Meta user id. A derived code would let anybody who knows somebody's Meta id
-- look up their deletion request, which turns a privacy feature into a
-- disclosure.

create table if not exists public.meta_data_deletion_requests (
  id uuid primary key default gen_random_uuid(),

  -- What the person can quote back to us, and what the status URL looks up.
  -- Unique because it is the lookup key, and unguessable because it is random.
  confirmation_code text not null unique,

  -- Meta's app-scoped id for the person. Not a user of ours: it identifies
  -- whoever authorised the app, which is how the request is matched to the
  -- integrations they connected.
  meta_user_id text not null,

  -- The workspaces whose Meta connection belonged to this person. Recorded at
  -- request time rather than resolved later: by the time the job runs the
  -- integration may already be gone, and the row still has to say what was
  -- acted on.
  business_ids uuid[] not null default '{}',

  status text not null default 'RECEIVED'
    check (status in ('RECEIVED','COMPLETED','NOTHING_TO_DELETE','FAILED')),

  -- What was actually removed, for the status page and for our own audit.
  -- A count rather than a list: the person asking is entitled to know their
  -- data is gone, not to a copy of what it was.
  integrations_removed integer not null default 0,
  prospects_removed integer not null default 0,
  conversations_removed integer not null default 0,

  last_error text,

  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists meta_data_deletion_requests_user_idx
  on public.meta_data_deletion_requests (meta_user_id, requested_at desc);

create index if not exists meta_data_deletion_requests_open_idx
  on public.meta_data_deletion_requests (requested_at)
  where status = 'RECEIVED';

-- ==========================================================================
-- Access
-- ==========================================================================
-- Nobody reaches this through the browser. The status page is public by
-- necessity — the person checking it has a confirmation code and no account —
-- so it is served by a route handler using the service role, which looks up
-- exactly one row by its code and returns a status and nothing else.
--
-- Granting `authenticated` a select would be worse than useless: it would let
-- every signed-in user of the platform enumerate other people's deletion
-- requests, and none of them has any reason to read one.

alter table public.meta_data_deletion_requests enable row level security;
alter table public.meta_data_deletion_requests force row level security;
revoke all on public.meta_data_deletion_requests from anon, authenticated;
