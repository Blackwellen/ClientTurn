import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTE_ACTIONS,
  QUOTE_EVENT_TYPES,
  QUOTE_STATES,
  TRANSITIONS,
  assertEditable,
  canEditContent,
  creationEvents,
  effectiveState,
  isFrozen,
  isSigned,
  isTerminal,
  transition,
  validUntilFrom,
  type QuoteAction,
  type QuoteSnapshot,
  type QuoteState,
  type TransitionContext,
} from "../src/lib/quotes/lifecycle.ts";

const NOW = "2026-10-01T12:00:00.000Z";
const LATER = "2026-12-01T12:00:00.000Z";
const VALID_UNTIL = "2026-10-31T23:59:59.999Z";

const snap = (state: QuoteState, extra: Partial<QuoteSnapshot> = {}): QuoteSnapshot => ({
  state,
  validUntil: VALID_UNTIL,
  approvalRequired: false,
  ...extra,
});

/** The actor each action needs to be legal. */
const ACTOR: Record<QuoteAction, TransitionContext["actorKind"]> = {
  SUBMIT_FOR_APPROVAL: "HUMAN",
  APPROVE: "HUMAN",
  REJECT_APPROVAL: "HUMAN",
  SEND: "HUMAN",
  MARK_VIEWED: "CUSTOMER",
  ACCEPT: "CUSTOMER",
  SIGN: "CUSTOMER",
  DECLINE: "CUSTOMER",
  EXPIRE: "SYSTEM",
  REVISE: "HUMAN",
  WITHDRAW: "HUMAN",
  RECORD_DEPOSIT_PAID: "SYSTEM",
  RECORD_PAID: "SYSTEM",
  MARK_WON: "SYSTEM",
};

const ctx = (action: QuoteAction, now = NOW): TransitionContext => ({ now: action === "EXPIRE" ? LATER : now, actorKind: ACTOR[action] });

/** The complete legal table, written out independently of TRANSITIONS. */
const LEGAL: [QuoteState, QuoteAction, QuoteState, string[]][] = [
  ["DRAFT", "SUBMIT_FOR_APPROVAL", "PENDING_APPROVAL", ["quote.approval_requested"]],
  ["DRAFT", "SEND", "SENT", ["quote.sent"]],
  ["DRAFT", "REVISE", "REVISED", ["quote.revised"]],
  ["DRAFT", "WITHDRAW", "WITHDRAWN", ["quote.withdrawn"]],
  ["PENDING_APPROVAL", "APPROVE", "APPROVED", ["quote.approved"]],
  ["PENDING_APPROVAL", "REJECT_APPROVAL", "DRAFT", ["quote.approval_rejected"]],
  ["PENDING_APPROVAL", "EXPIRE", "EXPIRED", ["quote.expired"]],
  ["PENDING_APPROVAL", "REVISE", "REVISED", ["quote.revised"]],
  ["PENDING_APPROVAL", "WITHDRAW", "WITHDRAWN", ["quote.withdrawn"]],
  ["APPROVED", "SEND", "SENT", ["quote.sent"]],
  ["APPROVED", "EXPIRE", "EXPIRED", ["quote.expired"]],
  ["APPROVED", "REVISE", "REVISED", ["quote.revised"]],
  ["APPROVED", "WITHDRAW", "WITHDRAWN", ["quote.withdrawn"]],
  ["SENT", "MARK_VIEWED", "VIEWED", ["quote.viewed"]],
  ["SENT", "ACCEPT", "ACCEPTED", ["quote.accepted"]],
  ["SENT", "DECLINE", "DECLINED", ["quote.declined"]],
  ["SENT", "EXPIRE", "EXPIRED", ["quote.expired"]],
  ["SENT", "REVISE", "REVISED", ["quote.revised"]],
  ["SENT", "WITHDRAW", "WITHDRAWN", ["quote.withdrawn"]],
  ["VIEWED", "MARK_VIEWED", "VIEWED", []],
  ["VIEWED", "ACCEPT", "ACCEPTED", ["quote.accepted"]],
  ["VIEWED", "DECLINE", "DECLINED", ["quote.declined"]],
  ["VIEWED", "EXPIRE", "EXPIRED", ["quote.expired"]],
  ["VIEWED", "REVISE", "REVISED", ["quote.revised"]],
  ["VIEWED", "WITHDRAW", "WITHDRAWN", ["quote.withdrawn"]],
  ["ACCEPTED", "SIGN", "SIGNED", ["quote.signed"]],
  ["ACCEPTED", "DECLINE", "DECLINED", ["quote.declined"]],
  ["SIGNED", "RECORD_DEPOSIT_PAID", "DEPOSIT_PAID", ["quote.deposit_paid"]],
  ["SIGNED", "RECORD_PAID", "PAID", ["quote.paid"]],
  ["SIGNED", "MARK_WON", "WON", ["quote.won"]],
  ["DEPOSIT_PAID", "RECORD_PAID", "PAID", ["quote.paid"]],
  ["DEPOSIT_PAID", "MARK_WON", "WON", ["quote.won"]],
  ["PAID", "MARK_WON", "WON", ["quote.won"]],
];

