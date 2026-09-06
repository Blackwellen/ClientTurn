import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  audienceChecklist,
  buildAudienceBreakdowns,
  estimateMessages,
  evaluateReactivationEligibility,
  suppressionReasonLabel,
  SUPPRESSION_REASONS,
  type EligibilityContext,
  type EligibilityLead,
} from "../src/lib/campaigns/reactivation-audience.ts";
import {
  audienceFilterSchema,
  campaignDraftSchema,
  MAX_EMAIL_BODY_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_SUBJECT_LENGTH,
  fullSuppressionBreakdown,
  DEFAULT_AUDIENCE_FILTER,
  DEFAULT_OLDER_THAN_DAYS,
} from "../src/lib/campaigns/types.ts";
import {
  bodyLimitFor,
  changeChannel,
  initialWizardState,
  launchChecklist,
  scheduledInstant,
  validateAudienceStep,
  validateMessageStep,
  type WizardState,
} from "../src/components/reactivation/wizard/state.ts";

const NOW = Date.parse("2026-09-05T12:00:00.000Z");

const context: EligibilityContext = {
  now: NOW,
  cooldownDays: 30,
  suppressedContacts: new Set(["+447700900999"]),
};

function lead(overrides: Partial<EligibilityLead> = {}): EligibilityLead {
  return {
    id: "lead-1",
    status: "CONTACTED",
    optedOut: false,
    humanTakeover: false,
    contact: "+447700900000",
    lastContactAt: "2026-01-01T00:00:00.000Z",
    bookedAt: null,
    wonAt: null,
    ...overrides,
  };
}

/* ------------------------------------------------------- eligibility --- */

describe("reactivation eligibility", () => {
  test("a quiet, contactable lead is eligible", () => {
    const verdict = evaluateReactivationEligibility(lead(), context);
    assert.equal(verdict.eligible, true);
    assert.equal(verdict.reason, null);
  });

  test("opt-out outranks every other reason", () => {
    const verdict = evaluateReactivationEligibility(
      lead({ optedOut: true, contact: null, status: "WON" }),
      context,
    );
    assert.equal(verdict.eligible, false);
    assert.equal(verdict.reason, "opted_out");
  });

  test("a lead with no usable number is invalid_number", () => {
    const verdict = evaluateReactivationEligibility(
      lead({ contact: null }),
      context,
    );
    assert.equal(verdict.reason, "invalid_number");
  });

  test("a number on the suppression list is suppressed", () => {
    const verdict = evaluateReactivationEligibility(
      lead({ contact: "+447700900999" }),
      context,
    );
    assert.equal(verdict.reason, "suppressed");
  });

  test("a human takeover counts as an active conversation", () => {
    const verdict = evaluateReactivationEligibility(
      lead({ humanTakeover: true }),
      context,
    );
    assert.equal(verdict.reason, "active_conversation");
  });

  test("contact inside the cooldown window is excluded", () => {
    const verdict = evaluateReactivationEligibility(
      lead({ lastContactAt: "2026-09-01T00:00:00.000Z" }),
      context,
    );
    assert.equal(verdict.reason, "contacted_recently");
  });

  test("contact outside the cooldown window is allowed", () => {
    const verdict = evaluateReactivationEligibility(
      lead({ lastContactAt: "2026-06-01T00:00:00.000Z" }),
      context,
    );
    assert.equal(verdict.eligible, true);
  });

  test("won outranks booked so a customer is never double counted", () => {
    const verdict = evaluateReactivationEligibility(
      lead({ status: "WON", bookedAt: "2026-02-01T00:00:00.000Z" }),
      context,
    );
    assert.equal(verdict.reason, "won");
  });

  test("a booking excludes the lead even when the status lags behind", () => {
    const verdict = evaluateReactivationEligibility(
      lead({ status: "CONTACTED", bookedAt: "2026-02-01T00:00:00.000Z" }),
      context,
    );
    assert.equal(verdict.reason, "already_booked");
  });

  test("reasons are exclusive, so per-reason counts sum to the total", () => {
    const leads = [
      lead({ id: "a" }),
      lead({ id: "b", optedOut: true }),
      lead({ id: "c", contact: null }),
      lead({ id: "d", status: "WON" }),
      lead({ id: "e", optedOut: true, contact: null, status: "WON" }),
    ];

    const counts = new Map<string, number>();
    let eligible = 0;
    for (const entry of leads) {
      const verdict = evaluateReactivationEligibility(entry, context);
      if (verdict.eligible) eligible += 1;
      else counts.set(verdict.reason, (counts.get(verdict.reason) ?? 0) + 1);
    }

    const suppressed = [...counts.values()].reduce((a, b) => a + b, 0);
    assert.equal(eligible, 1);
    assert.equal(suppressed, 4);
    assert.equal(eligible + suppressed, leads.length);
  });
});

