import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { countSmsSegments, normaliseForSms, smsEncoding } from "../src/lib/messaging/sms-segments.ts";
import { evaluateLength } from "../src/lib/agent/policy.ts";
import { metaWindowDecision } from "../src/lib/messaging/meta-window.ts";
import { dkimState, dmarcState, domainOf, spfState } from "../src/lib/email/dns-health.ts";
import { resolveFromAddress } from "../src/lib/email/from-address.ts";
import { computeInMailBalance, earnsRefund } from "../src/lib/outreach/inmail-credits.ts";
import { bestChannel, rankChannels, type ChannelDecision } from "../src/lib/messaging/channel-router.ts";
import {
  evaluateStopConditions,
  isBookingReminderSendKey,
  BOOKING_REMINDER_SEND_KEY_PREFIX,
} from "../src/lib/automation/scheduler.ts";
import { evaluateSend, type SendGuardSnapshot } from "../src/lib/jobs/send-core.ts";

describe("SMS segments", () => {
  test("GSM-7: 160 in one, 153 per part after", () => {
    assert.deepEqual(countSmsSegments("a".repeat(160)).segments, 1);
    assert.deepEqual(countSmsSegments("a".repeat(161)).segments, 2);
    assert.deepEqual(countSmsSegments("a".repeat(306)).segments, 2);
    assert.deepEqual(countSmsSegments("a".repeat(307)).segments, 3);
  });

  test("extension characters cost two septets", () => {
    assert.equal(countSmsSegments("€".repeat(80)).units, 160);
    assert.equal(countSmsSegments("€".repeat(81)).segments, 2);
  });

  test("one emoji switches the whole message to UCS-2 (70 / 67)", () => {
    assert.equal(smsEncoding("Hello 👋"), "UCS2");
    assert.equal(countSmsSegments("a".repeat(70)).segments, 1);
    assert.equal(countSmsSegments("a".repeat(69) + "é").encoding, "GSM7");
    assert.equal(countSmsSegments("a".repeat(69) + "ł").segments, 1);
    assert.equal(countSmsSegments("a".repeat(70) + "ł").segments, 2);
    assert.equal(countSmsSegments("👋".repeat(34)).units, 68); // surrogate pairs
  });

  test("smart punctuation is normalised back to GSM-7", () => {
    assert.equal(smsEncoding("It’s “fine” – really…"), "UCS2");
    assert.equal(smsEncoding(normaliseForSms("It’s “fine” – really…")), "GSM7");
  });

  test("the SMS length lint is by segment", () => {
    assert.equal(evaluateLength("a".repeat(150), "sms").verdict, "OK");
    // 300 characters with an emoji is five UCS-2 segments: rejected though
    // well under the 480-character limit.
    assert.equal(evaluateLength(`${"a".repeat(298)}👋`, "sms").verdict, "REJECT");
    // 480 GSM-7 characters (four segments) is the hard limit and passes.
    assert.notEqual(evaluateLength("a".repeat(480), "sms").verdict, "REJECT");
  });
});

describe("Messenger / Instagram window for manual and automation sends", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

  test("inside 24h any origin may send", () => {
    assert.equal(metaWindowDecision({ origin: "automation", lastInboundAt: hoursAgo(2), now }).allowed, true);
    assert.equal(metaWindowDecision({ origin: "manual", lastInboundAt: hoursAgo(23), now }).allowed, true);
  });

  test("past 24h automation is refused; a person is told to use the Human Agent tag", () => {
    const automation = metaWindowDecision({ origin: "automation", lastInboundAt: hoursAgo(30), now });
    assert.equal(automation.allowed, false);
    assert.ok(!automation.allowed && automation.reason === "WINDOW_CLOSED");
    const manual = metaWindowDecision({ origin: "manual", lastInboundAt: hoursAgo(30), now });
    assert.ok(!manual.allowed && manual.reason === "HUMAN_AGENT_ONLY");
  });

  test("past 7 days nobody may reply; no inbound at all is closed", () => {
    const manual = metaWindowDecision({ origin: "manual", lastInboundAt: hoursAgo(24 * 8), now });
    assert.ok(!manual.allowed && manual.reason === "WINDOW_CLOSED");
    assert.equal(metaWindowDecision({ origin: "manual", lastInboundAt: null, now }).allowed, false);
  });
});

