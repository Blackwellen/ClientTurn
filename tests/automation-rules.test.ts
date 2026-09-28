import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AUTOMATION_EVENT_TYPES } from "../src/lib/automation/event-types.ts";
import {
  ACTION_META,
  ACTION_TYPES,
  EVERY_TIME_DAILY_CAP,
  TRIGGERS,
  actionFitsTrigger,
  conditionsMatch,
  contactsCustomer,
  describeRule,
  frequencyAllows,
  outcomeFromRefusal,
  planAction,
  ruleInputSchema,
  triggerMeta,
  type ActionGate,
  type RuleAction,
  type RuleSubjectRefs,
} from "../src/lib/automation/rules.ts";
import { CALL_STATE_EVENT, outcomeEvents, withVoiceAutomationEvents } from "../src/lib/automation/voice-events.ts";
import { derivedFromAutomationEvent, derivedFromDomainEvent } from "../src/lib/automation/derived-events.ts";
import { serviceOperation } from "../src/lib/services/registry.ts";
import { callerAllowed } from "../src/lib/services/types.ts";
import { AI_PERMISSIONS, type AiPermission } from "../src/lib/commercial/ai-permissions.ts";

/**
 * Automation rules (gap map §45): the trigger and action catalogue, the gates
 * every action passes before it may run, and the voice and derived triggers.
 * No database, no provider: the rule runner's decisions are pure.
 */

const LEAD = "11111111-1111-4111-8111-111111111111";
const QUOTE = "22222222-2222-4222-8222-222222222222";
const OPP = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";

const allOn = Object.fromEntries(AI_PERMISSIONS.map((p) => [p, true])) as Record<AiPermission, boolean>;

function gate(patch: Partial<ActionGate> = {}): ActionGate {
  return {
    authorRole: "admin",
    standingConfirmation: true,
    aiPermissions: allOn,
    capabilities: {
      voice_enabled: true,
      quote_builder_enabled: true,
      quote_approval_enabled: true,
      esign_enabled: true,
      invoicing_enabled: true,
      direct_close_enabled: true,
    },
    maintenance: null,
    bookingLink: "https://book.example.com/acme",
    checkoutLinks: [{ id: "starter", url: "https://pay.example.com/x?ct_ref=abc", label: "Starter", priceText: "£49 a month" }],
    mergeValues: { first_name: "Sam", business_name: "Acme Studio", booking_link: "https://book.example.com/acme" },
    stageFor: { QUOTED: "PROPOSAL", BOOKED: null },
    ...patch,
  };
}

const subject: RuleSubjectRefs = { leadId: LEAD, quoteId: QUOTE, invoiceId: null, opportunityId: OPP };

function sample(type: (typeof ACTION_TYPES)[number]): RuleAction {
  switch (type) {
    case "place_ai_call":
      return { type, route: "QUALIFICATION" };
    case "schedule_call":
      return { type, route: "QUALIFICATION", delayMinutes: 30 };
    case "send_message":
      return { type, channel: "sms", body: "Hi {{first_name}}" };
    case "book_meeting":
      return { type, channel: "sms", body: "Pick a time: {{booking_link}}" };
    case "create_quote":
      return { type, itemId: "website-build", quantity: 1 };
    case "send_payment_link":
      return { type, checkoutLinkId: "starter", channel: "sms" };
    case "change_stage":
      return { type, semantic: "QUOTED" };
    case "add_tag":
      return { type, tag: "HOT" };
    case "start_nurture":
      return { type, campaignId: CAMPAIGN };
    case "notify_team":
      return { type, title: "Minutes low", body: "" };
    default:
      return { type } as RuleAction;
  }
}

