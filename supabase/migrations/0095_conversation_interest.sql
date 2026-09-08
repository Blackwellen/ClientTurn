-- 0095_conversation_interest: whether a conversation is one worth opening.
--
-- Split out of 0094, which had already been applied when this was written. A
-- migration that has run is immutable -- appending to it means the appended
-- part silently never executes, which is a worse failure than an extra file.

-- The inbox could filter by channel and by unread, which answers "where is it"
-- and "have I looked at it" -- and neither answers the question somebody
-- actually opens the inbox with, which is "who wants to talk to me".
--
-- The answer already existed and was thrown away. Every social reply is
-- classified on arrival (`social_inbound_replies.classification`) and the agent
-- classifies inbound messages too, but nothing carried that verdict onto the
-- thread, so the inbox had no idea an interested reply had landed.
--
-- Stored on the conversation rather than derived on read for the same reason
-- the classification itself is stored: it is the verdict that was reached at
-- the time, and re-deriving it later from a changed classifier would silently
-- rewrite what the inbox showed yesterday.

alter table public.conversations
  add column if not exists interest text;

alter table public.conversations
  drop constraint if exists conversations_interest_check;
alter table public.conversations
  add constraint conversations_interest_check
  check (interest is null or interest in (
    'INTERESTED',   -- they want to continue
    'QUESTION',     -- asking something before deciding
    'OBJECTION',    -- a specific reason it does not suit
    'NOT_NOW',      -- timing, not the offer
    'WRONG_PERSON', -- not their remit
    'OPT_OUT',      -- asked not to be contacted
    'UNCLEAR'       -- could not be placed
  ));

-- The inbox's "Interested" tab. Partial, because the overwhelming majority of
-- conversations have no verdict yet and scanning them to find the handful that
-- do is the query this index exists to avoid.
create index if not exists conversations_interest_idx
  on public.conversations (business_id, interest, last_message_at desc)
  where interest is not null;
