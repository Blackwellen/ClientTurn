-- 0141_no_overage: overage is removed on every plan and every metric.
--
-- Owner decision (2026-09-27): "it will get abused, make them top up".
-- Prepaid top-up credit is the only way past an allowance. For SMS and
-- WhatsApp the order is now allowance -> credit -> refused
-- (src/lib/billing/limits.ts `splitConsumption`); Find Leads prospects,
-- sourcing runs and outreach email stop at the allowance
-- (src/lib/billing/v4-entitlements.ts, which also ignores a stale
-- overage_allowed = true row, so the code is safe before this is applied).
--
-- 1. plan_entitlements: SMS and WhatsApp rows re-seeded with overage off and
--    no price (the values otherwise as 0138; tests/plan-margins.test.ts reads
--    the latest seed row), then every remaining metric (email_sent,
--    verified_prospect, ...) switched off too.
-- 2. customer_usage_allocations: any workspace that had switched automatic
--    overage on is switched off and its spend cap zeroed. The columns stay
--    (history, and billing-daily still settles usage_overage_events already
--    recorded before this change); nothing writes them any more.
--
-- Idempotent: upserts and guarded updates only.

-- ============================================ 1. plan_entitlements
insert into public.plan_entitlements (plan_key, metric, soft_limit, hard_limit, overage_allowed, overage_price, unit)
values
  ('trial',      'sms_outbound_segment',      6,      8, false, null,   'segments/month'),
  ('starter',    'sms_outbound_segment',    160,    200, false, null,   'segments/month'),
  ('growth',     'sms_outbound_segment',    320,    400, false, null,   'segments/month'),
  ('pro',        'sms_outbound_segment',    800,   1000, false, null,   'segments/month'),
  ('enterprise', 'sms_outbound_segment',  80000, 100000, false, null,   'segments/month'),
  ('trial',      'whatsapp_message',          0,      0, false, null,   'messages/month'),
  ('starter',    'whatsapp_message',          0,      0, false, null,   'messages/month'),
  ('growth',     'whatsapp_message',          0,      0, false, null,   'messages/month'),
  ('pro',        'whatsapp_message',          0,      0, false, null,   'messages/month'),
  ('enterprise', 'whatsapp_message',          0,      0, false, null,   'messages/month')
on conflict (plan_key, metric) do update
  set soft_limit = excluded.soft_limit,
      hard_limit = excluded.hard_limit,
      overage_allowed = excluded.overage_allowed,
      overage_price = excluded.overage_price,
      unit = excluded.unit;

update public.plan_entitlements
   set overage_allowed = false,
       overage_price = null
 where overage_allowed
    or overage_price is not null;

-- ============================================ 2. customer_usage_allocations
update public.customer_usage_allocations
   set overage_enabled = false,
       overage_cap_minor = 0,
       updated_at = now()
 where overage_enabled
    or coalesce(overage_cap_minor, 0) <> 0;
