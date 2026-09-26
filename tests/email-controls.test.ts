/**
 * Email controls (brief §43): transactional vs marketing, the complaint-rate
 * monitor, the mailbox ceiling on per-sender caps, and warm email using the
 * sender identity for From. The rules are pure (src/lib/email/sender-health.ts,
 * from-address.ts); the send path is exercised through `performSend`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  COMPLAINT_PAUSE_RATE,
  COMPLAINT_WATCH_RATE,
  complaintsBySender,
  complaintVerdict,
  effectiveDailyCap,
  emailMessageClass,
  mailboxDailyCeiling,
  nextCapWindow,
  requiresUnsubscribe,
} from "../src/lib/email/sender-health.ts";
import { resolveFromAddress } from "../src/lib/email/from-address.ts";
import {
  performSend,
  SENDING_STATUS,
  type OutboundMessageRecord,
  type SendStore,
} from "../src/lib/jobs/send-core.ts";
import type { MessagingProvider, SendRequest } from "../src/lib/messaging/types.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) =>
  readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

describe("message class", () => {
  test("campaigns and follow-up sequences are marketing", () => {
    assert.equal(emailMessageClass({ origin: "campaign" }), "MARKETING");
    assert.equal(emailMessageClass({ origin: "automation" }), "MARKETING");
  });

  test("booking reminders are transactional, though they are automations", () => {
    assert.equal(emailMessageClass({ origin: "automation", bookingReminder: true }), "TRANSACTIONAL");
  });

  test("system notices and one-to-one conversation are transactional", () => {
    for (const origin of ["system", "manual", "agent", "agent_handover"] as const) {
      assert.equal(emailMessageClass({ origin }), "TRANSACTIONAL", origin);
    }
  });

  test("only marketing carries the unsubscribe requirement", () => {
    assert.equal(requiresUnsubscribe("MARKETING"), true);
    assert.equal(requiresUnsubscribe("TRANSACTIONAL"), false);
  });
});

describe("complaint verdict", () => {
  test("thresholds are Gmail's: watch at 0.1%, pause at 0.3%", () => {
    assert.equal(COMPLAINT_WATCH_RATE, 0.001);
    assert.equal(COMPLAINT_PAUSE_RATE, 0.003);
  });

  test("no complaints is healthy", () => {
    assert.equal(complaintVerdict({ sent: 5000, complaints: 0 }).state, "HEALTHY");
    assert.equal(complaintVerdict({ sent: 0, complaints: 0 }).state, "HEALTHY");
  });

  test("below 0.1% stays healthy", () => {
    assert.equal(complaintVerdict({ sent: 2000, complaints: 1 }).state, "HEALTHY");
  });

  test("0.1% to 0.3% is WATCH, with a reason", () => {
    const verdict = complaintVerdict({ sent: 1000, complaints: 2 });
    assert.equal(verdict.state, "WATCH");
    assert.match(verdict.reason ?? "", /0\.20%/);
  });

  test("0.3% and above is PAUSED", () => {
    const verdict = complaintVerdict({ sent: 1000, complaints: 3 });
    assert.equal(verdict.state, "PAUSED");
    assert.equal(verdict.rate, 0.003);
  });

  test("a single complaint never pauses on its own, however small the volume", () => {
    assert.equal(complaintVerdict({ sent: 50, complaints: 1 }).state, "WATCH");
    assert.equal(complaintVerdict({ sent: 50, complaints: 2 }).state, "PAUSED");
  });

  test("complaints with nothing sent in the window cannot read as 0%", () => {
    assert.equal(complaintVerdict({ sent: 0, complaints: 2 }).state, "PAUSED");
  });
});

describe("attributing complaints to senders", () => {
  const sent = [
    { senderId: "s1", recipient: "a@x.co.uk", sentAt: "2026-09-20T09:00:00Z", complained: false },
    { senderId: "s2", recipient: "A@x.co.uk", sentAt: "2026-09-21T09:00:00Z", complained: false },
    { senderId: "s1", recipient: "b@x.co.uk", sentAt: "2026-09-22T09:00:00Z", complained: true },
    { senderId: "s1", recipient: "c@x.co.uk", sentAt: "2026-09-23T09:00:00Z", complained: false },
  ];

  test("counts every send per sender", () => {
    const result = complaintsBySender(sent, []);
    assert.equal(result.get("s1")?.sent, 3);
    assert.equal(result.get("s2")?.sent, 1);
  });

  test("a complaint goes to the sender who last emailed that address before it", () => {
    const result = complaintsBySender(sent, [{ email: "a@X.co.uk", createdAt: "2026-09-22T00:00:00Z" }]);
    assert.equal(result.get("s2")?.complaints, 1);
    assert.equal(result.get("s1")?.complaints, 1, "b@ is flagged on the message itself");
  });

  test("an address is counted once, whether it arrives as a row or a flag or both", () => {
    const result = complaintsBySender(sent, [
      { email: "b@x.co.uk", createdAt: "2026-09-23T00:00:00Z" },
      { email: "b@x.co.uk", createdAt: "2026-09-24T00:00:00Z" },
    ]);
    assert.equal(result.get("s1")?.complaints, 1);
  });

  test("a complaint about an address we never emailed is attributed to nobody", () => {
    const result = complaintsBySender(sent, [{ email: "z@x.co.uk", createdAt: "2026-09-24T00:00:00Z" }]);
    assert.equal(result.get("s1")?.complaints, 1);
    assert.equal(result.get("s2")?.complaints, 0);
  });
});

describe("caps", () => {
  test("the mailbox provider's safe daily limit is the ceiling", () => {
    assert.equal(mailboxDailyCeiling("smtp.gmail.com"), 450);
    assert.equal(mailboxDailyCeiling("SMTP.OFFICE365.COM"), 9000);
    assert.equal(mailboxDailyCeiling("mail.example.co.uk"), 1000);
    assert.equal(mailboxDailyCeiling(null), null);
  });

  test("the effective cap is the lower of the ramped allowance and the ceiling", () => {
    assert.equal(effectiveDailyCap(2000, 450), 450);
    assert.equal(effectiveDailyCap(200, 450), 200);
    assert.equal(effectiveDailyCap(200, null), 200);
  });

  test("a capped marketing email waits for the next UTC day", () => {
    assert.equal(nextCapWindow(new Date("2026-09-26T17:30:00Z")).toISOString(), "2026-09-27T00:05:00.000Z");
  });
});

describe("From on warm mail", () => {
  const mailbox = { fromName: "Studio", fromEmail: "hello@studio.co.uk", replyTo: null };

  test("an identity on the mailbox's domain is used as From", () => {
    const from = resolveFromAddress(mailbox, { displayName: "Priya at Studio", email: "priya@studio.co.uk" });
    assert.equal(from.email, "priya@studio.co.uk");
    assert.equal(from.name, "Priya at Studio");
  });

  test("an identity on another domain keeps the mailbox address (DMARC alignment)", () => {
    const from = resolveFromAddress(mailbox, { displayName: "Priya", email: "priya@other.com" });
    assert.equal(from.email, "hello@studio.co.uk");
    assert.equal(from.name, "Priya");
  });
});

/* ----------------------------------------------------- the send path --- */

