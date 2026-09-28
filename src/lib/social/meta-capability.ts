/**
 * Whether a connected Meta Page can actually message on a channel.
 *
 * Pure (relative imports only), so the Inbox, Settings and the send path all
 * ask the same question and tests can answer it without Meta.
 *
 * Messenger needs `pages_messaging`; Instagram Direct needs
 * `instagram_manage_messages` (and `instagram_basic` to resolve the account)
 * plus an Instagram professional account linked to the Page. Until Meta
 * approves a permission for the app, the OAuth dialog cannot grant it, so
 * the connection comes back without it. That state is shown plainly as
 * "requires Meta approval" and a send is refused before it reaches Meta,
 * rather than attempted, rejected and left as a silent failure.
 *
 * A connection made before granted permissions were recorded has no scopes
 * stored. That is UNVERIFIED: sends are allowed (they worked before), and the
 * person is asked to reconnect so the answer becomes known.
 */

export type MetaMessagingChannel = "messenger" | "instagram";

export type MetaChannelCapability =
  | { state: "READY" }
  | { state: "UNVERIFIED"; message: string }
  | { state: "NOT_CONNECTED"; message: string }
  | { state: "NO_INSTAGRAM_ACCOUNT"; message: string }
  | { state: "NEEDS_META_APPROVAL"; missing: string[]; message: string };

export const META_MESSAGING_PERMISSIONS: Record<MetaMessagingChannel, readonly string[]> = {
  messenger: ["pages_messaging"],
  instagram: ["instagram_basic", "instagram_manage_messages"],
};

export function metaChannelCapability(
  channel: MetaMessagingChannel,
  connection: {
    connected: boolean;
    pageId: string | null;
    instagramUserId: string | null;
    /** Permissions Meta reported as granted; null or empty when never recorded. */
    scopes: readonly string[] | null;
  } | null,
): MetaChannelCapability {
  const label = channel === "instagram" ? "Instagram" : "Messenger";
  if (!connection || !connection.connected || !connection.pageId) {
    return {
      state: "NOT_CONNECTED",
      message: `Connect your Facebook Page in Settings, Connections to use ${label}.`,
    };
  }
  if (channel === "instagram" && !connection.instagramUserId) {
    return {
      state: "NO_INSTAGRAM_ACCOUNT",
      message: "The connected Page has no Instagram professional account linked to it. Link one in Meta Business Suite, then reconnect.",
    };
  }
  const scopes = connection.scopes ?? [];
  if (scopes.length === 0) {
    return {
      state: "UNVERIFIED",
      message: `Reconnect your Facebook Page so we can confirm ${label} messaging is permitted.`,
    };
  }
  const missing = META_MESSAGING_PERMISSIONS[channel].filter((permission) => !scopes.includes(permission));
  if (missing.length > 0) {
    return {
      state: "NEEDS_META_APPROVAL",
      missing,
      message: `${label} messaging requires Meta approval (${missing.join(", ")}). Until Meta approves it for ClientTurn, reply from ${channel === "instagram" ? "the Instagram app" : "Meta Business Suite"}.`,
    };
  }
  return { state: "READY" };
}

/** Whether an automated or manual send may be attempted at all. */
export function metaSendPermitted(capability: MetaChannelCapability): boolean {
  return capability.state === "READY" || capability.state === "UNVERIFIED";
}

/** Granted permissions from Meta's `/me/permissions` response. */
export function grantedPermissions(payload: unknown): string[] {
  const data = (payload as { data?: { permission?: unknown; status?: unknown }[] } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((row) => row && row.status === "granted" && typeof row.permission === "string")
    .map((row) => row.permission as string)
    .sort();
}
