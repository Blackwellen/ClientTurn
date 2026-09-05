import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { getLiveAccessToken, type OAuthConfig } from "@/lib/integrations/oauth";
import { registerOAuthProvider } from "./registry";

/**
 * https://docs.slack.dev/authentication/installing-with-oauth — Slack's OAuth
 * v2 token exchange returns team info inline (`team.id` / `team.name`), so
 * `identify` reads it straight from the raw token response rather than making
 * a second `auth.test` call.
 */
function getConfig(): OAuthConfig | null {
  if (!serverEnv.slack.clientId || !serverEnv.slack.clientSecret) return null;
  return {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    clientId: serverEnv.slack.clientId,
    clientSecret: serverEnv.slack.clientSecret,
    scope: "chat:write",
  };
}

registerOAuthProvider("slack", {
  getConfig,
  async identify(token) {
    const team = token.raw.team as { id?: string; name?: string } | undefined;
    const scope = typeof token.raw.scope === "string" ? token.raw.scope : "";
    return {
      externalAccountId: team?.id ?? null,
      displayName: team?.name ?? null,
      scopes: scope.split(",").filter(Boolean),
    };
  },
});

export class SlackChannelNotConfiguredError extends Error {
  constructor() {
    super("Slack is connected but no channel is set.");
    this.name = "SlackChannelNotConfiguredError";
  }
}

export async function postSlackMessage({
  integrationId,
  text,
}: {
  integrationId: string;
  text: string;
}): Promise<void> {
  const config = getConfig();
  if (!config) throw new Error("Slack is not configured on this platform.");

  const admin = createAdminClient();
  const { data: integration } = await admin
    .from("integrations")
    .select("config")
    .eq("id", integrationId)
    .maybeSingle();

  const channelId =
    integration?.config && typeof integration.config === "object"
      ? (integration.config as Record<string, unknown>).channel_id
      : null;

  if (!channelId || typeof channelId !== "string") {
    throw new SlackChannelNotConfiguredError();
  }

  const accessToken = await getLiveAccessToken(integrationId, config);

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: channelId, text }),
  });

  const json = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };

  if (!response.ok || !json.ok) {
    throw new Error(`Slack message could not be sent: ${json.error ?? response.status}`);
  }
}
