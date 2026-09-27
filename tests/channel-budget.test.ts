import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_CONVERSATION_SMS_DAILY_CEILING,
  DEFAULT_FOLLOW_UP_CHANNEL_STRATEGY,
  DEFAULT_FOLLOW_UP_SMS_SEGMENTS_PER_LEAD,
  chooseStepChannel,
  clampSmsCap,
  conversationSmsReserve,
  isEngagedLead,
  parseFollowUpChannelStrategy,
  perLeadSmsCapAllows,
  smsCapKindFor,
  type StepChannelInput,
} from "../src/lib/follow-up/channel-strategy.ts";

/**
 * Channel budgeting (economics.md §3): the first touch stays instant, later
 * automated steps prefer email through the customer's mailbox (free to us),
 * and SMS is capped per lead.
 */

const base: StepChannelInput = {
  strategy: "sms_first_then_email",
  configured: "sms",
  stepIndex: 0,
  bookingReminder: false,
  engaged: false,
  available: { sms: true, email: true },
  leadHas: { sms: true, email: true },
  smsAffordable: true,
};

describe("default strategy: SMS for the first message, email after", () => {
  test("is the default, and unknown values fall back to it", () => {
    assert.equal(DEFAULT_FOLLOW_UP_CHANNEL_STRATEGY, "sms_first_then_email");
    assert.equal(parseFollowUpChannelStrategy("nonsense"), "sms_first_then_email");
    assert.equal(parseFollowUpChannelStrategy(null), "sms_first_then_email");
    assert.equal(parseFollowUpChannelStrategy("sms_every_step"), "sms_every_step");
  });

  test("the first touch is SMS when the lead gave a mobile and SMS is permitted", () => {
    assert.equal(chooseStepChannel(base), "sms");
  });

  test("the first touch is email when there is no mobile, rather than nothing", () => {
    assert.equal(chooseStepChannel({ ...base, leadHas: { sms: false, email: true } }), "email");
  });

  test("the first touch is email when SMS is not permitted or not connected", () => {
    assert.equal(chooseStepChannel({ ...base, available: { sms: false, email: true } }), "email");
  });

  test("the first touch is email when the SMS budget has no room", () => {
    assert.equal(chooseStepChannel({ ...base, smsAffordable: false }), "email");
  });

  test("later steps prefer email when the lead has an address and a mailbox is connected", () => {
    for (const stepIndex of [1, 2, 3, 4]) {
      assert.equal(chooseStepChannel({ ...base, stepIndex }), "email", `step ${stepIndex}`);
    }
  });

  test("later steps fall back to SMS only when email is not available", () => {
    assert.equal(chooseStepChannel({ ...base, stepIndex: 2, leadHas: { sms: true, email: false } }), "sms");
    assert.equal(chooseStepChannel({ ...base, stepIndex: 2, available: { sms: true, email: false } }), "sms");
  });

  test("with neither channel usable the rule has no opinion (the configured channel and fallback decide)", () => {
    assert.equal(
      chooseStepChannel({ ...base, stepIndex: 1, leadHas: { sms: false, email: false } }),
      null,
    );
    assert.equal(
      chooseStepChannel({ ...base, stepIndex: 1, leadHas: { sms: true, email: false }, smsAffordable: false }),
      null,
    );
  });

  test("a step the customer set to email or WhatsApp keeps its channel", () => {
    assert.equal(chooseStepChannel({ ...base, configured: "email" }), null);
    assert.equal(chooseStepChannel({ ...base, configured: "whatsapp", stepIndex: 2 }), null);
  });

  test("booking reminders keep their configured channel", () => {
    assert.equal(chooseStepChannel({ ...base, bookingReminder: true, stepIndex: 1 }), null);
  });
});

