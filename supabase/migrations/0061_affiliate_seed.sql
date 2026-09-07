-- 0061_affiliate_seed: the programme's opening content (V4 §31, §33).
--
-- Two tables shipped empty in 0056 and made their surfaces read as broken
-- rather than as new: an affiliate could not create a promo code because there
-- were no offers, and the Resources Hub said "no resources published" to a
-- partner who had just been told it was their enablement hub.
--
-- What is seeded here is deliberately only what we can seed *honestly*:
--
--   * **Promo offers** — real commercial terms. These are the discounts the
--     programme is actually willing to honour, so a code issued from one is a
--     code that works. `stripe_coupon_id` is left null until the matching
--     coupon exists in Stripe; `requestPromoCode` copies the terms from the
--     offer either way, and an unlinked coupon is a billing-side task rather
--     than a reason to withhold the offer from the portal.
--
--   * **Text and education resources** — copy that exists because it is
--     written here. Every row is TEXT or LINK, so "Copy text" and "Open"
--     always do what they say.
--
-- What is deliberately NOT seeded: logo packs, screenshots, ad creative and
-- campaign packs. Those are FILE rows, and a FILE row with no object behind it
-- in R2 is a Download button that 404s. They are published by an operator once
-- the asset is uploaded, which is why `storage_key` has no placeholder here.


-- Seeded rows are identified by (category, title) so this migration is safe to
-- re-run and so an operator cannot accidentally publish two "Promotion rules".
-- Added as a partial index on PUBLISHED rows only: an archived old version and
-- its replacement may legitimately share a title.
create unique index if not exists affiliate_resources_published_title_idx
  on public.affiliate_resources (category, title)
  where status = 'PUBLISHED';

-- ------------------------------------------------------- promo offers
insert into public.affiliate_promo_offers
  (key, name, description, discount_percent, duration_months, max_redemptions, active)
values
  (
    'first_month_20',
    '20% off the first month',
    'A one-month discount for new customers. Good for a first touch where the ask is simply to try it.',
    20.00, 1, null, true
  ),
  (
    'three_months_15',
    '15% off for three months',
    'A longer runway. Suits audiences that need a full quarter to see leads convert into booked work.',
    15.00, 3, null, true
  ),
  (
    'annual_10',
    '10% off an annual plan',
    'For customers ready to commit for a year. The smallest discount because it is applied to the largest commitment.',
    10.00, 12, null, true
  )
on conflict (key) do nothing;

-- ------------------------------------------------------- copy resources
-- Each row's `text_content` is the asset. Nothing here is a placeholder and
-- nothing points at a file that does not exist.
insert into public.affiliate_resources
  (category, title, description, resource_type, text_content, version, status,
   usage_rights, published_at, file_type_label, sort_order)
