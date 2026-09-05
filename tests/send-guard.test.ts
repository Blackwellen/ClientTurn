import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSend,
  performSend,
  shouldRetrySend,
  isPermanentOutcome,
  type OutboundMessageRecord,
  type SendGuardSnapshot,
  type SendOutcome,
  type SendStore,
} from "../src/lib/jobs/send-core.ts";
import { isWithinQuietHours, nextPermittedSendTime } from "../src/lib/automation/scheduler.ts";
import type {
  MessagingProvider,
  SendRequest,
  SendResult,
} from "../src/lib/messaging/types.ts";

const OPEN_HOURS = {
  enabled: true,
  start: "20:00",
  end: "08:00",
  timezone: "Europe/London",
};

const NEW_YORK = {
  enabled: true,
  start: "20:00",
  end: "08:00",
  timezone: "America/New_York",
};

function snapshot(overrides: Partial<SendGuardSnapshot> = {}): SendGuardSnapshot {
  return {
    lead: {
      status: "CONTACTED",
      optedOut: false,
      humanTakeover: false,
      automationActive: true,
      hasReplied: false,
    },
    channel: {
      subscriptionActive: true,
      integrationHealthy: true,
      contactSuppressed: false,
    },
    // Midday London, well clear of the window, unless a test says otherwise.
    quietHours: { ...OPEN_HOURS, enabled: false },
    origin: "automation",
    ...overrides,
  };
}

const MIDDAY = new Date("2026-06-15T12:00:00.000Z");

/* ------------------------------------------------------- quiet hours --- */

describe("quiet hours boundaries", () => {
  test("the opening minute of the window is quiet", () => {
    // 20:00 London on a BST date is 19:00 UTC.
    assert.equal(
      isWithinQuietHours(new Date("2026-06-15T19:00:00.000Z"), OPEN_HOURS),
      true,
    );
  });

  test("one minute before the window is not quiet", () => {
    assert.equal(
      isWithinQuietHours(new Date("2026-06-15T18:59:00.000Z"), OPEN_HOURS),
      false,
    );
  });

  test("the closing minute of the window is already open", () => {
    // 08:00 London BST is 07:00 UTC.
    assert.equal(
      isWithinQuietHours(new Date("2026-06-16T07:00:00.000Z"), OPEN_HOURS),
      false,
    );
    assert.equal(
      isWithinQuietHours(new Date("2026-06-16T06:59:00.000Z"), OPEN_HOURS),
      true,
    );
  });

  test("a non-UTC timezone is evaluated in its own local time", () => {
    // 10:00 UTC is 05:00 in New York: still quiet there, already open in
    // London. The same instant must give different answers.
    const instant = new Date("2026-01-15T10:00:00.000Z");
    assert.equal(isWithinQuietHours(instant, NEW_YORK), true);
    assert.equal(isWithinQuietHours(instant, OPEN_HOURS), false);
  });

  test("a non-UTC daytime instant is outside the window", () => {
    // 14:00 UTC is 09:00 in New York.
    assert.equal(
      isWithinQuietHours(new Date("2026-01-15T14:00:00.000Z"), NEW_YORK),
      false,
    );
  });

  test("a quiet-hours send is rolled forward, never dropped", () => {
    const at = new Date("2026-01-15T02:00:00.000Z");
    const next = nextPermittedSendTime(at, NEW_YORK);
    assert.ok(next.getTime() > at.getTime());
    assert.equal(isWithinQuietHours(next, NEW_YORK), false);
  });

  test("disabled quiet hours never reschedule", () => {
    const decision = evaluateSend(snapshot(), MIDDAY);
    assert.equal(decision.action, "send");
  });

  test("the guard reschedules rather than sending inside the window", () => {
    const decision = evaluateSend(
      snapshot({ quietHours: NEW_YORK }),
      new Date("2026-01-15T02:00:00.000Z"),
    );
    assert.equal(decision.action, "reschedule");
    if (decision.action !== "reschedule") return;
    assert.equal(isWithinQuietHours(decision.at, NEW_YORK), false);
  });
});

/* ------------------------------------------------------------- guard --- */

