-- 0072_social_agent_flow: make connect-then-message actually run, 24/7, and let
-- the conversation agent own the thread once someone replies.
--
-- 0067 built the state machine and the caps, and left a comment on
-- `social_connection_states_ready_idx` calling it "the scheduler's due-work
-- query". There was no scheduler. Everything social was human-pull: a person
-- opened the queue, clicked, and the state advanced. That produces a product
-- which *can* do connect-then-message but never does it unattended, and it is
-- the single largest gap between what `lead-routes.ts` promises a customer and
-- what the system performs.
--
-- Four things are missing from the schema before a scheduler can exist:
--
--   1. **A clock.** A state machine with no `next_action_at` cannot be swept.
--      Every advance had to be triggered by a click because nothing recorded
--      when the next one became due.
--   2. **A step counter.** `lead-routes.ts` promises "at most two further
--      messages, spaced out, and only while they have not replied". Without a
--      counter that is a sentence in a document, not a rule.
--   3. **Somewhere for the words to sit before they are sent.** In ASSISTED
--      mode a person performs the action, so the message must be composed,
--      stored and shown *before* it is sent -- and that gap is where the
--      interesting failures live. `messages` cannot hold it: that table
--      requires a `lead_id`, and a prospect is deliberately not a lead yet.
--   4. **Somewhere for the reply to land.** `REPLIED` is a legal state in 0067
--      that nothing could ever reach, because no table held an inbound social
--      message. That is why no reply was ever classified and no booking ever
--      followed.
--
-- The design decision this migration encodes, stated plainly because it is the
-- one worth arguing with: **the AI agent does not run on prospects.** Every
-- conversation the agent owns hangs off `leads` -- qualification, bookings,
-- RLS, the whole runtime in `docs/AGENT_RUNTIME.md`. Making it prospect-native
-- would mean nullable `lead_id` on `conversations` and `messages`, which is a
-- worse system than the one we have.
--
-- So the boundary sits at the reply. Outbound social messages *before* a reply
-- are composed by the deterministic sequencer and never enter the agent
-- runtime. The instant someone replies they have stopped being someone we
-- found and become someone who contacted us -- which is precisely the
-- definition of a Lead in `lead-routes.ts` -- so the prospect is promoted, the
-- whole social thread is copied into a real conversation on the platform's own
-- channel, and the existing agent takes it from there and tries to book.
-- Whether that promotion is automatic or waits for a person is a workspace
-- choice, added to `business_data_controls` below, and it defaults to review.

-- ==========================================================================
-- 1. TikTok joins the channels the inbox already knows
-- ==========================================================================
-- Most of this was already done. 0044 widened `conversations.channel` and
-- `messages.channel` to cover 'messenger', 'instagram' and 'linkedin' when the
-- unified inbox shipped, and added 'multi' to `conversations` for a thread that
-- has moved between channels. Only TikTok is new here.
--
-- The checks are therefore restated in full rather than replaced piecemeal, and
-- 'multi' is carried forward on `conversations` -- dropping it would invalidate
-- every existing cross-channel thread the moment this migration ran. It is
-- deliberately absent from `messages`: a conversation can span channels, but an
-- individual message was always sent on exactly one.
--
-- On the vocabulary: the Facebook channel is 'messenger', not 'facebook'. The
-- distinction is not cosmetic. 'FACEBOOK' is the *platform* a prospect was
-- discovered on, and it is what `social_connection_states.platform` records;
-- Messenger is the *transport* a message travels over, and a person can be
-- discovered on Facebook and never be reachable on Messenger at all. Collapsing
-- the two would make "we found them" and "we can message them" the same column,
-- which is the confusion the whole connect-then-message gate exists to prevent.
-- `lib/messaging/types.ts` keeps the same two words for the same two things.

alter table public.conversations
  drop constraint if exists conversations_channel_check;
alter table public.conversations
  add constraint conversations_channel_check
  check (channel in ('sms','whatsapp','email','multi','messenger','instagram','linkedin','tiktok'));

alter table public.messages
  drop constraint if exists messages_channel_check;
alter table public.messages
  add constraint messages_channel_check
  check (channel in ('sms','whatsapp','email','messenger','instagram','linkedin','tiktok'));

alter table public.inbox_channels
  drop constraint if exists inbox_channels_channel_check;
alter table public.inbox_channels
  add constraint inbox_channels_channel_check
  check (channel in ('EMAIL','SMS','WHATSAPP','MESSENGER','INSTAGRAM','LINKEDIN','TIKTOK'));

-- ==========================================================================
-- 2. The clock and the step counter
-- ==========================================================================

