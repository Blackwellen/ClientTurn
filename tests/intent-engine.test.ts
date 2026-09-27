/**
 * The intent engine (docs/revenue-engine/08-qualification-intelligence.md
 * §§B.3-B.4): signal extraction, the capped explainable score, the states,
 * contradiction handling, and FIT / INTENT disjointness.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  INTENT_COMPONENT_CAPS,
  INTENT_STATES,
  SIGNAL_TYPES,
  SIGNAL_TYPE_CATEGORY,
  intentSignalWriteSchema,
  signalPolarity,
  type IntentSignal,
  type IntentSignalWrite,
  type SignalSource,
  type SignalType,
} from "../src/lib/qualification-intelligence/types.ts";
import { assessIntent, explainIntent, intentAtLeast } from "../src/lib/qualification-intelligence/intent.ts";
import {
  PHRASE_RULES,
  contextSignalTypeFor,
  extractLeadSignals,
  extractTextSignals,
  replySignals,
  signalFromRow,
  touchSignals,
  type LeadOriginInput,
  type LeadSignalInput,
} from "../src/lib/qualification-intelligence/signals.ts";
import { FEATURE_ALLOW_LIST, FIT_FEATURE_KEYS, INTENT_FEATURE_KEYS, scoreLead } from "../src/lib/scoring/lead-score.ts";

const NOW = new Date("2026-09-26T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const LEAD = "11111111-1111-4111-8111-111111111111";

let seq = 0;
function uuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

/** A stored signal with sensible decay for its type. */
function sig(type: SignalType, opts: Partial<IntentSignal> & { at?: string } = {}): IntentSignal {
  const halfLife: Partial<Record<SignalType, number | null>> = { UNSUBSCRIBE: null, COMPLAINT: null, NOT_NOW: null };
  return {
    id: uuid(),
    leadId: LEAD,
    serviceId: null,
    category: SIGNAL_TYPE_CATEGORY[type],
    type,
    polarity: signalPolarity(type),
    strength: 1,
    confidence: 1,
    source: "REPLY" as SignalSource,
    sourceRef: null,
    observedAt: opts.at ?? ago(HOUR),
    halfLifeHours: type in halfLife ? halfLife[type]! : 10 * 24,
    flatUntil: null,
    expiresAt: null,
    resumeAt: null,
    reason: type,
    evidenceExcerpt: null,
    ruleVersion: "sig-1",
    retractedAt: null,
    ...opts,
  };
}

/** A write turned into the stored shape (as if inserted). */
function stored(w: IntentSignalWrite): IntentSignal {
  return signalFromRow({ ...w, id: uuid(), retracted_at: null });
}

const origin = (overrides: Partial<LeadOriginInput> = {}): LeadOriginInput => ({
  leadId: LEAD,
  serviceId: null,
  createdAt: ago(2 * DAY),
  createdVia: "INBOUND",
  relationshipType: null,
  conversionGoalType: null,
  optedOut: false,
  optedOutObservedAt: null,
  ...overrides,
});

