import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assembleSourceFunnel,
  assembleSourceFunnels,
  classifyTouch,
  COLD_EMAIL_GROUP,
  FAMILY_STAGES,
  median,
  socialOutreachGroup,
  type Journey,
} from "../src/lib/analytics/source-funnels.ts";

const at = (hours: number) => new Date(Date.UTC(2026, 8, 1) + hours * 3_600_000).toISOString();

describe("each source starts at its own entry point", () => {
  test("LinkedIn outreach starts at the connection request", () => {
    const group = socialOutreachGroup("LINKEDIN");
    const funnel = assembleSourceFunnel({ group, journeys: [{ stages: { entry: at(0) } }] });
    assert.equal(funnel.label, "LinkedIn outreach");
    assert.equal(funnel.stages[0].label, "Connection request sent");
    assert.deepEqual(
      funnel.stages.slice(0, 5).map((s) => s.key),
      ["entry", "accepted", "messaged", "replied", "promoted"],
    );
  });

  test("lead forms start at submission and are named by provider", () => {
    const meta = classifyTouch({ sourceType: "AD_FORM", provider: "meta" });
    const linkedin = classifyTouch({ sourceType: "AD_FORM", provider: "linkedin_ads" });
    const google = classifyTouch({ sourceType: "AD_FORM", provider: "google_ads" });
    assert.equal(meta.family, "LEAD_FORM");
    assert.equal(linkedin.label, "LinkedIn Lead Gen Forms");
    assert.equal(google.label, "Google Ads lead forms");
    assert.equal(FAMILY_STAGES.LEAD_FORM[0].label, "Form submitted");
  });

  test("cold email starts at prospect found and passes contactable and first email", () => {
    assert.deepEqual(
      FAMILY_STAGES.COLD_EMAIL.slice(0, 5).map((s) => s.key),
      ["entry", "contactable", "first_email", "replied", "promoted"],
    );
    assert.equal(COLD_EMAIL_GROUP.family, "COLD_EMAIL");
  });

  test("imports, manual, API and CRM start at the record being added", () => {
    assert.equal(classifyTouch({ sourceType: "CSV", provider: "csv" }).family, "IMPORTED");
    assert.equal(classifyTouch({ sourceType: "MANUAL", provider: "ui" }).entryLabel, "Added");
    assert.equal(classifyTouch({ sourceType: "CRM", provider: "hubspot" }).label, "Hubspot (CRM)");
    assert.equal(classifyTouch({ sourceType: "API", provider: "api" }).family, "IMPORTED");
  });

  test("a lead with no touch is grouped honestly, not guessed", () => {
    assert.equal(classifyTouch(null).label, "Source not recorded");
  });

  test("every funnel ends in the same close stages, won recorded by a person", () => {
    for (const stages of Object.values(FAMILY_STAGES)) {
      const tail = stages.slice(-4).map((s) => s.key);
      assert.deepEqual(tail, ["qualified", "booked", "showed", "won"]);
      assert.equal(stages.find((s) => s.key === "won")?.manual, true);
      assert.equal(stages.find((s) => s.key === "showed")?.manual, true);
      assert.equal(stages.find((s) => s.key === "qualified")?.manual, undefined);
    }
  });
});

describe("assembly never fabricates progression", () => {
  const group = classifyTouch({ sourceType: "AD_FORM", provider: "meta" });

  test("a qualified lead that never replied is not counted as replied", () => {
    const journeys: Journey[] = [
      { stages: { entry: at(0), contacted: at(1), qualified: at(0.5) } },
      { stages: { entry: at(0), contacted: at(1), replied: at(3), qualified: at(4) } },
    ];
    const funnel = assembleSourceFunnel({ group, journeys });
    const stage = (key: string) => funnel.stages.find((s) => s.key === key)!;
    assert.equal(stage("replied").count, 1);
    assert.equal(stage("qualified").count, 2);
    // Step conversion counts leads that reached both stages, so it cannot pass 100%.
    assert.equal(stage("qualified").step?.value, 1);
    assert.equal(stage("qualified").step?.numerator, 1);
    assert.equal(stage("qualified").step?.denominator, 1);
  });

  test("an empty denominator is null, not 0%", () => {
    const funnel = assembleSourceFunnel({ group, journeys: [{ stages: { entry: at(0) } }] });
    const replied = funnel.stages.find((s) => s.key === "replied")!;
    assert.equal(replied.count, 0);
    assert.equal(replied.step?.value, null);
    const qualified = funnel.stages.find((s) => s.key === "qualified")!;
    assert.equal(qualified.step?.value, null, "0 replied means no rate, not a 0% rate");
  });

  test("an untracked stage is null and not tracked, and breaks the next step", () => {
    const funnel = assembleSourceFunnel({
      group,
      journeys: [{ stages: { entry: at(0), contacted: at(1) } }],
      untracked: ["contacted"],
    });
    const contacted = funnel.stages.find((s) => s.key === "contacted")!;
    assert.equal(contacted.count, null);
    assert.equal(contacted.tracked, false);
    assert.equal(funnel.stages.find((s) => s.key === "replied")!.step, null);
  });

  test("small samples are flagged below 30", () => {
    const journeys: Journey[] = Array.from({ length: 10 }, (_, i) => ({
      stages: { entry: at(0), contacted: i < 5 ? at(1) : null },
    }));
    const contacted = assembleSourceFunnel({ group, journeys }).stages[1];
    assert.equal(contacted.step?.value, 0.5);
    assert.equal(contacted.step?.lowSample, true);
    const big = Array.from({ length: 40 }, () => ({ stages: { entry: at(0), contacted: at(1) } }));
    assert.equal(assembleSourceFunnel({ group, journeys: big }).stages[1].step?.lowSample, false);
  });
});

