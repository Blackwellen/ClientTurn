import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSend,
  isPermanentOutcome,
  manualSendKeys,
  performSend,
  shouldRetrySend,
  SENDING_STATUS,
  type OutboundMessageRecord,
  type SendGuardSnapshot,
  type SendStore,
} from "../src/lib/jobs/send-core.ts";
import { draftApprovalVerdict, STALE_DRAFT_ERROR } from "../src/lib/agent/draft-approval.ts";
import {
  isPermittedTestRecipient,
  normaliseTestDestination,
} from "../src/lib/follow-up/test-send-recipients.ts";
import type { MessagingProvider, SendRequest, SendResult } from "../src/lib/messaging/types.ts";

const MIDDAY = new Date("2026-06-15T12:00:00.000Z");

function snapshot(overrides: Partial<SendGuardSnapshot> = {}): SendGuardSnapshot {
  return {
    lead: {
      status: "CONTACTED",
      optedOut: false,
      humanTakeover: false,
      automationActive: true,
      hasReplied: false,
    },
    channel: { subscriptionActive: true, integrationHealthy: true, contactSuppressed: false },
    quietHours: { enabled: false, start: "20:00", end: "08:00", timezone: "Europe/London" },
    origin: "automation",
    ...overrides,
  };
}

const QUEUED: OutboundMessageRecord = {
  id: "msg-1",
  businessId: "biz-1",
  leadId: "lead-1",
  channel: "sms",
  body: "Hello",
  status: "QUEUED",
  sendKey: "run:1:step:1",
  to: "+447700900123",
  origin: "automation",
};

/**
 * One shared row, as the database holds it, with the claim implemented as the
 * real store does: a conditional QUEUED -> SENDING that only one caller wins.
 */
function sharedRow(initial: OutboundMessageRecord) {
  const row = { ...initial };
  const calls = { reconciled: 0, markedSent: 0, released: 0 };

  function store(options: { markSentThrows?: boolean } = {}): SendStore {
    return {
      async load() {
        return { ...row };
      },
      async snapshot() {
        return snapshot();
      },
      async policy() {
        return { action: "allow" };
      },
      async claim() {
        if (row.status !== "QUEUED") return false;
        row.status = SENDING_STATUS;
        return true;
      },
      async reconcileInFlight() {
        calls.reconciled += 1;
      },
      async blockedByPolicy() {
        row.status = "BLOCKED";
      },
      async markSent() {
        if (options.markSentThrows) throw new Error("database unavailable");
        row.status = "SENT";
        calls.markedSent += 1;
      },
      async markFailed(_m, _r, terminal) {
        if (terminal) row.status = "FAILED";
        else if (row.status === SENDING_STATUS) {
          row.status = "QUEUED";
          calls.released += 1;
        }
      },
      async abort() {
        row.status = "FAILED";
      },
      async reschedule() {},
      async meter() {},
    };
  }

  return { row, calls, store };
}

function provider(
  onSend: (request: SendRequest) => Promise<SendResult> | SendResult = () => ({
    ok: true,
    provider: "stub",
    providerMessageId: "prov-1",
  }),
): MessagingProvider & { sent: SendRequest[] } {
  const sent: SendRequest[] = [];
  return {
    sent,
    async send(request: SendRequest) {
      sent.push(request);
      return onSend(request);
    },
  } as MessagingProvider & { sent: SendRequest[] };
}

/* ------------------------------------------------------------------ B6 --- */