values
  (
    'COPY',
    'Short social captions',
    'Five ready-to-post captions for LinkedIn, Facebook groups and X. Swap in your own referral link.',
    'TEXT',
    E'1. Most home-service businesses lose the job in the first ten minutes — not on price, but because nobody answered. ClientTurn replies to every enquiry in seconds, qualifies it against rules you set, and books the ones worth booking.\n\n2. If you run a trade business and your leads arrive while you are up a ladder, this is for you. ClientTurn answers, qualifies and books while you work.\n\n3. "We were paying for leads and losing half of them to slow replies." ClientTurn fixes the gap between an enquiry arriving and someone responding to it.\n\n4. Speed-to-lead is the whole game in home services. ClientTurn makes the first reply instant and the qualification consistent — the same questions, every time, whoever is on the tools.\n\n5. Your ad spend does not fail at the ad. It fails at 7pm on a Friday when an enquiry lands and nobody sees it until Monday. That is the part ClientTurn fixes.',
    'v1', 'PUBLISHED', 'Edit freely. Do not add claims we have not made.',
    now(), 'Plain text', 10
  ),
  (
    'COPY',
    'Email introduction template',
    'A short, non-salesy email for introducing ClientTurn to a business you already work with.',
    'TEXT',
    E'Subject: the enquiries you are not getting back to\n\nHi {{first_name}},\n\nQuick one. You mentioned enquiries coming in outside hours and going cold before anyone can call back — I have been recommending a tool called ClientTurn to a few people with that exact problem.\n\nIt answers every new enquiry within seconds, asks the qualifying questions you would ask yourself, and books the ones that are worth your time straight into the diary. It is built specifically for UK home-service businesses rather than adapted from something generic.\n\nHere is the link if you want a look: {{referral_link}}\n\nNo pressure either way — I just know how much that gap was costing you.\n\n{{your_name}}',
    'v1', 'PUBLISHED', 'Edit freely. Do not add claims we have not made.',
    now(), 'Plain text', 20
  ),
  (
    'COPY',
    'Product description (short and long)',
    'Boilerplate for directory listings, partner pages and newsletter blurbs.',
    'TEXT',
    E'SHORT (25 words)\nClientTurn answers every enquiry a home-service business receives within seconds, qualifies it against rules the owner sets, and books the ones worth booking.\n\nMEDIUM (55 words)\nClientTurn is lead follow-up for UK home-service businesses. It replies to every new enquiry in seconds across SMS, WhatsApp and email, asks the qualifying questions the owner would ask, and books qualified jobs straight into the calendar. Qualification is rule-based and deterministic, so the same enquiry gets the same answer every time.\n\nLONG (110 words)\nMost home-service businesses do not lose work on price. They lose it in the gap between an enquiry arriving and someone getting back to it — evenings, weekends, and any time the team is on the tools.\n\nClientTurn closes that gap. It picks up Meta Lead Ads, web forms and other sources, replies within seconds, and works through the qualifying questions the owner has configured. Leads that meet the criteria are booked; the rest are handed over with a full history so nothing is lost.\n\nQualification is deterministic rather than generative, which means it is auditable: the owner can see exactly which rule produced which outcome, and change it.',
    'v1', 'PUBLISHED', 'Use verbatim where possible. These claims are approved.',
    now(), 'Plain text', 30
  ),
  (
    'COPY',
    'Call-to-action examples',
    'Wording that converts without overpromising. Pair with your referral link.',
    'TEXT',
    E'• See how fast your enquiries could be answered →\n• Stop losing weekend enquiries →\n• Try it on your next ten leads →\n• Book a walkthrough with the ClientTurn team →\n• Get your first enquiry answered in seconds →\n\nAvoid: guaranteed revenue figures, "double your bookings", named customers we have not published, and any claim that ClientTurn replaces a salesperson. None of those are things we say, and a referral built on one of them is a refund waiting to happen.',
    'v1', 'PUBLISHED', 'Use verbatim where possible. These claims are approved.',
    now(), 'Plain text', 40
  )
on conflict (category, title) where status = 'PUBLISHED' do nothing;

-- --------------------------------------------------- education resources
insert into public.affiliate_resources
  (category, title, description, resource_type, text_content, version, status,
   usage_rights, published_at, file_type_label, sort_order)