describe("time between stages", () => {
  test("median over journeys with both times, ignoring out-of-order ones", () => {
    const group = socialOutreachGroup("LINKEDIN");
    const journeys: Journey[] = [
      { stages: { entry: at(0), accepted: at(10) } },
      { stages: { entry: at(0), accepted: at(20) } },
      { stages: { entry: at(0), accepted: at(30) } },
      { stages: { entry: at(5), accepted: at(1) } }, // out of order: excluded
    ];
    const accepted = assembleSourceFunnel({ group, journeys }).stages[1];
    assert.equal(accepted.medianSeconds, 20 * 3600);
    assert.equal(accepted.timedSample, 3);
  });

  test("a stage recorded without a time has no duration, and nor does the next", () => {
    const funnel = assembleSourceFunnel({
      group: COLD_EMAIL_GROUP,
      journeys: [{ stages: { entry: at(0), contactable: true, first_email: true, replied: at(9) } }],
    });
    const stage = (key: string) => funnel.stages.find((s) => s.key === key)!;
    assert.equal(stage("contactable").timed, false);
    assert.equal(stage("contactable").count, 1);
    assert.equal(stage("replied").timed, false);
    assert.equal(stage("replied").medianSeconds, null);
    assert.equal(stage("promoted").timed, true);
  });

  test("median of an even set averages the middle pair", () => {
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), null);
  });
});

describe("close types and grouping", () => {
  test("wins are broken down by the opportunity's close type", () => {
    const group = classifyTouch({ sourceType: "WEB_FORM", provider: "web" });
    const funnel = assembleSourceFunnel({
      group,
      journeys: [
        { stages: { entry: at(0), won: at(50) }, closeType: "BUY" },
        { stages: { entry: at(0), won: at(60) }, closeType: "BUY" },
        { stages: { entry: at(0), won: at(70) }, closeType: "TRIAL" },
        { stages: { entry: at(0), won: at(80) }, closeType: null },
        { stages: { entry: at(0) }, closeType: "BOOK" }, // not won: not counted
      ],
    });
    assert.deepEqual(
      funnel.closeTypes.map((t) => [t.label, t.count]),
      [["Sale", 2], ["Sign-up", 1], ["Close type not recorded", 1]],
    );
  });

  test("sources are grouped, emptied ones dropped, largest first", () => {
    const meta = classifyTouch({ sourceType: "AD_FORM", provider: "meta" });
    const csv = classifyTouch({ sourceType: "CSV", provider: "csv" });
    const funnels = assembleSourceFunnels([
      { group: csv, journey: { stages: { entry: at(0) } } },
      { group: meta, journey: { stages: { entry: at(0) } } },
      { group: meta, journey: { stages: { entry: at(1) } } },
      { group: socialOutreachGroup("FACEBOOK"), journey: { stages: {} } },
    ]);
    assert.deepEqual(funnels.map((f) => [f.label, f.entries]), [["Meta lead ads", 2], ["CSV import", 1]]);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

  test("the analytics page offers Source funnels as its own tab", () => {
    assert.match(read("src/components/analytics/analytics-view.tsx"), /value: "sources", label: "Source funnels"/);
    assert.match(read("src/app/(app)/app/analytics/page.tsx"), /getSourceFunnels\(businessId, bounds\)/);
  });

  test("the read keeps promoted leads out of inbound funnels and handles every error", () => {
    const query = read("src/lib/analytics/source-funnels-query.ts");
    assert.match(query, /\.is\("promoted_from_prospect_id", null\)/);
    assert.doesNotMatch(query, /const \{ data \} = await/);
  });
});
