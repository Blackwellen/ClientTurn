-- 0145_live_economics: the read model behind Admin -> Economics.
--
-- Nothing new is stored. One RPC counts what each workspace ACTUALLY used in a
-- period, from the tables that already record it; the application prices the
-- counts with `src/lib/billing/unit-costs.ts` (the single place unit costs
-- live) in `src/lib/admin/economics-model.ts`. Counting is done here, in SQL,
-- because a truncated read of a usage ledger under-reports cost, and
-- under-reported cost reads as better margin (the lesson of 0075 / 0090).
--
--   * usage_events   SMS segments out / in, AI tokens by model and kind
--   * messages       WhatsApp out by Meta pricing category, WhatsApp in
--   * cost_events    Resend (if ever booked), Google Places records, and any
--                    other provider spend the sourcing router booked
--   * leads          leads created and leads qualified in the period
--   * *_purchases    top-up revenue actually paid in the period
--
-- Each "*_rows" column is how the page tells "measured, and zero" from "not
-- measured": a metric no code path writes has no rows anywhere.
--
-- Also: a unique index so a margin alert is raised at most once per workspace
-- per month even if two daily runs overlap.
--
-- Service role only. NOT applied by the author; apply with the others.

create or replace function public.admin_economics_usage(
  p_from timestamptz,
  p_to timestamptz,
  -- Meta charges in-window service messages only from this instant; the rule
  -- lives in unit-costs.ts (WHATSAPP_SERVICE_CHARGED_FROM) and is passed in.
  p_whatsapp_service_charged_from timestamptz,
  -- For converting USD-booked ledger rows; unit-costs.ts USD_TO_GBP_MODEL.
  p_usd_to_gbp numeric
)
returns table (
  business_id uuid,
  sms_out_segments numeric,
  sms_out_rows bigint,
  sms_in_segments numeric,
  sms_in_rows bigint,
  ai_mini_input numeric,
  ai_mini_cached numeric,
  ai_mini_output numeric,
  ai_nano_input numeric,
  ai_nano_cached numeric,
  ai_nano_output numeric,
  ai_rows bigint,
  wa_out_ledger numeric,
  wa_marketing bigint,
  wa_utility bigint,
  wa_service_free bigint,
  wa_service_charged bigint,
  wa_inbound bigint,
  resend_emails numeric,
  resend_rows bigint,
  places_records numeric,
  places_requests numeric,
  other_provider_cost_gbp numeric,
  leads bigint,
  qualified_leads bigint,
  credit_revenue_gbp numeric,
  credit_charges bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with usage as (
    select
      u.business_id,
      coalesce(sum(u.quantity) filter (where u.metric = 'sms_outbound_segment'), 0) as sms_out_segments,
      count(*) filter (where u.metric = 'sms_outbound_segment') as sms_out_rows,
      coalesce(sum(u.quantity) filter (where u.metric = 'sms_inbound_segment'), 0) as sms_in_segments,
      count(*) filter (where u.metric = 'sms_inbound_segment') as sms_in_rows,
      coalesce(sum(u.quantity) filter (where u.metric = 'ai_mini_input_token'), 0) as ai_mini_input,
      coalesce(sum(u.quantity) filter (where u.metric = 'ai_mini_cached_token'), 0) as ai_mini_cached,
      coalesce(sum(u.quantity) filter (where u.metric = 'ai_mini_output_token'), 0) as ai_mini_output,
      coalesce(sum(u.quantity) filter (where u.metric = 'ai_nano_input_token'), 0) as ai_nano_input,
      coalesce(sum(u.quantity) filter (where u.metric = 'ai_nano_cached_token'), 0) as ai_nano_cached,
      coalesce(sum(u.quantity) filter (where u.metric = 'ai_nano_output_token'), 0) as ai_nano_output,
      count(*) filter (where u.metric like 'ai\_%\_token') as ai_rows,
      coalesce(sum(u.quantity) filter (where u.metric = 'whatsapp_message'), 0) as wa_out_ledger
      from public.usage_events u
     where u.occurred_at >= p_from
       and u.occurred_at < p_to
       and u.metric in (
         'sms_outbound_segment', 'sms_inbound_segment', 'whatsapp_message',
         'ai_mini_input_token', 'ai_mini_cached_token', 'ai_mini_output_token',
         'ai_nano_input_token', 'ai_nano_cached_token', 'ai_nano_output_token'
       )
     group by u.business_id
  ),
  whatsapp as (
    -- Meta prices per delivered message by category. A template carries its
    -- category; a message without one is a free-form reply in the 24h window,
    -- which Meta prices as SERVICE (free until p_whatsapp_service_charged_from).
    select
      m.business_id,
      count(*) filter (where m.direction = 'outbound' and m.template_category = 'MARKETING') as wa_marketing,
      count(*) filter (where m.direction = 'outbound' and m.template_category in ('UTILITY', 'AUTHENTICATION')) as wa_utility,
      count(*) filter (where m.direction = 'outbound' and m.template_category is null
                        and coalesce(m.sent_at, m.created_at) < p_whatsapp_service_charged_from) as wa_service_free,
      count(*) filter (where m.direction = 'outbound' and m.template_category is null
                        and coalesce(m.sent_at, m.created_at) >= p_whatsapp_service_charged_from) as wa_service_charged,
      count(*) filter (where m.direction = 'inbound') as wa_inbound
      from public.messages m
     where m.channel = 'whatsapp'
       and m.status in ('SENT', 'DELIVERED', 'RECEIVED')
       and coalesce(m.sent_at, m.received_at, m.created_at) >= p_from
       and coalesce(m.sent_at, m.received_at, m.created_at) < p_to
     group by m.business_id
  ),
  ledger as (
    select
      c.business_id,
      coalesce(sum(c.quantity) filter (where c.provider = 'resend'), 0) as resend_emails,
      count(*) filter (where c.provider = 'resend') as resend_rows,
      coalesce(sum(c.quantity) filter (where c.provider = 'google_places'), 0) as places_records,
      -- One Text Search request returns up to 20 places; each booked batch
      -- needed at least ceil(records / 20) requests.
      coalesce(sum(ceil(c.quantity / 20.0)) filter (where c.provider = 'google_places' and c.quantity > 0), 0) as places_requests,
      coalesce(sum(
        case when upper(c.currency) = 'USD' then c.total_cost * p_usd_to_gbp else c.total_cost end
      ) filter (
        where c.provider not in ('azure', 'azure_openai', 'twilio', 'meta', 'resend', 'google_places', 'stripe', 'google', 'microsoft')
          and coalesce(c.category, '') not in ('AI', 'SMS', 'WHATSAPP', 'EMAIL', 'STRIPE', 'INFRASTRUCTURE')
      ), 0) as other_provider_cost_gbp
      from public.cost_events c
     where c.occurred_at >= p_from
       and c.occurred_at < p_to
       and c.business_id is not null
     group by c.business_id
  ),
  lead_counts as (
    select
      l.business_id,
      count(*) filter (where l.created_at >= p_from and l.created_at < p_to) as leads,
      count(*) filter (where l.qualified_at >= p_from and l.qualified_at < p_to) as qualified_leads
      from public.leads l
     where (l.created_at >= p_from and l.created_at < p_to)
        or (l.qualified_at >= p_from and l.qualified_at < p_to)
     group by l.business_id
  ),
  credits as (
    select p.business_id, sum(p.amount_minor) / 100.0 as revenue, count(*) as charges
      from (
        select business_id, amount_minor, coalesce(credited_at, created_at) as paid_at
          from public.message_credit_purchases where status = 'PAID'
        union all
        select business_id, amount_minor, coalesce(credited_at, created_at)
          from public.ai_token_purchases where status = 'PAID'
      ) p
     where p.paid_at >= p_from and p.paid_at < p_to
     group by p.business_id
  ),
  ids as (
    select business_id from usage
    union select business_id from whatsapp
    union select business_id from ledger
    union select business_id from lead_counts
    union select business_id from credits
  )
  select
    ids.business_id,
    coalesce(u.sms_out_segments, 0),
    coalesce(u.sms_out_rows, 0),
    coalesce(u.sms_in_segments, 0),
    coalesce(u.sms_in_rows, 0),
    coalesce(u.ai_mini_input, 0),
    coalesce(u.ai_mini_cached, 0),
    coalesce(u.ai_mini_output, 0),
    coalesce(u.ai_nano_input, 0),
    coalesce(u.ai_nano_cached, 0),
    coalesce(u.ai_nano_output, 0),
    coalesce(u.ai_rows, 0),
    coalesce(u.wa_out_ledger, 0),
    coalesce(w.wa_marketing, 0),
    coalesce(w.wa_utility, 0),
    coalesce(w.wa_service_free, 0),
    coalesce(w.wa_service_charged, 0),
    coalesce(w.wa_inbound, 0),
    coalesce(g.resend_emails, 0),
    coalesce(g.resend_rows, 0),
    coalesce(g.places_records, 0),
    coalesce(g.places_requests, 0),
    coalesce(g.other_provider_cost_gbp, 0),
    coalesce(lc.leads, 0),
    coalesce(lc.qualified_leads, 0),
    coalesce(cr.revenue, 0),
    coalesce(cr.charges, 0)
    from ids
    left join usage u on u.business_id = ids.business_id
    left join whatsapp w on w.business_id = ids.business_id
    left join ledger g on g.business_id = ids.business_id
    left join lead_counts lc on lc.business_id = ids.business_id
    left join credits cr on cr.business_id = ids.business_id
   where ids.business_id is not null;
$$;

revoke all on function public.admin_economics_usage(timestamptz, timestamptz, timestamptz, numeric)
  from public, anon, authenticated;
grant execute on function public.admin_economics_usage(timestamptz, timestamptz, timestamptz, numeric)
  to service_role;

-- A margin alert is raised once per workspace per calendar month. The daily
-- check looks first; this index is what makes two overlapping runs safe.
create unique index if not exists economics_alerts_margin_once_per_month_idx
  on public.economics_alerts (business_id, alert_type, (metrics_json ->> 'period'))
  where alert_type = 'MARGIN_BELOW_THRESHOLD' and metrics_json ? 'period';
