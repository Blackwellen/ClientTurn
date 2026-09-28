-- 0168: grant and RLS tidy-up found by supabase/tests/0143-0167-rls-proof.sql.
--
-- 1. 0166 revoked `affiliate_tiers` and `affiliate_tier_history` from anon
--    only. Supabase's default privileges had already given `authenticated`
--    INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on both. RLS has
--    no write policy, so row writes affected nothing, but TRUNCATE is not
--    subject to RLS. Every write goes through the service role; the browser
--    role keeps SELECT only.
-- 2. The three 0143 tables `enable` but did not `force` RLS, unlike every
--    later migration (gap audit 15 §4). Forcing it changes nothing for the
--    service role (BYPASSRLS); it closes the table-owner path.
--
-- Idempotent: revoking an absent privilege and re-forcing RLS are no-ops.

revoke insert, update, delete, truncate, references, trigger
  on public.affiliate_tiers from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.affiliate_tier_history from authenticated;

alter table public.affiliate_tiers force row level security;
alter table public.affiliate_tier_history force row level security;

alter table public.payment_endpoints force row level security;
alter table public.checkout_attempts force row level security;
alter table public.checkout_payments force row level security;
