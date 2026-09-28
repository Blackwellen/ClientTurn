import "server-only";

/**
 * Retell adapter (VoiceProvider). A stub against the documented REST shapes:
 * it is not wired into any job or route in this phase, and it never runs in
 * tests against the network (fetch is injected).
 *
 * Verified 2026-09-27 (docs.retellai.com):
 *   POST /create-agent            response_engine {type: custom-llm, llm_websocket_url},
 *                                 voice_id, language (en-GB supported), webhook_url,
 *                                 max_call_duration_ms (60,000..7,200,000),
 *                                 end_call_after_silence_ms (>= 10,000),
 *                                 voicemail_option {action: {type: static_text|prompt|hangup|...}}
 *   POST /v2/create-phone-call    see retell-protocol.ts
 *   GET  /v2/get-call/{call_id}   see retell-protocol.ts
 *   Webhook signature             see retell-protocol.ts
 *
 * UNVERIFIED:
 *   - PATCH /update-agent/{agent_id} (the update path; believed from the SDK
 *     naming, not read in the docs);
 *   - an API to end an ongoing call. None was found. With a custom LLM the
 *     agent ends a call by sending end_call over the LLM websocket, and the
 *     carrier (Twilio `Calls/{Sid}` Status=completed) is the backstop, so
 *     `endCall` here throws rather than calling an invented endpoint;
 *   - the voicemail_option shape for detection-only (we send hangup, so a
 *     voicemail is left by our own retry policy, not by Retell).
 *
 * Env: RETELL_SECRET_KEY (RETELL_API_KEY accepted as an alias); the same
 * secret key verifies webhooks. RETELL_PUBLIC_KEY (browser web calls) is never used here.
 */

import { buildCreatePhoneCallBody, mapRetellStatus, parseRetellWebhook, RETELL_API_BASE, toCallDetails, verifyRetellSignature } from "./retell-protocol.ts";
import {
  outboundCallRequestSchema,
  ProviderNotConfigured,
  ProviderRequestError,
  voiceAgentConfigSchema,
  type OutboundCallRequest,
  type ProviderCallDetails,
  type ProviderCallStatus,
  type VoiceAgentConfig,
  type VoiceEvent,
  type VoiceProvider,
  type WebhookInput,
} from "./types.ts";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export type RetellOptions = {
  apiKey?: string | null;
  fetch?: FetchLike;
  baseUrl?: string;
  env?: Record<string, string | undefined>;
};

export function retellConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!(env.RETELL_SECRET_KEY || env.RETELL_API_KEY);
}

export function createRetellVoiceProvider(opts: RetellOptions = {}): VoiceProvider {
  const env = opts.env ?? process.env;
  const base = (opts.baseUrl ?? RETELL_API_BASE).replace(/\/+$/, "");
  const doFetch: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);

  function key(): string {
    const k = opts.apiKey ?? env.RETELL_SECRET_KEY ?? env.RETELL_API_KEY;
    if (!k) throw new ProviderNotConfigured("retell", ["RETELL_SECRET_KEY"]);
    return k;
  }

  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const t = await res.text();
        if (t) message = t.slice(0, 300);
      } catch {
        /* keep the status */
      }
      throw new ProviderRequestError("retell", res.status, message);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    name: "retell",

    async upsertAgent(input: VoiceAgentConfig): Promise<{ agentId: string }> {
      const c = voiceAgentConfigSchema.parse(input);
      const body = {
        agent_name: c.name,
        response_engine: c.llmWebsocketUrl ? { type: "custom-llm", llm_websocket_url: c.llmWebsocketUrl } : undefined,
        voice_id: c.voiceId,
        language: c.language,
        webhook_url: c.webhookUrl,
        max_call_duration_ms: Math.max(60000, c.maxCallDurationSec * 1000),
        end_call_after_silence_ms: Math.max(10000, c.endAfterSilenceSec * 1000),
        voicemail_option: c.voicemailDetection ? { action: { type: "hangup" } } : null,
      };
      const res = (c.agentId
        ? await call("PATCH", `/update-agent/${encodeURIComponent(c.agentId)}`, body) // UNVERIFIED path
        : await call("POST", "/create-agent", body)) as { agent_id?: string } | null;
      const agentId = res?.agent_id ?? c.agentId;
      if (!agentId) throw new ProviderRequestError("retell", 502, "create-agent returned no agent_id");
      return { agentId };
    },

    async startOutboundCall(input: OutboundCallRequest): Promise<{ providerCallId: string; status: ProviderCallStatus }> {
      const req = outboundCallRequestSchema.parse(input);
      const res = (await call("POST", "/v2/create-phone-call", buildCreatePhoneCallBody(req))) as {
        call_id?: string;
        call_status?: string;
      };
      if (!res?.call_id) throw new ProviderRequestError("retell", 502, "create-phone-call returned no call_id");
      return { providerCallId: res.call_id, status: mapRetellStatus(res.call_status) };
    },

    async endCall(): Promise<void> {
      key();
      // UNVERIFIED: no documented REST endpoint ends a Retell call. End it from
      // the LLM websocket (end_call) or at the carrier (TelephonyProvider.endCall).
      throw new ProviderRequestError("retell", 501, "No verified Retell end-call endpoint; hang up via the carrier", "UNVERIFIED_ENDPOINT");
    },

    async getCall(providerCallId: string): Promise<ProviderCallDetails> {
      const res = await call("GET", `/v2/get-call/${encodeURIComponent(providerCallId)}`);
      return toCallDetails((res ?? {}) as Parameters<typeof toCallDetails>[0]);
    },

    verifyWebhook(input: WebhookInput): boolean {
      return verifyRetellSignature({ ...input, apiKey: key() });
    },

    parseWebhook(input: WebhookInput): VoiceEvent[] {
      return parseRetellWebhook(input.rawBody);
    },
  };
}
