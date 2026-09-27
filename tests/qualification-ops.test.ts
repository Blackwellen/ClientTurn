import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { evaluateRunGate, type RunGateSnapshot } from "../src/lib/agent/policy.ts";
import {
  conversationReleasePatch,
  handoffReleasePatch,
  ownerAfterResume,
  RELEASABLE_CONVERSATION_OWNERS,
} from "../src/lib/leads/resume-release.ts";
import { operationsForCaller, operationsInDomain, serviceOperation, registryProblems } from "../src/lib/services/registry.ts";
import { callerAllowed, isWrite, requiresConfirmation } from "../src/lib/services/types.ts";
import {
  mergeQualificationPolicy,
  policyChangeProblem,
} from "../src/lib/settings/ai-selling.ts";
import {
  leadSearchIntentFilters,
  overrideIntentSchema,
  overrideNbaSchema,
  policyGetSchema,
  requalifySchema,
  setFactSchema,
  untilProblem,
} from "../src/lib/qualification-intelligence/op-schemas.ts";
import { qualificationPolicyUpdateSchema } from "../src/lib/settings/ai-selling.ts";
import {
  QUALIFICATION_AUDIT_ACTIONS,
  deriveDimensionStatus,
  dimensionBoard,
  explainQuestionValue,
  historyRow,
  manualIntentSignal,
  overrideIntent,
  overrideNextBestAction,
  parseAssessmentRow,
  qualificationStatus,
  qualificationUnknowns,
  scoreForState,
  whyThisQuestion,
  type AssessmentRow,
} from "../src/lib/qualification-intelligence/explain.ts";
import {
  NBA_VERSION,
  QIE_ENGINE_VERSION,
  intentSignalWriteSchema,
  leadAssessmentWriteSchema,
  nextBestActionSchema,
  type NextBestAction,
  type QualificationFact,
  type QualificationPolicy,
} from "../src/lib/qualification-intelligence/types.ts";

/**
 * Qualification intelligence registry operations (design §B.19, §21), and the
 * business-story failure H3b that lives in the same ops layer.
 */

const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/* ------------------------------------------------------------------ H3b */