function store(message: OutboundMessageRecord): SendStore {
  const record = { ...message };
  return {
    async load() {
      return { ...record };
    },
    async claim() {
      if (record.status !== "QUEUED") return false;
      record.status = SENDING_STATUS;
      return true;
    },
    async reconcileInFlight() {},
    async snapshot() {
      return {
        lead: { status: "CONTACTED", optedOut: false, humanTakeover: false, automationActive: true, hasReplied: false },
        channel: { subscriptionActive: true, integrationHealthy: true, contactSuppressed: false },
        quietHours: { enabled: false, start: "20:00", end: "08:00", timezone: "Europe/London" },
        origin: record.origin,
      };
    },
    async policy() {
      return { action: "allow" };
    },
    async blockedByPolicy() {},
    async markSent() {
      record.status = "SENT";
    },
    async markFailed() {},
    async abort() {},
    async reschedule() {},
    async meter() {},
  };
}

function provider() {
  const requests: SendRequest[] = [];
  const p: MessagingProvider = {
    name: "fake",
    async send(request) {
      requests.push(request);
      return { ok: true, providerMessageId: "id", provider: "fake" };
    },
    async verifyWebhook() {
      return false;
    },
    async parseInbound() {
      return [];
    },
    async parseStatus() {
      return [];
    },
  };
  return { p, requests };
}

