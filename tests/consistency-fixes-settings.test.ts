import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AI_ASSIST_FIELD_COPY,
  EMAIL_MAILBOX_PROVIDER_TYPE,
  agentChannelAvailable,
  agentSettingsProblem,
  isMailboxUsable,
} from "../src/lib/ai-settings/types.ts";
import { ALL_OPERATIONS, operationsForCaller } from "../src/lib/services/registry.ts";
import {
  COPILOT_CANNOT,
  COPILOT_TOOLS,
  confirmedToolSummaries,
  joinList,
} from "../src/lib/copilot/types.ts";
import { SALES_METHODS, SALES_METHOD_LABEL, salesMethodLabel } from "../src/lib/sales-library/types.ts";
import { ARCHETYPES } from "../src/lib/sales-library/archetypes.ts";
import {
  INDUSTRIES,
  INDUSTRY_OPTIONS,
  LEGACY_INDUSTRIES,
  archetypeKeyForIndustry,
  industryOptionsFor,
  isAcceptedIndustry,
} from "../src/lib/settings/types.ts";
import { SUGGESTED_SERVICES, suggestedServicesFor } from "../src/lib/onboarding/steps.ts";
import {
  FIRST_USE_TOUR,
  adjacentStepIndex,
  availablePosition,
  isStepAvailable,
  type TourStep,
} from "../src/lib/tour/model.ts";
import { contactabilityState } from "../src/lib/policy/contactability-state.ts";

/**
 * Settings, Copilot, onboarding and tour consistency fixes: each defect is
 * pinned by the pure logic that now decides it, or by the copy that now
 * describes it truthfully.
 */

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

/* ------------------------------------------------------------ item 9 */

