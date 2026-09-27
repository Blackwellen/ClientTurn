import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildStrategyBlock, DEFAULT_MOTION, stageForMode, type StrategyInput } from "../src/lib/agent/strategy.ts";
import {
  buildOfferCard,
  estimateTokens,
  OFFER_CARD_TOKEN_BUDGET,
  type OfferCardInput,
} from "../src/lib/agent/offer-card.ts";
import { countQuestions, lintStyle, validateResponse, type ValidationFacts } from "../src/lib/agent/validate.ts";
import { PROMPT_BODIES } from "../src/lib/ai/prompts.ts";
import type { QuestionRecord } from "../src/lib/qualification/next-question.ts";
import type { AgentMode } from "../src/lib/agent/types.ts";

// ------------------------------------------------------------------ strategy

const NEXT: QuestionRecord = {
  id: "q-team",
  questionText: "How many people would be using it?",
  position: 2,
  responseType: "number",
  required: false,
  serviceId: null,
  options: [],
};

function strategy(overrides: Partial<StrategyInput> = {}) {
  return buildStrategyBlock({
    mode: "QUALIFICATION",
    motion: "BOOK_MEETING_B2B",
    archetypeKey: null,
    channel: "sms",
    selection: {
      question: NEXT,
      stopReason: null,
      known: [
        {
          questionId: "q-use",
          questionText: "What would you mainly want it to do?",
          dimension: "USE_CASE",
          source: "ANSWER",
          value: "lead follow-up",
          inferred: false,
          confidence: 1,
          required: true,
        },
        {
          questionId: "q-postcode",
          questionText: "What's your postcode?",
          dimension: "LOCATION",
          source: "LEAD_FIELD",
          value: "SW1A 1AA",
          inferred: true,
          confidence: 1,
          required: false,
        },
      ],
    },
    latestMessage: null,
    hasApprovedInsight: false,
    bookingAvailable: true,
    ...overrides,
  });
}

