import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { interestServiceForEvent, type OpenInterestOpportunity } from "../src/lib/qualification-intelligence/interests.ts";
import { stageForEvent } from "../src/lib/opportunities/stages.ts";

/**
 * Story S1 regression (2026-09-27): a lead with a website rebuild (meeting-led
 * workspace) and a Growth subscription (self-serve) was sent the
 * subscription's checkout link, but the subscription's opportunity stayed
 * OPEN. The advance used the WORKSPACE motion, BOOK_MEETING_B2B, which has no
 * CHECKOUT_SENT stage, so it was skipped before the interest was chosen.
 */
const WEB = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-8222-222222222222";

const opp = (id: string, serviceId: string, extra: Partial<OpenInterestOpportunity> = {}): OpenInterestOpportunity => ({
  id,
  serviceId,
  stage: "OPEN",
  closeTarget: "BOOK",
  goal: null,
  createdAt: "2026-09-27T10:00:00.000Z",
  ...extra,
});

describe("a checkout advances the interest it sells", () => {
  test("the workspace motion alone has no checkout stage; the interest's own motion does", () => {
    assert.equal(stageForEvent("BOOK_MEETING_B2B", "CHECKOUT_SENT"), null);
    assert.equal(stageForEvent("SAAS_SELF_SERVE", "CHECKOUT_SENT"), "CHECKOUT_SENT");
  });

  test("the named interest wins when both interests have an opportunity", () => {
    const open = [opp("w", WEB), opp("s", SUB, { goal: "D_SIGNUP_TRIAL", closeTarget: "TRIAL" })];
    assert.equal(interestServiceForEvent(open, "CHECKOUT_SENT", { serviceId: SUB, leadServiceId: WEB }).serviceId, SUB);
    assert.equal(interestServiceForEvent(open, "CHECKOUT_SENT", { linkServiceId: SUB, leadServiceId: WEB }).serviceId, SUB);
  });

  test("a named interest with no opportunity yet gets its own, never the lead's own", () => {
    for (const hint of [{ serviceId: SUB }, { linkServiceId: SUB }]) {
      const picked = interestServiceForEvent([opp("w", WEB)], "CHECKOUT_SENT", { ...hint, leadServiceId: WEB });
      assert.equal(picked.serviceId, SUB, JSON.stringify(hint));
      assert.equal(picked.picked, null);
    }
  });

  test("a single-interest lead keeps the legacy path", () => {
    assert.equal(interestServiceForEvent([opp("w", WEB)], "CHECKOUT_SENT", { linkServiceId: WEB, leadServiceId: WEB }).serviceId, null);
    assert.equal(interestServiceForEvent([], "CHECKOUT_SENT", { leadServiceId: WEB }).serviceId, null);
    // A link's service only names the interest for a checkout.
    assert.equal(interestServiceForEvent([opp("w", WEB)], "MEETING_BOOKED", { linkServiceId: SUB, leadServiceId: WEB }).serviceId, null);
  });

  test("the orchestrator passes the focused interest and its motion to the checkout", () => {
    const orchestrator = readFileSync("src/lib/agent/orchestrator.ts", "utf8");
    assert.match(orchestrator, /serviceId: input\.stats\.qi\?\.interests\?\.primary\.serviceId \?\? null,\s*motion: input\.stats\.qi\?\.interests \? input\.context\.sales\.motion : null/);
    const tools = readFileSync("src/lib/agent/tools.ts", "utf8");
    assert.match(tools, /serviceId: input\.serviceId \?\? null,\s*motion: input\.motion \?\? null/);
    const service = readFileSync("src/lib/opportunities/service.ts", "utf8");
    assert.match(service, /const motion = input\.serviceId && input\.motion \? input\.motion : await loadWorkspaceMotion/);
  });
});