alter table public.social_connection_states
  -- 0 = nothing sent since acceptance. 1 = the opening message. 2 and 3 are
  -- the two permitted follow-ups. There is no step 4, and the sequencer
  -- refuses rather than wrapping.
  add column if not exists sequence_step smallint not null default 0,
  -- When the sweeper should next look at this row. Null means "nothing is
  -- due" -- either it is the recipient's move (INVITE_SENT, awaiting
  -- acceptance) or the sequence is finished. Null is the resting state, which
  -- is what keeps the due-work index partial and small.
  add column if not exists next_action_at timestamptz,
  -- What the sweeper intends to do when that time arrives. Stored rather than
  -- re-derived, so the queue can be shown to a customer before it runs and a
  -- change of state can cancel one specific intent.
  add column if not exists next_action text
    check (next_action is null or next_action in ('INVITE','MESSAGE','FOLLOW_UP','WITHDRAW')),
  add column if not exists last_outbound_at timestamptz,
  add column if not exists withdrawn_at timestamptz,
  -- Per-prospect autopilot, defaulted OFF. Automating a customer's personal
  -- social account is the thing that gets it restricted, so it is opted into,
  -- never inherited from a workspace setting.
  add column if not exists autopilot boolean not null default false,
  -- Consecutive sweeper failures. A row that keeps failing is parked rather
  -- than retried forever: a stuck prospect must not consume the account's daily
  -- cap that a healthy one could have used.
  add column if not exists attempts integer not null default 0,
  -- Set when the sweeper gives up on the row. Distinct from DECLINED, which is
  -- the recipient's decision; this one is ours, and it is recoverable.
  add column if not exists parked_reason text,
  -- Set once the prospect is promoted; the thread lives in `conversations`
  -- from that point and this row stops driving outbound.
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
  -- Why the sequencer stopped touching this row. Shown to the customer, so it
  -- is a sentence rather than a code.
  add column if not exists halted_reason text;

alter table public.social_connection_states
  drop constraint if exists social_connection_states_sequence_step_check;
alter table public.social_connection_states
  add constraint social_connection_states_sequence_step_check
  check (sequence_step between 0 and 3);

-- The follow gate, as a database guarantee rather than a convention.
--
-- A MESSAGE intent on a row that has not been accepted is unsendable on every
-- platform we support and impossible on TikTok, which refuses a direct message
-- until the recipient follows back. Expressing it as a check constraint means
-- no future code path -- a scheduler bug, a manual fix, a later migration --
-- can queue one, which is a stronger promise than reviewing every caller
-- forever.
alter table public.social_connection_states
  drop constraint if exists social_connection_states_message_needs_acceptance;
alter table public.social_connection_states
  add constraint social_connection_states_message_needs_acceptance
  check (
    next_action is null
    or next_action not in ('MESSAGE','FOLLOW_UP')
    or state in ('ACCEPTED','MESSAGED','REPLIED')
  );

-- The sweeper's actual query. Partial, so it stays small however many prospects
-- a workspace has: the vast majority of rows are waiting on a human being and
-- are correctly absent from it.
create index if not exists social_connection_states_due_idx
  on public.social_connection_states (next_action_at)
  where next_action_at is not null
    and parked_reason is null
    and state not in ('DECLINED','BLOCKED');

-- ==========================================================================
-- 3. Outbound: composed, then performed
-- ==========================================================================
-- One row per message the sequencer decided to send. It exists from the moment
-- the words are composed, which in ASSISTED mode is minutes or hours before
-- anyone performs it. A prospect who replies while a follow-up sits in DRAFT
-- must have that follow-up discarded rather than sent; a cap consumed by a
-- colleague in between must block it. Both need the intent to be a durable row
-- rather than a value computed at click time.

create table if not exists public.social_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  account_id uuid references public.social_sending_accounts(id) on delete set null,
  platform text not null
    check (platform in ('LINKEDIN','FACEBOOK','INSTAGRAM','TIKTOK')),

  -- INVITE_NOTE is the 300-character note on a connection request; it is a
  -- different thing from a message and is capped separately by the platform.
  kind text not null
    check (kind in ('INVITE_NOTE','OPENER','FOLLOW_UP')),
  -- Matches `social_connection_states.sequence_step` at composition time.
  sequence_step smallint not null default 0,
  body text not null,

  status text not null default 'DRAFT'
    check (status in ('DRAFT','SENT','DISCARDED','FAILED')),
  -- Why a DRAFT was discarded. Almost always "they replied first", which is
  -- the outcome the sequence exists to be interrupted by.
  discarded_reason text,

  -- Which composer produced the words, so a customer can tell a template from
  -- a model, and an admin can find every message a given path produced.
  composed_by text not null default 'TEMPLATE'
    check (composed_by in ('TEMPLATE','AI','HUMAN')),
  -- Present when composed_by = 'AI'. Null for a template.
  model_ref text,

  due_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid references auth.users(id) on delete set null,
  performed_by text check (performed_by in ('ASSISTED','PARTNER_API')),
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists social_outbound_messages_set_updated_at on public.social_outbound_messages;
create trigger social_outbound_messages_set_updated_at
  before update on public.social_outbound_messages
  for each row execute function public.set_updated_at();

