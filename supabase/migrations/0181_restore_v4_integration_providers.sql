-- 0181: restore the V4 integration provider vocabulary.
--
-- 0038_v4_core_extensions widened `integrations_provider_type_check` to add
-- 'google_workspace', 'microsoft_365', 'imap_smtp' and 'pipedrive', and
-- `crm_push_records_provider_type_check` to add 'pipedrive'. 0038 is recorded
-- as applied, but on the live project both constraints still carried the
-- 0023 lists (found 2026-09-30). The consequence: `saveEmailAccount`
-- (provider 'imap_smtp', src/lib/email/store.ts) always failed with "Could not
-- save the email connection", so no workspace could connect its own mailbox,
-- and with no mailbox there is no cold outreach and no email follow-up.
--
-- Widening only: every value the live constraints allow is kept, so no
-- existing row can be invalidated.

alter table public.integrations drop constraint if exists integrations_provider_type_check;
alter table public.integrations add constraint integrations_provider_type_check
  check (provider_type in (
    'meta', 'twilio_sms', 'twilio_whatsapp', 'whatsapp_cloud',
    'google_calendar', 'calendly', 'email',
    'google_ads', 'microsoft_ads', 'tiktok_ads', 'linkedin_ads',
    'slack', 'hubspot', 'zoho_crm', 'salesforce',
    'google_workspace', 'microsoft_365', 'imap_smtp', 'pipedrive'
  ));

alter table public.crm_push_records drop constraint if exists crm_push_records_provider_type_check;
alter table public.crm_push_records add constraint crm_push_records_provider_type_check
  check (provider_type in ('hubspot', 'zoho_crm', 'salesforce', 'pipedrive'));
