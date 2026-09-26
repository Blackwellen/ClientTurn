import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACTION_OPERATION,
  LEAD_PAGE_ACTIONS,
  LEAD_PAGE_TABS,
  closeOutcomeSchema,
  closeReasonProblem,
  firstAndLastTouch,
  isLeadId,
  isReadOnlyRole,
  leadActionAvailability,
  leadPageHref,
  manualRescoreTrigger,
  parseLeadPageTab,
  parseScoreDimensions,
  parseScoreMissing,
  qualificationBuckets,
  statusNeedsReason,
  type LeadActionState,
} from "../src/lib/leads/detail-page.ts";
import {
  DEFAULT_SELLING_PREFERENCES,
  avoidTextFromPhrases,
  brandVoiceSchema,
  budgetProblems,
  budgetUpdateSchema,
  formatMinor,
  liaProblems,
  liaReviewOverdue,
  liaSchema,
  minorToPounds,
  parseBudgetForm,
  parseSellingPreferences,
  phrasesFromAvoid,
  phrasesFromText,
  poundsToMinor,
  salesSettingsUpdateSchema,
} from "../src/lib/settings/ai-selling.ts";
import { leadScorePayload } from "../src/lib/jobs/handlers/payloads.ts";
import { registryProblems, serviceOperation } from "../src/lib/services/registry.ts";
import { SETTINGS_SECTIONS, parseSettingsSection } from "../src/lib/settings/types.ts";

const LEAD = "7b0c2f55-3a0e-4d1e-9a51-1f1f0c5d2a11";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const OPEN_LEAD: LeadActionState = {
  status: "RESPONDED",
  archived: false,
  anonymised: false,
  optedOut: false,
  humanTakeover: false,
  opportunityOutcome: "OPEN",
};

/* ------------------------------------------------------------ tab / URL */

describe("lead page tabs and URL state", () => {
  test("every documented tab is present, in order", () => {
    assert.deepEqual(
      LEAD_PAGE_TABS.map((tab) => tab.value),
      ["conversation", "qualification", "scores", "attribution", "activity", "ai", "data-rights"],
    );
  });

  test("an unknown, missing or repeated tab falls back to the conversation", () => {
    assert.equal(parseLeadPageTab("ai"), "ai");
    assert.equal(parseLeadPageTab(["scores", "ai"]), "scores");
    assert.equal(parseLeadPageTab("documents"), "conversation");
    assert.equal(parseLeadPageTab(undefined), "conversation");
    assert.equal(parseLeadPageTab("__proto__"), "conversation");
  });

  test("the default tab has no query, so the plain link and the tab are one address", () => {
    assert.equal(leadPageHref(LEAD), `/app/leads/${LEAD}`);
    assert.equal(leadPageHref(LEAD, "conversation"), `/app/leads/${LEAD}`);
    assert.equal(leadPageHref(LEAD, "data-rights"), `/app/leads/${LEAD}?tab=data-rights`);
    for (const tab of LEAD_PAGE_TABS) {
      assert.equal(parseLeadPageTab(new URL(leadPageHref(LEAD, tab.value), "https://x").searchParams.get("tab") ?? undefined), tab.value);
    }
  });

  test("only a uuid is a lead id", () => {
    assert.equal(isLeadId(LEAD), true);
    assert.equal(isLeadId("import"), false);
    assert.equal(isLeadId("1; drop table leads"), false);
  });

  test("the page lives inside Leads, not as a new navigation destination", () => {
    const page = source("../src/app/(app)/app/leads/[id]/page.tsx");
    assert.match(page, /notFound\(\)/);
    for (const file of ["loading.tsx", "error.tsx", "not-found.tsx"]) {
      assert.ok(source(`../src/app/(app)/app/leads/[id]/${file}`).length > 0, file);
    }
  });
});

/* ----------------------------------------------------- action availability */

