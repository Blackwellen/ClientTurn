import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aiPersonalizeApplies,
  campaignChannelReadiness,
  campaignTemplateVariables,
  checkCampaignTemplate,
  contactStage,
  followUpDueAt,
  followUpIsDue,
  followUpSkipReason,
  pickDefaultChannel,
  settleCampaignContact,
  templateMappingIssue,
} from "../src/lib/campaigns/reactivation-channels.ts";
import { withOptOutWording } from "../src/lib/messaging/sms-compliance.ts";
import {
  campaignDraftSchema,
  DEFAULT_AUDIENCE_FILTER,
  IMPORT_FIELDS,
  importMappingHasContact,
  importMappingSchema,
} from "../src/lib/campaigns/types.ts";
import { validateImport } from "../src/lib/campaigns/csv.ts";
import {
  initialWizardState,
  launchChecklist,
  validateMessageStep,
  whatsappTemplateIssue,
  type WizardState,
} from "../src/components/reactivation/wizard/state.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const NOW = new Date("2026-09-26T12:00:00.000Z");
const QUIET_OFF = { enabled: false, start: "20:00", end: "08:00", timezone: "Europe/London" };
const QUIET_ON = { enabled: true, start: "20:00", end: "08:00", timezone: "Europe/London" };

const TEMPLATE = {
  id: "8d6f4c2e-1a2b-4c3d-9e8f-0a1b2c3d4e5f",
  name: "reactivation_hello",
  language: "en_GB",
  category: "MARKETING",
  body: "Hi {{1}}, it's {{2}} checking in.",
  variables: ["1", "2"],
};

function wizard(overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...initialWizardState("sms"),
    campaignName: "Autumn check-in",
    initialMessage: "Hi {{first_name}}, still looking at {{service_name}}?",
    ...overrides,
  };
}

/* ------------------------------------------------ 16. opt-out wording --- */

