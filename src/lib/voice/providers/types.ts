/**
 * Voice provider interfaces and the one internal event union every provider
 * webhook is normalised into. Pure types plus zod schemas; no `server-only`,
 * so the fakes, the tests and the webhook reducer share them.
 *
 * Three roles, which may be one vendor or two:
 *   - VoiceProvider      the conversational layer (Retell): agent config, start
 *                        and end a call, call details and transcript, its webhooks.
 *   - TelephonyProvider  the carrier (Twilio Programmable Voice / Elastic SIP):
 *                        call control and status callbacks.
 *   - NumberProvider     number inventory (Twilio): per-workspace subaccount,
 *                        UK regulatory bundle, search, purchase, configure
 *                        (voice webhook + the workspace's Messaging Service so
 *                        the SAME number sends SMS), release.
 *
 * Adapters live beside this file: `retell.ts`, `twilio-voice.ts` (server-only)
 * with their pure protocol halves `retell-protocol.ts`, `twilio-protocol.ts`,
 * and in-memory fakes in `fake.ts`.
 */

import { z } from "zod";

// ------------------------------------------------------------------ errors

export class ProviderNotConfigured extends Error {
  readonly provider: string;
  readonly missing: readonly string[];
  constructor(provider: string, missing: readonly string[]) {
    super(`${provider} is not configured: missing ${missing.join(", ")}`);
    this.name = "ProviderNotConfigured";
    this.provider = provider;
    this.missing = missing;
  }
}

export class ProviderRequestError extends Error {
  readonly provider: string;
  readonly status: number;
  readonly code: string | null;
  /** 4xx other than 429: retrying will not help. */
  readonly permanent: boolean;
  constructor(provider: string, status: number, message: string, code: string | null = null) {
    super(`${provider} ${status}: ${message}`);
    this.name = "ProviderRequestError";
    this.provider = provider;
    this.status = status;
    this.code = code;
    this.permanent = status >= 400 && status < 500 && status !== 429;
  }
}

// --------------------------------------------------------------- VoiceEvent

export const CALL_OUTCOMES = ["COMPLETED", "NO_ANSWER", "BUSY", "VOICEMAIL", "FAILED", "TRANSFERRED", "CANCELLED"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

const base = {
  provider: z.enum(["retell", "twilio", "fake"]),
  /** `webhook_events.external_event_id`: unique per provider. */
  dedupeKey: z.string().min(1),
  occurredAt: z.string().datetime().nullable(),
};
const callBase = { ...base, providerCallId: z.string().min(1), metadata: z.record(z.string(), z.string()).optional() };

export const voiceEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CALL_QUEUED"), ...callBase }),
  z.object({ type: z.literal("CALL_DIALLING"), ...callBase }),
  z.object({ type: z.literal("CALL_RINGING"), ...callBase }),
  z.object({ type: z.literal("CALL_ANSWERED"), ...callBase, answeredBy: z.enum(["HUMAN", "MACHINE", "UNKNOWN"]) }),
  z.object({ type: z.literal("CALL_STARTED"), ...callBase }),
  z.object({
    type: z.literal("CALL_ENDED"),
    ...callBase,
    outcome: z.enum(CALL_OUTCOMES),
    durationSec: z.number().int().nonnegative().nullable(),
    disconnectionReason: z.string().nullable(),
  }),
  z.object({
    type: z.literal("CALL_ANALYZED"),
    ...callBase,
    summary: z.string().nullable(),
    successful: z.boolean().nullable(),
    costCents: z.number().nonnegative().nullable(),
  }),
  z.object({ type: z.literal("TRANSCRIPT_UPDATED"), ...callBase }),
  z.object({ type: z.literal("TRANSFER_STARTED"), ...callBase, destination: z.string().nullable() }),
  z.object({ type: z.literal("TRANSFER_ENDED"), ...callBase, bridged: z.boolean() }),
  z.object({
    type: z.literal("BUNDLE_STATUS_CHANGED"),
    ...base,
    accountSid: z.string().nullable(),
    bundleSid: z.string().min(1),
    status: z.enum(["DRAFT", "PENDING_REVIEW", "IN_REVIEW", "APPROVED", "PROVISIONALLY_APPROVED", "REJECTED"]),
    failureReason: z.string().nullable(),
  }),
  z.object({ type: z.literal("UNKNOWN"), ...base, rawType: z.string() }),
]);
export type VoiceEvent = z.infer<typeof voiceEventSchema>;
export type BundleStatus = Extract<VoiceEvent, { type: "BUNDLE_STATUS_CHANGED" }>["status"];

