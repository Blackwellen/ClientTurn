-- 0038_v4_core_extensions: the changes V4 makes to tables V3 already owns, plus
-- the platform reference data the new services read on their first call.
--
-- Kept in one migration so the "what did V4 change about V3?" answer is a
-- single file rather than a hunt across eight.

-- ------------------------------------------------------------------- leads
-- Manual and sourced leads need to say where they came from and what they are
-- being driven toward. `source_id` still points at lead_sources for ad-platform
-- attribution; these columns carry the V4 additions that have no ad campaign.
alter table public.leads
  add column if not exists conversion_goal_id uuid references public.conversion_goals(id) on delete set null,
  add column if not exists company_name text,
  add column if not exists estimated_value numeric(12,2),
  add column if not exists promoted_from_prospect_id uuid references public.prospects(id) on delete set null,
  add column if not exists promoted_at timestamptz,
  add column if not exists source_campaign_id uuid references public.outreach_campaigns(id) on delete set null,
  add column if not exists sourcing_run_id uuid references public.sourcing_runs(id) on delete set null,
  add column if not exists intake_method text,
  add column if not exists subscriber_type text,
  add column if not exists relationship_type text;

alter table public.leads
  drop constraint if exists leads_intake_method_check;
alter table public.leads
  add constraint leads_intake_method_check
  check (intake_method is null or intake_method in (
    'MANUAL','PHONE_CALL','WALK_IN','REFERRAL','EVENT','IMPORT','PIPEDRIVE',
    'META','WEBFORM','CLIENTTURN_SOURCING','API','OTHER'));

create index if not exists leads_promoted_from_idx
  on public.leads (business_id, promoted_from_prospect_id)
  where promoted_from_prospect_id is not null;
create index if not exists leads_source_campaign_idx
  on public.leads (business_id, source_campaign_id)
  where source_campaign_id is not null;
create index if not exists leads_conversion_goal_idx
  on public.leads (business_id, conversion_goal_id)
  where conversion_goal_id is not null;

-- V4 adds intake paths that have no ad platform behind them. Widened rather
-- than replaced so every existing lead_sources row stays valid.
alter table public.lead_sources drop constraint if exists lead_sources_provider_check;
alter table public.lead_sources add constraint lead_sources_provider_check
  check (provider in (
    'meta', 'csv', 'manual', 'test', 'webform',
    'google_ads', 'microsoft_ads', 'tiktok_ads', 'linkedin_ads',
    'clientturn_sourcing', 'pipedrive', 'import', 'phone_call', 'walk_in',
    'referral', 'event', 'api', 'other'
  ));

-- ---------------------------------------------------------- subscriptions
-- Entitlement snapshot extended for the V4 allowances. These mirror
-- plan_entitlements so a limit check stays one read, exactly as V3 intended.
alter table public.subscriptions
  add column if not exists plan_amount_minor bigint not null default 0,
  add column if not exists verified_prospect_limit integer not null default 0,
  add column if not exists search_capacity integer not null default 0,
  add column if not exists intent_monitor_limit integer not null default 0,
  add column if not exists sender_limit integer not null default 1,
  add column if not exists communication_pool_minor bigint not null default 0,
  add column if not exists sourcing_enabled boolean not null default false,
  add column if not exists cold_email_enabled boolean not null default false,
  add column if not exists analytics_tier text not null default 'CORE'
    check (analytics_tier in ('CORE','FULL','ADVANCED')),
  add column if not exists auto_optimize_tier text not null default 'RECOMMENDATIONS'
    check (auto_optimize_tier in ('NONE','RECOMMENDATIONS','BOUNDED','ADVANCED'));

-- --------------------------------------------------------- usage metering
-- V4 meters units the existing enum has no name for. This list is the union of
-- 0009's original five, 0018's granular billing metrics and the V4 additions --
-- dropping any of them would invalidate rows already in the ledger.
alter table public.usage_events drop constraint if exists usage_events_metric_check;
alter table public.usage_events add constraint usage_events_metric_check
  check (metric in (
    'lead_processed', 'message_sent', 'message_received', 'ai_call', 'campaign_message',
    'sms_outbound_segment', 'sms_inbound_segment', 'whatsapp_message',
    'ai_mini_input_token', 'ai_mini_cached_token', 'ai_mini_output_token',
    'ai_nano_input_token', 'ai_nano_cached_token', 'ai_nano_output_token',
    'email_sent', 'reactivation_contact', 'active_user',
    'verified_prospect', 'search_run', 'intent_monitor_run', 'prospect_promoted',
    'social_touch', 'cold_email_sent', 'enrichment_unit', 'verification_unit',
    'discovery_lookup'
  ));

