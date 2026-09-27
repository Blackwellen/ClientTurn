import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  attributeReply,
  checkoutLinkForService,
  assessmentFieldsFor,
  closeness,
  crmDealPlan,
  coordinateInterests,
  detectInterests,
  factsForInterest,
  factsInMergeScope,
  followUpContinues,
  interestFactWrite,
  interestStrategyLines,
  isSharedDimension,
  leadStatusAfterClose,
  pickInterestForEvent,
  rankPlans,
  serviceForCheckoutLink,
  servicesMentioned,
  summariseInterests,
  type InterestPlan,
} from "../src/lib/qualification-intelligence/interests.ts";
import {
  QIE_ENGINE_VERSION,
  leadAssessmentWriteSchema,
  nextBestActionSchema,
  type NextBestAction,
  type QualificationFact,
} from "../src/lib/qualification-intelligence/types.ts";
import { countQuestions } from "../src/lib/agent/validate.ts";
import { runQuestionQa } from "../src/lib/qualification-intelligence/qa.ts";
import { runMultiConversation, renderMultiTable, type MultiConversation } from "./golden-conversations/multi-interest-harness.ts";

/**
 * Several interests per lead (08 §B.20): detection, the shared / per-offer
 * fact split, the coordinator's one move per turn, closing one interest while
 * another stays open, and the golden conversation where the AI closes a
 * subscription and books the website meeting without re-asking shared facts.
 */

const WEB = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";
const SEO = "33333333-3333-4333-8333-333333333333";
const SERVICES = [
  { id: WEB, name: "Website rebuild" },
  { id: SUB, name: "Growth subscription" },
  { id: SEO, name: "SEO audit" },
];

function fact(dimension: string, serviceId: string | null, value = "x"): QualificationFact {
  return {
    id: `${dimension}-${serviceId}`,
    leadId: "l",
    serviceId,
    dimension: dimension as QualificationFact["dimension"],
    value,
    valueNormalised: value,
    state: "CONFIRMED",
    source: "ANSWER",
    sourceRef: "m",
    questionId: null,
    questionIntentKey: null,
    confidence: 1,
    observedAt: "2026-09-24T09:00:00.000Z",
    validUntil: null,
    verifiedAt: null,
    setBy: null,
    supersededAt: null,
  };
}

const BASE_NBA: NextBestAction = nextBestActionSchema.parse({
  current_goal: "B_BOOK_MEETING",
  intent_state: "MEDIUM",
  intent_score: 50,
  known_dimensions: [],
  unknown_required_dimensions: [],
  next_action: "INFORM",
  question_intent: null,
  reason: "r",
  rule: "R12_FALLBACK",
  expected_information_gain: 0,
  qualification_score: 0,
  qualification_completeness: 0,
  engine_verdict: "PENDING",
  confidence: 0.5,
  handover_reason: null,
  assist_reason: null,
  resume_at: null,
  suppress: false,
  model_call_required: true,
  question_value: null,
  alternatives: [],
  engine_version: "nba-1",
});

const QUESTION = { key: "PROJECT_SCOPE.WHAT", dimension: "PROJECT_SCOPE", purpose: "DISCOVER", question_id: null, wording_family: "scope", rendering: "What would the new site need to do?" } as const;

function plan(serviceId: string, action: string, extra: Omit<Partial<InterestPlan>, "nba"> & { nba?: Partial<NextBestAction> } = {}): InterestPlan {
  const asks = action === "ASK" || action === "ANSWER_AND_ASK";
  const nba = nextBestActionSchema.parse({
    ...BASE_NBA,
    next_action: action,
    question_intent: asks ? QUESTION : null,
    handover_reason: action === "ESCALATE" ? "HUMAN_REQUESTED" : null,
    resume_at: action === "WAIT" ? "2026-10-01T09:00:00.000Z" : null,
    ...(extra.nba ?? {}),
  });
  const rest: Omit<Partial<InterestPlan>, "nba"> & { nba?: Partial<NextBestAction> } = { ...extra };
  delete rest.nba;
  return {
    serviceId,
    serviceName: SERVICES.find((s) => s.id === serviceId)!.name,
    source: "MESSAGE",
    isLeadService: serviceId === WEB,
    resolved: {} as InterestPlan["resolved"],
    goal: { goal: action === "CTA_SIGNUP" ? "D_SIGNUP_TRIAL" : "B_BOOK_MEETING", source: "OFFER_PROFILE", motion: "BOOK_MEETING_B2B" },
    motion: "BOOK_MEETING_B2B",
    stage: "QUALIFYING",
    dimensions: [],
    completeness: 0.5,
    thresholdMet: false,
    dealValueGbp: null,
    bookingScheduled: false,
    opportunity: { id: `opp-${serviceId}`, stage: "OPEN", outcome: "OPEN", value: null },
    checkoutLinkId: action === "CTA_SIGNUP" ? "growth-monthly" : null,
    checkoutAllowed: true,
    mentioned: false,
    nba,
    input: {} as InterestPlan["input"],
    ...(rest as Omit<Partial<InterestPlan>, "nba">),
  };
}