export type WebhookInput = {
  rawBody: string;
  /** Lower-cased header names. */
  headers: Record<string, string | undefined>;
  /** The full public URL the provider posted to (Twilio signs it). */
  url?: string;
  now: Date;
};

// ------------------------------------------------------------ VoiceProvider

export const voiceAgentConfigSchema = z.object({
  /** Existing provider agent id to update; absent = create. */
  agentId: z.string().min(1).nullable(),
  name: z.string().min(1).max(120),
  /** Our webhook for call events. */
  webhookUrl: z.string().url(),
  /** Our realtime LLM endpoint (custom LLM websocket) the turn adapter serves. */
  llmWebsocketUrl: z.string().url().nullable(),
  voiceId: z.string().min(1),
  language: z.string().default("en-GB"),
  maxCallDurationSec: z.number().int().positive(),
  /** Retell's own "end after silence" guard. */
  endAfterSilenceSec: z.number().int().positive().default(20),
  voicemailDetection: z.boolean().default(true),
});
export type VoiceAgentConfig = z.infer<typeof voiceAgentConfigSchema>;

export const outboundCallRequestSchema = z.object({
  /** E.164. The workspace's dedicated number (numbers/sender.ts). */
  fromNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
  toNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
  agentId: z.string().min(1),
  /** Idempotency: our call key. Carried in metadata so webhooks resolve back. */
  callKey: z.string().min(1),
  metadata: z.record(z.string(), z.string()),
  /** Values the agent prompt reads (the locked preamble among them). */
  dynamicVariables: z.record(z.string(), z.string()),
  /**
   * Per-call agent settings (voice P3): the hard duration ceiling from the
   * time governor, and the voicemail action (the fixed, versioned script only
   * when the consent basis allows it, §26; otherwise hang up).
   */
  overrides: z
    .object({
      maxCallDurationMs: z.number().int().min(60_000).max(7_200_000).optional(),
      voicemail: z
        .discriminatedUnion("mode", [
          z.object({ mode: z.literal("STATIC_TEXT"), text: z.string().min(1).max(1000) }),
          z.object({ mode: z.literal("HANG_UP") }),
        ])
        .optional(),
      /** How the assistant sounds (voice-profile.ts voiceAgentFields): Retell agent fields. */
      voice: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    })
    .optional(),
});
export type OutboundCallRequest = z.infer<typeof outboundCallRequestSchema>;

export type ProviderCallStatus = "REGISTERED" | "NOT_CONNECTED" | "ONGOING" | "ENDED" | "ERROR";

export type TranscriptTurn = { role: "agent" | "user"; content: string; startMs: number | null; endMs: number | null };

export type ProviderCallDetails = {
  providerCallId: string;
  status: ProviderCallStatus;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  outcome: CallOutcome | null;
  disconnectionReason: string | null;
  transcript: TranscriptTurn[];
  recordingUrl: string | null;
  costCents: number | null;
  metadata: Record<string, string>;
};

export interface VoiceProvider {
  readonly name: "retell" | "fake";
  upsertAgent(config: VoiceAgentConfig): Promise<{ agentId: string }>;
  startOutboundCall(req: OutboundCallRequest): Promise<{ providerCallId: string; status: ProviderCallStatus }>;
  endCall(providerCallId: string): Promise<void>;
  getCall(providerCallId: string): Promise<ProviderCallDetails>;
  verifyWebhook(input: WebhookInput): boolean;
  parseWebhook(input: WebhookInput): VoiceEvent[];
}

