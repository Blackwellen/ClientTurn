import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { COMPANY, DPA_EFFECTIVE_FROM, DPA_VERSION } from "@/lib/marketing/company";
import {
  SUBPROCESSORS,
  SUBPROCESSOR_NOTICE_DAYS,
} from "@/lib/marketing/subprocessors";
import { OG_IMAGES, TWITTER_IMAGES } from "@/lib/marketing/seo";

const description =
  "ClientTurn's Article 28 UK GDPR Data Processing Agreement: processor obligations, security, sub-processors, international transfers, breach notification, deletion and audit.";

export const metadata: Metadata = {
  title: "Data Processing Agreement",
  description,
  alternates: { canonical: "/dpa" },
  openGraph: {
    images: OG_IMAGES,
    title: "Data Processing Agreement",
    description,
    url: "/dpa",
    siteName: "ClientTurn",
    locale: "en_GB",
    type: "article",
  },
  twitter: { card: "summary", title: "Data Processing Agreement", description, images: TWITTER_IMAGES },
};

/**
 * Facts only the owner can supply. Rendered as a visible placeholder until the
 * value exists in `COMPANY`, so this page never states a number we do not hold.
 */
function Placeholder({ children }: { children: string }) {
  return (
    <mark className="rounded bg-warning-50 px-1 font-medium text-warning-700">
      [{children}]
    </mark>
  );
}

const icoNumber = COMPANY.icoRegistration ? (
  <strong>{COMPANY.icoRegistration}</strong>
) : (
  <Placeholder>ICO registration number — owner to supply</Placeholder>
);

const DETAILS: { label: string; value: ReactNode }[] = [
  {
    label: "Subject matter",
    value:
      "Provision of the ClientTurn service: receiving leads, instant follow-up, deterministic qualification, booking, quoting and invoicing links, optional AI voice calls, and reporting.",
  },
  {
    label: "Duration",
    value:
      "The customer's subscription, plus the exit and deletion period in section 12.",
  },
  {
    label: "Nature and purpose",
    value:
      "Collecting, recording, organising, storing, retrieving, transmitting, analysing, restricting and erasing personal data so the customer can respond to, qualify and convert its own enquiries and prospects.",
  },
  {
    label: "Categories of data subject",
    value:
      "The customer's prospective and existing clients and their staff (leads and contacts), people who sign or pay a quote, and the customer's own authorised users.",
  },
  {
    label: "Types of personal data",
    value:
      "Name, business email address, phone number supplied on a lead form, job title and company, lead form answers, message and email content, qualification answers, booking details, quote and invoice details (including signer name, email, IP address and user agent), call metadata, transcripts and, where enabled, recordings, and campaign attribution identifiers.",
  },
  {
    label: "Special category data",
    value:
      "None intended. The product does not ask for it and customers must not collect it through the service. Any volunteered in a free-text reply is held only as part of that message.",
  },
  {
    label: "Frequency",
    value: "Continuous, for as long as the customer uses the service.",
  },
];