/* ----------------------------------------------------------- labels --- */

describe("suppression labels", () => {
  test("the cooldown label carries the configured window", () => {
    assert.equal(
      suppressionReasonLabel("contacted_recently", 45),
      "Recently contacted (45 days)",
    );
  });

  test("a full breakdown lists every reason, including zeroes", () => {
    const rows = fullSuppressionBreakdown(
      [{ reason: "opted_out", label: "Opted out", count: 124 }],
      30,
    );
    assert.equal(rows.length, SUPPRESSION_REASONS.length);
    assert.equal(rows.find((r) => r.reason === "opted_out")?.count, 124);
    assert.equal(rows.find((r) => r.reason === "won")?.count, 0);
  });
});

/* ------------------------------------------------------- breakdowns --- */

describe("audience breakdowns", () => {
  const rows = [
    { service: "Roof Repair", source: "Website", status: "CONTACTED", createdAt: "2025-01-01T00:00:00.000Z" },
    { service: "Roof Repair", source: "Website", status: "LOST", createdAt: "2026-08-20T00:00:00.000Z" },
    { service: "New Roof", source: "Referral", status: "LOST", createdAt: "2024-01-01T00:00:00.000Z" },
    { service: null, source: null, status: "NEW", createdAt: "2026-01-01T00:00:00.000Z" },
  ];

  test("counts and shares are computed over the eligible set", () => {
    const result = buildAudienceBreakdowns(rows, NOW);
    const roof = result.service.find((entry) => entry.label === "Roof Repair");
    assert.equal(roof?.count, 2);
    assert.equal(roof?.share, 50);
  });

  test("a missing service is labelled, never dropped", () => {
    const result = buildAudienceBreakdowns(rows, NOW);
    assert.ok(result.service.some((entry) => entry.label === "No service"));
  });

  test("a long tail rolls up into Other", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      service: `Service ${i}`,
      source: "Website",
      status: "NEW",
      createdAt: "2024-01-01T00:00:00.000Z",
    }));
    const result = buildAudienceBreakdowns(many, NOW);
    assert.equal(result.service.length, 5);
    assert.equal(result.service.at(-1)?.label, "Other");
    assert.equal(result.service.at(-1)?.count, 4);
  });

  test("age buckets stay in chronological order", () => {
    const result = buildAudienceBreakdowns(rows, NOW);
    const labels = result.age.map((entry) => entry.label);
    assert.deepEqual(labels, [...labels].sort((a, b) => {
      const order = ["Under 3 months", "3-6 months", "6-12 months", "1-2 years", "Over 2 years"];
      return order.indexOf(a) - order.indexOf(b);
    }));
  });

  test("an empty audience produces empty breakdowns, not a divide by zero", () => {
    const result = buildAudienceBreakdowns([], NOW);
    assert.deepEqual(result.service, []);
  });
});

/* ---------------------------------------------------------- estimate --- */

describe("message estimate", () => {
  test("initial only when the follow-up is off", () => {
    const totals = estimateMessages({
      eligible: 2480,
      initialSegments: 1,
      followupEnabled: false,
      followupSegments: 1,
    });
    assert.deepEqual(totals, { initial: 2480, followup: 0, total: 2480 });
  });

  test("the follow-up doubles the upper bound", () => {
    const totals = estimateMessages({
      eligible: 2480,
      initialSegments: 1,
      followupEnabled: true,
      followupSegments: 1,
    });
    assert.equal(totals.total, 4960);
  });

  test("a multi-segment message costs more than one message per contact", () => {
    const totals = estimateMessages({
      eligible: 100,
      initialSegments: 2,
      followupEnabled: false,
      followupSegments: 0,
    });
    assert.equal(totals.initial, 200);
  });
});