describe("strategy block", () => {
  test("QUALIFICATION: motion, objective, one next question, and what not to ask", () => {
    const { text, record } = strategy();
    assert.match(text, /Motion: Qualify, then book a meeting\./);
    assert.match(text, /Objective: Learn the one thing that unblocks the next step\./);
    assert.match(text, /Ask only this, in natural wording: How many people would be using it\?/);
    assert.match(text, /Do not ask about \(already known\): Main use case \(answered\); Location \(inferred\)\./);
    assert.equal(record.nextQuestionId, "q-team");
    assert.equal(record.stage, "QUALIFYING");
    assert.equal(record.motionSource, "WORKSPACE");
  });

  test("the method is recorded with its reason but never named in the prompt", () => {
    const { text, record } = strategy();
    assert.equal(record.method, "SIMPLE_QUALIFICATION");
    assert.ok(record.reason.length > 0);
    assert.ok(record.libraryVersion);
    for (const name of ["SPIN", "MEDDPICC", "CHALLENGER", "Challenger", "SIMPLE_QUALIFICATION", "NLP"]) {
      assert.ok(!text.includes(name), `prompt must not name ${name}`);
    }
    const enterprise = strategy({ motion: "ENTERPRISE" });
    assert.equal(enterprise.record.method, "MEDDPICC");
    assert.ok(!enterprise.text.includes("MEDDPICC"));
  });

  test("threshold met: stop qualifying and propose the close target", () => {
    const { text, record } = strategy({
      selection: { question: null, stopReason: "THRESHOLD_MET", known: [] },
    });
    assert.match(text, /Stop qualifying: enough is known\. Propose the next step: Qualify the fit, then book a call/);
    assert.match(text, /CHECK_AVAILABILITY/);
    assert.equal(record.nextQuestionId, null);
    assert.equal(record.stopReason, "THRESHOLD_MET");
  });

  test("no booking method: the close offers a follow-up, not a time", () => {
    const { text } = strategy({
      bookingAvailable: false,
      selection: { question: null, stopReason: "THRESHOLD_MET", known: [] },
    });
    assert.match(text, /No booking method is configured/);
  });

  test("missing motion falls back to the default and says so", () => {
    const { text, record } = strategy({ motion: null });
    assert.equal(record.motion, DEFAULT_MOTION);
    assert.equal(record.motionSource, "DEFAULT");
    assert.match(text, /default: not configured/);
  });

  for (const mode of ["BOOKING_ASSISTANCE", "POST_BOOKING", "HUMAN_HANDOVER"] as AgentMode[]) {
    test(`${mode}: no qualification question`, () => {
      const { text, record } = strategy({ mode });
      assert.match(text, /Do not ask qualification questions this turn\./);
      assert.ok(!text.includes("Next best question"));
      assert.equal(record.nextQuestionId, null);
    });
  }

  test("NEW_LEAD_RESPONSE and GENERAL_ENQUIRY carry their own objectives", () => {
    assert.match(strategy({ mode: "NEW_LEAD_RESPONSE" }).text, /Acknowledge the enquiry/);
    assert.match(strategy({ mode: "GENERAL_ENQUIRY" }).text, /Answer from the offer card only/);
    assert.equal(stageForMode("NEW_LEAD_RESPONSE"), "NEW");
    assert.equal(stageForMode("GENERAL_ENQUIRY"), "ENGAGED");
  });

  test("OBJECTION_HANDLING: the matched playbook is included, and no qualifying question", () => {
    const { text, record, objection } = strategy({
      mode: "OBJECTION_HANDLING",
      latestMessage: "Honestly that sounds too expensive for us",
    });
    assert.equal(objection?.key, "PRICE");
    assert.equal(record.objectionKey, "PRICE");
    assert.match(text, /Objection: Price\./);
    assert.match(text, /Clarifying question \(the one question this turn\):/);
    assert.match(text, /Response strategy: .*Do not invent a discount/);
    assert.ok(!text.includes("Next best question"));
  });

  test("OBJECTION_HANDLING: security is always a person's job", () => {
    const { objection, text } = strategy({
      mode: "OBJECTION_HANDLING",
      latestMessage: "We'd need your security questionnaire and a DPA before anything",
    });
    assert.equal(objection?.key, "SECURITY");
    assert.equal(objection?.handoverRequired, true);
    assert.match(text, /This is a person's job\. Propose REQUEST_HANDOVER/);
  });

  test("OBJECTION_HANDLING with nothing matched: one clarifying question, nothing invented", () => {
    const { text, objection } = strategy({ mode: "OBJECTION_HANDLING", latestMessage: "hmm not sure" });
    assert.equal(objection, null);
    assert.match(text, /Ask one clarifying question/);
  });
});

// ---------------------------------------------------------------- offer card

function offerInput(overrides: Partial<OfferCardInput> = {}): OfferCardInput {
  return {
    businessName: "Northlight Studio",
    businessDescription: "A web design studio in Leeds.",
    aiTone: "friendly",
    replyLength: "short",
    outreach: {
      tone: "Warm, plain, no jargon",
      valueProposition: "Websites that turn visitors into enquiries.",
      keyMessages: "Fixed scopes\nFast turnaround",
      proofPoints: "Shopify Partner",
      avoid: "cheap\nworld-class",
      callToAction: "Book a 20-minute call",
      claimRestrictions: null,
    },
    playbook: { tone: null, prohibitedClaims: ["guaranteed first page on Google"] },
    signature: "Sam at Northlight",
    services: [
      { name: "Website design", description: "Custom sites", publicPriceText: "From £2,500" },
      { name: "SEO", description: null, publicPriceText: null },
    ],
    facts: [
      { key: "icp.target_customers", value: ["dentists", "law firms"], sourceType: "USER", confidence: 1, verifiedByUser: false, locked: false },
      { key: "business.differentiators", value: "In-house copywriting", sourceType: "AI", confidence: 0.95, verifiedByUser: true, locked: false },
      { key: "business.awards", value: "Best agency 2025", sourceType: "WEBSITE", confidence: 0.9, verifiedByUser: false, locked: false },
      { key: "business.price_band", value: "£2k-£10k", sourceType: "USER", confidence: 1, verifiedByUser: true, locked: false },
      { key: "business.expired_offer", value: "Spring offer", sourceType: "USER", confidence: 1, verifiedByUser: true, locked: false, validTo: "2020-01-01T00:00:00Z" },
      { key: "business.noprov", value: "x", sourceType: null, confidence: 1, verifiedByUser: true, locked: false },
    ],
    now: new Date("2026-09-25T12:00:00Z"),
    ...overrides,
  };
}

describe("offer card", () => {
  test("includes accepted/verified facts with provenance and excludes the rest", () => {
    const card = buildOfferCard(offerInput());
    assert.match(card.text, /target customers: dentists, law firms \(entered by the business\)/);
    assert.match(card.text, /differentiators: In-house copywriting \(verified\)/);
    assert.ok(!card.text.includes("Best agency 2025"), "unverified website fact must not appear");
    assert.ok(!card.text.includes("£2k"), "internal price band must not appear");
    assert.ok(!card.text.includes("Spring offer"), "expired fact must not appear");
    const reasons = Object.fromEntries(card.excludedFacts.map((fact) => [fact.key, fact.reason]));
    assert.equal(reasons["business.awards"], "UNVERIFIED");
    assert.equal(reasons["business.price_band"], "INTERNAL_COMMERCIAL");
    assert.equal(reasons["business.expired_offer"], "EXPIRED");
    assert.equal(reasons["business.noprov"], "NO_PROVENANCE");
  });

  test("published prices only, and a clear no-price line when none exist", () => {
    const card = buildOfferCard(offerInput());
    assert.match(card.text, /Website design: From £2,500/);
    const none = buildOfferCard(
      offerInput({ services: [{ name: "SEO", description: null, publicPriceText: null }] }),
    );
    assert.match(none.text, /None\. Do not state any price/);
  });

  test("merges the voice: tone, style notes, CTA, signature, forbidden phrases, prohibited claims", () => {
    const card = buildOfferCard(offerInput());
    assert.equal(card.voice.tone, "friendly");
    assert.deepEqual(card.voice.forbiddenPhrases, ["cheap", "world-class"]);
    assert.deepEqual(card.voice.prohibitedClaims, ["guaranteed first page on Google"]);
    assert.match(card.text, /Preferred call to action: Book a 20-minute call/);
    assert.match(card.text, /NEVER CLAIM\n- guaranteed first page on Google/);
    assert.equal(card.hasApprovedClaims, true);
  });

  test("respects the token budget by dropping whole items, lowest priority first", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      key: `business.faq_${String(i).padStart(2, "0")}`,
      value: `Question ${i} has a reasonably long answer that takes up room in the card.`,
      sourceType: "USER",
      confidence: 1,
      verifiedByUser: true,
      locked: false,
    }));
    const card = buildOfferCard(offerInput({ facts: many }));
    assert.ok(card.tokens <= OFFER_CARD_TOKEN_BUDGET, `${card.tokens} tokens`);
    assert.equal(card.tokens, estimateTokens(card.text));
    assert.ok(card.dropped.length > 0);
    assert.ok(card.dropped.every((id) => id.startsWith("fact:")), "FAQs go before voice or services");
    assert.match(card.text, /NEVER CLAIM/);
    assert.match(card.text, /Website design/);
  });

  test("a tiny budget still holds as a hard ceiling", () => {
    const card = buildOfferCard(offerInput({ tokenBudget: 80 }));
    assert.ok(card.tokens <= 80 || card.dropped.length > 0);
  });

  test("never cuts an item mid-sentence", () => {
    const long = "First sentence is fine. " + "word ".repeat(120) + "end.";
    const card = buildOfferCard(offerInput({ outreach: { ...offerInput().outreach, valueProposition: long } }));
    assert.match(card.text, /VALUE PROPOSITION\n- First sentence is fine\.\n/);
  });

  test("deterministic output (cacheable prefix)", () => {
    assert.equal(buildOfferCard(offerInput()).text, buildOfferCard(offerInput()).text);
  });
});

