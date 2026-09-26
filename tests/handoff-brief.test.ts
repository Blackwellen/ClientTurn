import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildLeadBrief,
  chooseQuickBrief,
  deterministicQuickBrief,
  renderBriefForModel,
  renderBriefNote,
  validateQuickBrief,
  type BriefInput,
} from "../src/lib/handoff/brief.ts";

function input(overrides: Partial<BriefInput> = {}): BriefInput {
  return {
    lead: {
      id: "lead-1",
      firstName: "Priya",
      lastName: "Shah",
      company: "Northwind Studio",
      status: "QUALIFIED",
      qualificationState: "QUALIFIED",
      service: "Website rebuild",
      createdAt: "2026-09-20T09:00:00Z",
    },
    touches: [
      { occurredAt: "2026-09-20T08:59:00Z", sourceType: "AD_FORM", provider: "meta", campaign: "Autumn", form: "Rebuild" },
    ],
    score: { total: 78.4, grade: "B", why: "Clear need and a stated timeline.", confidence: 0.8 },
    tags: [{ tag: "HOT", reason: "Replied quickly" }],
    answers: [
      { question: "Timeline", value: "next quarter", source: "reply", inferred: false },
      { question: "Location", value: "Leeds", source: "form", inferred: true },
    ],
    questions: ["Timeline", "Location", "Budget"],
    messages: [
      { direction: "outbound", body: "Thanks Priya. I'll ask a couple of quick questions.", at: "2026-09-20T09:01:00Z", channel: "email" },
      { direction: "inbound", body: "We want it live next quarter but it's too expensive at the moment", at: "2026-09-20T09:05:00Z", channel: "email" },
      { direction: "inbound", body: "Can we book a call?", at: "2026-09-20T09:06:00Z", channel: "email" },
    ],
    meeting: null,
    opportunity: { stage: "QUALIFIED", outcome: "OPEN", value: 8000, currency: "GBP" },
    sales: { motion: "DIRECT_B2B", archetypeKey: null, dealSizeBand: "MID", hasApprovedInsight: false },
    handover: { reason: "HUMAN_REQUESTED", detail: "The lead asked for a call.", channel: "email" },
    ...overrides,
  };
}

describe("the Lead Brief is deterministic and complete", () => {
  test("same input, same brief", () => {
    assert.deepEqual(buildLeadBrief(input()), buildLeadBrief(input()));
  });

  test("carries every §58 field", () => {
    const brief = buildLeadBrief(input());
    assert.equal(brief.lead.name, "Priya Shah");
    assert.equal(brief.source.first?.provider, "meta");
    assert.equal(brief.score?.total, 78);
    assert.deepEqual(brief.tags, ["HOT"]);
    assert.ok(brief.promises.length >= 1, "promise from the business's own message");
    assert.ok(brief.nextStep.length > 0);
    assert.ok(brief.approach, "method router output");
    assert.equal(brief.approach?.motion, "DIRECT_B2B");
    assert.deepEqual(brief.unanswered, ["Budget"]);
    assert.equal(brief.handover.reason, "HUMAN_REQUESTED");
  });

  test("known vs inferred answers, with the lead's own words as evidence", () => {
    const brief = buildLeadBrief(input());
    const timeline = brief.answers.find((a) => a.question === "Timeline")!;
    const location = brief.answers.find((a) => a.question === "Location")!;
    assert.equal(timeline.known, true);
    assert.match(timeline.evidence?.text ?? "", /next quarter/);
    assert.equal(location.known, false);
    assert.equal(location.evidence, null);
  });

  test("objections are matched in inbound messages only, with the excerpt", () => {
    const brief = buildLeadBrief(input());
    assert.ok(brief.objections.length >= 1);
    assert.match(brief.objections[0].evidence.text, /expensive/);
  });

  test("the next step follows what the lead asked for", () => {
    assert.match(buildLeadBrief(input()).nextStep, /book a call/i);
    const booked = buildLeadBrief(
      input({ meeting: { startsAt: "2026-10-01T10:00:00Z", status: "scheduled", provider: "calendly", location: null } }),
    );
    assert.match(booked.nextStep, /booked meeting/);
  });

  test("works with no touches (lead_touches absent) and no score", () => {
    const brief = buildLeadBrief(input({ touches: [], score: null, tags: [] }));
    assert.equal(brief.source.first, null);
    assert.equal(brief.score, null);
  });
});

describe("the model sees the structured brief, never the transcript", () => {
  test("no whole message body appears in the model context", () => {
    const text = renderBriefForModel(buildLeadBrief(input()));
    assert.ok(!text.includes("Can we book a call?"));
    assert.ok(!text.includes("We want it live next quarter but it's too expensive at the moment"));
  });
});

describe("the 30-second brief introduces nothing", () => {
  const brief = buildLeadBrief(input());

  test("a faithful brief passes", () => {
    const ok = "Priya Shah from Northwind Studio wants a website rebuild next quarter and asked to book a call. Budget is still unknown.";
    assert.deepEqual(validateQuickBrief(ok, brief), { ok: true });
  });

  test("an invented number is rejected", () => {
    const check = validateQuickBrief("Priya wants a rebuild with a budget of 12000.", brief);
    assert.equal(check.ok, false);
  });

  test("a number present in the brief is allowed", () => {
    assert.deepEqual(validateQuickBrief("Priya scores 78 and wants a call.", brief), { ok: true });
  });

  test("an invented date is rejected", () => {
    assert.equal(validateQuickBrief("Priya wants to go live by Friday.", brief).ok, false);
    assert.equal(validateQuickBrief("Priya wants to launch in March.", brief).ok, false);
  });

  test("an invented name is rejected", () => {
    assert.equal(validateQuickBrief("Priya and her colleague Marcus want a call.", brief).ok, false);
  });

  test("a failing candidate falls back to the deterministic summary", () => {
    const chosen = chooseQuickBrief("Priya will pay 12000 on Friday.", brief);
    assert.equal(chosen.source, "deterministic");
    assert.equal(chosen.text, deterministicQuickBrief(brief));
    assert.ok(chosen.violations.length > 0);
  });

  test("no candidate (AI off / budget) uses the deterministic summary", () => {
    assert.equal(chooseQuickBrief(null, brief).source, "deterministic");
  });

  test("the deterministic summary passes its own validator", () => {
    assert.deepEqual(validateQuickBrief(deterministicQuickBrief(brief), brief), { ok: true });
  });

  test("the CRM note carries the quick brief and the key facts", () => {
    const note = renderBriefNote(brief, "Quick.");
    assert.match(note, /Quick\./);
    assert.match(note, /Timeline: next quarter/);
    assert.match(note, /Still unknown: Budget/);
  });
});
