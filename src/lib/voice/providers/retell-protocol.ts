/**
 * Retell wire protocol: webhook signature, event normalisation, request
 * bodies. Pure (node:crypto only), so it is testable without `server-only`.
 *
 * Verified against docs.retellai.com on 2026-09-27:
 *   - Webhook header `X-Retell-Signature: v={timestamp_ms},d={hex}` where
 *     d = HMAC-SHA256(raw_body + timestamp, api_key). Reject a timestamp more
 *     than 5 minutes from now. Only an API key with the webhook badge verifies.
 *     (features/secure-webhook)
 *   - Events: call_started, call_ended, call_analyzed, transcript_updated,
 *     transfer_started, transfer_bridged, transfer_cancelled, transfer_ended.
 *     Payload `{ event, call: {...} }`. (features/webhook-overview)
 *   - POST https://api.retellai.com/v2/create-phone-call, Bearer auth, body
 *     from_number, to_number, override_agent_id, metadata,
 *     retell_llm_dynamic_variables; returns call_id, call_status
 *     (registered | not_connected | ongoing | ended | error).
 *   - GET /v2/get-call/{call_id}: start/end_timestamp (ms), duration_ms,
 *     transcript, transcript_object, recording_url, disconnection_reason,
 *     call_analysis, call_cost.
 *   - disconnection_reason enum (get-call reference) as mapped below.
 *
 * UNVERIFIED (not confirmed in the docs read):
 *   - the shape of `call_cost` (assumed `combined_cost` in cents);
 *   - `call_analysis.call_summary` / `call_successful` field names;
 *   - `transcript_object[].words[]` timing shape (we read start/end if present).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { CallOutcome, ProviderCallDetails, ProviderCallStatus, TranscriptTurn, VoiceEvent, WebhookInput } from "./types.ts";

export const RETELL_API_BASE = "https://api.retellai.com";
export const RETELL_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export function signRetellBody(rawBody: string, timestampMs: number, apiKey: string): string {
  return `v=${timestampMs},d=${createHmac("sha256", apiKey).update(rawBody + String(timestampMs)).digest("hex")}`;
}

export function verifyRetellSignature(input: WebhookInput & { apiKey: string }): boolean {
  const header = input.headers["x-retell-signature"];
  if (!header) return false;
  const m = /^v=(\d+),d=([0-9a-fA-F]+)$/.exec(header.trim());
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(input.now.getTime() - ts) > RETELL_SIGNATURE_TOLERANCE_MS) return false;
  const expected = createHmac("sha256", input.apiKey).update(input.rawBody + m[1]).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(m[2].toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** disconnection_reason -> our outcome. Unknown reasons are FAILED. */
export function mapRetellDisconnection(reason: string | null | undefined): CallOutcome {
  switch (reason) {
    case "user_hangup":
    case "agent_hangup":
    case "inactivity":
    case "max_duration_reached":
      return "COMPLETED";
    case "call_transfer":
    case "transfer_bridged":
      return "TRANSFERRED";
    case "voicemail_reached":
    case "ivr_reached":
      return "VOICEMAIL";
    case "dial_no_answer":
    case "user_declined":
    case "registered_call_timeout":
      return "NO_ANSWER";
    case "dial_busy":
      return "BUSY";
    case "manual_stopped":
      return "CANCELLED";
    default:
      return "FAILED";
  }
}

export function mapRetellStatus(s: string | null | undefined): ProviderCallStatus {
  switch (s) {
    case "registered":
      return "REGISTERED";
    case "not_connected":
      return "NOT_CONNECTED";
    case "ongoing":
      return "ONGOING";
    case "ended":
      return "ENDED";
    default:
      return "ERROR";
  }
}

type RetellCall = {
  call_id?: string;
  call_status?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  disconnection_reason?: string;
  transcript_object?: { role?: string; content?: string; words?: { start?: number; end?: number }[] }[];
  recording_url?: string;
  metadata?: Record<string, unknown>;
  call_analysis?: { call_summary?: string; call_successful?: boolean };
  call_cost?: { combined_cost?: number };
};

function stringMap(m: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const [k, v] of Object.entries(m)) if (typeof v === "string") out[k] = v;
  return out;
}

