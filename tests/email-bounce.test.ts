import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifySmtpFailure,
  enhancedStatus,
  isMachineAddress,
  parseBounce,
  sendOutcomeActions,
} from "../src/lib/email/bounce.ts";
import { describeMailError } from "../src/lib/email/account.ts";

/** nodemailer's shape for a refusal at RCPT TO. */
function rcptError(response: string, responseCode = 550) {
  return Object.assign(new Error(`Can't send mail - all recipients were rejected: ${response}`), {
    code: "EENVELOPE",
    command: "RCPT TO",
    response,
    responseCode,
    rejected: ["typo@example.com"],
  });
}

describe("send-time classification: recipient vs mailbox", () => {
  test("5.1.1 user unknown at RCPT is about the recipient", () => {
    assert.equal(classifySmtpFailure(rcptError("550 5.1.1 <typo@example.com>: User unknown")), "recipient");
  });

  test("a disabled mailbox (5.2.1) is about the recipient", () => {
    assert.equal(classifySmtpFailure(rcptError("550 5.2.1 The email account that you tried to reach is disabled")), "recipient");
  });

  test("5.7.x policy blocks are about the mailbox, never the address", () => {
    assert.equal(classifySmtpFailure(rcptError("550 5.7.1 Relaying denied")), "mailbox");
    assert.equal(classifySmtpFailure(rcptError("550 5.7.26 Unauthenticated email is not accepted (DMARC)")), "mailbox");
  });

  test("authentication failures are about the mailbox", () => {
    assert.equal(
      classifySmtpFailure(Object.assign(new Error("Invalid login: 535 5.7.8 Authentication failed"), { code: "EAUTH", responseCode: 535 })),
      "mailbox",
    );
  });

  test("4.x.x and timeouts are transient", () => {
    assert.equal(classifySmtpFailure(rcptError("451 4.7.1 Greylisted, try again later", 451)), "transient");
    assert.equal(classifySmtpFailure(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" })), "transient");
  });

  test("a bare 550 outside RCPT does not suppress anyone", () => {
    assert.equal(
      classifySmtpFailure(Object.assign(new Error("Message failed: 550 Rejected"), { code: "EMESSAGE", responseCode: 550, command: "DATA" })),
      "mailbox",
    );
  });

  test("enhancedStatus reads RFC 3463 codes", () => {
    assert.equal(enhancedStatus("550 5.1.1 nope"), "5.1.1");
    assert.equal(enhancedStatus("no code here"), null);
  });
});

describe("describeMailError carries the scope", () => {
  test("user unknown is recipient_rejected and permanent", () => {
    const d = describeMailError(rcptError("550 5.1.1 <typo@example.com>: User unknown"));
    assert.equal(d.code, "recipient_rejected");
    assert.equal(d.scope, "recipient");
    assert.equal(d.permanent, true);
  });

  test("5.7.1 is a policy refusal, not a bad address, and not permanent", () => {
    const d = describeMailError(rcptError("550 5.7.1 Sender address rejected: not owned by user"));
    assert.equal(d.code, "policy_rejected");
    assert.equal(d.scope, "mailbox");
    assert.equal(d.permanent, false);
  });
});

describe("what a send result does to mailbox health and suppression", () => {
  test("a recipient hard bounce suppresses that address and leaves the mailbox alone", () => {
    const a = sendOutcomeActions({ ok: false, errorCode: "recipient_rejected", errorMessage: "x", permanent: true, scope: "recipient" });
    assert.equal(a.suppressRecipient, true);
    assert.equal(a.health, "skip");
  });

  test("a mailbox failure flags the mailbox and suppresses nobody", () => {
    const a = sendOutcomeActions({ ok: false, errorCode: "auth_failed", errorMessage: "x", permanent: true, scope: "mailbox" });
    assert.equal(a.suppressRecipient, false);
    assert.deepEqual(a.health, { ok: false, code: "auth_failed", message: "x", permanent: true });
  });

  test("a malformed address neither suppresses nor touches health", () => {
    const a = sendOutcomeActions({ ok: false, errorCode: "invalid_recipient", errorMessage: "x", permanent: true, scope: "recipient" });
    assert.equal(a.suppressRecipient, false);
    assert.equal(a.health, "skip");
  });

  test("success marks the mailbox healthy", () => {
    assert.deepEqual(sendOutcomeActions({ ok: true }).health, { ok: true });
  });
});

describe("non-delivery report parsing", () => {
  const own = ["owner@studio.co.uk"];

  test("never suppresses the mailer-daemon when no recipient can be named", () => {
    const v = parseBounce(
      {
        from: "mailer-daemon@googlemail.com",
        subject: "Delivery Status Notification (Failure)",
        text: "Your message wasn't delivered. Contact <mailer-daemon@googlemail.com> or <postmaster@example.com>.",
      },
      own,
    );
    assert.equal(v.isBounce, true);
    assert.equal(v.recipient, null);
  });

  test("reads the failed address from the DSN part", () => {
    const v = parseBounce(
      {
        from: "MAILER-DAEMON@mx.example.net",
        subject: "Undelivered Mail Returned to Sender",
        text: "This is the mail system at host mx.example.net.",
        deliveryStatus:
          "Reporting-MTA: dns; mx.example.net\n\nFinal-Recipient: rfc822; lead@client.com\nOriginal-Recipient: rfc822;lead@client.com\nAction: failed\nStatus: 5.1.1\n",
      },
      own,
    );
    assert.deepEqual(v, { isBounce: true, hard: true, recipient: "lead@client.com" });
  });

  test("a delayed DSN is soft and must not be suppressed", () => {
    const v = parseBounce(
      {
        from: "postmaster@mx.example.net",
        subject: "Delivery delayed",
        text: "Delivery has been delayed.",
        deliveryStatus: "Final-Recipient: rfc822; lead@client.com\nAction: delayed\nStatus: 4.4.7\n",
      },
      own,
    );
    assert.equal(v.hard, false);
  });

  test("uses X-Failed-Recipients", () => {
    const v = parseBounce(
      { from: "mailer-daemon@exim.host", subject: "Mail delivery failed: returning message to sender", text: "failed", failedRecipientsHeader: "gone@client.com" },
      own,
    );
    assert.equal(v.recipient, "gone@client.com");
    assert.equal(v.hard, true);
  });

  test("never names the customer's own address, which every NDR quotes", () => {
    const v = parseBounce(
      {
        from: "postmaster@outlook.com",
        subject: "Undeliverable: Quick question",
        text: "Delivery has failed to these recipients.\nFrom: owner@studio.co.uk\nTo: lead@client.com",
      },
      own,
    );
    assert.equal(v.recipient, "lead@client.com");
  });

  test("two candidate addresses is ambiguous: nothing is suppressed", () => {
    const v = parseBounce(
      { from: "postmaster@x.net", subject: "Undeliverable", text: "To: a@one.com, b@two.com" },
      own,
    );
    assert.equal(v.recipient, null);
  });

  test("a person writing 'does not exist' is not a bounce", () => {
    const v = parseBounce(
      { from: "lead@client.com", subject: "Re: your proposal", text: "That budget does not exist yet, sorry." },
      own,
    );
    assert.equal(v.isBounce, false);
  });

  test("machine addresses are recognised", () => {
    for (const a of ["MAILER-DAEMON@x.com", "postmaster@x.com", "bounces+123@x.com", "noreply@x.com"]) {
      assert.equal(isMachineAddress(a), true, a);
    }
    assert.equal(isMachineAddress("jane@x.com"), false);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

  test("the poller has no fallback to the report's sender", () => {
    const poll = read("src/lib/jobs/handlers/email-poll.ts");
    assert.ok(!/\?\?\s*from\b/.test(poll), "bounce address must never fall back to `from`");
    assert.match(poll, /parseBounce\(/);
  });

  test("warm and cold sends route failures through the outcome rule", () => {
    assert.match(read("src/lib/messaging/email-provider.ts"), /applyEmailSendOutcome\(/);
    const dispatch = read("src/lib/outreach/dispatch.ts");
    assert.match(dispatch, /applyEmailSendOutcome\(/);
    assert.match(dispatch, /status: recipientBounce \? "BOUNCED"/);
  });

  test("marketing mail keeps RFC 8058 one-click and drops Auto-Submitted", () => {
    const smtp = read("src/lib/email/smtp.ts");
    assert.match(smtp, /"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"/);
    assert.ok(!/"Auto-Submitted":/.test(smtp));
  });

  test("ARF complaints are still suppressed by the poller", () => {
    assert.match(read("src/lib/jobs/handlers/email-poll.ts"), /recordComplaint\(/);
  });
});