describe("intent states (§B.4 precedence)", () => {
  test("no signals: NO_DETECTED_INTENT, score 0, no confidence", () => {
    const a = assessIntent([], NOW);
    assert.equal(a.state, "NO_DETECTED_INTENT");
    assert.equal(a.score, 0);
    assert.equal(a.confidence, 0);
    assert.equal(a.validUntil, null);
    assert.equal(a.version, "ie-1");
  });

  test("a fresh booking request is BOOKING_READY, unless a booking is already scheduled", () => {
    const signals = [sig("BOOKING_REQUEST", { halfLifeHours: 120 })];
    assert.equal(assessIntent(signals, NOW).state, "BOOKING_READY");
    assert.notEqual(assessIntent(signals, NOW, { bookingScheduled: true }).state, "BOOKING_READY");
  });

  test("a purchase or signup request is PURCHASE_READY", () => {
    assert.equal(assessIntent([sig("TRIAL_OR_SIGNUP_REQUEST", { halfLifeHours: 120 })], NOW).state, "PURCHASE_READY");
    assert.equal(assessIntent([sig("READY_TO_BUY", { halfLifeHours: 120 })], NOW).state, "PURCHASE_READY");
  });

  test("HIGH is reachable with no behavioural data (35 + 25 + 10 + 10)", () => {
    const a = assessIntent(
      [sig("PRICING_REQUEST"), sig("STATED_PROBLEM"), sig("URGENCY"), sig("DISSATISFACTION_CURRENT")],
      NOW,
    );
    assert.equal(a.categories.BEHAVIOURAL, 0);
    assert.ok(a.score >= 70, `score ${a.score}`);
    assert.equal(a.state, "HIGH");
  });

  test("the brief's example: a pricing visit plus 'not interested' is NEGATIVE, never HIGH", () => {
    const pricingVisit = sig("CONVERTING_PAGE_PRICING", { at: ago(2 * DAY), source: "TOUCH" });
    const pricingAsk = sig("PRICING_REQUEST", { at: ago(2 * DAY) });
    const refusal = sig("NOT_INTERESTED", { at: ago(HOUR) });
    const a = assessIntent([pricingVisit, pricingAsk, refusal], NOW);
    assert.equal(a.state, "NEGATIVE");
    assert.ok(a.score <= 10, `score ${a.score}`);
    const contradicted = a.contradictions.map((c) => c.signal_id);
    assert.ok(contradicted.includes(pricingVisit.id), "the pricing visit is shown as contradicting evidence");
    assert.ok(contradicted.includes(pricingAsk.id));
  });

  test("behaviour after a refusal does not lift it: a newer pricing visit stays NEGATIVE", () => {
    const refusal = sig("NOT_INTERESTED", { at: ago(2 * DAY) });
    const visit = sig("CONVERTING_PAGE_PRICING", { at: ago(HOUR), source: "TOUCH" });
    const fund = sig("FUNDING", { at: ago(HOUR), source: "SOURCING" });
    assert.equal(assessIntent([refusal, visit, fund], NOW).state, "NEGATIVE");
  });

  test("the lead saying something positive after a refusal lifts it; consistency is halved", () => {
    const refusal = sig("NOT_INTERESTED", { at: ago(5 * DAY) });
    const booking = sig("BOOKING_REQUEST", { at: ago(HOUR), halfLifeHours: 120 });
    const a = assessIntent([refusal, booking], NOW);
    assert.equal(a.state, "BOOKING_READY");
    assert.equal(a.categories.CONSISTENCY, INTENT_COMPONENT_CAPS.CONSISTENCY / 2);
  });

  test("the same message saying both is a refusal (ties go to the negative)", () => {
    const at = ago(HOUR);
    assert.equal(assessIntent([sig("PRICING_REQUEST", { at }), sig("NOT_INTERESTED", { at })], NOW).state, "NEGATIVE");
  });

  test("a live NOT_NOW holds at NOT_NOW, capped at 25, until the resume date", () => {
    const resume = new Date(NOW.getTime() + 30 * DAY).toISOString();
    const notNow = sig("NOT_NOW", { at: ago(DAY), resumeAt: resume, flatUntil: resume, expiresAt: resume });
    const a = assessIntent([sig("PRICING_REQUEST", { at: ago(3 * DAY) }), sig("URGENCY", { at: ago(3 * DAY) }), notNow], NOW);
    assert.equal(a.state, "NOT_NOW");
    assert.ok(a.score <= 25);
    assert.equal(a.resumeAt, resume);
    const after = assessIntent([notNow], new Date(NOW.getTime() + 31 * DAY));
    assert.notEqual(after.state, "NOT_NOW");
  });

  test("UNSUBSCRIBE is NEGATIVE at 0 and does not decay; a new explicit inbound lifts it", () => {
    const stop = sig("UNSUBSCRIBE", { at: ago(400 * DAY) });
    assert.equal(assessIntent([stop], NOW).state, "NEGATIVE");
    assert.equal(assessIntent([stop, sig("PRICING_REQUEST", { at: ago(500 * DAY) })], NOW).score, 0);
    const wroteAgain = sig("BOOKING_REQUEST", { at: ago(HOUR), halfLifeHours: 120, source: "REPLY" });
    assert.notEqual(assessIntent([stop, wroteAgain], NOW).state, "NEGATIVE");
    // A person's classification or behaviour does not lift it; only the lead writing.
    const manual = sig("BOOKING_REQUEST", { at: ago(HOUR), halfLifeHours: 120, source: "MANUAL" });
    assert.equal(assessIntent([stop, manual], NOW).state, "NEGATIVE");
  });

  test("suppressed or opted out is NEGATIVE whatever the signals say", () => {
    const a = assessIntent([sig("BOOKING_REQUEST", { halfLifeHours: 120 })], NOW, { suppressed: true });
    assert.equal(a.state, "NEGATIVE");
    assert.equal(a.score, 0);
  });

  test("an AI-assist refusal below 0.85 confidence never decides NEGATIVE on its own", () => {
    const ai = sig("NOT_INTERESTED", { source: "AI_ASSIST", confidence: 0.7 });
    assert.notEqual(assessIntent([sig("PRICING_REQUEST", { at: ago(2 * DAY) }), ai], NOW).state, "NEGATIVE");
    const sure = sig("NOT_INTERESTED", { source: "AI_ASSIST", confidence: 0.9 });
    assert.equal(assessIntent([sig("PRICING_REQUEST", { at: ago(2 * DAY) }), sure], NOW).state, "NEGATIVE");
  });

  test("score bands: EXPLORATORY needs an info-seeking signal, else LOW", () => {
    const question = assessIntent([sig("GENERAL_QUESTION", { strength: 0.5, confidence: 0.8 })], NOW);
    assert.equal(question.state, "EXPLORATORY", `score ${question.score}`);
    const fast = assessIntent([sig("FAST_REPLY", { strength: 0.6, source: "REPLY" })], NOW);
    assert.ok(fast.score >= 20 && fast.score < 45, `score ${fast.score}`);
    assert.equal(fast.state, "LOW");
  });

  test("components never exceed their caps and the score never exceeds 100", () => {
    const every = SIGNAL_TYPES.filter((t) => signalPolarity(t) === "POSITIVE").map((t) => sig(t));
    const a = assessIntent(every, NOW, { bookingScheduled: true });
    for (const [component, cap] of Object.entries(INTENT_COMPONENT_CAPS)) {
      assert.ok(a.categories[component as keyof typeof INTENT_COMPONENT_CAPS] <= cap, component);
    }
    assert.ok(a.score <= 100);
    assert.ok(a.evidence.length <= 40);
  });

  test("deterministic: input order does not matter", () => {
    const list = [sig("PRICING_REQUEST"), sig("URGENCY", { at: ago(2 * DAY) }), sig("NO_SHOW", { at: ago(3 * DAY), source: "BOOKING" })];
    assert.deepEqual(assessIntent(list, NOW), assessIntent([...list].reverse(), NOW));
  });

  test("every state is reachable and explainable", () => {
    assert.equal(INTENT_STATES.length, 9);
    const a = assessIntent([sig("NOT_INTERESTED")], NOW);
    assert.match(explainIntent(a), /Not interested/);
    assert.equal(intentAtLeast("HIGH", "MEDIUM"), true);
    assert.equal(intentAtLeast("NEGATIVE", "LOW"), false);
    assert.equal(intentAtLeast("BOOKING_READY", "HIGH"), true);
  });
});

