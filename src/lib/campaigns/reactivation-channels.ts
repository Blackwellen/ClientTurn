/**
 * Reactivation channel rules: which connection carries each campaign channel,
 * the WhatsApp template a campaign sends outside the 24-hour window, and how a
 * campaign contact is settled after each send (initial message, then the one
 * optional follow-up).
 *
 * Pure: no `server-only`, no Supabase, relative imports with explicit `.ts`, so
 * the wizard, the server actions, the send worker and `node --test` all share
 * one copy.
 */

import { nextPermittedSendTime, type QuietHours } from "../automation/scheduler.ts";
import {
  isTemplateVariableSource,
  orderVariables,
  resolveTemplateVariables,
  type TemplateProvider,
} from "../messaging/whatsapp-templates.ts";

export type CampaignChannel = "sms" | "whatsapp" | "email";

/* ------------------------------------------------------------ providers --- */

/** The `integrations.provider_type` values that can carry each channel. */
export const CAMPAIGN_CHANNEL_PROVIDERS: Record<CampaignChannel, readonly string[]> = {
  sms: ["twilio_sms"],
  whatsapp: ["twilio_whatsapp", "whatsapp_cloud"],
  // Email campaigns go out through the workspace's own connected mailbox.
  email: ["imap_smtp"],
};

const UNUSABLE_STATUSES = new Set(["DISCONNECTED", "ACTION_REQUIRED"]);

export type ChannelReadiness = Record<CampaignChannel, boolean>;

/** Which campaign channels have a connection that is not disconnected or failed. */
export function campaignChannelReadiness(
  integrations: readonly { provider_type: string; status: string | null }[],
  /**
   * Whether the platform-run sender is configured for each channel. Twilio SMS
   * and WhatsApp are shared platform connections, so a workspace normally has
   * no row for them; with no row, the platform sender decides
   * (integrations/platform-channels.ts).
   */
  platform: { sms?: boolean; whatsapp?: boolean } = {},
): ChannelReadiness {
  const usable = (channel: CampaignChannel) =>
    integrations.some(
      (row) =>
        CAMPAIGN_CHANNEL_PROVIDERS[channel].includes(row.provider_type) &&
        !UNUSABLE_STATUSES.has(row.status ?? ""),
    );
  const hasOwnRow = (channel: CampaignChannel) =>
    integrations.some((row) => CAMPAIGN_CHANNEL_PROVIDERS[channel].includes(row.provider_type));
  const withPlatform = (channel: CampaignChannel, platformReady: boolean) =>
    hasOwnRow(channel) ? usable(channel) : platformReady;
  return {
    sms: withPlatform("sms", platform.sms ?? false),
    whatsapp: withPlatform("whatsapp", platform.whatsapp ?? false),
    email: usable("email"),
  };
}

export function providerReadyFor(channel: CampaignChannel, readiness: ChannelReadiness): boolean {
  return readiness[channel];
}

/** What to do when the chosen channel has no usable connection. */
export const CHANNEL_CONNECT_HINT: Record<CampaignChannel, string> = {
  sms: "Connect an SMS number in Settings → Connections before you launch.",
  whatsapp: "Connect WhatsApp in Settings → Connections before you launch.",
  email: "Connect your mailbox in Settings → Connections before you launch.",
};

/**
 * The channel the wizard opens on: the workspace's preference when it can be
 * sent on, otherwise the first channel that can, otherwise SMS (and the wizard
 * then explains what to connect).
 */
export function pickDefaultChannel(
  preferred: string | null | undefined,
  readiness: ChannelReadiness,
  offered: Record<CampaignChannel, boolean>,
): CampaignChannel {
  const ok = (channel: CampaignChannel) => offered[channel] && readiness[channel];
  if ((preferred === "sms" || preferred === "whatsapp" || preferred === "email") && ok(preferred)) {
    return preferred;
  }
  return (["sms", "whatsapp", "email"] as const).find(ok) ?? "sms";
}

/* ---------------------------------------------------- WhatsApp template --- */

