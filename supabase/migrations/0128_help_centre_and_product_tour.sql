-- 0128_help_centre_and_product_tour: help-article view counts, first-use
-- product tour completion, and the Copilot onboarding step (Phase 8.1-8.4).
--
-- 1. help_article_views. Help articles now live as markdown files in the
--    repository (content/help/**) with support_articles as a per-slug
--    override. support_articles.view_count can only count the rows that
--    exist in the table, so file-backed articles were never counted and the
--    "popular articles" list was ordered by nothing. This table counts every
--    slug. Platform-owned and written only by the server through
--    record_help_article_view: RLS is on with no policies, so neither anon
--    nor authenticated can read or write it directly.
--
-- 2. profiles.product_tour_*. The first-use tour runs once per person, not
--    once per workspace: a colleague invited later has never seen it. The
--    version lets a materially rewritten tour be offered again without
--    clearing anyone's history.
--
-- 3. businesses.onboarding_step now starts at 'copilot' (guided first-Copilot
--    setup). Existing workspaces keep whatever step they are on.

-- ----------------------------------------------------------- help views ---
create table if not exists public.help_article_views (
  slug text primary key
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  view_count bigint not null default 0 check (view_count >= 0),
  last_viewed_at timestamptz not null default now()
);

alter table public.help_article_views enable row level security;
revoke all on public.help_article_views from anon, authenticated;

create or replace function public.record_help_article_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 120 then
    return;
  end if;

  insert into public.help_article_views as v (slug, view_count, last_viewed_at)
  values (p_slug, 1, now())
  on conflict (slug) do update
    set view_count = v.view_count + 1,
        last_viewed_at = now();

  -- Keep the legacy counter on a published override in step, so anything
  -- still reading support_articles.view_count sees the same number move.
  update public.support_articles
     set view_count = view_count + 1
   where slug = p_slug
     and status = 'PUBLISHED';
end;
$$;

revoke all on function public.record_help_article_view(text) from public, anon, authenticated;
grant execute on function public.record_help_article_view(text) to service_role;

-- --------------------------------------------------------- product tour ---
alter table public.profiles
  add column if not exists product_tour_version smallint,
  add column if not exists product_tour_completed_at timestamptz,
  add column if not exists product_tour_outcome text
    check (product_tour_outcome in ('completed', 'skipped'));

comment on column public.profiles.product_tour_version is
  'Version of the first-use product tour this person last finished or skipped.';
comment on column public.profiles.product_tour_outcome is
  'Whether the tour was completed or skipped. Written server-side only.';

-- ------------------------------------------------------ onboarding step ---
alter table public.businesses
  alter column onboarding_step set default 'copilot';
