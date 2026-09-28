/**
 * Response patterns for every objection (elite-closer brief, 2026-09-27).
 *
 * The playbook in objections.ts says what an objection may mean and what
 * never to do. These say how a skilled seller answers it, in the proven
 * shape:
 *
 *   1. acknowledge   show you heard it, in a few words, without agreeing
 *                    that the offer is wrong and without "I completely
 *                    understand";
 *   2. clarify       one question, only when the real concern is unclear;
 *   3. reframe       value or proof that answers the concern, drawn ONLY
 *                    from the offer card's approved claims, the business's
 *                    own reassurance facts and the lead's own words;
 *   4. next step     one small, easy step (a question, a short call, a
 *                    resource), never a demand.
 *
 * They are instructions to the drafter, not scripts: the model writes the
 * words, the validator checks them. Nothing here names a figure, a
 * guarantee, a customer or a deadline, and the levers are the lawful ones
 * (relevance to the lead's words, genuine approved proof, useful insight,
 * small steps, loss framing only on a fact the lead stated). No fake
 * scarcity, invented urgency or fabricated social proof (UK BPMMRs 2008,
 * CPRs / DMCC Act 2024, CAP code).
 *
 * `pickResponsePattern` is deterministic: the first objection of its kind
 * in a conversation gets the clarifying pattern when the concern is
 * ambiguous; a repeat, or a concern already specific, gets the reframe. A
 * pattern with a `when` test (the AI-concern answer under TRUST) wins when
 * the lead's words match it.
 *
 * The next step follows the GOAL (objection matrix pass, 2026-09-28): a
 * pattern that `advances` the sale takes the motion's own step (a meeting at
 * two confirmed times, the checkout link, the sign-up link, a priced quote)
 * instead of always "a short call", so a direct-sale lead is never talked
 * back into a meeting. A clarifying turn ends on its one question and keeps
 * the step for the answer; a repeat takes a new angle, never the same
 * question or reason.
 *
 * Pure.
 */

import type { CloseTarget, ObjectionKey } from "./types.ts";

export type ResponsePattern = {
  /** Short internal name, stored on the run. */
  name: string;
  acknowledge: string;
  /** Present when this pattern asks the one clarifying question. */
  clarify?: string;
  reframe: string;
  nextStep: string;
  /** The next step moves toward the sale: rendered as the goal's own step (`GOAL_NEXT_STEP`). */
  advances?: boolean;
  /** Chosen whenever the lead's words match (before the first/repeat rule). */
  when?: RegExp;
};

/** What the conversation closes on, for an objection's next step. */
export type ObjectionGoal = "MEETING" | "DIRECT_SALE" | "TRIAL" | "QUOTE";

export function objectionGoalFor(target: CloseTarget): ObjectionGoal {
  switch (target) {
    case "CHECKOUT":
    case "PROPOSAL":
      return "DIRECT_SALE";
    case "TRIAL_OR_SIGNUP":
      return "TRIAL";
    case "QUOTE_OR_VISIT":
      return "QUOTE";
    default:
      return "MEETING";
  }
}

/** The one small step toward each goal, as a strategy-line phrase. */
export const GOAL_NEXT_STEP: Readonly<Record<ObjectionGoal, string>> = {
  MEETING: "a short call at one of two confirmed times",
  DIRECT_SALE: "the approved checkout link, so they can go ahead when ready",
  TRIAL: "the sign-up link, so they can try it for themselves",
  QUOTE: "offer to price it up and send the quote, so they see the real figure",
};

const PROOF = "one approved claim or reassurance fact that answers it, if there is one";

