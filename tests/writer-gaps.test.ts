import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  hasWhatsAppOptIn,
  isoDate,
  optInProblem,
  withWhatsAppScope,
} from "../src/lib/leads/whatsapp-opt-in.ts";
import {
  reactivationAllowance,
  reactivationLimitProblem,
} from "../src/lib/campaigns/reactivation-limit.ts";
import { MESSAGE_CREDIT_BUNDLES, creditBundlesFor } from "../src/lib/billing/plans.ts";
import { parseCalendlyEventType } from "../src/lib/bookings/calendly-event-type.ts";
import { callerAllowed } from "../src/lib/services/types.ts";
import { serviceOperation } from "../src/lib/services/registry.ts";
import { permissionPayloadSchema } from "../src/lib/leads/add-lead/types.ts";
import {
  initialWizardState,
  validateAudienceStep,
} from "../src/components/reactivation/wizard/state.ts";

const NOW = new Date("2026-09-26T12:00:00Z");

describe("WhatsApp opt-in", () => {
  test("the scope gains WhatsApp without losing anything", () => {
    assert.deepEqual(withWhatsAppScope([]), ["WHATSAPP"]);
    assert.deepEqual(withWhatsAppScope(["SMS"]), ["SMS", "WHATSAPP"]);
    assert.deepEqual(withWhatsAppScope(["whatsapp"]), ["whatsapp"]);
    assert.deepEqual(withWhatsAppScope(null), ["WHATSAPP"]);
    assert.equal(hasWhatsAppOptIn(["WhatsApp"]), true);
    assert.equal(hasWhatsAppOptIn("WHATSAPP"), false);
  });

  test("a date, a known source, and detail for Other", () => {
    assert.equal(optInProblem({ optedInOn: "2026-09-20", source: "PHONE_CALL" }, NOW), null);
    assert.equal(optInProblem({ optedInOn: isoDate(NOW), source: "LEAD_FORM" }, NOW), null);
    assert.match(optInProblem({ optedInOn: "2026-10-02", source: "PHONE_CALL" }, NOW) ?? "", /future/);
    assert.ok(optInProblem({ optedInOn: "2026-02-30", source: "PHONE_CALL" }, NOW));
    assert.ok(optInProblem({ optedInOn: "yesterday", source: "PHONE_CALL" }, NOW));
    assert.ok(optInProblem({ optedInOn: "2026-09-20", source: "CARRIER_PIGEON" }, NOW));
    assert.ok(optInProblem({ optedInOn: "2026-09-20", source: "OTHER" }, NOW));
    assert.equal(
      optInProblem({ optedInOn: "2026-09-20", source: "OTHER", detail: "Signed up at the stand" }, NOW),
      null,
    );
  });

  test("tomorrow's date is allowed only as far as a time zone ahead of UTC reaches", () => {
    const lateEvening = new Date("2026-09-26T23:00:00Z");
    assert.equal(optInProblem({ optedInOn: "2026-09-27", source: "EMAIL" }, lateEvening), null);
    assert.ok(optInProblem({ optedInOn: "2026-09-28", source: "EMAIL" }, lateEvening));
  });

  test("the operation is a person's act: never Copilot or an unattended agent", () => {
    const op = serviceOperation("lead.record_whatsapp_opt_in");
    assert.ok(op);
    assert.equal(callerAllowed(op, "UI"), true);
    assert.equal(callerAllowed(op, "COPILOT"), false);
    assert.equal(callerAllowed(op, "AGENT"), false);
    assert.notEqual(op.minimumRole, "viewer");
  });

  test("the Add lead wizard's opt-in box defaults to unticked", () => {
    const parsed = permissionPayloadSchema.parse({ relationship: "THEY_CONTACTED_US", evidence: "" });
    assert.equal(parsed.whatsappOptIn, false);
    assert.equal(
      permissionPayloadSchema.parse({ relationship: "THEY_CONTACTED_US", evidence: "", whatsappOptIn: true })
        .whatsappOptIn,
      true,
    );
  });
});

describe("reactivation contact allowance", () => {
  test("remaining never goes below zero", () => {
    assert.deepEqual(reactivationAllowance(100, 40), { limit: 100, used: 40, remaining: 60 });
    assert.deepEqual(reactivationAllowance(100, 140), { limit: 100, used: 140, remaining: 0 });
  });

  test("an audience that fits is allowed; one that does not is the plan-limit state", () => {
    const allowance = reactivationAllowance(500, 450);
    assert.equal(reactivationLimitProblem(allowance, 50), null);
    assert.match(reactivationLimitProblem(allowance, 51) ?? "", /500 reactivation contacts.*50 are left.*51/);
    assert.match(reactivationLimitProblem(reactivationAllowance(100, 100), 1) ?? "", /none are left/);
    assert.match(reactivationLimitProblem(reactivationAllowance(0, 0), 1) ?? "", /does not include/);
  });

  test("the wizard blocks the audience step over the limit", () => {
    const state = { ...initialWizardState("sms"), campaignName: "Autumn" };
    const base = { eligible: 120, audienceReady: true, csvBusy: false };
    const over = validateAudienceStep(state, { ...base, allowance: reactivationAllowance(100, 0) });
    assert.equal(over.valid, false);
    assert.match(over.fields.audience ?? "", /100 reactivation contacts/);
    const fits = validateAudienceStep(state, { ...base, allowance: reactivationAllowance(500, 0) });
    assert.equal(fits.fields.audience, undefined);
  });
});

describe("credit bundles follow the plan's channels", () => {
  test("no WhatsApp credit without WhatsApp", () => {
    const starter = creditBundlesFor({ whatsappEnabled: false });
    assert.ok(starter.length > 0);
    assert.ok(starter.every((bundle) => bundle.channel === "sms"));
    assert.equal(creditBundlesFor({ whatsappEnabled: true }).length, MESSAGE_CREDIT_BUNDLES.length);
  });
});

describe("Calendly event type", () => {
  const id = "AAAABBBB-CCCC-DDDD-EEEE-FFFF00001111";

  test("the API URI and the edit-page address both resolve to the URI", () => {
    const uri = `https://api.calendly.com/event_types/${id}`;
    assert.deepEqual(parseCalendlyEventType(uri), { ok: true, uri });
    assert.deepEqual(parseCalendlyEventType(`https://calendly.com/event_types/${id}/edit`), { ok: true, uri });
    assert.deepEqual(parseCalendlyEventType(`  https://calendly.com/event_types/${id}  `), { ok: true, uri });
  });

  test("blank clears it; a booking link or anything else is refused", () => {
    assert.deepEqual(parseCalendlyEventType(""), { ok: true, uri: null });
    assert.equal(parseCalendlyEventType("https://calendly.com/acme/30min").ok, false);
    assert.equal(parseCalendlyEventType(`http://api.calendly.com/event_types/${id}`).ok, false);
    assert.equal(parseCalendlyEventType(`https://evil.example/event_types/${id}`).ok, false);
  });
});
