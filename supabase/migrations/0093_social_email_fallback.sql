-- 0093_social_email_fallback: an unanswered connection request is not a dead end.
--
-- The sequencer had one clock for a pending invite: `social_withdraw_after_days`,
-- defaulting to 21. Until it expired the row waited; when it expired the invite
-- was withdrawn and the prospect halted. So a prospect with a perfectly good
-- work email was never emailed, because a connection request went unanswered.
--
-- That conflates two questions which have different answers:
--
--   * **"Should we stop waiting for LinkedIn?"** Soon. Acceptance rates decay
--     fast and a week of silence is a no *on that channel*.
--   * **"Should we take the invite back?"** Later. LinkedIn caps how many
--     invitations an account may have outstanding, so a pending one costs
--     something -- but a late acceptance is common and worth waiting for.
--
-- Splitting them lets the sequence fall back to email after a week while the
-- invite stands for a month. The invite is deliberately **not** withdrawn at
-- the fallback: withdrawing early spends the prospect for nothing, and
-- `markSocialAccepted` still fires if they accept late, at which point the
-- LinkedIn sequence resumes from where it paused.
--
-- The withdrawal default moves 21 -> 30, matching what LinkedIn's own tooling
-- does and giving that late acceptance more room now that nothing is waiting
-- on it.

alter table public.business_data_controls
  -- Null disables the fallback, for a workspace running LinkedIn only.
  add column if not exists social_skip_to_email_after_days integer default 7;

alter table public.business_data_controls
  drop constraint if exists business_data_controls_social_skip_check;
alter table public.business_data_controls
  add constraint business_data_controls_social_skip_check
  check (
    social_skip_to_email_after_days is null
    or social_skip_to_email_after_days between 1 and 60
  );

-- The two windows must not cross. A fallback that fires after the withdrawal
-- would never fire at all -- the row is withdrawn and halted first -- so a
-- workspace that set them that way would have silently disabled the fallback
-- while believing it was on.
alter table public.business_data_controls
  drop constraint if exists business_data_controls_social_windows_ordered;
alter table public.business_data_controls
  add constraint business_data_controls_social_windows_ordered
  check (
    social_skip_to_email_after_days is null
    or social_withdraw_after_days is null
    or social_skip_to_email_after_days <= social_withdraw_after_days
  );

alter table public.business_data_controls
  alter column social_withdraw_after_days set default 30;

alter table public.social_connection_states
  -- When the sequence gave up on LinkedIn for this prospect and moved to email.
  -- Set once. Without it the decision would fire on every sweep between the two
  -- windows, re-enrolling the prospect daily.
  add column if not exists email_fallback_at timestamptz;

-- Rows already past their fallback window when this shipped.
--
-- Deliberately NOT backfilled as though the fallback had happened: leaving
-- `email_fallback_at` null means the next sweep decides afresh and hands them
-- to email properly, with the reason recorded. Marking them done would silently
-- skip the very prospects this migration exists to rescue.
update public.social_connection_states
   set next_action_at = now()
 where state in ('INVITE_SENT', 'INVITE_QUEUED')
   and email_fallback_at is null
   and invite_sent_at is not null
   and invite_sent_at < now() - interval '7 days';