describe("DNS health", () => {
  const found = (...records: string[]) => ({ ok: true as const, records: records.map((r) => [r]) });
  const missing = { ok: false as const, notFound: true };
  const timeout = { ok: false as const, notFound: false };

  test("SPF", () => {
    assert.equal(spfState(found("v=spf1 include:_spf.google.com ~all")), "PASS");
    assert.equal(spfState(found("google-site-verification=x")), "MISSING");
    assert.equal(spfState(found("v=spf1 -all", "v=spf1 ~all")), "FAIL");
    assert.equal(spfState(found("v=spf1 +all")), "FAIL");
    assert.equal(spfState(missing), "MISSING");
    assert.equal(spfState(timeout), "UNKNOWN");
  });

  test("DMARC with its policy", () => {
    assert.deepEqual(dmarcState(found("v=DMARC1; p=quarantine; rua=mailto:x@y.com")), { state: "PASS", policy: "quarantine" });
    assert.deepEqual(dmarcState(found("v=DMARC1; rua=mailto:x@y.com")), { state: "FAIL", policy: null });
    assert.deepEqual(dmarcState(missing), { state: "MISSING", policy: null });
  });

  test("DKIM only with a selector; a revoked key fails", () => {
    assert.equal(dkimState(null, null), "UNKNOWN");
    assert.equal(dkimState("s1", found("v=DKIM1; k=rsa; p=MIGfMA0GCSq")), "PASS");
    assert.equal(dkimState("s1", found("v=DKIM1; p=")), "FAIL");
    assert.equal(dkimState("s1", missing), "MISSING");
  });

  test("domainOf", () => {
    assert.equal(domainOf("Sam@Acme.co.uk"), "acme.co.uk");
    assert.equal(domainOf("nobody"), null);
  });
});

describe("sender identity controls From", () => {
  const mailbox = { fromName: "Acme", fromEmail: "hello@acme.co.uk", replyTo: null };

  test("an identity on the mailbox's domain sets name and address", () => {
    const from = resolveFromAddress(mailbox, { displayName: "Sam at Acme", email: "sam@acme.co.uk" });
    assert.deepEqual(from, { name: "Sam at Acme", email: "sam@acme.co.uk", replyTo: null, identityAddress: true });
  });

  test("an identity on another domain keeps the mailbox address (no forged From)", () => {
    const from = resolveFromAddress(mailbox, { displayName: "Sam", email: "sam@other.com" });
    assert.equal(from.email, "hello@acme.co.uk");
    assert.equal(from.name, "Sam");
  });

  test("no identity: the mailbox's own From", () => {
    assert.equal(resolveFromAddress(mailbox, null).email, "hello@acme.co.uk");
  });
});

describe("InMail credits (50/month, rollover to 150, refund on reply within 90 days)", () => {
  test("grants accumulate to the 150 cap", () => {
    const balance = computeInMailBalance({ sends: [], trackingSince: "2026-01-15T00:00:00Z", now: new Date("2026-09-26T00:00:00Z") });
    assert.equal(balance.balance, 150);
    const first = computeInMailBalance({ sends: [], trackingSince: "2026-09-01T00:00:00Z", now: new Date("2026-09-26T00:00:00Z") });
    assert.equal(first.balance, 50);
  });

  test("a send costs one; a reply within 90 days returns it", () => {
    const now = new Date("2026-09-26T00:00:00Z");
    const sends = [
      { sentAt: "2026-09-02T10:00:00Z", repliedAt: "2026-09-05T10:00:00Z" },
      { sentAt: "2026-09-03T10:00:00Z", repliedAt: null },
    ];
    const balance = computeInMailBalance({ sends, trackingSince: "2026-09-01T00:00:00Z", now });
    assert.equal(balance.balance, 49);
    assert.equal(balance.sentThisMonth, 2);
    assert.equal(balance.refundedThisMonth, 1);
    assert.equal(balance.awaitingReply, 1);
  });

  test("a reply after 90 days returns nothing", () => {
    assert.equal(earnsRefund({ sentAt: "2026-01-01T00:00:00Z", repliedAt: "2026-04-15T00:00:00Z" }), false);
    assert.equal(earnsRefund({ sentAt: "2026-01-01T00:00:00Z", repliedAt: "2026-03-01T00:00:00Z" }), true);
  });
});

