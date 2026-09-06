/**
 * The sub-processor register.
 *
 * This is the authoritative list published under Article 28(2) and 28(4) UK
 * GDPR and under clause 6 of our data processing terms. It is rendered by the
 * Privacy Policy and by /sub-processors, and it is the list customers are
 * entitled to object to changes in.
 *
 * Rules for editing:
 *  - A provider goes in here the moment it can touch customer or lead personal
 *    data in production, not when it is first integrated.
 *  - `role` distinguishes a sub-processor we appoint (we remain accountable)
 *    from a provider the customer connects themselves (an onward disclosure
 *    the customer instructs).
 *  - `optional` means the provider only ever sees data if the customer turns
 *    the relevant feature or integration on.
 *  - Never remove a provider silently. Add the change to SUBPROCESSOR_CHANGES
 *    and give customers the notice period stated in the Privacy Policy.
 */

export type SubProcessorRole = "core" | "customer-enabled";

export type SubProcessor = {
  /** Legal entity we actually contract with, not the marketing name. */
  entity: string;
  /** Short label for the table. */
  name: string;
  /** What it does for us, in one sentence a customer can act on. */
  purpose: string;
  /** Categories of personal data it can see. */
  data: string;
  /** Where the data is processed or stored. */
  location: string;
  /** Transfer mechanism where processing leaves the UK. */
  transfer: string;
  role: SubProcessorRole;
  optional: boolean;
};

