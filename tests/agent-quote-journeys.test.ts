import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  detectQuoteRequest,
  emptyQuotePathState,
  markAsked,
  matchCatalogueItems,
  planConcession,
  planQuoteStep,
  quoteFallbackText,
  quoteToolGate,
  quoteFigures,
  quoteIsTheClose,
  readQuoteInputs,
  validationFactsFor,
  type OpenQuote,
  type QuoteCatalogueItem,
  type QuoteInputKind,
  type QuotePathState,
  type QuoteStep,
} from "../src/lib/agent/quote-flow.ts";
import { countQuestions, validateResponse, type ValidationFacts } from "../src/lib/agent/validate.ts";
import { parseAiAuthority, type AiAuthority, type AiPermission } from "../src/lib/commercial/ai-permissions.ts";
import { aiDiscountPolicy, DEFAULT_DISCOUNT_POLICY } from "../src/lib/quotes/discount-policy.ts";
import { applyQuoteDiscount } from "../src/lib/quotes/discount-core.ts";
import { createQuote, sendQuote, submitForApproval, type QuoteActor } from "../src/lib/quotes/service-core.ts";
import {
  chaseStopPlan,
  expiryReminderAt,
  nextStepAfter,
  quoteNudgeDecision,
  QUOTE_VIEW_INTENT_THRESHOLD,
  QUOTE_VIEW_SIGNAL_STRENGTH,
  viewIntentReached,
  viewSignalSourceRef,
} from "../src/lib/quotes/follow-up.ts";
import {
  planQuoteExpired,
  QUOTE_EXPIRED_DELAY_DAYS,
  reengagementReasonLine,
  TRIGGER_LOOP,
  triggerSkipReason,
  type TriggerState,
} from "../src/lib/reengagement/triggers.ts";
import { reengagementCopy } from "../src/lib/reengagement/templates.ts";
import { classifyTouch } from "../src/lib/reengagement/frequency.ts";
import { lintStyle } from "../src/lib/agent/validate.ts";
import { buildSignalWrite } from "../src/lib/qualification-intelligence/signals.ts";
import { DECAY_RULES } from "../src/lib/qualification-intelligence/decay.ts";
import { SIGNAL_TYPE_CATEGORY } from "../src/lib/qualification-intelligence/types.ts";
import {
  agentQuoteActionKey,
  agentQuoteRequestId,
  bookingActionKey,
  leadCommercialLockId,
  leadCommercialLockKey,
  leaseDecision,
  LEASE_SECONDS,
} from "../src/lib/commercial/locks.ts";
import { advisoryLockId, voiceLeadLockKey } from "../src/lib/voice/eligibility.ts";
import { BUSINESS, CATALOGUE, LEAD, OPPORTUNITY, createFakeDeps } from "./fixtures/quote-fakes.ts";

/**
 * Quote journeys (brief §7, §72-74), golden-conversation style: each lead
 * turn goes through the real pure planner (quote-flow.ts), the real quote
 * core over the in-memory store (fixtures/quote-fakes.ts), and the real
 * validator. The "model" is scripted: it writes the reply a good model would
 * from the strategy lines, and a bad draft to prove the validator catches it.
 * Then quote follow-up (reminders, repeat views, expiry, paid) and the locks.
 * No database, no model, no provider, nothing spent.
 */

const agent: QuoteActor = { kind: "AI", userId: null, role: "member" };
const CONVERSATION = "conv-quote-journey";
const ITEMS: QuoteCatalogueItem[] = CATALOGUE.items.map((item) => ({ ...item }));

function authority(on: Partial<Record<AiPermission, boolean>>, discount: Partial<AiAuthority["discount"]> = {}): AiAuthority {
  return parseAiAuthority({ qualify: true, book: true, ...on }, { restraint: "NEVER", ...discount });
}

function facts(quote: ReturnType<typeof validationFactsFor> | null): ValidationFacts {
  return {
    channel: "sms",
    businessName: "Northwind Studio",
    publishedPriceText: [],
    confirmedSlots: [],
    bookingConfirmed: false,
    allowedUrls: [],
    serviceAreaConfirmed: false,
    leadFirstName: "Sam",
    quote,
  };
}