describe("the catalogue", () => {
  test("every offered trigger is a real automation event type", () => {
    for (const trigger of TRIGGERS) {
      assert.ok((AUTOMATION_EVENT_TYPES as readonly string[]).includes(trigger.type), trigger.type);
    }
  });

  test("the §45 triggers are all offered", () => {
    for (const type of [
      "call.requested", "intent.threshold_exceeded", "voice.lead_eligible", "call.started", "call.answered", "call.missed",
      "call.voicemail", "call.qualified", "booking.completed", "quote.requested", "quote.created", "quote.approved",
      "quote.sent", "quote.viewed", "quote.accepted", "quote.expired", "signature.completed", "invoice.created",
      "invoice.paid", "payment.direct_sale", "human.requested", "objection.detected", "reactivation.succeeded",
      "voice.budget_threshold", "usage.exhausted",
    ]) {
      assert.ok(triggerMeta(type), `${type} is offered`);
    }
  });

  test("every action runs a registered operation that admits the AUTOMATION caller", () => {
    for (const type of ACTION_TYPES) {
      const declaration = serviceOperation(ACTION_META[type].operation);
      assert.ok(declaration, `${type}: ${ACTION_META[type].operation} is registered`);
      assert.ok(callerAllowed(declaration, "AUTOMATION"), `${type}: ${declaration.name} admits AUTOMATION`);
    }
  });

  test("an automation never reaches money-moving, destructive or bulk operations", () => {
    for (const type of ACTION_TYPES) {
      const risk = serviceOperation(ACTION_META[type].operation)!.risk;
      assert.ok(!["FINANCIAL", "DESTRUCTIVE", "RESTRICTED", "BULK_EXTERNAL"].includes(risk), `${type} is ${risk}`);
    }
  });

  test("placing a call is voice.request_call, gated by the AI call permission and AI calling being on", () => {
    assert.equal(ACTION_META.place_ai_call.operation, "voice.request_call");
    assert.equal(ACTION_META.place_ai_call.aiPermission, "call");
    assert.deepEqual(ACTION_META.place_ai_call.capabilities, ["voice_enabled"]);
    assert.equal(ACTION_META.schedule_call.operation, "voice.request_call");
  });
});

