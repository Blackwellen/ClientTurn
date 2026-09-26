/**
 * WhatsApp templates (brief §45): the approved-template registry and its use
 * outside the 24-hour window. The normalisers, the variable resolution and the
 * send-time choice are pure (src/lib/messaging/whatsapp-templates.ts); the send
 * path is exercised through `performSend` with a fake store and carrier.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  chooseTemplateForSend,
  extractTemplateVariables,
  normaliseCategory,
  normaliseMetaTemplate,
  normaliseStatus,
  normaliseTwilioContent,
  orderVariables,
  resolveTemplateVariables,
  templatePreview,
  TEMPLATE_VARIABLE_SOURCES,
  twilioContentVariables,
  type WhatsAppTemplateRecord,
} from "../src/lib/messaging/whatsapp-templates.ts";
import {
  performSend,
  SENDING_STATUS,
  type OutboundMessageRecord,
  type PolicyGate,
  type SendGuardSnapshot,
  type SendStore,
} from "../src/lib/jobs/send-core.ts";
import type { MessagingProvider, SendRequest } from "../src/lib/messaging/types.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) =>
  readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

const BUSINESS = "biz-1";

function template(overrides: Partial<WhatsAppTemplateRecord> = {}): WhatsAppTemplateRecord {
  return {
    id: "tpl-1",
    businessId: null,
    provider: "twilio",
    externalId: "HX0123456789abcdef",
    name: "follow_up_enquiry",
    language: "en_GB",
    category: "UTILITY",
    status: "APPROVED",
    body: "Hi {{1}}, it's {{2}} following up on your enquiry.",
    variables: ["1", "2"],
    ...overrides,
  };
}

describe("normalising provider templates", () => {
  test("a Twilio Content item with a WhatsApp approval becomes a platform row", () => {
    const row = normaliseTwilioContent({
      sid: "HXabc",
      friendly_name: "follow_up",
      language: "en",
      variables: { "2": "Studio", "1": "there" },
      types: { "twilio/text": { body: "Hi {{1}} from {{2}}" } },
      approval_requests: { name: "follow_up", category: "utility", status: "approved" },
    });
    assert.ok(row);
    assert.equal(row.businessId, null);
    assert.equal(row.provider, "twilio");
    assert.equal(row.externalId, "HXabc");
    assert.equal(row.category, "UTILITY");
    assert.equal(row.status, "APPROVED");
    assert.deepEqual(row.variables, ["1", "2"]);
  });

  test("content with no WhatsApp approval is not a template and is dropped", () => {
    assert.equal(normaliseTwilioContent({ sid: "HXnone", types: { "twilio/text": { body: "x" } } }), null);
  });

  test("an unknown category is priced as MARKETING, never the cheapest", () => {
    assert.equal(normaliseCategory("SERVICE"), "MARKETING");
    assert.equal(normaliseCategory(undefined), "MARKETING");
    assert.equal(normaliseCategory("authentication"), "AUTHENTICATION");
  });

  test("statuses map to the registry vocabulary", () => {
    assert.equal(normaliseStatus("approved"), "APPROVED");
    assert.equal(normaliseStatus("unsubmitted"), "PENDING");
    assert.equal(normaliseStatus("IN_APPEAL"), "PENDING");
    assert.equal(normaliseStatus("paused"), "PAUSED");
    assert.equal(normaliseStatus("weird"), "UNKNOWN");
  });

  test("a Meta template takes its variables from the BODY component", () => {
    const row = normaliseMetaTemplate(
      {
        id: "987",
        name: "booking_reminder",
        language: "en_GB",
        status: "APPROVED",
        category: "UTILITY",
        components: [
          { type: "HEADER", text: "Reminder {{9}}" },
          { type: "BODY", text: "Hi {{1}}, see you at {{2}}. {{1}}" },
        ],
      },
      "biz-9",
    );
    assert.ok(row);
    assert.equal(row.businessId, "biz-9");
    assert.equal(row.provider, "meta");
    assert.equal(row.externalId, "987");
    assert.deepEqual(row.variables, ["1", "2"]);
  });

  test("variables are extracted once, in order, and numeric keys sort numerically", () => {
    assert.deepEqual(extractTemplateVariables("{{2}} {{ 1 }} {{2}} {{name}}"), ["2", "1", "name"]);
    assert.deepEqual(orderVariables(["10", "2", "1"]), ["1", "2", "10"]);
  });
});

describe("resolving a step's variables", () => {
  test("every variable is filled from a follow-up merge field", () => {
    const resolved = resolveTemplateVariables(
      ["1", "2"],
      { "1": "first_name", "2": "business_name" },
      { first_name: "Priya", business_name: "Northwind Studio" },
    );
    assert.deepEqual(resolved, { ok: true, variables: { "1": "Priya", "2": "Northwind Studio" } });
  });

  test("an unmapped, unknown or empty variable is reported missing, never sent blank", () => {
    const resolved = resolveTemplateVariables(
      ["1", "2", "3"],
      { "1": "first_name", "2": "company_secret_column" },
      { first_name: "  " },
    );
    assert.deepEqual(resolved, { ok: false, missing: ["1", "2", "3"] });
  });

  test("only follow-up merge fields are offered as sources", () => {
    const keys = TEMPLATE_VARIABLE_SOURCES.map((source) => source.key);
    assert.ok(keys.includes("first_name"));
    assert.ok(keys.includes("business_name"));
    assert.ok(!keys.includes("company_name"), "company_name is a cold-outreach field");
  });
});

describe("the send-time choice", () => {
  const variables = { "1": "Priya", "2": "Northwind" };

  test("no template: refused, and the reason says a template is needed", () => {
    const choice = chooseTemplateForSend({ template: null, businessId: BUSINESS, transport: "twilio", variables });
    assert.equal(choice.ok, false);
    assert.equal(!choice.ok && choice.reason, "NO_TEMPLATE");
  });

  test("a template no longer approved is refused", () => {
    for (const status of ["PENDING", "REJECTED", "PAUSED", "DISABLED", "UNKNOWN"] as const) {
      const choice = chooseTemplateForSend({
        template: template({ status }),
        businessId: BUSINESS,
        transport: "twilio",
        variables,
      });
      assert.equal(!choice.ok && choice.reason, "NOT_APPROVED", status);
    }
  });

  test("a template from the other transport is refused", () => {
    const choice = chooseTemplateForSend({
      template: template({ provider: "twilio" }),
      businessId: BUSINESS,
      transport: "meta",
      variables,
    });
    assert.equal(!choice.ok && choice.reason, "WRONG_TRANSPORT");
  });

  test("another workspace's template is refused", () => {
    const choice = chooseTemplateForSend({
      template: template({ businessId: "biz-2", provider: "meta" }),
      businessId: BUSINESS,
      transport: "meta",
      variables,
    });
    assert.equal(!choice.ok && choice.reason, "WRONG_WORKSPACE");
  });

  test("a missing variable is refused", () => {
    const choice = chooseTemplateForSend({
      template: template(),
      businessId: BUSINESS,
      transport: "twilio",
      variables: { "1": "Priya" },
    });
    assert.equal(!choice.ok && choice.reason, "MISSING_VARIABLES");
    assert.match(!choice.ok ? choice.message : "", /\{\{2\}\}/);
  });

  test("an approved template on the right transport is chosen, with its category for cost", () => {
    const choice = chooseTemplateForSend({ template: template(), businessId: BUSINESS, transport: "twilio", variables });
    assert.equal(choice.ok, true);
    if (!choice.ok) return;
    assert.equal(choice.template.category, "UTILITY");
    assert.equal(choice.template.externalId, "HX0123456789abcdef");
    assert.deepEqual(choice.template.parameters, ["Priya", "Northwind"]);
    assert.equal(twilioContentVariables(choice.template), JSON.stringify({ "1": "Priya", "2": "Northwind" }));
  });

  test("the preview fills the body for the conversation view", () => {
    assert.equal(
      templatePreview("Hi {{1}}, from {{2}} {{3}}", { "1": "Priya", "2": "Northwind" }),
      "Hi Priya, from Northwind {{3}}",
    );
  });
});

/* ----------------------------------------------------- the send path --- */

