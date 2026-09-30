/**
 * Regression tests for defects found in the customer-app core surface QA
 * (shell, Copilot, Dashboard, Leads, lead page, Inbox), 2026-09-30.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  defaultCustomRange,
  formatRangeLabel,
  resolveRange,
} from "../src/lib/dates.ts";

describe("Dashboard date range: Custom", () => {
  test("choosing Custom seeds real dates, so the range resolves to custom", () => {
    const now = new Date("2026-09-30T13:00:00Z");
    const seeded = defaultCustomRange("30d", now);
    assert.deepEqual(seeded, { from: "2026-09-01", to: "2026-09-30" });
    const range = resolveRange({ range: "custom", ...seeded });
    // Before the fix the picker sent `range=custom` alone, which fell back to
    // 30d and never showed the date inputs.
    assert.equal(range.key, "custom");
    assert.equal(range.days, 30);
  });

  test("the seeded window matches the preset it replaces", () => {
    const now = new Date("2026-09-30T13:00:00Z");
    assert.deepEqual(defaultCustomRange("7d", now), {
      from: "2026-09-24",
      to: "2026-09-30",
    });
  });

  test("custom range label does not roll the end date over in BST", () => {
    const range = resolveRange({
      range: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    const label = formatRangeLabel(range);
    assert.match(label, /30 Sept? 2026$/);
    assert.doesNotMatch(label, /Oct/);
  });
});

import { formatEvidenceValue } from "../src/lib/scoring/evidence-display.ts";

describe("Lead page: score evidence values read as words", () => {
  test("money, ratios, recency and timeline are formatted by label", () => {
    assert.equal(formatEvidenceValue("estimated value", "9000"), "£9,000");
    assert.equal(formatEvidenceValue("qualification answers met", "1"), "100%");
    assert.equal(formatEvidenceValue("qualification answers met", "0.5"), "50%");
    assert.equal(formatEvidenceValue("recency of last reply", "2"), "2 days ago");
    assert.equal(formatEvidenceValue("recency of last reply", "0"), "today");
    assert.equal(formatEvidenceValue("timeline", "1"), "within 1 day");
    assert.equal(formatEvidenceValue("messages from them", "1"), "1");
  });

  test("enum codes become words; free text is left alone", () => {
    assert.equal(formatEvidenceValue("qualification result", "NOT_QUALIFIED"), "not qualified");
    assert.equal(formatEvidenceValue("role authority", "Director"), "Director");
  });
});

import { formatPhoneDisplay } from "../src/lib/phone-display.ts";

describe("Phone numbers are grouped for reading", () => {
  test("UK mobile and London numbers", () => {
    assert.equal(formatPhoneDisplay("+447700900314"), "+44 7700 900314");
    assert.equal(formatPhoneDisplay("+442079460000"), "+44 20 7946 0000");
  });
  test("anything else is left exactly as stored", () => {
    assert.equal(formatPhoneDisplay("+15555550100"), "+15555550100");
    assert.equal(formatPhoneDisplay("07700 900314"), "07700 900314");
    assert.equal(formatPhoneDisplay(null), "");
  });
});

import { validateContactStep, CONTACT_LIMITS, contactPayloadSchema } from "../src/lib/leads/add-lead/types.ts";

describe("Add lead wizard: step 1 enforces the server's limits", () => {
  const base = {
    firstName: "Test",
    lastName: "Lead",
    company: "TEST Ltd",
    email: "test@example.com",
    mobile: "",
    telephone: "",
    postcode: "SW1A 1AA",
    address: "",
  };
  test("an over-long name is caught on step 1, not at Create", () => {
    const errors = validateContactStep({ ...base, firstName: "A".repeat(300) });
    assert.equal(errors.firstName, "Keep this under 80 characters.");
    // And it is exactly what the server would refuse.
    assert.equal(contactPayloadSchema.safeParse({ ...base, firstName: "A".repeat(300) }).success, false);
  });
  test("a value at the limit passes both", () => {
    const at = { ...base, company: "C".repeat(CONTACT_LIMITS.company) };
    assert.deepEqual(validateContactStep(at), {});
    assert.equal(contactPayloadSchema.safeParse(at).success, true);
  });
});

import { cleanCopilotReply } from "../src/lib/copilot/reply-text.ts";

describe("Copilot reply text", () => {
  test("a paragraph the model repeated back to back is shown once", () => {
    const said = "I can't pause campaigns from here.";
    assert.equal(cleanCopilotReply(`${said}\n${said}`), said);
    assert.equal(cleanCopilotReply(`${said}\n\n${said}`), said);
  });
  test("distinct lines, markdown markers and an empty reply", () => {
    assert.equal(cleanCopilotReply("**Two** leads\n- Tomasz\n- Oliver"), "Two leads\nTomasz\nOliver");
    assert.equal(cleanCopilotReply(null), "I could not work that out.");
  });
});

import { liveImportTally } from "../src/lib/imports/classify.ts";

describe("Import review tiles follow the operator's decisions", () => {
  test("a decided review row moves out of Needs review", () => {
    const counts = { IMPORT_AS_LEAD: 0, IMPORT_AS_PROSPECT: 0, REVIEW: 5, SKIP: 0 };
    const rows = [
      { classification: "REVIEW" as const, userClassification: "IMPORT_AS_LEAD" as const },
      { classification: "REVIEW" as const, userClassification: "IMPORT_AS_PROSPECT" as const },
      { classification: "REVIEW" as const, userClassification: "SKIP" as const },
      { classification: "REVIEW" as const, userClassification: null },
      { classification: "REVIEW" as const, userClassification: null },
    ];
    assert.deepEqual(liveImportTally(counts, rows), {
      IMPORT_AS_LEAD: 1,
      IMPORT_AS_PROSPECT: 1,
      REVIEW: 2,
      SKIP: 1,
    });
    // The server's figures are not mutated.
    assert.equal(counts.REVIEW, 5);
  });
});