describe("email channel availability (item 9)", () => {
  test("the mailbox provider type is the one the mailbox is stored under", () => {
    assert.equal(EMAIL_MAILBOX_PROVIDER_TYPE, "imap_smtp");
    assert.match(read("src", "lib", "email", "store.ts"), /const PROVIDER = "imap_smtp";/);
    const queries = read("src", "lib", "ai-settings", "queries.ts");
    assert.doesNotMatch(queries, /smtp_mailbox/);
    assert.match(queries, /\.eq\("provider_type", EMAIL_MAILBOX_PROVIDER_TYPE\)/);
  });

  test("a mailbox is usable unless missing, disconnected or needing action", () => {
    assert.equal(isMailboxUsable(null), false);
    assert.equal(isMailboxUsable(undefined), false);
    assert.equal(isMailboxUsable({ status: "CONNECTED" }), true);
    assert.equal(isMailboxUsable({ status: "DISCONNECTED" }), false);
    assert.equal(isMailboxUsable({ status: "ACTION_REQUIRED" }), false);
  });

  test("channel availability: SMS always, WhatsApp by plan, email by mailbox", () => {
    const none = { whatsappEnabled: false, emailConnected: false };
    const all = { whatsappEnabled: true, emailConnected: true };
    assert.equal(agentChannelAvailable("sms", none), true);
    assert.equal(agentChannelAvailable("whatsapp", none), false);
    assert.equal(agentChannelAvailable("email", none), false);
    assert.equal(agentChannelAvailable("whatsapp", all), true);
    assert.equal(agentChannelAvailable("email", all), true);
    assert.match(read("src", "components", "settings", "ai-agent-form.tsx"), /agentChannelAvailable\(/);
  });
});

/* ----------------------------------------------------------- item 10 */

describe("runtime-read AI settings are editable (item 10)", () => {
  const form = read("src", "components", "settings", "ai-agent-form.tsx");

  test("the form edits and saves reply length, AI rewording and AI interpretation", () => {
    for (const field of ["replyLength", "allowAiReply", "allowAiInterpretation"]) {
      assert.match(form, new RegExp(`AI_ASSIST_FIELD_COPY\\.${field}\\.label`), field);
      assert.match(form, new RegExp(`\\n\\s+${field},\\r?\\n`), `${field} is sent on save`);
    }
  });

  test("each setting is actually read at runtime", () => {
    const shared = read("src", "lib", "jobs", "handlers", "shared.ts");
    assert.match(shared, /!business\.aiSettings\.allowAiReply/);
    assert.match(shared, /Length: \$\{business\.aiSettings\.replyLength\}/);
    assert.match(read("src", "lib", "jobs", "handlers", "message-inbound.ts"), /business\.aiSettings\.allowAiInterpretation/);
  });

  test("the rewording copy names exactly where rewording happens", () => {
    // restyleMessage is called from the inbound handler (question prompts
    // without options, the handover reply) and message.draft's polish only;
    // the follow-up sequence never calls it.
    for (const file of ["follow-up.ts", "follow-up-step.ts", "sequence.ts"]) {
      try {
        assert.doesNotMatch(read("src", "lib", "jobs", "handlers", file), /restyleMessage\(/, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    assert.match(AI_ASSIST_FIELD_COPY.allowAiReply.hint, /Follow-up sequence steps are sent exactly as written/);
    assert.match(AI_ASSIST_FIELD_COPY.allowAiInterpretation.hint, /Your rules make the qualification decision/);
  });

  test("the save action writes through ai_settings.update and re-checks channels", () => {
    const action = read("src", "lib", "ai-settings", "actions.ts");
    assert.match(action, /runOperation\("ai_settings\.update"/);
    assert.doesNotMatch(action, /createAdminClient/);
    assert.match(action, /agentSettingsProblem\(/);
  });

  test("an assistant that is on needs a channel", () => {
    assert.ok(agentSettingsProblem({ enabled: true, agentMode: "AUTO_REPLY", agentChannels: [] }));
    assert.equal(agentSettingsProblem({ enabled: true, agentMode: "AUTO_REPLY", agentChannels: ["sms"] }), null);
    assert.equal(agentSettingsProblem({ enabled: true, agentMode: "OFF", agentChannels: [] }), null);
    assert.equal(agentSettingsProblem({ enabled: false, agentMode: "SUGGEST_ONLY", agentChannels: [] }), null);
  });
});

/* ------------------------------------------------------- items 11-13 */

describe("AI & selling (items 11-13)", () => {
  test("the automation level has one editor: AI & selling shows it read-only", () => {
    const card = read("src", "components", "settings", "ai-selling", "ai-strategy-card.tsx");
    assert.doesNotMatch(card, /type="radio"/);
    assert.doesNotMatch(card, /saveAutomationLevelAction/);
    assert.match(card, /\/app\/settings\?section=workspace#ai-assistant/);
    assert.doesNotMatch(read("src", "lib", "settings", "ai-selling-actions.ts"), /export async function saveAutomationLevelAction/);
    assert.match(read("src", "components", "settings", "ai-agent-form.tsx"), /id="ai-assistant"/);
  });

  test("an LIA labels contactability; it does not gate it", () => {
    const row = {
      result: "ALLOWED",
      reasonCode: "ALLOWED",
      relationshipType: "FOUND_BY_US",
      channel: "email",
      evidence: null,
    };
    assert.equal(contactabilityState(row, []), "PERMITTED");
    assert.equal(contactabilityState(row, ["email"]), "LEGITIMATE_INTERESTS_REVIEWED");
    const copy = read("src", "components", "settings", "ai-selling", "compliance-card.tsx");
    assert.doesNotMatch(copy, /nobody is treated as contactable/);
    assert.match(copy, /It does not start or stop any sending/);
  });

  test("the Channels card no longer claims to set channels or per-channel caps", () => {
    const copy = read("src", "components", "settings", "ai-selling", "channels-card.tsx");
    assert.doesNotMatch(copy, /Which channels the assistant may use and how much each may send/);
    assert.match(copy, /how many emails each sender may send today/);
  });
});

/* ------------------------------------------------------ items 23-24 */

describe("Copilot's stated permissions match the registry (items 23-24)", () => {
  const copilotOps = new Set<string>(operationsForCaller("COPILOT").map((op) => op.name));
  const allOps = new Set<string>(ALL_OPERATIONS.map((op) => op.name));

  test("everything it says it cannot do is a real operation Copilot may not call", () => {
    for (const item of COPILOT_CANNOT) {
      for (const name of item.operations) {
        assert.ok(allOps.has(name), `${name} exists`);
        assert.equal(copilotOps.has(name), false, `${name} is not callable by Copilot`);
      }
    }
    const tools = new Set(COPILOT_TOOLS.map((tool) => tool.name));
    for (const name of ["message.send", "campaign.launch", "campaign.resume"]) assert.equal(tools.has(name), false);
  });

  test("the confirmed-actions list includes disconnect, merge and close", () => {
    const summaries = confirmedToolSummaries();
    for (const name of ["connector.disconnect", "merge_candidate.resolve", "opportunity.close", "agent.start"]) {
      const tool = COPILOT_TOOLS.find((candidate) => candidate.name === name);
      assert.ok(tool?.requiresConfirmation, name);
      assert.ok(summaries.includes(tool!.summary), name);
    }
    assert.ok(!summaries.includes(COPILOT_TOOLS.find((tool) => tool.name === "lead.update")!.summary));
  });

  test("the copy no longer says Copilot sends or launches after confirmation", () => {
    const step = read("src", "components", "onboarding", "steps", "copilot-step.tsx");
    assert.doesNotMatch(step, /sending, launching, starting an agent/i);
    assert.doesNotMatch(step, /Lasting actions wait for you/);
    assert.match(step, /COPILOT_CANNOT/);
    const actions = read("src", "components", "copilot", "copilot-actions.tsx");
    assert.match(actions, /confirmedToolSummaries\(\)/);
    assert.match(actions, /COPILOT_CANNOT/);
    assert.equal(joinList(["a", "b", "c"]), "a, b and c");
    assert.equal(joinList(["a"]), "a");
    assert.equal(joinList([]), "");
  });
});

/* ----------------------------------------------------------- item 25 */

describe("sales method labels (item 25)", () => {
  test("every method has a label, acronyms upper case", () => {
    for (const method of SALES_METHODS) assert.ok(SALES_METHOD_LABEL[method], method);
    assert.equal(SALES_METHOD_LABEL.SPIN, "SPIN");
    assert.equal(SALES_METHOD_LABEL.MEDDPICC, "MEDDPICC");
    assert.equal(SALES_METHOD_LABEL.CHALLENGER_INSIGHT, "Challenger insight");
    assert.equal(SALES_METHOD_LABEL.PLG, "Product-led");
    assert.equal(salesMethodLabel("SPIN"), "SPIN");
    assert.equal(salesMethodLabel("SOMETHING_NEW"), "Something new");
  });

  test("screens use the label map, not a title-case helper", () => {
    const card = read("src", "components", "settings", "ai-selling", "sales-behaviour-card.tsx");
    assert.doesNotMatch(card, /function methodName/);
    assert.match(card, /SALES_METHOD_LABEL\[method\]/);
    assert.match(read("src", "components", "leads", "detail", "lead-page-tabs.tsx"), /salesMethodLabel\(run\.method\)/);
  });
});

/* ----------------------------------------------------------- item 26 */

describe("the two AI meters point at each other (item 26)", () => {
  test("token allowance links the £ limits and vice versa", () => {
    assert.match(read("src", "components", "settings", "ai-token-meter.tsx"), /section=ai-selling/);
    assert.match(read("src", "components", "settings", "ai-selling", "budget-card.tsx"), /section=billing/);
  });
});

/* ----------------------------------------------------------- item 27 */

describe("B2B-first industries (item 27)", () => {
  test("every option except Other maps to a DEEP sales-library archetype", () => {
    const byKey = new Map(ARCHETYPES.map((archetype) => [archetype.key, archetype]));
    for (const option of INDUSTRY_OPTIONS) {
      if (option.label === "Other") {
        assert.equal(option.archetypeKey, null);
        continue;
      }
      assert.equal(byKey.get(option.archetypeKey!)?.depth, "DEEP", option.label);
    }
    assert.equal(INDUSTRIES.at(-1), "Other");
    assert.equal(archetypeKeyForIndustry("Web / design studio"), "CREATIVE_WEB_STUDIO");
    assert.equal(archetypeKeyForIndustry("Roofing"), null);
  });

  test("no home-trade option is offered to a new workspace", () => {
    for (const legacy of LEGACY_INDUSTRIES) assert.equal((INDUSTRIES as string[]).includes(legacy), false, legacy);
  });

  test("a stored home-trade value stays valid and stays selected", () => {
    assert.equal(isAcceptedIndustry("Roofing"), true);
    assert.equal(isAcceptedIndustry("Other home services"), true);
    assert.equal(isAcceptedIndustry("Marketing agency"), true);
    assert.equal(isAcceptedIndustry(""), true);
    assert.equal(isAcceptedIndustry(null), true);
    assert.equal(isAcceptedIndustry("Made up"), false);
    assert.equal(isAcceptedIndustry("Made up", "Made up"), true);
    assert.ok(industryOptionsFor("Roofing").includes("Roofing"));
    assert.deepEqual(industryOptionsFor("SEO agency"), [...INDUSTRIES]);
    assert.deepEqual(industryOptionsFor(null), [...INDUSTRIES]);
    const actions = read("src", "lib", "settings", "actions.ts");
    assert.doesNotMatch(actions, /INDUSTRIES as readonly string\[\]\)\.includes/);
    assert.equal((actions.match(/isAcceptedIndustry\(parsed\.data\.industry\)/g) ?? []).length, 2);
  });

  test("every industry has suggested services, and unknown values fall back", () => {
    for (const label of INDUSTRIES) assert.ok((SUGGESTED_SERVICES[label] ?? []).length >= 3, label);
    assert.deepEqual(suggestedServicesFor("Roofing"), SUGGESTED_SERVICES.Other);
    assert.deepEqual(suggestedServicesFor(""), SUGGESTED_SERVICES.Other);
  });
});

/* ----------------------------------------------------------- item 28 */

describe("product tour covers Agents, Find Leads and Analytics (item 28)", () => {
  const steps = FIRST_USE_TOUR.steps;
  const byId = (id: string) => steps.find((step) => step.id === id);

  test("the three destinations have steps; the plan-gated ones require their target", () => {
    assert.ok(byId("nav-agents"));
    assert.equal(byId("nav-agents")!.requiresTarget, undefined);
    assert.equal(byId("nav-find-leads")?.requiresTarget, "nav-find-leads");
    assert.equal(byId("nav-analytics")?.requiresTarget, "nav-analytics");
  });

  const fixture: TourStep[] = [
    { id: "a", title: "A", body: "a", targets: [] },
    { id: "b", title: "B", body: "b", targets: ["x"], requiresTarget: "x" },
    { id: "c", title: "C", body: "c", targets: [] },
    { id: "d", title: "D", body: "d", targets: ["y"], requiresTarget: "y" },
  ];
  const onlyY = (key: string) => key === "y";

  test("a step whose required target is absent is skipped both ways", () => {
    assert.equal(isStepAvailable(fixture[1], onlyY), false);
    assert.equal(isStepAvailable(fixture[0], onlyY), true);
    assert.equal(adjacentStepIndex(fixture, 0, 1, onlyY), 2);
    assert.equal(adjacentStepIndex(fixture, 2, -1, onlyY), 0);
    assert.equal(adjacentStepIndex(fixture, 3, 1, onlyY), null);
    assert.equal(adjacentStepIndex(fixture, 0, 1, () => true), 1);
  });

  test("a trailing skipped step ends the tour instead of stalling", () => {
    assert.equal(adjacentStepIndex(fixture, 2, 1, () => false), null);
  });

  test("the counter counts only steps that will be shown", () => {
    assert.deepEqual(availablePosition(fixture, 2, onlyY), { index: 1, total: 3 });
    assert.deepEqual(availablePosition(fixture, 3, () => true), { index: 3, total: 4 });
    // Trial: Find Leads and Analytics hidden.
    const trial = (key: string) => key !== "nav-find-leads" && key !== "nav-analytics";
    assert.equal(availablePosition(steps, steps.length - 1, trial).total, steps.length - 2);
  });

  test("the runner uses the skip logic", () => {
    const runner = read("src", "components", "tour", "product-tour.tsx");
    // Forward navigation skips absent steps (the runner holds the active tour
    // in state since the section tours, so the names may differ).
    assert.match(runner, /adjacentStepIndex\([\w.]*steps, [\w.]*index, 1, isPresent\)/);
    assert.match(runner, /availablePosition\(/);
  });
});