describe("action availability by role", () => {
  test("every action maps to a real registry operation", () => {
    for (const action of LEAD_PAGE_ACTIONS) {
      assert.ok(serviceOperation(ACTION_OPERATION[action]), `${action} -> ${ACTION_OPERATION[action]}`);
    }
  });

  test("a viewer can take no action, and is told it is their role", () => {
    const viewer = leadActionAvailability("viewer", OPEN_LEAD);
    for (const action of LEAD_PAGE_ACTIONS) {
      assert.equal(viewer[action].allowed, false, action);
      assert.ok(viewer[action].reason, action);
    }
    assert.equal(viewer.note.reason, "Your role can view this lead but not act on it.");
    assert.equal(isReadOnlyRole("viewer"), true);
    assert.equal(isReadOnlyRole("member"), false);
  });

  test("a member works the lead but cannot archive, anonymise, erase or export", () => {
    const member = leadActionAvailability("member", OPEN_LEAD);
    for (const action of ["message", "book", "assign", "change_stage", "close", "note", "rescore", "takeover", "suppress", "unsubscribe"] as const) {
      assert.equal(member[action].allowed, true, action);
    }
    for (const action of ["archive", "anonymise", "delete", "export"] as const) {
      assert.equal(member[action].allowed, false, action);
      assert.equal(member[action].reason, "Only owners and admins can do this.");
    }
  });

  test("owners and admins can do everything the lead's state allows", () => {
    for (const role of ["admin", "owner"] as const) {
      const all = leadActionAvailability(role, OPEN_LEAD);
      assert.equal(all.archive.allowed, true);
      assert.equal(all.delete.allowed, true);
      assert.equal(all.restore.allowed, false, "not archived, so nothing to restore");
    }
  });

  test("an unknown role is treated as having no permissions", () => {
    const unknown = leadActionAvailability("superuser", OPEN_LEAD);
    assert.ok(LEAD_PAGE_ACTIONS.every((action) => !unknown[action].allowed));
  });

  test("the lead's state rules actions out with a reason", () => {
    const optedOut = leadActionAvailability("owner", { ...OPEN_LEAD, optedOut: true, humanTakeover: true });
    assert.equal(optedOut.message.allowed, false);
    assert.equal(optedOut.resume.allowed, false);
    assert.equal(optedOut.unsubscribe.allowed, false);

    const archived = leadActionAvailability("owner", { ...OPEN_LEAD, archived: true });
    assert.equal(archived.note.allowed, false);
    assert.equal(archived.restore.allowed, true);
    assert.equal(archived.export.allowed, true);
    assert.equal(archived.delete.allowed, true);

    const takenOver = leadActionAvailability("member", { ...OPEN_LEAD, humanTakeover: true });
    assert.equal(takenOver.takeover.allowed, false);
    assert.equal(takenOver.resume.allowed, true);

    const won = leadActionAvailability("member", { ...OPEN_LEAD, status: "WON", humanTakeover: true, opportunityOutcome: "WON" });
    assert.equal(won.resume.allowed, false);
    assert.equal(won.change_stage.allowed, false);

    const noOpportunity = leadActionAvailability("member", { ...OPEN_LEAD, opportunityOutcome: null });
    assert.equal(noOpportunity.change_stage.allowed, false);
    assert.equal(noOpportunity.close.allowed, true, "closing opens one first");
  });
});

/* ------------------------------------------------------- won/lost reason */

