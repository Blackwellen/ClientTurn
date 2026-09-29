/**
 * The ICP evaluation (text agent QA, 2026-09-29). Pure: no model, no
 * database, no spend.
 *
 * 66 conversations (tests/fixtures/agent-icp-eval/cases.ts) across the ICP
 * workspaces (workspaces.ts) run through the REAL deterministic pipeline a
 * turn runs, in the orchestrator's order:
 *
 *   classifyDeterministic + detectInjectionAttempt   binding verdicts first
 *   policyOnMessage                                  hand-over / assist / discount / disclosure
 *   golden harness: interpret -> facts -> intent -> goal -> planNextBestAction
 *   buildNbaStrategyBlock                            what the model is told
 *   buildOfferCard                                   what the model may state
 *   validateResponse (+ pre-send question QA)        what may leave
 *   gradeReply                                       how it reads
 *   evaluateSendGate                                 whether and when it is sent
 *
 * The scripted model is the grader's excellent reply (written before the run)
 * and the weak replies beside it. ICP_EVAL_REPORT=1 prints the per-case table.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CASES, type IcpCase } from "./fixtures/agent-icp-eval/cases.ts";
import { WORKSPACES, type IcpWorkspace } from "./fixtures/agent-icp-eval/workspaces.ts";
import { runConversation, type GoldenConversation } from "./golden-conversations/harness.ts";
import { classifyDeterministic, detectInjectionAttempt, isBotQuestion } from "../src/lib/agent/classification.ts";
import { policyOnMessage } from "../src/lib/agent/handover-policy.ts";
import { matchObjection } from "../src/lib/sales-library/objections.ts";
import { buildNbaStrategyBlock, objectionRaisedBefore } from "../src/lib/agent/strategy.ts";
import { qaContextFromNba } from "../src/lib/agent/qi-turn.ts";
import { runQuestionQa } from "../src/lib/qualification-intelligence/qa.ts";
import { buildOfferCard } from "../src/lib/agent/offer-card.ts";
import { countQuestions, validateResponse, type ValidationFacts } from "../src/lib/agent/validate.ts";
import { gradeReply } from "../src/lib/agent/reply-grader.ts";
import { evaluateSendGate } from "../src/lib/agent/policy.ts";
import { isOptOutKeyword } from "../src/lib/messaging/types.ts";
import { isCallOnlyRequest } from "../src/lib/agent/closing.ts";
import { pickResponsePattern } from "../src/lib/sales-library/objection-responses.ts";

const NOW = new Date("2026-09-29T10:00:00.000Z");
const MIN_GRADE = 80;

function cardFor(ws: IcpWorkspace) {
  return buildOfferCard({
    businessName: ws.name,
    businessDescription: null,
    aiTone: "friendly",
    replyLength: "short",
    outreach: { tone: null, valueProposition: null, keyMessages: null, proofPoints: ws.proof.join("\n"), avoid: null, callToAction: null, claimRestrictions: null },
    playbook: { tone: null, prohibitedClaims: ws.prohibited },
    signature: null,
    services: ws.services,
    facts: [],
    now: NOW,
  });
}

function lastLead(c: IcpCase): string {
  return c.history[c.history.length - 1].lead;
}

function factsFor(c: IcpCase, ws: IcpWorkspace): ValidationFacts {
  const card = cardFor(ws);
  const checkout = c.turn?.checkoutLink ? (ws.commercial?.checkoutLinks ?? []).map((l) => l.url) : [];
  return {
    channel: c.channel,
    businessName: ws.name,
    publishedPriceText: ws.services.map((s) => s.publicPriceText).filter((p): p is string => Boolean(p)),
    confirmedSlots: c.turn?.slots ? ws.slots : [],
    bookingConfirmed: false,
    allowedUrls: [...(ws.bookingUrl ? [ws.bookingUrl] : []), ...checkout],
    serviceAreaConfirmed: false,
    prohibitedClaims: card.voice.prohibitedClaims,
    forbiddenPhrases: card.voice.forbiddenPhrases,
    commercial: ws.commercial,
    priorOutbound: c.history.map((h) => h.agent).filter((a): a is string => Boolean(a)),
    leadFirstName: null,
    approvedClaims: ws.proof,
    quote: c.turn?.quoteFigures ? { figures: c.turn.quoteFigures, vatRegistered: true, vatRatesPercent: [20], discountPercents: [] } : null,
  };
}

function conversationFor(c: IcpCase, ws: IcpWorkspace): GoldenConversation {
  return {
    id: c.id,
    archetype: ws.archetype,
    motion: ws.motion,
    channel: c.channel,
    story: c.category,
    origin: "INBOUND",
    // A free-text enquiry carries no conversion goal; a form the lead submitted does (signals.ts originSignals).
    conversionGoalType: c.viaForm ? (ws.conversionGoalType ?? null) : null,
    serviceNames: ws.services.map((s) => s.name),
    directClose: Boolean(ws.commercial?.enabled),
    manualBooking: ws.booking === "ASK_PREFERRED_TIME",
    turns: c.history.map((h) => ({
      lead: h.lead,
      expect: { actionIn: [] },
    })),
  };
}

function policyLabel(c: IcpCase, ws: IcpWorkspace): string {
  const text = lastLead(c);
  const d = policyOnMessage({
    text,
    bindingIntent: classifyDeterministic(text)?.intent ?? null,
    objectionKeys: matchObjection(text).map((m) => m.key),
    commercial: ws.commercial ? { enabled: ws.commercial.enabled, maxDiscountPercent: ws.commercial.maxDiscountPercent } : null,
    previousDiscountDemand: c.previousDiscountDemand === true,
    botQuestion: isBotQuestion(text),
  });
  // orchestrator.ts: "can you give me a call?" with a way to book is a warm
  // close (bookable call times), not a hand-over.
  if (d.kind === "HANDOVER" && d.trigger === "HUMAN_REQUESTED" && isCallOnlyRequest(text) && ws.booking !== "TEAM_FOLLOW_UP") return "CALL_CLOSE";
  if (d.kind === "HANDOVER") return `HANDOVER:${d.trigger}`;
  if (d.kind === "CLARIFY") return "CLARIFY";
  if (d.assist) return `ASSIST:${d.assist}`;
  if (d.discount) return "DISCOUNT";
  if (d.disclose) return "DISCLOSE";
  return "CONTINUE";
}

function sendDecision(c: IcpCase): string {
  const quiet = c.expect.send === "QUEUE";
  const at = quiet ? new Date("2026-09-29T21:30:00.000Z") : NOW;
  return evaluateSendGate({
    agentMode: "AUTO_REPLY",
    channel: c.channel,
    contactSuppressed: optedOut(lastLead(c)),
    hasDestination: true,
    providerHealthy: true,
    lastInboundAt: new Date(at.getTime() - (c.turn?.lastInboundHoursAgo ?? 0.05) * 3_600_000).toISOString(),
    socialConnectionState: c.channel === "linkedin" ? "REPLIED" : null,
    quietHours: { enabled: quiet, start: "21:00", end: "08:00", timezone: "Europe/London" },
    now: at,
  }).decision;
}

/** A binding opt-out phrase, or a carrier keyword (STOP) that message-inbound.ts suppresses before any turn. */
function optedOut(text: string): boolean {
  return classifyDeterministic(text)?.intent === "UNSUBSCRIBE" || isOptOutKeyword(text);
}