function ok(text: string, f: ValidationFacts) {
  const result = validateResponse(text, f);
  assert.ok(result.ok, `${text} -> ${result.ok ? "" : result.failures.map((x) => `${x.code}: ${x.detail}`).join("; ")}`);
}

function rejected(text: string, f: ValidationFacts, code: string) {
  const result = validateResponse(text, f);
  assert.ok(!result.ok && result.failures.some((x) => x.code === code), `${text} should be ${code}`);
}

/**
 * One conversation: the path state carried turn to turn exactly as
 * decision_json.quote / quoteAsk carry it, the open quote re-read from the
 * fake store each turn, as quote-turn.ts reads it.
 */
function conversation(ai: AiAuthority, settings = {}) {
  const fake = createFakeDeps({ settings });
  let state: QuotePathState = emptyQuotePathState();
  let answering: { kind: QuoteInputKind; itemId: string | null } | null = null;
  const history: string[] = [];
  const gate = { aiEnabled: true, quoteAiCapability: true, authority: ai };
  const policy = aiDiscountPolicy(DEFAULT_DISCOUNT_POLICY, ai);

  function openQuote(): OpenQuote | null {
    const quote = [...fake.state.quotes.values()].at(-1);
    if (!quote || !quote.currentRevisionId) return null;
    const revision = fake.state.revisions.get(quote.currentRevisionId)!;
    return { id: quote.id, status: quote.status, revisionId: revision.id, calculation: revision.calculation, validUntil: revision.validUntil, sent: Boolean(revision.frozenAt) };
  }

  function plan(text: string, messageId: string): { step: QuoteStep; items: QuoteCatalogueItem[] } {
    const open = openQuote();
    if (!state.quoteId && !open) {
      const named = matchCatalogueItems(text, ITEMS);
      if (named.length > 0 && (detectQuoteRequest(text) || state.itemIds.length === 0)) state = { ...state, itemIds: named.map((i) => i.id) };
    }
    const items = state.itemIds.map((id) => ITEMS.find((i) => i.id === id)!).filter(Boolean);
    state = readQuoteInputs({ state, items, text: history.join("\n"), answering: null });
    state = readQuoteInputs({ state, items, text, answering });
    if (items.length > 0 && !state.requestMessageId) state = { ...state, requestMessageId: messageId };
    history.push(text);
    answering = null;
    const step = planQuoteStep({ text, state, items, openQuote: open, gate, focusServiceId: null });
    if (step.kind === "COLLECT") {
      state = markAsked(state, step.input);
      answering = step.input;
    }
    return { step, items };
  }

  return { fake, gate, policy, plan, openQuote, get state() { return state; }, set state(next: QuotePathState) { state = next; } };
}

/* ============================================================= journeys */

