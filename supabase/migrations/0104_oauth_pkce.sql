-- PKCE support for OAuth providers that require it (Salesforce's Connected
-- App / External Client App platform now mandates PKCE on every
-- authorization-code flow, with no way to opt out at the app level -- "To
-- change this required setting, contact Support" is the only text Salesforce
-- shows next to it). The generic authorize/callback routes handle every
-- workspace-connected provider through one state row; a PKCE-using provider
-- needs its code_verifier to survive the redirect round trip the same way the
-- state token already does, so it lives on the same row rather than a new
-- table.
--
-- Nullable and provider-agnostic: only a provider whose OAuthConfig sets
-- usePkce populates this column (see src/lib/integrations/oauth.ts). Every
-- other provider's state row leaves it null, unchanged from today.
alter table public.integration_oauth_states
  add column if not exists code_verifier text;
