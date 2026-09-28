import "server-only";
import { serverEnv } from "@/lib/env";
import { createRetellVoiceProvider } from "./retell";
import { createTwilioVoiceProvider, twilioVoiceConfigured } from "./twilio-voice";
import type { NumberProvider, TelephonyProvider, VoiceProvider } from "./types";

/**
 * The live voice providers, or null for any that is not configured.
 *
 * With `RETELL_SECRET_KEY` absent there is no VoiceProvider, and every voice
 * path reports `integration-required` instead of dialling (runtime-core.ts).
 * With the Twilio account SID (AC...) and auth token absent there is no
 * number provisioning. Nothing here throws on a missing key: the adapters
 * throw `ProviderNotConfigured` only when a method is actually called, and
 * this registry never hands out an adapter that would.
 *
 * Tests never reach this file: they drive runtime-core.ts with the in-memory
 * fakes (providers/fake.ts), so no test can call Retell or Twilio.
 */

export type LiveVoiceProviders = {
  voice: VoiceProvider | null;
  telephony: TelephonyProvider | null;
  numbers: NumberProvider | null;
};

export function voiceProviders(): LiveVoiceProviders {
  const voice = serverEnv.retell.apiKey ? createRetellVoiceProvider({ apiKey: serverEnv.retell.apiKey }) : null;
  const twilio = twilioVoiceConfigured() ? createTwilioVoiceProvider() : null;
  return { voice, telephony: twilio, numbers: twilio };
}

export type VoiceIntegrationStatus = {
  retell: boolean;
  twilio: boolean;
  agent: boolean;
  webhookBase: boolean;
  /** Everything a live call needs. */
  ready: boolean;
  missing: string[];
};

/** What is missing, by env name, for the Settings integration-required state. */
export function voiceIntegrationStatus(): VoiceIntegrationStatus {
  const missing: string[] = [];
  const retell = Boolean(serverEnv.retell.apiKey);
  const twilio = twilioVoiceConfigured();
  const agent = Boolean(serverEnv.retell.agentId);
  const webhookBase = Boolean(voiceWebhookBase());
  if (!retell) missing.push("RETELL_SECRET_KEY");
  if (!agent) missing.push("RETELL_AGENT_ID");
  if (!twilio) missing.push("TWILIO_ACCOUNT_SID (AC...) and TWILIO_AUTH_TOKEN");
  if (!webhookBase) missing.push("VOICE_WEBHOOK_BASE_URL (a public https origin)");
  return { retell, twilio, agent, webhookBase, ready: retell && twilio && agent && webhookBase, missing };
}

/** The public https origin providers call back to, or null (never localhost). */
export function voiceWebhookBase(): string | null {
  const candidate = serverEnv.voice.webhookBaseUrl ?? serverEnv.siteUrl;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The callback URLs a provisioned number is configured with. */
export function provisioningUrls(): {
  voiceWebhookUrl: string;
  voiceStatusCallbackUrl: string;
  smsInboundUrl: string;
  bundleStatusCallbackUrl: string;
} | null {
  const base = voiceWebhookBase();
  if (!base) return null;
  return {
    voiceWebhookUrl: `${base}/api/webhooks/twilio/voice`,
    voiceStatusCallbackUrl: `${base}/api/webhooks/twilio/voice`,
    smsInboundUrl: `${base}/api/webhooks/twilio`,
    bundleStatusCallbackUrl: `${base}/api/webhooks/twilio/regulatory`,
  };
}