describe("golden: a lead asks for a quote -> inputs collected -> quote sent", () => {
  test("asks only for what is missing, one question per turn, then drafts once and sends", async () => {
    const c = conversation(authority({ create_quote: true, send_quote: true }));

    // Turn 1: they ask, and their timing is already in their words.
    const t1 = c.plan("Hi, could you send me a quote for consulting? We'd want to start next month.", "msg-1");
    assert.equal(t1.step.kind, "COLLECT");
    if (t1.step.kind !== "COLLECT") return;
    assert.equal(t1.step.input.kind, "QUANTITY", "timing was stated, so quantity is the one question");
    const reply1 = `Thanks Sam, happy to put that together. ${t1.step.question}`;
    assert.equal(countQuestions(reply1), 1);
    ok(reply1, facts(null));
    rejected("Thanks Sam, consulting is £120 an hour. How many hours?", facts(null), "UNSUPPORTED_PRICE_CLAIM");

    // Turn 2: a bare number answers the quantity question.
    const t2 = c.plan("About 12", "msg-2");
    assert.equal(t2.step.kind, "DRAFT", "nothing left to ask: timing is never re-asked");
    if (t2.step.kind !== "DRAFT") return;
    assert.equal(t2.step.lines[0].quantity, 12);

    // Draft: idempotent on the conversation plus the message that asked.
    const requestId = agentQuoteRequestId(CONVERSATION, c.state.requestMessageId!);
    const created = await createQuote(c.fake.deps, BUSINESS, agent, { opportunityId: OPPORTUNITY, lines: t2.step.lines, requestId, ai: { afterObjection: false, priorAiConcessions: 0, policy: c.policy } });
    const retried = await createQuote(c.fake.deps, BUSINESS, agent, { opportunityId: OPPORTUNITY, lines: t2.step.lines, requestId, ai: { afterObjection: false, priorAiConcessions: 0, policy: c.policy } });
    assert.equal(retried.duplicate, true);
    assert.equal(c.fake.state.quotes.size, 1, "one quote from one request");
    assert.equal(created.revision!.approvalRequired, false);

    const sent = await sendQuote(c.fake.deps, BUSINESS, agent, { quoteId: created.quote.id, channel: "email" });
    assert.equal(sent.status, "SENT");
    c.state = { ...c.state, quoteId: created.quote.id };

    const figures = quoteFigures(created.revision!.calculation, { validUntil: sent.validUntil });
    const f = facts(validationFactsFor(figures));
    ok(`Thanks Sam, I've emailed your quote over. It comes to ${figures.figures[0]} including VAT. Happy to go through any of it.`, f);
    ok(quoteFallbackText({ kind: "DRAFTED", then: "SENT" }, figures, "Sam"), f);
    rejected("Thanks Sam, it's £1,500 all in.", f, "UNSUPPORTED_PRICE_CLAIM");
    rejected("It's sent over, and we can start within two weeks.", f, "UNSUPPORTED_DELIVERY_CLAIM");
  });

  test("without 'Draft quotes' the path is NOT_PERMITTED and the ordinary price handling carries on", () => {
    const c = conversation(authority({}));
    assert.equal(c.plan("Can I get a quote for consulting?", "m1").step.kind, "NOT_PERMITTED");
  });

  test("a drafted quote waits for a person when 'Send quotes' is off", async () => {
    const c = conversation(authority({ create_quote: true }));
    const t1 = c.plan("Could you quote me for a website build?", "m1");
    assert.equal(t1.step.kind, "COLLECT", "a project-priced item needs no quantity; its timing is the one question");
    if (t1.step.kind === "COLLECT") assert.equal(t1.step.input.kind, "TIMING");
    const t2 = c.plan("As soon as possible really", "m2");
    assert.equal(t2.step.kind, "DRAFT");
    assert.equal(quoteToolGate("send_quote", c.gate).allowed, false, "the runtime then asks a person to send it");
    const f = facts(validationFactsFor(null));
    ok(quoteFallbackText({ kind: "DRAFTED", then: "PERSON_SENDS" }, null, "Sam"), f);
    rejected("Your quote is £6,000 and a colleague will send it.", f, "UNSUPPORTED_PRICE_CLAIM");
  });

  test("several interests: a quote for another offer is deferred, one move per turn", () => {
    const fake = createFakeDeps();
    void fake;
    const step = planQuoteStep({
      text: "And could you quote for the consulting?",
      state: { ...emptyQuotePathState(), itemIds: ["consulting"] },
      items: [{ ...ITEMS[2], serviceId: "11111111-2222-4333-8444-555555555555" }],
      openQuote: null,
      gate: { aiEnabled: true, quoteAiCapability: true, authority: authority({ create_quote: true }) },
      focusServiceId: "99999999-2222-4333-8444-555555555555",
    });
    assert.equal(step.kind, "DEFERRED");
  });

  test("a quote-led offer closes with the quote", () => {
    assert.equal(quoteIsTheClose({ pricingModel: "QUOTE", itemsForService: 1, nbaAction: "CTA_BOOK" }), true);
    assert.equal(quoteIsTheClose({ pricingModel: "FIXED", itemsForService: 1, nbaAction: "CTA_BOOK" }), false);
    assert.equal(quoteIsTheClose({ pricingModel: "QUOTE", itemsForService: 0, nbaAction: "CTA_BOOK" }), false);
    assert.equal(quoteIsTheClose({ pricingModel: "QUOTE", itemsForService: 1, nbaAction: "ASK" }), false);
  });
});

