/**
 * The Messenger / Instagram pre-send window check for manual and automation
 * sends (Phase 3.5, 01 §5). Pure.
 *
 * Meta's rules: an automated message only inside 24 hours of the person's
 * last message. Past 24 hours only a PERSON may reply, with the Human Agent
 * tag, for up to 7 days -- and a bot never uses the tag.
 *
 * This send path delivers with `messaging_type: RESPONSE` and does not apply
 * the Human Agent tag (which needs Meta's Human Agent permission on the app),
 * so between 24 hours and 7 days a manual reply is refused here with a clear
 * instruction rather than attempted and rejected by Meta. Automated origins
 * are refused outright past 24 hours.
 */

import { withinHumanAgentWindow, withinMetaMessagingWindow } from "./types.ts";

export type MetaWindowDecision =
  | { allowed: true }
  | { allowed: false; reason: "WINDOW_CLOSED" | "HUMAN_AGENT_ONLY"; message: string };

export function metaWindowDecision(input: {
  origin: string;
  lastInboundAt: string | null;
  now: Date;
}): MetaWindowDecision {
  if (withinMetaMessagingWindow(input.lastInboundAt, input.now)) return { allowed: true };

  if (input.origin === "manual" && withinHumanAgentWindow(input.lastInboundAt, input.now)) {
    return {
      allowed: false,
      reason: "HUMAN_AGENT_ONLY",
      message:
        "It has been more than 24 hours since this person last wrote. Only a person may reply now, for up to 7 days, from Meta Business Suite using the Human Agent tag.",
    };
  }

  return {
    allowed: false,
    reason: "WINDOW_CLOSED",
    message:
      "Meta only allows a reply within 24 hours of the person's last message. This message can go once they write again.",
  };
}