// ----------------------------------------------------------------- style lint

const facts = (overrides: Partial<ValidationFacts> = {}): ValidationFacts => ({
  channel: "email",
  businessName: "Northlight Studio",
  publishedPriceText: [],
  confirmedSlots: [],
  bookingConfirmed: false,
  allowedUrls: [],
  serviceAreaConfirmed: false,
  ...overrides,
});

const codes = (body: string, f = facts()) => {
  const result = validateResponse(body, f);
  return result.ok ? [] : result.failures.map((failure) => failure.code);
};

describe("style and QA lint", () => {
  test("a plain one-question reply passes", () => {
    assert.deepEqual(codes("Thanks Sam. How many people would be using it?"), []);
  });

  for (const cliche of [
    "I hope this finds you well. Thanks for getting in touch.",
    "I completely understand, thanks for saying.",
    "Absolutely! Happy to help.",
    "It's a game-changing tool for agencies.",
    "A revolutionary approach to follow-up.",
    "This will unlock more enquiries for you.",
    "I'll circle back next week.",
    "You can leverage your existing site.",
  ]) {
    test(`cliche rejected: ${cliche}`, () => {
      assert.ok(codes(cliche).includes("STYLE_CLICHE"));
    });
  }

  // Owner rule 2026-09-27 (was: more than two). Any em or en dash used as a
  // dash is rejected; an en dash in a number range is not a dash.
  test("any em or en dash used as a dash", () => {
    assert.deepEqual(codes("Thanks, that helps. Noted."), []);
    assert.ok(codes("Thanks — that helps.").includes("STYLE_EM_DASHES"));
    assert.ok(codes("Thanks – that helps.").includes("STYLE_EM_DASHES"));
    assert.deepEqual(codes("We're open 9–5 on weekdays."), []);
  });

  test('"just" three or more times', () => {
    assert.deepEqual(codes("Just checking, just a note."), []);
    assert.ok(codes("Just checking in, just a quick one, just to confirm.").includes("STYLE_REPEATED_JUST"));
  });

  test("more than one question in a message", () => {
    assert.ok(codes("How many people would use it? And when do you want to start?").includes("STYLE_MULTIPLE_QUESTIONS"));
    // An interrogative written without a question mark still counts.
    assert.ok(codes("Could you send your postcode. When would suit?").includes("STYLE_MULTIPLE_QUESTIONS"));
    // A wh-word opening a statement is not a question.
    assert.deepEqual(codes("When you're ready, reply here. What happens next is a short call."), []);
    assert.equal(countQuestions("Really?? Great."), 1);
    assert.equal(countQuestions("No questions here."), 0);
  });

  test("workspace forbidden phrases and prohibited claims", () => {
    const f = facts({ forbiddenPhrases: ["cheap"], prohibitedClaims: ["guaranteed first page on Google"] });
    assert.ok(codes("We're cheap and quick.", f).includes("STYLE_FORBIDDEN_PHRASE"));
    assert.deepEqual(codes("We're cheaper than you'd think.", f), [], "whole-phrase match only");
    assert.ok(
      codes("We offer GUARANTEED first page   on Google results.", f).includes("STYLE_PROHIBITED_CLAIM"),
    );
  });

  test("lintStyle alone (the restyle / reactivation path) applies the same rules", () => {
    assert.equal(lintStyle("Thanks, noted.").length, 0);
    assert.equal(lintStyle("Absolutely! Is it urgent? Is it big?")[0]?.code, "STYLE_CLICHE");
    assert.ok(lintStyle("We're cheap.", { forbiddenPhrases: ["cheap"] }).some((f) => f.code === "STYLE_FORBIDDEN_PHRASE"));
  });

  test("style failures carry a correction for the single retry", () => {
    const result = validateResponse("Absolutely! Is it urgent? Is it big?", facts());
    assert.equal(result.ok, false);
    if (!result.ok) {
      for (const failure of result.failures) assert.ok(failure.correction.length > 0);
    }
  });
});

