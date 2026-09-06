import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_SECTIONS,
  canEditMember,
  defaultBusinessHours,
  isLastOwner,
  parseBusinessHours,
  parseSettingsSection,
  planLabel,
  timezoneLabel,
  usagePercent,
  usageTone,
  summariseHours,
  type BusinessRole,
} from "../src/lib/settings/types.ts";
import {
  AVAILABILITY_META,
  CATEGORY_ORDER,
  NOT_AVAILABLE_REASON,
  PROVIDERS,
  connectionActions,
  providerAvailability,
  summariseConnections,
  type ProviderCardModel,
  type ProviderType,
} from "../src/lib/integrations/catalog.ts";
import { invoiceStatusMeta } from "../src/lib/billing/types.ts";
import { brandMarkFile, brandMarkSrc } from "../src/lib/integrations/brand-marks.ts";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* ------------------------------------------------------------- settings IA */

describe("settings sections", () => {
  // V4 section 24.1 adds Business Profile, which holds the ICPs and conversion
  // goals that Find Leads, agents and intent monitors all target. The order is
  // still asserted exactly: Settings is one route, and the rail order is part
  // of the IA rather than an implementation detail.
  test("the sections are the documented set, in order", () => {
    assert.deepEqual(
      SETTINGS_SECTIONS.map((section) => section.id),
      ["workspace", "connections", "business-profile", "team", "billing"],
    );
  });

  test("every section carries a label and a descriptor", () => {
    for (const section of SETTINGS_SECTIONS) {
      assert.ok(section.label.length > 0, `${section.id} has no label`);
      assert.ok(section.description.length > 0, `${section.id} has no description`);
    }
  });

  test("an unknown or missing section falls back to workspace", () => {
    assert.equal(parseSettingsSection("billing"), "billing");
    assert.equal(parseSettingsSection("qualification"), "workspace");
    assert.equal(parseSettingsSection(undefined), "workspace");
    assert.equal(parseSettingsSection(["team", "billing"]), "workspace");
    assert.equal(parseSettingsSection("__proto__"), "workspace");
  });
});

/* ------------------------------------------------------------ workspace */

describe("business hours", () => {
  test("a malformed jsonb value still yields a complete week", () => {
    const hours = parseBusinessHours({ mon: { open: "yes", start: "8am" } });
    assert.equal(Object.keys(hours).length, 7);
    assert.equal(hours.mon.start, defaultBusinessHours().mon.start);
  });

  test("stored values survive the round trip", () => {
    const hours = parseBusinessHours({
      sat: { open: true, start: "09:00", end: "16:00" },
    });
    assert.deepEqual(hours.sat, { open: true, start: "09:00", end: "16:00" });
  });

  test("the preview groups consecutive identical days and names closed ones", () => {
    const hours = defaultBusinessHours();
    hours.sat = { open: true, start: "09:00", end: "16:00" };
    hours.sun = { open: false, start: "09:00", end: "13:00" };

    const lines = summariseHours(hours);
    assert.deepEqual(lines, [
      "Mon – Fri: 8:00 AM – 6:00 PM",
      "Sat: 9:00 AM – 4:00 PM",
      "Sun: Closed",
    ]);
  });

  test("midnight and noon are not both rendered as 12 PM", () => {
    const hours = defaultBusinessHours();
    for (const day of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const) {
      hours[day] = { open: true, start: "00:00", end: "12:00" };
    }
    assert.deepEqual(summariseHours(hours), ["Mon – Sun: 12:00 AM – 12:00 PM"]);
  });
});

describe("timezone labels", () => {
  test("the IANA identifier is what a label is derived from, never replaced", () => {
    const label = timezoneLabel("Europe/London");
    assert.match(label, /^\(GMT[+-]\d{2}:\d{2}\) London$/);
  });

  test("an unknown zone degrades to the identifier rather than throwing", () => {
    assert.equal(timezoneLabel("Not/AZone"), "Not/AZone");
  });
});

/* ----------------------------------------------------------- connections */

function card(
  overrides: Partial<ProviderCardModel> & { id: ProviderType },
): ProviderCardModel {
  const definition = PROVIDERS.find((row) => row.id === overrides.id);
  assert.ok(definition, `${overrides.id} is not in the catalogue`);
  return {
    definition,
    integration: null,
    block: null,
    connected: false,
    status: "DISCONNECTED",
    ...overrides,
  };
}