alter table public.usage_counters drop constraint if exists usage_counters_metric_check;
alter table public.usage_counters add constraint usage_counters_metric_check
  check (metric in (
    'lead_processed', 'message_sent', 'message_received', 'ai_call', 'campaign_message',
    'sms_outbound_segment', 'sms_inbound_segment', 'whatsapp_message',
    'ai_mini_input_token', 'ai_mini_cached_token', 'ai_mini_output_token',
    'ai_nano_input_token', 'ai_nano_cached_token', 'ai_nano_output_token',
    'email_sent', 'reactivation_contact', 'active_user',
    'verified_prospect', 'search_run', 'intent_monitor_run', 'prospect_promoted',
    'social_touch', 'cold_email_sent', 'enrichment_unit', 'verification_unit',
    'discovery_lookup'
  ));

-- ------------------------------------------------------------------- jobs
-- The V4 queue families. `jobs.type` is unconstrained text in 0009, so nothing
-- to widen — this index just keeps the new dispatchers' due-work scans cheap.
create index if not exists jobs_type_state_idx
  on public.jobs (type, state, run_at)
  where state = 'pending';

-- ------------------------------------------------------- integration types
-- Mailbox connections and CRM sync arrive as their own tables (0029, 0035),
-- but the V3 `integrations` row is still what Settings → Connections lists, so
-- the provider vocabulary has to know about them.
alter table public.integrations drop constraint if exists integrations_provider_type_check;
alter table public.integrations add constraint integrations_provider_type_check
  check (provider_type in (
    -- Everything 0023_salesforce_provider already permitted, unchanged.
    'meta', 'twilio_sms', 'twilio_whatsapp', 'whatsapp_cloud',
    'google_calendar', 'calendly', 'email',
    'google_ads', 'microsoft_ads', 'tiktok_ads', 'linkedin_ads',
    'slack', 'hubspot', 'zoho_crm', 'salesforce',
    -- V4 additions.
    'google_workspace', 'microsoft_365', 'imap_smtp', 'pipedrive'
  ));

alter table public.crm_push_records drop constraint if exists crm_push_records_provider_type_check;
alter table public.crm_push_records add constraint crm_push_records_provider_type_check
  check (provider_type in ('hubspot', 'zoho_crm', 'salesforce', 'pipedrive'));

-- ----------------------------------------------------------- audit actions
-- `audit_log.action` is free text in 0009; no constraint to widen. The V4
-- action vocabulary is documented in lib/audit-actions.ts.

-- ==========================================================================
-- Reference data
-- ==========================================================================