export const OBJECTION_RESPONSES: Record<ObjectionKey, ResponsePattern[]> = {
  PRICE: [
    { name: "price-clarify", acknowledge: "fair question, no defensiveness", clarify: "is it the overall figure, or how it compares with something else", reframe: "tie the price to the result they said they want", nextStep: "offer to walk through what is included on a short call", advances: true },
    { name: "price-value", acknowledge: "name the concern plainly", reframe: `what is included, then ${PROOF}`, nextStep: "a small step: the option that fits their stated need", advances: true },
    { name: "price-compare", acknowledge: "comparing is sensible", reframe: "ask what the other quote includes, never knock it; set scope side by side", nextStep: "offer to check like for like", advances: true },
  ],
  BUDGET: [
    { name: "budget-clarify", acknowledge: "budgets are real", clarify: "no budget this period, or it needs someone else's sign-off", reframe: "if it returns at a known point, work to that date", nextStep: "offer to pick it up then" },
    { name: "budget-sponsor", acknowledge: "someone else holds it", reframe: `a short summary built on their own words and ${PROOF}`, nextStep: "offer something they can forward", advances: true },
  ],
  TIMING: [
    { name: "timing-accept", acknowledge: "the timing is theirs", reframe: "if they stated a cost of waiting, reflect it back once, gently", nextStep: "offer to pick it up at the time they name" },
    { name: "timing-prepare", acknowledge: "makes sense", reframe: "a small step now makes that date easier (only if true for this offer)", nextStep: "a light prep step, or a reminder near their date" },
  ],
  COMPETITOR: [
    { name: "competitor-criteria", acknowledge: "comparing is sensible", clarify: "what matters most in choosing", reframe: "answer that criterion with an approved differentiator; never criticise anyone", nextStep: "offer the one thing that helps them compare", advances: true },
    { name: "competitor-differentiator", acknowledge: "good to look around", reframe: `the one approved differentiator most relevant to what they said, plus ${PROOF}`, nextStep: "a short call to check fit", advances: true },
  ],
  EXISTING_PROVIDER: [
    { name: "incumbent-gap", acknowledge: "respect the relationship", clarify: "anything they would change if they could", reframe: "only build on a gap they name", nextStep: "offer a second opinion, no switch implied", advances: true },
    { name: "incumbent-door-open", acknowledge: "good that it works", reframe: "no pitch; leave one approved point that is different", nextStep: "offer to reconnect near their renewal" },
  ],
  NO_NEED: [
    { name: "need-probe", acknowledge: "fair enough", clarify: "how they handle it today", reframe: "only connect to a problem they describe", nextStep: "if no need, thank them and close warmly" },
    { name: "need-close-warm", acknowledge: "thank them", reframe: "none", nextStep: "leave the door open in one line and stop" },
  ],
  DONT_UNDERSTAND: [
    { name: "explain-plain", acknowledge: "own the unclear message", reframe: "one or two plain sentences from the approved description, in their terms", nextStep: "ask which part matters most to them" },
    { name: "explain-example", acknowledge: "happy to explain", reframe: "one approved example that looks like their situation", nextStep: "check it makes sense" },
  ],
  TRUST: [
    { name: "trust-ai-honest", when: /\b(robot|bot|chatbot|a\.?i\.?|automated|machine|real person|a human)\b/i, acknowledge: "fair to ask", reframe: "say plainly that you are the business's AI assistant and a person at the business is on hand too; then one approved fact that answers their worry", nextStep: "a short call with a person from the team at one of two confirmed times, if they prefer", advances: true },
    { name: "trust-proof", acknowledge: "fair challenge", reframe: `verifiable facts only: ${PROOF}; never a made-up testimonial`, nextStep: "offer what would help them check", advances: true },
    { name: "trust-clarify", acknowledge: "reasonable to ask", clarify: "what would help them feel confident", reframe: "answer that with approved facts", nextStep: "a low-risk first step", advances: true },
  ],
  IMPLEMENTATION: [
    { name: "implementation-who", acknowledge: "effort matters", clarify: "who would be involved on their side", reframe: "what the business does for them, from approved onboarding facts", nextStep: "offer a short walkthrough", advances: true },
    { name: "implementation-light", acknowledge: "nobody wants a big project", reframe: `the approved onboarding steps and ${PROOF}`, nextStep: "the smallest first step", advances: true },
  ],
  COMPLEXITY: [
    { name: "complexity-simplest", acknowledge: "it can look like a lot", clarify: "which part looks like more than they need", reframe: "the simplest approved option that fits what they said", nextStep: "offer to show just that part", advances: true },
    { name: "complexity-scope", acknowledge: "fair", reframe: "they only need the part that fits their stated use", nextStep: "a short look at that part", advances: true },
  ],
  SWITCHING_COST: [
    { name: "switching-worry", acknowledge: "switching is real effort", clarify: "what would worry them most", reframe: "approved migration or handover help, only if it exists", nextStep: "offer to map the switch on a call", advances: true },
    { name: "switching-help", acknowledge: "fair", reframe: `the approved switching help and ${PROOF}`, nextStep: "a light look at what moving would involve", advances: true },
  ],
  SECURITY: [
    { name: "security-assist", acknowledge: "sensible to check", reframe: "a colleague sends the approved documents; promise nothing about them", nextStep: "carry on with the plan" },
    { name: "security-standard", acknowledge: "good question", clarify: "which standard or questionnaire applies", reframe: "approved security facts only", nextStep: "a colleague sends the documents" },
  ],
  COMPLIANCE: [
    { name: "compliance-handover", acknowledge: "important to get right", reframe: "a person answers regulatory questions", nextStep: "hand over" },
    { name: "compliance-policy", acknowledge: "fair", reframe: "point to approved published policies only", nextStep: "hand over for anything beyond them" },
  ],
  FEATURE: [
    { name: "feature-use", acknowledge: "good to check", clarify: "how they would use it day to day", reframe: "answer from the approved feature list; if unlisted, a colleague confirms", nextStep: "the next step for their use case", advances: true },
    { name: "feature-answer", acknowledge: "direct answer first", reframe: "yes or no from approved facts, with how it helps what they said", nextStep: "one question about their use", advances: true },
  ],
  AUTHORITY: [
    { name: "authority-forward", acknowledge: "of course", reframe: "a short summary in their words they can forward", nextStep: "offer the summary or a call with both", advances: true },
    { name: "authority-clarify", acknowledge: "makes sense", clarify: "who else is involved and what they would want to know", reframe: `answer that person's likely concern with ${PROOF}`, nextStep: "a call that includes them", advances: true },
  ],
  PROCUREMENT: [
    { name: "procurement-assist", acknowledge: "processes are normal", reframe: "a colleague handles the supplier paperwork", nextStep: "keep moving toward the meeting" },
    { name: "procurement-clarify", acknowledge: "fair", clarify: "what the process involves on their side", reframe: "a colleague provides the documents", nextStep: "carry on qualifying" },
  ],
  CONTRACT: [
    { name: "contract-handover", acknowledge: "worth reading properly", reframe: "a person handles terms", nextStep: "hand over" },
    { name: "contract-published", acknowledge: "fair", reframe: "point to published terms only, never interpret them", nextStep: "hand over for anything else" },
  ],
  SEND_INFORMATION: [
    { name: "info-target", acknowledge: "happy to", clarify: "what would be most useful so you send the right thing", reframe: "approved material that fits what they said", nextStep: "one light next step after it", advances: true },
    { name: "info-plus-step", acknowledge: "sure", reframe: `the one approved point most relevant to them and ${PROOF}`, nextStep: "offer a short call to go through it", advances: true },
  ],
  NOT_INTERESTED: [
    { name: "refusal-respect", acknowledge: "thank them", reframe: "none; do not try to change their mind", nextStep: "confirm and stop" },
    { name: "refusal-brief", acknowledge: "understood", reframe: "none", nextStep: "stop" },
  ],
  TOO_BUSY: [
    { name: "busy-lighter", acknowledge: "respect their time", reframe: "make it smaller: the lowest-effort step", nextStep: "offer email or a short slot at one of two confirmed times", advances: true },
    { name: "busy-later", acknowledge: "no problem", clarify: "when would be quieter", reframe: "none", nextStep: "pick it up then" },
  ],
  CALL_LATER: [
    { name: "later-confirm", acknowledge: "no problem", reframe: "none", nextStep: "confirm the time they named" },
    { name: "later-ask", acknowledge: "sure", clarify: "when suits best", reframe: "none", nextStep: "record it" },
  ],
  INTERNAL_BUILD: [
    { name: "inhouse-respect", acknowledge: "respect the choice", clarify: "how the in-house approach is going", reframe: "only approved ways the business complements an in-house team", nextStep: "leave the door open" },
    { name: "inhouse-complement", acknowledge: "makes sense", reframe: `where the business fits beside their team, with ${PROOF}`, nextStep: "a short chat to compare notes", advances: true },
  ],
  RISK: [
    { name: "risk-clarify", acknowledge: "reasonable worry", clarify: "what a bad outcome would look like", reframe: "approved safeguards only (trial, terms, phased start)", nextStep: "the lowest-risk first step", advances: true },
    { name: "risk-safeguard", acknowledge: "fair", reframe: `approved safeguards and ${PROOF}; never promise results`, nextStep: "a small first step", advances: true },
  ],
  STATUS_QUO: [
    { name: "status-quo-gap", acknowledge: "respect that it works", clarify: "one thing they would change if they could", reframe: "build only on a gap they name", nextStep: "offer a quick look, no commitment", advances: true },
    { name: "status-quo-insight", acknowledge: "fair enough", reframe: `one useful approved point they may not have considered, with ${PROOF}`, nextStep: "ask if it is worth a short look", advances: true },
  ],
  NOT_NOW: [
    { name: "not-now-clarify", acknowledge: "no pressure", clarify: "is it the timing or something else", reframe: "none until the concern is clear", nextStep: "follow their answer" },
    { name: "not-now-later", acknowledge: "fine", reframe: "none; never invent urgency", nextStep: "offer to pick it up at a time they choose" },
  ],
  LOCK_IN: [
    { name: "lock-in-date", acknowledge: "makes sense", clarify: "when the current contract comes up for renewal", reframe: "reconnecting before then gives them time to compare", nextStep: "offer to get back in touch ahead of that date" },
    { name: "lock-in-prepare", acknowledge: "fair", reframe: `a short look now means no rush later, with ${PROOF}`, nextStep: "offer a short call well before their renewal", advances: true },
  ],
  JUST_LOOKING: [
    { name: "just-looking-useful", acknowledge: "no pressure at all", reframe: "be useful: one approved point that fits what they said", nextStep: "the lightest next step", advances: true },
    { name: "just-looking-why", acknowledge: "makes sense", clarify: "what got them looking", reframe: "none until they say", nextStep: "follow their answer" },
  ],
};

