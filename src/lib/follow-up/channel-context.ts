import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEntitlements } from "@/lib/billing/entitlements";
import { packForCountry } from "@/lib/policy/packs";
import { loadSenderHealth, type SenderHealth } from "@/lib/outreach/campaigns/sender";
import type { Channel } from "@/lib/automations/types";
import type { WarmChannelContext } from "./channel-policy";

/**
 * The I/O half of the warm channel policy (V4 §19.2).
 *
 * Gathers everything `summariseWarmChannels` needs — which channels the
 * workspace's compliance pack permits for warm contact, which providers are
 * actually connected, and which sending identities are healthy — so the pure
 * rules stay pure and testable.
 *
 * This is a workspace-level answer used to render the editor. It is never a
 * substitute for the per-lead decision, which `ChannelPolicyService.evaluate()`
 * takes again immediately before each send.
 */

export type FollowUpChannelContext = WarmChannelContext & {
  senders: SenderHealth[];
  /** The identity the editor pre-selects. */
  defaultSenderId: string | null;
  fallbackEnabled: boolean;
  /** The pack name, so the UI can attribute a refusal to a named policy. */
  policyName: string;
  /** Convenience: what the editor may currently offer, per channel. */
  available: Record<Channel, boolean>;
};

export async function getFollowUpChannelContext(
  businessId: string,
): Promise<FollowUpChannelContext> {
  const admin = createAdminClient();

  const [settings, integrations, entitlements, senders] = await Promise.all([
    admin
      .from("business_settings")
      .select("default_sender_identity_id, follow_up_fallback_enabled")
      .eq("business_id", businessId)
      .maybeSingle(),
    admin
      .from("integrations")
      .select("provider_type, status, config")
      .eq("business_id", businessId),
    getEntitlements(businessId),
    loadSenderHealth(businessId),
  ]);

  // Workspace-level policy uses the default pack. A recipient's own country
  // can narrow it further, and does — per-lead evaluation re-resolves the pack
  // from the contact's country immediately before every send.
  const pack = await packForCountry(null);

  const rows = integrations.data ?? [];
  const connected = (provider: string) =>
    rows.some(
      (row) =>
        row.provider_type === provider &&
        (row.status === "HEALTHY" || row.status === "DEGRADED"),
    );

  const whatsappRow = rows.find(
    (row) =>
      (row.provider_type === "twilio_whatsapp" ||
        row.provider_type === "whatsapp_cloud") &&
      (row.status === "HEALTHY" || row.status === "DEGRADED"),
  );

  // An approved template is required for any business-initiated WhatsApp
  // message. We treat "the integration declares at least one" as ready; the
  // provider is still the authority at send time.
  const templates = (whatsappRow?.config as { templates?: unknown } | null)?.templates;
  const whatsappTemplateReady = Array.isArray(templates) && templates.length > 0;

  const warmRules = pack.warm.allowedChannels;
  const policyAllows: Record<Channel, boolean> = {
    email: warmRules.includes("EMAIL"),
    sms: warmRules.includes("SMS"),
    whatsapp: warmRules.includes("WHATSAPP"),
  };

  // Warm sending does not require cold enablement or a postal footer, so the
  // warm verdict is the one that decides whether email is offerable.
  const usableSenders = senders.filter((sender) => sender.warmState !== "BLOCKED");
  const senderAvailable = usableSenders.length > 0;

  const senderIssue = senderAvailable
    ? null
    : senders.length === 0
      ? "No sending identity yet. Connect a mailbox in Settings → Connections."
      : (senders[0]?.warmSummary ?? "No usable sending identity.");

  const defaultSenderId =
    settings.data?.default_sender_identity_id &&
    usableSenders.some((s) => s.id === settings.data?.default_sender_identity_id)
      ? settings.data.default_sender_identity_id
      : (usableSenders[0]?.id ?? null);

  const smsConnected = connected("twilio_sms");
  const whatsappEnabled = entitlements.whatsappEnabled && Boolean(whatsappRow);

  return {
    senders,
    defaultSenderId,
    fallbackEnabled: settings.data?.follow_up_fallback_enabled ?? false,
    policyName: pack.name,
    senderAvailable,
    senderIssue,
    policyAllows,
    smsConnected,
    whatsappEnabled,
    whatsappTemplateReady,
    available: {
      email: policyAllows.email && senderAvailable,
      sms: policyAllows.sms && smsConnected,
      whatsapp: whatsappEnabled && policyAllows.whatsapp && whatsappTemplateReady,
    },
  };
}
