-- 0159_voice_return_call_route: inbound return calls (§25) are recorded on
-- their own route, RETURN_CALL, so a call a lead made back to the dedicated
-- number is reported apart from a cold INBOUND call. Widens the three route
-- CHECKs that carry a call's route: voice_calls, voice_minute_ledger and
-- voice_minute_reservations. Only widened; no row changes.
--
-- Current constraints (0150, 0151, column checks, default names):
--   voice_calls_route_check                 QUALIFICATION .. REACTIVATION, INBOUND
--   voice_minute_ledger_route_check         the same, nullable
--   voice_minute_reservations_route_check   the same, nullable
-- voice_route_allocations is unchanged: inbound calls are not allocated.
--
-- Until this is applied, the app's insert of a RETURN_CALL call is refused
-- by the CHECK and the inbound path falls back to the polite message and
-- text back (inbound-core.ts): the AI never answers without a call row.
-- Additive and idempotent. NOT applied by the author.

alter table public.voice_calls drop constraint if exists voice_calls_route_check;
alter table public.voice_calls add constraint voice_calls_route_check
  check (route in ('QUALIFICATION', 'BOOKING_CLOSE', 'DIRECT_CLOSE', 'NURTURE', 'REACTIVATION', 'INBOUND', 'RETURN_CALL'));

alter table public.voice_minute_ledger drop constraint if exists voice_minute_ledger_route_check;
alter table public.voice_minute_ledger add constraint voice_minute_ledger_route_check
  check (route is null or route in ('QUALIFICATION', 'BOOKING_CLOSE', 'DIRECT_CLOSE', 'NURTURE', 'REACTIVATION', 'INBOUND', 'RETURN_CALL'));

alter table public.voice_minute_reservations drop constraint if exists voice_minute_reservations_route_check;
alter table public.voice_minute_reservations add constraint voice_minute_reservations_route_check
  check (route is null or route in ('QUALIFICATION', 'BOOKING_CLOSE', 'DIRECT_CLOSE', 'NURTURE', 'REACTIVATION', 'INBOUND', 'RETURN_CALL'));