async function sentWebsiteQuote(c: ReturnType<typeof conversation>) {
  const created = await createQuote(c.fake.deps, BUSINESS, agent, {
    opportunityId: OPPORTUNITY,
    lines: [{ lineId: "l1", kind: "ITEM", itemId: "website", quantity: 1, optionIds: [] }],
    requestId: agentQuoteRequestId(CONVERSATION, "msg-quote"),
    ai: { afterObjection: false, priorAiConcessions: 0, policy: c.policy },
  });
  await sendQuote(c.fake.deps, BUSINESS, agent, { quoteId: created.quote.id, channel: "email" });
  c.state = { ...c.state, itemIds: ["website"], quoteId: created.quote.id };
  return created.quote.id;
}

describe("golden: a discount request within limits", () => {
  test("price objection -> 5% off -> revised quote sent -> the new figures, and only those", async () => {
    const c = conversation(authority({ create_quote: true, send_quote: true, discount: true }, { restraint: "ONLY_AFTER_OBJECTION", maxPercent: 10, firstConcessionPercent: 5 }));
    const quoteId = await sentWebsiteQuote(c);
    const turn = c.plan("Thanks. It's a bit over our budget to be honest, can you do anything on the price?", "msg-d1");
    assert.equal(turn.step.kind, "DISCOUNT");
    const open = c.openQuote()!;
    const concession = planConcession({ policy: c.policy, calculation: open.calculation!, requestedPercent: null, afterObjection: true, priorAiConcessions: 0 });
    assert.equal(concession.decision.outcome, "ALLOW");
    const applied = await applyQuoteDiscount(c.fake.deps, BUSINESS, agent, { quoteId, discount: { type: "PERCENT", bps: concession.bps, scope: "ALL" }, ai: { afterObjection: true, priorAiConcessions: 0, policy: c.policy } });
    const resent = await sendQuote(c.fake.deps, BUSINESS, agent, { quoteId, channel: "email" });
    assert.equal(resent.status, "SENT");
    const figures = quoteFigures(applied.calculation);
    const f = facts(validationFactsFor(figures));
    ok(`I've been able to take 5% off, so it now comes to ${figures.figures[0]} including VAT. The revised quote is on its way.`, f);
    ok(quoteFallbackText({ kind: "DISCOUNT", outcome: "ALLOW", sent: true, bps: 500 }, figures, "Sam"), f);
    rejected("I can do 10% off if that helps.", f, "UNSUPPORTED_DISCOUNT");
    rejected(`It now comes to ${quoteFigures(open.calculation!).figures[0]}.`.replace("6,000", "5,900"), f, "UNSUPPORTED_PRICE_CLAIM");
  });
});

describe("golden: a discount request outside limits", () => {
  test("above the approval threshold: approval requested, and the lead is told honestly it is being checked", async () => {
    const c = conversation(authority({ create_quote: true, send_quote: true, discount: true }, { restraint: "ONLY_AFTER_OBJECTION", maxPercent: 10, approvalAbovePercent: 3 }));
    const quoteId = await sentWebsiteQuote(c);
    const turn = c.plan("That's more than we budgeted. Could you do 8% off?", "msg-d2");
    assert.equal(turn.step.kind, "DISCOUNT");
    if (turn.step.kind !== "DISCOUNT") return;
    assert.equal(turn.step.requestedPercent, 8);
    const concession = planConcession({ policy: c.policy, calculation: c.openQuote()!.calculation!, requestedPercent: 8, afterObjection: true, priorAiConcessions: 0 });
    assert.equal(concession.decision.outcome, "REQUIRE_APPROVAL");
    const applied = await applyQuoteDiscount(c.fake.deps, BUSINESS, agent, { quoteId, discount: { type: "PERCENT", bps: concession.bps, scope: "ALL" }, ai: { afterObjection: true, priorAiConcessions: 0, policy: c.policy } });
    assert.equal(applied.approval.required, true);
    const submitted = await submitForApproval(c.fake.deps, BUSINESS, agent, { quoteId, note: "Lead asked for 8% off." });
    assert.equal(submitted.status, "PENDING_APPROVAL");

    const f = facts(validationFactsFor(null, { discountUnderReview: true }));
    ok("Thanks Sam. I've asked the team to look at a discount for you, and I'll come back to you.", f);
    ok(quoteFallbackText({ kind: "DISCOUNT", outcome: "REQUIRE_APPROVAL", sent: false, bps: concession.bps }, null, "Sam"), f);
    rejected("Good news, 8% off is fine.", f, "UNSUPPORTED_DISCOUNT");

    // The next message while it waits: honest, no figure.
    assert.equal(c.plan("Any news on the price?", "msg-d3").step.kind, "AWAITING_APPROVAL");
  });

  test("with discounts not allowed, the price is held politely and nothing is offered", async () => {
    const c = conversation(authority({ create_quote: true, send_quote: true }));
    await sentWebsiteQuote(c);
    const turn = c.plan("Can you do 20% off?", "msg-h1");
    assert.equal(turn.step.kind, "DISCOUNT");
    const f = facts(validationFactsFor(quoteFigures(c.openQuote()!.calculation!)));
    const hold = quoteFallbackText({ kind: "DISCOUNT", outcome: "DENY", sent: false, bps: null }, null, "Sam");
    ok(hold, f);
    assert.equal(countQuestions(hold), 1, "objection craft: one clarifying question");
    rejected("I can do 20% off for you.", f, "UNSUPPORTED_DISCOUNT");
  });
});

