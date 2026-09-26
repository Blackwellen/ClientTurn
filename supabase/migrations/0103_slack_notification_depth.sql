-- 0103_slack_notification_depth: per-event Slack preferences and the daily
-- Slack digest toggle.
--
-- Deliberately separate from the existing notify_handover / notify_booking
-- columns rather than reusing them: those already gate the in-app
-- notification for a *different* set of semantics (queueNotification's own
-- `type`), and a workspace choosing "handover alerts in-app, not in Slack" (or
-- the reverse) is a real, independent preference -- conflating the two would
-- mean nobody could express that combination.

alter table public.business_settings
  add column if not exists slack_notify_new_lead boolean not null default true,
  add column if not exists slack_notify_handover boolean not null default true,
  add column if not exists slack_notify_booking boolean not null default true,
  add column if not exists slack_notify_warm_prospect boolean not null default true,
  add column if not exists slack_digest_enabled boolean not null default false;