const MEASURES: { heading: string; items: string[] }[] = [
  {
    heading: "Tenant isolation and access control",
    items: [
      "Every tenant table carries a workspace identifier and has Postgres row-level security enabled, so one workspace's session cannot read another's rows even if application code is wrong.",
      "Workspace roles (owner, admin, member, viewer) plus per-person permissions for outbound sending, integrations and billing, checked on the server for every action, whether it comes from the app, the API or MCP.",
      "Platform administration uses a separate sign-in, is checked against the database on every request, and requires the operator to re-enter their password (step-up) within the last 30 minutes before any change.",
      "Workspace API keys are scoped and can be revoked at any time.",
    ],
  },
  {
    heading: "Encryption and secrets",
    items: [
      "TLS in transit for all traffic, with HTTP Strict Transport Security (including preload).",
      "Encryption at rest provided by the database and object-storage platforms.",
      "Mailbox passwords a customer enters are encrypted in the application (AES-256-GCM) before storage; integration tokens and webhook secrets are held in tables only the server can read.",
      "Service keys, provider tokens and webhook secrets are server-side only: never in a browser bundle, a public environment variable or a response body.",
    ],
  },
  {
    heading: "Integrity of inbound data",
    items: [
      "Every inbound webhook's signature or shared secret is verified before the payload is trusted, and events are de-duplicated so a replayed event cannot cause a second action.",
      "All inputs, filters, uploads and webhook payloads are validated against a schema.",
      "Outbound fetches of customer-supplied web addresses are restricted to public addresses, with every redirect re-checked.",
    ],
  },
  {
    heading: "Files",
    items: [
      "Files are stored in a private bucket and served only through short-lived signed links (5 minutes by default).",
      "Uploads are limited by type and size; SVG images are refused.",
    ],
  },
  {
    heading: "Accountability",
    items: [
      "An append-only audit log records administrative and data-changing actions with the actor and time; workspace owners and admins can export it.",
      "Rate limits on sign-in, public forms, exports, the API and webhooks.",
      "Every contact decision (why a message was or was not allowed) is recorded with the rules in force at the time.",
    ],
  },
  {
    heading: "Resilience",
    items: [
      "Daily encrypted database backups held by our database provider in the United Kingdom.",
      "A documented restore runbook. Point-in-time recovery and a recorded restore drill are being put in place and will be listed here when complete.",
      "A public status page reporting the health of each part of the service.",
    ],
  },
  {
    heading: "AI",
    items: [
      "AI assistance is optional and off by default. Deterministic rules make every qualification and follow-up decision; the AI never composes a binding price, quote, availability or service-area promise.",
      "Azure OpenAI runs in the EU; customer data is not used to train models.",
    ],
  },
];