-- At most one message may be outstanding per prospect per platform. Without
-- this a sweep that runs twice -- a retried job, two workers -- composes two
-- openers, and in ASSISTED mode a person sends both.
create unique index if not exists social_outbound_messages_pending_idx
  on public.social_outbound_messages (prospect_id, platform)
  where status = 'DRAFT';

create index if not exists social_outbound_messages_queue_idx
  on public.social_outbound_messages (business_id, status, due_at);

-- ==========================================================================
-- 4. Inbound: the state that was previously unreachable
-- ==========================================================================

create table if not exists public.social_inbound_replies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  platform text not null
    check (platform in ('LINKEDIN','FACEBOOK','INSTAGRAM','TIKTOK')),

  body text not null,
  received_at timestamptz not null default now(),

  -- The platform's own id for the message where there is one, or a hash of the
  -- body and timestamp where a person is transcribing it. Either way this is
  -- what makes ingestion idempotent, which matters most on the partner-API
  -- path where a webhook will be redelivered.
  external_ref text not null,

  -- Recorded rather than derived on read: the classification is what decided
  -- whether a promotion happened, and re-running a classifier months later on
  -- a changed model would silently rewrite history.
  classification text
    check (classification in (
      'INTERESTED','QUESTION','OBJECTION','NOT_NOW','WRONG_PERSON','OPT_OUT','UNCLEAR'
    )),
  classified_at timestamptz,

  -- Set when this reply caused a promotion. Null on later replies in the same
  -- thread, which land on the lead's conversation instead.
  promoted_lead_id uuid references public.leads(id) on delete set null,

  -- ASSISTED replies are entered by a person; PARTNER_API ones arrive on a
  -- webhook. Provenance matters because only one of them is machine-verified.
  ingested_by text not null default 'ASSISTED'
    check (ingested_by in ('ASSISTED','PARTNER_API')),
  ingested_by_user_id uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now()
);

-- Idempotency. A redelivered webhook and a double-submitted form both collapse
-- onto one row, so one reply can never trigger two promotions.
create unique index if not exists social_inbound_replies_external_idx
  on public.social_inbound_replies (business_id, platform, external_ref);

create index if not exists social_inbound_replies_prospect_idx
  on public.social_inbound_replies (business_id, prospect_id, received_at desc);

-- ==========================================================================
-- 5. Profile photos -- see 0073
-- ==========================================================================
-- This migration originally added `avatar_url`, `avatar_source` and
-- `avatar_expires_at` to `prospects`. 0073 owns them now, alongside the
-- platform handle and the platform-scoped id they belong with, and it states
-- the reasoning in full: a reference with an expiry, never a stored copy,
-- because LinkedIn's terms forbid retaining member images and Meta's URLs are
-- signed and short-lived.
--
-- Declaring the same three columns in two migrations was harmless -- both used
-- `if not exists` -- but it left two places to look for the rule and two
-- places to change it. The columns live in 0073.

-- ==========================================================================
-- 6. How autonomous the workspace wants this to be
-- ==========================================================================
-- These live with the rest of the workspace's stated position rather than on
-- the sending account, because they are a policy choice about the business,
-- not a property of one LinkedIn login.

alter table public.business_data_controls
  -- Off by default. Turning it on means the product performs actions on a
  -- personal social account without a person in the loop, which is the
  -- decision that gets accounts restricted -- so it is opt-in, per workspace,
  -- and it still requires an account in PARTNER_API mode to have any effect.
  add column if not exists social_autonomous_sending boolean not null default false,
  -- Whether a positive reply promotes the prospect to a Lead on its own, or
  -- waits for a person. Default false keeps `lead-routes.ts`'s promise that
  -- promotion is a human decision; a workspace running high volume can turn it
  -- on and let the agent pick the conversation up within seconds.
  add column if not exists social_auto_promote_on_reply boolean not null default false,
  -- Days a pending invite may sit before it is withdrawn to free the
  -- allowance. Nullable so a workspace can disable withdrawal entirely.
  add column if not exists social_withdraw_after_days integer default 21,
  -- Hours between the opening message and each follow-up.
  add column if not exists social_follow_up_gap_hours integer not null default 96,
  -- Hard ceiling on follow-ups after the opener, enforced by the sequencer
  -- alongside the 0..3 check on sequence_step.
  add column if not exists social_max_follow_ups smallint not null default 2;

