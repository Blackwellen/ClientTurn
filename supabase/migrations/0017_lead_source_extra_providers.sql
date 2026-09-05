-- 0017_lead_source_extra_providers: new ad-platform lead attribution.
--
-- lead_sources.provider was never widened when 0016 added google_ads,
-- microsoft_ads, tiktok_ads and linkedin_ads to integrations.provider_type,
-- so any of those leads' lead_sources insert (see lead-process.ts
-- resolveSource) would violate this check and silently leave the lead
-- unattributed. job payloads.ts's source.provider enum already includes all
-- four (added across concurrent lead-source integration work); this migration
-- catches the database side up to match.

alter table public.lead_sources drop constraint lead_sources_provider_check;
alter table public.lead_sources add constraint lead_sources_provider_check
  check (provider in (
    'meta', 'csv', 'manual', 'test', 'webform',
    'google_ads', 'microsoft_ads', 'tiktok_ads', 'linkedin_ads'
  ));
