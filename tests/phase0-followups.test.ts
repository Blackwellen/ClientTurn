/**
 * Phase 0 follow-ups to B10 (booking confirmation) and B14 (reply
 * classification vocabulary).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { staffStatusChange } from "../src/lib/bookings/confirmation.ts";
import { staffBookingActions } from "../src/lib/bookings/staff-actions.ts";
import {
  MESSAGE_REPLY_CLASSIFICATIONS,
  POSITIVE_MESSAGE_REPLY_CLASSIFICATIONS,
  REPLY_CLASSIFICATIONS,
  toMessageReplyClassification,
} from "../src/lib/agent/types.ts";
import { REPLY_RULES } from "../src/lib/outreach/campaign-draft.ts";

describe("staff booking actions (B10 follow-up)", () => {
  test("a pending request offers exactly Confirm time and Decline", () => {
    const actions = staffBookingActions("pending");
    assert.deepEqual(
      actions.map((action) => [action.to, action.label]),
      [
        ["scheduled", "Confirm time"],
        ["cancelled", "Decline"],
      ],
    );
  });

  test("confirming a pending request books the lead; declining does not", () => {
    assert.deepEqual(staffStatusChange("pending", "scheduled"), { ok: true, bookLead: true });
    assert.deepEqual(staffStatusChange("pending", "cancelled"), { ok: true, bookLead: false });
  });

  test("a scheduled booking offers outcomes, never confirmation", () => {
    const targets = staffBookingActions("scheduled").map((action) => action.to);
    assert.deepEqual(targets, ["completed", "no_show", "cancelled"]);
  });

  test("every offered action is one the server accepts", () => {
    for (const from of ["pending", "scheduled", "completed", "cancelled", "no_show"]) {
      for (const action of staffBookingActions(from)) {
        const change = staffStatusChange(from, action.to);
        assert.equal(change.ok, true, `${from} -> ${action.to} is offered but refused`);
      }
    }
  });

  test("only confirming a pending request books the lead", () => {
    for (const from of ["pending", "scheduled", "completed", "cancelled", "no_show"]) {
      for (const action of staffBookingActions(from)) {
        const change = staffStatusChange(from, action.to);
        const books = change.ok && change.bookLead;
        assert.equal(books, from === "pending" && action.to === "scheduled");
      }
    }
  });
});

describe("reply classification vocabulary (B14 follow-up)", () => {
  test("NOT_INTERESTED and BOOKING_INTENT are stored as themselves", () => {
    assert.equal(toMessageReplyClassification("NOT_INTERESTED"), "NOT_INTERESTED");
    assert.equal(toMessageReplyClassification("BOOKING_INTENT"), "BOOKING_INTENT");
  });

  test("BOOKING_INTENT counts as a positive reply", () => {
    assert.ok(POSITIVE_MESSAGE_REPLY_CLASSIFICATIONS.includes("BOOKING_INTENT"));
  });

  const ruleFor = (value: string) =>
    REPLY_RULES.filter((rule) => (rule.classifications as readonly string[]).includes(value));

  test("campaign rules: POSITIVE includes BOOKING_INTENT, NOT_INTERESTED includes NOT_INTERESTED", () => {
    assert.deepEqual(ruleFor("BOOKING_INTENT").map((rule) => rule.key), ["POSITIVE"]);
    assert.deepEqual(ruleFor("NOT_INTERESTED").map((rule) => rule.key), ["NOT_INTERESTED"]);
  });

  test("every stored classification a reply can be given falls under exactly one rule", () => {
    for (const bucket of REPLY_CLASSIFICATIONS) {
      if (bucket === "UNKNOWN") continue;
      const stored = toMessageReplyClassification(bucket);
      assert.equal(ruleFor(stored).length, 1, `${bucket} -> ${stored} is under ${ruleFor(stored).length} rules`);
    }
  });

  test("campaign rules only name values the database accepts, each at most once", () => {
    const seen = new Set<string>();
    for (const rule of REPLY_RULES) {
      for (const value of rule.classifications) {
        assert.ok(
          (MESSAGE_REPLY_CLASSIFICATIONS as readonly string[]).includes(value),
          `${rule.key} names unknown classification ${value}`,
        );
        assert.ok(!seen.has(value), `${value} is under more than one rule`);
        seen.add(value);
      }
    }
  });
});
