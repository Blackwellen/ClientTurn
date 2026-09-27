-- 0155_context_intent_signal_types: carry the find-leads intent catalogue
-- into lead context.
--
-- NOT APPLIED by the change that added it. Apply with the deploy that ships
-- the code: until it is applied, a promoted prospect whose intent event maps
-- to one of the new types cannot record that CONTEXT signal (the insert is
-- refused by the old CHECK).
--
-- qualification-intelligence/types.ts CONTEXT_SIGNAL_TYPES gains twelve
-- types, each mapped from find-leads/intent-catalogue.ts in
-- qualification-intelligence/signals.ts CONTEXT_BY_INTENT_TYPE:
--   EXPANSION (NEW_OFFICE, REGION_EXPANSION, HEADCOUNT_GROWTH),
--   LEADERSHIP_HIRE (SENIOR_HIRE_*, LEADERSHIP_CHANGE, NEW_DIRECTOR),
--   KEY_DEPARTURE, ACQUISITION (ACQUISITION_MERGER), REBRAND,
--   WEBSITE_RELAUNCH, PRODUCT_LAUNCH, AWARD (AWARD_ACCREDITATION),
--   PARTNERSHIP (NEW_PARTNERSHIP), FILING_DEADLINE (REGULATORY_DEADLINE),
--   ACCOUNTS_GROWTH, CONTRACT_RENEWAL (CONTRACT_RENEWAL_WINDOW).
-- All are category CONTEXT, polarity POSITIVE, and decay like the other
-- CONTEXT types (freshness_days / 2, stop at the event's expires_at).
-- Only the CHECK list changes; no data, RLS or index change.

alter table public.lead_intent_signals drop constraint if exists lead_intent_signals_signal_type_check;
alter table public.lead_intent_signals add constraint lead_intent_signals_signal_type_check
  check (signal_type in (
    'BOOKING_REQUEST','DEMO_REQUEST','CALLBACK_REQUEST','QUOTE_REQUEST','PRICING_REQUEST',
    'PURCHASE_REQUEST','TRIAL_OR_SIGNUP_REQUEST','IMPLEMENTATION_QUESTION','INBOUND_ENQUIRY',
    'STATED_PROBLEM','GENERAL_QUESTION',
    'URGENCY','TIMEFRAME','DISSATISFACTION_CURRENT','REPLACEMENT_SEARCH','COMPETITOR_COMPARISON',
    'PRICING_CONCERN_ENGAGED','READY_TO_MEET','READY_TO_BUY',
    'CONVERTING_PAGE_PRICING','CONVERTING_PAGE_DEMO','REPEAT_SUBMISSION','FAST_REPLY',
    'BOOKING_LINK_OPENED',
    'FUNDING','HIRING','JOB_CHANGE','TECH_CHANGE','TENDER',
    'EXPANSION','LEADERSHIP_HIRE','KEY_DEPARTURE','ACQUISITION','REBRAND','WEBSITE_RELAUNCH',
    'PRODUCT_LAUNCH','AWARD','PARTNERSHIP','FILING_DEADLINE','ACCOUNTS_GROWTH','CONTRACT_RENEWAL',
    'NOT_INTERESTED','NO_NEED','WRONG_PERSON','NOT_NOW','UNSUBSCRIBE','COMPLAINT','NON_LEAD',
    'NO_SHOW','OPPORTUNITY_LOST'));
