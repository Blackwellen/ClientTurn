/**
 * The internal notification for a /contact-sales enquiry.
 *
 * Before surface QA 2026-09-30 an enquiry was written to `marketing_events`
 * and nothing else: no email, no admin view, while the page promised "we read
 * every enquiry and reply by email". This formats the plain-text email the
 * action now sends to the sales mailbox (COMPANY.supportEmail), with the
 * enquirer as Reply-To so answering it is one click.
 *
 * Pure: plain text only (no HTML to escape), every field bounded, and header
 * values stripped of line breaks so a submitted name cannot inject a header.
 */

export type SalesEnquiryFields = {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  website?: string | null;
  companySize: string;
  leadVolume: string;
  useCase: string;
  currentSystems: string[];
  message?: string | null;
  marketingConsent: boolean;
};

/** One line, no control characters, bounded: safe in a subject header. */
export function headerSafe(value: string, max = 120): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function formatSalesEnquiryEmail(input: SalesEnquiryFields): {
  subject: string;
  text: string;
  replyTo: string;
} {
  const name = headerSafe(`${input.firstName} ${input.lastName}`, 80);
  const company = headerSafe(input.company, 80);
  const text = [
    "New sales enquiry from the ClientTurn website (/contact-sales).",
    "",
    `Name: ${name}`,
    `Email: ${headerSafe(input.email, 200)}`,
    `Company: ${company}`,
    `Website: ${input.website ? headerSafe(input.website, 300) : "Not given"}`,
    `Company size: ${input.companySize}`,
    `Monthly lead volume: ${input.leadVolume}`,
    `Primary use case: ${input.useCase}`,
    `Current systems: ${input.currentSystems.length > 0 ? input.currentSystems.join(", ") : "None selected"}`,
    `Marketing consent: ${input.marketingConsent ? "Yes" : "No (reply about this enquiry only)"}`,
    "",
    "Message:",
    input.message?.trim() ? input.message.trim().slice(0, 1000) : "(none)",
    "",
    "Reply to this email to answer the enquirer directly.",
  ].join("\n");

  return {
    subject: `Sales enquiry: ${company} (${name})`,
    text,
    replyTo: headerSafe(input.email, 200),
  };
}