function SubProcessorAnnex() {
  return (
    <div className="-mx-1 overflow-x-auto rounded-xl border border-line">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Provider</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead>Location</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SUBPROCESSORS.map((row) => (
            <TableRow key={row.name}>
              <TableCell className="min-w-[150px] align-top font-medium">
                {row.name}
                <span className="mt-1 block text-[12px] font-normal text-content-muted">
                  {row.role === "customer-enabled"
                    ? "Customer-enabled"
                    : row.optional
                      ? "Only if enabled"
                      : "Core"}
                </span>
              </TableCell>
              <TableCell className="min-w-[260px] align-top">{row.purpose}</TableCell>
              <TableCell className="min-w-[180px] align-top">{row.location}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const SECTIONS: LegalSection[] = [
  {
    id: "about",
    heading: "1. About this agreement",
    body: (
      <>
        <p>
          This Data Processing Agreement (&ldquo;DPA&rdquo;) is between{" "}
          <strong>{COMPANY.registeredName}</strong>, trading as {COMPANY.product}{" "}
          (company number {COMPANY.companyNumber}, registered office{" "}
          {COMPANY.registeredAddress}) (&ldquo;we&rdquo;, the processor), and
          the business that holds a {COMPANY.product} workspace (&ldquo;you&rdquo;,
          the controller). It is the contract required by Article 28(3) of the UK
          GDPR.
        </p>
        <p>
          It forms part of the <a href="/terms">Terms of Service</a> (clause 16)
          and is accepted when you accept those terms. It sets out the same
          commitments as section 7 of our <a href="/privacy">Privacy Policy</a>{" "}
          in one standalone document, with the annexes a procurement or security
          review asks for. If you need a countersigned copy for your records,
          write to{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>.
        </p>
      </>
    ),
  },
  {
    id: "definitions",
    heading: "2. Definitions",
    body: (
      <p>
        &ldquo;UK GDPR&rdquo;, &ldquo;personal data&rdquo;,
        &ldquo;processing&rdquo;, &ldquo;controller&rdquo;,
        &ldquo;processor&rdquo;, &ldquo;data subject&rdquo; and
        &ldquo;personal data breach&rdquo; have the meanings in the UK GDPR and
        the Data Protection Act 2018. &ldquo;Customer Personal Data&rdquo; means
        personal data we process on your behalf in providing the service, as
        described in Annex 1. &ldquo;Sub-processor&rdquo; means a third party we
        engage to process Customer Personal Data.
      </p>
    ),
  },
  {
    id: "roles",
    heading: "3. Roles and scope",
    body: (
      <>
        <p>
          For Customer Personal Data you are the controller and we are your
          processor. You decide which leads and contacts are processed, why, and
          which channels, rules and integrations are used.
        </p>
        <p>
          For the account data of your own users (sign-in, billing, support) we
          are an independent controller, as described in the Privacy Policy.
          This DPA does not apply to that data.
        </p>
        <p>
          Where you take a payment through a quote or invoice link, you are the
          merchant of record through your own payment provider account;
          ClientTurn sends the link and reads the payment result for you.
        </p>
      </>
    ),
  },
  {
    id: "instructions",
    heading: "4. Processing on your instructions",
    body: (
      <>
        <p>
          We process Customer Personal Data only on your documented
          instructions. Your instructions are this DPA, the Terms, and the
          configuration you set in the product (sources, questions, rules,
          channels, integrations and retention settings).
        </p>
        <p>
          If the law requires us to process it otherwise, we will tell you first
          unless the law forbids it. We will tell you if we believe an
          instruction infringes data protection law.
        </p>
        <p>
          You are responsible for having a lawful basis, for the transparency
          information you give data subjects, and for complying with PECR when
          you use the service to send electronic marketing.
        </p>
      </>
    ),
  },
  {
    id: "confidentiality",
    heading: "5. Confidentiality",
    body: (
      <p>
        Everyone we authorise to process Customer Personal Data is bound by a
        duty of confidence and has access only as far as their role needs.
      </p>
    ),
  },
  {
    id: "security",
    heading: "6. Security",
    body: (
      <p>
        We implement the technical and organisational measures in Annex 2,
        which are appropriate to the risk under Article 32. We may change them
        to keep pace with threats and technology, but will not reduce the
        overall level of protection.
      </p>
    ),
  },
  {
    id: "subprocessors",
    heading: "7. Sub-processors",
    body: (
      <>
        <p>
          You give general written authorisation for us to engage the
          sub-processors listed in Annex 3 and on our{" "}
          <a href="/sub-processors">sub-processor register</a>, which is the
          current list.
        </p>
        <ul>
          <li>
            We give at least <strong>{SUBPROCESSOR_NOTICE_DAYS} days&rsquo;</strong>{" "}
            notice by email before a new sub-processor starts processing
            Customer Personal Data, and update the register at the same time.
          </li>
          <li>
            You may object on reasonable data protection grounds within the
            notice period by writing to{" "}
            <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>. If
            we cannot resolve it, you may end the affected part of the service
            and receive a pro-rata refund of prepaid fees for it.
          </li>
          <li>
            Each sub-processor is bound by written terms no less protective than
            this DPA, and we remain liable to you for its performance.
          </li>
          <li>
            We do not use data brokers or paid contact-enrichment vendors.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "transfers",
    heading: "8. International transfers",
    body: (
      <>
        <p>
          The primary database is in London (eu-west-2). Where a sub-processor
          processes Customer Personal Data outside the United Kingdom, we rely on
          UK adequacy regulations or on the International Data Transfer
          Addendum to the EU Standard Contractual Clauses (or the International
          Data Transfer Agreement), supported by a transfer risk assessment.
          Annex 3 gives the location of each.
        </p>
        <p>
          Retell AI (the optional AI voice agent) processes and stores call
          data in the United States (Amazon Web Services US regions). The
          transfer relies on the UK International Data Transfer Agreement or
          the Standard Contractual Clauses with the UK Addendum, under Retell
          AI&apos;s data processing agreement.
        </p>
      </>
    ),
  },
  {
    id: "rights",
    heading: "9. Data subject requests",
    body: (
      <p>
        We help you answer requests from data subjects through the product
        (search, export, suppression, anonymisation and deletion tools, and the
        privacy request inbox in Settings), and by responding to reasonable
        requests for further help. If a request reaches us directly we pass it
        to you without undue delay and do not answer it ourselves unless you
        ask us to.
      </p>
    ),
  },
  {
    id: "breach",
    heading: "10. Personal data breaches",
    body: (
      <>
        <p>
          We notify you without undue delay, and in any event within{" "}
          <strong>24 hours</strong> of becoming aware, of a personal data breach
          affecting Customer Personal Data. The notice gives what we know at
          that point: the nature of the breach, the categories and approximate
          numbers of people and records, the likely consequences, and what we
          are doing about it. We follow up as we learn more.
        </p>
        <p>
          We will help you meet your own obligations to notify the ICO within 72
          hours and, where the risk is high, the people affected.
        </p>
      </>
    ),
  },
  {
    id: "dpia",
    heading: "11. Impact assessments",
    body: (
      <p>
        Taking into account the nature of the processing and the information
        available to us, we assist you with data protection impact assessments
        and any prior consultation with the ICO. Our security questionnaire
        answers and data-flow description are available on request.
      </p>
    ),
  },
  {
    id: "deletion",
    heading: "12. Deletion and return",
    body: (
      <p>
        For 30 days after your subscription ends you may export your data using
        the export tools, or ask us for a machine-readable copy free of charge.
        After that, and in any event within 90 days, we delete or irreversibly
        anonymise Customer Personal Data, except records the law requires us to
        keep and minimised suppression records kept only so that someone who
        opted out is not contacted again. Deleted data leaves our encrypted
        backups as they expire.
      </p>
    ),
  },
  {
    id: "audit",
    heading: "13. Information and audits",
    body: (
      <p>
        We make available the information needed to demonstrate compliance with
        this DPA, starting with this document, the sub-processor register and
        our security questionnaire answers. Where that is not enough, you (or an
        independent auditor bound by confidentiality) may audit on at least 30
        days&rsquo; notice, no more than once in any 12 months except after a
        personal data breach, during business hours and without access to other
        customers&rsquo; data. Each party bears its own costs.
      </p>
    ),
  },
  {
    id: "liability",
    heading: "14. Liability and order of precedence",
    body: (
      <p>
        Each party&rsquo;s liability under this DPA is subject to the limits in
        clause 20 of the Terms, except where the law does not allow it to be
        limited. If this DPA conflicts with the Terms on the processing of
        Customer Personal Data, this DPA prevails.
      </p>
    ),
  },
  {
    id: "changes",
    heading: "15. Term and changes",
    body: (
      <p>
        This DPA lasts as long as we process Customer Personal Data for you. We
        may update it to reflect changes in law or in the service; we will give
        at least 30 days&rsquo; notice of any change that reduces your
        protection. The version and date at the top of this page identify the
        text in force.
      </p>
    ),
  },
  {
    id: "registration",
    heading: "16. Our registration and contact",
    body: (
      <p>
        {COMPANY.registeredName} is registered with the Information
        Commissioner&rsquo;s Office, registration number {icoNumber}. Data
        protection questions and notices under this DPA go to{" "}
        <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>.
      </p>
    ),
  },
  {
    id: "annex-1",
    heading: "Annex 1. Details of the processing",
    body: (
      <dl className="space-y-3">
        {DETAILS.map((row) => (
          <div key={row.label}>
            <dt className="font-semibold text-content">{row.label}</dt>
            <dd className="mt-0.5">{row.value}</dd>
          </div>
        ))}
      </dl>
    ),
  },
  {
    id: "annex-2",
    heading: "Annex 2. Technical and organisational measures",
    body: (
      <>
        {MEASURES.map((group) => (
          <div key={group.heading}>
            <p className="font-semibold text-content">{group.heading}</p>
            <ul className="mt-2">
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </>
    ),
  },
  {
    id: "annex-3",
    heading: "Annex 3. Sub-processors",
    body: (
      <>
        <p>
          The current list, with the personal data each can see and the transfer
          mechanism relied on, is on the{" "}
          <a href="/sub-processors">sub-processor register</a>. At the date of
          this version:
        </p>
        <SubProcessorAnnex />
      </>
    ),
  },
];

export default function DpaPage() {
  return (
    <LegalPage
      title="Data Processing Agreement"
      intro="Our Article 28 UK GDPR commitments to the businesses that use ClientTurn, in one document: what we process, how we protect it, who helps us, and what happens at the end."
      currentPath="/dpa"
      sections={SECTIONS}
      version={DPA_VERSION}
      effectiveFrom={DPA_EFFECTIVE_FROM}
    />
  );
}