describe("planAction: every refusal is a recorded reason", () => {
  test("every action runs when everything is permitted", () => {
    for (const type of ACTION_TYPES) {
      const plan = planAction(sample(type), subject, gate());
      assert.equal(plan.kind, "RUN", `${type}: ${plan.kind === "SKIP" ? plan.reason : ""}`);
    }
  });

  test("the AI 'call' permission off skips a call, with a reason naming the switch", () => {
    const plan = planAction(sample("place_ai_call"), subject, gate({ aiPermissions: { ...allOn, call: false } }));
    assert.equal(plan.kind, "SKIP");
    assert.equal(plan.kind === "SKIP" && plan.code, "AI_PERMISSION");
    assert.match(plan.kind === "SKIP" ? plan.reason : "", /What the AI may do/);
  });

  test("AI calling off (entitlement) skips a call", () => {
    const plan = planAction(sample("place_ai_call"), subject, gate({ capabilities: { voice_enabled: false } }));
    assert.equal(plan.kind === "SKIP" && plan.code, "CAPABILITY");
  });

  test("maintenance pauses every action", () => {
    for (const type of ACTION_TYPES) {
      const plan = planAction(sample(type), subject, gate({ maintenance: "ClientTurn is in maintenance until 10:00." }));
      assert.equal(plan.kind === "SKIP" && plan.code, "MAINTENANCE", type);
    }
  });

  test("a rule whose enabler left does nothing", () => {
    const plan = planAction(sample("add_tag"), subject, gate({ authorRole: null }));
    assert.equal(plan.kind === "SKIP" && plan.code, "AUTHOR_GONE");
  });

  test("the enabler's live role must still meet the operation's", () => {
    // invoice.create_from_quote needs admin; a demoted member cannot run it.
    const plan = planAction(sample("create_invoice"), subject, gate({ authorRole: "member" }));
    assert.equal(plan.kind === "SKIP" && plan.code, "ROLE");
    const viewer = planAction(sample("add_tag"), subject, gate({ authorRole: "viewer" }));
    assert.equal(viewer.kind === "SKIP" && viewer.code, "ROLE");
  });

  test("an action that contacts a customer needs the standing confirmation, and carries it", () => {
    for (const type of ACTION_TYPES.filter(contactsCustomer)) {
      const refused = planAction(sample(type), subject, gate({ standingConfirmation: false }));
      assert.equal(refused.kind === "SKIP" && refused.code, "NOT_CONFIRMED", type);
      const allowed = planAction(sample(type), subject, gate());
      assert.equal(allowed.kind === "RUN" && allowed.confirmed, true, type);
    }
    // A tag is not contact, so it never claims a confirmation.
    const tag = planAction(sample("add_tag"), subject, gate({ standingConfirmation: false }));
    assert.equal(tag.kind === "RUN" && tag.confirmed, false);
  });

  test("an event with no lead or quote skips the actions that need one", () => {
    const none: RuleSubjectRefs = { leadId: null, quoteId: null, invoiceId: null, opportunityId: null };
    assert.equal((planAction(sample("send_message"), none, gate()) as { code?: string }).code, "NO_LEAD");
    assert.equal((planAction(sample("send_quote"), none, gate()) as { code?: string }).code, "NO_QUOTE");
    assert.equal((planAction(sample("create_quote"), none, gate()) as { code?: string }).code, "NO_OPPORTUNITY");
  });

  test("book_meeting needs a booking link and never picks a time", () => {
    const plan = planAction(sample("book_meeting"), subject, gate());
    assert.equal(plan.kind, "RUN");
    assert.equal(plan.kind === "RUN" && plan.operation, "message.send");
    assert.match(plan.kind === "RUN" ? String(plan.args.body) : "", /https:\/\/book\.example\.com\/acme/);
    const none = planAction(sample("book_meeting"), subject, gate({ bookingLink: null }));
    assert.equal(none.kind === "SKIP" && none.code, "NO_BOOKING_LINK");
  });

  test("a payment link is only an approved one, with its approved wording and tracked URL", () => {
    const plan = planAction(sample("send_payment_link"), subject, gate());
    assert.equal(plan.kind === "RUN" && plan.args.body, "Hi Sam, here is the secure payment link for Starter (£49 a month): https://pay.example.com/x?ct_ref=abc");
    const gone = planAction(sample("send_payment_link"), subject, gate({ checkoutLinks: [] }));
    assert.equal(gone.kind === "SKIP" && gone.code, "NO_CHECKOUT_LINK");
  });

  test("merge fields are rendered into a message", () => {
    const plan = planAction(sample("send_message"), subject, gate());
    assert.equal(plan.kind === "RUN" && plan.args.body, "Hi Sam");
  });

  test("moving the deal uses the pipeline mapping's stage, and skips when there is none", () => {
    const plan = planAction(sample("change_stage"), subject, gate());
    assert.deepEqual(plan.kind === "RUN" && plan.args, { opportunityId: OPP, stage: "PROPOSAL" });
    const none = planAction({ type: "change_stage", semantic: "BOOKED" }, subject, gate());
    assert.equal(none.kind === "SKIP" && none.code, "NO_STAGE");
  });

  test("a scheduled call carries its delay; an immediate one does not", () => {
    const later = planAction(sample("schedule_call"), subject, gate());
    assert.equal(later.kind === "RUN" && later.delayMinutes, 30);
    const now = planAction(sample("place_ai_call"), subject, gate());
    assert.equal(now.kind === "RUN" && now.delayMinutes, 0);
  });

  test("a runtime refusal is SKIPPED; a retryable failure is FAILED", () => {
    for (const code of ["FORBIDDEN_ROLE", "PLAN_LIMIT", "POLICY_BLOCKED", "CONFLICT", "NEEDS_CONFIRMATION", "NOT_FOUND"]) {
      assert.equal(outcomeFromRefusal(code), "SKIPPED", code);
    }
    assert.equal(outcomeFromRefusal("UNAVAILABLE"), "FAILED");
    assert.equal(outcomeFromRefusal("PROVIDER_FAILED"), "FAILED");
  });
});

