-- 0068_social_tiktok: TikTok joins the connect-then-message channels.
--
-- 0067 shipped LinkedIn, Facebook and Instagram. TikTok works the same way and
-- is the most restricted of the four: a direct message is only possible once
-- the account follows you back, so the follow is a hard prerequisite rather
-- than a courtesy that improves deliverability.

alter table public.social_sending_accounts
  drop constraint if exists social_sending_accounts_platform_check;
alter table public.social_sending_accounts
  add constraint social_sending_accounts_platform_check
  check (platform in ('LINKEDIN','FACEBOOK','INSTAGRAM','TIKTOK'));

alter table public.social_connection_states
  drop constraint if exists social_connection_states_platform_check;
alter table public.social_connection_states
  add constraint social_connection_states_platform_check
  check (platform in ('LINKEDIN','FACEBOOK','INSTAGRAM','TIKTOK'));