values
  (
    'EDUCATION',
    'Who ClientTurn is for',
    'The audience that converts, and the audience that does not. Read this before you spend money promoting.',
    'TEXT',
    E'CONVERTS WELL\n• UK home-service businesses running paid lead generation — roofers, window and door installers, driveway and landscaping firms, heating engineers, cleaning companies.\n• Owner-operators with 2-25 staff, where the person answering enquiries is also the person doing the work.\n• Businesses already spending on Meta Lead Ads or Google and complaining that the leads are "rubbish" — usually a follow-up speed problem rather than a lead quality problem.\n\nCONVERTS BADLY\n• Businesses with no inbound enquiries at all. ClientTurn improves what happens to a lead; it is not a source of leads.\n• Single-operator businesses handling fewer than about ten enquiries a month. The maths does not work for them and they churn.\n• Non-UK businesses. The integrations, the compliance posture and the phone number handling are UK-first.\n\nBeing honest about the second list is worth money to you: a referral that churns inside the refund window earns nothing, and a reversal on your ledger is worse than never having referred them.',
    'v1', 'PUBLISHED', 'Internal guidance for partners. Do not republish verbatim.',
    now(), 'Plain text', 10
  ),
  (
    'EDUCATION',
    'How attribution works',
    'What gets you paid, what does not, and why a click is not always a referral.',
    'TEXT',
    E'THE MECHANIC\nSomeone clicks your link. We record the click and set a signed, server-side cookie identifying you. When that person signs up, we resolve the cookie and attach the referral to your account.\n\nThe cookie is signed and HttpOnly. A visitor cannot edit it, and a query parameter on its own is not trusted after signup — which protects you as much as us: nobody can hand themselves your referrals.\n\nLAST TOUCH, INSIDE THE WINDOW\nIf a visitor clicks two partners'' links, the most recent click inside the attribution window is credited. Check the current window on your dashboard — it is set by programme policy and shown live rather than hard-coded into this document.\n\nWHAT DOES NOT COUNT\n• Self-referrals, including the same billing entity or card under another name.\n• Traffic we identify as automated.\n• Signups from paid ads on ClientTurn brand terms.\n\nWHEN YOU ACTUALLY EARN\nA signup is not a commission. Commission accrues when a referred account makes a real payment, and it stays pending for the refund hold period before it is approved. That delay is not us being slow — it is the window in which a refund would reverse it.',
    'v1', 'PUBLISHED', 'Internal guidance for partners. Do not republish verbatim.',
    now(), 'Plain text', 20
  ),
  (
    'EDUCATION',
    'Objection handling',
    'The five objections you will actually hear, and honest answers to them.',
    'TEXT',
    E'"We already reply quickly."\nAsk when their last enquiry arrived and when it was answered. Almost nobody replies quickly at 8pm on a Sunday, and that is where the losses are. The claim is usually about weekday behaviour.\n\n"Won''t an automated reply put people off?"\nA generic one would. ClientTurn asks the questions the owner has configured — the same ones they would ask — and hands over to a human the moment anything falls outside the rules. It is not a chatbot pretending to be a person.\n\n"We tried something like this and it did not work."\nWorth asking what specifically. Usually it was a generic autoresponder with no qualification, or a US tool with no UK phone handling. Both are real failures and neither is what this is.\n\n"Is it AI? I don''t want AI deciding things."\nQualification is deterministic and rule-based. AI is optional, off by default, and can only classify an inbound message or extract a value for a question the owner already configured. It never makes a commitment, quotes a price or decides availability.\n\n"How much?"\nSend them to the pricing page rather than quoting from memory. Prices change and a wrong number from you is an awkward first conversation for them.',
    'v1', 'PUBLISHED', 'Internal guidance for partners. Do not republish verbatim.',
    now(), 'Plain text', 30
  ),
  (
    'EDUCATION',
    'Promotion rules',
    'What you may and may not do. Reading this is cheaper than having a commission reversed.',
    'TEXT',
    E'ALLOWED\n• Organic social, newsletters, blogs, videos, podcasts and communities you are part of.\n• Paid ads on non-brand terms.\n• Direct outreach to your own list, provided it complies with UK GDPR and PECR and you have a lawful basis.\n• Using the approved brand assets in the Resources Hub.\n\nNOT ALLOWED\n• Bidding on "ClientTurn" or close variants, or ads that could be read as coming from us.\n• Cookie stuffing, forced clicks, or any placement where the visitor did not choose to click.\n• Coupon and deal sites, unless the code came from an approved offer in your portal.\n• Claiming a partnership, endorsement or employment relationship you do not have.\n• Unsolicited bulk email. It is illegal, and it will get your account closed.\n• Recreating our logo or wordmark yourself. Use the pack.\n\nIf something is not on either list, ask before you spend money on it.',
    'v1', 'PUBLISHED', 'Internal guidance for partners. Do not republish verbatim.',
    now(), 'Plain text', 40
  ),
  (
    'EDUCATION',
    'Plans and feature comparison',
    'The current plans, kept accurate by linking rather than by copying.',
    'LINK',
    null,
    'v1', 'PUBLISHED', 'Link to this rather than quoting prices.',
    now(), 'Web page', 50
  )
on conflict (category, title) where status = 'PUBLISHED' do nothing;

-- The plans resource is a link, so it needs a destination. Set separately so
-- the insert above stays readable.
update public.affiliate_resources
   set external_url = '/pricing'
 where category = 'EDUCATION'
   and title = 'Plans and feature comparison'
   and external_url is null;

-- ------------------------------------------------------- brand resources
-- One LINK row so the Brand category is not empty on day one. The actual
-- logo pack is a FILE row an operator publishes once the asset is in R2 —
-- seeding a Download button with nothing behind it would be worse than an
-- honest empty state.
insert into public.affiliate_resources
  (category, title, description, resource_type, external_url, version, status,
   usage_rights, published_at, file_type_label, sort_order)
values
  (
    'BRAND',
    'Brand basics',
    'Colours, the wordmark and the rules for using them. The downloadable pack is published here once uploaded.',
    'LINK',
    '/affiliates',
    'v1', 'PUBLISHED',
    'Commercial use allowed within the promotion rules.',
    now(), 'Web page', 10
  )
on conflict (category, title) where status = 'PUBLISHED' do nothing;