describe("16. opt-out wording on marketing texts", () => {
  test("appends the workspace wording to SMS and WhatsApp", () => {
    assert.equal(
      withOptOutWording("Hi Jamie", { channel: "sms", wording: "Reply STOP to opt out." }),
      "Hi Jamie\nReply STOP to opt out.",
    );
    assert.equal(
      withOptOutWording("Hi Jamie", { channel: "whatsapp", wording: "Reply STOP to opt out." }),
      "Hi Jamie\nReply STOP to opt out.",
    );
  });

  test("leaves email alone (it carries an unsubscribe link)", () => {
    assert.equal(withOptOutWording("Hi Jamie", { channel: "email", wording: "Reply STOP" }), "Hi Jamie");
  });

  test("does not repeat itself when the body already mentions STOP", () => {
    const body = "Hi Jamie. Text STOP to stop these.";
    assert.equal(withOptOutWording(body, { channel: "sms", wording: "Reply STOP to opt out." }), body);
  });

  test("the follow-up engine and campaign sends share the one helper", () => {
    assert.match(read("src/lib/jobs/handlers/automation-advance.ts"), /withOptOutWording\(/);
    const send = read("src/lib/jobs/handlers/campaign-send.ts");
    assert.match(send, /withOptOutWording\(body, \{ channel, wording: business\.optOutWording \}\)/);
  });

  test("the wizard tells the user about the opt-out line", () => {
    const step = read("src/components/reactivation/wizard/message-timing-step.tsx");
    assert.match(step, /ends with your opt-out line/);
    assert.match(step, /Reply STOP to opt out/);
  });
});

/* ---------------------------------------- 18. per-channel readiness --- */

describe("18. a connection per channel, including the mailbox", () => {
  test("a connected mailbox makes email ready on its own", () => {
    const ready = campaignChannelReadiness([{ provider_type: "imap_smtp", status: "HEALTHY" }]);
    assert.deepEqual(ready, { sms: false, whatsapp: false, email: true });
  });

  test("a disconnected or failed connection does not count", () => {
    const ready = campaignChannelReadiness([
      { provider_type: "imap_smtp", status: "ACTION_REQUIRED" },
      { provider_type: "twilio_sms", status: "DISCONNECTED" },
      { provider_type: "whatsapp_cloud", status: "DEGRADED" },
    ]);
    assert.deepEqual(ready, { sms: false, whatsapp: true, email: false });
  });

  test("an email-only workspace opens the wizard on email", () => {
    const ready = { sms: false, whatsapp: false, email: true };
    assert.equal(pickDefaultChannel("sms", ready, { sms: true, whatsapp: true, email: true }), "email");
  });

  test("the preferred channel wins when it can send", () => {
    const ready = { sms: true, whatsapp: true, email: true };
    assert.equal(pickDefaultChannel("whatsapp", ready, { sms: true, whatsapp: true, email: true }), "whatsapp");
    assert.equal(pickDefaultChannel("whatsapp", ready, { sms: true, whatsapp: false, email: true }), "sms");
  });

  test("the message step names the connection for the chosen channel", () => {
    const issues = validateMessageStep(wizard({ channel: "email", subject: "Checking in" }), {
      providerConnected: false,
      now: NOW.getTime(),
    });
    assert.match(issues.fields.channel, /mailbox/);
  });

  test("the page and the drawer use the shared readiness, and expand keeps email", () => {
    assert.match(read("src/app/(app)/app/reactivation/new/page.tsx"), /campaignChannelReadiness\(/);
    assert.match(read("src/lib/campaigns/reactivation-queries.ts"), /campaignChannelReadiness\(/);
    assert.match(read("src/lib/jobs/handlers/campaign-expand.ts"), /campaign\.channel === "email"/);
  });
});

/* -------------------------------------------- 15. WhatsApp templates --- */

describe("15. WhatsApp reactivation sends an approved template", () => {
  test("no approved template: the step explains one is needed", () => {
    const issue = whatsappTemplateIssue(
      { whatsappTemplateId: "", whatsappTemplateVariables: {} },
      [],
    );
    assert.match(issue ?? "", /approved template/);
  });

  test("a template with unmapped variables is not complete", () => {
    assert.match(templateMappingIssue(TEMPLATE, { "1": "first_name" }) ?? "", /\{\{2\}\}/);
    assert.match(templateMappingIssue(TEMPLATE, { "1": "first_name", "2": "not_a_field" }) ?? "", /\{\{2\}\}/);
    assert.equal(templateMappingIssue(TEMPLATE, { "1": "first_name", "2": "business_name" }), null);
  });

  test("the message step blocks WhatsApp until a template is mapped", () => {
    const ctx = { providerConnected: true, now: NOW.getTime(), whatsappTemplates: [TEMPLATE] };
    const blocked = validateMessageStep(wizard({ channel: "whatsapp" }), ctx);
    assert.equal(blocked.valid, false);
    assert.ok(blocked.fields.whatsappTemplate);

    const ready = validateMessageStep(
      wizard({
        channel: "whatsapp",
        whatsappTemplateId: TEMPLATE.id,
        whatsappTemplateVariables: { "1": "first_name", "2": "business_name" },
      }),
      ctx,
    );
    assert.equal(ready.valid, true);
  });

  test("the server schema refuses a WhatsApp campaign with no template", () => {
    const base = {
      name: "Autumn check-in",
      channel: "whatsapp",
      audience: DEFAULT_AUDIENCE_FILTER,
      message: "Hi {{first_name}}, still there?",
    };
    assert.equal(campaignDraftSchema.safeParse(base).success, false);
    assert.equal(
      campaignDraftSchema.safeParse({
        ...base,
        whatsappTemplateId: TEMPLATE.id,
        whatsappTemplateVariables: { "1": "first_name" },
      }).success,
      true,
    );
  });

  test("the create-time check refuses the wrong transport and unapproved templates", () => {
    const template = {
      businessId: null,
      provider: "twilio" as const,
      status: "APPROVED",
      name: "hello",
      variables: ["1"],
    };
    const map = { "1": "first_name" };
    assert.deepEqual(
      checkCampaignTemplate({ template, businessId: "b", transport: "twilio", variableMap: map }),
      { ok: true },
    );
    assert.equal(
      checkCampaignTemplate({ template, businessId: "b", transport: "meta", variableMap: map }).ok,
      false,
    );
    assert.equal(
      checkCampaignTemplate({
        template: { ...template, status: "PENDING" },
        businessId: "b",
        transport: "twilio",
        variableMap: map,
      }).ok,
      false,
    );
    assert.equal(
      checkCampaignTemplate({
        template: { ...template, businessId: "other" },
        businessId: "b",
        transport: "twilio",
        variableMap: map,
      }).ok,
      false,
    );
  });

  test("per-lead variables are resolved; a missing value is left out, never blanked", () => {
    assert.deepEqual(
      campaignTemplateVariables(["1", "2"], { "1": "first_name", "2": "business_name" }, {
        first_name: "Jamie",
        business_name: "Acme Studio",
      }),
      { "1": "Jamie", "2": "Acme Studio" },
    );
    assert.deepEqual(
      campaignTemplateVariables(["1", "2"], { "1": "first_name", "2": "service_name" }, {
        first_name: "Jamie",
        service_name: "",
      }),
      { "1": "Jamie" },
    );
  });

  test("campaign-send stores the template on the queued WhatsApp message", () => {
    const send = read("src/lib/jobs/handlers/campaign-send.ts");
    assert.match(send, /whatsappTemplate: whatsappTemplate/);
    assert.match(read("supabase/migrations/0132_reactivation_whatsapp_template.sql"), /whatsapp_template_id/);
  });
});

/* ---------------------------------- 17. follow-up channel and sending --- */

describe("17. the follow-up uses the campaign channel, and is actually sent", () => {
  test("there is no follow-up channel selector any more", () => {
    const step = read("src/components/reactivation/wizard/message-timing-step.tsx");
    assert.ok(!step.includes('htmlFor="followup-channel"'));
    assert.match(step, /Same as the initial message/);
  });

  test("a contact moves initial -> follow-up -> done", () => {
    assert.equal(contactStage({ sent_at: null, followup_sent_at: null }), "initial");
    assert.equal(contactStage({ sent_at: "2026-09-01T00:00:00Z", followup_sent_at: null }), "followup");
    assert.equal(
      contactStage({ sent_at: "2026-09-01T00:00:00Z", followup_sent_at: "2026-09-04T00:00:00Z" }),
      "done",
    );
  });

  test("an initial send with a follow-up leaves the contact scheduled for it", () => {
    const followUpAt = followUpDueAt(NOW, 3 * 86400, QUIET_OFF);
    assert.equal(followUpAt.toISOString(), "2026-09-29T12:00:00.000Z");
    const update = settleCampaignContact({
      stage: "initial",
      outcome: { outcome: "sent" },
      now: NOW,
      finalAttempt: false,
      followUpAt,
    });
    assert.deepEqual(update, {
      state: "scheduled",
      sent_at: NOW.toISOString(),
      next_send_at: followUpAt.toISOString(),
    });
  });

  test("an initial send without a follow-up is simply sent", () => {
    assert.deepEqual(
      settleCampaignContact({ stage: "initial", outcome: { outcome: "sent" }, now: NOW, finalAttempt: false, followUpAt: null }),
      { state: "sent", sent_at: NOW.toISOString() },
    );
  });

  test("the follow-up due time respects quiet hours", () => {
    // 22:00 London (BST) is inside 20:00-08:00, so it rolls to 08:00.
    const due = followUpDueAt(new Date("2026-09-26T21:00:00.000Z"), 0, QUIET_ON);
    assert.equal(due.toISOString(), "2026-09-27T07:00:00.000Z");
  });

  test("a follow-up outcome never erases the initial send", () => {
    const sent = settleCampaignContact({ stage: "followup", outcome: { outcome: "sent" }, now: NOW, finalAttempt: false, followUpAt: null });
    assert.deepEqual(sent, { state: "sent", followup_sent_at: NOW.toISOString() });
    const aborted = settleCampaignContact({
      stage: "followup",
      outcome: { outcome: "aborted", reason: "opted_out" },
      now: NOW,
      finalAttempt: false,
      followUpAt: null,
    });
    assert.deepEqual(aborted, { state: "sent", stopped_reason: "followup_skipped:opted_out" });
    assert.equal(
      settleCampaignContact({
        stage: "followup",
        outcome: { outcome: "failed", permanent: false, errorCode: "x" },
        now: NOW,
        finalAttempt: false,
        followUpAt: null,
      }),
      null,
    );
  });

  test("initial outcomes keep their previous settlement", () => {
    const base = { stage: "initial" as const, now: NOW, finalAttempt: false, followUpAt: null };
    assert.deepEqual(settleCampaignContact({ ...base, outcome: { outcome: "blocked", reasonCode: "NO_CONSENT" } }), {
      state: "suppressed",
      stopped_reason: "policy:NO_CONSENT",
    });
    assert.deepEqual(settleCampaignContact({ ...base, outcome: { outcome: "unconfirmed" } }), {
      state: "stopped",
      stopped_reason: "send_unconfirmed",
    });
    assert.deepEqual(
      settleCampaignContact({ ...base, finalAttempt: true, outcome: { outcome: "failed", permanent: false, errorCode: "e1" } }),
      { state: "failed", stopped_reason: "e1" },
    );
  });

  test("anyone who replied after the initial message is not chased", () => {
    assert.equal(followUpSkipReason({ first_replied_at: "2026-09-02T00:00:00Z" }, "2026-09-01T00:00:00Z"), "replied");
    assert.equal(followUpSkipReason({ first_replied_at: "2026-08-01T00:00:00Z" }, "2026-09-01T00:00:00Z"), null);
    assert.equal(followUpSkipReason({ first_replied_at: null }, "2026-09-01T00:00:00Z"), null);
  });

  test("a retried batch cannot send a follow-up early", () => {
    assert.equal(followUpIsDue("2026-09-29T12:00:00.000Z", NOW), false);
    assert.equal(followUpIsDue("2026-09-26T12:00:30.000Z", NOW), true);
  });
});

/* ------------------------------------------ 14. AI personalisation --- */

describe("14. AI personalisation is an option, off by default", () => {
  test("off by default in the wizard", () => {
    assert.equal(initialWizardState("sms").aiPersonalize, false);
  });

  test("applies only when requested, AI assist is on, and the channel is a text", () => {
    assert.equal(aiPersonalizeApplies({ channel: "sms", requested: true, aiAssistEnabled: true }), true);
    assert.equal(aiPersonalizeApplies({ channel: "sms", requested: false, aiAssistEnabled: true }), false);
    assert.equal(aiPersonalizeApplies({ channel: "sms", requested: true, aiAssistEnabled: false }), false);
    assert.equal(aiPersonalizeApplies({ channel: "email", requested: true, aiAssistEnabled: true }), false);
  });

  test("the wizard only sends it when available and chosen", () => {
    const wizardSource = read("src/components/reactivation/reactivation-wizard.tsx");
    assert.ok(!wizardSource.includes("aiPersonalize: false,"));
    assert.match(wizardSource, /aiPersonalizeAvailable && state\.channel !== "email" && state\.aiPersonalize/);
  });
});

/* ------------------------------------------------------ 19. CSV import --- */

describe("19. CSV import needs a mobile or an email, not always a mobile", () => {
  test("no field is individually required", () => {
    assert.ok(IMPORT_FIELDS.every((field) => !field.required));
  });

  test("a mapping needs a phone or an email column", () => {
    assert.equal(importMappingSchema.safeParse({ email: "Email" }).success, true);
    assert.equal(importMappingSchema.safeParse({ phone: "Mobile" }).success, true);
    assert.equal(importMappingSchema.safeParse({ first_name: "Name" }).success, false);
    assert.equal(importMappingHasContact({ email: "Email" }), true);
    assert.equal(importMappingHasContact({}), false);
  });

  test("email-only rows import; rows with neither are refused", () => {
    const table = [
      ["Name", "Email", "Mobile"],
      ["Jamie", "jamie@acme.co.uk", ""],
      ["Priya", "", "07700 900123"],
      ["Nobody", "", ""],
      ["Dup", "JAMIE@acme.co.uk", ""],
    ];
    const result = validateImport(table, { first_name: "Name", email: "Email", phone: "Mobile" });
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].email, "jamie@acme.co.uk");
    assert.equal(result.rows[0].phoneNormalized, null);
    assert.equal(result.rows[1].phoneNormalized, "+447700900123");
    assert.ok(result.errors.some((error) => error.row === 4 && /No mobile number or email/.test(error.message)));
    assert.ok(result.errors.some((error) => error.row === 5 && /Duplicate/.test(error.message)));
  });

  test("a bad mobile is still reported when there is no email", () => {
    const result = validateImport([["Mobile"], ["123456"]], { phone: "Mobile" });
    assert.equal(result.rows.length, 0);
    assert.match(result.errors[0].message, /Not a usable mobile number/);
  });
});

/* -------------------------------------------- 20. quiet-hours pointer --- */

describe("20. the quiet-hours note points somewhere real", () => {
  test("no reference to a Settings -> Follow-up page", () => {
    const step = read("src/components/reactivation/wizard/message-timing-step.tsx");
    assert.ok(!/Settings →\s+Follow-up/.test(step));
    assert.match(step, /Settings →\s+Workspace, under Quiet hours/);
  });
});

/* -------------------------------------------- 21. suppression item --- */

describe("21. 'Suppression rules applied' reflects the real computation", () => {
  const ctx = { eligible: 10, providerConnected: true, messageValid: true, timingValid: true };

  test("unticked until the server has worked the exclusions out", () => {
    const item = launchChecklist(wizard(), ctx).find((entry) => entry.label.startsWith("Suppression"));
    assert.equal(item?.done, false);
  });

  test("ticked, with the count, once it has", () => {
    const item = launchChecklist(wizard(), { ...ctx, suppressedTotal: 1234 }).find((entry) =>
      entry.label.startsWith("Suppression"),
    );
    assert.equal(item?.done, true);
    assert.equal(item?.label, "Suppression rules applied (1,234 excluded)");
  });
});

/* ------------------------------------- 22. launch confirm + status label --- */

describe("22. launch asks first; the status filter says what it does", () => {
  test("the launch button opens a confirmation instead of launching", () => {
    const source = read("src/components/reactivation/reactivation-wizard.tsx");
    assert.match(source, /onClick=\{requestLaunch\}/);
    assert.match(source, /title="Launch this campaign\?"/);
    assert.match(source, /onConfirm=\{launch\}/);
  });

  test("the empty status option reads 'Any status'", () => {
    const source = read("src/components/reactivation/wizard/audience-step.tsx");
    assert.match(source, /<option value="">Any status<\/option>/);
    assert.ok(!source.includes('<option value="">Not booked</option>'));
  });
});