/* ------------------------------------------------------------ filter --- */

describe("audience filter schema", () => {
  test("defaults to a 90 day lead age", () => {
    const parsed = audienceFilterSchema.parse({});
    assert.equal(parsed.olderThanDays, DEFAULT_OLDER_THAN_DAYS);
    assert.equal(parsed.notBooked, true);
  });

  test("rejects a zero or negative age", () => {
    assert.equal(audienceFilterSchema.safeParse({ olderThanDays: 0 }).success, false);
    assert.equal(audienceFilterSchema.safeParse({ olderThanDays: -5 }).success, false);
  });

  test("rejects an absurd age", () => {
    assert.equal(
      audienceFilterSchema.safeParse({ olderThanDays: 99999 }).success,
      false,
    );
  });

  test("the checklist reflects the configured filters", () => {
    const items = audienceChecklist("existing", {
      olderThanDays: 90,
      statuses: [],
      serviceName: null,
      sourceName: null,
      noReply: true,
      markedLost: false,
      notBooked: true,
    });
    assert.ok(items.includes("Leads older than 90 days"));
    assert.ok(items.includes("Status: Not booked"));
    assert.ok(items.includes("No reply required"));
  });

  test("the CSV checklist does not claim lead filters were used", () => {
    const items = audienceChecklist("csv", {
      olderThanDays: 90,
      statuses: [],
      serviceName: null,
      sourceName: null,
      noReply: false,
      markedLost: false,
      notBooked: true,
    });
    assert.ok(items.includes("Using an imported CSV list"));
    assert.ok(!items.some((item) => item.startsWith("Leads older than")));
  });
});

/* -------------------------------------------------------- wizard step --- */

function wizard(overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...initialWizardState("sms"),
    campaignName: "Autumn Roof Check",
    initialMessage: "Hi {{first_name}}, still need help with your {{service_name}}?",
    ...overrides,
  };
}

describe("step 1 validation", () => {
  const ready = { eligible: 2480, audienceReady: true, csvBusy: false };

  test("passes with a name and eligible contacts", () => {
    assert.equal(validateAudienceStep(wizard(), ready).valid, true);
  });

  test("blocks an unnamed campaign", () => {
    const issues = validateAudienceStep(wizard({ campaignName: " " }), ready);
    assert.equal(issues.valid, false);
    assert.ok(issues.fields.campaignName);
  });

  test("blocks zero eligible contacts", () => {
    const issues = validateAudienceStep(wizard(), { ...ready, eligible: 0 });
    assert.equal(issues.valid, false);
    assert.equal(
      issues.fields.audience,
      "No eligible contacts match this audience.",
    );
  });

  test("blocks while the estimate is still resolving", () => {
    assert.equal(
      validateAudienceStep(wizard(), { ...ready, audienceReady: false }).valid,
      false,
    );
  });

  test("blocks while a CSV is still processing", () => {
    assert.equal(
      validateAudienceStep(wizard(), { ...ready, csvBusy: true }).valid,
      false,
    );
  });

  test("CSV source without an upload is refused", () => {
    const issues = validateAudienceStep(
      wizard({ audienceSource: "csv", csvUpload: null }),
      ready,
    );
    assert.equal(issues.valid, false);
    assert.ok(issues.fields.csv);
  });
});