alter table public.business_data_controls
  drop constraint if exists business_data_controls_social_withdraw_check;
alter table public.business_data_controls
  add constraint business_data_controls_social_withdraw_check
  check (social_withdraw_after_days is null or social_withdraw_after_days between 3 and 90);

alter table public.business_data_controls
  drop constraint if exists business_data_controls_social_gap_check;
alter table public.business_data_controls
  add constraint business_data_controls_social_gap_check
  check (social_follow_up_gap_hours between 24 and 720);

alter table public.business_data_controls
  drop constraint if exists business_data_controls_social_max_follow_ups_check;
alter table public.business_data_controls
  add constraint business_data_controls_social_max_follow_ups_check
  check (social_max_follow_ups between 0 and 2);

-- ==========================================================================
-- 7. RLS
-- ==========================================================================

alter table public.social_outbound_messages enable row level security;
alter table public.social_outbound_messages force row level security;
alter table public.social_inbound_replies enable row level security;
alter table public.social_inbound_replies force row level security;

do $rls$
declare t text;
begin
  foreach t in array array['social_outbound_messages','social_inbound_replies'] loop
    execute format($f$
      drop policy if exists %1$s_select on public.%1$s;
      create policy %1$s_select on public.%1$s
        for select to authenticated
        using (exists (
          select 1 from public.business_members m
           where m.business_id = %1$s.business_id
             and m.user_id = auth.uid()
        ));
    $f$, t);

    -- Read-only to the browser, matching 0067. A client that could insert an
    -- outbound row could make the sequencer send words nobody composed, and
    -- one that could insert an inbound reply could forge a promotion.
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $rls$;

-- ==========================================================================
-- 8. The due-work queries
-- ==========================================================================
-- The sweeper fans out one job per workspace: doing the work in a single job
-- would mean one job holding every workspace's caps, and one slow provider
-- stalling everybody. So the function returns *which* workspaces have work,
-- and the per-workspace job reads the rows through the view.

create or replace function public.social_businesses_with_due_work(
  p_limit integer default 200
)
returns table (business_id uuid, due_count integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select s.business_id, count(*)::int as due_count
    from public.social_connection_states s
   where s.next_action_at is not null
     and s.next_action_at <= now()
     and s.parked_reason is null
     and s.state not in ('DECLINED','BLOCKED')
   group by s.business_id
   order by count(*) desc
   limit p_limit;
$fn$;

-- Server-side only: the sweeper runs as the service role. No grant to
-- authenticated, because a member has no business enumerating other
-- workspaces' due counts.
revoke all on function public.social_businesses_with_due_work(integer)
  from public, anon, authenticated;

-- What is due, oldest first so a backlog drains fairly rather than by whichever
-- prospect happens to sort first. security_invoker so it is readable only
-- through the caller's own RLS: the view must not become a way to read another
-- workspace's pipeline.
create or replace view public.social_due_actions
with (security_invoker = true) as
  select
    s.id,
    s.business_id,
    s.prospect_id,
    s.account_id,
    s.platform,
    s.state,
    s.next_action,
    s.next_action_at,
    s.sequence_step,
    s.attempts,
    s.autopilot,
    s.conversation_id
  from public.social_connection_states s
  where s.next_action_at is not null
    and s.next_action_at <= now()
    and s.parked_reason is null
    and s.state not in ('DECLINED','BLOCKED')
  order by s.next_action_at asc;

revoke all on public.social_due_actions from anon;
grant select on public.social_due_actions to authenticated;

-- ==========================================================================
-- 9. Backfill
-- ==========================================================================
-- Rows that predate the clock. An ACCEPTED prospect that has never been
-- messaged is due immediately -- that is the backlog the missing scheduler
-- created. An INVITE_SENT row is left null: it is waiting on the recipient,
-- and the withdrawal sweep finds it by `invite_sent_at`, not by this clock.

update public.social_connection_states
   set next_action_at = now(),
       next_action = 'MESSAGE'
 where state = 'ACCEPTED'
   and next_action_at is null
   and messaged_at is null;