/**
 * The pattern for this turn. The first time an objection is raised and its
 * concern is not specific, clarify; a repeat (the lead objected the same way
 * before) or a specific concern gets the reframe.
 */
export function pickResponsePattern(key: ObjectionKey, input: { seenBefore: boolean; text?: string | null }): ResponsePattern {
  const all = OBJECTION_RESPONSES[key];
  const special = input.text ? all.find((p) => p.when?.test(input.text ?? "")) : undefined;
  if (special) return special;
  const patterns = all.filter((p) => !p.when);
  if (input.seenBefore) return patterns.find((p) => !p.clarify) ?? patterns[0];
  return patterns.find((p) => p.clarify) ?? patterns[0];
}

/** The pattern's next step for this goal: an advancing step becomes the goal's own. */
export function nextStepFor(pattern: ResponsePattern, goal?: ObjectionGoal | null): string {
  if (!pattern.advances || !goal) return pattern.nextStep;
  // A meeting goal keeps the pattern's own wording when it is a meeting step
  // ("walk through what is included on a short call"); anything else ("the
  // lightest next step", "something they can forward") becomes the meeting.
  if (goal === "MEETING") return /\b(call|chat|meeting|walk|slot)\b/i.test(pattern.nextStep) ? pattern.nextStep : GOAL_NEXT_STEP.MEETING;
  return GOAL_NEXT_STEP[goal];
}

export const REPEAT_OBJECTION_NOTE = "They raised this before: take a new angle, and never repeat an earlier question or reason.";

/**
 * One line for the strategy block: the shape of the reply. A clarifying turn
 * ends on its one question (the step waits for the answer), so the reply
 * never carries a question and a second call to action.
 */
export function renderResponsePattern(pattern: ResponsePattern, options: { goal?: ObjectionGoal | null; repeat?: boolean } = {}): string {
  const step = nextStepFor(pattern, options.goal);
  const repeat = options.repeat ? ` ${REPEAT_OBJECTION_NOTE}` : "";
  const parts = [`acknowledge (${pattern.acknowledge})`];
  if (pattern.reframe !== "none") parts.push(`reframe (${pattern.reframe})`);
  if (pattern.clarify) {
    parts.push(`end on one clarifying question (${pattern.clarify})`);
    return `Shape: ${parts.join(", then ")}. Keep the next step (${step}) for after they answer.${repeat}`;
  }
  parts.push(`next step (${step})`);
  return `Shape: ${parts.join(", then ")}.${repeat}`;
}
