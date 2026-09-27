/**
 * The objection library (design doc 04 §6, brief §59).
 *
 * Each entry gives the conversation a *playbook*, not a script:
 *   * surface patterns: how the objection tends to be phrased;
 *   * underlying concerns: what it may actually mean;
 *   * one clarifying question, because the right response depends on which
 *     concern it is, and guessing produces the canned rebuttal buyers hate;
 *   * a response strategy, written as instructions. It may only draw on the
 *     workspace's approved claims, prices and proof. It never invents a
 *     discount, a guarantee, a customer name, a statistic or a deadline;
 *   * handover conditions: when a person must take over. Owner decision
 *     2026-09-27: only a legal or contractual question, or a commitment the
 *     AI may not make (a discount, special terms, a bespoke plan), hands
 *     over. Security documents and procurement steps are an `assist`: a
 *     colleague provides them in the background and the AI keeps going.
 *
 * `matchObjection` is a deterministic surface match. It picks which playbook to
 * load when the classifier (or a person) has already decided the message is an
 * objection; it does not decide *whether* a message is one. False positives are
 * cheap (a playbook the model does not need), false negatives are covered by
 * the classifier's OBJECTION intent.
 *
 * The response strategies follow the anti-pressure rules the evidence supports
 * (01 §7: reactance). Nothing here uses scarcity, fake urgency or NLP
 * techniques.
 *
 * Pure module.
 */

import { OBJECTION_KEYS, type ObjectionKey } from "./types.ts";

export type ObjectionEntry = {
  key: ObjectionKey;
  label: string;
  patterns: RegExp[];
  underlyingConcerns: string[];
  clarifyingQuestion: string;
  /** Instructions to the drafter. References to facts are to *approved* data. */
  responseStrategy: string[];
  handover: {
    /** Always a person's job: a legal, regulatory or contract-terms question. */
    always: boolean;
    /** Conditions under which it becomes a person's job (a commitment the AI may not make). */
    when: string[];
  };
  /**
   * A colleague confirms or provides something in the background while the
   * AI keeps the conversation (types.ts ASSIST_REQUEST). Never a hand-over.
   */
  assist?: {
    /** Always a colleague's task (security documents, procurement steps). */
    always: boolean;
    /** Conditions under which a colleague is asked to confirm a detail. */
    when: string[];
  };
  /** A refusal: stop selling, confirm, and do not follow up on this thread. */
  respectAsRefusal: boolean;
};

const NEVER_INVENT =
  "Do not invent a discount, guarantee, statistic, customer name or deadline; use only approved claims and prices.";

