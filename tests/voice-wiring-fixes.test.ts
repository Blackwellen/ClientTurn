/**
 * The voice + calendar wiring harness (scripts/voice-e2e, 2026-09-29/30)
 * found links that were each tested in isolation and broken end to end.
 * These are the pure parts of the fixes: no database, no provider, no spend.
 *
 * - A spoken answer to a configured question reaches the deterministic
 *   matcher (matchSpokenAnswer), never the model's guess.
 * - The call's question-plan key names the configured question it answers
 *   (questionForPlanKey), so the answer is stored where the engine reads it.
 * - A choice question with no options (seeded before the editor required
 *   two) can still be answered: before, every lead stayed PENDING.
 * - A lead the booking gate would refuse is never offered times: the call
 *   hears the booking-off line and the call-back step instead.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matchAnswer, matchSpokenAnswer, type QuestionRecord } from "../src/lib/qualification/next-question.ts";
import { evaluateQualification } from "../src/lib/qualification/engine.ts";
import { questionForPlanKey, type ConfiguredQuestionLite } from "../src/lib/voice/question-plan.ts";
import { runVoiceTool, type PortOutcome, type PriorToolResult, type ToolCallRow, type ToolPermissions, type VoiceToolPorts, type VoiceToolResponse } from "../src/lib/voice/tools/core.ts";

function q(id: string, extra: Partial<QuestionRecord> = {}): QuestionRecord {
  return { id, questionText: id, position: 0, responseType: "text", required: false, serviceId: null, options: [], ...extra };
}

const BUDGET = q("budget", {
  responseType: "single_choice",
  options: [
    { value: "under_5k", label: "Under £5,000" },
    { value: "5k_15k", label: "£5,000 to £15,000" },
    { value: "over_15k", label: "Over £15,000" },
  ],
});
const TIMING = q("timing", {
  responseType: "timing",
  options: [
    { value: "asap", label: "As soon as possible" },
    { value: "month", label: "Within a month" },
    { value: "quarter", label: "In 1 to 3 months" },
  ],
});
const OWNER = q("owner", { responseType: "yes_no" });

describe("a spoken answer is matched deterministically", () => {
  test("an option named inside a sentence is matched, currency and commas ignored", () => {
    assert.equal(matchSpokenAnswer(BUDGET, "under five grand, so under £5,000").value, "under_5k");
    assert.equal(matchSpokenAnswer(BUDGET, "somewhere in the £5,000 to £15,000 bracket").value, "5k_15k");
    assert.equal(matchSpokenAnswer(TIMING, "ideally within a month please").value, "month");
  });

  test("the text answer is kept either way", () => {
    assert.equal(matchSpokenAnswer(BUDGET, "under £5,000").text, "under £5,000");
    assert.equal(matchSpokenAnswer(BUDGET, "not sure yet").text, "not sure yet");
  });

  test("nothing matched, or two options named equally, is unmatched (REVIEW), never a guess", () => {
    assert.equal(matchSpokenAnswer(BUDGET, "about ten to fifteen grand").value, null);
    assert.equal(matchSpokenAnswer(TIMING, "not sure, maybe next year").value, null);
    const two = q("two", { responseType: "single_choice", options: [{ value: "a", label: "Design" }, { value: "b", label: "Build" }] });
    assert.equal(matchSpokenAnswer(two, "design and build").value, null);
  });

  test("the longer, more specific option wins when one label contains another", () => {
    const nested = q("n", { responseType: "single_choice", options: [{ value: "site", label: "Website" }, { value: "shop", label: "Website with a shop" }] });
    assert.equal(matchSpokenAnswer(nested, "a website with a shop, really").value, "shop");
  });

  test("yes / no: a reply that starts plainly is matched; anything else is not", () => {
    assert.equal(matchSpokenAnswer(OWNER, "Yes, it's my decision").value, "yes");
    assert.equal(matchSpokenAnswer(OWNER, "No, my partner decides").value, "no");
    assert.equal(matchSpokenAnswer(OWNER, "Me and my business partner decide together").value, null);
  });

  test("a spoken answer is never looser than a typed one where the typed one matches", () => {
    assert.deepEqual(matchSpokenAnswer(BUDGET, "2"), matchAnswer(BUDGET, "2"));
    assert.equal(matchSpokenAnswer(BUDGET, "2").value, "5k_15k");
  });
});

describe("a choice question with no options configured", () => {
  const unconfigured = q("soon", { responseType: "timing", required: true });

  test("the reply is the answer, as for a text question", () => {
    assert.deepEqual(matchAnswer(unconfigured, "next month"), { value: "next month", text: "next month" });
  });

  test("so the engine can finish instead of holding every lead PENDING / REVIEW", () => {
    const out = evaluateQualification({
      questions: [{ id: "soon", responseType: "timing", required: true, serviceId: null, options: [] }],
      answers: [{ questionId: "soon", answerValue: matchAnswer(unconfigured, "next month").value, answerText: "next month" }],
      rules: [],
      serviceId: "svc",
      serviceIsActive: true,
      postcode: null,
      allowedPostcodePrefixes: [],
      blockedPostcodePrefixes: [],
    } as never);
    assert.notEqual(out.result, "REVIEW");
  });
});

describe("the call's plan key names the configured question", () => {
  const SERVICE = "svc-1";
  const configured: (ConfiguredQuestionLite & { tag: string })[] = [
    { id: "11111111-1111-4111-8111-111111111111", questionText: "Budget?", required: true, serviceId: null, position: 2, dimensionKey: "BUDGET", tag: "workspace budget" },
    { id: "22222222-2222-4222-8222-222222222222", questionText: "Budget for this service?", required: true, serviceId: SERVICE, position: 5, dimensionKey: "budget", tag: "service budget" },
    { id: "33333333-3333-4333-8333-333333333333", questionText: "Other service's budget?", required: true, serviceId: "svc-2", position: 0, dimensionKey: "BUDGET", tag: "other service" },
    { id: "44444444-4444-4444-8444-444444444444", questionText: "Anything else?", required: false, serviceId: null, position: 9, dimensionKey: null, tag: "unmapped" },
  ];

  test("a dimension key: the lead's own service's question first, then the workspace one", () => {
    assert.equal(questionForPlanKey("BUDGET", configured, SERVICE)?.tag, "service budget");
    assert.equal(questionForPlanKey("budget", configured, null)?.tag, "workspace budget");
    assert.equal(questionForPlanKey("BUDGET", configured, "svc-3")?.tag, "workspace budget");
  });

  test("a Q.<id> key names that question, only if it applies to the lead", () => {
    assert.equal(questionForPlanKey("Q.44444444-4444-4444-8444-444444444444", configured, SERVICE)?.tag, "unmapped");
    assert.equal(questionForPlanKey("Q.33333333-3333-4333-8333-333333333333", configured, SERVICE), null);
  });

  test("a catalogue dimension the workspace never configured has no question (it stays a fact)", () => {
    assert.equal(questionForPlanKey("AUTHORITY", configured, SERVICE), null);
  });
});

/* ------------------------------------------------ not bookable yet: no times */