describe("golden: a lead who viewed a quote three times", () => {
  test("a HIGH buying-intent signal, the reminder moves to expiry, and their question is answered from the quote", async () => {
    const c = conversation(authority({ create_quote: true, send_quote: true }));
    const quoteId = await sentWebsiteQuote(c);
    const revisionId = c.openQuote()!.revisionId!;

    assert.equal(viewIntentReached(QUOTE_VIEW_INTENT_THRESHOLD - 1, false), false);
    assert.equal(viewIntentReached(QUOTE_VIEW_INTENT_THRESHOLD, false), true);
    assert.equal(viewIntentReached(7, true), false, "once per revision");
    const signal = buildSignalWrite({
      leadId: LEAD,
      serviceId: null,
      type: "QUOTE_VIEWED_REPEATEDLY",
      strength: QUOTE_VIEW_SIGNAL_STRENGTH,
      confidence: 1,
      source: "TOUCH",
      sourceRef: viewSignalSourceRef(revisionId),
      observedAt: new Date().toISOString(),
      reason: "Opened their quote 3 times",
    });
    assert.equal(signal.category, "BEHAVIOURAL");
    assert.equal(signal.polarity, "POSITIVE");
    assert.ok(signal.strength >= 0.8, "HIGH");
    assert.equal(SIGNAL_TYPE_CATEGORY.QUOTE_VIEWED_REPEATEDLY, "BEHAVIOURAL");
    assert.ok((DECAY_RULES.QUOTE_VIEWED_REPEATEDLY.halfLifeHours ?? 0) >= (DECAY_RULES.BOOKING_LINK_OPENED.halfLifeHours ?? 0));
    assert.match(readFileSync("supabase/migrations/0160_ai_quote_authority_and_locks.sql", "utf8"), /'QUOTE_VIEWED_REPEATEDLY'/);

    // Mark it viewed (the customer opened it).
    await c.fake.store.transition({ businessId: BUSINESS, quoteId, action: "MARK_VIEWED", expectedStatus: "SENT", actorKind: "CUSTOMER" });
    const open = c.openQuote()!;
    assert.equal(open.status, "VIEWED");
    const reminder = quoteNudgeDecision({ step: 1, status: "VIEWED", sentAt: new Date().toISOString(), firstViewedAt: new Date().toISOString(), validUntil: open.validUntil, now: new Date(), nudgesEnabled: true, leadRepliedSinceSent: false });
    assert.equal(reminder.action, "RESCHEDULE", "a viewed quote gets no 'have you seen it' reminder");

    const turn = c.plan("Does the total include VAT?", "msg-v1");
    assert.equal(turn.step.kind, "ANSWER_FROM_QUOTE");
    const figures = quoteFigures(open.calculation!, { validUntil: open.validUntil });
    const f = facts(validationFactsFor(figures));
    ok(`Yes, ${figures.figures[0]} is the total including VAT, which is ${figures.labelled.find((l) => l.label === "VAT")!.value}.`, f);
    rejected("Yes, VAT is charged at 17.5%.", f, "UNSUPPORTED_VAT_CLAIM");
  });
});

/* ============================================================ follow-up */