function snapshot(): SendGuardSnapshot {
  return {
    lead: { status: "CONTACTED", optedOut: false, humanTakeover: false, automationActive: true, hasReplied: false },
    channel: { subscriptionActive: true, integrationHealthy: true, contactSuppressed: false },
    quietHours: { enabled: false, start: "20:00", end: "08:00", timezone: "Europe/London" },
    origin: "automation",
  };
}

function store(message: OutboundMessageRecord, gate: PolicyGate) {
  const record = { ...message };
  const sent: OutboundMessageRecord[] = [];
  const metered: OutboundMessageRecord[] = [];
  const s: SendStore = {
    async load() {
      return { ...record };
    },
    async claim() {
      if (record.status !== "QUEUED") return false;
      record.status = SENDING_STATUS;
      return true;
    },
    async reconcileInFlight() {},
    async snapshot() {
      return snapshot();
    },
    async policy() {
      return gate;
    },
    async blockedByPolicy() {
      record.status = "BLOCKED";
    },
    async markSent(m) {
      record.status = "SENT";
      sent.push(m);
    },
    async markFailed() {},
    async abort() {},
    async reschedule() {},
    async meter(m) {
      metered.push(m);
    },
  };
  return { s, sent, metered };
}

function provider() {
  const requests: SendRequest[] = [];
  const p: MessagingProvider = {
    name: "fake",
    async send(request) {
      requests.push(request);
      return { ok: true, providerMessageId: "SM1", provider: "fake" };
    },
    async verifyWebhook() {
      return false;
    },
    async parseInbound() {
      return [];
    },
    async parseStatus() {
      return [];
    },
  };
  return { p, requests };
}