describe("signal extraction (§B.3), deterministic and lawful sources only", () => {
  test("every phrase rule targets a real signal type", () => {
    for (const rule of PHRASE_RULES) assert.ok((SIGNAL_TYPES as readonly string[]).includes(rule.type), rule.type);
  });

  test("asks to book, asks the price, states urgency", () => {
    const types = extractTextSignals("Can we book a call this week? How much does it cost?", NOW).map((h) => h.type);
    assert.ok(types.includes("BOOKING_REQUEST"));
    assert.ok(types.includes("PRICING_REQUEST"));
    assert.ok(types.includes("URGENCY"));
  });

  test("negation flips a positive: 'not ready to buy' is not READY_TO_BUY", () => {
    const types = extractTextSignals("We're not ready to buy yet", NOW).map((h) => h.type);
    assert.ok(!types.includes("READY_TO_BUY"));
    assert.ok(types.includes("NOT_NOW"));
  });

  test("a binding opt-out returns only the opt-out", () => {
    const hits = extractTextSignals("Please unsubscribe me. Also how much is it?", NOW);
    assert.deepEqual(hits.map((h) => h.type), ["UNSUBSCRIBE"]);
  });

  test("NOT_NOW carries a resume date parsed from the words", () => {
    const [hit] = extractTextSignals("Not right now, get back to me in 3 months", NOW).filter((h) => h.type === "NOT_NOW");
    assert.ok(hit);
    const days = (Date.parse(hit.resumeAt!) - NOW.getTime()) / DAY;
    assert.ok(days > 80 && days < 100, `${days}`);
  });

  test("a stated timeframe becomes TIMEFRAME with its date", () => {
    const hit = extractTextSignals("We want to start in March", NOW).find((h) => h.type === "TIMEFRAME");
    assert.ok(hit);
    assert.equal(hit.statedDate, "2027-03-01");
  });

  test("the reason quotes the lead and the excerpt is verbatim and capped", () => {
    const text = "Honestly we are fed up with our current agency. Can you send a quote?";
    const hits = extractTextSignals(text, NOW);
    for (const h of hits) {
      assert.ok(h.excerpt.length <= 240);
      assert.ok(text.includes(h.excerpt), h.excerpt);
      assert.ok(h.reason.length <= 200);
    }
    assert.ok(hits.some((h) => h.type === "DISSATISFACTION_CURRENT"));
    assert.ok(hits.some((h) => h.type === "QUOTE_REQUEST"));
  });

  test("pricing then refusal, end to end from real words: NEGATIVE", () => {
    const writes = replySignals(
      origin(),
      [
        { id: uuid(), body: "How much would it cost?", createdAt: ago(3 * DAY), replyClassification: null, replyConfidence: null, previousOutboundAt: null },
        { id: uuid(), body: "Actually, not interested, thanks.", createdAt: ago(HOUR), replyClassification: null, replyConfidence: null, previousOutboundAt: null },
      ],
      NOW,
    );
    const a = assessIntent(writes.map(stored), NOW);
    assert.equal(a.state, "NEGATIVE");
    assert.ok(a.contradictions.some((c) => c.signal_type === "PRICING_REQUEST"));
  });

  test("form answers read positives only: 'do not call before 6pm' is not an opt-out", () => {
    const writes = touchSignals(
      origin(),
      [
        {
          id: uuid(),
          occurredAt: ago(DAY),
          sourceType: "WEB_FORM",
          landingUrl: "https://example.co.uk/pricing",
          answers: { "Contact preference": "Do not call before 6pm", "What do you need?": "We need a new website asap" },
          ingestOutcome: "CREATED",
        },
      ],
      NOW,
    );
    const types = writes.map((w) => w.signal_type);
    assert.ok(!types.includes("UNSUBSCRIBE"));
    assert.ok(types.every((t) => signalPolarity(t) === "POSITIVE"));
    assert.ok(types.includes("CONVERTING_PAGE_PRICING"));
    assert.ok(types.includes("STATED_PROBLEM"));
    assert.ok(types.includes("URGENCY"));
    assert.ok(writes.every((w) => w.source === "FORM" || w.source === "TOUCH"));
  });

  test("the form's conversion goal is intent only for an inbound lead", () => {
    const touches = [{ id: uuid(), occurredAt: ago(DAY), sourceType: "CSV", landingUrl: null, answers: {}, ingestOutcome: "CREATED" }];
    const base: Omit<LeadSignalInput, "origin"> = { touches, inbound: [], bookings: [], opportunities: [], contextEvents: [] };
    const inbound = extractLeadSignals({ ...base, origin: origin({ conversionGoalType: "BOOK_DEMO" }) }, NOW).map((w) => w.signal_type);
    assert.ok(inbound.includes("DEMO_REQUEST"));
    assert.ok(inbound.includes("INBOUND_ENQUIRY"));
    const sourced = extractLeadSignals(
      { ...base, origin: origin({ createdVia: "SOURCING", conversionGoalType: "BOOK_DEMO" }) },
      NOW,
    ).map((w) => w.signal_type);
    assert.ok(!sourced.includes("DEMO_REQUEST"));
    assert.ok(!sourced.includes("INBOUND_ENQUIRY"));
  });

  test("the AI assist's classification is stored as AI_ASSIST with its confidence, and dropped below 0.6", () => {
    const msg = (conf: number | null) => ({
      id: uuid(),
      body: "ok",
      createdAt: ago(HOUR),
      replyClassification: "BOOKING_INTENT",
      replyConfidence: conf,
      previousOutboundAt: null,
    });
    const [ai] = replySignals(origin(), [msg(0.72)], NOW).filter((w) => w.signal_type === "BOOKING_REQUEST");
    assert.equal(ai.source, "AI_ASSIST");
    assert.equal(ai.confidence, 0.72);
    const [det] = replySignals(origin(), [msg(null)], NOW).filter((w) => w.signal_type === "BOOKING_REQUEST");
    assert.equal(det.source, "CLASSIFICATION");
    assert.equal(replySignals(origin(), [msg(0.4)], NOW).filter((w) => w.signal_type === "BOOKING_REQUEST").length, 0);
  });

  test("a reply within ten minutes is FAST_REPLY; a fast refusal is not", () => {
    const fast = replySignals(origin(), [{ id: uuid(), body: "Yes please", createdAt: ago(HOUR), replyClassification: null, replyConfidence: null, previousOutboundAt: ago(HOUR + 5 * 60_000) }], NOW);
    assert.ok(fast.some((w) => w.signal_type === "FAST_REPLY"));
    const refusal = replySignals(origin(), [{ id: uuid(), body: "Not interested", createdAt: ago(HOUR), replyClassification: null, replyConfidence: null, previousOutboundAt: ago(HOUR + 60_000) }], NOW);
    assert.ok(!refusal.some((w) => w.signal_type === "FAST_REPLY"));
  });

  test("Find Leads events map to CONTEXT signals from permitted sources only", () => {
    assert.equal(contextSignalTypeFor({ sourceKey: "JOB_POSTING", categoryName: null, evidenceSummary: null }), "HIRING");
    assert.equal(contextSignalTypeFor({ sourceKey: "NEWS_FEED", categoryName: "Funding rounds", evidenceSummary: "Raised a Series A" }), "FUNDING");
    assert.equal(contextSignalTypeFor({ sourceKey: "FIRST_PARTY_WEB", categoryName: "Pricing visit", evidenceSummary: null }), null);
    assert.equal(contextSignalTypeFor({ sourceKey: "AD_ENGAGEMENT", categoryName: "Hiring", evidenceSummary: null }), null);
  });

  test("every extracted write passes the contract schema and has a stable dedupe key", () => {
    const input: LeadSignalInput = {
      origin: origin({ conversionGoalType: "REQUEST_QUOTE", optedOut: true, optedOutObservedAt: ago(HOUR) }),
      touches: [
        { id: uuid(), occurredAt: ago(3 * DAY), sourceType: "AD_FORM", landingUrl: "https://x.co/demo", answers: { Budget: "About £5k, start next month" }, ingestOutcome: "CREATED" },
        { id: uuid(), occurredAt: ago(DAY), sourceType: "WEB_FORM", landingUrl: null, answers: {}, ingestOutcome: "MERGED" },
      ],
      inbound: [
        { id: uuid(), body: "Can we book a demo? Not now though, maybe in a couple of months", createdAt: ago(HOUR), replyClassification: "NOT_NOW", replyConfidence: null, previousOutboundAt: ago(2 * HOUR) },
      ],
      bookings: [{ id: uuid(), status: "no_show", createdAt: ago(5 * DAY), startsAt: ago(4 * DAY) }],
      opportunities: [{ id: uuid(), outcome: "LOST", closedAt: ago(DAY), updatedAt: ago(DAY), outcomeReason: "Went with a competitor" }],
      contextEvents: [
        { id: uuid(), sourceKey: "TENDER_NOTICE", observedAt: ago(DAY), expiresAt: new Date(NOW.getTime() + 20 * DAY).toISOString(), confidence: 0.8, scoreImpact: 20, evidenceSummary: null, categoryName: "Public tenders", freshnessDays: 30 },
      ],
    };
    const a = extractLeadSignals(input, NOW);
    const b = extractLeadSignals(input, NOW);
    assert.deepEqual(a, b);
    assert.equal(new Set(a.map((w) => w.dedupe_key)).size, a.length);
    for (const w of a) {
      const parsed = intentSignalWriteSchema.safeParse(w);
      assert.ok(parsed.success, `${w.signal_type}: ${parsed.success ? "" : parsed.error.issues[0]?.message}`);
    }
    const types = new Set(a.map((w) => w.signal_type));
    for (const t of ["QUOTE_REQUEST", "CONVERTING_PAGE_DEMO", "REPEAT_SUBMISSION", "NO_SHOW", "OPPORTUNITY_LOST", "UNSUBSCRIBE", "TENDER", "NOT_NOW"] as const) {
      assert.ok(types.has(t), t);
    }
  });
});

