-- 0138: margin-safe plan catalogue, WhatsApp as a paid add-on, a trial under
-- 50p, and per-lead channel / SMS budgeting.
--
-- Owner rules (2026-09-27, docs/economics.md §2 and §10):
--   * every plan and billing interval >= 75% gross margin at MAXIMUM use of
--     every included allowance (Stripe fees and the £2 infra allocation in);
--   * a trial must not cost more than 50p to run (worst-case marginal cost);
--   * WhatsApp is a paid add-on: 0 included, credit or overage priced at the
--     Meta MARKETING rate so every category clears 75%;
--   * SMS overage and every credit bundle >= 75% margin after Stripe.
--
-- The values are src/lib/billing/plans.ts (PLANS, TRIAL), unit-costs.ts
-- (VERIFIED_PROSPECT_HARD_LIMIT) and sourcing-allowances.ts; tests pin them
-- to this file (tests/billing-trial.test.ts, tests/plan-margins.test.ts,
-- tests/public-pages.test.ts). overage_price is GBP pounds per unit, as 0018
-- seeded it (plans.ts holds pence). Prices (£99/£199/£399) are unchanged.
--
-- Idempotent: every write is an upsert or a guarded insert/update.

-- ============================================ 1. plan_entitlements
insert into public.plan_entitlements (plan_key, metric, soft_limit, hard_limit, overage_allowed, overage_price, unit)
values
  -- Included SMS: an instant first text for every lead at the lead cap. Later
  -- follow-up goes by email through the customer's own mailbox (free to us).
  ('trial',      'sms_outbound_segment',      6,      8, false, null,   'segments/month'),
  ('starter',    'sms_outbound_segment',    160,    200, true,  0.24,   'segments/month'),
  ('growth',     'sms_outbound_segment',    320,    400, true,  0.23,   'segments/month'),
  ('pro',        'sms_outbound_segment',    800,   1000, true,  0.22,   'segments/month'),
  ('enterprise', 'sms_outbound_segment',  80000, 100000, true,  0.22,   'segments/month'),
  -- WhatsApp: paid add-on on Growth and above (credit or overage), none included.
  ('trial',      'whatsapp_message',          0,      0, false, null,   'messages/month'),
  ('starter',    'whatsapp_message',          0,      0, false, null,   'messages/month'),
  ('growth',     'whatsapp_message',          0,      0, true,  0.27,   'messages/month'),
  ('pro',        'whatsapp_message',          0,      0, true,  0.27,   'messages/month'),
  ('enterprise', 'whatsapp_message',          0,      0, true,  0.27,   'messages/month'),
  -- AI tokens: trial sized to ~18 agent replies; Pro to ~2,180.
  ('trial',      'ai_tokens',             40000,   50000, false, null, 'tokens/month'),
  ('starter',    'ai_tokens',            800000,  1000000, false, null, 'tokens/month'),
  ('growth',     'ai_tokens',           3200000,  4000000, false, null, 'tokens/month'),
  ('pro',        'ai_tokens',           4800000,  6000000, false, null, 'tokens/month'),
  ('enterprise', 'ai_tokens',          32000000, 40000000, false, null, 'tokens/month'),
  -- Enterprise had no lead row (economics.md §6.5 item 6).
  ('enterprise', 'lead_processed',        90000,  100000, false, null, 'leads/month')
on conflict (plan_key, metric) do update
  set soft_limit = excluded.soft_limit,
      hard_limit = excluded.hard_limit,
      overage_allowed = excluded.overage_allowed,
      overage_price = excluded.overage_price,
      unit = excluded.unit;

-- Pro verified prospects 2,000 -> 1,000 (Google Places cost; economics.md §10).
insert into public.plan_entitlements (plan_key, metric, soft_limit, hard_limit, overage_allowed, overage_price, unit, description)
values
  ('pro',        'verified_prospect',   900,   1000,   true,  0.22,   'prospects/month', 'Verified sourced prospects per month')
on conflict (plan_key, metric) do update
  set soft_limit = excluded.soft_limit,
      hard_limit = excluded.hard_limit,
      overage_allowed = excluded.overage_allowed,
      overage_price = excluded.overage_price,
      unit = excluded.unit,
      description = excluded.description;

-- ============================================ 2. trial AI spend ceiling
-- £3 -> 6p: with 50k tokens the model cost is ~6p; the £ ceiling makes it a
-- hard bound whatever the token mix (ai/budget.ts, PLAN scope).
update public.ai_budgets
   set ceiling_minor = 6
 where business_id is null
   and plan_key = 'trial'
   and scope = 'PLAN';