describe("provider catalogue", () => {
  test("the Connections design's providers are all present", () => {
    const expected: ProviderType[] = [
      "meta",
      "google_ads",
      "microsoft_ads",
      "tiktok_ads",
      "linkedin_ads",
      "twilio_sms",
      "twilio_whatsapp",
      "slack",
      "google_calendar",
      "calendly",
      "hubspot",
      "zoho_crm",
      "salesforce",
      "email",
    ];
    for (const id of expected) {
      assert.ok(
        PROVIDERS.some((provider) => provider.id === id),
        `${id} is missing from the catalogue`,
      );
    }
  });

  test("every provider has copy, a category in the render order and no duplicate id", () => {
    const seen = new Set<string>();
    for (const provider of PROVIDERS) {
      assert.ok(!seen.has(provider.id), `${provider.id} is duplicated`);
      seen.add(provider.id);
      assert.ok(provider.summary.length > 0, `${provider.id} has no summary`);
      assert.ok(
        provider.disconnectConsequence.length > 0,
        `${provider.id} does not say what disconnecting breaks`,
      );
      assert.ok(CATEGORY_ORDER.includes(provider.category));
    }
  });

  test("Resend is platform-run, so it can never be connected by a customer", () => {
    const resend = PROVIDERS.find((provider) => provider.id === "email");
    assert.equal(resend?.connection, "platform");

    const actions = connectionActions(card({ id: "email", connected: true }));
    assert.equal(actions.availability, "SYSTEM_MANAGED");
    assert.equal(actions.primaryLabel, null);
    assert.equal(actions.canConnect, false);
    assert.equal(actions.canDisconnect, false);
    assert.equal(actions.canTest, false);
  });
});

describe("connection availability", () => {
  test("a provider the platform cannot connect never offers Connect", () => {
    const model = card({
      id: "meta",
      block: { kind: "unavailable", reason: NOT_AVAILABLE_REASON },
    });
    const actions = connectionActions(model);
    assert.equal(actions.availability, "NOT_AVAILABLE");
    assert.equal(actions.canConnect, false);
    assert.equal(actions.primaryLabel, "Not yet available");
  });

  test("a plan-gated provider is distinguished from an unavailable one", () => {
    const model = card({
      id: "twilio_whatsapp",
      block: { kind: "plan", reason: "WhatsApp is included on Growth and above." },
    });
    assert.equal(providerAvailability(model), "PLAN_LOCKED");
    assert.equal(connectionActions(model).canConnect, false);
  });

  test("expired authorisation asks for a reconnect, not a first connect", () => {
    const model = card({
      id: "slack",
      connected: true,
      status: "ACTION_REQUIRED",
    });
    const actions = connectionActions(model);
    assert.equal(actions.availability, "RECONNECT_REQUIRED");
    assert.equal(actions.primaryLabel, "Reconnect");
    assert.equal(actions.canTest, true);
    assert.equal(actions.canDisconnect, true);
  });

  test("a healthy workspace connection can be tested and disconnected", () => {
    const model = card({ id: "slack", connected: true, status: "HEALTHY" });
    const actions = connectionActions(model);
    assert.equal(actions.availability, "CONNECTED");
    assert.equal(actions.primaryLabel, null);
    assert.equal(actions.canTest, true);
  });

  test("every availability state has a label and a tone", () => {
    for (const [state, meta] of Object.entries(AVAILABILITY_META)) {
      assert.ok(meta.label.length > 0, `${state} has no label`);
      assert.ok(meta.tone.length > 0, `${state} has no tone`);
    }
  });
});

describe("connection health summary", () => {
  test("counts connected, unavailable and broken separately", () => {
    const summary = summariseConnections(
      [
        card({ id: "slack", connected: true, status: "HEALTHY" }),
        card({ id: "email", connected: true }),
        card({
          id: "meta",
          block: { kind: "unavailable", reason: NOT_AVAILABLE_REASON },
        }),
        card({ id: "calendly", connected: true, status: "ACTION_REQUIRED" }),
        card({ id: "hubspot" }),
      ],
      "2026-09-05T10:24:00.000Z",
    );

    assert.equal(summary.total, 5);
    assert.equal(summary.connected, 2);
    assert.equal(summary.notAvailable, 1);
    assert.equal(summary.needsAttention, 1);
    assert.equal(summary.lastCheckedAt, "2026-09-05T10:24:00.000Z");
  });

  test("an empty workspace summarises to zeroes rather than throwing", () => {
    const summary = summariseConnections([], null);
    assert.deepEqual(summary, {
      total: 0,
      connected: 0,
      notAvailable: 0,
      needsAttention: 0,
      lastCheckedAt: null,
    });
  });
});

