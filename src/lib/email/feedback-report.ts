import { complainedAddress, isAbuseReport } from "./unsubscribe-links.ts";

/**
 * ARF (RFC 5965) abuse reports, read from the MIME structure rather than the
 * text body.
 *
 * A feedback-loop report is `multipart/report; report-type=feedback-report`
 * with three parts: a human-readable text part, a machine-readable
 * `message/feedback-report` part (where `Feedback-Type: abuse` and
 * `Original-Rcpt-To` live), and the reported message itself as
 * `message/rfc822`. The parser surfaces only the first as `text`; the other
 * two arrive as attachments. Detection that only reads `text` therefore never
 * sees the fields it looks for, and every complaint was dropped.
 *
 * Pure: no server-only import, so it can be unit tested directly.
 */

/** The parser's shape for one attachment, narrowed to what is read here. */
export type MimePartLike = {
  contentType?: string | null;
  content?: Buffer | Uint8Array | string | null;
};

/** The parser's shape for a structured Content-Type header. */
export type ContentTypeHeaderLike =
  | string
  | { value?: string | null; params?: Record<string, string | undefined> | null }
  | null
  | undefined;

export type FeedbackReportParts = {
  /**
   * The `message/feedback-report` part's text. An empty string when the
   * top-level Content-Type declares a feedback report but no such part was
   * found; null when the mail is not a feedback report at all.
   */
  feedbackReport: string | null;
  /** Headers and body of the reported (original) message, when attached. */
  reportedMessage: string | null;
};

function partText(content: MimePartLike["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return Buffer.from(content).toString("utf8");
}

/** True for `multipart/report; report-type=feedback-report`. */
export function isFeedbackReportContentType(header: ContentTypeHeaderLike): boolean {
  if (!header) return false;
  if (typeof header === "string") {
    return (
      /^\s*multipart\/report\b/i.test(header) &&
      /report-type\s*=\s*"?feedback-report"?/i.test(header)
    );
  }
  const value = (header.value ?? "").trim().toLowerCase();
  const reportType = (header.params?.["report-type"] ?? "").trim().toLowerCase();
  return value === "multipart/report" && reportType === "feedback-report";
}

/** Pulls the report and reported-message parts out of a parsed mail. */
export function extractFeedbackReport(input: {
  contentType: ContentTypeHeaderLike;
  attachments: readonly MimePartLike[] | null | undefined;
}): FeedbackReportParts {
  const parts = input.attachments ?? [];
  const reportPart = parts.find(
    (part) => (part.contentType ?? "").toLowerCase() === "message/feedback-report",
  );
  const reportedPart = parts.find((part) => {
    const type = (part.contentType ?? "").toLowerCase();
    return type === "message/rfc822" || type === "text/rfc822-headers";
  });

  const declared = isFeedbackReportContentType(input.contentType);
  const feedbackReport = reportPart
    ? partText(reportPart.content)
    : declared
      ? ""
      : null;

  return {
    feedbackReport,
    reportedMessage:
      feedbackReport !== null && reportedPart ? partText(reportedPart.content) : null,
  };
}

/** The `Feedback-Type` field of a report part, lower-cased, or null. */
export function feedbackType(report: string): string | null {
  const match = report.match(/^\s*feedback-type:\s*([\w-]+)/im);
  return match ? match[1].toLowerCase() : null;
}

export type ComplaintCandidate = {
  subject: string | null;
  text: string;
  feedbackReport: string | null;
  reportedMessage: string | null;
};

/**
 * Whether an inbound mail is a spam complaint.
 *
 * A machine-readable report decides by its own `Feedback-Type`: `abuse` is a
 * complaint, and `not-spam`, `virus`, `fraud` or `other` are not — a
 * "this was not spam" report must never suppress anyone. Without a report
 * part (or with one that names no type), the older subject-and-text
 * heuristic still applies, for providers that forward reports as plain text.
 */
export function isComplaintReport(message: ComplaintCandidate): boolean {
  if (message.feedbackReport) {
    const type = feedbackType(message.feedbackReport);
    if (type) return type === "abuse";
  }
  return isAbuseReport(message.subject, message.text);
}

/**
 * The complainant: `Original-Rcpt-To` from the report part, else the `To:` of
 * the reported message, else whatever the text body names. Never the report's
 * own sender.
 */
export function complaintRecipient(message: ComplaintCandidate): string | null {
  if (message.feedbackReport) {
    const fromReport = message.feedbackReport.match(
      /^\s*original-rcpt-to:\s*(?:rfc822;\s*)?<?([\w.+-]+@[\w.-]+\.[a-z]{2,})>?/im,
    );
    if (fromReport) return fromReport[1].trim().toLowerCase();
  }
  if (message.reportedMessage) {
    const fromOriginal = complainedAddress(message.reportedMessage);
    if (fromOriginal) return fromOriginal;
  }
  return complainedAddress(message.text);
}