describe("quote follow-up (§72)", () => {
  const now = new Date("2026-10-01T10:00:00Z");
  const validUntil = "2026-10-31T00:00:00.000Z";

  test("sent and not viewed after N days: a reminder", () => {
    assert.deepEqual(quoteNudgeDecision({ step: 1, status: "SENT", sentAt: "2026-09-28T10:00:00Z", firstViewedAt: null, validUntil, now, nudgesEnabled: true, leadRepliedSinceSent: false }), { action: "SEND", kind: "NOT_VIEWED" });
  });

  test("expiry approaching: a reminder; too close or expired: none", () => {
    assert.deepEqual(quoteNudgeDecision({ step: 2, status: "VIEWED", sentAt: null, firstViewedAt: null, validUntil, now, nudgesEnabled: true, leadRepliedSinceSent: false }), { action: "SEND", kind: "EXPIRY" });
    assert.equal(quoteNudgeDecision({ step: 2, status: "SENT", sentAt: null, firstViewedAt: null, validUntil: "2026-10-01T15:00:00Z", now, nudgesEnabled: true, leadRepliedSinceSent: false }).action, "SKIP");
    assert.equal(quoteNudgeDecision({ step: 2, status: "SENT", sentAt: null, firstViewedAt: null, validUntil: "2026-09-30T00:00:00Z", now, nudgesEnabled: true, leadRepliedSinceSent: false }).action, "SKIP");
    const at = expiryReminderAt(validUntil, now)!;
    assert.equal(at.toISOString(), "2026-10-29T00:00:00.000Z");
  });

  test("a lead who replied, a switched-off workspace or a closed quote gets no reminder", () => {
    const base = { step: 1, status: "SENT", sentAt: null, firstViewedAt: null, validUntil, now, nudgesEnabled: true, leadRepliedSinceSent: false };
    assert.equal(quoteNudgeDecision({ ...base, leadRepliedSinceSent: true }).action, "SKIP");
    assert.equal(quoteNudgeDecision({ ...base, nudgesEnabled: false }).action, "SKIP");
    for (const status of ["ACCEPTED", "SIGNED", "PAID", "DECLINED", "EXPIRED", "WITHDRAWN"]) assert.equal(quoteNudgeDecision({ ...base, status }).action, "SKIP", status);
  });

  test("the one reminder job is quote-P2's quote.nudge, and it asks the frequency guard", () => {
    const jobs = readFileSync("src/lib/jobs/handlers/quote-jobs.ts", "utf8");
    assert.match(jobs, /quoteNudgeDecision\(/);
    assert.match(jobs, /checkAutomatedTouchAllowed\(\{ businessId: q\.business_id, leadId, loop: "quote_follow_up" \}\)/);
    assert.equal((jobs.match(/export async function handleQuoteNudge/g) ?? []).length, 1);
    assert.deepEqual(classifyTouch({ origin: "automation", sendKey: "quote-link:abc" }), { automated: true, loop: "quote_follow_up" });
  });

  test("accepted -> the signature step; signed -> the payment step", () => {
    assert.equal(nextStepAfter("ACCEPTED"), "SIGN");
    assert.equal(nextStepAfter("SIGNED"), "PAY");
    assert.equal(nextStepAfter("DEPOSIT_PAID"), "PAY");
    const c = { aiEnabled: true, quoteAiCapability: true, authority: authority({ create_quote: true }) };
    const step = planQuoteStep({ text: "Signed it!", state: emptyQuotePathState(), items: [], openQuote: { id: "q", status: "ACCEPTED", revisionId: "r", calculation: null, validUntil: null, sent: true }, gate: c, focusServiceId: null });
    assert.deepEqual(step, { kind: "NEXT_STEP", quoteId: "q", status: "ACCEPTED" });
  });

  test("paid stops all sales chasing, immediately", () => {
    assert.deepEqual(chaseStopPlan("SENT"), { stop: false });
    for (const status of ["DEPOSIT_PAID", "PAID", "WON"]) {
      const plan = chaseStopPlan(status);
      assert.equal(plan.stop, true, status);
      if (plan.stop) assert.deepEqual([...plan.cancelJobTypes].sort(), ["checkout.nudge", "quote.nudge", "reengage.trigger"]);
    }
    // Wired where the quote becomes paid: the invoicing store's RPC wrapper.
    const store = readFileSync("src/lib/invoicing/store.ts", "utf8");
    assert.match(store, /if \(result\.ok\) await stopSalesChasing\(businessId, quoteId/);
    const chasing = readFileSync("src/lib/quotes/chasing.ts", "utf8");
    assert.match(chasing, /automation_active: false/);
    assert.match(chasing, /stopAutomationRuns\(businessId, leadId, "won"\)/);
    assert.match(chasing, /state: "cancelled"/);
  });
});

describe("expired -> re-engagement (§72)", () => {
  test("one check-in a week after expiry, on its own loop", () => {
    const plan = planQuoteExpired({ id: "quote-1", expiredAt: "2026-10-01T00:00:00.000Z" })!;
    assert.equal(plan.trigger, "QUOTE_EXPIRED");
    assert.equal(plan.dueAt.toISOString(), new Date(Date.parse("2026-10-01T00:00:00Z") + QUOTE_EXPIRED_DELAY_DAYS * 86_400_000).toISOString());
    assert.ok(plan.expiresAt.getTime() > plan.dueAt.getTime());
    assert.equal(TRIGGER_LOOP.QUOTE_EXPIRED, "quote_follow_up");
    assert.equal(planQuoteExpired({ id: "q", expiredAt: null }), null);
  });

  test("the stop conditions: replied, booked, paused, won, opted out", () => {
    const base: TriggerState = {
      trigger: "QUOTE_EXPIRED",
      now: new Date("2026-10-08T10:00:00Z"),
      expiresAt: new Date("2026-10-29T00:00:00Z"),
      enabled: true,
      lead: { status: "CONTACTED", optedOut: false, humanTakeover: false, automationActive: true, archived: false, anonymised: false, isTest: false },
      repliedSinceSource: false,
      bookedSinceSource: false,
      sourceCurrent: true,
    };
    assert.equal(triggerSkipReason(base), null);
    assert.equal(triggerSkipReason({ ...base, repliedSinceSource: true }), "replied");
    assert.equal(triggerSkipReason({ ...base, bookedSinceSource: true }), "booked");
    assert.equal(triggerSkipReason({ ...base, lead: { ...base.lead!, automationActive: false } }), "paused");
    assert.equal(triggerSkipReason({ ...base, lead: { ...base.lead!, status: "WON" } }), "won");
    assert.equal(triggerSkipReason({ ...base, lead: { ...base.lead!, optedOut: true } }), "opted_out");
    assert.equal(triggerSkipReason({ ...base, sourceCurrent: false }), "superseded", "a re-issued quote supersedes it");
  });

  test("the agent is told why it is writing; the fixed copy names no figure and applies no pressure", () => {
    assert.match(reengagementReasonLine({ trigger: "QUOTE_EXPIRED", date: "2026-10-01T00:00:00Z" }), /quote expired on 1 October 2026/);
    const copy = reengagementCopy({ trigger: "QUOTE_EXPIRED", values: { firstName: "Sam", businessName: "Northwind Studio", serviceName: "Website build", bookingLink: null } });
    assert.doesNotMatch(copy.body, /£|\d+%|discount/i);
    assert.deepEqual(lintStyle(copy.body, { channel: "email" }).map((f) => f.code), []);
    const handler = readFileSync("src/lib/jobs/handlers/quote-jobs.ts", "utf8");
    assert.match(handler, /planQuoteExpiredTrigger\(/);
  });
});

/* ================================================================ locks */

describe("no duplicate commercial actions (§73)", () => {
  test("the lead lock is the voice lead lock: one advisory lock id for a dial and a commercial action", () => {
    assert.equal(leadCommercialLockKey(BUSINESS, LEAD), voiceLeadLockKey(BUSINESS, LEAD));
    assert.equal(leadCommercialLockId(BUSINESS, LEAD), advisoryLockId(voiceLeadLockKey(BUSINESS, LEAD)));
    const sql = readFileSync("supabase/migrations/0160_ai_quote_authority_and_locks.sql", "utf8");
    assert.match(sql, /perform pg_advisory_xact_lock\(p_lead_lock_id\)/);
    assert.match(sql, /unique \(business_id, action_key\)/);
    assert.match(sql, /grant execute on function public\.claim_commercial_action\([^)]*\) to service_role/);
    assert.doesNotMatch(sql, /grant [a-z, ]+ on public\.(lead_commercial_leases|commercial_action_claims) to (anon|authenticated)/);
  });

  test("one actor kind at a time; two voice agents never share a lead", () => {
    const now = new Date("2026-10-01T10:00:00Z");
    const live = (holder: "AI" | "HUMAN" | "VOICE", ref: string | null = null) => ({ holder, holderRef: ref, expiresAt: "2026-10-01T10:05:00Z" });
    assert.deepEqual(leaseDecision(null, { holder: "AI", holderRef: "c1", now }), { ok: true, renew: false });
    assert.equal(leaseDecision(live("HUMAN", "u1"), { holder: "AI", holderRef: "c1", now }).ok, false, "the AI waits while a person works the lead");
    assert.equal(leaseDecision(live("AI", "c1"), { holder: "HUMAN", holderRef: "u1", now }).ok, false, "and a person while the AI does");
    assert.equal(leaseDecision(live("AI", "c1"), { holder: "AI", holderRef: "c1", now }).ok, true);
    assert.equal(leaseDecision(live("VOICE", "call-1"), { holder: "VOICE", holderRef: "call-2", now }).ok, false, "a second voice agent is refused");
    assert.equal(leaseDecision(live("VOICE", "call-1"), { holder: "VOICE", holderRef: "call-1", now }).ok, true);
    assert.equal(leaseDecision({ ...live("HUMAN"), expiresAt: "2026-10-01T09:00:00Z" }, { holder: "AI", holderRef: "c1", now }).ok, true, "an expired lease is free");
    assert.ok(LEASE_SECONDS.AI < LEASE_SECONDS.HUMAN);
  });

  test("the keys: one quote per request, one action per revision, one booking per slot", async () => {
    assert.equal(agentQuoteRequestId("c1", "m1"), agentQuoteRequestId("c1", "m1"));
    assert.notEqual(agentQuoteRequestId("c1", "m1"), agentQuoteRequestId("c1", "m2"));
    const send = agentQuoteActionKey("QUOTE_SEND", "q1", "r1");
    assert.equal(send, agentQuoteActionKey("QUOTE_SEND", "q1", "r1"));
    assert.notEqual(send, agentQuoteActionKey("QUOTE_APPROVAL_REQUEST", "q1", "r1"));
    assert.notEqual(send, agentQuoteActionKey("QUOTE_SEND", "q1", "r2"));
    assert.equal(bookingActionKey(BUSINESS, LEAD, "2026-10-01T10:00:00Z"), bookingActionKey(BUSINESS, LEAD, "2026-10-01T11:00:00+01:00"), "the same instant");

    // Through the core: two sends of one revision are one SEND transition.
    const fake = createFakeDeps();
    const created = await createQuote(fake.deps, BUSINESS, agent, { opportunityId: OPPORTUNITY, lines: [{ lineId: "l1", kind: "ITEM", itemId: "website", quantity: 1, optionIds: [] }], requestId: agentQuoteRequestId("c1", "m1") });
    await sendQuote(fake.deps, BUSINESS, agent, { quoteId: created.quote.id, channel: "email" });
    const again = await sendQuote(fake.deps, BUSINESS, agent, { quoteId: created.quote.id, channel: "email" });
    assert.equal(again.resend, true);
    assert.equal(fake.state.transitions.filter((t) => t.action === "SEND").length, 1);
    assert.equal(fake.effects.jobs.filter((j) => j.type === "quote.render_pdf").length, 1, "no second render, expiry or nudge chain");
  });

  test("the tools claim the lead before every commercial write, and a person's quote action does too", () => {
    const tools = readFileSync("src/lib/agent/tools.ts", "utf8");
    for (const kind of ["QUOTE_CREATE", "QUOTE_SEND", "QUOTE_APPROVAL_REQUEST", "QUOTE_DISCOUNT"]) {
      assert.match(tools, new RegExp(`claimForAssistant\\(context, "${kind}"`), kind);
    }
    const ops = readFileSync("src/lib/services/operations/quotes.ts", "utf8");
    assert.match(ops, /claimForPerson\(context, await leadOfOpportunity/);
    assert.match(ops, /claimForPerson\(context, await leadOfQuote/);
  });
});
