import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateSlices,
  assembleRevenueFunnel,
  formatSampledRate,
  isStuckLead,
  LOW_SAMPLE_N,
  sampledRate,
  scoreBand,
  SLICE_AVAILABILITY,
  SLICE_DIMENSIONS,
  STUCK_AFTER_MS,
  type StuckLeadFacts,
} from "../src/lib/analytics/revenue-surfaces.ts";
import {
  chooseKeeper,
  MergePlanError,
  planMerge,
  revertFieldPatch,
} from "../src/lib/identity/merge-plan.ts";
import { readFileSync } from "node:fs";
import { activeFilterCount, hasActiveFilters, parseLeadFilters } from "../src/lib/leads/filters.ts";
import {
  DIMENSION_STATUSES,
  FACT_STATES,
  INTENT_STATES,
  NBA_ACTIONS,
  QI_ENGINE_MODES,
} from "../src/lib/qualification-intelligence/types.ts";
import { NBA_ACTION_COPY, NBA_FAMILIES } from "../src/lib/qualification-intelligence/explain.ts";

const surface = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * Phase 5 surfaces: the pure rules behind the Dashboard revenue-control cards,
 * the Analytics breakdown, the admin stuck-lead queue and the duplicate-queue
 * merge. The server code only loads rows and applies these.
 */

describe("the low-sample rule", () => {
  test("an empty denominator has no rate and is not a small sample", () => {
    const r = sampledRate(0, 0);
    assert.equal(r.value, null);
    assert.equal(r.lowSample, false);
    assert.equal(formatSampledRate(r), "—");
  });

  test("below n = 30 the rate carries its denominator", () => {
    const r = sampledRate(2, 5);
    assert.equal(r.value, 0.4);
    assert.equal(r.lowSample, true);
    assert.equal(formatSampledRate(r), "40% (n=5)");
  });

  test("at n = 30 the marker goes away", () => {
    const r = sampledRate(3, LOW_SAMPLE_N);
    assert.equal(r.lowSample, false);
    assert.equal(formatSampledRate(r), "10%");
    assert.equal(sampledRate(3, LOW_SAMPLE_N - 1).lowSample, true);
  });

  test("zero out of a real denominator is 0%, not a dash", () => {
    assert.equal(sampledRate(0, 50).value, 0);
  });
});

describe("the source-to-won funnel", () => {
  const counts = {
    source: 40,
    contacted: 36,
    replied: 12,
    qualified: 6,
    booked: 4,
    showed: 3,
    won: 1,
  };

  test("stages come out in order with step rates on the previous stage", () => {
    const funnel = assembleRevenueFunnel(counts);
    assert.deepEqual(
      funnel.map((s) => s.key),
      [
        "source",
        "contacted",
        "replied",
        "qualified",
        "booked",
        "showed",
        "won",
      ],
    );
    assert.equal(funnel[0].step, null);
    assert.equal(funnel[1].step?.value, 36 / 40);
    assert.equal(funnel[1].step?.lowSample, false);
    // 12 replied of 36 contacted: n = 36, not small.
    assert.equal(funnel[2].step?.denominator, 36);
    // 4 booked of 6 qualified: small sample.
    assert.equal(funnel[4].step?.lowSample, true);
  });

  test("an untracked stage is not zero and breaks the next step rate", () => {
    const funnel = assembleRevenueFunnel({ ...counts, showed: null });
    const showed = funnel.find((s) => s.key === "showed")!;
    const won = funnel.find((s) => s.key === "won")!;
    assert.equal(showed.tracked, false);
    assert.equal(showed.shareOfTop, null);
    assert.equal(showed.step, null);
    // "won of showed" has no honest denominator when showed is unknown.
    assert.equal(won.step, null);
  });

  test("an empty cohort has no rates at all", () => {
    const funnel = assembleRevenueFunnel({
      source: 0,
      contacted: 0,
      replied: 0,
      qualified: 0,
      booked: 0,
      showed: 0,
      won: 0,
    });
    for (const stage of funnel) {
      assert.equal(stage.shareOfTop, null);
      assert.equal(stage.step?.value ?? null, null);
    }
  });
});