/** An approved template the wizard can offer, as the browser sees it. */
export type CampaignTemplateOption = {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string | null;
  variables: string[];
};

/**
 * The wizard/server check on a campaign's template choice. Returns a message
 * to show, or null when the choice is complete: a template is chosen and every
 * variable it declares is filled from a real merge field.
 */
export function templateMappingIssue(
  template: { variables: readonly string[] } | null | undefined,
  variableMap: Record<string, string> | null | undefined,
): string | null {
  if (!template) {
    return "Choose an approved WhatsApp template. Outside the 24-hour window WhatsApp only delivers approved templates.";
  }
  const map = variableMap ?? {};
  const unfilled = orderVariables([...template.variables]).filter(
    (key) => !map[key] || !isTemplateVariableSource(map[key]),
  );
  return unfilled.length
    ? `Choose what fills ${unfilled.map((key) => `{{${key}}}`).join(", ")} in the template.`
    : null;
}

/**
 * The server-side check at campaign creation, against the template as stored
 * now. The send path checks again at send time (a template can be paused).
 */
export function checkCampaignTemplate(input: {
  template: {
    businessId: string | null;
    provider: TemplateProvider;
    status: string;
    name: string;
    variables: string[];
  } | null;
  businessId: string;
  transport: TemplateProvider;
  variableMap: Record<string, string> | null | undefined;
}): { ok: true } | { ok: false; message: string } {
  const { template } = input;
  if (!template) return { ok: false, message: "That WhatsApp template no longer exists. Choose another." };
  if (template.businessId !== null && template.businessId !== input.businessId) {
    return { ok: false, message: "That WhatsApp template belongs to another workspace." };
  }
  if (template.provider !== input.transport) {
    return {
      ok: false,
      message: "That WhatsApp template is not on the WhatsApp sender this workspace uses. Choose another.",
    };
  }
  if (template.status !== "APPROVED") {
    return {
      ok: false,
      message: `The WhatsApp template "${template.name}" is not approved, so it cannot be sent.`,
    };
  }
  const issue = templateMappingIssue(template, input.variableMap);
  return issue ? { ok: false, message: issue } : { ok: true };
}

/**
 * The template variables for one lead. A variable with no value is left out,
 * not blanked: the send path then refuses the template rather than sending a
 * gap where a name should be.
 */
export function campaignTemplateVariables(
  declared: readonly string[],
  variableMap: Record<string, string>,
  values: Record<string, string>,
): Record<string, string> {
  const resolved = resolveTemplateVariables([...declared], variableMap, values);
  if (resolved.ok) return resolved.variables;
  const partial: Record<string, string> = {};
  for (const key of declared) {
    const source = variableMap[key];
    const value = source && isTemplateVariableSource(source) ? values[source]?.trim() : "";
    if (value) partial[key] = value.slice(0, 1024);
  }
  return partial;
}

/* -------------------------------------------------------- AI personalise --- */

/**
 * AI personalisation rewrites a plain-text SMS or WhatsApp body. An email body
 * is formatted markup, which a 640-character plain-text rewrite would destroy,
 * so email is never personalised.
 */
export function aiPersonalizeApplies(input: {
  channel: string;
  requested: boolean;
  aiAssistEnabled: boolean;
}): boolean {
  return input.requested && input.aiAssistEnabled && input.channel !== "email";
}

/* ------------------------------------------------------ contact settling --- */

export type CampaignStage = "initial" | "followup";

/** Which message a campaign contact is waiting for. */
export function contactStage(contact: {
  sent_at: string | null;
  followup_sent_at?: string | null;
}): CampaignStage | "done" {
  if (!contact.sent_at) return "initial";
  return contact.followup_sent_at ? "done" : "followup";
}

/** When the follow-up falls due: the delay after the initial send, outside quiet hours. */
export function followUpDueAt(sentAt: Date, delaySeconds: number, quiet: QuietHours): Date {
  return nextPermittedSendTime(new Date(sentAt.getTime() + delaySeconds * 1000), quiet);
}

/**
 * The follow-up must not overtake its own schedule: a retried batch job can
 * re-read a contact that is now waiting for its follow-up. A minute of slack
 * absorbs clock skew between the queue and the worker.
 */
