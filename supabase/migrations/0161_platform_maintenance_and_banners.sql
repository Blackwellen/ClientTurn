-- 0161_platform_maintenance_and_banners: maintenance mode, site offline and platform banners.
--
-- NOT APPLIED by the change that added it. Apply with the deploy that ships
-- the code. Until it is applied the app degrades, it never fabricates:
--   * the proxy's maintenance read fails, is cached as "no windows", and the
--     site runs normally (maintenance fails OPEN: a database blip must never
--     take the site offline on its own);
--   * /admin/site reports that the tables are not migrated yet, and every
--     change action returns that message instead of writing;
--   * no banner shows anywhere.
-- The break-glass env override (MAINTENANCE_OVERRIDE_LEVEL, docs/MAINTENANCE.md)
-- works without this migration.
--
-- Design (docs/MAINTENANCE.md):
--   * Windows and banners are platform rows, not tenant rows: no business_id,
--     because they are not owned by a workspace. RLS is on and FORCED with no
--     policy for anon or authenticated, so a browser can read neither table.
--     Every write is the service role behind an audited, step-up admin action.
--   * The public reads go through two SECURITY DEFINER functions that return
--     only public columns (never the internal reason or the author):
--       platform_maintenance_public()  live and upcoming windows, for the
--                                      proxy, the status page and the banners;
--       platform_marketing_banners()   live website banners (audience ALL or
--                                      MARKETING_VISITORS) for the website.
--     App banners are read server-side with the service role and filtered by
--     audience in code (src/lib/banners/select.ts), never by a broad policy.
--   * Start, end and expiry are evaluated by time at read. No job flips state.
--   * History is the audit log (admin.maintenance_* / admin.banner_*).
--
-- Additive and idempotent.

-- =================================================== 1. maintenance windows
create table if not exists public.platform_maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('READ_ONLY', 'APP_OFFLINE', 'SITE_OFFLINE')),
  starts_at timestamptz not null,
  -- Null: runs until an operator ends it.
  ends_at timestamptz,
  -- Shown on the maintenance page; falls back to ends_at.
  expected_back_at timestamptz,
  message text check (message is null or char_length(message) <= 500),
  -- Internal only: never returned by the public function.
  reason text check (reason is null or char_length(reason) <= 500),
  keep_quote_pages_online boolean not null default true,
  keep_automation_running boolean not null default false,
  announce_banner boolean not null default true,
  notify_owners boolean not null default false,
  -- Claimed once, conditionally, before the owner emails are queued.
  notice_queued_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_maintenance_windows_end_after_start
    check (ends_at is null or ends_at > starts_at),
  constraint platform_maintenance_windows_back_after_start
    check (expected_back_at is null or expected_back_at > starts_at)
);

-- The public read and the admin list both look for windows that are not over.
create index if not exists platform_maintenance_windows_open_idx
  on public.platform_maintenance_windows (starts_at)
  where ended_at is null and cancelled_at is null;
create index if not exists platform_maintenance_windows_created_idx
  on public.platform_maintenance_windows (created_at desc);

alter table public.platform_maintenance_windows enable row level security;
alter table public.platform_maintenance_windows force row level security;
revoke all on public.platform_maintenance_windows from anon, authenticated;
-- No policies: service role only.

-- ============================================================ 2. banners
create table if not exists public.platform_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  -- Plain text. There is deliberately no HTML column.
  body text check (body is null or char_length(body) <= 500),
  -- One optional link: a same-site path or an https URL (validated in code too).
  link_url text check (
    link_url is null
    or (char_length(link_url) <= 500
        and (link_url ~ '^/[^/\\]' or link_url = '/' or link_url ~ '^https://'))
  ),
  link_label text check (link_label is null or char_length(link_label) between 1 and 40),
  tone text not null default 'info' check (tone in ('info', 'success', 'warning', 'critical')),
  audience text not null default 'ALL' check (
    audience in ('ALL', 'APP_USERS', 'MARKETING_VISITORS', 'PLANS', 'WORKSPACES', 'OWNERS_ADMINS')
  ),
  plans text[] not null default '{}'
    check (plans <@ array['trial', 'starter', 'growth', 'pro', 'enterprise']::text[]),
  business_ids uuid[] not null default '{}',
  placements text[] not null
    check (cardinality(placements) between 1 and 3
      and placements <@ array['APP_TOP', 'MARKETING_TOP', 'DASHBOARD_CARD']::text[]),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  ended_at timestamptz,
  dismissible boolean not null default true,
  priority integer not null default 50 check (priority between 0 and 100),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_banners_end_after_start check (ends_at is null or ends_at > starts_at),
  constraint platform_banners_plans_when_plans
    check (audience <> 'PLANS' or cardinality(plans) > 0),
  constraint platform_banners_workspaces_when_workspaces
    check (audience <> 'WORKSPACES' or cardinality(business_ids) > 0)
);