describe("the stuck-lead predicate", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const hoursAgo = (h: number) =>
    new Date(now.getTime() - h * 3_600_000).toISOString();
  const base: StuckLeadFacts = {
    status: "RESPONDED",
    optedOut: false,
    archivedAt: null,
    isTest: false,
    firstRepliedAt: hoursAgo(72),
    lastOutboundAt: hoursAgo(60),
    lastInboundAt: hoursAgo(72),
  };

  test("engaged, contactable and untouched for 48 hours is stuck", () => {
    assert.equal(isStuckLead(base, now), true);
  });

  test("an action inside 48 hours is not stuck", () => {
    assert.equal(
      isStuckLead({ ...base, lastOutboundAt: hoursAgo(47) }, now),
      false,
    );
  });

  test("exactly 48 hours is the boundary", () => {
    assert.equal(STUCK_AFTER_MS, 48 * 3_600_000);
    assert.equal(
      isStuckLead({ ...base, lastOutboundAt: hoursAgo(48) }, now),
      true,
    );
  });

  test("never answered since replying is measured from the reply", () => {
    assert.equal(
      isStuckLead(
        {
          ...base,
          lastOutboundAt: hoursAgo(100),
          firstRepliedAt: hoursAgo(50),
          lastInboundAt: hoursAgo(50),
        },
        now,
      ),
      true,
    );
    assert.equal(
      isStuckLead(
        {
          ...base,
          lastOutboundAt: null,
          firstRepliedAt: hoursAgo(10),
          lastInboundAt: hoursAgo(10),
        },
        now,
      ),
      false,
    );
  });

  test("the lead writing again is not an action on it", () => {
    assert.equal(
      isStuckLead({ ...base, lastInboundAt: hoursAgo(1) }, now),
      true,
    );
  });

  test("not engaged, not contactable, or finished is never stuck", () => {
    assert.equal(isStuckLead({ ...base, firstRepliedAt: null }, now), false);
    assert.equal(isStuckLead({ ...base, optedOut: true }, now), false);
    assert.equal(isStuckLead({ ...base, archivedAt: hoursAgo(1) }, now), false);
    assert.equal(isStuckLead({ ...base, isTest: true }, now), false);
    for (const status of ["WON", "LOST", "BOOKED"]) {
      assert.equal(isStuckLead({ ...base, status }, now), false, status);
    }
  });
});

describe("analytics slices", () => {
  test("grades are the score bands; anything else is unscored", () => {
    assert.equal(scoreBand("A"), "A");
    assert.equal(scoreBand(null), "UNSCORED");
    assert.equal(scoreBand("Z"), "UNSCORED");
  });

  test("every dimension states whether it is available and why", () => {
    for (const dimension of SLICE_DIMENSIONS) {
      const entry = SLICE_AVAILABILITY[dimension];
      assert.ok(entry, dimension);
      assert.ok(entry.note.length > 10, `${dimension} needs a note`);
      if (!entry.available) assert.match(entry.note, /^Not yet available/);
    }
    // The two the data cannot support today are declared, not faked.
    assert.equal(SLICE_AVAILABILITY.geography.available, false);
    assert.equal(SLICE_AVAILABILITY.offer.available, false);
  });

  test("linear credit splits a lead across its sources", () => {
    const outcome = {
      contacted: true,
      replied: true,
      qualified: false,
      booked: false,
      won: false,
    };
    const rows = aggregateSlices([
      { key: "meta", label: "Meta", credit: 0.5, outcome },
      { key: "web", label: "Web", credit: 0.5, outcome },
      {
        key: "meta",
        label: "Meta",
        credit: 1,
        outcome: { ...outcome, replied: false },
      },
    ]);
    const meta = rows.find((r) => r.key === "meta")!;
    assert.equal(meta.leads, 1.5);
    assert.equal(meta.replied, 0.5);
    assert.equal(meta.replyRate.value, 0.5 / 1.5);
    assert.equal(meta.replyRate.lowSample, true);
    assert.equal(rows[0].key, "meta", "sorted by credited leads");
  });

  test("a slice with nobody contacted has no reply rate", () => {
    const rows = aggregateSlices([
      {
        key: "x",
        label: "X",
        credit: 1,
        outcome: {
          contacted: false,
          replied: false,
          qualified: false,
          booked: false,
          won: false,
        },
      },
    ]);
    assert.equal(rows[0].replyRate.value, null);
    assert.equal(rows[0].bookRate.value, 0);
  });
});