-- ------------------------------------------------------- plan entitlements
-- Provisional V4 allowances (section 97), seeded into the entitlement table
-- 0018 already defined rather than a rival table. Deliberately rows, not code:
-- confirming these against real data-provider COGS must not need a deploy.
--
-- soft_limit is where the UI starts warning; hard_limit is what the server
-- enforces. A boolean capability is stored as hard_limit 1/0 with unit
-- 'boolean', so one table serves both quantities and switches.
insert into public.plan_entitlements (plan_key, metric, soft_limit, hard_limit, overage_allowed, overage_price, unit, description)
values
  ('trial',      'verified_prospect',   18,    20,     false, null,   'prospects/month', 'Verified sourced prospects per month'),
  ('trial',      'search_run',          1,     2,      false, null,   'runs/month',      'Sourcing runs per month'),
  ('trial',      'saved_search',        1,     1,      false, null,   'searches',        'Concurrent saved or recurring searches'),
  ('trial',      'intent_monitor',      1,     1,      false, null,   'monitors',        'Active intent monitors'),
  ('trial',      'sender_identity',     1,     1,      false, null,   'senders',         'Connected sending identities'),
  ('trial',      'sourcing_enabled',    0,     0,      false, null,   'boolean',         'Find Leads sourcing available'),
  ('trial',      'cold_email_enabled',  0,     0,      false, null,   'boolean',         'Eligible cold email available'),
  ('trial',      'email_sent',          40,    50,     false, null,   'emails/month',    'Outbound emails per month'),

  ('starter',    'verified_prospect',   90,    100,    true,  0.30,   'prospects/month', 'Verified sourced prospects per month'),
  ('starter',    'search_run',          8,     10,     false, null,   'runs/month',      'Sourcing runs per month'),
  ('starter',    'saved_search',        2,     2,      false, null,   'searches',        'Concurrent saved or recurring searches'),
  ('starter',    'intent_monitor',      2,     2,      false, null,   'monitors',        'Active intent monitors'),
  ('starter',    'sender_identity',     1,     1,      false, null,   'senders',         'Connected sending identities'),
  ('starter',    'sourcing_enabled',    1,     1,      false, null,   'boolean',         'Find Leads sourcing available'),
  ('starter',    'cold_email_enabled',  1,     1,      false, null,   'boolean',         'Eligible cold email available'),
  ('starter',    'email_sent',          1800,  2000,   true,  0.0040, 'emails/month',    'Outbound emails per month'),

  ('growth',     'verified_prospect',   450,   500,    true,  0.26,   'prospects/month', 'Verified sourced prospects per month'),
  ('growth',     'search_run',          40,    50,     false, null,   'runs/month',      'Sourcing runs per month'),
  ('growth',     'saved_search',        10,    10,     false, null,   'searches',        'Concurrent saved or recurring searches'),
  ('growth',     'intent_monitor',      13,    15,     false, null,   'monitors',        'Active intent monitors'),
  ('growth',     'sender_identity',     3,     3,      false, null,   'senders',         'Connected sending identities'),
  ('growth',     'sourcing_enabled',    1,     1,      false, null,   'boolean',         'Find Leads sourcing available'),
  ('growth',     'cold_email_enabled',  1,     1,      false, null,   'boolean',         'Eligible cold email available'),
  ('growth',     'email_sent',          7000,  8000,   true,  0.0035, 'emails/month',    'Outbound emails per month'),

  ('pro',        'verified_prospect',   1800,  2000,   true,  0.22,   'prospects/month', 'Verified sourced prospects per month'),
  ('pro',        'search_run',          160,   200,    false, null,   'runs/month',      'Sourcing runs per month'),
  ('pro',        'saved_search',        30,    30,     false, null,   'searches',        'Concurrent saved or recurring searches'),
  ('pro',        'intent_monitor',      45,    50,     false, null,   'monitors',        'Active intent monitors'),
  ('pro',        'sender_identity',     10,    10,     false, null,   'senders',         'Connected sending identities'),
  ('pro',        'sourcing_enabled',    1,     1,      false, null,   'boolean',         'Find Leads sourcing available'),
  ('pro',        'cold_email_enabled',  1,     1,      false, null,   'boolean',         'Eligible cold email available'),
  ('pro',        'email_sent',          22000, 25000,  true,  0.0030, 'emails/month',    'Outbound emails per month'),

  ('enterprise', 'verified_prospect',   9000,  10000,  true,  0.18,   'prospects/month', 'Verified sourced prospects per month'),
  ('enterprise', 'search_run',          800,   1000,   false, null,   'runs/month',      'Sourcing runs per month'),
  ('enterprise', 'saved_search',        100,   100,    false, null,   'searches',        'Concurrent saved or recurring searches'),
  ('enterprise', 'intent_monitor',      180,   200,    false, null,   'monitors',        'Active intent monitors'),
  ('enterprise', 'sender_identity',     50,    50,     false, null,   'senders',         'Connected sending identities'),
  ('enterprise', 'sourcing_enabled',    1,     1,      false, null,   'boolean',         'Find Leads sourcing available'),
  ('enterprise', 'cold_email_enabled',  1,     1,      false, null,   'boolean',         'Eligible cold email available'),
  ('enterprise', 'email_sent',          90000, 100000, true,  0.0025, 'emails/month',    'Outbound emails per month')
on conflict (plan_key, metric) do nothing;