export function followUpIsDue(nextSendAt: string | null, now: Date): boolean {
  if (!nextSendAt) return true;
  return new Date(nextSendAt).getTime() <= now.getTime() + 60_000;
}

/**
 * A campaign send's guard ignores a reply (a reply is why reactivation is
 * sent at all), so the follow-up checks it here: anyone who replied after the
 * initial message is not chased.
 */
export function followUpSkipReason(
  lead: { first_replied_at: string | null },
  contactSentAt: string | null,
): "replied" | null {
  if (!lead.first_replied_at) return null;
  if (!contactSentAt) return "replied";
  return new Date(lead.first_replied_at).getTime() >= new Date(contactSentAt).getTime()
    ? "replied"
    : null;
}

export type CampaignSendOutcome =
  | { outcome: "sent" }
  | { outcome: "already_processed" }
  | { outcome: "aborted"; reason: string }
  | { outcome: "blocked"; reasonCode: string }
  | { outcome: "rescheduled"; at: Date }
  | { outcome: "failed"; permanent: boolean; errorCode: string }
  | { outcome: "unconfirmed" }
  | { outcome: "missing" };

export type CampaignContactUpdate = {
  state?: string;
  stopped_reason?: string | null;
  sent_at?: string;
  followup_sent_at?: string;
  next_send_at?: string;
};

/**
 * How a campaign contact is settled after one send attempt.
 *
 * Initial message: a send with a follow-up configured leaves the contact
 * `scheduled` for the follow-up (so replies, bookings and opt-outs, which stop
 * every `scheduled` contact, also stop the follow-up). Follow-up: whatever
 * happens, the contact keeps its `sent` state — the initial message did go —
 * and the reason the follow-up did not is recorded.
 *
 * Null means leave the contact as it is (a transient failure retries).
 */
export function settleCampaignContact(input: {
  stage: CampaignStage;
  outcome: CampaignSendOutcome;
  now: Date;
  finalAttempt: boolean;
  /** Initial stage only: when the follow-up falls due, or null when there is none. */
  followUpAt: Date | null;
}): CampaignContactUpdate | null {
  const { outcome, now } = input;
  const at = now.toISOString();

  if (input.stage === "initial") {
    switch (outcome.outcome) {
      case "sent":
      case "already_processed":
        return input.followUpAt
          ? { state: "scheduled", sent_at: at, next_send_at: input.followUpAt.toISOString() }
          : { state: "sent", sent_at: at };
      case "aborted":
        return { state: "suppressed", stopped_reason: outcome.reason };
      case "blocked":
        // Refused by contact policy rather than by a stop condition, recorded
        // as the policy code so the suppressed count can be explained.
        return { state: "suppressed", stopped_reason: `policy:${outcome.reasonCode}` };
      case "rescheduled":
        return { state: "scheduled", next_send_at: outcome.at.toISOString() };
      case "failed":
        return outcome.permanent || input.finalAttempt
          ? { state: "failed", stopped_reason: outcome.errorCode }
          : null;
      case "unconfirmed":
        // Possibly delivered; a person confirms it. Never sent again.
        return { state: "stopped", stopped_reason: "send_unconfirmed" };
      case "missing":
        return null;
    }
  }

  switch (outcome.outcome) {
    case "sent":
    case "already_processed":
      return { state: "sent", followup_sent_at: at };
    case "aborted":
      return { state: "sent", stopped_reason: `followup_skipped:${outcome.reason}` };
    case "blocked":
      return { state: "sent", stopped_reason: `followup_skipped:policy:${outcome.reasonCode}` };
    case "rescheduled":
      return { state: "scheduled", next_send_at: outcome.at.toISOString() };
    case "failed":
      return outcome.permanent || input.finalAttempt
        ? { state: "sent", stopped_reason: `followup_failed:${outcome.errorCode}` }
        : null;
    case "unconfirmed":
      return { state: "sent", stopped_reason: "followup_unconfirmed" };
    case "missing":
      return null;
  }
}
