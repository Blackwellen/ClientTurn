import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MOTION_STAGES,
  OPEN_STAGES,
  OPPORTUNITY_STAGES,
  canAdvance,
  closeTargetForMotion,
  hubspotDealStage,
  leadStatusFor,
  motionAllowsDirectClose,
  salesforceCloseDate,
  salesforceStageName,
  stageForEvent,
  stageRank,
  stagesForMotion,
  type SalesforceStage,
} from "../src/lib/opportunities/stages.ts";
import { SALES_MOTIONS } from "../src/lib/sales-library/types.ts";
import { SERVICE_OPERATIONS, registryProblems } from "../src/lib/services/registry.ts";

const migration = readFileSync(
  new URL("../supabase/migrations/0125_channels_closing_handoff.sql", import.meta.url),
  "utf8",
);

describe("stage vocabulary", () => {
  test("matches the 0125 CHECK constraint exactly", () => {
    const check = /opportunities_stage_check\s+check \(stage in \(([^)]+)\)\)/.exec(migration)?.[1] ?? "";
    const inSql = [...check.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(inSql, [...OPPORTUNITY_STAGES]);
  });

  test("the SQL rank order matches stageRank()", () => {
    const array = /array\[([^\]]+)\]::text\[\]/.exec(migration)?.[1] ?? "";
    const inSql = [...array.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(inSql, OPEN_STAGES);
    inSql.forEach((stage, index) => assert.equal(stageRank(stage), index + 1));
    assert.equal(stageRank("CLOSED"), 0);
  });
});

describe("advancing is forward only", () => {
  test("QUALIFIED after MEETING_BOOKED does not move the opportunity back", () => {
    assert.equal(canAdvance("MEETING_BOOKED", "QUALIFIED"), false);
    assert.equal(canAdvance("QUALIFIED", "MEETING_BOOKED"), true);
    assert.equal(canAdvance("QUALIFIED", "CHECKOUT_SENT"), true);
  });

  test("nothing advances to or out of CLOSED", () => {
    assert.equal(canAdvance("NEGOTIATION", "CLOSED"), false);
    assert.equal(canAdvance("CLOSED", "NEGOTIATION"), false);
  });

  test("the same stage is not an advance", () => {
    assert.equal(canAdvance("QUALIFIED", "QUALIFIED"), false);
  });
});

describe("stages follow the motion", () => {
  test("every motion has a pipeline of open stages in forward order", () => {
    for (const motion of SALES_MOTIONS) {
      const stages = MOTION_STAGES[motion];
      assert.ok(stages.length >= 3, motion);
      for (const stage of stages) assert.ok(stageRank(stage) > 0, `${motion}: ${stage}`);
    }
  });

  test("a checkout motion has no meeting stage; a meeting motion has no checkout stage", () => {
    assert.equal(stageForEvent("ECOMMERCE_DIRECT", "MEETING_BOOKED"), null);
    assert.equal(stageForEvent("ECOMMERCE_DIRECT", "CHECKOUT_SENT"), "CHECKOUT_SENT");
    assert.equal(stageForEvent("BOOK_MEETING_B2B", "CHECKOUT_SENT"), null);
    assert.equal(stageForEvent("BOOK_MEETING_B2B", "MEETING_BOOKED"), "MEETING_BOOKED");
  });

  test("qualification is a stage on every motion", () => {
    for (const motion of SALES_MOTIONS) assert.equal(stageForEvent(motion, "QUALIFIED"), "QUALIFIED");
  });

  test("an unknown motion allows every open stage", () => {
    assert.deepEqual([...stagesForMotion(null)], OPEN_STAGES);
  });

  test("direct close only on checkout motions", () => {
    assert.equal(motionAllowsDirectClose("ECOMMERCE_DIRECT"), true);
    assert.equal(motionAllowsDirectClose("SAAS_SELF_SERVE"), true);
    assert.equal(motionAllowsDirectClose("DIRECT_B2B"), true);
    assert.equal(motionAllowsDirectClose("ENTERPRISE"), false);
    assert.equal(motionAllowsDirectClose("BOOK_MEETING_B2B"), false);
    assert.equal(motionAllowsDirectClose(null), false);
  });

  test("close targets are valid opportunities.close_target values", () => {
    const allowed = ["BOOK", "BUY", "QUOTE", "PROPOSAL", "TRIAL", "APPLY", "NEXT_STAGE"];
    for (const motion of [...SALES_MOTIONS, null]) assert.ok(allowed.includes(closeTargetForMotion(motion)));
  });
});