describe("every legal transition", () => {
  for (const [from, action, to, events] of LEGAL) {
    test(`${from} --${action}--> ${to}`, () => {
      const result = transition(snap(from), action, ctx(action));
      assert.equal(result.ok, true, JSON.stringify(result));
      if (result.ok) {
        assert.equal(result.to, to);
        assert.deepEqual(result.events, events);
      }
    });
  }

  test("the written table matches the machine exactly", () => {
    const fromMachine = QUOTE_STATES.flatMap((state) => Object.entries(TRANSITIONS[state]).map(([action, to]) => `${state}|${action}|${to}`)).sort();
    const written = LEGAL.map(([from, action, to]) => `${from}|${action}|${to}`).sort();
    assert.deepEqual(fromMachine, written);
  });
});

describe("every illegal transition is refused", () => {
  const legal = new Set(LEGAL.map(([from, action]) => `${from}|${action}`));
  for (const state of QUOTE_STATES) {
    for (const action of QUOTE_ACTIONS) {
      if (legal.has(`${state}|${action}`)) continue;
      test(`${state} x ${action}`, () => {
        const result = transition(snap(state), action, ctx(action));
        assert.equal(result.ok, false);
        if (!result.ok) assert.ok(["ILLEGAL_TRANSITION", "LOCKED_AFTER_SIGNING"].includes(result.reason), result.reason);
      });
    }
  }
});

describe("guards", () => {
  test("SEND from DRAFT is refused when approval is required", () => {
    const result = transition(snap("DRAFT", { approvalRequired: true }), "SEND", ctx("SEND"));
    assert.deepEqual(result.ok ? null : result.reason, "APPROVAL_REQUIRED");
    assert.equal(transition(snap("APPROVED", { approvalRequired: true }), "SEND", ctx("SEND")).ok, true);
  });

  test("only a person approves; the AI cannot", () => {
    const result = transition(snap("PENDING_APPROVAL"), "APPROVE", { now: NOW, actorKind: "AI" });
    assert.equal(result.ok ? null : result.reason, "ACTOR_NOT_PERMITTED");
  });

  test("only the customer accepts, signs or declines", () => {
    for (const action of ["ACCEPT", "DECLINE"] as const) {
      for (const actor of ["AI", "HUMAN", "SYSTEM"] as const) {
        const result = transition(snap("VIEWED"), action, { now: NOW, actorKind: actor });
        assert.equal(result.ok ? null : result.reason, "ACTOR_NOT_PERMITTED");
      }
    }
    assert.equal(transition(snap("ACCEPTED"), "SIGN", { now: NOW, actorKind: "AI" }).ok, false);
  });

  test("an expired quote cannot be accepted, signed, sent or approved", () => {
    assert.equal((transition(snap("VIEWED"), "ACCEPT", { now: LATER, actorKind: "CUSTOMER" }) as { reason: string }).reason, "EXPIRED");
    assert.equal((transition(snap("ACCEPTED"), "SIGN", { now: LATER, actorKind: "CUSTOMER" }) as { reason: string }).reason, "EXPIRED");
    assert.equal((transition(snap("APPROVED"), "SEND", { now: LATER, actorKind: "HUMAN" }) as { reason: string }).reason, "EXPIRED");
    assert.equal((transition(snap("PENDING_APPROVAL"), "APPROVE", { now: LATER, actorKind: "HUMAN" }) as { reason: string }).reason, "EXPIRED");
  });

  test("EXPIRE before the valid-until date is refused", () => {
    assert.equal((transition(snap("SENT"), "EXPIRE", { now: NOW, actorKind: "SYSTEM" }) as { reason: string }).reason, "NOT_EXPIRED");
  });

  test("a quote with no expiry never expires", () => {
    assert.equal(transition(snap("SENT", { validUntil: null }), "ACCEPT", { now: LATER, actorKind: "CUSTOMER" }).ok, true);
    assert.equal(effectiveState(snap("SENT", { validUntil: null }), LATER), "SENT");
  });

  test("effective state reads a lapsed live quote as EXPIRED but never a signed one", () => {
    assert.equal(effectiveState(snap("VIEWED"), LATER), "EXPIRED");
    assert.equal(effectiveState(snap("VIEWED"), NOW), "VIEWED");
    assert.equal(effectiveState(snap("SIGNED"), LATER), "SIGNED");
    assert.equal(effectiveState(snap("ACCEPTED"), LATER), "ACCEPTED");
  });

  test("re-viewing is idempotent: no change, no event", () => {
    const result = transition(snap("VIEWED"), "MARK_VIEWED", ctx("MARK_VIEWED"));
    assert.ok(result.ok && result.changed === false && result.events.length === 0);
  });
});