describe("interest detection", () => {
  test("a message naming two configured services names both, in text order", () => {
    const hits = servicesMentioned("We need to rebuild our website, and also want the Growth subscription.", SERVICES);
    assert.deepEqual(hits.map((h) => h.serviceId), [WEB, SUB]);
  });

  test("a negated mention is not an interest", () => {
    assert.deepEqual(servicesMentioned("We don't need a website rebuild, just the Growth subscription", SERVICES).map((h) => h.serviceId), [SUB]);
  });

  test("the head noun alone names a service when no other shares it", () => {
    assert.deepEqual(servicesMentioned("Can I start the subscription today?", SERVICES).map((h) => h.serviceId), [SUB]);
    assert.deepEqual(servicesMentioned("Just a quick question", SERVICES), []);
  });

  test("detectInterests: lead service first, then messages, forms and a person's addition, one per service", () => {
    const interests = detectInterests({
      leadServiceId: WEB,
      leadCreatedAt: "2026-09-24T09:00:00.000Z",
      services: SERVICES,
      inbound: [{ id: "m1", body: "Also keen on the Growth subscription", createdAt: "2026-09-24T10:00:00.000Z" }],
      touches: [{ id: "t1", answers: { "Which services are you interested in?": ["Website rebuild", "SEO audit"] }, occurredAt: "2026-09-24T09:00:00.000Z" }],
      opportunities: [],
      facts: [],
    });
    assert.deepEqual(interests.map((i) => [i.serviceId, i.source]), [[WEB, "LEAD_SERVICE"], [SEO, "FORM"], [SUB, "MESSAGE"]]);
  });

  test("an interest a person added (a MANUAL interest fact) is detected", () => {
    const manual = { ...fact("SERVICE_NEEDED", SEO, "SEO audit"), source: "MANUAL" as const, sourceRef: "manual:x#interest:" + SEO };
    const interests = detectInterests({ leadServiceId: WEB, leadCreatedAt: "2026-09-24T09:00:00.000Z", services: SERVICES, inbound: [], touches: [], opportunities: [], facts: [manual] });
    assert.deepEqual(interests.map((i) => [i.serviceId, i.source]), [[WEB, "LEAD_SERVICE"], [SEO, "MANUAL"]]);
  });

  test("a service that is not configured (or inactive) is never an interest", () => {
    const interests = detectInterests({ leadServiceId: null, leadCreatedAt: "2026-09-24T09:00:00.000Z", services: [SERVICES[0]], inbound: [{ id: "m", body: "the Growth subscription please", createdAt: "2026-09-24T10:00:00.000Z" }], touches: [], opportunities: [{ serviceId: SUB, createdAt: "2026-09-24T09:00:00.000Z" }], facts: [] });
    assert.deepEqual(interests, []);
  });

  test("the interest fact is CONFIRMED SERVICE_NEEDED for that service, unique per event and service", () => {
    const w = interestFactWrite({ leadId: "00000000-0000-4000-8000-000000000001", interest: { serviceId: SUB, source: "MESSAGE", evidence: "subscription", sourceRef: "m1", observedAt: "2026-09-24T10:00:00.000Z" }, serviceName: "Growth subscription" });
    assert.equal(w?.dimension, "SERVICE_NEEDED");
    assert.equal(w?.service_id, SUB);
    assert.equal(w?.state, "CONFIRMED");
    assert.equal(w?.source_ref, `m1#interest:${SUB}`);
    assert.equal(interestFactWrite({ leadId: "l", interest: { serviceId: WEB, source: "LEAD_SERVICE", evidence: null, sourceRef: null, observedAt: "x" }, serviceName: "Website rebuild" }), null);
  });
});