describe("the merge plan", () => {
  const older = {
    id: "a",
    created_at: "2026-01-01T00:00:00Z",
    first_name: "Sam",
    email: "sam@acme.co",
    phone: null,
    company_name: null,
  };
  const newer = {
    id: "b",
    created_at: "2026-02-01T00:00:00Z",
    first_name: "Samuel",
    email: "sam@acme.co",
    phone: "+447700900000",
    company_name: "Acme",
  };

  test("the older lead is kept unless a person chose", () => {
    assert.equal(chooseKeeper(newer, older).keeper.id, "a");
    assert.equal(chooseKeeper(older, newer, "b").keeper.id, "b");
    assert.throws(() => chooseKeeper(older, newer, "c"), MergePlanError);
  });

  test("blanks are filled, present values are never replaced", () => {
    const plan = planMerge({
      keeper: older,
      loser: newer,
      keeperConversations: [],
      loserConversations: [],
    });
    assert.deepEqual(plan.patch, {
      phone: "+447700900000",
      company_name: "Acme",
    });
    assert.deepEqual(plan.before, { phone: null, company_name: null });
    assert.equal("first_name" in plan.patch, false);
  });

  test("a thread moves unless the keeper already has one on that channel", () => {
    const plan = planMerge({
      keeper: older,
      loser: newer,
      keeperConversations: [{ id: "k-sms", channel: "sms" }],
      loserConversations: [
        { id: "l-sms", channel: "sms" },
        { id: "l-email", channel: "email" },
        { id: "l-email-2", channel: "email" },
        { id: "l-multi", channel: "multi" },
      ],
    });
    assert.deepEqual(plan.foldConversations, [
      { from: "l-sms", into: "k-sms" },
      // The second loser email thread folds into the first, which now belongs
      // to the keeper: one thread per lead and channel.
      { from: "l-email-2", into: "l-email" },
    ]);
    assert.deepEqual(plan.reassignConversations, ["l-email", "l-multi"]);
  });

  test("a lead cannot be merged into itself", () => {
    assert.throws(
      () =>
        planMerge({
          keeper: older,
          loser: older,
          keeperConversations: [],
          loserConversations: [],
        }),
      MergePlanError,
    );
  });

  test("undo restores only what the merge wrote and keeps later edits", () => {
    const { restore, kept } = revertFieldPatch(
      { phone: "+447700900000", company_name: "Acme Ltd (edited)" },
      { phone: "+447700900000", company_name: "Acme" },
      { phone: null, company_name: null },
    );
    assert.deepEqual(restore, { phone: null });
    assert.deepEqual(kept, ["company_name"]);
  });

  test("undo never touches a field outside the mergeable set", () => {
    const { restore } = revertFieldPatch(
      { status: "WON" },
      { status: "WON" },
      { status: "NEW" },
    );
    assert.deepEqual(restore, {});
  });
});

/* ---------------------------------------- qualification intelligence (§B.17) */