/**
 * The library says whether this objection's first answer uses proof (a
 * reframe) or only asks or accepts (objection-responses.ts), as the objection
 * matrix does: the grader's GROUNDED criterion applies only to the former.
 */
function proofExpected(text: string): boolean {
  const key = matchObjection(text)[0]?.key;
  if (!key) return false;
  const pattern = pickResponsePattern(key, { seenBefore: false, text });
  return !pattern.reframe.startsWith("none");
}

type Row = { id: string; ws: string; category: string; channel: string; action: string; policy: string; grade: number | null; badBlocked: string };
const report: Row[] = [];

describe("the ICP evaluation set", () => {
  test("at least 60 conversations, every ICP workspace and category, unique ids", () => {
    assert.ok(CASES.length >= 60, `${CASES.length}`);
    assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length);
    for (const ws of Object.keys(WORKSPACES)) assert.ok(CASES.filter((c) => c.ws === ws).length >= 8, ws);
    for (const cat of ["FIRST_REPLY", "QUALIFICATION", "OBJECTION", "PRICE", "BOOKING", "OPT_OUT", "HOSTILE", "OFF_TOPIC", "INJECTION", "LANGUAGE", "MULTI_INTEREST", "QUOTE_FOLLOW_UP", "REENGAGEMENT"]) {
      assert.ok(CASES.some((c) => c.category === cat), cat);
    }
  });

  for (const ws of Object.values(WORKSPACES)) {
    test(`${ws.key}: the offer card carries every approved claim and never-claim, inside its budget`, () => {
      const card = cardFor(ws);
      assert.ok(card.tokens <= card.budget, `${card.tokens}/${card.budget}`);
      assert.equal(card.hasApprovedClaims, ws.proof.length > 0);
      for (const p of ws.proof) assert.ok(card.text.includes(p), p);
      for (const p of ws.prohibited) assert.ok(card.voice.prohibitedClaims.some((x) => x.toLowerCase().includes(p.toLowerCase())), p);
    });
  }
});