describe("B6: one claim reaches the carrier", () => {
  test("two concurrent jobs for one message send exactly once", async () => {
    const shared = sharedRow(QUEUED);
    // The provider yields, so both jobs pass the QUEUED read before either
    // records an outcome -- the window the old check-then-send left open.
    const carrier = provider(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, provider: "stub", providerMessageId: "prov-1" };
    });

    const [a, b] = await Promise.all([
      performSend({ store: shared.store(), provider: carrier, messageId: QUEUED.id, now: MIDDAY }),
      performSend({ store: shared.store(), provider: carrier, messageId: QUEUED.id, now: MIDDAY }),
    ]);

    assert.equal(carrier.sent.length, 1);
    const outcomes = [a.outcome, b.outcome].sort();
    assert.deepEqual(outcomes, ["already_processed", "sent"]);
    assert.equal(shared.row.status, "SENT");
  });

  test("a crash after the carrier accepted leaves SENDING, and the retry does not resend", async () => {
    const shared = sharedRow(QUEUED);
    const carrier = provider();

    await assert.rejects(
      performSend({
        store: shared.store({ markSentThrows: true }),
        provider: carrier,
        messageId: QUEUED.id,
        now: MIDDAY,
      }),
    );
    assert.equal(shared.row.status, SENDING_STATUS);

    const retry = await performSend({
      store: shared.store(),
      provider: carrier,
      messageId: QUEUED.id,
      now: MIDDAY,
    });

    assert.equal(retry.outcome, "unconfirmed");
    assert.equal(carrier.sent.length, 1, "the retry must not reach the carrier");
    assert.equal(shared.calls.reconciled, 1);
    assert.equal(isPermanentOutcome(retry), true);
    assert.equal(shouldRetrySend(retry), false);
  });

  test("a retryable provider failure releases the claim so the retry can send", async () => {
    const shared = sharedRow(QUEUED);
    let attempt = 0;
    const carrier = provider(() => {
      attempt += 1;
      return attempt === 1
        ? { ok: false, provider: "stub", errorCode: "timeout", errorMessage: "timeout", permanent: false }
        : { ok: true, provider: "stub", providerMessageId: "prov-2" };
    });

    const first = await performSend({ store: shared.store(), provider: carrier, messageId: QUEUED.id, now: MIDDAY });
    assert.equal(first.outcome, "failed");
    assert.equal(shared.row.status, "QUEUED");
    assert.equal(shared.calls.released, 1);

    const second = await performSend({ store: shared.store(), provider: carrier, messageId: QUEUED.id, now: MIDDAY });
    assert.equal(second.outcome, "sent");
    assert.equal(carrier.sent.length, 2);
  });

  test("a refused message never passes through SENDING", async () => {
    const shared = sharedRow({ ...QUEUED });
    const store = shared.store();
    store.policy = async () => ({ action: "block", reasonCode: "BLOCKED_OPT_OUT", message: "no" });
    const outcome = await performSend({ store, provider: provider(), messageId: QUEUED.id, now: MIDDAY });
    assert.equal(outcome.outcome, "blocked");
    assert.equal(shared.row.status, "BLOCKED");
  });
});

describe("B6: manual send key", () => {
  const base = { leadId: "lead-1", channel: "sms", body: "See you at 3", at: new Date("2026-06-15T12:00:10Z") };

  test("a double-click inside the same minute derives the same key", () => {
    const first = manualSendKeys(base);
    const second = manualSendKeys({ ...base, at: new Date("2026-06-15T12:00:50Z") });
    assert.equal(first.key, second.key);
  });

  test("a double-click straddling the minute boundary still collides", () => {
    const first = manualSendKeys({ ...base, at: new Date("2026-06-15T12:00:59.900Z") });
    const second = manualSendKeys({ ...base, at: new Date("2026-06-15T12:01:00.100Z") });
    assert.notEqual(first.key, second.key);
    assert.ok(second.candidates.includes(first.key));
  });

  test("different text, lead or channel is a different message", () => {
    const key = manualSendKeys(base).key;
    assert.notEqual(manualSendKeys({ ...base, body: "See you at 4" }).key, key);
    assert.notEqual(manualSendKeys({ ...base, leadId: "lead-2" }).key, key);
    assert.notEqual(manualSendKeys({ ...base, channel: "email" }).key, key);
  });

  test("a client nonce makes the key exact and time-independent", () => {
    const a = manualSendKeys({ ...base, nonce: "draft-abc-123" });
    const b = manualSendKeys({ ...base, nonce: "draft-abc-123", at: new Date("2026-06-15T13:00:00Z") });
    assert.equal(a.key, b.key);
    assert.deepEqual(a.candidates, [a.key]);
  });
});

/* ------------------------------------------------------------------ B7 --- */

