/**
 * Inbound calls to a workspace's dedicated number (§25, return-call handling).
 * Pure: what happens when someone rings the number back.
 *
 *   - A KNOWN lead of the workspace, on a workspace entitled to voice, is
 *     answered by the AI agent on the RETURN_CALL route, with the lead's
 *     context. The first words are a locked greeting: who the caller has
 *     reached, that it is an AI assistant, and the recording notice when
 *     recording is on (OD-1 applied to inbound; the outbound opener, "calling
 *     from ... about the enquiry you sent", does not fit a call they made).
 *   - An UNKNOWN caller, or any caller when the workspace is not entitled
 *     (trial, unpaid, paused, no minutes) or the AI is not connected, hears a
 *     short polite message and gets a text back; or, when the transfer
 *     setting allows and a transfer number is set, is put through to a person.
 *   - A lead who opted out of all contact (or is suppressed or erased) is
 *     never answered by the AI and never texted: a person, if transfer is
 *     allowed, else the short message only. A CALLS-only opt-out does not stop
 *     the AI answering a call the person chose to make.
 *   - A number that routes to no workspace (released, quarantined, unknown) is
 *     told it is not in service, never connected to a former tenant.
 *
 * House style for spoken copy: no emoji, no dashes.
 */

import { RECORDING_NOTICE } from "./opener.ts";
import type { InboundResolution } from "./numbers/sender.ts";
import type { VoiceEntitlementDecision } from "./entitlement.ts";

export const INBOUND_GREETING_VERSION = "od1-inbound.2026-09-28.v1";
export const RETURN_CALL_ROUTE = "RETURN_CALL";

export type TransferMode = "ON_REQUEST" | "ON_REQUEST_OR_ESCALATION" | "NEVER";

export type InboundDecision =
  | { kind: "REJECT"; reason: string; say: string }
  | {
      kind: "AI_AGENT";
      route: typeof RETURN_CALL_ROUTE;
      businessId: string;
      leadId: string;
      greeting: string;
      greetingVersion: string;
    }
  | { kind: "TRANSFER"; businessId: string; leadId: string | null; to: string; say: string; reason: string }
  | { kind: "MESSAGE"; businessId: string; leadId: string | null; say: string; textBack: boolean; textBody: string | null; reason: string };

function cleanName(name: string | null | undefined): string {
  return (name ?? "").replace(/\s+/g, " ").trim() || "us";
}

export function inboundGreeting(input: { callingAsName: string | null; recordingEnabled: boolean }): string {
  const name = cleanName(input.callingAsName);
  const opening = `Thanks for calling ${name}. You are speaking with an AI assistant.`;
  return input.recordingEnabled ? `${opening} ${RECORDING_NOTICE} How can I help?` : `${opening} How can I help?`;
}

export function inboundMessage(callingAsName: string | null, textBack: boolean): string {
  const name = cleanName(callingAsName);
  return textBack
    ? `Thanks for calling ${name}. We can't take your call right now, so we'll send you a text message and you can reply there. Goodbye.`
    : `Thanks for calling ${name}. We can't take your call right now. Goodbye.`;
}

export function transferMessage(callingAsName: string | null): string {
  return `Thanks for calling ${cleanName(callingAsName)}. Putting you through to the team now.`;
}

/** The text back: a reply to a call the person made, not marketing. It carries an opt-out. */
export function textBackBody(callingAsName: string | null): string {
  return `Hi, thanks for calling ${cleanName(callingAsName)}. Sorry we missed you. Reply here and we'll get back to you. Reply STOP to opt out.`;
}

export const NOT_IN_SERVICE = "The number you have called is not in service.";

export function decideInbound(input: {
  resolution: InboundResolution;
  entitlement: VoiceEntitlementDecision | null;
  lead: { optedOut: boolean; suppressed: boolean; anonymised: boolean } | null;
  settings: {
    callingAsName: string | null;
    recordingEnabled: boolean;
    transferMode: TransferMode;
    transferNumber: string | null;
  };
  /** The AI is connected (a VoiceProvider and an agent id). */
  aiReady: boolean;
  /** The caller's number can receive a text (a UK mobile). */
  callerCanReceiveSms: boolean;
  /**
   * An operator control stops this number being used (0158: a suspended
   * number, or the kill switch): never the AI, never a text or a transfer
   * from it, only the short message.
   */
  adminBlocked?: boolean;
}): InboundDecision {
  const r = input.resolution;
  if (r.kind === "UNROUTED") return { kind: "REJECT", reason: r.reason, say: NOT_IN_SERVICE };

  const { businessId } = r;
  const leadId = r.leadId;
  const name = input.settings.callingAsName;
  const transferTo =
    input.settings.transferMode !== "NEVER" && input.settings.transferNumber ? input.settings.transferNumber : null;

  if (input.adminBlocked) {
    return { kind: "MESSAGE", businessId, leadId, say: inboundMessage(name, false), textBack: false, textBody: null, reason: "ADMIN_BLOCKED" };
  }

  // Opted out of everything, suppressed or erased: never the AI, never a text.
  const blocked = Boolean(input.lead && (input.lead.optedOut || input.lead.suppressed || input.lead.anonymised));
  if (blocked) {
    if (transferTo) return { kind: "TRANSFER", businessId, leadId, to: transferTo, say: transferMessage(name), reason: "CONTACT_OPTED_OUT" };
    return { kind: "MESSAGE", businessId, leadId, say: inboundMessage(name, false), textBack: false, textBody: null, reason: "CONTACT_OPTED_OUT" };
  }

  const entitled = Boolean(input.entitlement?.allowed);
  if (leadId && entitled && input.aiReady) {
    return {
      kind: "AI_AGENT",
      route: RETURN_CALL_ROUTE,
      businessId,
      leadId,
      greeting: inboundGreeting({ callingAsName: name, recordingEnabled: input.settings.recordingEnabled }),
      greetingVersion: INBOUND_GREETING_VERSION,
    };
  }

  const reason = !leadId
    ? "UNKNOWN_CALLER"
    : !entitled
      ? `NOT_ENTITLED:${input.entitlement && !input.entitlement.allowed ? input.entitlement.reason : "UNKNOWN"}`
      : "AI_NOT_READY";
  if (transferTo) return { kind: "TRANSFER", businessId, leadId, to: transferTo, say: transferMessage(name), reason };
  const textBack = input.callerCanReceiveSms && Boolean(r.callerE164);
  return { kind: "MESSAGE", businessId, leadId, say: inboundMessage(name, textBack), textBack, textBody: textBack ? textBackBody(name) : null, reason };
}

/** The TwiML for a decision that Twilio plays itself (everything but the AI). */
export function inboundTwiml(decision: InboundDecision, callerId: string | null): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const say = (s: string) => `<Say language="en-GB">${esc(s)}</Say>`;
  switch (decision.kind) {
    case "REJECT":
      return `<?xml version="1.0" encoding="UTF-8"?><Response>${say(decision.say)}<Hangup/></Response>`;
    case "TRANSFER":
      return `<?xml version="1.0" encoding="UTF-8"?><Response>${say(decision.say)}<Dial${callerId ? ` callerId="${esc(callerId)}"` : ""}>${esc(decision.to)}</Dial></Response>`;
    case "MESSAGE":
      return `<?xml version="1.0" encoding="UTF-8"?><Response>${say(decision.say)}<Hangup/></Response>`;
    case "AI_AGENT":
      // The AI path is not played by Twilio: see inbound-core.ts (SIP to Retell).
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;
  }
}
