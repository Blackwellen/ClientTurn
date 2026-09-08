-- 0081_meta_private_replies: the entry point that makes Meta prospecting work.
--
-- Every social route in this product was built around one shape:
-- connect → wait for acceptance → message. That shape is correct for LinkedIn
-- and TikTok. It is **wrong for Meta**, and building Facebook and Instagram on
-- it produced a queue full of people nobody could ever contact, because there
-- is no API for a Page to follow a person and therefore no acceptance to wait
-- for.
--
-- What Meta actually offers is a **private reply**: if somebody comments on
-- your post, reel or ad, or mentions you in a story, the Page may send them one
-- direct message within seven days. That is a first-party, permitted, fully
-- automatable route to a person who has never messaged you — and it was missing
-- from the schema entirely.
--
-- Four properties of it drive everything below, and each one is a constraint
-- rather than a convention because each one is enforced by Meta:
--
--   1. **The recipient is a comment, not a person.** The Send API takes
--      `recipient: { comment_id }`. So the comment id has to be stored, and a
--      prospect without one is unreachable no matter what else we know.
--   2. **One reply per comment, ever.** Not per person, not per day. A second
--      attempt is refused, and repeated attempts are what gets a Page's
--      messaging permission reviewed.
--   3. **Seven days, from the comment's own timestamp.** Not from when our
--      poller noticed it. A backlogged run can miss the window on a comment
--      posted minutes ago in real time, so the platform's timestamp is stored
--      rather than `now()`.
--   4. **It does not open the 24-hour window.** Only their answer does. Until
--      then the business has had its one turn.

-- ==========================================================================
-- 1. The comment we may answer
-- ==========================================================================

alter table public.prospects
  -- The address, not provenance. `prospect_data_sources` records where a fact
  -- came from; this is the thing a send is directed at, and it belongs on the
  -- record that gets sent to.
  add column if not exists social_comment_id text,
  -- The seven-day clock. The platform's timestamp for the comment.
  add column if not exists social_commented_at timestamptz,
  -- When the one permitted reply was spent. Non-null means there is no second
  -- one to give, however long is left on the clock.
  add column if not exists private_reply_sent_at timestamptz;

-- The sweep's query: commenters we may still answer. Partial, because the vast
-- majority of prospects either never commented or have already been answered,
-- and neither belongs in this index.
create index if not exists prospects_private_reply_due_idx
  on public.prospects (business_id, social_commented_at)
  where social_comment_id is not null
    and private_reply_sent_at is null
    and outreach_eligibility <> 'SUPPRESSED';

-- One reply per comment, as a database guarantee rather than a convention.
--
-- Application code already checks it, and application code is exactly what a
-- retried job, a manual fix or a future scheduler bug routes around. Meta
-- refuses the second send anyway; the point of this is that we never make the
-- request, because a Page that repeatedly attempts refused sends is a Page
-- under review.
create unique index if not exists prospects_one_private_reply_idx
  on public.prospects (business_id, social_comment_id)
  where social_comment_id is not null;

-- ==========================================================================
-- 2. A private reply is a kind of outbound message
-- ==========================================================================
-- It goes through `social_outbound_messages` like every other social send, so
-- that one table remains the answer to "what did we say to this person, and
-- who sent it". The kind matters because the rules differ: this one has no
-- follow-up, no sequence step, and exactly one attempt.

alter table public.social_outbound_messages
  drop constraint if exists social_outbound_messages_kind_check;
alter table public.social_outbound_messages
  add constraint social_outbound_messages_kind_check
  check (kind in ('INVITE_NOTE','OPENER','FOLLOW_UP','PRIVATE_REPLY'));

-- The comment this reply answers, so the sender has its address without a
-- second read and the audit trail says which comment was spent.
alter table public.social_outbound_messages
  add column if not exists comment_id text;

-- ==========================================================================
-- 3. A private reply is a due action
-- ==========================================================================

alter table public.social_connection_states
  drop constraint if exists social_connection_states_next_action_check;
alter table public.social_connection_states
  add constraint social_connection_states_next_action_check
  check (
    next_action is null
    or next_action in ('INVITE','MESSAGE','FOLLOW_UP','WITHDRAW','PRIVATE_REPLY')
  );

-- The acceptance gate must not apply to a private reply.
--
-- 0072 made MESSAGE and FOLLOW_UP require `state in (ACCEPTED, MESSAGED,
-- REPLIED)`, which is right: those are unsendable before acceptance on every
-- platform that has one. PRIVATE_REPLY is the opposite case — it is precisely
-- the action that is permitted *without* any acceptance, and gating it the same
-- way would make the one route that works on Meta unreachable.
alter table public.social_connection_states
  drop constraint if exists social_connection_states_message_needs_acceptance;
alter table public.social_connection_states
  add constraint social_connection_states_message_needs_acceptance
  check (
    next_action is null
    or next_action not in ('MESSAGE','FOLLOW_UP')
    or state in ('ACCEPTED','MESSAGED','REPLIED')
  );

-- ==========================================================================
-- 4. Backfill
-- ==========================================================================
-- Commenters already ingested carry their comment id in `prospect_data_sources`
-- under the `engagement_excerpt` row, which is where the ingest put it before
-- there was a column for it. Lifting it across makes the existing queue
-- actionable rather than stranding everybody found before today.
--
-- `obtained_at` is the platform's timestamp for the comment, which is the clock
-- Meta measures against — so it is carried over as-is rather than reset to now,
-- even though that means most backfilled rows are already outside the window.
-- Recording that honestly is the point: a customer should see "too late to
-- reply" rather than have the product spend a refused send finding out.

update public.prospects p
   set social_comment_id = s.provider_entity_id,
       social_commented_at = s.obtained_at
  from public.prospect_data_sources s
 where s.prospect_id = p.id
   and s.business_id = p.business_id
   and s.field_name = 'engagement_excerpt'
   and s.provider_entity_id is not null
   and p.social_comment_id is null
   and p.social_platform in ('FACEBOOK','INSTAGRAM');

-- Strip the messaging prefix from identity ids written before the distinction
-- was drawn. `social_platform` already says which id space this is, and the
-- prefixed form silently broke promotion: an inbound webhook looks a person up
-- by their bare sender id and never matched.
update public.prospects
   set social_external_id = regexp_replace(social_external_id, '^meta_(psid|igsid):', '')
 where social_external_id like 'meta\_%:%' escape '\';