-- ------------------------------------------------------ compliance packs
-- Seed packs so ChannelPolicyService always has an ACTIVE version to stamp on
-- a decision. These are engineering defaults and are intentionally
-- conservative: cold is email-only, B2B-only, and consumer cold automation is
-- off. They must be reviewed by counsel before broad rollout (§92).
insert into public.compliance_policy_versions (version, name, country_codes, channels, rules_json, status, notes, activated_at)
values
  ('uk-2026.09.1', 'United Kingdom', array['GB'], array['EMAIL','SMS','WHATSAPP','SOCIAL'],
   jsonb_build_object(
     'cold', jsonb_build_object(
       'allowed_channels', jsonb_build_array('EMAIL'),
       'allowed_subscriber_types', jsonb_build_array('CORPORATE','PARTNERSHIP'),
       'review_subscriber_types', jsonb_build_array('SOLE_TRADER','UNKNOWN'),
       'blocked_subscriber_types', jsonb_build_array('INDIVIDUAL'),
       'require_postal_footer', true,
       'require_unsubscribe', true),
     'warm', jsonb_build_object(
       'allowed_channels', jsonb_build_array('EMAIL','SMS','WHATSAPP'),
       'require_relationship', true,
       'require_unsubscribe', true),
     'quiet_hours', jsonb_build_object('start', '20:00', 'end', '08:00', 'channels', jsonb_build_array('SMS','WHATSAPP'))
   ),
   'ACTIVE',
   'Engineering default. Conservative: cold is B2B email only. Requires legal review before broad rollout.',
   now()),
  ('us-2026.09.1', 'United States', array['US'], array['EMAIL','SMS','WHATSAPP','SOCIAL'],
   jsonb_build_object(
     'cold', jsonb_build_object(
       'allowed_channels', jsonb_build_array('EMAIL'),
       'allowed_subscriber_types', jsonb_build_array('CORPORATE','PARTNERSHIP','SOLE_TRADER'),
       'review_subscriber_types', jsonb_build_array('UNKNOWN'),
       'blocked_subscriber_types', jsonb_build_array('INDIVIDUAL'),
       'require_postal_footer', true,
       'require_unsubscribe', true),
     'warm', jsonb_build_object(
       'allowed_channels', jsonb_build_array('EMAIL','SMS','WHATSAPP'),
       'require_relationship', true,
       'require_unsubscribe', true),
     'quiet_hours', jsonb_build_object('start', '21:00', 'end', '08:00', 'channels', jsonb_build_array('SMS','WHATSAPP'))
   ),
   'ACTIVE',
   'Engineering default. Conservative: cold is B2B email only. Requires legal review before broad rollout.',
   now()),
  ('default-2026.09.1', 'Default', array[]::text[], array['EMAIL','SMS','WHATSAPP','SOCIAL'],
   jsonb_build_object(
     'cold', jsonb_build_object(
       'allowed_channels', jsonb_build_array()::jsonb,
       'allowed_subscriber_types', jsonb_build_array()::jsonb,
       'review_subscriber_types', jsonb_build_array('CORPORATE','PARTNERSHIP','SOLE_TRADER','UNKNOWN'),
       'blocked_subscriber_types', jsonb_build_array('INDIVIDUAL')),
     'warm', jsonb_build_object(
       'allowed_channels', jsonb_build_array('EMAIL'),
       'require_relationship', true,
       'require_unsubscribe', true),
     'quiet_hours', jsonb_build_object('start', '20:00', 'end', '08:00', 'channels', jsonb_build_array('SMS','WHATSAPP'))
   ),
   'ACTIVE',
   'Fallback for any country without its own pack. Cold outreach is not permitted under this pack.',
   now())
on conflict (version) do nothing;

-- -------------------------------------------------------- provider prices
-- Placeholders for the V4 acquisition capabilities, in the same shape and
-- currency 0018 seeded. Real rates are maintained in Admin -> Platform Settings
-- -> Price Book; `capability` is what the provider adapters resolve against.
insert into public.provider_price_book (provider, product, region, currency, unit, unit_cost, capability, notes)
values
  ('company_search',  'company_lookup',     'GB', 'USD', 'per_unit', 0.0100, 'COMPANY_SEARCH',       'Seeded placeholder'),
  ('contact_search',  'contact_lookup',     'GB', 'USD', 'per_unit', 0.0400, 'CONTACT_DISCOVERY',    'Seeded placeholder'),
  ('company_enrich',  'company_profile',    'GB', 'USD', 'per_unit', 0.0200, 'COMPANY_ENRICHMENT',   'Seeded placeholder'),
  ('contact_enrich',  'contact_profile',    'GB', 'USD', 'per_unit', 0.0800, 'CONTACT_ENRICHMENT',   'Seeded placeholder'),
  ('email_verify',    'mailbox_check',      'GB', 'USD', 'per_unit', 0.0040, 'EMAIL_VERIFICATION',   'Seeded placeholder'),
  ('intent_feed',     'signal_lookup',      'GB', 'USD', 'per_unit', 0.0150, 'INTENT',               'Seeded placeholder'),
  ('website_intel',   'page_fetch',         'GB', 'USD', 'per_unit', 0.0010, 'WEBSITE_INTELLIGENCE', 'Seeded placeholder'),
  ('resend',          'transactional_send', 'EU', 'USD', 'per_unit', 0.0004, 'EMAIL_SEND',           'Platform transactional email'),
  ('google',          'gmail_api_send',     'EU', 'USD', 'per_unit', 0.0000, 'EMAIL_SEND',           'Customer mailbox, no direct per-send cost'),
  ('microsoft',       'graph_api_send',     'EU', 'USD', 'per_unit', 0.0000, 'EMAIL_SEND',           'Customer mailbox, no direct per-send cost')
on conflict do nothing;

-- --------------------------------------------- default affiliate commission
insert into public.affiliate_commission_plans (
  name, description, commission_type, percent, currency, recurring_months,
  attribution_window_days, cookie_window_days, hold_days, minimum_payout_minor,
  is_default, active
) values (
  'Standard 20% recurring',
  'Twenty per cent of subscription revenue for twelve months from the referred customer''s first payment.',
  'RECURRING_PERCENT', 20, 'GBP', 12, 60, 60, 30, 5000, true, true
)
on conflict (name) do nothing;
