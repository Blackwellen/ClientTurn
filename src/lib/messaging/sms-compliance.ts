/**
 * Pure SMS compliance decisions: which provider errors are suppression facts,
 * and whether a sender can receive a STOP reply at all.
 *
 * No `server-only`, no database: the Twilio provider and the Twilio status
 * webhook both apply these, and the unit tests exercise them directly.
 */

export type ProviderSuppression = {
  reason: "OPT_OUT" | "INVALID";
  channel: "SMS" | "WHATSAPP";
};

/**
 * Twilio error codes that are facts about the recipient, not the send.
 *
 *   * 21610 — the recipient replied STOP to this sender at the carrier level.
 *     Twilio refuses every further SMS; the product must record it as the
 *     person's opt-out, or it keeps queuing messages that can never arrive and
 *     never learns the person asked to be left alone. Always SMS: it is
 *     Twilio's SMS STOP list.
 *   * 21211 — the "To" number is not a valid phone number.
 *   * 21614 — the "To" number is not a mobile / cannot receive SMS.
 *
 * Anything else (rate limits, content filtering, account problems) says nothing
 * about the recipient and returns null.
 */
export function twilioErrorSuppression(
  code: string | number | null | undefined,
  channel: string | null | undefined,
): ProviderSuppression | null {
  const value = Number(code);
  if (!Number.isFinite(value)) return null;

  if (value === 21610) return { reason: "OPT_OUT", channel: "SMS" };

  if (value === 21211 || value === 21614) {
    return {
      reason: "INVALID",
      channel: (channel ?? "").toLowerCase() === "whatsapp" ? "WHATSAPP" : "SMS",
    };
  }

  return null;
}

/**
 * True when a sender is an alphanumeric sender ID ("ClientTurn") rather than a
 * number. In the UK these are one-way: the recipient cannot reply at all, so
 * "Reply STOP" is not an opt-out route and marketing sent from one must carry
 * another (PECR reg. 22(3)(b) — a simple means of refusal in every message).
 *
 * A Messaging Service SID (`MG…`) is not a sender and cannot be judged here;
 * the service's own sender pool decides. A number (E.164 or a short code) can
 * receive STOP.
 */
export function requiresAlternativeOptOut(from: string | null | undefined): boolean {
  if (!from) return false;
  const value = from.replace(/^whatsapp:/i, "").trim();
  if (value === "") return false;
  if (/^MG[0-9a-f]{32}$/i.test(value)) return false;
  // Numbers, with the usual formatting a configured value may carry.
  if (/^\+?[\d\s()-]{3,20}$/.test(value)) return false;
  return true;
}

export type SenderDecision =
  | { action: "send"; body: string }
  | { action: "block"; errorCode: string; errorMessage: string };

/**
 * What to do with an SMS about to go out from `from`.
 *
 * A numeric sender sends as written. A one-way alphanumeric sender sends only
 * when there is an alternative opt-out route to append (an opt-out URL);
 * otherwise it is blocked — the provider layer cannot tell marketing from a
 * one-off, and a one-way sender also cannot carry the conversation the
 * product exists for, so refusing is the safe and honest outcome.
 */
export function decideSmsSender(input: {
  from: string | null | undefined;
  body: string;
  optOutUrl?: string | null;
}): SenderDecision {
  if (!requiresAlternativeOptOut(input.from)) {
    return { action: "send", body: input.body };
  }

  if (input.optOutUrl) {
    return input.body.includes(input.optOutUrl)
      ? { action: "send", body: input.body }
      : { action: "send", body: `${input.body}\n\nOpt out: ${input.optOutUrl}` };
  }

  return {
    action: "block",
    errorCode: "one_way_sender",
    errorMessage:
      "The SMS sender is an alphanumeric ID, which recipients cannot reply to, " +
      "so STOP cannot work. Configure a phone number as TWILIO_SMS_FROM, or " +
      "include an opt-out link.",
  };
}

/**
 * The workspace's opt-out wording ("Reply STOP to opt out.") appended to a
 * marketing SMS or WhatsApp body. One copy, used by the follow-up engine's
 * first step and by every reactivation campaign message.
 *
 * Email is left alone: its unsubscribe link is added by the email renderer
 * from the lead's own token, and "reply STOP" would be wrong there. A body
 * that already mentions STOP is left as written rather than saying it twice.
 */
export function withOptOutWording(
  body: string,
  input: { channel: string; wording: string | null | undefined },
): string {
  const text = body.trim();
  if (input.channel !== "sms" && input.channel !== "whatsapp") return text;
  const wording = input.wording?.trim();
  if (!wording) return text;
  if (text.toLowerCase().includes("stop")) return text;
  return `${text}\n${wording}`;
}