describe("step 2 validation", () => {
  const ctx = { providerConnected: true, now: NOW };

  test("passes with a valid message", () => {
    assert.equal(validateMessageStep(wizard(), ctx).valid, true);
  });

  test("blocks a blank message", () => {
    const issues = validateMessageStep(wizard({ initialMessage: "hi" }), ctx);
    assert.equal(issues.valid, false);
    assert.ok(issues.fields.initialMessage);
  });

  test("blocks an unresolvable merge field", () => {
    const issues = validateMessageStep(
      wizard({ initialMessage: "Hello {{nickname}}, are you still there?" }),
      ctx,
    );
    assert.equal(issues.valid, false);
    assert.match(issues.fields.initialMessage, /nickname/);
  });

  test("accepts every advertised merge field", () => {
    const issues = validateMessageStep(
      wizard({
        initialMessage:
          "{{first_name}} {{last_name}} {{full_name}} {{service_name}} {{business_name}} {{booking_link}} {{business_phone}}",
      }),
      ctx,
    );
    assert.equal(issues.fields.initialMessage, undefined);
  });

  test("blocks a disconnected provider", () => {
    const issues = validateMessageStep(wizard(), {
      ...ctx,
      providerConnected: false,
    });
    assert.equal(issues.valid, false);
    assert.ok(issues.fields.channel);
  });

  test("an enabled follow-up must have a body", () => {
    const issues = validateMessageStep(
      wizard({ followUpEnabled: true, followUpMessage: "" }),
      ctx,
    );
    assert.equal(issues.valid, false);
    assert.ok(issues.fields.followUpMessage);
  });

  test("a disabled follow-up is not validated", () => {
    const issues = validateMessageStep(
      wizard({ followUpEnabled: false, followUpMessage: "" }),
      ctx,
    );
    assert.equal(issues.valid, true);
  });

  test("a scheduled time in the past is refused", () => {
    const issues = validateMessageStep(
      wizard({
        sendMode: "schedule",
        scheduledDate: "2020-01-01",
        scheduledTime: "10:00",
      }),
      ctx,
    );
    assert.equal(issues.valid, false);
    assert.ok(issues.fields.schedule);
  });

  test("schedule mode with no date is refused", () => {
    const issues = validateMessageStep(wizard({ sendMode: "schedule" }), ctx);
    assert.equal(issues.valid, false);
  });

  test("scheduledInstant is null unless schedule mode is chosen", () => {
    assert.equal(scheduledInstant(wizard({ sendMode: "now" })), null);
    assert.ok(
      scheduledInstant(
        wizard({
          sendMode: "schedule",
          scheduledDate: "2027-11-02",
          scheduledTime: "10:00",
        }),
      ) instanceof Date,
    );
  });
});

/* --------------------------------------------------------- checklist --- */

describe("launch checklist", () => {
  const ctx = {
    eligible: 2480,
    providerConnected: true,
    messageValid: true,
    timingValid: true,
  };

  test("every item passes for a complete campaign", () => {
    const items = launchChecklist(wizard(), ctx);
    assert.ok(items.every((item) => item.done));
  });

  test("a disabled follow-up is absent, not shown as outstanding", () => {
    const items = launchChecklist(wizard({ followUpEnabled: false }), ctx);
    assert.ok(!items.some((item) => item.label.includes("follow-up")));
  });

  test("an enabled follow-up appears as its own item", () => {
    const items = launchChecklist(
      wizard({
        followUpEnabled: true,
        followUpMessage: "Hi {{first_name}}, just following up.",
      }),
      ctx,
    );
    assert.ok(items.some((item) => item.label === "1 optional follow-up enabled"));
  });

  test("zero eligible contacts fails the first item", () => {
    const items = launchChecklist(wizard(), { ...ctx, eligible: 0 });
    assert.equal(items[0].done, false);
  });

  test("a disconnected provider adds an outstanding item", () => {
    const items = launchChecklist(wizard(), {
      ...ctx,
      providerConnected: false,
    });
    const provider = items.find((item) =>
      item.label.includes("Messaging provider"),
    );
    assert.equal(provider?.done, false);
  });
});

/* ------------------------------------------------------------- draft --- */

describe("campaign draft payload", () => {
  test("the wizard payload satisfies the server schema", () => {
    const state = wizard({
      followUpEnabled: true,
      followUpMessage: "Hi {{first_name}}, just following up.",
      followUpDelayDays: 3,
    });

    const parsed = campaignDraftSchema.safeParse({
      name: state.campaignName,
      audienceLabel: "Reactivation audience",
      tags: [],
      channel: state.channel,
      audience: DEFAULT_AUDIENCE_FILTER,
      message: state.initialMessage,
      followup: state.followUpMessage,
      followupDelayHours: state.followUpDelayDays * 24,
      sendMode: state.sendMode,
      sendRatePerMinute: 20,
      aiPersonalize: false,
    });

    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.followupDelayHours, 72);
  });

  test("the server schema refuses a campaign with no name", () => {
    const parsed = campaignDraftSchema.safeParse({
      name: "",
      audience: DEFAULT_AUDIENCE_FILTER,
      message: "Hi {{first_name}}, still there?",
    });
    assert.equal(parsed.success, false);
  });
});