// -------------------------------------------------------- TelephonyProvider

export interface TelephonyProvider {
  readonly name: "twilio" | "fake";
  /** Hang up a live call at the carrier (the backstop when the voice layer cannot). */
  endCall(input: { accountSid: string; callSid: string }): Promise<void>;
  getCallStatus(input: { accountSid: string; callSid: string }): Promise<{ status: string; durationSec: number | null }>;
  /** The per-destination price, for the rate cap (null when the API has none). */
  lookupRatePerMinuteUsd(e164: string): Promise<number | null>;
  verifyWebhook(input: WebhookInput & { authToken: string }): boolean;
  parseWebhook(input: WebhookInput): VoiceEvent[];
}

// ----------------------------------------------------------- NumberProvider

export type NumberCapabilities = { voice: boolean; sms: boolean; mms: boolean };

export type AvailableNumber = { e164: string; capabilities: NumberCapabilities; locality: string | null };

export type OwnedNumber = {
  phoneNumberSid: string;
  e164: string;
  capabilities: NumberCapabilities;
  voiceUrl: string | null;
  statusCallbackUrl: string | null;
  messagingServiceSid: string | null;
  bundleSid: string | null;
};

/** Twilio UK mobile end-user fields (see numbers/provisioning-details.ts). */
export type RegulatoryEndUser = {
  businessName: string;
  registrationAuthority: string;
  businessRegistrationNumber: string;
  websiteUrl: string;
  businessClassification: "DIRECT_CUSTOMER" | "ISV_RESELLER";
  representative: { firstName: string; lastName: string; phoneE164: string; workEmail: string };
};

export type RegulatoryAddress = {
  customerName: string;
  street: string;
  streetSecondary: string | null;
  city: string;
  region: string | null;
  postalCode: string;
  isoCountry: string;
};

export type BundleSubmission = {
  accountSid: string;
  friendlyName: string;
  notificationEmail: string;
  statusCallbackUrl: string;
  isoCountry: "GB";
  numberType: "mobile";
  endUserType: "business";
  endUser: RegulatoryEndUser;
  address: RegulatoryAddress;
  /** Supporting documents, when a regulation asks for them (UK mobile: none, per Twilio's guideline page). */
  documents: { type: string; r2Key: string }[];
};

export interface NumberProvider {
  readonly name: "twilio" | "fake";
  /** Idempotent by `friendlyName`: an existing subaccount with that name is returned. */
  createSubaccount(input: { friendlyName: string }): Promise<{ accountSid: string; created: boolean }>;
  /**
   * The subaccount's own auth token, to store sealed for verifying its
   * webhooks (voice P3, P2 gap b). Optional: a provider without subaccounts
   * returns nothing.
   */
  subaccountAuthToken?(accountSid: string): Promise<string | null>;
  submitRegulatoryBundle(input: BundleSubmission): Promise<{ bundleSid: string; addressSid: string; endUserSid: string; status: BundleStatus }>;
  getBundleStatus(input: { accountSid: string; bundleSid: string }): Promise<{ status: BundleStatus; failureReason: string | null }>;
  searchAvailable(input: {
    accountSid: string;
    isoCountry: "GB";
    type: "mobile";
    smsEnabled: boolean;
    voiceEnabled: boolean;
    limit: number;
  }): Promise<AvailableNumber[]>;
  purchase(input: { accountSid: string; e164: string; bundleSid: string; addressSid: string }): Promise<OwnedNumber>;
  /** Idempotent: returns the workspace's Messaging Service, creating it once. */
  ensureMessagingService(input: { accountSid: string; friendlyName: string; inboundUrl: string }): Promise<{ messagingServiceSid: string }>;
  configure(input: {
    accountSid: string;
    phoneNumberSid: string;
    voiceUrl: string;
    statusCallbackUrl: string;
    messagingServiceSid: string;
  }): Promise<OwnedNumber>;
  release(input: { accountSid: string; phoneNumberSid: string }): Promise<void>;
  list(input: { accountSid: string }): Promise<OwnedNumber[]>;
}