describe("owner rule: conversion wins over cost", () => {
  test("a lead who replied, or with intent MEDIUM or above, is engaged", () => {
    assert.equal(isEngagedLead({ hasReplied: true, intentState: null }), true);
    for (const state of ["MEDIUM", "HIGH", "BOOKING_READY", "PURCHASE_READY"]) {
      assert.equal(isEngagedLead({ hasReplied: false, intentState: state }), true, state);
    }
    for (const state of ["NO_DETECTED_INTENT", "LOW", "EXPLORATORY", "NOT_NOW", "NEGATIVE", null]) {
      assert.equal(isEngagedLead({ hasReplied: false, intentState: state }), false, String(state));
    }
  });

  test("an engaged lead's steps are never re-routed off SMS", () => {
    for (const stepIndex of [0, 1, 2, 3, 4]) {
      assert.equal(chooseStepChannel({ ...base, engaged: true, stepIndex }), null, `step ${stepIndex}`);
    }
  });

  test("an engaged lead's automated SMS is not budgeted per lead", () => {
    assert.equal(smsCapKindFor({ origin: "automation", bookingReminder: false, engaged: true }), null);
  });

  test("some SMS is kept back for live conversations when first texts run the allowance low", () => {
    assert.equal(conversationSmsReserve({ plan: "trial", allowance: 8 }), 4);
    assert.equal(conversationSmsReserve({ plan: "starter", allowance: 200 }), 20);
    assert.equal(conversationSmsReserve({ plan: "pro", allowance: 1000 }), 100);
    assert.equal(conversationSmsReserve({ plan: "starter", allowance: 0 }), 0);
  });

  test("an AI reply refused on cost is handed to a person, never left unanswered", () => {
    const store = readFileSync("src/lib/jobs/handlers/send-store.ts", "utf8");
    // The per-lead abuse ceiling: straight to a person.
    assert.match(
      store,
      /gate\.reasonCode === "BLOCKED_COST_BUDGET" &&\s*atZero === null &&\s*\(message\.origin === "agent" \|\| message\.origin === "agent_handover"\)[\s\S]*?takeover: true/,
    );
    // Allowance and credit used up (no overage since 2026-09-27): by email
    // where possible, otherwise to a person (billing/at-zero.ts, at-zero.test.ts).
    assert.match(store, /gate\.reasonCode === "BLOCKED_MONTHLY_LIMIT"\s*\?\s*await handleAllowanceExhausted\(/);
    assert.match(store, /reason: "sms_allowance_exhausted",[\s\S]*?takeover: true/);
  });

  test("the agent ceiling counts a rolling 24 hours, not the life of the lead", () => {
    const limits = readFileSync("src/lib/billing/limits-service.ts", "utf8");
    assert.match(limits, /query\.in\("origin", \["agent", "agent_handover"\]\)\.gte\("created_at", since\)/);
  });

  test("the worker and the gate both skip budgeting for an engaged lead", () => {
    const advance = readFileSync("src/lib/jobs/handlers/automation-advance.ts", "utf8");
    assert.match(advance, /!\(await leadIsEngaged\(business\.businessId, lead\.id\)\)/);
    const limits = readFileSync("src/lib/billing/limits-service.ts", "utf8");
    assert.match(limits, /kind === "follow_up" && \(await leadIsEngaged\(input\.businessId, input\.leadId\)\)/);
  });
});

describe("option: SMS for every step", () => {
  test("leaves every step on its configured channel", () => {
    for (const stepIndex of [0, 1, 2, 3, 4]) {
      assert.equal(chooseStepChannel({ ...base, strategy: "sms_every_step", stepIndex }), null);
    }
  });
});

describe("per-lead SMS caps", () => {
  test("safe defaults", () => {
    assert.equal(DEFAULT_FOLLOW_UP_SMS_SEGMENTS_PER_LEAD, 3);
    assert.equal(DEFAULT_CONVERSATION_SMS_DAILY_CEILING, 40);
    assert.equal(clampSmsCap(undefined, "followUp"), 3);
    assert.equal(clampSmsCap(undefined, "conversation"), 40);
  });

  test("caps are clamped to their bounds", () => {
    assert.equal(clampSmsCap(0, "followUp"), 1);
    assert.equal(clampSmsCap(500, "followUp"), 20);
    // The AI reply ceiling cannot be set low enough to cut a real conversation.
    assert.equal(clampSmsCap(1, "conversation"), 20);
    assert.equal(clampSmsCap(1_000, "conversation"), 200);
    assert.equal(clampSmsCap(Number.NaN, "followUp"), 3);
  });

  test("a send is allowed only while it stays within the cap", () => {
    assert.equal(perLeadSmsCapAllows({ usedSegments: 2, units: 1, cap: 3 }), true);
    assert.equal(perLeadSmsCapAllows({ usedSegments: 3, units: 1, cap: 3 }), false);
    assert.equal(perLeadSmsCapAllows({ usedSegments: 2, units: 2, cap: 3 }), false);
  });

  test("automated follow-up to an unengaged lead is capped; agent replies only meet the abuse ceiling", () => {
    assert.equal(smsCapKindFor({ origin: "automation", bookingReminder: false }), "follow_up");
    assert.equal(smsCapKindFor({ origin: "agent", bookingReminder: false }), "conversation");
    assert.equal(smsCapKindFor({ origin: "agent_handover", bookingReminder: false }), "conversation");
  });

  test("booking reminders, manual replies, campaigns and system sends are not capped per lead", () => {
    assert.equal(smsCapKindFor({ origin: "automation", bookingReminder: true }), null);
    assert.equal(smsCapKindFor({ origin: "manual", bookingReminder: false }), null);
    assert.equal(smsCapKindFor({ origin: "campaign", bookingReminder: false }), null);
    assert.equal(smsCapKindFor({ origin: "system", bookingReminder: false }), null);
  });
});

describe("wiring", () => {
  const limits = readFileSync("src/lib/billing/limits-service.ts", "utf8");
  const store = readFileSync("src/lib/jobs/handlers/send-store.ts", "utf8");
  const advance = readFileSync("src/lib/jobs/handlers/automation-advance.ts", "utf8");

  test("the billing send gate enforces the per-lead SMS cap at send time", () => {
    assert.match(limits, /if \(channel === "sms" && input\.leadId\) \{\s*const capped = await perLeadSmsGate/);
    assert.match(store, /leadId: message\.leadId,\s*messageId: message\.id,\s*sendKey: message\.sendKey,/);
  });

  test("the gate counts SMS units as sent: normalised to GSM-7", () => {
    assert.match(limits, /countSmsSegments\(normaliseForSms\(body\)\)/);
  });

  test("a per-lead cap refusal does not stop the sequence (later steps go by email)", () => {
    assert.match(
      store,
      /message\.origin === "automation" &&\s*gate\.reasonCode !== "BLOCKED_COST_BUDGET" &&\s*gate\.reasonCode !== "BLOCKED_MONTHLY_LIMIT"/,
    );
  });

  test("the follow-up worker applies the workspace strategy when it queues a step", () => {
    assert.match(advance, /context\.channelStrategy === "sms_first_then_email"/);
    assert.match(advance, /chooseStepChannel\(/);
    assert.match(advance, /followUpSmsAffordable\(/);
  });

  test("an SMS step sent as email carries a subject", () => {
    assert.match(advance, /step\.subject\?\.trim\(\) \|\| SMS_STEP_EMAIL_SUBJECT/);
  });

  test("stop conditions are untouched: reply, booked and opt-out still stop the run", () => {
    const scheduler = readFileSync("src/lib/automation/scheduler.ts", "utf8");
    assert.match(scheduler, /if \(lead\.hasReplied && !options\.bookingReminder\) return "replied";/);
    assert.match(scheduler, /if \(lead\.status === "BOOKED" && !options\.bookingReminder\) return "booked";/);
    assert.match(scheduler, /if \(lead\.optedOut\) return "opted_out";/);
  });
});

describe("email budgeting", () => {
  test("follow-up and campaign email go through the customer's mailbox, never Resend", () => {
    const provider = readFileSync("src/lib/messaging/email-provider.ts", "utf8");
    assert.match(provider, /import \{ sendEmail \} from "@\/lib\/email\/smtp";/);
    assert.doesNotMatch(provider, /resend/i);
    const smtp = readFileSync("src/lib/email/smtp.ts", "utf8");
    assert.doesNotMatch(smtp, /api\.resend\.com/);
  });

  test("system notification email through Resend is capped per workspace per day", () => {
    const notify = readFileSync("src/lib/jobs/handlers/notification-send.ts", "utf8");
    assert.match(notify, /await consumeSystemEmail\(\{ businessId: payload\.businessId, plan \}\)/);
  });
});