describe("shared versus per-interest dimensions", () => {
  const scope = { primaryServiceId: WEB, interestServiceIds: [WEB, SUB] };
  const facts = [fact("COMPANY_SIZE", WEB), fact("AUTHORITY", SUB), fact("TIMING", null), fact("BUDGET", WEB), fact("USE_CASE", SUB), fact("PROJECT_SCOPE", null)];

  test("company size, the decision maker and timing are shared; budget, use case and scope are not", () => {
    for (const d of ["COMPANY_SIZE", "AUTHORITY", "TIMING", "TEAM_SIZE", "STAKEHOLDERS"]) assert.ok(isSharedDimension(d as never), d);
    for (const d of ["BUDGET", "USE_CASE", "PROJECT_SCOPE", "SERVICE_NEEDED", "CURRENT_SOLUTION"]) assert.ok(!isSharedDimension(d as never), d);
  });

  test("each interest reads every shared fact and only its own per-offer facts", () => {
    const web = factsForInterest(facts, WEB, scope).map((f) => f.dimension).sort();
    const sub = factsForInterest(facts, SUB, scope).map((f) => f.dimension).sort();
    assert.deepEqual(web, ["AUTHORITY", "BUDGET", "COMPANY_SIZE", "PROJECT_SCOPE", "TIMING"]);
    assert.deepEqual(sub, ["AUTHORITY", "COMPANY_SIZE", "TIMING", "USE_CASE"]);
  });

  test("with one interest nothing is scoped (the single-offer engine is unchanged)", () => {
    assert.equal(factsForInterest(facts, WEB, { primaryServiceId: WEB, interestServiceIds: [WEB] }).length, facts.length);
    assert.equal(factsInMergeScope(facts, { dimension: "BUDGET", service_id: SUB }, { primaryServiceId: WEB, interestServiceIds: [WEB] }).length, facts.length);
  });

  test("a per-offer fact merges only against the same interest; a shared one against all", () => {
    assert.deepEqual(factsInMergeScope(facts, { dimension: "BUDGET", service_id: SUB }, scope).map((f) => f.serviceId), [SUB, SUB]);
    assert.ok(!factsInMergeScope(facts, { dimension: "BUDGET", service_id: SUB }, scope).some((f) => f.dimension === "BUDGET"), "the website's budget is out of scope");
    assert.equal(factsInMergeScope(facts, { dimension: "TIMING", service_id: SUB }, scope).length, facts.length);
  });

  test("a reply's per-offer facts go to the interest it names, else the focus, else the lead's service", () => {
    const base = { services: SERVICES, interestServiceIds: [WEB, SUB], primaryServiceId: WEB };
    assert.equal(attributeReply({ ...base, text: "For the subscription, about 20 reports a month", focusServiceId: WEB }), SUB);
    assert.equal(attributeReply({ ...base, text: "About 20 a month", focusServiceId: SUB }), SUB);
    assert.equal(attributeReply({ ...base, text: "About 20 a month", focusServiceId: null }), WEB);
  });
});

