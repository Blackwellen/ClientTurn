-- 0013_settings: booking configuration held on the workspace rather than on a
-- provider connection, so a workspace can configure booking before (or without)
-- connecting Calendly or Google Calendar.

alter table public.business_settings
  add column if not exists booking_url text,
  add column if not exists appointment_duration_minutes integer not null default 60
    check (appointment_duration_minutes between 5 and 480),
  add column if not exists booking_buffer_minutes integer not null default 0
    check (booking_buffer_minutes between 0 and 240);