for (const c of CASES) {
  const ws = WORKSPACES[c.ws];
  describe(`${c.id} (${ws.key}, ${c.category}, ${c.channel})`, () => {
    const text = lastLead(c);
    const rows = runConversation(conversationFor(c, ws));
    const row = rows[rows.length - 1];
    const facts = factsFor(c, ws);
    const policy = policyLabel(c, ws);
    // The strategy block exactly as the orchestrator builds it for an engine-LIVE turn
    // (OBJECTION_HANDLING when the lead's words carry an objection, lifecycle.ts).
    const priorLead = c.history.slice(0, -1).map((h) => h.lead);
    const block = buildNbaStrategyBlock(
      {
        mode: matchObjection(text).length ? "OBJECTION_HANDLING" : "QUALIFICATION",
        motion: ws.motion,
        archetypeKey: ws.archetype,
        channel: c.channel,
        selection: { question: null, stopReason: null, known: [] },
        latestMessage: text,
        hasApprovedInsight: ws.proof.length > 0,
        bookingAvailable: ws.booking === "SLOTS" || ws.booking === "LINK",
        manualBooking: ws.booking === "ASK_PREFERRED_TIME",
        bookingRoute: ws.booking,
        objectionSeenBefore: objectionRaisedBefore(text, priorLead),
        callRequested: policy === "CALL_CLOSE",
      },
      row.nba,
      { booking: ws.booking },
    );
    // Pre-send question QA as the orchestrator runs it (qaContextFor), with the strategy's objection flag.
    const qa = c.excellent
      ? runQuestionQa(
          c.excellent,
          qaContextFromNba({
            nba: row.nba,
            channel: c.channel,
            stage: row.stage,
            dimensions: row.dimensions,
            forbiddenIntents: row.resolved.forbiddenIntents,
            inbound: text,
            interpretation: row.interpretation,
            recentOutbound: [],
            objectionClarify: block.record.objectionClarify === true,
          }),
        )
      : null;
    const entry: Row = { id: c.id, ws: ws.key, category: c.category, channel: c.channel, action: row.action, policy, grade: null, badBlocked: "" };
    report.push(entry);
    if (process.env.ICP_EVAL_DEBUG === "1") {
      const v = c.excellent ? validateResponse(c.excellent, facts) : null;
      console.log(
        JSON.stringify({
          id: c.id,
          binding: classifyDeterministic(text)?.intent ?? null,
          policy,
          objection: matchObjection(text)[0]?.key ?? null,
          plan: `${row.action} ${row.question ?? ""} "${row.nba.question_intent?.rendering ?? ""}"`,
          known: row.known,
          intent: row.intent,
          excellent: v && !v.ok ? v.failures.map((f) => `${f.code}: ${f.detail}`) : "ok",
          qa: qa?.findings.filter((f) => f.severity === "REJECT").map((f) => `${f.code}: ${f.detail}`) ?? null,
          block: block.text.split("\n").filter((l) => l.startsWith("Move:")).join(" "),
          weak: c.bad.map((b) => {
            const r = validateResponse(b.text, facts);
            return r.ok ? "ALLOWED" : r.failures.map((f) => f.code).join(",");
          }),
        }),
      );
    }

    test("binding verdict and injection", () => {
      assert.equal(classifyDeterministic(text)?.intent ?? null, c.expect.binding);
      if (c.expect.injection !== undefined) assert.equal(detectInjectionAttempt(text) !== null, c.expect.injection);
    });

    test(`message policy: ${c.expect.policy}`, () => {
      assert.equal(policy, c.expect.policy);
    });

    if (c.expect.objection !== undefined) {
      test(`objection playbook: ${c.expect.objection}`, () => {
        assert.equal(matchObjection(text)[0]?.key ?? null, c.expect.objection);
      });
    }

    if (c.expect.actionIn) {
      test(`engine plan: ${c.expect.actionIn.join("/")}`, () => {
        assert.ok(c.expect.actionIn!.includes(row.action), `${row.action}: ${row.nba.reason}`);
      });
    }

    test("the strategy block states one move and never pressures", () => {
      assert.match(block.text, /Move: /);
      assert.equal((block.text.match(/^Move: /gm) ?? []).length, 1);
      assert.doesNotMatch(block.text, /\b(act now|last chance|limited (spots|places)|ends today|hurry)\b/i);
    });

    test(`send gate: ${c.expect.send ?? "SEND"}`, () => {
      assert.equal(sendDecision(c), c.expect.send ?? "SEND");
    });

    if (c.excellent) {
      const excellent = c.excellent;
      test("the excellent reply passes the validator, question QA and the grader", c.knownGap ? { todo: c.knownGap } : {}, () => {
        const result = validateResponse(excellent, facts);
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.ok(countQuestions(excellent) <= 1);
        assert.ok(qa === null || qa.ok, `QA: ${JSON.stringify(qa?.findings)} (plan ${row.action} ${row.question ?? ""})`);
        const grade = gradeReply(excellent, {
          channel: c.channel,
          inbound: text,
          objection: proofExpected(text),
          approvedClaims: ws.proof,
        });
        entry.grade = grade.total;
        assert.ok(grade.pass && grade.total >= MIN_GRADE, `graded ${grade.total}: ${JSON.stringify(grade.scores)}`);
      });
    } else {
      test("no model reply is composed on this turn", () => {
        // Engine LIVE: WAIT, NO_ACTION and DISQUALIFY send nothing and call no model.
        const noReply =
          optedOut(text) ||
          c.expect.binding === "WRONG_NUMBER" ||
          c.expect.binding === "JOB_APPLICATION" ||
          c.expect.binding === "SUPPLIER_OR_NON_LEAD" ||
          c.expect.policy.startsWith("HANDOVER") ||
          ["WAIT", "NO_ACTION", "DISQUALIFY", "ESCALATE"].includes(row.action);
        assert.ok(noReply, "a case with no excellent reply must be an opt-out, not a lead, a wrong number, a hand-over or a no-message plan");
      });
    }

    for (const [i, bad] of c.bad.entries()) {
      test(`weak reply ${i + 1} is blocked${bad.codes.length ? ` (${bad.codes.join(", ")})` : ""}`, c.knownGap ? { todo: c.knownGap } : {}, () => {
        const result = validateResponse(bad.text, facts);
        assert.equal(result.ok, false, `allowed: "${bad.text}"`);
        const codes = result.ok ? [] : result.failures.map((f) => f.code);
        for (const code of bad.codes) assert.ok(codes.includes(code as never), `${code} not in ${codes.join(", ")}`);
        entry.badBlocked += "x";
      });
    }
  });
}