describe("won and lost need a reason", () => {
  test("only WON and LOST need one", () => {
    assert.equal(statusNeedsReason("WON"), true);
    assert.equal(statusNeedsReason("LOST"), true);
    for (const status of ["NEW", "CONTACTED", "RESPONDED", "QUALIFIED", "BOOKED"]) {
      assert.equal(statusNeedsReason(status), false, status);
    }
  });

  test("a blank or trivial reason is refused; a real one is accepted", () => {
    assert.ok(closeReasonProblem(""));
    assert.ok(closeReasonProblem("   "));
    assert.ok(closeReasonProblem("no"));
    assert.ok(closeReasonProblem("x".repeat(501)));
    assert.equal(closeReasonProblem("Chose a cheaper supplier"), null);
  });

  test("the close input carries the lead, the outcome and the reason", () => {
    assert.equal(closeOutcomeSchema.safeParse({ leadId: LEAD, outcome: "WON", reason: "Signed" }).success, true);
    assert.equal(closeOutcomeSchema.safeParse({ leadId: LEAD, outcome: "WON" }).success, false);
    assert.equal(closeOutcomeSchema.safeParse({ leadId: LEAD, outcome: "QUALIFIED", reason: "Signed" }).success, false);
  });

  test("the app's status change routes WON/LOST through the opportunity close path", () => {
    const actions = source("../src/lib/leads/actions.ts");
    assert.match(actions, /statusNeedsReason\(parsed\.data\.status\)/);
    assert.match(actions, /runOperation\(\s*"lead\.set_status"/);
    assert.match(actions, /export async function markWon\(leadId: string, reason: string\)/);
    assert.match(actions, /export async function markLost\(leadId: string, reason: string\)/);
    // lead.set_status closes through closeLeadOpportunity.
    assert.match(source("../src/lib/services/operations/leads.ts"), /closeLeadOpportunity\(/);
  });

  test("the drawer asks for a reason instead of saving WON/LOST directly", () => {
    const drawer = source("../src/components/leads/lead-drawer.tsx");
    assert.match(drawer, /statusNeedsReason\(next\)/);
    assert.match(drawer, /<CloseOutcomeDialog/);
    const manual = source("../src/components/leads/lead-manual-actions.tsx");
    assert.match(manual, /onRequestClose\("WON"\)/);
    assert.match(manual, /onRequestClose\("LOST"\)/);
  });
});

/* ---------------------------------------------------------- re-score key */

describe("manual re-score", () => {
  test("the trigger is unique per request and passes the job payload's validation", () => {
    const a = manualRescoreTrigger("11111111-2222-3333-4444-555555555555", new Date(1_700_000_000_000));
    const b = manualRescoreTrigger("11111111-2222-3333-4444-555555555555", new Date(1_700_000_000_001));
    assert.equal(a, "manual:11111111-2222-3333-4444-555555555555:1700000000000");
    assert.notEqual(a, b);
    assert.equal(leadScorePayload.safeParse({ leadId: LEAD, triggerEvent: a }).success, true);
    assert.equal(leadScorePayload.safeParse({ leadId: LEAD, triggerEvent: "lead.processed" }).success, true);
    assert.equal(leadScorePayload.safeParse({ leadId: LEAD, triggerEvent: "a:b:c:d" }).success, false);
  });

  test("lead.rescore, lead.takeover and lead.resume_follow_up are declared and well formed", () => {
    assert.deepEqual(registryProblems(), []);
    const rescore = serviceOperation("lead.rescore")!;
    assert.equal(rescore.risk, "SAFE_WRITE");
    const resume = serviceOperation("lead.resume_follow_up")!;
    assert.ok(!(resume.callers as readonly string[]).includes("AGENT"));
    assert.ok(!(resume.callers as readonly string[]).includes("COPILOT"));
  });

  test("no agent can change its own budget, selling settings or LIA", () => {
    for (const name of ["ai_budget.update", "sales_settings.update", "legitimate_interest.save"]) {
      const op = serviceOperation(name)!;
      assert.ok(op, name);
      assert.equal(op.minimumRole, "admin", name);
      assert.ok(!(op.callers as readonly string[]).includes("AGENT"), name);
    }
    const budget = serviceOperation("ai_budget.update")!;
    assert.ok(!(budget.callers as readonly string[]).includes("COPILOT"));
  });
});

/* --------------------------------------------------------- score parsing */

describe("score view", () => {
  test("dimensions keep evidence and missing features, and malformed entries are dropped", () => {
    const view = parseScoreDimensions([
      {
        dimension: "INTENT",
        score: 12,
        max: 20,
        confidence: 0.8,
        evidence: [{ feature: "booking_intent", label: "asked to book", value: true, source: "reply_classification", confidence: 0.9 }],
        missing: ["pricing_requested"],
      },
      { dimension: "FIT" },
      "nonsense",
    ]);
    assert.equal(view.length, 1);
    assert.equal(view[0].label, "Intent");
    assert.equal(view[0].evidence[0].label, "asked to book");
    assert.deepEqual(view[0].missing, ["asked about pricing"]);
    assert.deepEqual(parseScoreDimensions(null), []);
  });

  test("missing features read as words", () => {
    assert.deepEqual(parseScoreMissing([{ dimension: "TIMING", feature: "timeline_days" }, { bad: true }]), [
      { dimension: "Timing", label: "timeline" },
    ]);
  });
});

/* -------------------------------------------------------- qualification */

describe("qualification buckets", () => {
  const questions = [
    { id: "q1", question: "Team size", required: true, active: true },
    { id: "q2", question: "Budget", required: false, active: true },
    { id: "q3", question: "Timeline", required: true, active: true },
    { id: "q4", question: "Old question", required: false, active: false },
  ];

  test("said, inferred and missing are kept apart", () => {
    const buckets = qualificationBuckets(
      questions,
      [
        { questionId: "q1", value: "12", evaluation: "matched", source: "reply", confidence: 1, answeredAt: "2026-09-01T00:00:00Z" },
        { questionId: "q2", value: "£5k", evaluation: "matched", source: "ai_assist", confidence: 0.7, answeredAt: null },
        { questionId: "q3", value: "  ", evaluation: "not_evaluated", source: "reply", confidence: null, answeredAt: null },
      ],
      [{ field: "current_tool", value: { value: "Spreadsheets" }, confidence: 0.6, createdAt: "2026-09-02T00:00:00Z" }],
    );
    assert.deepEqual(buckets.known.map((item) => item.question), ["Team size"]);
    assert.deepEqual(buckets.inferred.map((item) => item.question), ["Budget", "Current tool"]);
    assert.equal(buckets.inferred[0].sourceLabel, "AI-extracted, checked by rules");
    // A blank answer is missing, and an inactive unanswered question is not asked for.
    assert.deepEqual(buckets.missing.map((item) => item.questionId), ["q3"]);
  });
});

/* ------------------------------------------------------------ attribution */

describe("attribution", () => {
  test("first and last touch go by when the person arrived", () => {
    const touches = [
      { id: "b", occurredAt: "2026-09-10T00:00:00Z", receivedAt: "2026-09-10T00:00:01Z" },
      { id: "a", occurredAt: "2026-09-01T00:00:00Z", receivedAt: "2026-09-20T00:00:00Z" },
      { id: "c", occurredAt: "2026-09-15T00:00:00Z", receivedAt: "2026-09-15T00:00:00Z" },
    ];
    const { first, last } = firstAndLastTouch(touches);
    assert.equal(first?.id, "a");
    assert.equal(last?.id, "c");
    assert.deepEqual(firstAndLastTouch([]), { first: null, last: null });
  });
});

/* ----------------------------------------------------------------- budget */

describe("budget form validation", () => {
  test("pounds become pence; blank means no limit of the workspace's own", () => {
    assert.equal(poundsToMinor("12.50"), 1250);
    assert.equal(poundsToMinor("£1,000"), 100000);
    assert.equal(poundsToMinor(" 3 "), 300);
    assert.equal(poundsToMinor(""), null);
    for (const bad of ["-1", "1.234", "abc", "1e3", "100001"]) {
      assert.equal(poundsToMinor(bad), "invalid", bad);
    }
    assert.equal(minorToPounds(1250), "12.50");
    assert.equal(minorToPounds(null), "");
    assert.equal(formatMinor(null), "No limit");
  });

  test("a bad field is named rather than silently dropped", () => {
    const parsed = parseBudgetForm({ WORKSPACE_MONTH: "50", LEAD: "two", PRE_REPLY: "", OPPORTUNITY: "5" });
    assert.equal(parsed.ok, false);
    assert.deepEqual(Object.keys(parsed.ok ? {} : parsed.errors), ["LEAD"]);
    const good = parseBudgetForm({ WORKSPACE_MONTH: "50", LEAD: "1.50", PRE_REPLY: "", OPPORTUNITY: "5" });
    assert.deepEqual(good.ok && good.values, { WORKSPACE_MONTH: 5000, LEAD: 150, PRE_REPLY: null, OPPORTUNITY: 500 });
  });

  test("per-lead limits can be tightened below the platform default, never raised above it", () => {
    const defaults = { LEAD: 200, PRE_REPLY: 20, OPPORTUNITY: 1000, WORKSPACE_MONTH: null };
    assert.deepEqual(budgetProblems({ LEAD: 150, PRE_REPLY: 10, WORKSPACE_MONTH: 999999 }, defaults), {});
    const raised = budgetProblems({ LEAD: 500, OPPORTUNITY: 2000 }, defaults);
    assert.ok(raised.LEAD);
    assert.ok(raised.OPPORTUNITY);
  });

  test("spend before a reply cannot exceed spend on the whole lead", () => {
    const defaults = { LEAD: 200, PRE_REPLY: 20 };
    assert.ok(budgetProblems({ LEAD: 10, PRE_REPLY: null }, defaults).PRE_REPLY, "default pre-reply above a tightened lead cap");
    assert.equal(budgetProblems({ LEAD: 10, PRE_REPLY: 5 }, defaults).PRE_REPLY, undefined);
  });

  test("the operation schema takes pence, and at least one field", () => {
    assert.equal(budgetUpdateSchema.safeParse({ LEAD: 150 }).success, true);
    assert.equal(budgetUpdateSchema.safeParse({ LEAD: null }).success, true);
    assert.equal(budgetUpdateSchema.safeParse({}).success, false);
    assert.equal(budgetUpdateSchema.safeParse({ LEAD: 1.5 }).success, false);
    assert.equal(budgetUpdateSchema.safeParse({ LEAD: -1 }).success, false);
  });
});

/* -------------------------------------------------------------------- LIA */

describe("LIA validation", () => {
  const base = {
    purpose: "Contact agencies that published a hiring page",
    necessity: "Email is the only channel they list for new suppliers.",
    balancing: "Business contact, relevant to their role, easy opt-out.",
    channels: ["EMAIL"],
    status: "DRAFT",
  };
  const now = new Date("2026-09-26T12:00:00Z");

  test("the three ICO tests and a channel are required", () => {
    assert.equal(liaSchema.safeParse(base).success, true);
    for (const field of ["purpose", "necessity", "balancing"] as const) {
      assert.equal(liaSchema.safeParse({ ...base, [field]: "  " }).success, false, field);
    }
    assert.equal(liaSchema.safeParse({ ...base, channels: [] }).success, false);
    assert.equal(liaSchema.safeParse({ ...base, channels: ["EMAIL", "EMAIL"] }).success, false);
    assert.equal(liaSchema.safeParse({ ...base, channels: ["FAX"] }).success, false);
    assert.equal(liaSchema.safeParse({ ...base, purpose: "x".repeat(501) }).success, false);
  });

  test("an ACTIVE assessment needs a review date in the future", () => {
    assert.deepEqual(liaProblems({ status: "DRAFT" }, now), []);
    assert.equal(liaProblems({ status: "ACTIVE" }, now).length, 1);
    assert.equal(liaProblems({ status: "ACTIVE", nextReviewOn: "2026-09-26" }, now).length, 1, "today is not the future");
    assert.equal(liaProblems({ status: "ACTIVE", nextReviewOn: "2025-01-01" }, now).length, 1);
    assert.deepEqual(liaProblems({ status: "ACTIVE", nextReviewOn: "2027-03-31" }, now), []);
    assert.equal(liaSchema.safeParse({ ...base, nextReviewOn: "31/03/2027" }).success, false);
  });

  test("an active assessment past its review date is flagged", () => {
    assert.equal(liaReviewOverdue({ status: "ACTIVE", nextReviewAt: "2026-01-01T00:00:00Z" }, now), true);
    assert.equal(liaReviewOverdue({ status: "ACTIVE", nextReviewAt: "2027-01-01T00:00:00Z" }, now), false);
    assert.equal(liaReviewOverdue({ status: "WITHDRAWN", nextReviewAt: "2026-01-01T00:00:00Z" }, now), false);
  });
});

/* ------------------------------------------------------ selling settings */

describe("selling settings", () => {
  test("stored preferences are read tolerantly; bad values fall back field by field", () => {
    assert.deepEqual(parseSellingPreferences(null), DEFAULT_SELLING_PREFERENCES);
    const parsed = parseSellingPreferences({ researchDepth: "DEEP", riskTolerance: "RECKLESS", preferredMethods: ["SPIN"] });
    assert.equal(parsed.researchDepth, "DEEP");
    assert.equal(parsed.riskTolerance, "BALANCED");
    assert.deepEqual(parsed.preferredMethods, ["SPIN"]);
  });

  test("forbidden phrases round-trip through outreach_avoid the way the offer card splits it", () => {
    const phrases = phrasesFromText("  cheap  \nguaranteed results\n\nCHEAP\n");
    assert.deepEqual(phrases, ["cheap", "guaranteed results"]);
    assert.deepEqual(phrasesFromAvoid(avoidTextFromPhrases(phrases)), phrases);
    assert.equal(avoidTextFromPhrases([]), null);
  });

  test("brand validation refuses phrases the linter could not use", () => {
    const ok = { tone: "", valueProposition: "", keyMessages: "", proofPoints: "", callToAction: "", claimRestrictions: "" };
    assert.equal(brandVoiceSchema.safeParse({ ...ok, forbiddenPhrases: ["cheap"] }).success, true);
    assert.equal(brandVoiceSchema.safeParse({ ...ok, forbiddenPhrases: ["no"] }).success, false);
    assert.equal(brandVoiceSchema.safeParse({ ...ok, forbiddenPhrases: ["a; b"] }).success, false);
    assert.equal(brandVoiceSchema.safeParse({ ...ok, forbiddenPhrases: ["x".repeat(61)] }).success, false);
  });

  test("an update names something to change, a real archetype and a SIC-shaped code", () => {
    assert.equal(salesSettingsUpdateSchema.safeParse({}).success, false);
    assert.equal(salesSettingsUpdateSchema.safeParse({ salesMotions: ["BOOK_MEETING_B2B"] }).success, true);
    assert.equal(salesSettingsUpdateSchema.safeParse({ salesMotions: ["COLD_CALL"] }).success, false);
    assert.equal(
      salesSettingsUpdateSchema.safeParse({ classification: { primaryIndustryCode: "73.11", archetypeKey: null } }).success,
      true,
    );
    assert.equal(
      salesSettingsUpdateSchema.safeParse({ classification: { primaryIndustryCode: "seventy", archetypeKey: null } }).success,
      false,
    );
    assert.equal(
      salesSettingsUpdateSchema.safeParse({ classification: { primaryIndustryCode: null, archetypeKey: "NOT_A_TYPE" } }).success,
      false,
    );
    assert.equal(
      salesSettingsUpdateSchema.safeParse({ preferences: { goodExamples: Array(6).fill("hello") } }).success,
      false,
    );
  });

  test("AI & selling is a Settings section, not a new destination", () => {
    assert.ok(SETTINGS_SECTIONS.some((section) => section.id === "ai-selling"));
    assert.equal(parseSettingsSection("ai-selling"), "ai-selling");
  });
});
