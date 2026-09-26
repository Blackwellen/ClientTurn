-- 0133 Connections and developer-platform fixes (tracker 8.23 / 8.24).
--
-- An MCP "connection" now issues a workspace API key bound to it, because
-- that is the credential Claude, Codex and Gemini can actually hold: a static
-- bearer header. The client secret the dialog used to show was never accepted
-- by the gateway, and the one-hour OAuth access token it could mint had no
-- refresh path an MCP client performs, so connections silently died after an
-- hour.
--
-- The binding lets the connection row revoke its own key, lets the gateway
-- attribute a call to the connection it came through, and refuses a key whose
-- connection has been suspended or revoked even if the key row was missed.
--
-- The code tolerates this column being absent (schema lag): it falls back to
-- the "[mcp:<client id>]" tag it also writes into the key name.

alter table public.api_keys
  add column if not exists mcp_client_id uuid
    references public.mcp_clients(id) on delete set null;

create index if not exists api_keys_mcp_client_idx
  on public.api_keys (mcp_client_id)
  where mcp_client_id is not null;

comment on column public.api_keys.mcp_client_id is
  'The MCP connection this key was issued for, when it was issued from Settings -> Connections -> Assistant connections. Revoking the connection revokes the key.';
