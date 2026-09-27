/**
 * The deterministic re-engagement copy (pure).
 *
 * The NOT_NOW and deadline check-ins are composed by the conversation agent
 * (a FOLLOW_UP_DUE turn), which reads the conversation and so can refer to
 * what the lead actually said. This copy is used where the agent cannot run
 * (AI off, the agent off, or not enabled on the channel), and for the three
 * messages that are deliberately NOT model-written:
 *
 *   * no-show rebooking: offers the times the calendar returned, verbatim, and
 *     the workspace's booking link, never a time a model invented;
 *   * win-back: the lead's deal is closed, which the agent will not reopen;
 *     the only commercial content is the workspace's own approved offer
 *     (its label, exact price wording and link), never a discount.
 *
 * No template promises a price, a quote, availability or a service area
 * beyond what the workspace registered. Merge values are resolved by the
 * caller; SMS opt-out wording and the email unsubscribe link are added by the
 * send path.
 *
 * Pure: no Supabase, no `server-only`.
 */

import type { CloseReasonCategory } from "../leads/close-reasons.ts";
import type { ReengagementTrigger } from "./triggers.ts";

export type TemplateValues = {
  firstName: string | null;
  businessName: string;
  serviceName: string | null;
  bookingLink: string | null;
};

export type ApprovedOffer = { label: string; priceText: string; url: string };

export type ReengagementCopy = { body: string; subject: string };

function hello(values: TemplateValues): string {
  const name = values.firstName?.trim();
  return name && name.toLowerCase() !== "there" ? `Hi ${name}` : "Hi";
}

function about(values: TemplateValues): string {
  const service = values.serviceName?.trim();
  return service ? service : "what you were looking at";
}

function linkLine(values: TemplateValues, lead: string): string {
  const link = values.bookingLink?.trim();
  return link ? ` ${lead} ${link}` : "";
}

/**
 * The copy for one trigger. `slots` are confirmed free times already formatted
 * for the lead's timezone (no-show rebooking only); `offer` is an approved
 * checkout link (win-back on a price loss only).
 */
export function reengagementCopy(input: {
  trigger: ReengagementTrigger;
  values: TemplateValues;
  lossCategory?: CloseReasonCategory | null;
  slots?: readonly string[];
  offer?: ApprovedOffer | null;
  /** DEADLINE_PASSED: the date the lead named, formatted for them. */
  statedDate?: string | null;
}): ReengagementCopy {
  const { values } = input;
  const greeting = hello(values);
  const business = values.businessName;

  switch (input.trigger) {
    case "NOT_NOW_RESUME":
      return {
        subject: `Picking up where we left off`,
        body: `${greeting}, it's ${business}. You asked us to get back in touch around now about ${about(values)}. Is now a better time to pick it up?${linkLine(values, "If it helps, you can choose a time here:")}`,
      };
    case "DEADLINE_PASSED":
      return {
        subject: `Checking in`,
        body: `${greeting}, it's ${business}. ${input.statedDate ? `You mentioned ${input.statedDate} for ${about(values)}` : `You mentioned a timeframe for ${about(values)}`}, so I wanted to check in. How are things looking?${linkLine(values, "If it's useful to talk, pick a time here:")}`,
      };
    case "NO_SHOW_REBOOK": {
      const slots = (input.slots ?? []).filter((slot) => slot.trim()).slice(0, 3);
      const times = slots.length
        ? ` Would one of these suit instead: ${slots.join(", ")}?`
        : " Would you like to pick another time?";
      return {
        subject: `Sorry we missed you`,
        body: `${greeting}, it's ${business}. Sorry we missed each other today, no problem at all.${times}${linkLine(values, "You can also choose any time here:")}`,
      };
    }
    case "NO_SHOW_NUDGE":
      return {
        subject: `Finding another time`,
        body: `${greeting}, it's ${business} again. Just checking you saw my last message. Happy to find another time that works for you.${linkLine(values, "Pick one here:")}`,
      };
    case "WIN_BACK":
      return winBackCopy(values, input.lossCategory ?? null, input.offer ?? null);
  }
}

function winBackCopy(
  values: TemplateValues,
  category: CloseReasonCategory | null,
  offer: ApprovedOffer | null,
): ReengagementCopy {
  const greeting = hello(values);
  const business = values.businessName;
  switch (category) {
    case "Price": {
      const offerLine = offer ? ` If it's useful, ${offer.label} is ${offer.priceText}: ${offer.url}` : "";
      return {
        subject: `Worth another look?`,
        body: `${greeting}, it's ${business}. When we last spoke about ${about(values)}, price was the sticking point. Things may have changed on both sides since, so I wanted to ask whether it's worth another conversation.${offerLine}`,
      };
    }
    case "Timing":
      return {
        subject: `Is the timing better now?`,
        body: `${greeting}, it's ${business}. When we last spoke the timing wasn't right for ${about(values)}. Is now a better time to pick it back up?${linkLine(values, "You can choose a time here:")}`,
      };
    case "Competitor":
      return {
        subject: `Checking in`,
        body: `${greeting}, it's ${business}. I hope things are going well with ${about(values)}. If anything isn't working as you'd hoped, we'd be glad to help. Just reply to this message.`,
      };
    default:
      return {
        subject: `Still on your list?`,
        body: `${greeting}, it's ${business}. We lost touch a while back. Is ${about(values)} still something you're looking at?${linkLine(values, "If so, you can choose a time here:")}`,
      };
  }
}
