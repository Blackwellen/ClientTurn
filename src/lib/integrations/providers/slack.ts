import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
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

/**
 * Verifies Slack's `v0=` signature on an Interactivity payload
 * (https://docs.slack.dev/authentication/verifying-requests-from-slack).
 * One signing secret for the whole platform, not per-workspace: this is
 * ClientTurn's own Slack app, installed into many customer workspaces via
 * OAuth — every customer's interactive click arrives at the same endpoint,
 * signed with the same app-level secret, same as Meta's app-secret HMAC.
 *
 * The 5-minute timestamp tolerance is Slack's own documented replay window;
 * `verifyMetaHmac` next to this has no equivalent because Meta's scheme
 * carries no timestamp at all.
 */
export function verifySlackSignature(params: {
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
}): boolean {
  const signingSecret = serverEnv.slack.signingSecret;
  if (!signingSecret) return false;

  const { signature, timestamp, rawBody } = params;
  if (!signature?.startsWith("v0=") || !timestamp) return false;

  const providedHex = signature.slice("v0=".length);
  if (!/^[0-9a-f]+$/i.test(providedHex) || providedHex.length % 2 !== 0) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 5 * 60) return false;

  const expected = createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${rawBody}`, "utf8")
    .digest();
  const received = Buffer.from(providedHex, "hex");

  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

export class SlackChannelNotConfiguredError extends Error {
  constructor() {
    super("Slack is connected but no channel is set.");
    this.name = "SlackChannelNotConfiguredError";
  }
}

export async function postSlackMessage({
  integrationId,
  text,
  blocks,
}: {
  integrationId: string;
  text: string;
  /** Block Kit blocks — e.g. interactive buttons. `text` remains the fallback/notification copy. */
  blocks?: unknown[];
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
    body: JSON.stringify({ channel: channelId, text, ...(blocks ? { blocks } : {}) }),
  });

  const json = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };

  if (!response.ok || !json.ok) {
    throw new Error(`Slack message could not be sent: ${json.error ?? response.status}`);
  }
}