create index if not exists platform_banners_live_idx
  on public.platform_banners (starts_at, priority desc)
  where ended_at is null;

alter table public.platform_banners enable row level security;
alter table public.platform_banners force row level security;
revoke all on public.platform_banners from anon, authenticated;
-- No policies: service role only. Audiences read through code or the
-- marketing function below, never through a broad select policy.

-- ================================================= 3. banner dismissals
-- One row per person per notice. Website visitors dismiss in localStorage.
-- Keyed by text rather than a foreign key because two kinds of notice are
-- dismissible: an admin banner (its uuid) and the automatic "upcoming
-- maintenance" notice (`maintenance:<window uuid>:upcoming`). Deleting a
-- banner deletes its dismissals in the same admin action.
create table if not exists public.platform_banner_dismissals (
  banner_key text not null check (
    banner_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or banner_key ~ '^maintenance:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:upcoming$'
  ),
  user_id uuid not null references auth.users(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (banner_key, user_id)
);
create index if not exists platform_banner_dismissals_user_idx
  on public.platform_banner_dismissals (user_id);

alter table public.platform_banner_dismissals enable row level security;
alter table public.platform_banner_dismissals force row level security;
revoke all on public.platform_banner_dismissals from anon, authenticated;
grant select on public.platform_banner_dismissals to authenticated;
drop policy if exists platform_banner_dismissals_select_own on public.platform_banner_dismissals;
create policy platform_banner_dismissals_select_own on public.platform_banner_dismissals
  for select to authenticated using (user_id = (select auth.uid()));
-- Writes: /api/platform/banners/dismiss, service role, for the verified user only.

-- ========================================== 4. updated_at maintenance
create or replace function public.platform_site_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.platform_site_touch_updated_at() from public, anon, authenticated;

drop trigger if exists platform_maintenance_windows_touch on public.platform_maintenance_windows;
create trigger platform_maintenance_windows_touch
  before update on public.platform_maintenance_windows
  for each row execute function public.platform_site_touch_updated_at();

drop trigger if exists platform_banners_touch on public.platform_banners;
create trigger platform_banners_touch
  before update on public.platform_banners
  for each row execute function public.platform_site_touch_updated_at();

-- ============================================ 5. public read functions
-- Live and upcoming windows, public columns only. STABLE so PostgREST serves
-- it over GET, which is what the proxy's cached read uses.
create or replace function public.platform_maintenance_public()
returns table (
  id uuid,
  level text,
  starts_at timestamptz,
  ends_at timestamptz,
  expected_back_at timestamptz,
  message text,
  keep_quote_pages_online boolean,
  keep_automation_running boolean,
  announce_banner boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.level, w.starts_at, w.ends_at, w.expected_back_at, w.message,
         w.keep_quote_pages_online, w.keep_automation_running, w.announce_banner
    from public.platform_maintenance_windows w
   where w.cancelled_at is null
     and w.ended_at is null
     and (w.ends_at is null or w.ends_at > now())
     and w.starts_at <= now() + interval '30 days'
   order by w.starts_at asc
   limit 20;
$$;
revoke all on function public.platform_maintenance_public() from public;
grant execute on function public.platform_maintenance_public() to anon, authenticated, service_role;

-- Live website banners only: audience ALL or MARKETING_VISITORS, placement
-- MARKETING_TOP. Nothing workspace-targeted can ever come out of this.
create or replace function public.platform_marketing_banners()
returns table (
  id uuid,
  title text,
  body text,
  link_url text,
  link_label text,
  tone text,
  audience text,
  placements text[],
  starts_at timestamptz,
  ends_at timestamptz,
  dismissible boolean,
  priority integer,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.title, b.body, b.link_url, b.link_label, b.tone, b.audience,
         array['MARKETING_TOP']::text[], b.starts_at, b.ends_at, b.dismissible,
         b.priority, b.updated_at
    from public.platform_banners b
   where b.ended_at is null
     and 'MARKETING_TOP' = any (b.placements)
     and b.audience in ('ALL', 'MARKETING_VISITORS')
     and b.starts_at <= now()
     and (b.ends_at is null or b.ends_at > now())
   order by b.priority desc, b.starts_at desc
   limit 10;
$$;
revoke all on function public.platform_marketing_banners() from public;
grant execute on function public.platform_marketing_banners() to anon, authenticated, service_role;
