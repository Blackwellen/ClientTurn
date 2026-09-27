-- 0136_member_display_column_grants: let members read the display columns
-- later migrations added to column-granted tables.
--
-- `leads`, `prospects` and `sourcing_runs` grant SELECT column by column (0050,
-- 0073), so a column added afterwards is invisible to a member's session until
-- it is granted. The signed-in visual pass (2026-09-27) found the lead page,
-- the Find Leads prospect list and every agent page failing for members on
-- exactly these columns. Rows stay governed by the existing RLS policies.
--
-- Deliberately NOT granted, and still readable only by the server: secrets and
-- tokens (unsubscribe_token, key_hash, *_ciphertext, secret_*), identity
-- internals (email_normalized, identity_duplicate_of), provider ids
-- (social_external_id, social_comment_id) and the cost columns.

grant select (anonymised_at, email_origin, source_submitted_at)
  on public.leads to authenticated;

grant select (anonymised_at, email_origin,
              avatar_url, avatar_source, avatar_expires_at,
              social_platform, social_handle, social_profile_url,
              social_followers, social_verified, social_commented_at,
              private_reply_sent_at)
  on public.prospects to authenticated;

grant select (agent_id) on public.sourcing_runs to authenticated;