describe("the coordinator: one move per turn", () => {
  test("the interest closest to its close goes first", () => {
    const c = coordinateInterests([plan(WEB, "ASK"), plan(SUB, "CTA_SIGNUP")], { channel: "email" });
    assert.equal(c.primary.serviceId, SUB);
    assert.equal(c.rule, "CLOSEST_TO_CLOSE");
    assert.ok(closeness(plan(SUB, "CTA_SIGNUP")) > closeness(plan(WEB, "ASK")));
  });

  test("ties go to the interest the lead just named, then value", () => {
    const named = coordinateInterests([plan(WEB, "ASK"), plan(SUB, "ASK", { mentioned: true })], { channel: "email" });
    assert.equal(named.primary.serviceId, SUB);
    const valued = rankPlans([plan(WEB, "ASK", { dealValueGbp: 100 }), plan(SUB, "ASK", { dealValueGbp: 9000 })]);
    assert.equal(valued[0].serviceId, SUB);
  });

  test("a checkout link may carry one light touch; the reply still asks one question at most", () => {
    const c = coordinateInterests([plan(WEB, "ASK"), plan(SUB, "CTA_SIGNUP")], { channel: "email" });
    assert.equal(c.companion?.kind, "ASK");
    assert.equal(c.companion?.serviceId, WEB);
    const lines = interestStrategyLines(c).join("\n");
    assert.match(lines, /Growth subscription/);
    assert.match(lines, /checkout_link_id growth-monthly/);
    const call = coordinateInterests([plan(WEB, "CTA_BOOK"), plan(SUB, "CTA_SIGNUP", { completeness: 0.9 })], { channel: "sms" });
    assert.equal(call.companion?.kind, "PROPOSE_CALL");
    assert.match(interestStrategyLines(call).join("\n"), /Name no day or time/);
  });

  test("the companion question passes pre-send QA beside a sign-up close; an unplanned one does not", () => {
    const c = coordinateInterests([plan(WEB, "ASK"), plan(SUB, "CTA_SIGNUP")], { channel: "email" });
    const ctx = {
      channel: "email" as const,
      stage: "CLOSING" as const,
      intentState: "PURCHASE_READY" as const,
      engineVerdict: "PENDING" as const,
      nbaAction: "CTA_SIGNUP" as const,
      plannedQuestion: null,
      dimensions: [],
      forbiddenIntents: [],
      inbound: "Can I start the subscription?",
      recentOutbound: [],
      companionQuestion: c.companion?.question ? { key: c.companion.question.key, dimension: c.companion.question.dimension, purpose: c.companion.question.purpose, rendering: c.companion.question.rendering } : null,
    };
    const good = "Here's the link to start your Growth subscription. On the website rebuild, what would the new site need to do?";
    assert.equal(countQuestions(good), 1);
    assert.ok(runQuestionQa(good, ctx).ok, JSON.stringify(runQuestionQa(good, ctx).findings));
    const bad = "Here's the link. What's your budget for the website?";
    assert.ok(!runQuestionQa(bad, ctx).ok);
  });

  test("a question-carrying move gets no companion: the others wait for a later turn", () => {
    const c = coordinateInterests([plan(WEB, "ASK"), plan(SUB, "ASK", { dealValueGbp: 5 })], { channel: "email" });
    assert.equal(c.companion, null);
    assert.equal(c.waiting.length, 1);
    assert.match(interestStrategyLines(c).join("\n"), /comes later/);
  });

  test("lead-level rules bind every interest: a hand-over or an opt-out wins", () => {
    const esc = coordinateInterests([plan(WEB, "ESCALATE"), plan(SUB, "CTA_SIGNUP")], { channel: "email" });
    assert.equal(esc.rule, "LEAD_LEVEL");
    assert.equal(esc.nba.next_action, "ESCALATE");
    const out = coordinateInterests([plan(WEB, "NO_ACTION", { nba: { rule: "R2_NEGATIVE_OR_SUPPRESSED" } }), plan(SUB, "CTA_SIGNUP")], { channel: "email" });
    assert.equal(out.nba.next_action, "NO_ACTION");
  });

  test("one disqualified interest does not stop the other; all disqualified does", () => {
    const one = coordinateInterests([plan(WEB, "DISQUALIFY"), plan(SUB, "ASK")], { channel: "email" });
    assert.equal(one.primary.serviceId, SUB);
    const all = coordinateInterests([plan(WEB, "DISQUALIFY"), plan(SUB, "DISQUALIFY")], { channel: "email" });
    assert.equal(all.rule, "ALL_DISQUALIFIED");
  });
});

