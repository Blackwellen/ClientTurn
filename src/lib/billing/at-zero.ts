/**
 * What happens to an SMS / WhatsApp send refused because the channel's
 * allowance AND top-up credit are used up (there is no overage: owner rule
 * 2026-09-27). Pure, so the send store and the tests agree.
 *
 *   * An automated follow-up step, or an AI reply to a lead who wrote in, goes
 *     by EMAIL instead when the lead has an email address, a mailbox is
 *     connected, and the address is not suppressed / the lead not opted out.
 *   * Otherwise an AI reply is HANDED OVER: the lead goes to a person (the AI
 *     stops for them) and the owner is told to top up. An engaged lead's
 *     message is never left silently unanswered (conversion wins).
 *   * Otherwise (an automated step with no email route, a text typed by a
 *     person, a campaign or system send) nothing more happens: the message
 *     stays BLOCKED with its reason, which the person sending it sees.
 */

export type AtZeroRoute = "email" | "handover" | "none";

const REROUTABLE = new Set(["automation", "agent", "agent_handover"]);
const AI_REPLY = new Set(["agent", "agent_handover"]);

export function atZeroRoute(input: {
  origin: string;
  leadHasEmail: boolean;
  mailboxConnected: boolean;
  emailSuppressed: boolean;
  optedOut: boolean;
}): AtZeroRoute {
  if (!REROUTABLE.has(input.origin)) return "none";
  if (!input.optedOut && input.leadHasEmail && input.mailboxConnected && !input.emailSuppressed) {
    return "email";
  }
  // An opted-out lead is finished: never put them in a person's queue to be
  // messaged anyway.
  if (AI_REPLY.has(input.origin) && !input.optedOut) return "handover";
  return "none";
}