describe("message.send guard, one abort condition at a time", () => {
  const cases: [string, SendGuardSnapshot, string][] = [
    [
      "opted out",
      snapshot({ lead: { ...snapshot().lead, optedOut: true } }),
      "opted_out",
    ],
    [
      "suppressed contact",
      snapshot({
        channel: { ...snapshot().channel, contactSuppressed: true },
      }),
      "suppressed",
    ],
    [
      "already booked",
      snapshot({ lead: { ...snapshot().lead, status: "BOOKED" } }),
      "booked",
    ],
    [
      "won",
      snapshot({ lead: { ...snapshot().lead, status: "WON" } }),
      "won",
    ],
    [
      "lost",
      snapshot({ lead: { ...snapshot().lead, status: "LOST" } }),
      "lost",
    ],
    [
      "human takeover",
      snapshot({ lead: { ...snapshot().lead, humanTakeover: true } }),
      "human_takeover",
    ],
    [
      "automation paused",
      snapshot({ lead: { ...snapshot().lead, automationActive: false } }),
      "paused",
    ],
    [
      "subscription inactive",
      snapshot({
        channel: { ...snapshot().channel, subscriptionActive: false },
      }),
      "subscription_inactive",
    ],
    [
      "integration unavailable",
      snapshot({
        channel: { ...snapshot().channel, integrationHealthy: false },
      }),
      "integration_unavailable",
    ],
    [
      "lead has replied",
      snapshot({ lead: { ...snapshot().lead, hasReplied: true } }),
      "replied",
    ],
  ];

  for (const [name, input, reason] of cases) {
    test(`aborts on ${name}`, () => {
      const decision = evaluateSend(input, MIDDAY);
      assert.equal(decision.action, "abort");
      if (decision.action !== "abort") return;
      assert.equal(decision.reason, reason);
    });
  }

  test("a reply does not block the conversation's own answer", () => {
    const decision = evaluateSend(
      snapshot({
        origin: "system",
        lead: { ...snapshot().lead, hasReplied: true },
      }),
      MIDDAY,
    );
    assert.equal(decision.action, "send");
  });

  test("a person can still send by hand during takeover", () => {
    const decision = evaluateSend(
      snapshot({
        origin: "manual",
        lead: {
          ...snapshot().lead,
          humanTakeover: true,
          automationActive: false,
        },
      }),
      MIDDAY,
    );
    assert.equal(decision.action, "send");
  });

  test("opt-out binds a manual send too", () => {
    const decision = evaluateSend(
      snapshot({
        origin: "manual",
        lead: { ...snapshot().lead, optedOut: true },
      }),
      MIDDAY,
    );
    assert.equal(decision.action, "abort");
  });
});

/* ------------------------------------------------------ send harness --- */

type Recorded = { requests: SendRequest[] };

function fakeProvider(
  result: SendResult = { ok: true, providerMessageId: "pm-1", provider: "stub" },
): MessagingProvider & Recorded {
  const requests: SendRequest[] = [];
  return {
    name: "fake",
    requests,
    async send(request) {
      requests.push(request);
      return result;
    },
    async verifyWebhook() {
      return true;
    },
    async parseInbound() {
      return [];
    },
    async parseStatus() {
      return [];
    },
  };
}

type Calls = {
  markedSent: number;
  markedFailed: { terminal: boolean }[];
  aborted: string[];
  rescheduled: Date[];
  metered: number;
};

function fakeStore(
  message: OutboundMessageRecord,
  guard: SendGuardSnapshot = snapshot(),
): SendStore & { calls: Calls; record: OutboundMessageRecord } {
  const record = { ...message };
  const calls: Calls = {
    markedSent: 0,
    markedFailed: [],
    aborted: [],
    rescheduled: [],
    metered: 0,
  };

  return {
    calls,
    record,
    async load() {
      return { ...record };
    },
    async snapshot() {
      return guard;
    },
    async markSent() {
      // Mirrors the real store: the row leaves QUEUED before the call returns.
      record.status = "SENT";
      calls.markedSent += 1;
    },
    async markFailed(_message, _result, terminal) {
      calls.markedFailed.push({ terminal });
      if (terminal) record.status = "FAILED";
    },
    async abort(_message, reason) {
      record.status = "FAILED";
      calls.aborted.push(reason);
    },
    async reschedule(_message, at) {
      calls.rescheduled.push(at);
    },
    async meter() {
      calls.metered += 1;
    },
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

describe("send-key idempotency", () => {
  test("running the same job twice sends exactly once", async () => {
    const provider = fakeProvider();
    const store = fakeStore(QUEUED);

    const first = await performSend({
      store,
      provider,
      messageId: QUEUED.id,
      now: MIDDAY,
    });
    const second = await performSend({
      store,
      provider,
      messageId: QUEUED.id,
      now: MIDDAY,
    });

    assert.equal(first.outcome, "sent");
    assert.equal(second.outcome, "already_processed");
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0].sendKey, "run:1:step:1");
    assert.equal(store.calls.markedSent, 1);
    assert.equal(store.calls.metered, 1);
  });

  test("a missing message is reported rather than sent", async () => {
    const provider = fakeProvider();
    const store = fakeStore(QUEUED);
    store.load = async () => null;

    const outcome = await performSend({
      store,
      provider,
      messageId: QUEUED.id,
      now: MIDDAY,
    });

    assert.equal(outcome.outcome, "missing");
    assert.equal(provider.requests.length, 0);
  });
});

