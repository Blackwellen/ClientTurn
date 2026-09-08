-- 0083_social_due_actions_least_privilege: take back the write grants Supabase
-- handed out by default on `social_due_actions`.
--
-- 0072 created the view and wrote:
--
--     revoke all on public.social_due_actions from anon;
--     grant select on public.social_due_actions to authenticated;
--
-- which looks like least privilege and is not. Supabase ships a default-
-- privileges rule granting ALL on new tables and views in `public` to `anon`
-- and `authenticated`. The `revoke` cleaned that up for anon; the `grant
-- select` for authenticated was **additive** and left INSERT, UPDATE and DELETE
-- exactly where the default had put them.
--
-- An audit of every view in the schema found this one and no others, so it is a
-- mistake in that migration rather than a pattern.
--
-- ## Is it exploitable today?
--
-- No. `social_due_actions` is a simple updatable view over
-- `social_connection_states`, which has RLS forced and exactly one policy — for
-- SELECT. With no permissive policy for INSERT, UPDATE or DELETE, RLS refuses
-- every write regardless of the grant.
--
-- It is fixed anyway, and the reason is the interesting part: the protection is
-- currently coming from a table having *no* write policy, which is the absence
-- of something rather than the presence of anything. The day somebody adds a
-- legitimate UPDATE policy to `social_connection_states` — to let a person
-- pause a prospect from the queue, say — every authenticated user in every
-- workspace silently gains the ability to write through this view. Nothing in
-- that change would look like it touched permissions.
--
-- Defence in depth is the whole argument for RLS in this codebase; a grant that
-- only fails to be a hole because a second control happens to hold is not
-- defence in depth, it is one control.

revoke insert, update, delete, truncate, references, trigger
  on public.social_due_actions
  from authenticated;

-- Restated rather than assumed: anon should hold nothing at all, and a future
-- default-privileges change must not quietly give it something.
revoke all on public.social_due_actions from anon;

-- The one thing the view exists for.
grant select on public.social_due_actions to authenticated;
