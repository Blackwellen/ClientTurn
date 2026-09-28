import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SEMANTIC_MAP,
  EVENT_SEMANTIC,
  PIPELINE_SEMANTICS,
  allowedTargets,
  changedFromDefault,
  parseSemanticMap,
  planPipelineMove,
  semanticForEvent,
  semanticMapSchema,
  stageForMotion,
} from "../src/lib/opportunities/pipeline-semantics.ts";
import { AUTOMATION_EVENT_TYPES } from "../src/lib/automation/event-types.ts";
import { OPEN_STAGES } from "../src/lib/opportunities/stages.ts";

/**
 * Pipeline semantics (gap map §46): the system's deal steps mapped onto the
 * workspace's own pipeline, forward only and motion-aware.
 */

const open = (stage: string) => ({ stage, outcome: "OPEN" });

describe("the semantic vocabulary and its defaults", () => {
  test("every semantic from the brief exists, in order", () => {
    assert.deepEqual([...PIPELINE_SEMANTICS], [
      "NEW", "CONTACTED", "QUALIFIED", "QUOTED", "BOOKING_PENDING", "BOOKED", "NEGOTIATION", "ACCEPTED",
      "PAYMENT_PENDING", "WON", "NURTURE", "DISQUALIFIED", "LOST", "REACTIVATION",
    ]);
  });

  test("the defaults are valid, and only WON closes a deal by default", () => {
    assert.equal(semanticMapSchema.safeParse(DEFAULT_SEMANTIC_MAP).success, true);
    const closing = PIPELINE_SEMANTICS.filter((s) => DEFAULT_SEMANTIC_MAP[s].startsWith("CLOSE_"));
    assert.deepEqual(closing, ["WON"]);
  });

  test("closing is reserved: WON may only close as won, LOST and DISQUALIFIED only as lost", () => {
    assert.deepEqual([...allowedTargets("WON")], ["CLOSE_WON", "NO_MOVE"]);
    assert.deepEqual([...allowedTargets("LOST")], ["CLOSE_LOST", "NO_MOVE"]);
    assert.ok(!allowedTargets("QUOTED").includes("CLOSE_WON"));
    assert.equal(semanticMapSchema.safeParse({ ...DEFAULT_SEMANTIC_MAP, QUOTED: "CLOSE_WON" }).success, false);
    assert.equal(semanticMapSchema.safeParse({ ...DEFAULT_SEMANTIC_MAP, LOST: "PROPOSAL" }).success, false);
    assert.equal(semanticMapSchema.safeParse({ ...DEFAULT_SEMANTIC_MAP, LOST: "CLOSE_LOST" }).success, true);
  });

  test("a stored map is read one entry at a time: bad entries fall back to their default", () => {
    const map = parseSemanticMap({ QUOTED: "NEGOTIATION", ACCEPTED: "CLOSE_WON", BOOKED: 7, NOPE: "OPEN" });
    assert.equal(map.QUOTED, "NEGOTIATION");
    assert.equal(map.ACCEPTED, DEFAULT_SEMANTIC_MAP.ACCEPTED);
    assert.equal(map.BOOKED, DEFAULT_SEMANTIC_MAP.BOOKED);
    assert.deepEqual(changedFromDefault(map), ["QUOTED"]);
    assert.deepEqual(parseSemanticMap(null), DEFAULT_SEMANTIC_MAP);
  });
});

describe("motion-aware stages", () => {
  test("a stage the motion lacks lands on the nearest earlier one it has", () => {
    // ECOMMERCE_DIRECT: OPEN, QUALIFIED, CHECKOUT_SENT.
    assert.equal(stageForMotion("PROPOSAL", "ECOMMERCE_DIRECT"), "QUALIFIED");
    assert.equal(stageForMotion("QUALIFYING", "ECOMMERCE_DIRECT"), "OPEN");
    assert.equal(stageForMotion("PROPOSAL", "BOOK_MEETING_B2B"), "PROPOSAL");
    // No motion set: the full open vocabulary.
    for (const stage of OPEN_STAGES) assert.equal(stageForMotion(stage, null), stage);
  });
});

