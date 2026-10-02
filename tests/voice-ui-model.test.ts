import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toCallCard, type CallCardRow } from "../src/lib/voice/call-view.ts";
import {
  canEditSection,
  canReleaseNumber,
  openerPreview,
  sectionsTouched,
  validateVoiceSettingsUpdate,
  voiceSettingsUpdateSchema,
  VOICE_SETTINGS_SECTIONS,
  type VoiceSettingsUpdate,
} from "../src/lib/voice/settings-model.ts";
import {
  addressFromLines,
  lockedOpenerPreview,
  parseVoicePanel,
  voiceStatus,
  windowProblem,
} from "../src/lib/voice/settings-ui.ts";

/**
 * The voice UI's view models (P2): what reaches the browser for each role,
 * and who may change what in Settings -> Voice. Pure: fakes only, no network.
 */

const ROW: CallCardRow = {
  id: "0f5b7a52-4c1a-4a53-9f7e-2c2d0e3b1a01",
  direction: "OUTBOUND",
  route: "QUALIFICATION",
  state: "COMPLETE",
  to_e164: "+447700900123",
  from_e164: "+442079460000",
  created_at: "2026-09-27T09:00:00Z",
  started_at: "2026-09-27T09:00:05Z",
  answered_at: "2026-09-27T09:00:12Z",
  ended_at: "2026-09-27T09:03:20Z",
  duration_sec: 195,
  billed_sec: 240,
  outcome: "ANSWERED",
  recording_enabled: true,
  persona_name: "Sam",
  attempt_number: 1,
};

function card(viewerRole: string) {
  return toCallCard({
    row: ROW,
    outcome: {
      disposition: "MEETING_BOOKED",
      summary: "Booked a discovery call for Thursday.",
      facts: { wants_meeting: true, model_reasoning: "internal", _raw: "x", urgency: "high" },
      next_action: "Send the calendar invite",
      callback_requested_for: null,
    },
    transcript: [
      { role: "agent", content: "This is an AI assistant calling from Acme." },
      { role: "user", content: "Hi." },
    ],
    recording: { status: "STORED", url: "https://signed.example/rec?sig=1" },
    objections: [{ objection_key: "price_too_high", handled_outcome: "RESOLVED" }],
    costGbp: 0.42,
    viewerRole,
  });
}

describe("call card cost redaction", () => {
  // Serving cost is platform-admin only (owner decision 2026-09-30): no
  // workspace role receives it, owners and admins included.
  for (const role of ["owner", "admin", "member", "viewer", "", "unknown"]) {
    test(`${role || "no role"} never receives the cost`, () => {
      const c = card(role);
      assert.equal(c.costGbp, null);
      assert.equal(JSON.stringify(c).includes("0.42"), false);
    });
  }

  test("reasoning-like facts are dropped for every role", () => {
    for (const role of ["owner", "member"]) {
      const labels = card(role).facts.map((f) => f.label);
      assert.deepEqual(labels.sort(), ["Urgency", "Wants a meeting"]);
    }
  });

  test("the rest of the card is the same for every role", () => {
    const owner = card("owner");
    const member = card("member");
    assert.deepEqual({ ...owner, costGbp: null }, member);
    assert.equal(member.recordingUrl, "https://signed.example/rec?sig=1");
    assert.equal(member.durationLabel, "3m 15s");
    assert.equal(member.billedMinutes, 4);
  });
});

describe("settings RBAC", () => {
  test("owners and admins can edit every section; members and viewers none", () => {
    for (const section of VOICE_SETTINGS_SECTIONS) {
      assert.equal(canEditSection("owner", section), true, section);
      assert.equal(canEditSection("admin", section), true, section);
      assert.equal(canEditSection("member", section), false, section);
      assert.equal(canEditSection("viewer", section), false, section);
      assert.equal(canEditSection("stranger", section), false, section);
    }
  });

  test("identity, number (regulatory) and billing-adjacent sections are admin-gated", () => {
    for (const section of ["identity", "number", "budget"] as const) {
      assert.equal(canEditSection("member", section), false);
    }
  });

  test("only the owner can release the number", () => {
    assert.equal(canReleaseNumber("owner"), true);
    assert.equal(canReleaseNumber("admin"), false);
    assert.equal(canReleaseNumber("member"), false);
    assert.equal(canReleaseNumber("viewer"), false);
  });

  test("sectionsTouched names what each panel's save changes", () => {
    assert.deepEqual(sectionsTouched({ voiceEnabled: true }), ["overview"]);
    assert.deepEqual(sectionsTouched({ agent: { personaName: "Sam", openerSuffix: null } }), ["agent"]);
    assert.deepEqual(sectionsTouched({ recording: { enabled: true, retentionDays: 30 } }), ["recording"]);
    const regulatory = voiceSettingsUpdateSchema.parse({
      regulatory: {
        companyNumber: "12 345 678",
        websiteUrl: "https://acme.example",
        registeredAddress: { line1: "1 High Street", city: "London", postcode: "EC1A 1BB" },
        representative: { firstName: "Ada", lastName: "Lovelace", phone: "+447700900123", workEmail: "ada@acme.example" },
      },
    });
    assert.equal(regulatory.regulatory?.companyNumber, "12345678");
    assert.deepEqual(sectionsTouched(regulatory), ["number"]);
    assert.deepEqual(sectionsTouched({}), []);
  });

  test("the schema refuses unknown keys (a panel can't smuggle a field)", () => {
    assert.equal(voiceSettingsUpdateSchema.safeParse({ adminKillSwitch: false }).success, false);
  });
});