describe("performSend carries class and identity to the carrier", () => {
  test("a warm follow-up email goes out under its sender identity, as marketing", async () => {
    const message: OutboundMessageRecord = {
      id: "m1",
      businessId: "b1",
      leadId: "l1",
      channel: "email",
      body: "<p>Hi</p>",
      status: "QUEUED",
      sendKey: "run:1:step:1",
      to: "lead@client.co.uk",
      origin: "automation",
      subject: "Following up",
      unsubscribeUrl: "https://app.clientturn.com/unsubscribe/t",
      messageClass: "MARKETING",
      senderIdentity: { id: "s1", displayName: "Priya", email: "priya@studio.co.uk" },
    };
    const { p, requests } = provider();
    await performSend({ store: store(message), provider: p, messageId: "m1" });
    assert.equal(requests[0].messageClass, "MARKETING");
    assert.equal(requests[0].senderIdentity?.email, "priya@studio.co.uk");
    assert.equal(requests[0].unsubscribeUrl, "https://app.clientturn.com/unsubscribe/t");
  });
});

describe("structure", () => {
  const sendStore = read("src/lib/jobs/handlers/send-store.ts");
  const sql = read("supabase/migrations/0127_crm_pull_templates_email_meetings.sql");

  test("the unsubscribe link follows the message class, not the origin", () => {
    assert.match(sendStore, /requiresUnsubscribe\(messageClass\)/);
    assert.doesNotMatch(sendStore, /\(row\.origin === "campaign" \|\| row\.origin === "automation"\)/);
  });

  test("a booking reminder is judged by policy as transactional", () => {
    assert.match(sendStore, /isBookingReminderSendKey\(message\.sendKey\)\s*\?\s*"TRANSACTIONAL"/);
  });

  test("marketing email claims a capped sender slot and defers on the cap", () => {
    assert.match(sendStore, /claimSenderSlot\(message\.businessId, identity\.id\)/);
    assert.match(sendStore, /reasonCode: "BLOCKED_DAILY_LIMIT"/);
  });

  test("a PAUSED sender reaches the policy engine as PAUSED on marketing mail", () => {
    assert.match(sendStore, /identities\.get\(message\.id\)\?\.healthState/);
  });

  test("the email provider passes the identity and drops unsubscribe on transactional mail", () => {
    const provider = read("src/lib/messaging/email-provider.ts");
    assert.match(provider, /senderIdentity: request\.senderIdentity \?\? null/);
    assert.match(provider, /request\.messageClass === "TRANSACTIONAL" \? null : request\.unsubscribeUrl/);
  });

  test("the capped claim refuses PAUSED, applies the ceiling and starts warm-up on first use only", () => {
    assert.match(sql, /create or replace function public\.claim_sender_send_slot_capped/);
    assert.match(sql, /s\.health_state <> 'PAUSED'/);
    assert.match(sql, /coalesce\(nullif\(p_ceiling, 0\), public\.sender_daily_allowance\(s\)\)/);
    assert.match(sql, /when s\.warmup_started_at is null and s\.sent_today_on is null then now\(\)/);
  });

  test("cold dispatch uses the capped claim too", () => {
    const dispatch = read("src/lib/outreach/dispatch.ts");
    assert.match(dispatch, /claimSenderSlot\(input\.businessId, sender\.id\)/);
    assert.doesNotMatch(dispatch, /rpc\("claim_sender_send_slot"/);
  });

  test("the monitor runs daily and complaints are read through the policy module", () => {
    assert.match(read("src/app/api/cron/daily/route.ts"), /enqueue\("email\.sender_health"/);
    const handler = read("src/lib/jobs/handlers/sender-health.ts");
    assert.match(handler, /recentComplaints\(/);
    assert.doesNotMatch(handler, /from\("suppression_entries"\)/);
  });
});
