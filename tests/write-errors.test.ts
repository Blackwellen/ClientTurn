import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  WriteError,
  assertWrite,
  logWriteError,
} from "../src/lib/supabase/write-result.ts";
import {
  complaintRecipient,
  extractFeedbackReport,
  feedbackType,
  isComplaintReport,
  isFeedbackReportContentType,
} from "../src/lib/email/feedback-report.ts";

/**
 * Unread `{ error }` results.
 *
 * supabase-js returns a failed write as `{ error }` instead of throwing, so a
 * caller that does not read it reports success over a write that never
 * happened. `assertWrite` and `logWriteError` are the two sanctioned ways to
 * read one.
 */

function silenceConsoleError<T>(fn: () => T): { result: T; calls: unknown[][] } {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    return { result: fn(), calls };
  } finally {
    console.error = original;
  }
}

describe("assertWrite", () => {
  test("passes a successful write through", () => {
    assert.doesNotThrow(() => assertWrite({ error: null }, "noop"));
  });

  test("throws a WriteError naming the operation and code", () => {
    assert.throws(
      () =>
        assertWrite(
          { error: { message: "violates check constraint", code: "23514" } },
          "opt-out: lead update",
          { leadId: "lead-1" },
        ),
      (error: unknown) => {
        assert.ok(error instanceof WriteError);
        assert.equal(error.operation, "opt-out: lead update");
        assert.equal(error.code, "23514");
        assert.equal(error.context.leadId, "lead-1");
        assert.match(error.message, /opt-out: lead update failed: violates check constraint/);
        return true;
      },
    );
  });

  test("an ignored code is the outcome the caller wanted", () => {
    assert.doesNotThrow(() =>
      assertWrite({ error: { message: "duplicate key", code: "23505" } }, "idempotent insert", {}, {
        ignoreCodes: ["23505"],
      }),
    );
  });

  test("an ignored code does not excuse a different failure", () => {
    assert.throws(
      () =>
        assertWrite({ error: { message: "rls", code: "42501" } }, "insert", {}, {
          ignoreCodes: ["23505"],
        }),
      WriteError,
    );
  });

  test("an error without a code still throws", () => {
    assert.throws(() => assertWrite({ error: { message: "fetch failed" } }, "update"), WriteError);
  });
});

describe("logWriteError", () => {
  test("returns true and logs nothing for a successful write", () => {
    const { result, calls } = silenceConsoleError(() => logWriteError({ error: null }, "noop"));
    assert.equal(result, true);
    assert.equal(calls.length, 0);
  });

  test("returns false and logs the failure with its context, never throwing", () => {
    const { result, calls } = silenceConsoleError(() =>
      logWriteError(
        { error: { message: "network down", code: "08006" } },
        "inbound webhook: mark processed",
        { webhookEventId: "evt-1", businessId: "biz-1" },
      ),
    );
    assert.equal(result, false);
    assert.equal(calls.length, 1);
    assert.match(String(calls[0][0]), /inbound webhook: mark processed failed/);
    const detail = calls[0][1] as Record<string, unknown>;
    assert.equal(detail.webhookEventId, "evt-1");
    assert.equal(detail.businessId, "biz-1");
    assert.equal(detail.code, "08006");
    assert.equal(detail.message, "network down");
  });
});

/* ---------------------------------------------------- ARF feedback reports */

const REPORT_PART = [
  "Feedback-Type: abuse",
  "User-Agent: SomeFBL/1.0",
  "Version: 1",
  "Original-Rcpt-To: <Victim@Customer.example>",
  "",
].join("\r\n");

const ORIGINAL_MESSAGE = [
  "From: sales@sender.example",
  "To: victim@customer.example",
  "Subject: hello",
  "",
  "Buy now",
].join("\r\n");

