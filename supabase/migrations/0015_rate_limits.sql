-- 0015_rate_limits: fixed-window rate limiting for sensitive endpoints.
--
-- Serverless instances are not shared, so an in-memory counter would reset on
-- every cold start and would not hold across concurrent instances. The counter
-- therefore lives in Postgres and is incremented atomically.

create table if not exists public.rate_limits (
  bucket text not null,
  identifier text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, identifier, window_start)
);

create index if not exists rate_limits_window_idx
  on public.rate_limits (window_start);

-- Server-only: no browser client ever reads or writes this.
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;
revoke all on public.rate_limits from anon, authenticated;

/*
 * Increments the current window and reports whether the caller is within the
 * limit. Uses an upsert so concurrent requests cannot both read a stale count
 * and each decide they are under the limit.
 */
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_identifier text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (bucket, identifier, window_start, count)
  values (p_bucket, p_identifier, v_window_start, 1)
  on conflict (bucket, identifier, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  return query select
    v_count <= p_limit,
    greatest(0, p_limit - v_count),
    case
      when v_count <= p_limit then 0
      else ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - now())))::integer
    end;
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;

/* Old windows are dead weight; the retention job clears them. */
create or replace function public.prune_rate_limits(older_than interval default '1 day')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limits where window_start < now() - older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_rate_limits(interval) from public, anon, authenticated;