/* ------------------------------------------------------------------- team */

const members = [
  { role: "owner" as BusinessRole, status: "active" },
  { role: "admin" as BusinessRole, status: "active" },
  { role: "member" as BusinessRole, status: "invited" },
];

describe("team safety rules", () => {
  test("an owner row is never editable from the table", () => {
    assert.equal(
      canEditMember({
        actorRole: "owner",
        memberRole: "owner",
        isSelf: false,
        ownerCount: 2,
      }),
      false,
    );
  });

  test("nobody edits their own row", () => {
    assert.equal(
      canEditMember({
        actorRole: "admin",
        memberRole: "admin",
        isSelf: true,
        ownerCount: 1,
      }),
      false,
    );
  });

  test("a member cannot manage anyone", () => {
    assert.equal(
      canEditMember({
        actorRole: "member",
        memberRole: "member",
        isSelf: false,
        ownerCount: 1,
      }),
      false,
    );
  });

  test("an admin can manage a non-owner who is not themselves", () => {
    assert.equal(
      canEditMember({
        actorRole: "admin",
        memberRole: "member",
        isSelf: false,
        ownerCount: 1,
      }),
      true,
    );
  });

  test("the only owner is recognised as the last one", () => {
    assert.equal(isLastOwner(members, "owner"), true);
    assert.equal(isLastOwner(members, "admin"), false);
    assert.equal(
      isLastOwner([...members, { role: "owner", status: "active" }], "owner"),
      false,
    );
  });

  test("a removed owner does not count towards keeping one", () => {
    assert.equal(
      isLastOwner(
        [
          { role: "owner", status: "active" },
          { role: "owner", status: "removed" },
        ],
        "owner",
      ),
      true,
    );
  });
});

/* ---------------------------------------------------------------- billing */

describe("usage meters", () => {
  test("percentages are clamped and rounded", () => {
    assert.equal(usagePercent(1248, 5000), 25);
    assert.equal(usagePercent(8421, 25000), 34);
    assert.equal(usagePercent(9000, 5000), 100);
    assert.equal(usagePercent(10, 0), 0);
  });

  test("tone escalates as an allowance is consumed", () => {
    assert.equal(usageTone(10, 100), "success");
    assert.equal(usageTone(85, 100), "warning");
    assert.equal(usageTone(100, 100), "danger");
  });

  test("plan names read as a customer expects", () => {
    assert.equal(planLabel("trial"), "Free trial");
    assert.equal(planLabel("enterprise"), "Enterprise");
  });
});

describe("invoice status", () => {
  test("Stripe statuses map to one tone each", () => {
    assert.deepEqual(invoiceStatusMeta("paid"), { label: "Paid", tone: "success" });
    assert.equal(invoiceStatusMeta("open").tone, "warning");
    assert.equal(invoiceStatusMeta("uncollectible").tone, "danger");
  });

  test("an unrecognised status is shown rather than swallowed", () => {
    assert.deepEqual(invoiceStatusMeta("weird"), { label: "weird", tone: "neutral" });
  });
});

/* ------------------------------------------------------- brand marks */

const BRANDS_DIR = fileURLToPath(new URL("../public/brands/", import.meta.url));

describe("provider brand marks", () => {
  test("every provider in the catalogue has a mark", () => {
    for (const provider of PROVIDERS) {
      assert.ok(
        brandMarkFile(provider.id),
        `${provider.id} has no brand mark mapped`,
      );
    }
  });

  test("every mapped mark exists on disk", () => {
    for (const provider of PROVIDERS) {
      const file = brandMarkFile(provider.id);
      assert.ok(
        existsSync(`${BRANDS_DIR}${file}.svg`),
        `public/brands/${file}.svg is missing (referenced by ${provider.id})`,
      );
    }
  });

  test("marks resolve to a public path, not an external host", () => {
    for (const provider of PROVIDERS) {
      const src = brandMarkSrc(provider.id);
      assert.ok(src?.startsWith("/brands/"), `${provider.id} is not local`);
      assert.doesNotMatch(
        src ?? "",
        /^https?:/,
        `${provider.id} would be fetched from a third party at runtime`,
      );
    }
  });
});