describe("guarded dispatch", () => {
  test("an opted-out lead never reaches the provider", async () => {
    const provider = fakeProvider();
    const store = fakeStore(
      QUEUED,
      snapshot({ lead: { ...snapshot().lead, optedOut: true } }),
    );

    const outcome = await performSend({
      store,
      provider,
      messageId: QUEUED.id,
      now: MIDDAY,
    });

    assert.equal(outcome.outcome, "aborted");
    assert.deepEqual(store.calls.aborted, ["opted_out"]);
    assert.equal(provider.requests.length, 0);
  });

  test("a suppression recorded after queueing stops the send", async () => {
    const provider = fakeProvider();
    const store = fakeStore(
      QUEUED,
      snapshot({ channel: { ...snapshot().channel, contactSuppressed: true } }),
    );

    const outcome = await performSend({
      store,
      provider,
      messageId: QUEUED.id,
      now: MIDDAY,
    });

    assert.equal(outcome.outcome, "aborted");
    assert.equal(provider.requests.length, 0);
  });

  test("a quiet-hours send is rescheduled, not delivered", async () => {
    const provider = fakeProvider();
    const store = fakeStore(QUEUED, snapshot({ quietHours: NEW_YORK }));

    const outcome = await performSend({
      store,
      provider,
      messageId: QUEUED.id,
      now: new Date("2026-01-15T02:00:00.000Z"),
    });

    assert.equal(outcome.outcome, "rescheduled");
    assert.equal(store.calls.rescheduled.length, 1);
    assert.equal(provider.requests.length, 0);
  });
});

describe("retry classification", () => {
  const permanent: SendResult = {
    ok: false,
    errorCode: "21211",
    errorMessage: "Invalid To number",
    permanent: true,
  };

  const transient: SendResult = {
    ok: false,
    errorCode: "429",
    errorMessage: "Too many requests",
    permanent: false,
  };

  test("a permanent provider rejection is terminal and not retried", async () => {
    const provider = fakeProvider(permanent);
    const store = fakeStore(QUEUED);

    const outcome = await performSend({
      store,
      provider,
      messageId: QUEUED.id,
      now: MIDDAY,
    });

    assert.equal(outcome.outcome, "failed");
    assert.equal(shouldRetrySend(outcome), false);
    assert.equal(isPermanentOutcome(outcome), true);
    assert.deepEqual(store.calls.markedFailed, [{ terminal: true }]);
    assert.equal(store.record.status, "FAILED");
  });

  test("a transient failure stays retryable and leaves the row QUEUED", async () => {
    const provider = fakeProvider(transient);
    const store = fakeStore(QUEUED);

    const outcome = await performSend({
      store,
      provider,
      messageId: QUEUED.id,
      now: MIDDAY,
    });

    assert.equal(outcome.outcome, "failed");
    assert.equal(shouldRetrySend(outcome), true);
    assert.equal(isPermanentOutcome(outcome), false);
    assert.deepEqual(store.calls.markedFailed, [{ terminal: false }]);
    assert.equal(store.record.status, "QUEUED");
  });

  test("the last permitted attempt settles a transient failure", async () => {
    const provider = fakeProvider(transient);
    const store = fakeStore(QUEUED);

    await performSend({
      store,
      provider,
      messageId: QUEUED.id,
      now: MIDDAY,
      finalAttempt: true,
    });

    assert.deepEqual(store.calls.markedFailed, [{ terminal: true }]);
    assert.equal(store.record.status, "FAILED");
  });

  test("a missing message is permanent", () => {
    const outcome: SendOutcome = { outcome: "missing" };
    assert.equal(isPermanentOutcome(outcome), true);
    assert.equal(shouldRetrySend(outcome), false);
  });

  test("an abort is neither retried nor treated as a permanent error", () => {
    const outcome: SendOutcome = { outcome: "aborted", reason: "opted_out" };
    assert.equal(shouldRetrySend(outcome), false);
    assert.equal(isPermanentOutcome(outcome), false);
  });
});