/* ---------------------------------------------------------- email step --- */

describe("email channel", () => {
  const ctx = { providerConnected: true, now: NOW };

  function emailWizard(overrides: Partial<WizardState> = {}): WizardState {
    return wizard({
      channel: "email",
      subject: "Still thinking about your {{service_name}}?",
      ...overrides,
    });
  }

  test("a complete email passes", () => {
    assert.equal(validateMessageStep(emailWizard(), ctx).valid, true);
  });

  test("an email without a subject is refused", () => {
    const issues = validateMessageStep(emailWizard({ subject: "  " }), ctx);
    assert.equal(issues.valid, false);
    assert.ok(issues.fields.subject);
  });

  test("an unresolvable variable in the subject is caught", () => {
    const issues = validateMessageStep(
      emailWizard({ subject: "Hello {{nickname}}" }),
      ctx,
    );
    assert.equal(issues.valid, false);
    assert.match(issues.fields.subject, /nickname/);
  });

  test("an over-long subject is refused", () => {
    const issues = validateMessageStep(
      emailWizard({ subject: "a".repeat(MAX_SUBJECT_LENGTH + 1) }),
      ctx,
    );
    assert.equal(issues.valid, false);
    assert.ok(issues.fields.subject);
  });

  test("SMS is never asked for a subject", () => {
    const issues = validateMessageStep(wizard({ channel: "sms", subject: "" }), ctx);
    assert.equal(issues.fields.subject, undefined);
  });

  test("email allows a body far longer than an SMS", () => {
    const long = "Hi {{first_name}}. ".repeat(60);
    assert.ok(long.length > MAX_MESSAGE_LENGTH);
    assert.ok(long.length < MAX_EMAIL_BODY_LENGTH);

    assert.equal(
      validateMessageStep(emailWizard({ initialMessage: long }), ctx).valid,
      true,
    );
    assert.equal(
      validateMessageStep(wizard({ channel: "sms", initialMessage: long }), ctx).valid,
      false,
    );
  });

  test("the body limit is still enforced on email", () => {
    const issues = validateMessageStep(
      emailWizard({ initialMessage: "a".repeat(MAX_EMAIL_BODY_LENGTH + 1) }),
      ctx,
    );
    assert.equal(issues.valid, false);
    assert.ok(issues.fields.initialMessage);
  });

  test("bodyLimitFor separates email from the texting channels", () => {
    assert.equal(bodyLimitFor("email"), MAX_EMAIL_BODY_LENGTH);
    assert.equal(bodyLimitFor("sms"), MAX_MESSAGE_LENGTH);
    assert.equal(bodyLimitFor("whatsapp"), MAX_MESSAGE_LENGTH);
  });

  test("an over-long follow-up subject is caught", () => {
    const issues = validateMessageStep(
      emailWizard({
        followUpEnabled: true,
        followUpMessage: "Hi {{first_name}}, just following up.",
        followUpSubject: "a".repeat(MAX_SUBJECT_LENGTH + 1),
      }),
      ctx,
    );
    assert.equal(issues.valid, false);
    assert.ok(issues.fields.followUpSubject);
  });

  test("a blank follow-up subject is allowed and reuses the initial one", () => {
    const issues = validateMessageStep(
      emailWizard({
        followUpEnabled: true,
        followUpMessage: "Hi {{first_name}}, just following up.",
        followUpSubject: "",
      }),
      ctx,
    );
    assert.equal(issues.valid, true);
  });
});