describe("mutation after sending and signing", () => {
  test("content is editable only in DRAFT", () => {
    for (const state of QUOTE_STATES) assert.equal(canEditContent(state), state === "DRAFT");
  });

  test("after SENT a change needs a new revision", () => {
    assert.deepEqual(assertEditable("SENT"), { ok: false, reason: "NEEDS_NEW_REVISION", detail: "A sent quote is changed only by issuing a new revision." });
    assert.equal((assertEditable("VIEWED") as { reason: string }).reason, "NEEDS_NEW_REVISION");
    assert.equal(transition(snap("SENT"), "REVISE", ctx("REVISE")).ok, true);
  });

  test("nothing changes after SIGNED", () => {
    for (const state of ["SIGNED", "DEPOSIT_PAID", "PAID", "WON"] as const) {
      assert.equal((assertEditable(state) as { reason: string }).reason, "LOCKED_AFTER_SIGNING");
      for (const action of ["REVISE", "WITHDRAW", "DECLINE", "EXPIRE"] as const) {
        const result = transition(snap(state), action, ctx(action));
        assert.equal(result.ok ? null : result.reason, "LOCKED_AFTER_SIGNING", `${state} ${action}`);
      }
      assert.equal(isSigned(state), true);
    }
  });

  test("pending approval or approved: return to draft first", () => {
    assert.equal((assertEditable("APPROVED") as { reason: string }).reason, "NOT_EDITABLE");
  });

  test("frozen and terminal states", () => {
    assert.deepEqual(QUOTE_STATES.filter(isFrozen), ["SENT", "VIEWED", "ACCEPTED", "SIGNED", "DEPOSIT_PAID", "PAID", "WON", "DECLINED", "EXPIRED", "REVISED", "WITHDRAWN"]);
    assert.deepEqual(QUOTE_STATES.filter(isTerminal), ["WON", "DECLINED", "EXPIRED", "REVISED", "WITHDRAWN"]);
  });
});

describe("events for automations", () => {
  test("the §45 event set is emitted", () => {
    const required = [
      "quote.requested",
      "quote.created",
      "quote.approval_requested",
      "quote.approved",
      "quote.sent",
      "quote.viewed",
      "quote.accepted",
      "quote.declined",
      "quote.expired",
      "quote.signed",
    ];
    for (const event of required) assert.ok((QUOTE_EVENT_TYPES as readonly string[]).includes(event), event);
    const emitted = new Set([...LEGAL.flatMap(([, , , events]) => events), ...creationEvents("LEAD_REQUEST")]);
    for (const event of required) assert.ok(emitted.has(event), `${event} is never emitted`);
  });

  test("creation events", () => {
    assert.deepEqual(creationEvents("LEAD_REQUEST"), ["quote.requested", "quote.created"]);
    assert.deepEqual(creationEvents("USER"), ["quote.created"]);
    assert.deepEqual(creationEvents("AGENT"), ["quote.created"]);
  });

  test("a full happy path", () => {
    let state: QuoteState = "DRAFT";
    const events: string[] = [];
    const path: QuoteAction[] = ["SUBMIT_FOR_APPROVAL", "APPROVE", "SEND", "MARK_VIEWED", "ACCEPT", "SIGN", "RECORD_DEPOSIT_PAID", "RECORD_PAID", "MARK_WON"];
    for (const action of path) {
      const result = transition(snap(state, { approvalRequired: true }), action, ctx(action));
      assert.ok(result.ok, `${state} ${action}`);
      if (result.ok) {
        state = result.to;
        events.push(...result.events);
      }
    }
    assert.equal(state, "WON");
    assert.equal(events.length, path.length);
  });
});

describe("validity", () => {
  test("valid-until is the end of the UTC day N days after issue", () => {
    assert.equal(validUntilFrom("2026-10-01T09:30:00.000Z", 30), "2026-10-31T23:59:59.999Z");
    assert.equal(validUntilFrom("2026-12-20T23:00:00.000Z", 14), "2027-01-03T23:59:59.999Z");
    assert.throws(() => validUntilFrom(NOW, 0));
    assert.throws(() => validUntilFrom(NOW, 1.5));
  });
});