describe("channel router", () => {
  const decisions: ChannelDecision[] = [
    { channel: "email", allowed: true },
    { channel: "sms", allowed: true },
    { channel: "whatsapp", allowed: false, reason: "no opt-in" },
  ];

  test("a prohibited channel can never win, whatever the signals", () => {
    const winner = bestChannel(decisions, {
      statedPreference: "whatsapp",
      lastReplyChannel: "whatsapp",
      sourceChannel: "whatsapp",
      urgent: true,
      unitCostMinor: { whatsapp: 0, email: 5, sms: 4 },
    });
    assert.notEqual(winner, "whatsapp");
    assert.ok(!rankChannels(decisions, { statedPreference: "whatsapp" }).some((r) => r.channel === "whatsapp"));
  });

  test("nothing allowed means no channel", () => {
    assert.equal(bestChannel([{ channel: "sms", allowed: false }]), null);
  });

  test("preference beats last reply beats source; ties keep the given order", () => {
    assert.equal(bestChannel(decisions), "email");
    assert.equal(bestChannel(decisions, { sourceChannel: "sms" }), "sms");
    assert.equal(bestChannel(decisions, { sourceChannel: "sms", lastReplyChannel: "email" }), "email");
    assert.equal(bestChannel(decisions, { lastReplyChannel: "email", statedPreference: "sms" }), "sms");
  });

  test("a failing channel is dropped, a degraded one demoted; urgency favours SMS", () => {
    assert.equal(bestChannel(decisions, { health: { email: "FAILING" } }), "sms");
    assert.equal(bestChannel(decisions, { health: { email: "DEGRADED" } }), "sms");
    assert.equal(bestChannel(decisions, { urgent: true }), "sms");
  });

  test("cost only breaks ties", () => {
    assert.equal(bestChannel(decisions, { unitCostMinor: { email: 0, sms: 4 } }), "email");
    assert.equal(bestChannel([{ channel: "sms", allowed: true }, { channel: "email", allowed: true }], { unitCostMinor: { email: 0, sms: 4 } }), "email");
  });
});

describe("booking reminders survive BOOKED", () => {
  const booked = { status: "BOOKED", optedOut: false, humanTakeover: false, automationActive: true, hasReplied: true };
  const channel = { subscriptionActive: true, integrationHealthy: true, contactSuppressed: false };

  test("an ordinary step stops at BOOKED; a booking reminder does not", () => {
    assert.equal(evaluateStopConditions({ ...booked, hasReplied: false }, channel), "booked");
    assert.equal(evaluateStopConditions(booked, channel, { bookingReminder: true }), null);
  });

  test("the reminder is still bound by opt-out and WON/LOST", () => {
    assert.equal(evaluateStopConditions({ ...booked, optedOut: true }, channel, { bookingReminder: true }), "opted_out");
    assert.equal(evaluateStopConditions({ ...booked, status: "WON" }, channel, { bookingReminder: true }), "won");
  });

  test("the send guard honours the reminder flag for automation origin only", () => {
    const snapshot: SendGuardSnapshot = {
      lead: { ...booked, hasReplied: false },
      channel,
      quietHours: { enabled: false, start: "21:00", end: "08:00", timezone: "Europe/London" },
      origin: "automation",
      bookingReminder: true,
    };
    assert.deepEqual(evaluateSend(snapshot), { action: "send" });
    assert.deepEqual(evaluateSend({ ...snapshot, bookingReminder: false }), { action: "abort", reason: "booked" });
    assert.ok(isBookingReminderSendKey(`${BOOKING_REMINDER_SEND_KEY_PREFIX}run:1:step:1`));
    assert.ok(!isBookingReminderSendKey("run:1:step:1"));
  });
});
