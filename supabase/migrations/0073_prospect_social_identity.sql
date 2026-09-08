-- 0073_prospect_social_identity: the handle we contact, and the face we show.
--
-- A prospect found through Instagram, Facebook or TikTok often has no email, no
-- company and no surname -- what it has is a handle and a platform-scoped id.
-- Until now the only social identifier on `prospects` was `linkedin_url`, so an
-- Instagram prospect could be created but not addressed, and
-- `social_connection_states.profile_url` was carrying identity it was never
-- meant to own.
--
-- ## On the avatar: a reference, never a copy
--
-- The instinct is to fetch the image and keep it, which removes the expiry
-- problem and the render-time call to the platform. It was considered and
-- rejected, for one reason that overrides both:
--
--   **LinkedIn's terms forbid retaining profile images at all**, and Meta's
--   permit it only within narrow limits. A cache is a copy, and a copy of a
--   photograph of an identifiable person, held without their knowledge, is
--   exactly the record a subject access or erasure request is about. The
--   product would be storing biometric-adjacent personal data about people who
--   never interacted with it, to save a network round trip.
--
-- So `avatar_url` holds the platform's own reference with the expiry the
-- platform gave it, and `avatar_source` records whose rules apply. The two
-- costs of that choice are paid deliberately:
--
--   * **It expires.** A stale URL renders nothing, and `avatar_expires_at` is
--     what the UI checks so it can fall back to initials *before* attempting a
--     load rather than after a broken image appears. Re-discovery refreshes it.
--   * **A render-time fetch would tell the platform which of its users this
--     business is looking at.** That is a real disclosure, and it is why the
--     image is served through this application's own proxy rather than an
--     `<img>` pointing at the platform -- the proxy makes the request, so the
--     platform sees the deployment, not the customer.
--
-- A missing photo is a normal state, not an error. Plenty of accounts have no
-- avatar, and initials are a perfectly good answer.

alter table public.prospects
  -- The platform-native handle, without the leading @, plus the platform it
  -- belongs to. Separate columns rather than a URL because the handle is what
  -- an operator searches for and what an API call takes.
  add column if not exists social_platform text
    check (social_platform is null
           or social_platform in ('LINKEDIN','FACEBOOK','INSTAGRAM','TIKTOK')),
  add column if not exists social_handle text,
  add column if not exists social_profile_url text,
  -- The platform's own opaque id -- a PSID, an IGSID, a member URN. Handles get
  -- changed by their owners; this does not, so it is what dedupe trusts, and it
  -- is the address a message is sent to.
  add column if not exists social_external_id text,
  -- Follower count at discovery. Kept because it is the one cheap signal of
  -- whether an account is a real business, but explicitly a point-in-time
  -- reading, not a live figure.
  add column if not exists social_followers integer,
  add column if not exists social_verified boolean,

  -- The platform's reference to the image. Never a copy of the bytes -- see
  -- above.
  add column if not exists avatar_url text,
  add column if not exists avatar_source text,
  -- Null means "no known expiry" (an uploaded or company-site image). A value
  -- in the past means the URL must not be rendered.
  add column if not exists avatar_expires_at timestamptz;

alter table public.prospects
  drop constraint if exists prospects_avatar_source_check;
alter table public.prospects
  add constraint prospects_avatar_source_check
  check (avatar_source is null or avatar_source in (
    'LINKEDIN','FACEBOOK','INSTAGRAM','TIKTOK','GRAVATAR','COMPANY_SITE','UPLOAD'
  ));

-- Dedupe on the stable id, not the mutable handle. Partial, because most
-- prospects have no social identity at all and should not be forced to differ.
create unique index if not exists prospects_social_external_idx
  on public.prospects (business_id, social_platform, social_external_id)
  where social_external_id is not null and social_platform is not null;

create index if not exists prospects_social_handle_idx
  on public.prospects (business_id, social_platform, lower(social_handle))
  where social_handle is not null;

-- ==========================================================================
-- The conversation's own copy
-- ==========================================================================
-- `conversations` has carried `counterparty_avatar_url`, `counterparty_handle`
-- and `external_thread_id` since the inbox was built, and nothing has ever
-- written them. The social flow is what fills them in: `external_thread_id`
-- holds the prefixed platform address a reply is sent to, which is why it needs
-- an index -- an inbound webhook arrives knowing only that address and has to
-- find the thread it belongs to before it can do anything at all.

create index if not exists conversations_external_thread_idx
  on public.conversations (business_id, external_thread_id)
  where external_thread_id is not null;
