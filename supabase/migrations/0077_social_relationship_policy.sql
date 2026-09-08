-- 0077_social_relationship_policy: a message to somebody who accepted your
-- follow is not cold outreach, and the policy engine should stop calling it
-- that.
--
-- ## The problem this fixes
--
-- 0038 seeded the compliance packs conservatively: cold `allowed_channels` is
-- `['EMAIL']` and warm is `['EMAIL','SMS','WHATSAPP']`. Neither list contains
-- SOCIAL. The social scheduler evaluates every action as
-- `channel: SOCIAL, campaignType: COLD`, so the engine returned
-- BLOCKED_COLD_CHANNEL for every prospect and the entire connect-then-message
-- flow halted before it sent anything.
--
-- That was the right default while nothing enforced the follow gate. It is the
-- wrong answer now, and for a reason that is about the facts rather than about
-- convenience.
--
-- ## Why a post-acceptance message is warm
--
-- The product cannot send a social message until `social_connection_states`
-- reaches ACCEPTED, and 0072 made that a check constraint rather than a
-- convention. So by the time a message exists, the recipient has been asked to
-- connect and has said yes. That is an affirmative act by them, and it is
-- precisely the "would this person reasonably expect to hear from us" question
-- that the legitimate-interests balancing test turns on.
--
-- Calling that cold is not caution, it is inaccuracy — and inaccuracy in the
-- direction that makes the product not work. The honest model is:
--
--   * the **follow or connection request itself** is cold. It is unsolicited
--     contact with somebody who has not asked for it. It stays governed by the
--     cold rules, and it is not email, so it is not permitted as cold outreach
--     -- which is correct, because a follow request is not a marketing message
--     and the scheduler does not evaluate it as one.
--   * the **message after acceptance** is warm, on the strength of the
--     relationship the acceptance created.
--
-- ## What this deliberately does not relax
--
-- Adding SOCIAL to the warm channel list changes exactly one thing. Everything
-- else that protects the recipient is untouched and still runs:
--
--   * `require_relationship` stays true for warm, so a prospect with no
--     recorded relationship still cannot be messaged. The new
--     ACCEPTED_SOCIAL_CONNECTION value is what satisfies it, and it is written
--     only when an acceptance is actually observed.
--   * suppression, opt-out and withdrawn consent still block absolutely. Social
--     is not a route around an opt-out.
--   * the subscriber-type rules are unchanged: INDIVIDUAL is still blocked,
--     SOLE_TRADER and UNKNOWN still go to human review.
--   * cold `allowed_channels` remains `['EMAIL']`. Nothing here permits a cold
--     social message to somebody who has not accepted.
--
-- The previous versions are marked RETIRED rather than deleted, because
-- `policy_decisions` rows reference the version that produced them and an audit
-- of a past decision has to be able to find the rules it was made under.
-- RETIRED is the schema's own word for it -- the status column permits exactly
-- DRAFT, ACTIVE and RETIRED.

-- ------------------------------------------------- the relationship value
alter table public.contact_permissions
  drop constraint if exists contact_permissions_relationship_type_check;
alter table public.contact_permissions
  add constraint contact_permissions_relationship_type_check
  check (relationship_type in ('THEY_CONTACTED_US','EXISTING_CUSTOMER','REFERRAL','REQUESTED_INFORMATION',
                               'EXPLICIT_MARKETING_CONSENT','EXISTING_BUSINESS_RELATIONSHIP',
                               'ACCEPTED_SOCIAL_CONNECTION',
                               'FOUND_BY_US','IMPORTED','OTHER','UNKNOWN'));

-- ------------------------------------------------------------ the packs
-- Retire rather than mutate: a decision recorded yesterday must still be
-- explicable by the rules that were active yesterday.
update public.compliance_policy_versions
   set status = 'RETIRED'
 where status = 'ACTIVE'
   and version in ('uk-2026.09.1', 'us-2026.09.1', 'default-2026.09.1');

insert into public.compliance_policy_versions
  (version, name, country_codes, channels, rules_json, status, notes, activated_at)
