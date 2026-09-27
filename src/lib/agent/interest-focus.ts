/**
 * The turn's context narrowed to the one interest the coordinator chose
 * (08 §B.20, qualification-intelligence/interests.ts). Pure.
 *
 * A lead who wants a subscription and a website rebuild is sold one of them
 * per turn. For that turn:
 *   - the direct-close gate reads THAT offer's motion (a self-serve
 *     subscription closes by checkout even in a workspace that books
 *     meetings), so the approved links are shown when it closes by link;
 *   - booking uses the meeting type for THAT offer's service.
 * Nothing is loosened: the checkout gate, the validator and the booking gate
 * still run on every send exactly as before.
 */

import { motionAllowsDirectClose } from "../opportunities/stages.ts";
import type { AgentContext } from "./context.ts";
import type { InterestTurn } from "./qi-turn.ts";

export function withInterestFocus(context: AgentContext, interests: InterestTurn): AgentContext {
  const { primary } = interests;
  const motion = primary.motion as AgentContext["sales"]["motion"];
  const authority = context.commerce?.authority;
  return {
    ...context,
    sales: { ...context.sales, motion },
    commerce: authority ? { authority, directClose: authority.enabled && motionAllowsDirectClose(motion) } : context.commerce,
    booking: primary.meetingType ? { ...context.booking, meetingType: primary.meetingType } : context.booking,
  };
}