describe("the rule schema", () => {
  const base = { name: "Call requesters", trigger: "voice.lead_eligible", actions: [{ type: "place_ai_call" }], enabled: false };

  test("a valid rule parses with safe defaults (off, once a day)", () => {
    const parsed = ruleInputSchema.parse(base);
    assert.equal(parsed.enabled, false);
    assert.equal(parsed.frequency, "ONCE_PER_DAY");
    assert.deepEqual(parsed.conditions, { leadStatusIn: [], minValue: null });
  });

  test("turning on a rule that contacts customers needs the acknowledgement", () => {
    assert.equal(ruleInputSchema.safeParse({ ...base, enabled: true }).success, false);
    assert.equal(ruleInputSchema.safeParse({ ...base, enabled: true, acknowledgeExternal: true }).success, true);
    assert.equal(ruleInputSchema.safeParse({ ...base, enabled: true, actions: [{ type: "add_tag", tag: "HOT" }] }).success, true);
  });

  test("a workspace-level trigger only takes a team notification", () => {
    const budget = triggerMeta("voice.budget_threshold")!;
    for (const type of ACTION_TYPES) {
      assert.equal(actionFitsTrigger(type, budget), type === "notify_team", type);
    }
    assert.equal(ruleInputSchema.safeParse({ ...base, trigger: "usage.exhausted" }).success, false);
    assert.equal(ruleInputSchema.safeParse({ ...base, trigger: "usage.exhausted", actions: [{ type: "notify_team", title: "Out of minutes" }] }).success, true);
  });

  test("at most five actions, and an unknown trigger is refused", () => {
    assert.equal(ruleInputSchema.safeParse({ ...base, actions: Array(6).fill({ type: "update_score" }) }).success, false);
    assert.equal(ruleInputSchema.safeParse({ ...base, trigger: "automation.step_due" }).success, false);
  });

  test("a tag is upper-cased and held to the lead_tags pattern", () => {
    const parsed = ruleInputSchema.parse({ ...base, actions: [{ type: "add_tag", tag: "hot_lead" }] });
    assert.deepEqual(parsed.actions[0], { type: "add_tag", tag: "HOT_LEAD" });
    assert.equal(ruleInputSchema.safeParse({ ...base, actions: [{ type: "add_tag", tag: "1bad" }] }).success, false);
  });

  test("describeRule reads as a sentence", () => {
    assert.equal(describeRule({ trigger: "quote.accepted", actions: [{ type: "create_invoice" }, { type: "notify_team" }] }), "When a quote is accepted: raise the invoices, then notify your team.");
  });
});

describe("conditions and frequency", () => {
  test("an intent threshold compares the event's score", () => {
    const conditions = { leadStatusIn: [], minValue: 70 };
    assert.equal(conditionsMatch(conditions, "intent.threshold_exceeded", { leadStatus: "NEW", payload: { score: 82 } }).ok, true);
    assert.equal(conditionsMatch(conditions, "intent.threshold_exceeded", { leadStatus: "NEW", payload: { score: 40 } }).ok, false);
  });

  test("a lead status condition", () => {
    const conditions = { leadStatusIn: ["QUALIFIED" as const], minValue: null };
    assert.equal(conditionsMatch(conditions, "quote.sent", { leadStatus: "QUALIFIED", payload: {} }).ok, true);
    const miss = conditionsMatch(conditions, "quote.sent", { leadStatus: "NEW", payload: {} });
    assert.equal(miss.ok, false);
  });

  test("once per lead, once a day, and a hard cap for every time", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    assert.equal(frequencyAllows("ONCE_PER_LEAD", [], now).ok, true);
    assert.equal(frequencyAllows("ONCE_PER_LEAD", [weekAgo], now).ok, false);
    assert.equal(frequencyAllows("ONCE_PER_DAY", [weekAgo], now).ok, true);
    assert.equal(frequencyAllows("ONCE_PER_DAY", [hourAgo], now).ok, false);
    assert.equal(frequencyAllows("EVERY_TIME", Array(EVERY_TIME_DAILY_CAP - 1).fill(hourAgo), now).ok, true);
    assert.equal(frequencyAllows("EVERY_TIME", Array(EVERY_TIME_DAILY_CAP).fill(hourAgo), now).ok, false);
  });
});