/* ------------------------------------------------ the fixes the set found */

import { ARCHETYPES } from "../src/lib/sales-library/archetypes.ts";
import { QUESTION_INTENTS } from "../src/lib/qualification-intelligence/question-intents.ts";
import { askedDimension, matchesPlanned } from "../src/lib/qualification-intelligence/qa.ts";
import { originSignals } from "../src/lib/qualification-intelligence/signals.ts";
import { splitList } from "../src/lib/agent/offer-card.ts";
import { credentialClaimFailures } from "../src/lib/agent/validate.ts";

describe("pipeline defects the evaluation found (each fixed 2026-09-29)", () => {
  test("every library and archetype question, asked as written, is recognised as the planned question", () => {
    const misses: string[] = [];
    const check = (dimension: string, rendering: string, where: string) => {
      const planned = { key: "k", dimension: dimension as never, purpose: "DISCOVER" as const, rendering };
      if (!matchesPlanned(rendering, askedDimension(rendering), planned)) misses.push(`${where}: ${rendering}`);
    };
    for (const a of ARCHETYPES) for (const q of a.qualification) if (q.question) check(q.key, q.question, a.key);
    for (const i of QUESTION_INTENTS) for (const r of Object.values(i.renderings ?? {})) if (r) check(i.dimension, r as string, i.key);
    // Before: 32 of 472 were rejected as QA_UNPLANNED_QUESTION when asked word for word.
    assert.deepEqual(misses, []);
  });

  test("a goal picked in the Add Lead wizard is not the lead's request; a form's goal still is", () => {
    const base = { leadId: "l", serviceId: null, createdAt: "2026-09-28T15:47:13.523Z", relationshipType: "THEY_CONTACTED_US", conversionGoalType: "DIRECT_PURCHASE", optedOut: false, optedOutObservedAt: null } as const;
    const wizard = originSignals({ ...base, createdVia: "MANUAL_WIZARD" } as never, [{ id: "t", occurredAt: base.createdAt, sourceType: "MANUAL", landingUrl: null, answers: {}, ingestOutcome: "CREATED" }] as never).map((w) => w.signal_type);
    assert.deepEqual(wizard, ["INBOUND_ENQUIRY"]);
    const form = originSignals({ ...base, createdVia: "MANUAL_WIZARD" } as never, [{ id: "t", occurredAt: base.createdAt, sourceType: "AD_FORM", landingUrl: null, answers: {}, ingestOutcome: "CREATED" }] as never).map((w) => w.signal_type);
    assert.ok(form.includes("PURCHASE_REQUEST"));
  });

  test("an approved claim keeps its leading figure on the card", () => {
    assert.deepEqual(splitList("10-year workmanship guarantee\n14-day free trial, no card needed\n- Fully insured\n2) Free survey"), [
      "10-year workmanship guarantee",
      "14-day free trial, no card needed",
      "Fully insured",
      "Free survey",
    ]);
  });

  test("credential claims: a refusal, a question and a 'whether' are not claims; a changed condition is", () => {
    const approved = ["10-year workmanship guarantee on full roof replacements", "Free UK delivery on orders over £100"];
    assert.equal(credentialClaimFailures("I can't guarantee a date, sorry.", approved).length, 0);
    assert.equal(credentialClaimFailures("Is a guarantee important to you?", approved).length, 0);
    assert.equal(credentialClaimFailures("A colleague will confirm whether it integrates with Xero.", approved).length, 0);
    assert.equal(credentialClaimFailures("Delivery is free on orders over £100.", approved).length, 0);
    assert.equal(credentialClaimFailures("Delivery is free on every order.", approved).length, 1);
    assert.equal(credentialClaimFailures("You get a 5-year guarantee.", approved).length, 1);
    assert.equal(credentialClaimFailures("No problem, we're fully SOC 2 certified.", approved).length, 1);
  });

  test("validator: tax as the work is not a VAT claim; a price with pence is not a time; 10am is 10:00am", () => {
    const facts = { channel: "sms" as const, businessName: "X", publishedPriceText: ["£12.50 a month", "from £650 plus VAT"], confirmedSlots: ["Wed 30 Sep, 10:00am"], bookingConfirmed: false, allowedUrls: [], serviceAreaConfirmed: false };
    assert.equal(validateResponse("Is it the corporation tax or the tax return that's due?", facts).ok, true);
    assert.equal(validateResponse("It's £12.50 a month.", facts).ok, true);
    assert.equal(validateResponse("Year-end accounts are from £650 plus VAT.", facts).ok, true);
    assert.equal(validateResponse("I can do Wednesday at 10am.", facts).ok, true);
    assert.equal(validateResponse("That comes to £500 plus VAT.", facts).ok, false);
    assert.equal(validateResponse("I can do Wednesday at 11:00am.", facts).ok, false);
  });
});

describe("report", () => {
  test("per-case table (ICP_EVAL_REPORT=1)", () => {
    if (process.env.ICP_EVAL_REPORT !== "1") return;
    const lines = report.map((r) => `| ${r.id} | ${r.ws} | ${r.category} | ${r.channel} | ${r.policy} | ${r.action} | ${r.grade ?? "-"} | ${r.badBlocked.length} |`);
    console.log(["| Case | Workspace | Category | Channel | Policy | Plan | Grade | Weak blocked |", "|---|---|---|---|---|---|---|---|", ...lines].join("\n"));
  });
});