describe("email campaign payload", () => {
  test("the server schema requires a subject on email", () => {
    const parsed = campaignDraftSchema.safeParse({
      name: "Autumn Roof Check",
      channel: "email",
      audience: DEFAULT_AUDIENCE_FILTER,
      message: "Hi {{first_name}}, still there?",
    });
    assert.equal(parsed.success, false);
    assert.ok(parsed.error?.issues.some((issue) => issue.path.includes("subject")));
  });

  test("the server schema accepts a complete email campaign", () => {
    const parsed = campaignDraftSchema.safeParse({
      name: "Autumn Roof Check",
      channel: "email",
      subject: "Still thinking about your roof?",
      audience: DEFAULT_AUDIENCE_FILTER,
      message: "Hi {{first_name}}, still there?",
    });
    assert.equal(parsed.success, true);
  });

  test("an SMS campaign cannot borrow the email body allowance", () => {
    const parsed = campaignDraftSchema.safeParse({
      name: "Autumn Roof Check",
      channel: "sms",
      audience: DEFAULT_AUDIENCE_FILTER,
      message: "a".repeat(MAX_MESSAGE_LENGTH + 1),
    });
    assert.equal(parsed.success, false);
  });

  test("an email follow-up needs its own subject", () => {
    const parsed = campaignDraftSchema.safeParse({
      name: "Autumn Roof Check",
      channel: "email",
      subject: "Still thinking about your roof?",
      audience: DEFAULT_AUDIENCE_FILTER,
      message: "Hi {{first_name}}, still there?",
      followup: "Just following up, {{first_name}}.",
    });
    assert.equal(parsed.success, false);
    assert.ok(
      parsed.error?.issues.some((issue) => issue.path.includes("followupSubject")),
    );
  });
});

/* ------------------------------------------------------- email bodies --- */

describe("email bodies are markup", () => {
  const ctx = { providerConnected: true, now: NOW };

  test("length is measured in words, not tags", () => {
    // Well under the limit as text, but only because the tags are not counted.
    const body = `<p>${"a".repeat(MAX_EMAIL_BODY_LENGTH - 20)}</p>`;
    const issues = validateMessageStep(
      wizard({ channel: "email", subject: "Hi", initialMessage: body }),
      ctx,
    );
    assert.equal(issues.fields.initialMessage, undefined);
  });

  test("markup with no words is refused", () => {
    const issues = validateMessageStep(
      wizard({
        channel: "email",
        subject: "Hi there",
        initialMessage: "<p><br></p>",
      }),
      ctx,
    );
    assert.equal(issues.valid, false);
    assert.ok(issues.fields.initialMessage);
  });

  test("merge fields are still checked inside markup", () => {
    const issues = validateMessageStep(
      wizard({
        channel: "email",
        subject: "Hi there",
        initialMessage: "<p>Hello <strong>{{nickname}}</strong>, still there?</p>",
      }),
      ctx,
    );
    assert.equal(issues.valid, false);
    assert.match(issues.fields.initialMessage, /nickname/);
  });

  test("switching to email wraps the text in paragraphs", () => {
    const next = changeChannel(
      wizard({ channel: "sms", initialMessage: "Line one\n\nLine two" }),
      "email",
    );
    assert.equal(next.initialMessage, "<p>Line one</p><p>Line two</p>");
    assert.equal(next.channel, "email");
  });

  test("switching away from email leaves readable text, not tags", () => {
    const next = changeChannel(
      wizard({
        channel: "email",
        initialMessage: "<p>Hi <strong>Jamie</strong></p><p>Still there?</p>",
      }),
      "sms",
    );
    assert.equal(next.initialMessage, "Hi Jamie\n\nStill there?");
    assert.ok(!next.initialMessage?.includes("<"));
  });

  test("switching between the two texting channels leaves bodies alone", () => {
    const next = changeChannel(
      wizard({ channel: "sms", initialMessage: "Hi {{first_name}}" }),
      "whatsapp",
    );
    assert.equal(next.initialMessage, undefined);
    assert.equal(next.channel, "whatsapp");
  });

  test("the follow-up channel follows the campaign channel", () => {
    const next = changeChannel(wizard({ channel: "sms" }), "email");
    assert.equal(next.followUpChannel, "email");
  });

  test("the server schema strips a script from an email body", () => {
    const parsed = campaignDraftSchema.safeParse({
      name: "Autumn Roof Check",
      channel: "email",
      subject: "Still thinking about your roof?",
      audience: DEFAULT_AUDIENCE_FILTER,
      message: '<p>Hi {{first_name}}</p><script>alert(1)</script>',
    });
    assert.equal(parsed.success, true);
    assert.ok(!parsed.data?.message.includes("<script"));
  });

  test("the server schema leaves an SMS body exactly as written", () => {
    const body = "Hi {{first_name}}, 5 < 10 & still keen?";
    const parsed = campaignDraftSchema.safeParse({
      name: "Autumn Roof Check",
      channel: "sms",
      audience: DEFAULT_AUDIENCE_FILTER,
      message: body,
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.message, body);
  });
});
