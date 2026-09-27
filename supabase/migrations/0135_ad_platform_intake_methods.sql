-- 0135_ad_platform_intake_methods: name every ad platform in leads.intake_method.
--
-- 0038's vocabulary named Meta but no other ad network, so Google Ads,
-- LinkedIn, TikTok and Microsoft Ads lead-form leads were all recorded as
-- OTHER (business-stories run, check B1). Source reporting could not tell a
-- Google Ads lead from an unknown one. Every existing value is kept.

alter table public.leads drop constraint if exists leads_intake_method_check;
alter table public.leads add constraint leads_intake_method_check
  check (intake_method is null or intake_method in (
    'MANUAL','PHONE_CALL','WALK_IN','REFERRAL','EVENT','IMPORT','PIPEDRIVE','META',
    'WEBFORM','CLIENTTURN_SOURCING','API','OTHER',
    'GOOGLE_ADS','LINKEDIN_ADS','TIKTOK_ADS','MICROSOFT_ADS'));

-- Back-fill leads whose first touch was a known ad platform's form.
update public.leads l
   set intake_method = case t.provider
         when 'google_ads' then 'GOOGLE_ADS'
         when 'linkedin_ads' then 'LINKEDIN_ADS'
         when 'tiktok_ads' then 'TIKTOK_ADS'
         when 'microsoft_ads' then 'MICROSOFT_ADS'
       end
  from (
    select distinct on (lead_id) lead_id, business_id, provider
      from public.lead_touches
     where source_type = 'AD_FORM'
     order by lead_id, created_at asc
  ) t
 where t.lead_id = l.id
   and t.business_id = l.business_id
   and l.intake_method = 'OTHER'
   and t.provider in ('google_ads','linkedin_ads','tiktok_ads','microsoft_ads');