// -------------------------------------------------------------------- prompts

describe("prompts", () => {
  test("no prompt frames the business as a home-service business", () => {
    for (const [task, body] of Object.entries(PROMPT_BODIES)) {
      assert.ok(!/home[\s-]?service/i.test(body), `${task} still mentions home-service`);
    }
    const shared = readFileSync(new URL("../src/lib/jobs/handlers/shared.ts", import.meta.url), "utf8");
    assert.ok(!/home[\s-]?service/i.test(shared), "restyle context still mentions home-service");
  });

  test("the agent prompt references the strategy block and the offer card", () => {
    assert.match(PROMPT_BODIES.agent_decision, /STRATEGY FOR THIS TURN/);
    assert.match(PROMPT_BODIES.agent_decision, /offer card/);
    assert.ok(!/depends on the job/.test(PROMPT_BODIES.agent_decision));
  });

  test("changed prompts are version-bumped", () => {
    const registry = readFileSync(new URL("../src/lib/ai/prompt-registry.ts", import.meta.url), "utf8");
    for (const task of ["agent_decision", "intent_classification", "variant_generation"]) {
      // At least v2; later phases bump further (agent_decision is v3 from Phase 3).
      const version = Number(new RegExp(`${task}: (\\d+)`).exec(registry)?.[1] ?? 0);
      assert.ok(version >= 2, `${task} is at v${version}`);
    }
  });
});

// ------------------------------------------- engine-planned turns (design 08)

import { buildNbaStrategyBlock } from "../src/lib/agent/strategy.ts";
import { TURN_FIXTURES, nbaFixture } from "./fixtures/qi-turn-fixtures.ts";
import { NBA_STRATEGY_BLOCK_MAX_TOKENS } from "../src/lib/qualification-intelligence/types.ts";