describe("voice triggers, read off the voice repo", () => {
  test("call states map to their triggers", () => {
    assert.equal(CALL_STATE_EVENT.DIALLING, "call.started");
    assert.equal(CALL_STATE_EVENT.ANSWERED, "call.answered");
    assert.equal(CALL_STATE_EVENT.NO_ANSWER, "call.missed");
    assert.equal(CALL_STATE_EVENT.BUSY, "call.missed");
    assert.equal(CALL_STATE_EVENT.VOICEMAIL, "call.voicemail");
  });

  test("a call that moved the lead forward qualifies it; an opt-out never does", () => {
    assert.deepEqual(outcomeEvents({ disposition: "MEETING_BOOKED", facts: {}, voiceOptOut: false }), ["call.qualified"]);
    assert.deepEqual(outcomeEvents({ disposition: "CONVERSATION", facts: { budget: "10k" }, voiceOptOut: false }), ["call.qualified"]);
    assert.deepEqual(outcomeEvents({ disposition: "CONVERSATION", facts: {}, voiceOptOut: false }), []);
    assert.deepEqual(outcomeEvents({ disposition: "QUOTE_REQUESTED", facts: {}, voiceOptOut: true }), ["quote.requested"]);
    assert.deepEqual(outcomeEvents({ disposition: "TRANSFERRED_TO_HUMAN", facts: {}, voiceOptOut: false }), ["human.requested"]);
  });

  test("the wrapped repo emits after each successful write, and not on a refused one", async () => {
    const emitted: string[] = [];
    const repo = {
      async transitionCall(callId: string, _from: readonly never[], patch: { state?: string }) {
        return callId === "refused" ? null : { id: callId, business_id: "b1", lead_id: LEAD, route: "QUALIFICATION", state: patch.state };
      },
      async audit(_entry: unknown) {},
      async saveOutcome(_input: unknown) {},
      async saveObjections(_input: unknown) {},
      async other() {
        return "untouched";
      },
    };
    const wrapped = withVoiceAutomationEvents(repo, async (input) => {
      emitted.push(input.eventType);
    });
    await wrapped.transitionCall("c1", [], { state: "ANSWERED" });
    await wrapped.transitionCall("refused", [], { state: "ANSWERED" });
    await wrapped.transitionCall("c1", [], { state: "IN_CONVERSATION" });
    await wrapped.audit({ businessId: "b1", action: "voice.call_queued", entityId: "c1", metadata: { lead_id: LEAD, route: "QUALIFICATION" } });
    await wrapped.audit({ businessId: "b1", action: "voice.call_placed", entityId: "c1", metadata: {} });
    await wrapped.saveOutcome({ businessId: "b1", callId: "c1", leadId: LEAD, analysis: { disposition: "MEETING_BOOKED", facts: {}, voiceOptOut: false } });
    await wrapped.saveObjections({ businessId: "b1", leadId: LEAD, callId: "c1", objections: [{ key: "PRICE" }] });
    await wrapped.saveObjections({ businessId: "b1", leadId: LEAD, callId: "c1", objections: [] });
    assert.deepEqual(emitted, ["call.answered", "call.requested", "call.qualified", "objection.detected"]);
    assert.equal(await wrapped.other(), "untouched");
  });

  test("a failing emit never fails the voice write", async () => {
    const repo = {
      async transitionCall(callId: string, _from?: unknown, _patch?: unknown) {
        return { id: callId, business_id: "b1", lead_id: LEAD };
      },
      async audit(_entry: unknown) {},
      async saveOutcome(_input: unknown) {},
      async saveObjections(_input: unknown) {},
    };
    const wrapped = withVoiceAutomationEvents(repo, async () => {
      throw new Error("database down");
    });
    const row = await wrapped.transitionCall("c1", [], { state: "DIALLING" });
    assert.equal(row?.id, "c1");
  });
});