describe("H3b: resuming follow-up after an agent hand-off gives the conversation back", () => {
  const base: RunGateSnapshot = {
    agentMode: "AUTO_REPLY",
    aiAssistEnabled: true,
    subscriptionActive: true,
    businessStatus: "active",
    channel: "sms",
    allowedChannels: ["sms"],
    conversationOwner: "AI_ACTIVE",
    lifecycle: "ENGAGED",
    leadOptedOut: false,
    humanTakeover: false,
    isTestLead: false,
  };

  test("after the agent hands over, the run gate refuses (the state H3b starts from)", () => {
    const handedOver = { ...base, conversationOwner: "HANDED_OVER" as const, humanTakeover: true };
    const verdict = evaluateRunGate(handedOver);
    assert.equal(verdict.allowed === false && verdict.code, "HUMAN_OWNS_CONVERSATION");
  });

  test("resume releases a HANDED_OVER or HUMAN_ACTIVE conversation to the agent", () => {
    for (const owner of RELEASABLE_CONVERSATION_OWNERS) {
      const after = ownerAfterResume(owner);
      assert.equal(after, "AI_ACTIVE");
      // lead.resume_follow_up already clears human_takeover on the lead.
      const verdict = evaluateRunGate({ ...base, conversationOwner: after, humanTakeover: false });
      assert.equal(verdict.allowed, true, `owner ${owner} still blocks the agent after resume`);
    }
  });

  test("a closed conversation is not reopened, and an AI conversation is untouched", () => {
    assert.equal(ownerAfterResume("CLOSED"), "CLOSED");
    assert.equal(ownerAfterResume("AI_ACTIVE"), "AI_ACTIVE");
  });

  test("the release patch mirrors the manual hand-back (returnConversationToAi)", () => {
    const patch = conversationReleasePatch("2026-09-26T10:00:00.000Z", "00000000-0000-4000-8000-000000000001");
    assert.equal(patch.owner, "AI_ACTIVE");
    assert.equal(patch.state, "active");
    // The lock is cleared so the next inbound is not held behind a dead turn.
    assert.equal(patch.agent_locked_until, null);
    assert.equal(patch.owner_changed_by, "00000000-0000-4000-8000-000000000001");
  });

  test("the open hand-off is resolved, with a note saying why", () => {
    const patch = handoffReleasePatch("2026-09-26T10:00:00.000Z", null);
    assert.equal(patch.status, "RESOLVED");
    assert.match(patch.resolution_note, /resumed/i);
  });

  test("lead.resume_follow_up applies both releases, scoped to the workspace and lead", () => {
    const leads = src("src/lib/services/operations/leads.ts");
    const resume = leads.slice(leads.indexOf('defineOperation("lead.resume_follow_up"'));
    assert.match(resume, /conversationReleasePatch\(/);
    assert.match(resume, /handoffReleasePatch\(/);
    assert.match(resume, /from\("conversations"\)[\s\S]*?\.in\("owner", \[\.\.\.RELEASABLE_CONVERSATION_OWNERS\]\)/);
    assert.match(resume, /from\("agent_handoffs"\)[\s\S]*?\.in\("status", \[\.\.\.OPEN_HANDOFF_STATUSES\]\)/);
    // Every write repeats the tenant filter.
    assert.ok((resume.match(/\.eq\("business_id", context\.businessId\)/g) ?? []).length >= 2);
  });
});

/* -------------------------------------------------------------- fixtures */

const LEAD = "11111111-1111-4111-8111-111111111111";
const SIGNAL = "22222222-2222-4222-8222-222222222222";
const FACT_A = "33333333-3333-4333-8333-333333333333";
const FACT_B = "44444444-4444-4444-8444-444444444444";
const SERVICE = "55555555-5555-4555-8555-555555555555";

const nbaAsk: NextBestAction = {
  current_goal: "B_BOOK_MEETING",
  intent_state: "MEDIUM",
  intent_score: 55,
  known_dimensions: [{ dimension: "USE_CASE", state: "CONFIRMED" }],
  unknown_required_dimensions: ["TIMING"],
  next_action: "ASK",
  question_intent: {
    key: "TIMING.START_WINDOW",
    dimension: "TIMING",
    purpose: "DISCOVER",
    question_id: null,
    wording_family: "timing-start",
    rendering: "When are you hoping to get started?",
  },
  reason: "Timing is the one missing detail before booking.",
  rule: "R9_ASK",
  expected_information_gain: 0.6,
  qualification_score: 48,
  qualification_completeness: 0.5,
  engine_verdict: "PENDING",
  confidence: 0.7,
  handover_reason: null,
  resume_at: null,
  suppress: false,
  model_call_required: true,
  question_value: {
    decisionRelevance: 0.9,
    informationGain: 0.7,
    salesProgression: 1,
    intentRelevance: 0.5,
    friction: 0.2,
    repetitionRisk: 0,
    prematurity: 0.1,
    pKnown: 0,
    total: 0.62,
  },
  alternatives: [{ action: "CTA_BOOK", intent: null, value: 0.3 }],
  engine_version: NBA_VERSION,
};

function row(overrides: Partial<AssessmentRow> = {}): AssessmentRow {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    lead_id: LEAD,
    intent_state: "MEDIUM",
    intent_score: 55,
    intent_categories: { EXPLICIT: 20, BEHAVIOURAL: 0, CONVERSATIONAL: 15, RECENCY: 10, CONSISTENCY: 10 },
    intent_evidence: [
      {
        signal_id: SIGNAL,
        signal_type: "PRICING_REQUEST",
        category: "EXPLICIT",
        polarity: "POSITIVE",
        decayed_strength: 0.8,
        reason: "Asked what it costs",
        observed_at: "2026-09-20T10:00:00.000Z",
      },
      { not: "an evidence item" },
    ],
    intent_contradictions: [],
    intent_confidence: "0.700",
    valid_until: "2026-10-01T00:00:00.000Z",
    goal: "B_BOOK_MEETING",
    qualification_completeness: "0.500",
    dimension_status: [
      { dimension: "USE_CASE", status: "CONFIRMED", fact_ids: [FACT_A], material: false, required: true, stale: false },
      { dimension: "TIMING", status: "UNKNOWN", fact_ids: [], material: false, required: true, stale: false },
    ],
    nba: nbaAsk,
    engine_version: QIE_ENGINE_VERSION,
    engine_mode: "LIVE",
    legacy_decision: null,
    trigger_event: "reply.classified:abc",
    created_at: "2026-09-25T10:00:00.000Z",
    ...overrides,
  };
}

function fact(overrides: Partial<QualificationFact>): QualificationFact {
  return {
    id: FACT_A,
    leadId: LEAD,
    serviceId: null,
    dimension: "COMPANY_SIZE",
    value: "40 staff",
    valueNormalised: "40",
    state: "INFERRED",
    source: "ENRICHMENT",
    sourceRef: null,
    questionId: null,
    questionIntentKey: null,
    confidence: 0.9,
    observedAt: "2026-09-20T10:00:00.000Z",
    validUntil: null,
    verifiedAt: null,
    setBy: null,
    supersededAt: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------- registry */

const QUALIFICATION_OPS = [
  "qualification.status",
  "qualification.unknowns",
  "qualification.explain",
  "qualification.intent",
  "qualification.requalify",
  "qualification.set_fact",
  "qualification.override_intent",
  "qualification.override_nba",
  "qualification.policy_get",
  "qualification.policy_update",
] as const;

describe("qualification.* operations: declarations, roles and callers", () => {
  test("every operation is declared, once, and the catalogue stays sound", () => {
    assert.deepEqual(registryProblems(), []);
    const names = operationsInDomain("qualification").map((op) => op.name as string);
    for (const name of QUALIFICATION_OPS) assert.ok(names.includes(name), `${name} is missing`);
  });

  test("the fixture NBA is a valid contract object", () => {
    assert.equal(nextBestActionSchema.safeParse(nbaAsk).success, true);
  });

  test("reads are open to every role; writes need a member, the policy an admin", () => {
    for (const name of QUALIFICATION_OPS) {
      const op = serviceOperation(name)!;
      if (!isWrite(op.risk)) assert.equal(op.minimumRole, "viewer", name);
    }
    for (const name of ["qualification.requalify", "qualification.set_fact", "qualification.override_intent", "qualification.override_nba"]) {
      assert.equal(serviceOperation(name)!.minimumRole, "member", name);
    }
    assert.equal(serviceOperation("qualification.policy_update")!.minimumRole, "admin");
  });

  test("an unattended agent can reach none of the writes", () => {
    for (const name of QUALIFICATION_OPS) {
      const op = serviceOperation(name)!;
      if (isWrite(op.risk)) assert.equal(callerAllowed(op, "AGENT"), false, `${name} is reachable by an agent`);
    }
  });

  test("Copilot may re-run, correct a fact and narrow the policy, but not override intent or the next action", () => {
    const copilot = operationsForCaller("COPILOT").map((op) => op.name as string);
    for (const name of ["qualification.status", "qualification.unknowns", "qualification.explain", "qualification.intent", "qualification.requalify", "qualification.set_fact", "qualification.policy_get", "qualification.policy_update"]) {
      assert.ok(copilot.includes(name), `${name} should be a Copilot tool`);
    }
    assert.equal(copilot.includes("qualification.override_intent"), false);
    assert.equal(copilot.includes("qualification.override_nba"), false);
    for (const name of ["qualification.override_intent", "qualification.override_nba"]) {
      const op = serviceOperation(name)!;
      assert.equal(callerAllowed(op, "UI"), true);
      assert.equal(callerAllowed(op, "MCP"), true);
    }
  });

  test("none of them needs a confirmation dialog, and scopes separate lead from workspace", () => {
    for (const name of QUALIFICATION_OPS) {
      const op = serviceOperation(name)!;
      assert.equal(requiresConfirmation(op.risk), false, name);
      const expected = name.startsWith("qualification.policy")
        ? isWrite(op.risk) ? "business:write" : "business:read"
        : isWrite(op.risk) ? "leads:write" : "leads:read";
      assert.equal(op.scope, expected, name);
    }
  });
});

/* ------------------------------------------------------- narrow-only rule */

describe("qualification.policy_update: Copilot and connected callers may only narrow (CD-18)", () => {
  const before: QualificationPolicy = {
    forbiddenQuestionIntents: ["AUTHORITY.DECISION_MAKER"],
    requiredDimensions: ["USE_CASE"],
    maxAutonomy: "SUGGEST_ONLY",
    thresholds: { booking: { minIntentState: "MEDIUM" } },
    goal: "B_BOOK_MEETING",
  };
  const change = (patch: QualificationPolicy, caller: "UI" | "COPILOT" | "MCP" | "API" = "COPILOT", scope = "*") =>
    policyChangeProblem({ scope, before, after: mergeQualificationPolicy(before, patch, "merge"), caller });

  test("\"Don't ask about budget for these leads\" (add a forbidden intent) is allowed", () => {
    assert.equal(change({ forbiddenQuestionIntents: ["AUTHORITY.DECISION_MAKER", "BUDGET.RANGE"] }), null);
  });

  test("\"Require number of employees before MSP booking\" (a required dimension on the offer) is allowed", () => {
    const scope = `service:${SERVICE}`;
    const problem = policyChangeProblem({
      scope,
      before: {},
      after: mergeQualificationPolicy({}, { requiredDimensions: ["COMPANY_SIZE"] }, "merge"),
      caller: "COPILOT",
    });
    assert.equal(problem, null);
  });

  test("adding an escalation condition or a disqualifier, or lowering autonomy, is allowed", () => {
    assert.equal(change({ escalationConditions: ["LOW_CONFIDENCE"] }), null);
    assert.equal(change({ maxAutonomy: "OFF" }), null);
    assert.equal(
      change({
        disqualifiers: [
          { dimension: "COMPANY_SIZE", when: { op: "lt", dimension: "COMPANY_SIZE", value: 5 }, reason: "Too small to serve", reviewInstead: true, suppress: false },
        ],
      }),
      null,
    );
  });

  test("anything that widens is refused outside Settings", () => {
    assert.equal(change({ forbiddenQuestionIntents: [] })?.code, "FORBIDDEN_SCOPE", "an empty list clears the forbidden questions");
    const removed = policyChangeProblem({ scope: "*", before, after: { ...before, forbiddenQuestionIntents: undefined }, caller: "COPILOT" });
    assert.equal(removed?.code, "FORBIDDEN_SCOPE");
    assert.equal(change({ maxAutonomy: "AUTO_REPLY" })?.code, "FORBIDDEN_SCOPE");
    assert.equal(change({ thresholds: { booking: { minIntentState: "LOW" } } })?.code, "FORBIDDEN_SCOPE");
    assert.equal(change({ goal: "C_DIRECT_SALE" })?.code, "FORBIDDEN_SCOPE");
    assert.equal(change({ humanCloserAboveValue: 1000 })?.code, "FORBIDDEN_SCOPE");
  });

  test("MCP and the API are held to the same rule; only the app may widen", () => {
    for (const caller of ["MCP", "API"] as const) {
      assert.equal(change({ maxAutonomy: "AUTO_REPLY" }, caller)?.code, "FORBIDDEN_SCOPE", caller);
    }
    assert.equal(change({ maxAutonomy: "AUTO_REPLY" }, "UI"), null);
    assert.equal(change({ goal: "C_DIRECT_SALE" }, "UI"), null);
  });

  test("the engine mode is changed only from the app, and only for the whole workspace", () => {
    assert.equal(change({ engineMode: "LIVE" }, "COPILOT")?.code, "FORBIDDEN_SCOPE");
    assert.equal(change({ engineMode: "LIVE" }, "UI"), null);
    assert.equal(change({ engineMode: "LIVE" }, "UI", `service:${SERVICE}`)?.code, "INVALID_INPUT");
  });

  test("merge keeps what it is not given; replace is exactly what is given; empty lists are absent", () => {
    const merged = mergeQualificationPolicy(before, { escalationConditions: ["HIGH_VALUE"] }, "merge");
    assert.deepEqual(merged.requiredDimensions, ["USE_CASE"]);
    const replaced = mergeQualificationPolicy(before, { escalationConditions: ["HIGH_VALUE"] }, "replace");
    assert.deepEqual(Object.keys(replaced), ["escalationConditions"]);
    assert.equal("forbiddenQuestionIntents" in mergeQualificationPolicy(before, { forbiddenQuestionIntents: [] }, "merge"), false);
  });

  test("the handler applies the rule with the real caller, after the subscription check, before any write", () => {
    const ops = src("src/lib/services/operations/qualification.ts");
    const handler = ops.slice(ops.indexOf('defineOperation("qualification.policy_update"'));
    const entitled = handler.indexOf("await entitledOrFail(");
    const rule = handler.indexOf("policyChangeProblem({ scope, before, after, caller: context.caller })");
    const write = handler.indexOf('.from("workspace_sales_overrides").upsert(');
    assert.ok(entitled > 0 && rule > entitled && write > rule, "order: entitlement, narrow rule, write");
    assert.match(ops, /new ServiceError\("PLAN_LIMIT", error\.message\)/);
  });
});

/* -------------------------------------------------------------- audit */

describe("qualification writes are audited with their before and after", () => {
  test("every lead-level write is part of the lead's qualification history", () => {
    for (const name of QUALIFICATION_AUDIT_ACTIONS) {
      const op = serviceOperation(name)!;
      assert.ok(op, `${name} is not an operation`);
      assert.equal(isWrite(op.risk), true, `${name} is not a write, so it would not be audited`);
      assert.equal(op.entityType, "lead", `${name} must audit against the lead`);
    }
  });

  test("the runtime writes the audit row for every write, with caller, before and after", () => {
    const runtime = src("src/lib/services/runtime.ts");
    assert.match(runtime, /isWrite\(declaration\.risk\)\s*\?\s*await recordAudit/);
    assert.match(runtime, /before: outcome\.before \?\? null/);
    assert.match(runtime, /caller: context\.caller/);
  });

  test("each write handler reports what changed", () => {
    const ops = src("src/lib/services/operations/qualification.ts");
    for (const name of ["qualification.set_fact", "qualification.override_intent", "qualification.override_nba", "qualification.policy_update"]) {
      const body = ops.slice(ops.indexOf(`defineOperation("${name}"`));
      const next = body.indexOf("defineOperation(", 10);
      const own = next > 0 ? body.slice(0, next) : body;
      assert.match(own, /before:/, `${name} reports no before`);
      assert.match(own, /after:/, `${name} reports no after`);
    }
  });

  test("overrides store assessments only through record_lead_assessment()", () => {
    const ops = src("src/lib/services/operations/qualification.ts");
    assert.match(ops, /\.rpc\("record_lead_assessment"/);
    assert.equal(/from\("lead_assessments"\)\s*\.(insert|update|upsert|delete)/.test(ops), false);
  });

  test("an audit row reads back as a history line", () => {
    const line = historyRow({
      id: "a1",
      action: "qualification.set_fact",
      created_at: "2026-09-26T09:00:00.000Z",
      actor: "Priya Shah",
      metadata: { caller: "COPILOT", after: { fact_action: "SET", dimension: "TIMING", value: "March", reason: "Said on a call" } },
    });
    assert.equal(line.label, "Fact changed");
    assert.equal(line.caller, "COPILOT");
    assert.match(line.detail ?? "", /March/);
    assert.match(line.detail ?? "", /Said on a call/);
  });
});

/* ------------------------------------------------------------ arguments */

describe("operation arguments", () => {
  test("every schema is describable to an MCP client as a JSON object", () => {
    for (const schema of [requalifySchema, setFactSchema, overrideIntentSchema, overrideNbaSchema, policyGetSchema, qualificationPolicyUpdateSchema, z.object(leadSearchIntentFilters)]) {
      const json = z.toJSONSchema(schema, { io: "input" }) as { type?: string };
      assert.equal(json.type, "object");
    }
  });

  test("set_fact needs a fact id to confirm or reject, and a dimension and value to set", () => {
    assert.equal(setFactSchema.safeParse({ leadId: LEAD, action: "CONFIRM" }).success, false);
    assert.equal(setFactSchema.safeParse({ leadId: LEAD, action: "CONFIRM", factId: FACT_A }).success, true);
    assert.equal(setFactSchema.safeParse({ leadId: LEAD, action: "SET", dimension: "TIMING" }).success, false);
    assert.equal(setFactSchema.safeParse({ leadId: LEAD, action: "SET", dimension: "TIMING", value: "March" }).success, true);
    assert.equal(setFactSchema.safeParse({ leadId: LEAD, action: "SET", dimension: "NOT_A_DIMENSION", value: "x" }).success, false);
  });

  test("an NBA override needs a reason, cannot plan a question, and WAIT needs a date", () => {
    assert.equal(overrideNbaSchema.safeParse({ leadId: LEAD, action: "ASK", reason: "because" }).success, false);
    assert.equal(overrideNbaSchema.safeParse({ leadId: LEAD, action: "ESCALATE", reason: "" }).success, false);
    assert.equal(overrideNbaSchema.safeParse({ leadId: LEAD, action: "WAIT", reason: "On holiday" }).success, false);
    assert.equal(
      overrideNbaSchema.safeParse({ leadId: LEAD, action: "WAIT", reason: "On holiday", until: "2026-10-10T09:00:00.000Z" }).success,
      true,
    );
  });

  test("an override's end date is in the future and within a year", () => {
    const now = new Date("2026-09-26T00:00:00.000Z");
    assert.equal(untilProblem(undefined, now), null);
    assert.equal(untilProblem("2026-10-01T00:00:00.000Z", now), null);
    assert.match(untilProblem("2026-09-01T00:00:00.000Z", now) ?? "", /future/);
    assert.match(untilProblem("2028-01-01T00:00:00.000Z", now) ?? "", /within/);
  });

  test("lead.search takes the intent filters", () => {
    const leads = src("src/lib/services/operations/leads.ts");
    assert.match(leads, /\.\.\.leadSearchIntentFilters/);
    assert.match(leads, /strongIntentIncomplete[\s\S]*STRONG_INTENT_STATES[\s\S]*INCOMPLETE_BELOW/);
    const schema = z.object(leadSearchIntentFilters);
    assert.equal(schema.safeParse({ intentStateIn: ["HIGH"], maxCompleteness: 0.5, nextActionIn: ["ASK"] }).success, true);
    assert.equal(schema.safeParse({ intentStateIn: ["VERY_HIGH"] }).success, false);
  });
});

/* ----------------------------------------------------- reads and overrides */

describe("reading an assessment and explaining it", () => {
  test("a stored row reads defensively: a malformed evidence item is dropped, the rest kept", () => {
    const view = parseAssessmentRow(row())!;
    assert.equal(view.evidence.length, 1);
    assert.equal(view.completeness, 0.5);
    assert.equal(view.nba?.next_action, "ASK");
    assert.equal(parseAssessmentRow(row({ nba: { broken: true } }))!.nba, null);
    assert.equal(parseAssessmentRow(row({ intent_state: "SOMETHING" })), null);
  });

  test("\"Why this question?\" reads the NBA's value terms in words", () => {
    const why = whyThisQuestion(nbaAsk)!;
    assert.equal(why.intentKey, "TIMING.START_WINDOW");
    assert.equal(why.terms.length, 8);
    assert.equal(why.terms.find((t) => t.term === "friction")?.direction, "-");
    assert.match(why.summary, /0\.25/);
    assert.equal(whyThisQuestion({ ...nbaAsk, next_action: "CTA_BOOK", question_intent: null, question_value: null }), null);
    assert.deepEqual(explainQuestionValue(null), []);
  });

  test("\"Is this lead qualified?\" is the rules' verdict, whatever the intent", () => {
    const view = parseAssessmentRow(row({ intent_state: "HIGH", intent_score: 85 }))!;
    const pending = qualificationStatus("PENDING", view);
    assert.equal(pending.qualified, false);
    assert.match(pending.headline, /Not decided yet/);
    assert.equal(qualificationStatus("QUALIFIED", null).assessed, false);
  });

  test("\"What do we still need?\" lists required unknowns, conflicts and what to verify", () => {
    const view = parseAssessmentRow(row())!;
    const unknowns = qualificationUnknowns(view);
    assert.deepEqual(unknowns.required.map((u) => u.dimension), ["TIMING"]);
  });

  test("without an assessment, conflicts and confirmations come from live facts", () => {
    const derived = deriveDimensionStatus([
      fact({ id: FACT_A, value: "40 staff", valueNormalised: "40" }),
      fact({ id: FACT_B, value: "12 staff", valueNormalised: "12", source: "REPLY" }),
      fact({ id: "77777777-7777-4777-8777-777777777777", dimension: "TIMING", value: "March", valueNormalised: "march", state: "CONFIRMED", source: "ANSWER" }),
      fact({ id: "88888888-8888-4888-8888-888888888888", dimension: "BUDGET", value: "£5k", state: "REJECTED" }),
    ]);
    const by = Object.fromEntries(derived.map((d) => [d.dimension, d.status]));
    assert.equal(by.COMPANY_SIZE, "CONFLICTING");
    assert.equal(by.TIMING, "CONFIRMED");
    assert.equal(by.BUDGET, undefined, "a rejected value is not live");
    const board = dimensionBoard(derived, []);
    assert.equal(board.CONFLICTING.length, 1);
  });
});

describe("overrides produce valid, consistent assessments", () => {
  const view = parseAssessmentRow(row())!;

  test("marking a lead not interested stops pursuit and caps the score", () => {
    const result = overrideIntent(view, { state: "NEGATIVE", reason: "Told us on the phone", until: null, triggerEvent: "manual.intent_override:t1" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.nba.next_action, "NO_ACTION");
    assert.equal(result.value.nba.question_intent, null);
    assert.ok(result.value.intent_score <= 10);
    assert.equal(leadAssessmentWriteSchema.safeParse(result.value).success, true);
  });

  test("not now waits until the stated date", () => {
    const until = "2027-01-15T09:00:00.000Z";
    const result = overrideIntent(view, { state: "NOT_NOW", reason: "Back after the new year", until, triggerEvent: "manual.intent_override:t2" });
    assert.equal(result.ok && result.value.nba.next_action, "WAIT");
    assert.equal(result.ok && result.value.nba.resume_at, until);
    assert.equal(result.ok && result.value.valid_until, until);
  });

  test("an intent state keeps its score inside its band", () => {
    assert.equal(scoreForState("HIGH", 40), 70);
    assert.equal(scoreForState("NOT_NOW", 80), 25);
    assert.equal(scoreForState("MEDIUM", 90), 69);
  });

  test("an NBA override to escalate carries a hand-over reason and needs no model call", () => {
    const result = overrideNextBestAction(view, { action: "ESCALATE", reason: "Big account", until: null, handoverReason: null, triggerEvent: "manual.nba_override:t3" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.nba.handover_reason, "POLICY");
    assert.equal(result.value.nba.model_call_required, false);
    assert.equal(result.value.nba.alternatives[0]?.action, "ASK", "what the engine chose is kept as an alternative");
  });

  test("a not-interested lead cannot be overridden into a pitch", () => {
    const negative = parseAssessmentRow(row({ intent_state: "NEGATIVE", intent_score: 5, nba: { ...nbaAsk, intent_state: "NEGATIVE", intent_score: 5, next_action: "NO_ACTION", question_intent: null, question_value: null, rule: "R2_NEGATIVE_OR_SUPPRESSED" } }))!;
    const result = overrideNextBestAction(negative, { action: "CTA_BOOK", reason: "Try anyway", until: null, handoverReason: null, triggerEvent: "manual.nba_override:t4" });
    assert.equal(result.ok, false);
  });

  test("intent states with a signal type are also recorded as evidence", () => {
    const now = new Date("2026-09-26T09:00:00.000Z");
    const notNow = manualIntentSignal({ leadId: LEAD, state: "NOT_NOW", reason: "Budget frozen", until: "2026-12-01T00:00:00.000Z", now, correlationId: "c1" })!;
    assert.equal(intentSignalWriteSchema.safeParse(notNow).success, true);
    assert.equal(notNow.signal_type, "NOT_NOW");
    assert.equal(notNow.source, "MANUAL");
    assert.equal(notNow.resume_at, "2026-12-01T00:00:00.000Z");
    assert.equal(manualIntentSignal({ leadId: LEAD, state: "BOOKING_READY", reason: "Asked to meet", until: null, now, correlationId: "c2" })?.signal_type, "BOOKING_REQUEST");
    assert.equal(manualIntentSignal({ leadId: LEAD, state: "MEDIUM", reason: "x x x", until: null, now, correlationId: "c3" }), null);
  });

  test("facts and reassessments go through the assessment service, never around it", () => {
    const ops = src("src/lib/services/operations/qualification.ts");
    const setFact = ops.slice(ops.indexOf('defineOperation("qualification.set_fact"'), ops.indexOf("/* ------------------------------------------------------------- overrides */"));
    assert.match(setFact, /confirmQualificationFact\(\{/);
    assert.match(setFact, /rejectQualificationFact\(context\.businessId, lead\.id, fact\.id, context\.userId\)/);
    assert.equal(/from\("lead_qualification_facts"\)/.test(ops), false, "no raw fact writes in the ops file");
    assert.match(ops, /await writeIntentSignals\(context\.businessId, \[signal\]\)/);
    assert.match(ops, /await enqueueReassessment\(context\.businessId, leadId, triggerEvent\)/);
    // A direct score would bypass the engine that writes the assessment.
    assert.equal(/scoreLead\(/.test(ops), false);
  });
});
