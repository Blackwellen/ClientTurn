import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AgentBlocked,
  GOVERNED_PROVIDERS,
  agentRunState,
  chooseReengagementChannel,
  enrolmentScope,
  excludedProvidersFor,
  failureStatus,
  runButton,
  selectEnrollable,
  sourcingReviewMode,
  workForType,
} from "../src/lib/agents/policy.ts";
import {
  AGENT_TYPE_DEFINITIONS,
  autonomyDescription,
  readinessProblems,
  sourcesForType,
} from "../src/lib/agents/types.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("agents: combined agents do all three jobs (1)", () => {
  test("a combined tick sources, chases bookings and re-engages", () => {
    assert.deepEqual(workForType("COMBINED"), ["SOURCING", "BOOKING", "REENGAGEMENT"]);
    assert.deepEqual(workForType("SOURCING"), ["SOURCING"]);
    assert.deepEqual(workForType("BOOKING"), ["BOOKING"]);
    assert.deepEqual(workForType("REENGAGEMENT"), ["REENGAGEMENT"]);
  });

  test("the scheduler runs every job for the type and records each", () => {
    const source = read("src/lib/agents/scheduler.ts");
    assert.match(source, /workForType\(/);
    assert.match(source, /runBookingTick/);
    assert.match(source, /runReengagementTick/);
    assert.match(source, /recordTick\(/);
  });
});