const NOW = new Date("2026-09-30T10:00:00.000Z");

function row(): ToolCallRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    business_id: "11111111-1111-4111-8111-111111111111",
    lead_id: "22222222-2222-4222-8222-222222222222",
    route: "QUALIFICATION",
    state: "IN_CONVERSATION",
    direction: "OUTBOUND",
    consent_basis: "FORM_CONSENT_TO_CALL",
    answered_at: new Date(NOW.getTime() - 60_000).toISOString(),
    started_at: new Date(NOW.getTime() - 70_000).toISOString(),
    created_at: new Date(NOW.getTime() - 90_000).toISOString(),
  };
}

function ports(outcome: PortOutcome): VoiceToolPorts {
  const p: ToolPermissions = { aiEnabled: true, book: true, quote: false, sendQuote: false, checkout: false, transferMode: "ON_REQUEST", transferNumberSet: false, transferHuman: false, aiCall: true, hasEmail: true, smsLawful: true, timezone: "Europe/London" };
  const rows = new Map<string, { status: string; response: VoiceToolResponse | null; tool: string }>();
  return {
    now: () => NOW,
    loadCall: async () => row(),
    claim: async ({ toolCallId, tool }) => {
      if (rows.has(toolCallId)) return { kind: "IN_PROGRESS" };
      rows.set(toolCallId, { status: "IN_PROGRESS", response: null, tool });
      return { kind: "NEW" };
    },
    complete: async ({ toolCallId, status, response }) => {
      const r = rows.get(toolCallId)!;
      r.status = status;
      r.response = response;
    },
    priorResults: async (): Promise<PriorToolResult[]> => [],
    permissions: async () => p,
    execute: async () => outcome,
  };
}

describe("a lead the booking gate would refuse is never offered times", () => {
  test("check_availability NOT_READY_TO_BOOK: the booking-off sentence and the call-back step, no times", async () => {
    const r = await runVoiceTool(ports({ ok: false, code: "NOT_READY_TO_BOOK", say: "", operation: "booking.availability" }), {
      name: "check_availability",
      toolCallId: "t1",
      callId: "c",
      providerCallId: null,
      args: { day_part: "morning" },
    });
    const body = r.body as VoiceToolResponse;
    assert.equal(body.ok, false);
    assert.equal(body.code, "NOT_READY_TO_BOOK");
    assert.equal(body.say, "A colleague will arrange a time with you.");
    assert.match(String(body.data.next), /Never offer times/);
    assert.equal(body.data.slots, undefined);
  });
});
