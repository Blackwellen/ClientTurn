-- 0167: allow the send_booking_link voice tool in voice_tool_calls.
--
-- The voice QA pass (2026-09-28) added a send_booking_link tool ("just email
-- me" on a call) and edited 0162's CHECK in place, but 0162 had already been
-- applied to production, so the live constraint never gained the value and
-- every send_booking_link call would be refused by the database. This widens
-- the constraint to the list 0162 now declares. Idempotent: on a database
-- built from the edited 0162 it re-creates the same constraint.

alter table public.voice_tool_calls drop constraint if exists voice_tool_calls_tool_check;
alter table public.voice_tool_calls
  add constraint voice_tool_calls_tool_check check (tool in (
    'record_fact', 'check_availability', 'book_meeting', 'calculate_quote', 'send_quote',
    'send_checkout_link', 'send_booking_link', 'transfer_to_human', 'schedule_callback', 'opt_out',
    'log_objection', 'end_call_summary', 'get_call_status'));