/** What `simpleParser` produces for an ARF report: the fields are attachments. */
function parsedArf(reportPart: string | null) {
  const attachments = [
    ...(reportPart === null
      ? []
      : [{ contentType: "message/feedback-report", content: Buffer.from(reportPart) }]),
    { contentType: "message/rfc822", content: Buffer.from(ORIGINAL_MESSAGE) },
  ];
  return {
    contentType: {
      value: "multipart/report",
      params: { "report-type": "feedback-report", boundary: "b1" },
    },
    attachments,
  };
}

describe("feedback-report detection", () => {
  test("the report-type content type is recognised, structured or raw", () => {
    assert.equal(
      isFeedbackReportContentType({
        value: "multipart/report",
        params: { "report-type": "feedback-report" },
      }),
      true,
    );
    assert.equal(
      isFeedbackReportContentType('multipart/report; report-type="feedback-report"; boundary=x'),
      true,
    );
    assert.equal(
      isFeedbackReportContentType({
        value: "multipart/report",
        params: { "report-type": "delivery-status" },
      }),
      false,
    );
    assert.equal(isFeedbackReportContentType("text/plain"), false);
    assert.equal(isFeedbackReportContentType(null), false);
  });

  test("the feedback-report part is extracted from the attachments", () => {
    const parts = extractFeedbackReport(parsedArf(REPORT_PART));
    assert.equal(parts.feedbackReport, REPORT_PART);
    assert.equal(parts.reportedMessage, ORIGINAL_MESSAGE);
    assert.equal(feedbackType(parts.feedbackReport ?? ""), "abuse");
  });

  test("a declared report with no report part is still marked as a report", () => {
    const parts = extractFeedbackReport(parsedArf(null));
    assert.equal(parts.feedbackReport, "");
  });

  test("ordinary mail is not a report", () => {
    const parts = extractFeedbackReport({
      contentType: { value: "multipart/mixed", params: {} },
      attachments: [{ contentType: "application/pdf", content: Buffer.from("%PDF") }],
    });
    assert.equal(parts.feedbackReport, null);
    assert.equal(parts.reportedMessage, null);
  });

  test("an ARF report whose text part says nothing is detected as a complaint", () => {
    // This is the defect: the human-readable text carries none of the ARF
    // fields, so text-only detection missed every such report.
    const parts = extractFeedbackReport(parsedArf(REPORT_PART));
    const message = {
      subject: "FW: hello",
      text: "This is an email abuse report for an email message received.",
      ...parts,
    };
    assert.equal(isComplaintReport(message), true);
    assert.equal(complaintRecipient(message), "victim@customer.example");
  });

  test("the recipient falls back to the reported message's To header", () => {
    const redacted = "Feedback-Type: abuse\r\nVersion: 1\r\n";
    const message = {
      subject: "Report",
      text: "Abuse report attached.",
      ...extractFeedbackReport(parsedArf(redacted)),
    };
    assert.equal(isComplaintReport(message), true);
    assert.equal(complaintRecipient(message), "victim@customer.example");
  });

  test("a not-spam report is never a complaint", () => {
    const message = {
      subject: "Abuse report",
      text: "Feedback-Type: abuse",
      ...extractFeedbackReport(parsedArf("Feedback-Type: not-spam\r\nVersion: 1\r\n")),
    };
    assert.equal(isComplaintReport(message), false);
  });

  test("plain-text forwarded reports still use the text heuristic", () => {
    const message = {
      subject: "Abuse report",
      text: "Feedback-Type: abuse\nOriginal-Rcpt-To: someone@example.com",
      feedbackReport: null,
      reportedMessage: null,
    };
    assert.equal(isComplaintReport(message), true);
    assert.equal(complaintRecipient(message), "someone@example.com");
  });

  test("an ordinary reply mentioning spam is not a complaint", () => {
    const message = {
      subject: "Re: your email",
      text: "Is this spam? Please stop.",
      feedbackReport: null,
      reportedMessage: null,
    };
    assert.equal(isComplaintReport(message), false);
  });
});