values
  ('uk-2026.09.2', 'United Kingdom', array['GB'], array['EMAIL','SMS','WHATSAPP','SOCIAL'],
   jsonb_build_object(
     'cold', jsonb_build_object(
       -- Unchanged from uk-2026.09.1. A cold social message is still refused.
       'allowed_channels', jsonb_build_array('EMAIL'),
       'allowed_subscriber_types', jsonb_build_array('CORPORATE','PARTNERSHIP'),
       'review_subscriber_types', jsonb_build_array('SOLE_TRADER','UNKNOWN'),
       'blocked_subscriber_types', jsonb_build_array('INDIVIDUAL'),
       'require_postal_footer', true,
       'require_unsubscribe', true),
     'warm', jsonb_build_object(
       -- SOCIAL added. Reachable only with a recorded relationship, which on
       -- this channel means an observed acceptance.
       'allowed_channels', jsonb_build_array('EMAIL','SMS','WHATSAPP','SOCIAL'),
       'require_relationship', true,
       'require_unsubscribe', true),
     -- Quiet hours stay on SMS and WhatsApp. A social DM is not a device
     -- notification in the way a text is, and the platforms already batch and
     -- delay their own alerts; applying a 20:00 cutoff would stop replies to
     -- people who are themselves messaging at that hour.
     'quiet_hours', jsonb_build_object('start', '20:00', 'end', '08:00', 'channels', jsonb_build_array('SMS','WHATSAPP'))
   ),
   'ACTIVE',
   'Adds SOCIAL to warm outreach. A social message is only reachable after the recipient accepts a connection or follow, which the schema enforces; cold remains B2B email only.',
   now()),

  ('us-2026.09.2', 'United States', array['US'], array['EMAIL','SMS','WHATSAPP','SOCIAL'],
   jsonb_build_object(
     'cold', jsonb_build_object(
       'allowed_channels', jsonb_build_array('EMAIL'),
       'allowed_subscriber_types', jsonb_build_array('CORPORATE','PARTNERSHIP','SOLE_TRADER'),
       'review_subscriber_types', jsonb_build_array('UNKNOWN'),
       'blocked_subscriber_types', jsonb_build_array('INDIVIDUAL'),
       'require_postal_footer', true,
       'require_unsubscribe', true),
     'warm', jsonb_build_object(
       'allowed_channels', jsonb_build_array('EMAIL','SMS','WHATSAPP','SOCIAL'),
       'require_relationship', true,
       'require_unsubscribe', true),
     'quiet_hours', jsonb_build_object('start', '21:00', 'end', '08:00', 'channels', jsonb_build_array('SMS','WHATSAPP'))
   ),
   'ACTIVE',
   'Adds SOCIAL to warm outreach, gated on an observed acceptance. Cold remains B2B email only.',
   now()),

  ('default-2026.09.2', 'Default', array[]::text[], array['EMAIL','SMS','WHATSAPP','SOCIAL'],
   jsonb_build_object(
     'cold', jsonb_build_object(
       -- The fallback pack stays maximally conservative: an unrecognised
       -- country permits no cold channel at all.
       'allowed_channels', jsonb_build_array()::jsonb,
       'allowed_subscriber_types', jsonb_build_array()::jsonb,
       'review_subscriber_types', jsonb_build_array('CORPORATE','PARTNERSHIP','SOLE_TRADER','UNKNOWN'),
       'blocked_subscriber_types', jsonb_build_array('INDIVIDUAL')),
     'warm', jsonb_build_object(
       'allowed_channels', jsonb_build_array('EMAIL','SOCIAL'),
       'require_relationship', true,
       'require_unsubscribe', true),
     'quiet_hours', jsonb_build_object('start', '20:00', 'end', '08:00', 'channels', jsonb_build_array('SMS','WHATSAPP'))
   ),
   'ACTIVE',
   'Fallback pack. Cold is refused entirely; warm social is permitted only with a recorded relationship.',
   now())
on conflict (version) do nothing;