describe("planPipelineMove", () => {
  const map = { ...DEFAULT_SEMANTIC_MAP };

  test("a sent quote moves an open deal forward to Proposal", () => {
    assert.deepEqual(planPipelineMove({ semantic: "QUOTED", map, motion: "BOOK_MEETING_B2B", opportunity: open("QUALIFIED") }), { kind: "ADVANCE", stage: "PROPOSAL" });
  });

  test("never backwards, never twice", () => {
    assert.equal(planPipelineMove({ semantic: "QUOTED", map, motion: null, opportunity: open("NEGOTIATION") }).kind, "NONE");
    assert.equal(planPipelineMove({ semantic: "QUOTED", map, motion: null, opportunity: open("PROPOSAL") }).kind, "NONE");
  });

  test("a closed deal is never moved, whatever the map says", () => {
    assert.equal(planPipelineMove({ semantic: "WON", map, motion: null, opportunity: { stage: "CLOSED", outcome: "WON" } }).kind, "NONE");
    assert.equal(planPipelineMove({ semantic: "QUOTED", map, motion: null, opportunity: { stage: "PROPOSAL", outcome: "LOST" } }).kind, "NONE");
  });

  test("paid in full closes the deal as won, with a reason", () => {
    const move = planPipelineMove({ semantic: "WON", map, motion: null, opportunity: open("NEGOTIATION") });
    assert.equal(move.kind, "CLOSE");
    assert.equal(move.kind === "CLOSE" && move.outcome, "WON");
    assert.match(move.kind === "CLOSE" ? move.reason : "", /pipeline mapping/);
  });

  test("the workspace's own mapping is what moves the deal", () => {
    const custom = { ...map, QUOTED: "NEGOTIATION" as const, LOST: "CLOSE_LOST" as const };
    assert.deepEqual(planPipelineMove({ semantic: "QUOTED", map: custom, motion: null, opportunity: open("QUALIFIED") }), { kind: "ADVANCE", stage: "NEGOTIATION" });
    assert.equal(planPipelineMove({ semantic: "LOST", map: custom, motion: null, opportunity: open("PROPOSAL") }).kind, "CLOSE");
    assert.equal(planPipelineMove({ semantic: "LOST", map, motion: null, opportunity: open("PROPOSAL") }).kind, "NONE");
  });

  test("with no deal there is nothing to move", () => {
    assert.equal(planPipelineMove({ semantic: "QUOTED", map, motion: null, opportunity: null }).kind, "NONE");
  });
});

describe("quote, voice and payment events", () => {
  test("every mapped event is a real automation event", () => {
    for (const type of Object.keys(EVENT_SEMANTIC)) {
      assert.ok((AUTOMATION_EVENT_TYPES as readonly string[]).includes(type), type);
    }
  });

  test("the lifecycle reads as the brief's sequence", () => {
    assert.equal(semanticForEvent("call.answered"), "CONTACTED");
    assert.equal(semanticForEvent("call.qualified"), "QUALIFIED");
    assert.equal(semanticForEvent("quote.sent"), "QUOTED");
    assert.equal(semanticForEvent("booking.link_sent"), "BOOKING_PENDING");
    assert.equal(semanticForEvent("booking.created"), "BOOKED");
    assert.equal(semanticForEvent("signature.completed"), "ACCEPTED");
    assert.equal(semanticForEvent("invoice.issued"), "PAYMENT_PENDING");
    assert.equal(semanticForEvent("payment.direct_sale"), "WON");
    assert.equal(semanticForEvent("quote.expired"), "REACTIVATION");
    assert.equal(semanticForEvent("message.sent"), null);
  });

  test("a paid invoice is Won only when the quote is paid in full", () => {
    assert.equal(semanticForEvent("invoice.paid", { quoteStatus: "PAID" }), "WON");
    assert.equal(semanticForEvent("invoice.paid", { quoteStatus: "DEPOSIT_PAID" }), "PAYMENT_PENDING");
    assert.equal(semanticForEvent("invoice.paid", { quoteStatus: null }), "PAYMENT_PENDING");
  });
});