describe("agents: approval setting has real behaviour (2)", () => {
  test("review everything keeps human review; the others ask for auto-contact", () => {
    assert.equal(sourcingReviewMode("REVIEW_ALL"), "HUMAN_REVIEW");
    assert.equal(sourcingReviewMode("REVIEW_NEW"), "AUTO_CONTACT");
    assert.equal(sourcingReviewMode("AUTO"), "AUTO_CONTACT");
    assert.equal(enrolmentScope("REVIEW_ALL"), "NONE");
    assert.equal(enrolmentScope("REVIEW_NEW"), "KNOWN_COMPANIES");
    assert.equal(enrolmentScope("AUTO"), "ALL");
  });

  test("review-new enrols only prospects at companies that existed before the run", () => {
    const companies = new Map([
      ["old", "2026-09-01T00:00:00Z"],
      ["new", "2026-09-26T10:00:01Z"],
    ]);
    const prospects = [
      { id: "p1", companyId: "old" },
      { id: "p2", companyId: "new" },
      { id: "p3", companyId: null },
    ];
    const result = selectEnrollable(prospects, companies, "2026-09-26T10:00:00Z", "KNOWN_COMPANIES");
    assert.deepEqual(result.enrol, ["p1"]);
    assert.deepEqual(result.held, ["p2", "p3"]);
    assert.deepEqual(selectEnrollable(prospects, companies, "2026-09-26T10:00:00Z", "ALL").enrol, ["p1", "p2", "p3"]);
    assert.deepEqual(selectEnrollable(prospects, companies, "2026-09-26T10:00:00Z", "NONE").enrol, []);
  });

  test("an auto-contact refusal falls back to human review instead of failing", () => {
    const source = read("src/lib/agents/scheduler.ts");
    assert.match(source, /AUTO_CONTACT_NOT_PERMITTED/);
    assert.match(source, /reviewMode: "HUMAN_REVIEW"/);
  });

  test("the worker narrows enrolment for review-new agents", () => {
    const worker = read("src/lib/jobs/handlers/sourcing-run.ts");
    assert.match(worker, /selectEnrollable\(/);
    assert.match(worker, /context\.enrolment === "KNOWN_COMPANIES"/);
  });

  test("re-engagement never launches; the copy says so", () => {
    assert.match(autonomyDescription("AUTO"), /always left as drafts/);
    assert.doesNotMatch(read("src/lib/agents/ticks.ts"), /campaign\.launch"|launchCampaign/);
  });
});

describe("agents: sources restrict the run (3)", () => {
  test("unselected catalogue sources are excluded from the provider waterfall", () => {
    const excluded = excludedProvidersFor(["GOOGLE_PLACES"]);
    assert.ok(!excluded.includes("google_places"));
    for (const provider of ["hunter", "apollo", "companies_house", "website_contacts"]) {
      assert.ok(excluded.includes(provider), provider);
    }
    assert.deepEqual(excludedProvidersFor(["GOOGLE_PLACES", "COMPANY_REGISTRY", "WEBSITE", "DATA_PROVIDER"]), []);
    assert.deepEqual(excludedProvidersFor([]).sort(), [...GOVERNED_PROVIDERS].sort());
  });

  test("only sources a run can use are offered, and only to sourcing agents", () => {
    const keys = sourcesForType("SOURCING").map((s) => s.key);
    assert.deepEqual(keys.sort(), ["COMPANY_REGISTRY", "DATA_PROVIDER", "GOOGLE_PLACES", "WEBSITE"]);
    assert.equal(sourcesForType("BOOKING").length, 0);
    assert.equal(sourcesForType("REENGAGEMENT").length, 0);
  });

  test("the run carries the exclusions and the worker routes around them", () => {
    assert.match(read("src/lib/find-leads/server/runs.ts"), /excludedProviders/);
    assert.match(read("src/lib/jobs/handlers/sourcing-run.ts"), /limits\.excludedProviders/);
  });

  test("the wizard no longer offers enrichment toggles, and phone is never promised", () => {
    const wizard = read("src/components/agents/agent-wizard.tsx");
    assert.doesNotMatch(wizard, /Find a business phone number/);
    assert.doesNotMatch(wizard, /enrichPhone/);
    assert.ok(!AGENT_TYPE_DEFINITIONS.SOURCING.capabilities.some((c) => /phone number$/.test(c) && !/Never/.test(c)));
  });
});

describe("agents: editing and readiness (4, 5)", () => {
  test("the Settings tab edits through agent.configure", () => {
    assert.match(read("src/components/agents/agent-tabs.tsx"), /<AgentSettingsForm/);
    assert.match(read("src/components/agents/agent-settings-form.tsx"), /updateAgent\(/);
    assert.match(read("src/lib/agents/actions.ts"), /"agent\.configure"/);
  });

  test("unsettable setup items are no longer displayed", () => {
    const tabs = read("src/components/agents/agent-tabs.tsx");
    assert.doesNotMatch(tabs, /label="Minimum grade"/);
    assert.doesNotMatch(tabs, /label="Conversion goal"/);
    assert.doesNotMatch(tabs, /label="Promote automatically"/);
  });

  test("readiness only asks for what can be set", () => {
    assert.deepEqual(readinessProblems({ agentType: "BOOKING", enabledSources: [] }), []);
    assert.equal(readinessProblems({ agentType: "SOURCING", enabledSources: [] }).length, 1);
    assert.match(
      readinessProblems({ agentType: "SOURCING", enabledSources: ["WEBSITE"] })[0],
      /find new companies/,
    );
    assert.deepEqual(
      readinessProblems({ agentType: "COMBINED", enabledSources: ["GOOGLE_PLACES", "WEBSITE"] }),
      [],
    );
  });

  test("starting an agent enforces readiness in the operation", () => {
    const ops = read("src/lib/services/operations/agents.ts");
    assert.match(ops, /readinessProblems\(/);
    assert.match(read("src/lib/agents/actions.ts"), /"agent\.start"/);
  });
});

describe("agents: booking copy matches the tick (6)", () => {
  test("the booking agent no longer claims to offer times or confirm", () => {
    const booking = AGENT_TYPE_DEFINITIONS.BOOKING;
    assert.doesNotMatch(booking.description, /offers the times your calendar/);
    assert.ok(!booking.capabilities.some((c) => /Offers live availability|Confirms and records/.test(c)));
  });

  test("an automatic booking tick actually queues the follow-up step", () => {
    const ticks = read("src/lib/agents/ticks.ts");
    assert.match(ticks, /enqueue\(\s*"automation\.advance"/);
    assert.match(ticks, /resumeFollowUpBlock\(/);
  });
});

describe("agents: re-engagement scope and channel (7)", () => {
  test("the channel follows what is connected", () => {
    assert.equal(chooseReengagementChannel({ mailbox: true, sms: true }), "email");
    assert.equal(chooseReengagementChannel({ mailbox: false, sms: true }), "sms");
    assert.equal(chooseReengagementChannel({ mailbox: false, sms: false }), null);
  });

  test("only this agent's own open campaign stops a new draft", () => {
    const ticks = read("src/lib/agents/ticks.ts");
    assert.match(ticks, /\.eq\("agent_id", agent\.id\)\s*\n\s*\.eq\("item_type", "REENGAGE"\)/);
    assert.match(ticks, /\.in\("id", ownIds\)/);
    assert.match(ticks, /channel,\s*status: "DRAFT"/);
  });
});

describe("agents: run controls and states (8)", () => {
  test("a manual agent that has run reads as idle, not running", () => {
    assert.equal(agentRunState({ status: "ACTIVE", cadence: "MANUAL", nextRunAt: null }).label, "Idle");
    assert.equal(agentRunState({ status: "ACTIVE", cadence: "MANUAL", nextRunAt: "2026-09-26T10:00:00Z" }).label, "Running");
    assert.equal(agentRunState({ status: "ACTIVE", cadence: "DAILY", nextRunAt: null }).label, "Running");
    assert.equal(agentRunState({ status: "ERROR", cadence: "DAILY", nextRunAt: null }).tone, "danger");
  });

  test("the primary button says what it does", () => {
    assert.equal(runButton({ status: "DRAFT", cadence: "MANUAL" }).label, "Run once");
    assert.equal(runButton({ status: "DRAFT", cadence: "DAILY" }).label, "Start agent");
    assert.equal(runButton({ status: "ACTIVE", cadence: "DAILY" }).label, "Run now");
  });

  test("unexpected failures set ERROR; fixable ones NEEDS_ATTENTION", () => {
    assert.equal(failureStatus(new AgentBlocked("limit")), "NEEDS_ATTENTION");
    assert.equal(failureStatus(new Error("db down")), "ERROR");
    assert.match(read("src/lib/agents/scheduler.ts"), /failureStatus\(e\)/);
  });
});