describe("FIT and INTENT are disjoint (§B.3)", () => {
  test("no feature feeds both FIT and INTENT", () => {
    const fit = new Set<string>(FIT_FEATURE_KEYS);
    for (const key of INTENT_FEATURE_KEYS) assert.ok(!fit.has(key), key);
    for (const key of FIT_FEATURE_KEYS) assert.equal(FEATURE_ALLOW_LIST[key].dimension, "FIT");
    assert.ok(INTENT_FEATURE_KEYS.includes("intent_assessment"));
  });

  test("the intent assessment moves INTENT and never FIT", () => {
    const withIntent = scoreLead({ facts: [{ feature: "intent_assessment", value: 0.9, source: "intent_assessment", confidence: 0.9 }] });
    const without = scoreLead({ facts: [] });
    const fit = (r: typeof withIntent) => r.dimensions.find((d) => d.dimension === "FIT")!;
    const intent = (r: typeof withIntent) => r.dimensions.find((d) => d.dimension === "INTENT")!;
    assert.deepEqual(fit(withIntent), fit(without));
    assert.ok(intent(withIntent).score > 0);
  });

  test("no signal type is a FIT feature name", () => {
    const fit = new Set<string>(FIT_FEATURE_KEYS.map((k) => k.toUpperCase()));
    for (const type of SIGNAL_TYPES) assert.ok(!fit.has(type), type);
  });
});
