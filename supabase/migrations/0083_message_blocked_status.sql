-- 0083_message_blocked_status: a refused send is not a failed send.
--
-- When `ChannelPolicyService` refuses a message, `blockedByPolicy` wrote
-- `status = 'FAILED'` with `error_code = 'policy:<reason>'`. Two different
-- events, recorded as one:
--
--   * **FAILED** means we tried and the provider would not deliver it. Someone
--     should look at the connection.
--   * **Blocked** means we decided not to try. The recipient opted out, or the
--     workspace has no lawful basis, or a bulk email had no unsubscribe link.
--     Nothing is broken and there is nothing to fix.
--
-- Conflating them costs three things:
--
--   1. **Every rate is wrong.** `getChannelPerformance`, `v4-queries` and
--      `usage-service` all count `('SENT','DELIVERED','FAILED')` as "attempted".
--      A workspace with a clean suppression list — which is the *good* outcome —
--      sees its delivery rate fall, because the messages compliance correctly
--      refused sit in the denominator.
--   2. **Usage is over-counted.** `billing/usage-service` counts the same three
--      statuses. A message we declined to send should not appear on a bill.
--   3. **The operator is misled.** A screen full of red "Failed" against a
--      healthy provider invites somebody to go looking for an outage that is
--      not there, and to eventually start ignoring the colour.
--
-- The reason was always recoverable from `error_code`, and that is the point:
-- it was recoverable by anyone who knew to parse a string prefix, which no
-- query in the codebase did.

alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages add constraint messages_status_check
  check (status in (
    'DRAFT', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'RECEIVED', 'DISCARDED',
    -- New. Terminal, like FAILED, and deliberately not retryable: a policy that
    -- refused this message will refuse it again, and a retry loop against a
    -- suppression list is how a system ends up hammering someone who asked to
    -- be left alone.
    'BLOCKED'
  ));

-- Repair before enforce, in that order, so an environment with history ends up
-- in the same state as a fresh one. Nothing is being guessed here: the
-- `policy:` prefix was written by `blockedByPolicy` and by nothing else, so
-- these rows are exactly the ones that should have been BLOCKED all along.
update public.messages
   set status = 'BLOCKED'
 where status = 'FAILED'
   and error_code like 'policy:%';

comment on column public.messages.status is
  'Lifecycle. BLOCKED is terminal and means the send was refused by policy before it was attempted — distinct from FAILED, which means the provider would not deliver it. Rate and usage denominators count attempts, so they include FAILED and exclude BLOCKED.';

-- Reading "how many did compliance refuse, and why" is a supported question now
-- rather than a string-prefix scan. Partial, so it stays small: the rows it
-- covers are a minority of a table that grows per message.
create index if not exists messages_blocked_idx
  on public.messages (business_id, created_at desc)
  where status = 'BLOCKED';
