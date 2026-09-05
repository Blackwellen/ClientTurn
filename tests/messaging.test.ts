import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isOptInKeyword,
  isOptOutKeyword,
  normalisePhone,
  channelForAddress,
  stripChannelPrefix,
} from "../src/lib/messaging/types.ts";
import {
  evaluateSend,
  performSend,
  type OutboundMessageRecord,
  type SendGuardSnapshot,
  type SendStore,
} from "../src/lib/jobs/send-core.ts";
import type { MessagingProvider, SendRequest } from "../src/lib/messaging/types.ts";

describe("opt-out detection", () => {
  const stops = [
    "STOP",
    "stop",
    " Stop ",
    "STOP.",
    "stop!",
    "unsubscribe",
    "Cancel",
    "END",
    "quit",
    "optout",
    "opt out",
    "opt-out",
    "remove",
  ];

  for (const body of stops) {
    test(`"${body}" is an opt-out`, () => {
      assert.equal(isOptOutKeyword(body), true);
    });
  }

  const notStops = [
    "please stop by tomorrow",
    "can you cancel my appointment on Thursday",
    "yes",
    "stopped raining",
    "",
    "I want to end the job early",
  ];

  for (const body of notStops) {
    test(`"${body}" is not an opt-out`, () => {
      assert.equal(isOptOutKeyword(body), false);
    });
  }

  test("START re-opts in", () => {
    assert.equal(isOptInKeyword("START"), true);
    assert.equal(isOptInKeyword("stop"), false);
  });
});

describe("UK phone normalisation", () => {
  const cases: [string, string | null][] = [
    ["07700 900123", "+447700900123"],
    ["07700900123", "+447700900123"],
    ["+447700900123", "+447700900123"],
    ["447700900123", "+447700900123"],
    ["0161 000 0000", "+441610000000"],
    ["", null],
  ];

  for (const [input, expected] of cases) {
    test(`${input || "(empty)"} normalises`, () => {
      assert.equal(normalisePhone(input), expected);
    });
  }
});

describe("channel addressing", () => {
  test("a WhatsApp address is recognised and stripped", () => {
    assert.equal(channelForAddress("whatsapp:+447700900123"), "whatsapp");
    assert.equal(stripChannelPrefix("whatsapp:+447700900123"), "+447700900123");
    assert.equal(channelForAddress("+447700900123"), "sms");
  });
});

/* ------------------------------------------------------------------------ */

const BASE_SNAPSHOT: SendGuardSnapshot = {
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
  quietHours: {
    enabled: false,
    start: "20:00",
    end: "08:00",
    timezone: "Europe/London",
  },
  origin: "automation",
};

const MESSAGE: OutboundMessageRecord = {
  id: "msg-2",
  businessId: "biz-1",
  leadId: "lead-1",
  channel: "sms",
  body: "Are you still after a quote?",
  status: "QUEUED",
  sendKey: "run:2:step:2",
  to: "+447700900123",
  origin: "automation",
};

/**
 * The end-to-end shape of the rule the Bible requires: once a STOP arrives,
 * the suppression it writes must stop every later send for that contact.
 */
describe("a STOP suppresses subsequent sends", () => {
  test("the same queued message aborts once the suppression exists", async () => {
    const sent: SendRequest[] = [];
    const provider: MessagingProvider = {
      name: "fake",
      async send(request) {
        sent.push(request);
        return { ok: true, providerMessageId: "pm", provider: "fake" };
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

    // The workspace's live state, as the inbound handler would have left it.
    const suppressions = new Set<string>();
    let optedOut = false;

    const record = { ...MESSAGE };
    const store: SendStore = {
      async load() {
        return { ...record, status: "QUEUED" };
      },
      async snapshot(message) {
        return {
          ...BASE_SNAPSHOT,
          lead: { ...BASE_SNAPSHOT.lead, optedOut },
          channel: {
            ...BASE_SNAPSHOT.channel,
            contactSuppressed: suppressions.has(message.to),
          },
        };
      },
      async markSent() {},
      async markFailed() {},
      async abort() {},
      async reschedule() {},
      async meter() {},
    };

    const before = await performSend({
      store,
      provider,
      messageId: MESSAGE.id,
    });
    assert.equal(before.outcome, "sent");
    assert.equal(sent.length, 1);

    // Inbound "STOP" arrives.
    assert.equal(isOptOutKeyword("STOP"), true);
    suppressions.add(MESSAGE.to);
    optedOut = true;

    const after = await performSend({
      store,
      provider,
      messageId: MESSAGE.id,
    });

    assert.equal(after.outcome, "aborted");
    if (after.outcome !== "aborted") return;
    assert.equal(after.reason, "opted_out");
    assert.equal(sent.length, 1);
  });

  test("suppression alone aborts even when the lead flag lags behind", () => {
    const decision = evaluateSend({
      ...BASE_SNAPSHOT,
      channel: { ...BASE_SNAPSHOT.channel, contactSuppressed: true },
    });
    assert.equal(decision.action, "abort");
    if (decision.action !== "abort") return;
    assert.equal(decision.reason, "suppressed");
  });
});
