-- 0020_campaign_ai_personalize: opt-in AI personalization per campaign (§29).
-- One base template is always required and reviewed at creation time; this
-- only controls whether campaign-send.ts asks Mini to restyle it per-lead
-- from the same merge context, never to invent new content.
alter table public.campaigns
  add column ai_personalize boolean not null default false;
