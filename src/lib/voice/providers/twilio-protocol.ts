/**
 * Twilio voice and numbers wire protocol. Pure (node:crypto only).
 *
 * Signature: the canonical Twilio request signature, HMAC-SHA1 over the full
 * URL with the POST params appended in sorted key order, base64, keyed by the
 * AUTH TOKEN of the account that owns the number (never an API key secret; gap
 * map F7). For a number held in a workspace SUBACCOUNT that is the
 * subaccount's auth token (believed from Twilio's security docs; UNVERIFIED
 * against a live subaccount here). The algorithm lives in the shared pure
 * `lib/twilio/signature.ts` (also used by the SMS webhook) and is re-exported
 * here so the voice modules keep one import site.
 *
 * Status callback `CallStatus` values (Twilio docs, well known): queued,
 * initiated, ringing, in-progress, completed, busy, no-answer, canceled,
 * failed. `AnsweredBy` with machine detection: human, machine_start,
 * machine_end_beep, machine_end_silence, machine_end_other, fax, unknown.
 *
 * Bundle status callback (numbers.twilio.com/v2/RegulatoryCompliance/Bundles,
 * docs read 2026-09-27): POST with AccountSid, BundleSid, Status, FailureReason;
 * statuses draft, pending-review, in-review, twilio-approved, twilio-rejected,
 * provisionally-approved.
 */

import { formToRecord } from "../../twilio/signature.ts";
import type { BundleStatus, CallOutcome, VoiceEvent } from "./types.ts";

export const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";
export const TWILIO_NUMBERS_BASE = "https://numbers.twilio.com/v2";
export const TWILIO_MESSAGING_BASE = "https://messaging.twilio.com/v1";

export { computeTwilioSignature, verifyTwilioSignature, formToRecord } from "../../twilio/signature.ts";

/** An account SID is AC + 32 hex. An SK (API key) value is refused (F7). */
export function isAccountSid(v: string | null | undefined): v is string {
  return !!v && /^AC[0-9a-fA-F]{32}$/.test(v);
}

export function mapTwilioBundleStatus(s: string | null | undefined): BundleStatus {
  switch (s) {
    case "draft":
      return "DRAFT";
    case "pending-review":
      return "PENDING_REVIEW";
    case "in-review":
      return "IN_REVIEW";
    case "twilio-approved":
      return "APPROVED";
    case "provisionally-approved":
      return "PROVISIONALLY_APPROVED";
    case "twilio-rejected":
      return "REJECTED";
    default:
      return "IN_REVIEW";
  }
}

function endedOutcome(status: string, answeredBy: string | undefined): CallOutcome {
  if (status === "busy") return "BUSY";
  if (status === "no-answer") return "NO_ANSWER";
  if (status === "canceled") return "CANCELLED";
  if (status === "failed") return "FAILED";
  if (answeredBy && answeredBy.startsWith("machine")) return "VOICEMAIL";
  return "COMPLETED";
}

/** Normalise one Twilio form post (a call status callback or a bundle callback). */
export function parseTwilioWebhook(rawBody: string): VoiceEvent[] {
  const p = formToRecord(rawBody);
  if (p.BundleSid) {
    return [
      {
        type: "BUNDLE_STATUS_CHANGED",
        provider: "twilio",
        dedupeKey: `${p.BundleSid}:${p.Status ?? ""}`,
        occurredAt: null,
        accountSid: p.AccountSid ?? null,
        bundleSid: p.BundleSid,
        status: mapTwilioBundleStatus(p.Status),
        failureReason: p.FailureReason || null,
      },
    ];
  }
  const sid = p.CallSid;
  const status = p.CallStatus ?? "";
  if (!sid) return [{ type: "UNKNOWN", provider: "twilio", dedupeKey: `twilio:noid:${status}`, occurredAt: null, rawType: status }];
  const common = {
    provider: "twilio" as const,
    providerCallId: sid,
    dedupeKey: `${sid}:${status}`,
    occurredAt: p.Timestamp ? new Date(p.Timestamp).toISOString() : null,
  };
  switch (status) {
    case "queued":
      return [{ type: "CALL_QUEUED", ...common }];
    case "initiated":
      return [{ type: "CALL_DIALLING", ...common }];
    case "ringing":
      return [{ type: "CALL_RINGING", ...common }];
    case "in-progress": {
      const ab = p.AnsweredBy;
      const answeredBy = !ab ? "UNKNOWN" : ab === "human" ? "HUMAN" : ab.startsWith("machine") || ab === "fax" ? "MACHINE" : "UNKNOWN";
      return [{ type: "CALL_ANSWERED", ...common, answeredBy }];
    }
    case "completed":
    case "busy":
    case "no-answer":
    case "canceled":
    case "failed": {
      const d = p.CallDuration ?? p.Duration;
      return [
        {
          type: "CALL_ENDED",
          ...common,
          outcome: endedOutcome(status, p.AnsweredBy),
          durationSec: d != null && /^\d+$/.test(d) ? Number(d) : null,
          disconnectionReason: status,
        },
      ];
    }
    default:
      return [{ type: "UNKNOWN", provider: "twilio", dedupeKey: `${sid}:${status}`, occurredAt: null, rawType: status }];
  }
}

/** application/x-www-form-urlencoded body for Twilio's REST API. */
export function formBody(params: Record<string, string | number | boolean | null | undefined | readonly string[]>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) for (const item of v) u.append(k, String(item));
    else u.append(k, String(v));
  }
  return u.toString();
}