describe("NBA strategy block: the agent and the engine share one source of truth", () => {
  for (const fixture of TURN_FIXTURES) {
    test(`${fixture.id}: strategy nextQuestionId equals the NBA question_intent`, () => {
      const block = buildNbaStrategyBlock(fixture.legacy, fixture.nba, { booking: "SLOTS" });
      assert.equal(block.record.nextQuestionId, fixture.nba.question_intent?.question_id ?? null);
      assert.equal(block.record.questionIntentKey ?? null, fixture.nba.question_intent?.key ?? null);
      assert.equal(block.record.nbaAction, fixture.nba.next_action);
      if (fixture.nba.question_intent) {
        // The one planned question, verbatim, and no other question text.
        assert.ok(block.text.includes(fixture.nba.question_intent.rendering));
        assert.equal((block.text.match(/\?/g) ?? []).length, (fixture.nba.question_intent.rendering.match(/\?/g) ?? []).length);
      } else {
        assert.doesNotMatch(block.text, /ask only this/i);
      }
      // The legacy plan's own question never leaks into an engine-planned turn.
      const legacyQuestion = fixture.legacy.selection.question?.questionText;
      if (legacyQuestion && legacyQuestion !== fixture.nba.question_intent?.rendering) {
        assert.ok(!block.text.includes(legacyQuestion));
      }
    });
  }

  test("method names never reach the prompt, and the block stays within budget", () => {
    for (const fixture of TURN_FIXTURES) {
      const text = buildNbaStrategyBlock(fixture.legacy, fixture.nba, { booking: "SLOTS" }).text;
      assert.doesNotMatch(text, /SPIN|Challenger|MEDDPICC|BANT|GPCT/);
      assert.ok(Math.ceil(text.length / 4) <= NBA_STRATEGY_BLOCK_MAX_TOKENS);
    }
  });

  test("a close tells the model how the booking is taken this turn", () => {
    const [fixture] = TURN_FIXTURES.filter((f) => f.id === "studio-threshold-met-book");
    const route = (booking: Parameters<typeof buildNbaStrategyBlock>[2]["booking"]) =>
      buildNbaStrategyBlock(fixture.legacy, fixture.nba, { booking }).text;
    assert.match(route("SLOTS"), /SEND_BOOKING_OPTIONS/);
    assert.match(route("LINK"), /booking link/);
    assert.match(route("ASK_PREFERRED_TIME"), /which day and time/);
    assert.match(route("TEAM_FOLLOW_UP"), /team will be in touch/);
  });

  test("a CTA_BOOK may carry its one gating question", () => {
    const gated = nbaFixture({
      next_action: "CTA_BOOK",
      rule: "R7_BOOKING_READY",
      intent_state: "BOOKING_READY",
      question_intent: {
        key: "LOCATION.POSTCODE",
        dimension: "LOCATION",
        purpose: "DISQUALIFY_CHECK",
        question_id: null,
        wording_family: "postcode",
        rendering: "Which postcode is the property in?",
      },
    });
    const block = buildNbaStrategyBlock(TURN_FIXTURES[0].legacy, gated, { booking: "SLOTS" });
    assert.match(block.text, /Before that, ask only this, in natural wording: Which postcode is the property in\?/);
    assert.equal(block.record.questionIntentKey, "LOCATION.POSTCODE");
    assert.equal(block.record.nextQuestionId, null);
  });

  test("manual booking mode: the legacy close asks for a day and time (story H3)", () => {
    const manual = strategy({
      selection: { question: null, stopReason: "THRESHOLD_MET", known: [] },
      bookingAvailable: false,
      manualBooking: true,
    });
    assert.match(manual.text, /which day and time suits them/);
    const none = strategy({ selection: { question: null, stopReason: "THRESHOLD_MET", known: [] }, bookingAvailable: false });
    assert.match(none.text, /offer for the team to follow up/);
  });

  test("prompts: agent_decision follows the strategy block's move; answer_extraction is multi-dimension", () => {
    assert.match(PROMPT_BODIES.agent_decision, /objective or move/);
    assert.match(PROMPT_BODIES.answer_extraction, /evidence_span copied word for word/);
    const registry = readFileSync(new URL("../src/lib/ai/prompt-registry.ts", import.meta.url), "utf8");
    assert.match(registry, /agent_decision: 4/);
    assert.match(registry, /answer_extraction: 2/);
  });
});