-- ============================================ 3. provider_price_book: Meta
-- 0018 deliberately left Meta's per-message fee out, so booked WhatsApp cost
-- was Twilio's $0.005 alone -- about 1/13 of a UK marketing template. UK
-- rates from Meta's rate card effective 2026-07-01 (economics.md U6-U9; two
-- secondary sources, A4 and A5). Service (free-form inside the 24h window) is
-- free until 30 Sep 2026 and charged at the utility rate from 1 Oct 2026 (A3b).
insert into public.provider_price_book
  (provider, product, region, currency, unit, unit_cost, effective_from, effective_to, capability, notes)
select v.provider, v.product, v.region, v.currency, v.unit, v.unit_cost, v.effective_from, v.effective_to, v.capability, v.notes
from (values
  ('meta', 'whatsapp_marketing_template', 'GB', 'USD', 'per_unit', 0.0635::numeric, '2026-07-01'::timestamptz, null::timestamptz, 'WHATSAPP_MARKETING', 'Meta UK marketing template, rate card 2026-07-01 (economics.md U6)'),
  ('meta', 'whatsapp_utility_template',   'GB', 'USD', 'per_unit', 0.0220::numeric, '2026-07-01'::timestamptz, null::timestamptz, 'WHATSAPP_UTILITY',   'Meta UK utility template outside the window (U7)'),
  ('meta', 'whatsapp_authentication',     'GB', 'USD', 'per_unit', 0.0220::numeric, '2026-07-01'::timestamptz, null::timestamptz, 'WHATSAPP_AUTH',      'Meta UK authentication (U8); not used'),
  ('meta', 'whatsapp_service',            'GB', 'USD', 'per_unit', 0.0000::numeric, '2026-07-01'::timestamptz, '2026-10-01'::timestamptz, 'WHATSAPP_SERVICE', 'Service messages free until 2026-09-30 (U9)'),
  ('meta', 'whatsapp_service',            'GB', 'USD', 'per_unit', 0.0220::numeric, '2026-10-01'::timestamptz, null::timestamptz, 'WHATSAPP_SERVICE',   'Service messages charged at the utility rate from 2026-10-01 (U9, A3b)')
) as v(provider, product, region, currency, unit, unit_cost, effective_from, effective_to, capability, notes)
where not exists (
  select 1 from public.provider_price_book p
   where p.provider = v.provider
     and p.product = v.product
     and p.effective_from = v.effective_from
);

-- Twilio's own WhatsApp fee applies to inbound messages as well (A2).
update public.provider_price_book
   set notes = coalesce(nullif(notes, ''), 'Twilio fee per WhatsApp message, sent or received; Meta category fee is separate (meta/whatsapp_*)')
 where provider = 'twilio'
   and product = 'whatsapp_message';

-- ============================================ 4. per-lead channel & SMS budget
-- Follow-Up -> Channel & SMS budget (src/lib/follow-up/channel-strategy.ts).
-- Owner rule: budgeting applies to UNENGAGED automated steps only; a live
-- conversation with an engaged lead is never capped (only an abuse ceiling).
alter table public.business_settings
  add column if not exists follow_up_channel_strategy text not null default 'sms_first_then_email',
  add column if not exists follow_up_sms_cap_segments integer not null default 3,
  add column if not exists conversation_sms_daily_ceiling integer not null default 40;

alter table public.business_settings
  drop constraint if exists business_settings_follow_up_channel_strategy_check;
alter table public.business_settings
  add constraint business_settings_follow_up_channel_strategy_check
  check (follow_up_channel_strategy in ('sms_first_then_email', 'sms_every_step'));

alter table public.business_settings
  drop constraint if exists business_settings_follow_up_sms_cap_check;
alter table public.business_settings
  add constraint business_settings_follow_up_sms_cap_check
  check (follow_up_sms_cap_segments between 1 and 20);

alter table public.business_settings
  drop constraint if exists business_settings_conversation_sms_ceiling_check;
alter table public.business_settings
  add constraint business_settings_conversation_sms_ceiling_check
  check (conversation_sms_daily_ceiling between 20 and 200);

comment on column public.business_settings.follow_up_channel_strategy is
  'sms_first_then_email (default): first automated message by SMS where the lead gave a mobile; later nudges to a lead who has NOT engaged (no reply, intent below MEDIUM) by email from the customer''s mailbox. An engaged lead stays on its channel. sms_every_step: each step on its configured channel.';
comment on column public.business_settings.follow_up_sms_cap_segments is
  'Max automated follow-up SMS segments per UNENGAGED lead per sequence run. Enforced at send time (billingSendGate). Engaged leads, agent replies and booking reminders are exempt.';
comment on column public.business_settings.conversation_sms_daily_ceiling is
  'Abuse ceiling, not a budget: max SMS segments of agent replies to one lead per rolling 24 hours (default 40). A live conversation is never otherwise capped. At the ceiling the lead is handed to a person.';
