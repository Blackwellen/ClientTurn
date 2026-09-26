-- 0110_individual_subscriber_policy: who counts as an individual subscriber,
-- and what a relationship with one actually permits.
--
-- Background and sources: docs/revenue-engine/00-discovery-and-implementation-map.md
-- §6 (Q4, §6.1) and docs/revenue-engine/01-evidence-register.md §2.
--
-- ## What changes
--
-- 1. **Cold (UK): SOLE_TRADER and PARTNERSHIP move from review to blocked.**
--    The ICO lists the corporate subscribers as companies, LLPs, Scottish
--    partnerships and government bodies. Sole traders and other partnerships
--    are individual subscribers, and unsolicited electronic marketing to them
--    needs consent or a soft opt-in -- which a cold prospect by definition does
--    not have. "Review" let a person approve exactly that send. UNKNOWN stays
--    review: it sends nothing until someone, or Companies House, resolves it.
--    Scottish partnerships and Scottish LPs are classified CORPORATE upstream
--    (policy/subscriber-classification.ts), so they are unaffected.
--
-- 2. **Warm: individual subscribers need more than "a relationship".**
--    The warm packs had no subscriber rules at all, so any recorded
--    relationship -- including IMPORTED, REFERRAL and an accepted LinkedIn
--    connection -- permitted marketing to a sole trader. The new
--    `individual_subscriber_types` list makes the engine ask what the
--    relationship permits (channel-policy.ts `individualMarketingBasis`):
--      * they contacted us / asked / customer / negotiation / evidenced
--        consent -> marketing permitted (with unsubscribe);
--      * accepted our connection or follow -> conversation only: the message
--        may not market (NON_PROMOTIONAL_ONLY) until they reply;
--      * anything else -> consent first.
--    Social DMs are "electronic mail" under PECR (ICO Guide to PECR), which is
--    why the accepted-connection case cannot simply be treated as consent.
--
-- 3. **Registry reclassification.** Scottish partnerships, and limited
--    partnerships registered in Scotland (company numbers starting SL), are
--    legal persons and therefore corporate subscribers. 0080's lookup filed
--    both as PARTNERSHIP; this corrects existing rows from the reason sentence
--    the lookup wrote, which is the only place the register type was kept.
--
-- The US pack is unchanged: US law draws no individual-subscriber line for
-- email. Previous versions are RETIRED, not deleted, so past decisions remain
-- explicable by the rules that produced them.

update public.compliance_policy_versions
   set status = 'RETIRED'
 where status = 'ACTIVE'
   and version in ('uk-2026.09.2', 'default-2026.09.2');

insert into public.compliance_policy_versions
  (version, name, country_codes, channels, rules_json, status, notes, activated_at)
values
  ('uk-2026.09.3', 'United Kingdom', array['GB'], array['EMAIL','SMS','WHATSAPP','SOCIAL'],
   jsonb_build_object(
     'cold', jsonb_build_object(
       'allowed_channels', jsonb_build_array('EMAIL'),
       'allowed_subscriber_types', jsonb_build_array('CORPORATE'),
       'review_subscriber_types', jsonb_build_array('UNKNOWN'),
       'blocked_subscriber_types', jsonb_build_array('SOLE_TRADER','PARTNERSHIP','INDIVIDUAL'),
       'require_postal_footer', true,
       'require_unsubscribe', true),
     'warm', jsonb_build_object(
       'allowed_channels', jsonb_build_array('EMAIL','SMS','WHATSAPP','SOCIAL'),
       'require_relationship', true,
       'require_unsubscribe', true,
       'individual_subscriber_types', jsonb_build_array('SOLE_TRADER','PARTNERSHIP','INDIVIDUAL','UNKNOWN')),
     'quiet_hours', jsonb_build_object('start', '20:00', 'end', '08:00', 'channels', jsonb_build_array('SMS','WHATSAPP'))
   ),
   'ACTIVE',
   'Cold: corporate subscribers only; sole traders and non-Scottish partnerships blocked. Warm: individual subscribers need contact, custom, negotiation or consent to be marketed to; an accepted connection permits conversation only.',
   now()),

  ('default-2026.09.3', 'Default', array[]::text[], array['EMAIL','SMS','WHATSAPP','SOCIAL'],
   jsonb_build_object(
     'cold', jsonb_build_object(
       'allowed_channels', jsonb_build_array()::jsonb,
       'allowed_subscriber_types', jsonb_build_array()::jsonb,
       'review_subscriber_types', jsonb_build_array('CORPORATE','PARTNERSHIP','SOLE_TRADER','UNKNOWN'),
       'blocked_subscriber_types', jsonb_build_array('INDIVIDUAL')),
     'warm', jsonb_build_object(
       'allowed_channels', jsonb_build_array('EMAIL','SOCIAL'),
       'require_relationship', true,
       'require_unsubscribe', true,
       'individual_subscriber_types', jsonb_build_array('SOLE_TRADER','PARTNERSHIP','INDIVIDUAL','UNKNOWN')),
     'quiet_hours', jsonb_build_object('start', '20:00', 'end', '08:00', 'channels', jsonb_build_array('SMS','WHATSAPP'))
   ),
   'ACTIVE',
   'Fallback pack. Cold refused entirely; warm marketing to individual subscribers needs a basis beyond a bare relationship.',
   now())
on conflict (version) do nothing;

-- Registry reclassification (point 3). The reason sentence is written by
-- companies-house.ts as: ... (<number>), an active <type>.
update public.prospect_companies
   set subscriber_type = 'CORPORATE'
 where subscriber_type = 'PARTNERSHIP'
   and (
     registry_reason like '%, an active scottish-partnership.'
     or registry_reason like '%(SL%), an active limited-partnership.'
   );