describe("derived triggers", () => {
  test("an intent change carries its score as intent.threshold_exceeded", () => {
    const out = derivedFromDomainEvent({ type: "lead.intent_changed", subject_type: "lead", subject_id: LEAD, payload: { intent_score: 81, intent_state: "HIGH" } });
    assert.equal(out[0]?.eventType, "intent.threshold_exceeded");
    assert.equal(out[0]?.payload.score, 81);
    assert.equal(out[0]?.leadId, LEAD);
  });

  test("an objection in a reply is objection.detected; other replies are nothing", () => {
    const out = derivedFromDomainEvent({ type: "reply.classified", subject_type: "message", subject_id: "m1", payload: { lead_id: LEAD, classification: "OBJECTION" } });
    assert.deepEqual(out.map((e) => e.eventType), ["objection.detected"]);
    assert.deepEqual(derivedFromDomainEvent({ type: "reply.classified", subject_type: "message", subject_id: "m1", payload: { classification: "POSITIVE_INTEREST" } }), []);
  });

  test("a hand-over the lead asked for is human.requested; other hand-overs are not", () => {
    assert.deepEqual(derivedFromAutomationEvent({ eventType: "lead.human_takeover", leadId: LEAD, payload: { reason: "HUMAN_REQUESTED" } }).map((e) => e.eventType), ["human.requested"]);
    assert.deepEqual(derivedFromAutomationEvent({ eventType: "lead.human_takeover", leadId: LEAD, payload: { reason: "COMPLAINT" } }), []);
  });
});

describe("emission sites (additive, at the source)", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

  test("voice: the server repo is wrapped, and minute thresholds emit", () => {
    assert.match(read("src/lib/voice/server-deps.ts"), /repo: voiceRepoWithAutomationEvents\(repo\)/);
    assert.match(read("src/lib/voice/minutes.ts"), /emitVoiceBudgetEvents/);
    assert.match(read("src/lib/services/operations/voice.ts"), /"voice\.lead_eligible"/);
  });

  test("quotes, invoices and payments emit their new triggers", () => {
    assert.match(read("src/lib/quotes/service-core.ts"), /effects\.emit\(businessId, "quote\.requested"/);
    assert.match(read("src/lib/invoicing/service-core.ts"), /effects\.emit\(businessId, "invoice\.created"/);
    assert.match(read("src/lib/quotes/events.ts"), /"invoice\.created": "invoice\.created"/);
    assert.match(read("src/lib/payments/store.ts"), /"payment\.direct_sale"/);
    assert.match(read("src/lib/billing/limits-service.ts"), /"usage\.exhausted"/);
  });

  test("an automation rule's message is sent as automated, bound by follow-up stop conditions", () => {
    assert.match(read("src/lib/services/operations/workspace.ts"), /origin: context\.caller === "AUTOMATION" \? "automation" : "manual"/);
  });

  test("the AUTOMATION caller is paused by maintenance (it is not SYSTEM or AGENT)", () => {
    const runtime = read("src/lib/services/runtime.ts");
    assert.match(runtime, /context\.caller !== "SYSTEM" && context\.caller !== "AGENT"\)/);
  });
});