describe("lead status is a projection of the outcome", () => {
  test("WON/LOST project, OPEN does not", () => {
    assert.equal(leadStatusFor("WON"), "WON");
    assert.equal(leadStatusFor("LOST"), "LOST");
    assert.equal(leadStatusFor("OPEN"), null);
  });

  test("close_opportunity updates the opportunity and the lead in one function, reason required", () => {
    const fn = migration.slice(migration.indexOf("function public.close_opportunity"));
    assert.match(fn, /a reason is required/);
    assert.match(fn, /update public\.opportunities/);
    assert.match(fn, /update public\.leads\s+set status = p_outcome/);
  });
});

describe("CRM stage maps", () => {
  test("HubSpot closed won / lost", () => {
    assert.equal(hubspotDealStage("NEGOTIATION", "WON"), "closedwon");
    assert.equal(hubspotDealStage("QUALIFIED", "LOST"), "closedlost");
    assert.equal(hubspotDealStage("MEETING_BOOKED", "OPEN"), "appointmentscheduled");
    assert.equal(hubspotDealStage("QUALIFIED", "OPEN"), "qualifiedtobuy");
  });

  const org: SalesforceStage[] = [
    { label: "Prospecting", isClosed: false, isWon: false, sortOrder: 1 },
    { label: "Qualification", isClosed: false, isWon: false, sortOrder: 2 },
    { label: "Needs Analysis", isClosed: false, isWon: false, sortOrder: 3 },
    { label: "Proposal/Price Quote", isClosed: false, isWon: false, sortOrder: 4 },
    { label: "Negotiation/Review", isClosed: false, isWon: false, sortOrder: 5 },
    { label: "Closed Lost", isClosed: true, isWon: false, sortOrder: 7 },
    { label: "Closed Won", isClosed: true, isWon: true, sortOrder: 6 },
  ];

  test("Salesforce picks from the org's own stages", () => {
    assert.equal(salesforceStageName("QUALIFIED", "WON", org), "Closed Won");
    assert.equal(salesforceStageName("QUALIFIED", "LOST", org), "Closed Lost");
    assert.equal(salesforceStageName("OPEN", "OPEN", org), "Prospecting");
    assert.equal(salesforceStageName("QUALIFIED", "OPEN", org), "Qualification");
    assert.equal(salesforceStageName("PROPOSAL", "OPEN", org), "Proposal/Price Quote");
    assert.equal(salesforceStageName("NEGOTIATION", "OPEN", org), "Negotiation/Review");
  });

  test("Salesforce never guesses: no suitable stage is null", () => {
    assert.equal(salesforceStageName("QUALIFIED", "WON", org.filter((s) => !s.isWon)), null);
    assert.equal(salesforceStageName("QUALIFIED", "OPEN", []), null);
  });

  test("Salesforce CloseDate is always set", () => {
    const base = {
      id: "x", name: "n", stage: "QUALIFIED", outcome: "OPEN", outcomeReason: null,
      value: null, currency: "GBP", expectedCloseDate: null, closedAt: null,
    };
    assert.equal(salesforceCloseDate({ ...base, closedAt: "2026-09-20T10:00:00Z" }), "2026-09-20");
    assert.equal(salesforceCloseDate(base, new Date("2026-09-01T00:00:00Z")), "2026-10-01");
  });
});

describe("service operations", () => {
  test("opportunity.get/list/set_stage/close are declared and well formed", () => {
    const names = SERVICE_OPERATIONS.map((op) => op.name as string);
    for (const name of ["opportunity.get", "opportunity.list", "opportunity.set_stage", "opportunity.close"]) {
      assert.ok(names.includes(name), name);
    }
    assert.deepEqual(registryProblems(), []);
  });

  test("closing needs a person's confirmation and is not available to the autonomous agent", () => {
    const close = SERVICE_OPERATIONS.find((op) => op.name === "opportunity.close")!;
    assert.equal(close.risk, "EXTERNAL");
    assert.ok(close.effect);
    assert.ok(!("callers" in close) || !(close.callers as readonly string[]).includes("AGENT"));
  });
});