const WHATSAPP: OutboundMessageRecord = {
  id: "msg-1",
  businessId: BUSINESS,
  leadId: "lead-1",
  channel: "whatsapp",
  body: "Free text that must not go out after the window",
  status: "QUEUED",
  sendKey: "run:1:step:2",
  to: "+447700900123",
  origin: "automation",
};

describe("performSend with a template", () => {
  const chosen = chooseTemplateForSend({
    template: template(),
    businessId: BUSINESS,
    transport: "twilio",
    variables: { "1": "Priya", "2": "Northwind" },
  });
  assert.ok(chosen.ok);
  const outbound = chosen.ok ? chosen.template : null;

  test("the carrier receives the template, and markSent and meter see its category", async () => {
    const { s, sent, metered } = store(WHATSAPP, { action: "allow", template: outbound! });
    const { p, requests } = provider();
    const outcome = await performSend({ store: s, provider: p, messageId: WHATSAPP.id });
    assert.equal(outcome.outcome, "sent");
    assert.equal(requests[0].template?.externalId, "HX0123456789abcdef");
    assert.equal(sent[0].template?.category, "UTILITY");
    assert.equal(metered[0].template?.category, "UTILITY");
  });

  test("inside the window (no template on the gate) the free-text body is sent", async () => {
    const { s } = store(WHATSAPP, { action: "allow" });
    const { p, requests } = provider();
    await performSend({ store: s, provider: p, messageId: WHATSAPP.id });
    assert.equal(requests[0].template, null);
    assert.equal(requests[0].body, WHATSAPP.body);
  });

  test("a template can never ride on a non-WhatsApp message", async () => {
    const { s } = store({ ...WHATSAPP, channel: "sms" }, { action: "allow", template: outbound! });
    const { p, requests } = provider();
    await performSend({ store: s, provider: p, messageId: WHATSAPP.id });
    assert.equal(requests[0].template, null);
  });

  test("a refused template is a block, and nothing reaches the carrier", async () => {
    const { s } = store(WHATSAPP, { action: "block", reasonCode: "REVIEW_REQUIRED", message: "no template" });
    const { p, requests } = provider();
    const outcome = await performSend({ store: s, provider: p, messageId: WHATSAPP.id });
    assert.equal(outcome.outcome, "blocked");
    assert.equal(requests.length, 0);
  });
});

describe("structure", () => {
  const sendStore = read("src/lib/jobs/handlers/send-store.ts");

  test("REQUIRE_TEMPLATE allows only with a chosen template, never free text", () => {
    const branch = sendStore.slice(sendStore.indexOf('if (decision.outcome === "REQUIRE_TEMPLATE")'));
    const end = branch.indexOf("\n      }\n");
    const body = branch.slice(0, end);
    assert.match(body, /chooseTemplateForSend\(/);
    assert.match(body, /return \{ action: "allow", template: choice\.template \};/);
    assert.doesNotMatch(body, /return \{ action: "allow" \};/);
  });

  test("a person's reply and the agent never go out as a template", () => {
    assert.match(sendStore, /message\.origin !== "automation" && message\.origin !== "campaign"/);
  });

  test("Twilio sends a template by ContentSid, without a Body", () => {
    const twilio = read("src/lib/messaging/twilio.ts");
    assert.match(twilio, /form\.set\("ContentSid", template\.externalId\)/);
    assert.match(twilio, /form\.set\("ContentVariables", twilioContentVariables\(template\)\)/);
  });

  test("the cost category is recorded on the message", () => {
    assert.match(sendStore, /sentExtras\.template_category = message\.template\.category/);
    const sql = read("supabase/migrations/0127_crm_pull_templates_email_meetings.sql");
    assert.match(sql, /template_category text/);
    assert.match(sql, /create table if not exists public\.whatsapp_templates/);
    assert.match(sql, /create table if not exists public\.whatsapp_step_templates/);
  });

  test("the agent's own window rule is untouched: it never sends a template", () => {
    const orchestrator = read("src/lib/agent/orchestrator.ts");
    assert.doesNotMatch(orchestrator, /ContentSid|chooseTemplateForSend/);
  });
});
