import { OAuthRefreshError } from "./oauth-health.ts";
import { MissingCredentialError } from "./token-refresh-core.ts";

/**
 * What a failed lead-source poll means for the connection's status.
 *
 * Before 2026-10-02 every failure (a network blip, a 5xx, a slow provider)
 * flipped the connection to ACTION_REQUIRED, which shows "Reconnect", and
 * overwrote the reconnect copy with the provider's raw message. The owner's
 * Google Ads card read "Bad Request".
 *
 *   reconnect        the refresh core saw a refused grant and already flagged it
 *   action_required  nothing to call the provider with, or a permanent job error
 *   degraded         anything else: shown as a warning, retried on the next poll
 *
 * Pure (no server-only import) so tests import it directly.
 */
export type PollFailureVerdict = "reconnect" | "action_required" | "degraded";

export function pollFailureVerdict(error: unknown): PollFailureVerdict {
  if (error instanceof OAuthRefreshError) return error.needsReconnect ? "reconnect" : "degraded";
  if (error instanceof MissingCredentialError) return "action_required";
  if (error instanceof Error && error.name === "PermanentJobError") return "action_required";
  return "degraded";
}