describe("Lead Detail: qualification intelligence surfaces", () => {
  const card = surface("src/components/leads/detail/next-best-action-card.tsx");
  const tabs = surface("src/components/leads/detail/lead-page-tabs.tsx");
  const intent = surface("src/components/leads/detail/intent-panel.tsx");
  const page = surface("src/app/(app)/app/leads/[id]/page.tsx");

  test("the Next best action card sits in the right rail, streamed with a skeleton", () => {
    assert.match(page, /<React\.Suspense fallback=\{<NextBestActionSkeleton \/>\}>\s*<NextBestActionCard/);
  });

  test("the card implements all six route states", () => {
    assert.match(card, /export function NextBestActionSkeleton/, "loading");
    assert.match(card, /This lead has not been assessed yet/, "empty");
    assert.match(card, /could not be loaded/, "error");
    assert.match(card, /Your role can view this but not change it/, "permission denied");
    assert.match(card, /No calendar or booking page is connected/, "integration required");
    assert.match(card, /<PlanLimitState/, "plan limit");
  });

  test("the card explains itself: reason, why this question, alternatives, confidence, engine version, overrides", () => {
    for (const pattern of [/nba\.reason/, /Why this question\?/, /Also considered/, /Confidence/, /assessment\.engineVersion/, /<NbaOverrideDialog/, /<RequalifyButton/, /Qualification score/]) {
      assert.match(card, pattern);
    }
  });

  test("the Intent section shows score, components, evidence with source and age, signals, contradictions and decay", () => {
    for (const pattern of [/INTENT_SCORE_COMPONENTS\.map/, /Evidence/, /SIGNAL_SOURCE_COPY/, /formatRelative\(item\.observed_at\)/, /Latest signals/, /Contradicting evidence/, /Valid until/, /<IntentOverrideDialog/]) {
      assert.match(intent, pattern);
    }
    assert.match(intent, /Not assessed yet/, "empty state");
  });

  test("the Qualification tab shows confirmed, inferred, unknown and conflicting with completeness and history", () => {
    assert.match(tabs, /DIMENSION_STATUSES\.map/);
    assert.match(tabs, /label="Qualification completeness"/);
    assert.match(tabs, /Qualification history/);
    assert.match(tabs, /<FactActions/);
    assert.match(tabs, /<SetFactDialog/);
    assert.match(tabs, /Your role can view this lead&apos;s qualification but not correct it/);
    assert.match(tabs, /TabError leadId=\{leadId\} tab="qualification" what="Intent and qualification"/);
  });

  test("the families the card groups actions into cover all nine the brief names", () => {
    assert.deepEqual([...NBA_FAMILIES], ["Ask", "Answer", "Follow up", "Book", "Checkout", "Escalate", "Nurture", "Disqualify", "Wait"]);
    for (const action of NBA_ACTIONS) assert.ok(NBA_FAMILIES.includes(NBA_ACTION_COPY[action].family));
  });
});

describe("status badges for qualification intelligence live in one place", () => {
  const badge = surface("src/components/ui/badge.tsx");

  test("every state has a badge entry", () => {
    for (const [map, values] of [
      ["INTENT_STATE", INTENT_STATES],
      ["NBA_ACTION", NBA_ACTIONS],
      ["DIMENSION_STATUS", DIMENSION_STATUSES],
      ["FACT_STATE", FACT_STATES],
      ["ENGINE_MODE", QI_ENGINE_MODES],
    ] as const) {
      const block = badge.slice(badge.indexOf(`export const ${map} = {`));
      const body = block.slice(0, block.indexOf("} as const"));
      for (const value of values) assert.match(body, new RegExp(`\\b${value}: \\{`), `${map}.${value}`);
    }
    for (const kind of ["intent_state", "nba_action", "dimension_status", "fact_state", "engine_mode"]) {
      assert.match(badge, new RegExp(`${kind}: [A-Z_]+,`));
    }
  });

  test("no other surface maps these states to tones", () => {
    for (const path of [
      "src/components/leads/detail/next-best-action-card.tsx",
      "src/components/leads/detail/intent-panel.tsx",
      "src/components/leads/detail/lead-page-tabs.tsx",
      "src/components/settings/ai-selling/qualification-policy-card.tsx",
      "src/components/leads/lead-filter-popover.tsx",
    ]) {
      assert.equal(/BOOKING_READY:\s*\{[^}]*tone/.test(surface(path)), false, `${path} defines its own tone map`);
    }
  });
});

describe("Leads list: intent filters", () => {
  test("intent state, next action and strong-but-incomplete parse from the URL", () => {
    const filters = parseLeadFilters({ intent: "HIGH,BOOKING_READY,NOPE", nextAction: "ASK", strongIncomplete: "1" });
    assert.deepEqual(filters.intent, ["HIGH", "BOOKING_READY"]);
    assert.deepEqual(filters.nextAction, ["ASK"]);
    assert.equal(filters.strongIncomplete, true);
    assert.equal(hasActiveFilters(filters), true);
    assert.equal(activeFilterCount(filters), 3);
    assert.equal(parseLeadFilters({ intent: "NOPE" }).intent, undefined);
  });

  test("the list query and the popover apply them", () => {
    const queries = surface("src/lib/leads/queries.ts");
    assert.match(queries, /in\("intent_state", filters\.intent\)/);
    assert.match(queries, /in\("next_action", filters\.nextAction\)/);
    assert.match(queries, /lt\("qualification_completeness", INCOMPLETE_BELOW\)/);
    const popover = surface("src/components/leads/lead-filter-popover.tsx");
    assert.match(popover, /Strong intent, qualification incomplete/);
    assert.match(popover, /label="Buying intent"/);
    assert.match(popover, /label="Next best action"/);
  });
});
