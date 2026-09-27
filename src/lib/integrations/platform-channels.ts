/**
 * Whether a messaging channel can send, for a workspace.
 *
 * Twilio SMS and WhatsApp are platform-run: one shared account serves every
 * workspace (catalog.ts, `connection: "platform"`), so a workspace normally
 * has NO `integrations` row for them. The send path already treats "no row" as
 * the platform sender (jobs/handlers/shared.ts `channelState`). Several
 * readiness checks instead demanded a row that never exists, so SMS read as
 * "not connected" in follow-up settings, the reactivation wizard, Add lead and
 * the re-engagement agent, while the Dashboard (correctly) said Connected.
 *
 * The rule, one place: a workspace's own row for the channel decides when it
 * exists (healthy or degraded is usable); with no row, the platform sender
 * decides.
 *
 * Pure -- the platform flag is passed in (it comes from `platformConfigured`,
 * which reads server env) -- so it is testable and client-safe.
 */

export type IntegrationStatusRow = { provider_type: string; status: string | null };

const USABLE_STATUSES = new Set(["HEALTHY", "DEGRADED"]);

export function channelUsable(
  rows: readonly IntegrationStatusRow[],
  providers: readonly string[],
  platformReady: boolean,
): boolean {
  const own = rows.filter((row) => providers.includes(row.provider_type));
  if (own.length > 0) return own.some((row) => USABLE_STATUSES.has(row.status ?? ""));
  return platformReady;
}

/** The providers that can carry each messaging channel. */
export const MESSAGING_CHANNEL_PROVIDERS = {
  sms: ["twilio_sms"],
  whatsapp: ["twilio_whatsapp", "whatsapp_cloud"],
  email: ["imap_smtp"],
} as const;