describe("validateVoiceSettingsUpdate", () => {
  const empty = { calling_as_name: null, legal_entity_name: null, identification_contact: null, assistant_persona_name: null };
  const complete = {
    calling_as_name: "Acme",
    legal_entity_name: "Acme Ltd",
    identification_contact: "1 High Street, London EC1A 1BB",
    assistant_persona_name: null,
  };

  test("voice can't be switched on before the identity is complete", () => {
    const problems = validateVoiceSettingsUpdate({ voiceEnabled: true }, empty);
    assert.equal(problems[0]?.problem, "IDENTITY_INCOMPLETE");
    assert.deepEqual(validateVoiceSettingsUpdate({ voiceEnabled: true }, complete), []);
  });

  test("the opener suffix follows house style", () => {
    const withDash: VoiceSettingsUpdate = { agent: { openerSuffix: "Quick one — are you free?" } };
    assert.equal(validateVoiceSettingsUpdate(withDash, complete)[0]?.problem, "STYLE");
    assert.deepEqual(validateVoiceSettingsUpdate({ agent: { openerSuffix: "We help agencies book more calls." } }, complete), []);
  });

  test("route shares can't add up to more than 100%", () => {
    const over: VoiceSettingsUpdate = {
      routes: [
        { route: "QUALIFICATION", enabled: true, percent: 70 },
        { route: "NURTURE", enabled: true, percent: 40 },
      ],
    };
    assert.equal(validateVoiceSettingsUpdate(over, complete)[0]?.problem, "ALLOCATION");
  });

  test("a transfer mode other than never needs a number", () => {
    const problems = validateVoiceSettingsUpdate({ transfer: { numberE164: null, mode: "ON_REQUEST" } }, complete);
    assert.equal(problems[0]?.field, "transfer.numberE164");
    assert.deepEqual(validateVoiceSettingsUpdate({ transfer: { numberE164: null, mode: "NEVER" } }, complete), []);
  });
});

describe("settings display helpers", () => {
  test("the client-side opener preview matches settings-model's", () => {
    for (const recordingEnabled of [true, false]) {
      assert.equal(
        lockedOpenerPreview("Acme", recordingEnabled),
        openerPreview({ callingAsName: "Acme", recordingEnabled, openerSuffix: null }).locked,
      );
    }
    assert.equal(lockedOpenerPreview("  ", true), null);
  });

  test("status: locked, paused and integration come before on/off", () => {
    const base = { locked: false, adminKillSwitch: false, integrationReady: true, voiceEnabled: true, allowed: true };
    assert.equal(voiceStatus(base), "ON");
    assert.equal(voiceStatus({ ...base, allowed: false }), "NOT_READY");
    assert.equal(voiceStatus({ ...base, voiceEnabled: false }), "OFF");
    assert.equal(voiceStatus({ ...base, integrationReady: false }), "INTEGRATION_REQUIRED");
    assert.equal(voiceStatus({ ...base, adminKillSwitch: true, integrationReady: false }), "PAUSED");
    assert.equal(voiceStatus({ ...base, locked: true, adminKillSwitch: true }), "LOCKED");
  });

  test("panel query values are validated", () => {
    assert.equal(parseVoicePanel("number"), "number");
    assert.equal(parseVoicePanel("../billing"), "overview");
    assert.equal(parseVoicePanel(undefined), "overview");
  });

  test("address lines split into the bundle's parts", () => {
    assert.deepEqual(addressFromLines(["Unit 4", "10 Mill Lane", "Leeds", "LS1 4AB"]), {
      line1: "Unit 4",
      line2: "10 Mill Lane",
      city: "Leeds",
      postcode: "LS1 4AB",
    });
    assert.deepEqual(addressFromLines([]), { line1: "", line2: "", city: "", postcode: "" });
  });

  test("calling windows mirror the 08:00 to 21:00 bounds", () => {
    assert.equal(windowProblem({ start: "09:00", end: "17:00" }), null);
    assert.match(windowProblem({ start: "07:30", end: "17:00" }) ?? "", /08:00/);
    assert.match(windowProblem({ start: "09:00", end: "21:30" }) ?? "", /21:00/);
    assert.match(windowProblem({ start: "12:00", end: "12:00" }) ?? "", /before/);
  });
});
