-- 0112_message_send_claim: one caller reaches the carrier, and a handover can
-- still be acknowledged.
--
-- 1. SENDING. `performSend` used to check "still QUEUED?" and then call the
--    provider, with nothing held in between. Two jobs for the same message (a
--    stale lock released after the provider accepted it but before `markSent`,
--    or the second job a reschedule enqueues under a distinct key) could both
--    pass the check and both send. The send path now moves the row
--    QUEUED -> SENDING in one conditional update immediately before the
--    carrier call, and only the caller whose update matched may send. A row
--    found in SENDING later is a send with an unknown outcome: it is flagged
--    for a person and never dispatched again automatically.
--
-- 2. agent_handover. The acknowledgement sent when the agent hands a
--    conversation to a person is queued after the takeover is set, so as an
--    ordinary `agent` message the send guard refused it for the very takeover
--    it announces. It gets its own origin, exempt from the takeover only.
--
--    The origin list is restated in full. 0029 replaced the list 00241 wrote
--    and dropped `agent` from it (the files sort 00241 before 0029), so an
--    environment built from the files alone may be refusing every agent
--    message. This restores `agent` and keeps `outreach`.

alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages add constraint messages_status_check
  check (status in (
    'DRAFT', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED',
    'DISCARDED', 'BLOCKED',
    -- Written by 0029 and still read by analytics; 0085 dropped them from the
    -- list. A superset cannot invalidate an existing row.
    'BOUNCED', 'COMPLAINED'
  ));

-- A SENDING row is rare and every one of them is a question for a person, so
-- finding them should not be a table scan.
create index if not exists messages_sending_idx
  on public.messages (business_id, created_at desc)
  where status = 'SENDING';

alter table public.messages drop constraint if exists messages_origin_check;
alter table public.messages add constraint messages_origin_check
  check (origin in (
    'automation', 'manual', 'campaign', 'system', 'outreach',
    'agent', 'agent_handover'
  ));