export const SUBPROCESSORS: SubProcessor[] = [
  {
    entity: "Supabase, Inc. (United States), operating the EU-hosted platform",
    name: "Supabase",
    purpose:
      "Primary application database, authentication and file storage. Holds workspace accounts, leads, messages, qualification answers and audit records.",
    data: "Account data; lead contact details; message content and delivery status; qualification answers; audit logs.",
    location: "London, United Kingdom (eu-west-2)",
    transfer:
      "Data at rest remains in the United Kingdom. Provider support access from the United States is covered by the UK International Data Transfer Addendum.",
    role: "core",
    optional: false,
  },
  {
    entity: "Vercel, Inc. (United States)",
    name: "Vercel",
    purpose:
      "Hosting and delivery of the application and marketing site, including request routing, function execution and short-lived operational logging.",
    data: "IP address, request metadata, and any personal data contained in a request or response while it is in transit.",
    location: "United States (primary compute), with a global edge network",
    transfer: "UK International Data Transfer Addendum to the EU Standard Contractual Clauses.",
    role: "core",
    optional: false,
  },
  {
    entity:
      "Stripe Payments Europe, Limited (Ireland) and Stripe, Inc. (United States)",
    name: "Stripe",
    purpose:
      "Subscription billing, checkout, card processing, invoicing and tax calculation. Card details are entered into Stripe-hosted fields and never reach our servers.",
    data: "Billing name, billing address, email address, VAT status, payment method tokens, invoice and transaction records.",
    location: "European Union and United States",
    transfer: "EU Standard Contractual Clauses with the UK Addendum.",
    role: "core",
    optional: false,
  },
  {
    entity: "Cloudflare, Inc. (United States) and Cloudflare Limited (United Kingdom)",
    name: "Cloudflare R2",
    purpose:
      "Object storage for workspace logos and uploaded CSV import files, and network protection in front of the site. Stored files are served only through short-lived signed URLs.",
    data: "Uploaded logo images; CSV import files, which may contain contact names, phone numbers and email addresses; network request metadata.",
    location: "European Union jurisdictional restriction applied to stored objects",
    transfer: "UK International Data Transfer Addendum to the EU Standard Contractual Clauses.",
    role: "core",
    optional: false,
  },
  {
    entity: "Twilio Ireland Limited and Twilio Inc. (United States)",
    name: "Twilio",
    purpose:
      "Delivery of outbound SMS and WhatsApp messages and receipt of inbound replies, including delivery receipts and opt-out keywords.",
    data: "Recipient phone number, message body, timestamps, delivery status, and the content of inbound replies.",
    location: "Ireland and United States",
    transfer: "EU Standard Contractual Clauses with the UK Addendum.",
    role: "core",
    optional: false,
  },
  {
    entity: "Plus Five Five, Inc. trading as Resend (United States)",
    name: "Resend",
    purpose:
      "Transactional email: sign-in and verification messages, billing notices, product notifications, and follow-up email to leads where email follow-up is configured.",
    data: "Recipient name and email address, message body, delivery and bounce status.",
    location: "United States",
    transfer: "EU Standard Contractual Clauses with the UK Addendum.",
    role: "core",
    optional: false,
  },
  {
    entity: "Microsoft Ireland Operations Limited",
    name: "Microsoft Azure OpenAI Service",
    purpose:
      "Optional AI assist. Classifies the intent of an inbound reply and extracts a candidate answer to a question the customer has already configured. It never composes a price, quote, availability or service-area commitment, and the deterministic rules always make the decision.",
    data: "The text of an inbound message and the configured question it is being matched against.",
    location: "European Union (EU data boundary; customer data is not used to train models)",
    transfer: "UK adequacy regulations for the European Economic Area.",
    role: "core",
    optional: true,
  },
  {
    entity: "Meta Platforms Ireland Limited",
    name: "Meta Lead Ads",
    purpose:
      "Source of the leads a customer receives. Meta delivers lead form submissions and campaign attribution fields for the pages and forms the customer connects.",
    data: "Lead form answers, typically name, phone number and email address, plus campaign, ad set, ad and form identifiers.",
    location: "European Union and United States",
    transfer: "Meta's own transfer mechanism under its platform terms.",
    role: "customer-enabled",
    optional: true,
  },
  {
    entity: "Google Ireland Limited",
    name: "Google Calendar",
    purpose:
      "Reading availability and writing bookings into the connected calendar, where a customer connects one.",
    data: "Booking time, lead name and contact details, and the appointment note.",
    location: "European Union and United States",
    transfer: "EU Standard Contractual Clauses with the UK Addendum.",
    role: "customer-enabled",
    optional: true,
  },
  {
    entity: "Calendly LLC (United States)",
    name: "Calendly",
    purpose:
      "Booking pages and appointment records, where a customer connects Calendly instead of a calendar.",
    data: "Booking time, invitee name, email address, phone number, and answers to booking questions.",
    location: "United States",
    transfer: "EU Standard Contractual Clauses with the UK Addendum.",
    role: "customer-enabled",
    optional: true,
  },
  {
    entity:
      "Google Ireland Limited, Microsoft Ireland Operations Limited, TikTok Information Technologies UK Limited, and LinkedIn Ireland Unlimited Company",
    name: "Advertising platforms",
    purpose:
      "Where a customer connects an advertising account for attribution, we return conversion signals for the leads that platform generated.",
    data: "Hashed contact identifiers and conversion events for that customer's own leads.",
    location: "European Union, United Kingdom and United States",
    transfer: "Each platform's own transfer mechanism under its advertising terms.",
    role: "customer-enabled",
    optional: true,
  },
  {
    entity:
      "HubSpot Ireland Limited, Salesforce UK Limited, Zoho Corporation B.V., and Slack Technologies Limited",
    name: "CRM and notification destinations",
    purpose:
      "Where a customer connects a CRM or Slack, we push the lead and its status into that system on the customer's instruction.",
    data: "Lead contact details, a summary of message history, and lead status.",
    location: "Determined by the customer's own tenancy with that provider",
    transfer: "Governed by the customer's own agreement with that provider.",
    role: "customer-enabled",
    optional: true,
  },
];

/**
 * Public change log for the register. Customers rely on this to check whether
 * anything has changed since they last looked, so append — never rewrite.
 */
export const SUBPROCESSOR_CHANGES: { date: string; change: string }[] = [
  {
    date: "5 September 2026",
    change:
      "First publication of the register. Every provider listed above was in place from the start of the service.",
  },
];

/** Notice we give before a new sub-processor starts processing customer data. */
export const SUBPROCESSOR_NOTICE_DAYS = 30;

export const CORE_SUBPROCESSORS = SUBPROCESSORS.filter((p) => p.role === "core");
export const CUSTOMER_ENABLED_SUBPROCESSORS = SUBPROCESSORS.filter(
  (p) => p.role === "customer-enabled",
);