describe("closing one keeps the other open", () => {
  test("a won interest is never the move; the open one is", () => {
    const c = coordinateInterests(
      [plan(SUB, "CTA_SIGNUP", { opportunity: { id: "o1", stage: "CLOSED", outcome: "WON", value: 1200 } }), plan(WEB, "ASK")],
      { channel: "email" },
    );
    assert.equal(c.primary.serviceId, WEB);
    assert.equal(c.nba.next_action, "ASK");
  });

  test("every interest closed: nothing is pursued", () => {
    const c = coordinateInterests(
      [plan(SUB, "CTA_SIGNUP", { opportunity: { id: "o1", stage: "CLOSED", outcome: "WON", value: 1 } }), plan(WEB, "ASK", { opportunity: { id: "o2", stage: "CLOSED", outcome: "LOST", value: 1 } })],
      { channel: "email" },
    );
    assert.equal(c.rule, "ALL_CLOSED");
    assert.equal(c.nba.next_action, "NO_ACTION");
  });

  test("follow-up continues while any interest is open, and stops on opt-out or when all are closed", () => {
    assert.equal(followUpContinues([{ outcome: "WON" }, { outcome: "OPEN" }], { optedOut: false }), true);
    assert.equal(followUpContinues([{ outcome: "WON" }, { outcome: "LOST" }], { optedOut: false }), false);
    assert.equal(followUpContinues([{ outcome: "OPEN" }], { optedOut: true }), false);
  });

  test("the lead's status is projected only when the last interest closes (as close_opportunity, 0144)", () => {
    assert.equal(leadStatusAfterClose([{ outcome: "WON" }, { outcome: "OPEN" }], "QUALIFIED"), "QUALIFIED");
    assert.equal(leadStatusAfterClose([{ outcome: "WON" }, { outcome: "LOST" }], "QUALIFIED"), "WON");
    assert.equal(leadStatusAfterClose([{ outcome: "LOST" }, { outcome: "LOST" }], "QUALIFIED"), "LOST");
    const sql = readFileSync(path.join(process.cwd(), "supabase", "migrations", "0144_lead_interests.sql"), "utf8");
    assert.match(sql, /if v_open > 0 then/);
    assert.match(sql, /'open_remaining', v_open/);
  });

  test("a funnel event lands on the right interest's opportunity", () => {
    const open = [
      { id: "web", serviceId: WEB, stage: "QUALIFIED", closeTarget: "BOOK", goal: "B_BOOK_MEETING", createdAt: "a" },
      { id: "sub", serviceId: SUB, stage: "OPEN", closeTarget: "TRIAL", goal: "D_SIGNUP_TRIAL", createdAt: "b" },
    ];
    assert.equal(pickInterestForEvent(open, "CHECKOUT_SENT", { leadServiceId: WEB })?.id, "sub");
    assert.equal(pickInterestForEvent(open, "MEETING_BOOKED", { leadServiceId: WEB })?.id, "web");
    assert.equal(pickInterestForEvent(open, "QUALIFIED", { leadServiceId: WEB })?.id, "web");
    assert.equal(pickInterestForEvent(open, "QUALIFIED", { serviceId: SUB })?.id, "sub");
    assert.equal(pickInterestForEvent([open[0]], "CHECKOUT_SENT", {}), null, "one opportunity keeps the legacy rule");
  });

  test("each offer's checkout link: configured, then by product name, never another offer's", () => {
    const links = [
      { id: "growth-monthly", label: "Growth monthly", product: "Growth subscription" },
      { id: "audit", label: "One-off audit", product: "SEO audit" },
    ];
    assert.equal(checkoutLinkForService(links, { id: SUB, name: "Growth subscription", offerProfile: {} })?.id, "growth-monthly");
    assert.equal(checkoutLinkForService(links, { id: SEO, name: "SEO audit", offerProfile: {} })?.id, "audit");
    assert.equal(checkoutLinkForService(links, { id: WEB, name: "Website rebuild", offerProfile: {} }), null);
    assert.equal(checkoutLinkForService(links, { id: WEB, name: "Website rebuild", offerProfile: { checkoutLinkId: "audit" } })?.id, "audit");
    assert.equal(serviceForCheckoutLink(links, SERVICES.map((s) => ({ ...s, offerProfile: {} })), "growth-monthly"), SUB);
  });

  test("the lead page summary reads the lead across its interests", () => {
    assert.equal(
      summariseInterests([{ offer: "Growth subscription", outcome: "WON", stage: "CLOSED" }, { offer: "Website rebuild", outcome: "OPEN", stage: "QUALIFIED" }]),
      "2 interests: 1 open (Website rebuild), 1 won. Follow-up continues for the open interest.",
    );
  });
});

/* ======================================================= golden conversations */

const DIR = path.join(process.cwd(), "tests", "golden-conversations", "multi-interest");
const conversations = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as MultiConversation);

