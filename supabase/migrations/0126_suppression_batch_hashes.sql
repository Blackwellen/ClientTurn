-- 0126_suppression_batch_hashes: batch suppression lookups that see erased
-- (hashed) entries.
--
-- 0124 converts an erased person's suppression rows to salted hashes, and
-- check_suppression matches either form. The batch lookup used by imports,
-- sourcing and campaign materialisation (policy/suppression.ts
-- checkSuppressionBatch) read the plaintext `email` column only, so an erased
-- address looked eligible in those lists. The send itself was still blocked by
-- check_suppression; this closes the gap earlier, where a person decides.
--
-- The salt never leaves the database: hashing happens here, and the caller
-- gets back the plaintext it asked about, never a hash.

create or replace function public.suppressed_emails(
  p_business_id uuid,
  p_emails text[]
)
returns table (email text, reason text, business_id uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with asked as (
    select distinct lower(btrim(e)) as email
      from unnest(p_emails) as e
     where e is not null and btrim(e) <> ''
  ),
  keyed as (
    select a.email, public.suppression_hash('email', a.email) as email_hash
      from asked a
  )
  select k.email, s.reason, s.business_id, s.created_at
    from keyed k
    join public.suppression_entries s
      on (s.email = k.email::citext or s.email_hash = k.email_hash)
   where s.channel in ('EMAIL', 'ALL')
     and (s.business_id = p_business_id or s.business_id is null)
     and (s.expires_at is null or s.expires_at > now());
$$;

revoke all on function public.suppressed_emails(uuid, text[]) from public, anon, authenticated;
grant execute on function public.suppressed_emails(uuid, text[]) to service_role;