describe("B7: an approved draft must still be current", () => {
  test("an inbound message after the draft refuses the approval", () => {
    const verdict = draftApprovalVerdict({
      draftCreatedAt: "2026-06-15T12:00:00Z",
      latestInboundAt: "2026-06-15T12:05:00Z",
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.error, STALE_DRAFT_ERROR);
  });

  test("the inbound message the draft answers does not block it", () => {
    assert.equal(
      draftApprovalVerdict({
        draftCreatedAt: "2026-06-15T12:00:05Z",
        latestInboundAt: "2026-06-15T12:00:00Z",
      }).ok,
      true,
    );
  });

  test("no inbound at all is fine; an unreadable time is not", () => {
    assert.equal(draftApprovalVerdict({ draftCreatedAt: "2026-06-15T12:00:00Z", latestInboundAt: null }).ok, true);
    assert.equal(draftApprovalVerdict({ draftCreatedAt: "garbage", latestInboundAt: "2026-06-15T12:00:00Z" }).ok, false);
  });

  test("an approved draft sent as manual is not refused by a takeover, but opt-out still binds", () => {
    const underTakeover = snapshot({
      origin: "manual",
      lead: { ...snapshot().lead, humanTakeover: true, automationActive: false },
    });
    assert.equal(evaluateSend(underTakeover, MIDDAY).action, "send");
    const optedOut = snapshot({ origin: "manual", lead: { ...snapshot().lead, optedOut: true } });
    assert.deepEqual(evaluateSend(optedOut, MIDDAY), { action: "abort", reason: "opted_out" });
  });
});

/* ------------------------------------------------------------------ B8 --- */

describe("B8: test sends reach only the workspace", () => {
  const contacts = {
    businessPhone: "01632 960000",
    members: [
      { phone: "07700 900123", email: "Owner@Studio.co.uk" },
      { phone: null, email: "dev@studio.co.uk" },
    ],
  };

  test("an arbitrary number is refused", () => {
    const to = normaliseTestDestination("sms", "07700 900999")!;
    assert.equal(isPermittedTestRecipient("sms", to, contacts), false);
  });

  test("a member's own number and the business number are allowed", () => {
    assert.equal(isPermittedTestRecipient("sms", normaliseTestDestination("sms", "+447700900123")!, contacts), true);
    assert.equal(isPermittedTestRecipient("whatsapp", normaliseTestDestination("whatsapp", "01632960000")!, contacts), true);
  });

  test("email is matched to a member's login email, case-insensitively", () => {
    assert.equal(isPermittedTestRecipient("email", normaliseTestDestination("email", "owner@studio.co.uk")!, contacts), true);
    assert.equal(isPermittedTestRecipient("email", normaliseTestDestination("email", "someone@else.com")!, contacts), false);
  });

  test("an email destination is no longer parsed as a phone number", () => {
    assert.equal(normaliseTestDestination("email", "dev@studio.co.uk"), "dev@studio.co.uk");
    assert.equal(normaliseTestDestination("email", "not-an-email"), null);
  });
});

/* ------------------------------------------------------------------ B9 --- */

describe("B9: the handover acknowledgement gets through the takeover it announces", () => {
  const handedOver = { ...snapshot().lead, humanTakeover: true, automationActive: false, hasReplied: true };

  test("reproduction: a plain agent message under a takeover is aborted", () => {
    assert.deepEqual(
      evaluateSend(snapshot({ origin: "agent", lead: handedOver }), MIDDAY),
      { action: "abort", reason: "human_takeover" },
    );
  });

  test("agent_handover is sent under the takeover", () => {
    assert.equal(evaluateSend(snapshot({ origin: "agent_handover", lead: handedOver }), MIDDAY).action, "send");
  });

  test("agent_handover still respects opt-out, suppression and quiet hours", () => {
    assert.deepEqual(
      evaluateSend(snapshot({ origin: "agent_handover", lead: { ...handedOver, optedOut: true } }), MIDDAY),
      { action: "abort", reason: "opted_out" },
    );
    assert.deepEqual(
      evaluateSend(
        snapshot({
          origin: "agent_handover",
          lead: handedOver,
          channel: { ...snapshot().channel, contactSuppressed: true },
        }),
        MIDDAY,
      ),
      { action: "abort", reason: "suppressed" },
    );
    const night = evaluateSend(
      snapshot({
        origin: "agent_handover",
        lead: handedOver,
        quietHours: { enabled: true, start: "20:00", end: "08:00", timezone: "Europe/London" },
      }),
      new Date("2026-06-15T22:00:00Z"),
    );
    assert.equal(night.action, "reschedule");
  });
});