describe("golden conversations: several interests", () => {
  test("the corpus exists", () => assert.ok(conversations.length >= 1));

  for (const conversation of conversations) {
    test(`${conversation.id}`, () => {
      const rows = runMultiConversation(conversation);
      const table = renderMultiTable(conversation, rows);
      const asked = new Map<string, number>();
      rows.forEach((row, i) => {
        const expect = conversation.turns[i].expect;
        const c = row.coordination;
        const where = `turn ${row.turn}\n${table}`;
        if (expect.primaryService) assert.equal(c.primary.serviceName, expect.primaryService, where);
        if (expect.actionIn) assert.ok(expect.actionIn.includes(c.nba.next_action), `${c.nba.next_action} ${where}`);
        if (expect.companion !== undefined) {
          assert.deepEqual(c.companion ? { service: c.companion.serviceName, kind: c.companion.kind } : null, expect.companion, where);
        }
        if (expect.interests) assert.deepEqual([...row.interests].sort(), [...expect.interests].sort(), where);
        // One question per turn: the move's and the companion's together.
        const questions = (c.nba.question_intent ? 1 : 0) + (c.companion?.question ? 1 : 0);
        assert.ok(questions <= 1, `two questions ${where}`);
        for (const dim of expect.notAsked ?? []) assert.notEqual(row.askedDimension, dim, `${dim} asked ${where}`);
        // Shared facts are asked once at most across every interest.
        if (row.askedDimension) asked.set(row.askedDimension, (asked.get(row.askedDimension) ?? 0) + 1);
        // Every NBA still validates against the contract.
        for (const p of row.plans) nextBestActionSchema.parse(p.nba);
      });
      for (const [dim, n] of asked) if (isSharedDimension(dim as never)) assert.ok(n <= 1, `${dim} asked ${n} times\n${table}`);
      // The subscription closed by checkout, the rebuild by a booked meeting.
      const closes = rows.map((r) => `${r.coordination.primary.serviceName}:${r.coordination.nba.next_action}`);
      assert.ok(closes.some((x) => /subscription:CTA_(SIGNUP|CHECKOUT)/.test(x)), table);
      assert.ok(closes.some((x) => /rebuild:CTA_BOOK/.test(x)), table);
    });
  }
});

describe("CRM: each interest is its own deal", () => {
  const a = { id: "a", serviceId: WEB, createdAt: "2026-01-01", updatedAt: "2026-01-05" };
  const b = { id: "b", serviceId: SUB, createdAt: "2026-01-02", updatedAt: "2026-01-09" };
  test("one opportunity: the legacy single deal, unchanged", () => {
    assert.deepEqual(crmDealPlan([a], { dealOpportunityId: null, hasDeal: true }), { primaryId: "a", extraIds: [] });
  });
  test("several: the existing deal stays with its own opportunity, the new interest gets its own", () => {
    assert.deepEqual(crmDealPlan([a, b], { dealOpportunityId: null, hasDeal: true }), { primaryId: "a", extraIds: ["b"] });
    assert.deepEqual(crmDealPlan([a, b], { dealOpportunityId: "b", hasDeal: true }), { primaryId: "b", extraIds: ["a"] });
    assert.deepEqual(crmDealPlan([a, b], { dealOpportunityId: null, hasDeal: false }), { primaryId: "b", extraIds: ["a"] });
  });
});

describe("the assessment agrees with a coordinated NBA (live story R1 / S1 regression)", () => {
  const conversation = JSON.parse(
    readFileSync(path.join(process.cwd(), "tests", "golden-conversations", "multi-interest", "studio-subscription-and-rebuild.json"), "utf8"),
  ) as MultiConversation;
  // Turn 1 as written, then a FOLLOW_UP_DUE turn (nothing new from the lead), engine LIVE.
  const followUp: MultiConversation = { ...conversation, id: "follow-up-due", turns: [conversation.turns[0], { lead: "", expect: {} }] };
  const rows = runMultiConversation(followUp);

  for (const row of rows) {
    test(`turn ${row.turn}${row.lead ? "" : " (FOLLOW_UP_DUE)"}: the stored assessment validates when the move is for ${row.coordination.primary.serviceName}`, () => {
      const nba = row.coordination.nba;
      const write = {
        intent_state: row.intent.state,
        intent_score: row.intent.score,
        intent_categories: row.intent.categories,
        intent_evidence: row.intent.evidence.slice(0, 40),
        intent_contradictions: row.intent.contradictions.slice(0, 20),
        intent_confidence: row.intent.confidence,
        valid_until: row.intent.validUntil,
        ...assessmentFieldsFor(nba, row.coordination.primary.dimensions),
        nba,
        engine_version: QIE_ENGINE_VERSION,
        engine_mode: "LIVE",
        legacy_decision: null,
        trigger_event: `agent.turn:story-${row.turn}`,
      };
      const parsed = leadAssessmentWriteSchema.safeParse(write);
      assert.ok(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues));
      // The lead's own service is a meeting; the stored goal is the move's.
      assert.equal(parsed.success && parsed.data.goal, nba.current_goal);
    });
  }

  test("the first turn's move is for the other interest, so the goals really differ", () => {
    assert.equal(rows[0].coordination.primary.serviceName, "Growth subscription");
    assert.notEqual(rows[0].coordination.nba.current_goal, rows[0].plans.find((p) => p.isLeadService)!.goal.goal);
  });
});