const iso = (ms: number | undefined): string | null => (typeof ms === "number" ? new Date(ms).toISOString() : null);

export function parseRetellWebhook(rawBody: string): VoiceEvent[] {
  let body: { event?: string; call?: RetellCall; transfer_destination?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return [];
  }
  const event = String(body.event ?? "");
  const call = body.call ?? {};
  const id = call.call_id;
  if (!id) return [{ type: "UNKNOWN", provider: "retell", dedupeKey: `retell:noid:${event}`, occurredAt: null, rawType: event }];
  const common = { provider: "retell" as const, providerCallId: id, dedupeKey: `${id}:${event}`, metadata: stringMap(call.metadata) };

  switch (event) {
    case "call_started":
      return [{ type: "CALL_STARTED", ...common, occurredAt: iso(call.start_timestamp) }];
    case "call_ended":
      return [
        {
          type: "CALL_ENDED",
          ...common,
          occurredAt: iso(call.end_timestamp),
          outcome: mapRetellDisconnection(call.disconnection_reason),
          durationSec: typeof call.duration_ms === "number" ? Math.ceil(call.duration_ms / 1000) : null,
          disconnectionReason: call.disconnection_reason ?? null,
        },
      ];
    case "call_analyzed":
      return [
        {
          type: "CALL_ANALYZED",
          ...common,
          occurredAt: iso(call.end_timestamp),
          summary: call.call_analysis?.call_summary ?? null,
          successful: call.call_analysis?.call_successful ?? null,
          costCents: typeof call.call_cost?.combined_cost === "number" ? call.call_cost.combined_cost : null,
        },
      ];
    case "transcript_updated":
      return [{ type: "TRANSCRIPT_UPDATED", ...common, occurredAt: null }];
    case "transfer_started":
      return [
        {
          type: "TRANSFER_STARTED",
          ...common,
          occurredAt: null,
          destination: typeof body.transfer_destination === "string" ? body.transfer_destination : null,
        },
      ];
    case "transfer_bridged":
    case "transfer_cancelled":
    case "transfer_ended":
      return [{ type: "TRANSFER_ENDED", ...common, occurredAt: null, bridged: event === "transfer_bridged" }];
    default:
      return [{ type: "UNKNOWN", provider: "retell", dedupeKey: `${id}:${event}`, occurredAt: null, rawType: event }];
  }
}

export function toCallDetails(call: RetellCall): ProviderCallDetails {
  const transcript: TranscriptTurn[] = (call.transcript_object ?? []).map((t) => {
    const words = t.words ?? [];
    const start = words.length && typeof words[0].start === "number" ? Math.round(words[0].start * 1000) : null;
    const last = words[words.length - 1];
    const end = words.length && typeof last?.end === "number" ? Math.round(last.end * 1000) : null;
    return { role: t.role === "agent" ? "agent" : "user", content: t.content ?? "", startMs: start, endMs: end };
  });
  const status = mapRetellStatus(call.call_status);
  return {
    providerCallId: call.call_id ?? "",
    status,
    startedAt: iso(call.start_timestamp),
    endedAt: iso(call.end_timestamp),
    durationSec: typeof call.duration_ms === "number" ? Math.ceil(call.duration_ms / 1000) : null,
    outcome: status === "ENDED" || status === "NOT_CONNECTED" || status === "ERROR" ? mapRetellDisconnection(call.disconnection_reason) : null,
    disconnectionReason: call.disconnection_reason ?? null,
    transcript,
    recordingUrl: call.recording_url ?? null,
    costCents: typeof call.call_cost?.combined_cost === "number" ? call.call_cost.combined_cost : null,
    metadata: stringMap(call.metadata),
  };
}

export function buildCreatePhoneCallBody(req: {
  fromNumber: string;
  toNumber: string;
  agentId: string;
  callKey: string;
  metadata: Record<string, string>;
  dynamicVariables: Record<string, string>;
}): Record<string, unknown> {
  return {
    from_number: req.fromNumber,
    to_number: req.toNumber,
    override_agent_id: req.agentId,
    metadata: { ...req.metadata, call_key: req.callKey },
    retell_llm_dynamic_variables: req.dynamicVariables,
  };
}