export const OBJECTIONS: Record<ObjectionKey, ObjectionEntry> = {
  PRICE: {
    key: "PRICE",
    label: "Price",
    patterns: [
      /\b(too|very|bit|quite|rather) (expensive|pricey|dear|steep)\b/i,
      /\b(price|prices|pricing|cost|costs|quote|fee|fees)\b[^.?!]{0,30}\b(too )?(high|steep|a lot|much|more than)\b/i,
      /\bcheaper\b/i,
      /\bout of (my|our) price range\b/i,
    ],
    underlyingConcerns: [
      "The value is not yet clear relative to the price.",
      "They are comparing with a cheaper quote that has a different scope.",
      "The price is fine but the timing of the spend is not.",
    ],
    clarifyingQuestion: "Is it the overall price, or how it compares with something else you've seen?",
    responseStrategy: [
      "Restate what is included using the approved service description.",
      "If they compare with another quote, ask what that quote includes rather than disparaging it.",
      "Mention published payment options only if they exist in the approved data.",
      NEVER_INVENT,
    ],
    handover: {
      always: false,
      when: ["They ask for a discount or a price that is not on the approved list."],
    },
    respectAsRefusal: false,
  },
  BUDGET: {
    key: "BUDGET",
    label: "Budget",
    patterns: [
      /\bno (budget|money)\b/i,
      /\bbudget\b[^.?!]{0,30}\b(gone|spent|tight|frozen|allocated|used up|cut)\b/i,
      /\bcan'?t afford\b/i,
      /\bnot in (the|our|this year'?s?) budget\b/i,
    ],
    underlyingConcerns: [
      "There genuinely is no budget this period.",
      "Budget exists but belongs to someone else.",
      "The case for spending has not been made internally.",
    ],
    clarifyingQuestion: "Is it that there's no budget this period, or that it would need signing off by someone else?",
    responseStrategy: [
      "If budget returns at a known point, offer to follow up then and record the date.",
      "If someone else holds budget, offer approved material they can share.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: ["They ask for special payment terms or credit."] },
    respectAsRefusal: false,
  },
  TIMING: {
    key: "TIMING",
    label: "Timing",
    patterns: [
      /\bnot (the )?right time\b/i,
      /\b(maybe|perhaps|possibly) (next|later) (year|month|quarter)\b/i,
      /\b(in|after) (the )?(new year|christmas|q[1-4]|spring|summer|autumn|winter|busy season|year end)\b/i,
      /\b(next|this) (financial year|quarter|budget cycle)\b/i,
    ],
    underlyingConcerns: [
      "A real constraint (a busy season, a project, a renewal date).",
      "A polite way of saying the need is not pressing.",
    ],
    clarifyingQuestion: "When would be a better time to pick this up?",
    responseStrategy: [
      "Accept the timing. Offer to follow up at the time they name and record it.",
      "Do not manufacture urgency.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
  COMPETITOR: {
    key: "COMPETITOR",
    label: "Considering a competitor",
    patterns: [
      /\b(looking at|talking to|speaking to|comparing|got quotes from|getting quotes from|quotes (from|off)) (other|another|a few|several)\b/i,
      /\b(other|another) (compan(y|ies)|providers?|agenc(y|ies)|suppliers?|quotes?)\b/i,
      /\bgoing with (someone|somebody) else\b/i,
    ],
    underlyingConcerns: [
      "They want reassurance they are choosing well.",
      "Price or scope comparison is under way.",
    ],
    clarifyingQuestion: "What matters most to you in choosing between them?",
    responseStrategy: [
      "Never criticise a named competitor.",
      "Answer the criterion they named with approved differentiators only.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: ["They ask for a head-to-head comparison or price match."] },
    respectAsRefusal: false,
  },
  EXISTING_PROVIDER: {
    key: "EXISTING_PROVIDER",
    label: "Already have a provider",
    patterns: [
      /\b(already|currently) (have|use|using|work with|working with|got)\b/i,
      /\bhappy with (our|my) (current )?(provider|supplier|agency|accountant|it company)\b/i,
      /\bwe('?ve| have) (got )?(someone|somebody|a company)\b/i,
    ],
    underlyingConcerns: [
      "Genuinely satisfied.",
      "Switching feels like effort or risk.",
      "A contract ties them in until a date.",
    ],
    clarifyingQuestion: "Is there anything you'd change about the current setup if you could?",
    responseStrategy: [
      "Respect the relationship. If they are happy, say so and leave the door open.",
      "If a renewal date exists, offer to reconnect before it.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
  NO_NEED: {
    key: "NO_NEED",
    label: "No need",
    patterns: [
      /\b(don'?t|do not|doesn'?t) need (it|this|that|one|anything|any help)\b/i,
      /\bno (need|requirement) for\b/i,
      /\bnot (something|a problem) (we|i) (need|have)\b/i,
    ],
    underlyingConcerns: [
      "The problem does not exist for them.",
      "They have not connected the offer to a problem they do have.",
    ],
    clarifyingQuestion: "Fair enough. Out of interest, how are you handling that today?",
    responseStrategy: [
      "Ask once. If the answer confirms no need, thank them and close the thread.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
  DONT_UNDERSTAND: {
    key: "DONT_UNDERSTAND",
    label: "Doesn't understand the offer",
    patterns: [
      /\b(don'?t|do not) (understand|get it|follow)\b/i,
      /\bwhat (exactly )?(is|does) (this|it|that|your (product|service))\b/i,
      /\b(confused|not sure what you (do|mean))\b/i,
    ],
    underlyingConcerns: ["The message was unclear or too abstract."],
    clarifyingQuestion: "Happy to explain. Which part should I start with?",
    responseStrategy: [
      "Explain in one or two plain sentences from the approved service description, in the buyer's own terms.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
  TRUST: {
    key: "TRUST",
    label: "Trust",
    patterns: [
      /\b(is this|are you) (a )?(scam|legit|legitimate|real)\b/i,
      /\bhow do i know\b/i,
      /\b(never heard of|who are) you\b/i,
      /\b(reviews|references|testimonials|case stud(y|ies))\b/i,
    ],
    underlyingConcerns: [
      "They do not know the business.",
      "A bad past experience with a similar provider.",
    ],
    clarifyingQuestion: "What would help you feel confident about us?",
    responseStrategy: [
      "Give verifiable facts only: registered company details, approved accreditations, links to real published reviews.",
      "Never fabricate or paraphrase a testimonial.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    assist: { always: false, when: ["They ask for a reference customer to speak to."] },
    respectAsRefusal: false,
  },
  IMPLEMENTATION: {
    key: "IMPLEMENTATION",
    label: "Implementation effort",
    patterns: [
      /\b(how long|how hard|how much work) (does it|would it|will it) (take )?(to )?(set ?up|implement|onboard|get started)\b/i,
      /\b(setup|set up|implementation|onboarding|rollout|migration)\b[^.?!]{0,30}\b(effort|time|work|pain|hassle)\b/i,
    ],
    underlyingConcerns: ["They lack time or people to implement.", "A previous rollout went badly."],
    clarifyingQuestion: "Who on your side would be involved in getting it set up?",
    responseStrategy: [
      "Describe the approved onboarding process and what the business does for them.",
      "Only quote setup times that are in approved data.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: ["They need a bespoke implementation plan or timeline commitment."] },
    respectAsRefusal: false,
  },
  COMPLEXITY: {
    key: "COMPLEXITY",
    label: "Too complex",
    patterns: [
      /\b(too|looks|seems|sounds) (complicated|complex|technical|confusing)\b/i,
      /\b(overkill|too much for (us|me))\b/i,
    ],
    underlyingConcerns: ["The offer looks bigger than their need.", "Fear of not being able to use it."],
    clarifyingQuestion: "Which part looks like more than you need?",
    responseStrategy: [
      "Point to the simplest approved option or plan that fits what they said.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
  SWITCHING_COST: {
    key: "SWITCHING_COST",
    label: "Switching cost",
    patterns: [
      /\b(hassle|pain|effort|cost) (of|to) (switch|switching|change|changing|move|moving)\b/i,
      /\b(switch|switching|moving) (over|across)?\b[^.?!]{0,30}\b(hassle|pain|effort|difficult)\b/i,
    ],
    underlyingConcerns: ["Contract lock-in.", "Data or process migration effort.", "Disruption risk."],
    clarifyingQuestion: "What would worry you most about switching?",
    responseStrategy: [
      "Describe approved migration or handover help only if it exists.",
      "If they are tied in, record the end date and offer to reconnect before it.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: ["They ask the business to cover exit fees or overlap costs."] },
    respectAsRefusal: false,
  },
  SECURITY: {
    key: "SECURITY",
    label: "Security",
    patterns: [
      /\b(security|infosec|pen ?test|penetration test|soc ?2|iso ?27001|encryption|data breach)\b/i,
      /\bsecurity (questionnaire|review|assessment)\b/i,
    ],
    underlyingConcerns: ["A formal security review is required.", "Worry about data exposure."],
    clarifyingQuestion: "Is there a security questionnaire or standard we'd need to meet?",
    responseStrategy: [
      "Share only published, approved security documentation.",
      "Never assert a certification the approved data does not list.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    assist: { always: true, when: ["Any security review, questionnaire or certification request: a colleague sends the approved documents."] },
    respectAsRefusal: false,
  },
  COMPLIANCE: {
    key: "COMPLIANCE",
    label: "Compliance",
    patterns: [
      /\b(gdpr|dpa|data processing agreement|compliance|compliant|regulat(ed|ion|ory)|fca|ico|hipaa)\b/i,
    ],
    underlyingConcerns: ["A regulatory obligation.", "A data-protection review."],
    clarifyingQuestion: "Which requirement do you need us to cover?",
    responseStrategy: [
      "Point to approved published policies only. Never give legal advice.",
      NEVER_INVENT,
    ],
    handover: { always: true, when: ["Any regulatory, legal or data-protection question."] },
    respectAsRefusal: false,
  },
  FEATURE: {
    key: "FEATURE",
    label: "Missing feature",
    patterns: [
      /\b(does it|can it|can you|do you) (do|support|integrate|handle|offer|work with)\b/i,
      /\b(missing|lacks?|doesn'?t have|no) (a |an )?(feature|integration|option)\b/i,
      /\bintegrat(e|es|ion) with\b/i,
    ],
    underlyingConcerns: ["A hard requirement.", "A nice-to-have presented as a blocker."],
    clarifyingQuestion: "How would you use that day to day?",
    responseStrategy: [
      "Answer from the approved feature and integration list only. If it is not listed, say you'll check rather than guess.",
      "Never promise a roadmap item.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    assist: { always: false, when: ["The answer is not in approved data."] },
    respectAsRefusal: false,
  },
  AUTHORITY: {
    key: "AUTHORITY",
    label: "Not the decision-maker",
    patterns: [
      /\b(not|isn'?t) (my|up to me|my decision|my call)\b/i,
      /\b(need to|have to|would need to|i'?ll) (check|speak|talk|run it) (with|past|by) (my|our|the)\b/i,
      /\b(my|our) (boss|manager|director|partner|board|md|ceo|owner)\b/i,
    ],
    underlyingConcerns: ["They are an influencer, not the buyer.", "A polite deferral."],
    clarifyingQuestion: "Who else would be involved, and what would they want to know?",
    responseStrategy: [
      "Offer approved material they can forward, or a call that includes the decision-maker.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
  PROCUREMENT: {
    key: "PROCUREMENT",
    label: "Procurement process",
    patterns: [
      /\b(procurement|tender|rfp|rfq|rfi|framework|approved supplier|supplier onboarding|purchase order|po number)\b/i,
    ],
    underlyingConcerns: ["A formal buying process with its own steps and owner."],
    clarifyingQuestion: "What does the procurement process involve on your side?",
    responseStrategy: [
      "Acknowledge the process, say a colleague will handle the supplier paperwork, and keep qualifying toward a meeting.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: ["They ask the business to agree procurement or contract terms."] },
    assist: { always: true, when: ["Any procurement, tender or supplier-onboarding step: a colleague provides it."] },
    respectAsRefusal: false,
  },
  CONTRACT: {
    key: "CONTRACT",
    label: "Contract terms",
    patterns: [
      // A question about the terms, not a statement that they are tied into
      // someone else's contract (that is LOCK_IN, which the AI handles):
      // "we're in a contract until March" never hands over.
      /\b(terms and conditions|t&cs?|minimum term|cancellation terms|sla|liability|indemnit(y|ies))\b/i,
      /(?<!\b(?:locked|tied) (?:in|into) (?:a |an |our |the )?)\bcontract\b(?![^.?!]{0,40}\b(until|till|runs|ends|expires|renews|is up|for another|for (the )?(next|another) \d*\s?(months?|years?)))/i,
    ],
    underlyingConcerns: ["Lock-in worry.", "Legal review required."],
    clarifyingQuestion: "Which part of the terms would you like to look at?",
    responseStrategy: [
      "Link to published terms only. Never negotiate or summarise legal terms.",
      NEVER_INVENT,
    ],
    handover: { always: true, when: ["Any request to change, interpret or negotiate terms."] },
    respectAsRefusal: false,
  },
  SEND_INFORMATION: {
    key: "SEND_INFORMATION",
    label: "Send me information",
    patterns: [
      /\b(send|email|forward) (me|us|over) (some |more )?(info|information|details|a brochure|something|the details|pricing)\b/i,
      /\bdo you have (a )?(brochure|deck|website|pdf)\b/i,
    ],
    underlyingConcerns: ["A polite brush-off.", "Genuine interest, but not ready to talk."],
    clarifyingQuestion: "Happy to. So I send the right thing, what's most useful to you?",
    responseStrategy: [
      "Send approved material relevant to what they said, and one light next step.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
  NOT_INTERESTED: {
    key: "NOT_INTERESTED",
    label: "Not interested",
    patterns: [
      /\bnot interested\b/i,
      /\bno,? thank(s| you)\b/i,
      /\b(please )?(stop|don'?t) (contacting|messaging|emailing|texting) me\b/i,
      /\bleave me alone\b/i,
    ],
    underlyingConcerns: ["A clear refusal."],
    clarifyingQuestion: "",
    responseStrategy: [
      "Accept it. Thank them briefly, confirm they will not be contacted about this again, and stop.",
      "Do not attempt to change their mind.",
    ],
    handover: { always: false, when: ["They sound upset or mention a complaint."] },
    respectAsRefusal: true,
  },
  TOO_BUSY: {
    key: "TOO_BUSY",
    label: "Too busy",
    patterns: [
      /\b(too|really|very|so|crazy|flat out) busy\b/i,
      /\b(no|don'?t have (the )?) time\b/i,
      /\bswamped\b/i,
    ],
    underlyingConcerns: ["A real capacity constraint.", "Low priority."],
    clarifyingQuestion: "Understood. Would a quick note by email suit you better than a call?",
    responseStrategy: [
      "Offer the lowest-effort next step and respect the answer.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
  CALL_LATER: {
    key: "CALL_LATER",
    label: "Contact me later",
    patterns: [
      /\b(call|contact|ring|message|email|text) (me|us) (back )?(later|next week|next month|tomorrow|another time|in a (few|couple of) (days|weeks))\b/i,
      /\b(try|catch) me (later|next week|another time)\b/i,
      /\b(get|come) back to (me|us) (later|next week|in)\b/i,
    ],
    underlyingConcerns: ["Wrong moment, not a refusal."],
    clarifyingQuestion: "No problem. When suits you best?",
    responseStrategy: ["Confirm the time they name and record it. Nothing else.", NEVER_INVENT],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
  INTERNAL_BUILD: {
    key: "INTERNAL_BUILD",
    label: "Will do it in-house",
    patterns: [
      /\b(do|build|handle|manage|sort) (it|this|that) (ourselves|in-?house|internally|myself)\b/i,
      /\b(in-?house|internal) (team|resource|developer|marketer)\b/i,
    ],
    underlyingConcerns: ["Capacity exists in-house.", "Cost comparison with doing it themselves."],
    clarifyingQuestion: "How is the in-house approach going so far?",
    responseStrategy: [
      "Respect the choice. Mention only approved ways the business complements an in-house team.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
  RISK: {
    key: "RISK",
    label: "Risk",
    patterns: [
      /\b(what if it (doesn'?t|does not) work|too risky|risk(y)?|worried|concerned|nervous)\b/i,
      /\b(bad|burned|burnt) (experience|before)\b/i,
    ],
    underlyingConcerns: ["Fear of a failed outcome.", "A bad experience with a previous provider."],
    clarifyingQuestion: "What would a bad outcome look like for you?",
    responseStrategy: [
      "Describe approved safeguards (trial, cancellation terms, phased start) only if they exist.",
      "Never promise results.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: ["They ask for a guarantee or a refund promise."] },
    respectAsRefusal: false,
  },
  STATUS_QUO: {
    key: "STATUS_QUO",
    label: "Happy with how things are",
    patterns: [
      /\b(we'?re|we are|it'?s|things are) (fine|ok|okay|alright|good) (as (it is|they are|we are)|for now)\b/i,
      /\b(what we have|current (setup|system|way)|how we do it) (works|is working|does the job)\b/i,
      /\b(always done it|managed fine) (this way|without)\b/i,
      /\bif it ain'?t broke\b/i,
    ],
    underlyingConcerns: [
      "Change feels like effort and risk for an uncertain gain.",
      "They have not yet seen a cost in how things are today.",
    ],
    clarifyingQuestion: "Fair enough. If you could change one thing about how it works today, what would it be?",
    responseStrategy: [
      "Respect that it works. Look for one real gap in their own words, never invent one.",
      "Only frame a cost of standing still if they stated it themselves.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
  NOT_NOW: {
    key: "NOT_NOW",
    label: "Not now",
    patterns: [
      /\bnot (now|yet|at the moment|right now|for now|just now)\b/i,
      /\b(maybe|perhaps) (later|another time|down the line|in a while)\b/i,
      /\b(park|shelve|hold off on) (it|this|that)\b/i,
    ],
    underlyingConcerns: [
      "A real constraint they have not named yet.",
      "A polite way of saying the need is not pressing.",
    ],
    clarifyingQuestion: "No problem. Is it the timing, or is something else holding it back?",
    responseStrategy: [
      "Accept it without pushing. If they name a time, offer to pick it up then and record it.",
      "Do not manufacture urgency or a deadline.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
  LOCK_IN: {
    key: "LOCK_IN",
    label: "Tied into a contract",
    patterns: [
      /\b(locked|tied) (in|into)\b/i,
      /\b(in|under|on) (a |an |our )?(\w+ )?(contract|agreement|retainer)\b[^.?!]{0,40}\b(until|till|ends|runs|expires|renews|is up|for another)\b/i,
      /\b(notice period|contract (ends|runs out|is up|renews|expires))\b/i,
    ],
    underlyingConcerns: [
      "A contract with their current provider has a real end date.",
      "Exit fees or overlap costs worry them.",
    ],
    clarifyingQuestion: "Makes sense. When does the current contract come up for renewal?",
    responseStrategy: [
      "Accept the date. Offer to reconnect ahead of it so they have time to compare, and record it.",
      "Describe approved switching help only if it exists. Never offer to cover exit fees.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: ["They ask the business to cover exit fees or overlap costs."] },
    respectAsRefusal: false,
  },
  JUST_LOOKING: {
    key: "JUST_LOOKING",
    label: "Just looking",
    patterns: [
      /\bjust (looking|browsing|curious|having a look|researching|exploring|getting (some )?prices)\b/i,
      /\b(early|initial) (stages?|days)\b/i,
      /\b(doing|done) (some|a bit of) research\b/i,
      /\bgetting a feel for\b/i,
    ],
    underlyingConcerns: [
      "Early research, with no decision date yet.",
      "Not ready to talk to a salesperson.",
    ],
    clarifyingQuestion: "Makes sense. What got you looking in the first place?",
    responseStrategy: [
      "Lower the stakes: be useful now with one approved point that fits what they said.",
      "Offer the lightest next step and let them set the pace.",
      NEVER_INVENT,
    ],
    handover: { always: false, when: [] },
    respectAsRefusal: false,
  },
};

/**
 * Tie-break order when several playbooks match. A refusal first (it must be
 * respected), then the legal and contract categories (a person must see
 * them), then the specialist ones (a colleague provides them), then the rest
 * in the brief's order.
 */
const PRIORITY: ObjectionKey[] = [
  "NOT_INTERESTED",
  "SECURITY",
  "COMPLIANCE",
  "CONTRACT",
  "PROCUREMENT",
  ...OBJECTION_KEYS.filter(
    (key) => !["NOT_INTERESTED", "SECURITY", "COMPLIANCE", "CONTRACT", "PROCUREMENT"].includes(key),
  ),
];

export type ObjectionMatch = {
  key: ObjectionKey;
  /** The text that matched, for the audit trail. */
  matched: string;
  /** How many of the entry's patterns matched. */
  hits: number;
  /** A legal or contract question: a person takes the conversation. */
  handoverRequired: boolean;
  /** Security or procurement: a colleague provides it; the AI keeps going. */
  assistRequired: boolean;
};

/**
 * Every playbook whose patterns match `text`, primary first.
 *
 * Deterministic: order is by hits descending, then PRIORITY. Returns [] for
 * empty or non-matching text. Input is capped so a pasted essay cannot make the
 * regexes expensive.
 */
export function matchObjection(text: string): ObjectionMatch[] {
  const input = (text ?? "").slice(0, 2000);
  if (!input.trim()) return [];

  const matches: ObjectionMatch[] = [];
  for (const key of PRIORITY) {
    const entry = OBJECTIONS[key];
    let hits = 0;
    let matched = "";
    for (const pattern of entry.patterns) {
      const found = pattern.exec(input);
      if (found) {
        hits += 1;
        if (!matched) matched = found[0];
      }
    }
    if (hits > 0) {
      matches.push({ key, matched, hits, handoverRequired: entry.handover.always, assistRequired: entry.assist?.always === true });
    }
  }

  // Stable sort keeps PRIORITY order among equal hit counts; a refusal always
  // leads, whatever else matched.
  return matches.sort((a, b) => {
    if (a.key === "NOT_INTERESTED") return -1;
    if (b.key === "NOT_INTERESTED") return 1;
    return b.hits - a.hits;
  });
}
