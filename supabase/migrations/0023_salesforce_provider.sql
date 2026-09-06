-- 0023_salesforce_provider: Salesforce as a CRM push destination.
--
-- The Connections surface lists Salesforce alongside HubSpot and Zoho. The
-- platform does not yet hold Salesforce credentials, so it renders as "Not yet
-- available" until SALESFORCE_CLIENT_ID/SECRET are provisioned — but the
-- database has to accept the provider before any connection row can exist,
-- and widening a check constraint is non-destructive.

alter table public.integrations drop constraint integrations_provider_type_check;
alter table public.integrations add constraint integrations_provider_type_check
  check (provider_type in (
    'meta', 'twilio_sms', 'twilio_whatsapp', 'whatsapp_cloud',
    'google_calendar', 'calendly', 'email',
    'google_ads', 'microsoft_ads', 'tiktok_ads', 'linkedin_ads',
    'slack', 'hubspot', 'zoho_crm', 'salesforce'
  ));

alter table public.crm_push_records drop constraint crm_push_records_provider_type_check;
alter table public.crm_push_records add constraint crm_push_records_provider_type_check
  check (provider_type in ('hubspot', 'zoho_crm', 'salesforce'));

-- Connections reads every integration for one workspace on each render.
create index if not exists integrations_business_provider_idx
  on public.integrations (business_id, provider_type);
