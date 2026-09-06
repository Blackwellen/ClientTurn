import type { Metadata } from "next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { COMPANY } from "@/lib/marketing/company";
import {
  CORE_SUBPROCESSORS,
  CUSTOMER_ENABLED_SUBPROCESSORS,
  SUBPROCESSOR_NOTICE_DAYS,
} from "@/lib/marketing/subprocessors";

const description =
  "How Blackwellen Limited handles personal data in ClientTurn, under the UK GDPR, the Data Protection Act 2018 and PECR — for account holders, and for the leads our customers process. Includes our Article 28 processing terms and our sub-processor register.";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description,
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy · ClientTurn",
    description,
    url: "/privacy",
    siteName: "ClientTurn",
    locale: "en_GB",
    type: "article",
  },
  twitter: {
    card: "summary",
    title: "Privacy Policy · ClientTurn",
    description,
  },
};

const RETENTION = [
  {
    category: "Account and workspace records",
    period: "Life of the account, then 90 days",
    reason:
      "Kept briefly after closure so an account can be recovered if it was closed in error, then deleted.",
  },
  {
    category: "Lead records, messages and qualification answers",
    period: "As long as the customer keeps them; 90 days after account closure",
    reason:
      "The customer controls this data and can delete any record at any time. On closure we delete it within 90 days.",
  },
  {
    category: "Suppression and opt-out records",
    period: "Indefinitely, in minimised form",
    reason:
      "Article 17(3)(b) UK GDPR. Honouring an opt-out requires keeping a minimal record of it. We keep a hashed identifier and the date, not the full record.",
  },
  {
    category: "Billing, invoices and tax records",
    period: "6 years from the end of the accounting period",
    reason:
      "Section 386 Companies Act 2006 and paragraph 6 Schedule 11 VAT Act 1994.",
  },
  {
    category: "Security and audit logs",
    period: "12 months",
    reason:
      "Needed to investigate unauthorised access and to demonstrate accountability under Article 5(2).",
  },
  {
    category: "Operational and application logs",
    period: "30 days",
    reason: "Diagnosing faults. Rolled off automatically.",
  },
  {
    category: "Support correspondence",
    period: "24 months from the last message",
    reason: "Handling follow-up questions and complaints, and evidencing what was agreed.",
  },
  {
    category: "Backups",
    period: "Up to 35 days",
    reason:
      "Deleted data persists in encrypted backups until they expire on a rolling cycle, then is overwritten.",
  },
] as const;

function SubProcessorTable({
  rows,
}: {
  rows: readonly {
    name: string;
    entity: string;
    purpose: string;
    data: string;
    location: string;
    transfer: string;
    optional: boolean;
  }[];
}) {
  return (
    <div className="-mx-1 overflow-x-auto rounded-xl border border-line">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Provider</TableHead>
            <TableHead>What it does</TableHead>
            <TableHead>Data it can see</TableHead>
            <TableHead>Location and transfer basis</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell className="min-w-[180px] align-top">
                <span className="font-medium text-content">{row.name}</span>
                <span className="mt-1 block text-[12px] text-content-muted">
                  {row.entity}
                </span>
                {row.optional ? (
                  <span className="mt-1 block text-[12px] text-content-muted">
                    Only if enabled
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="min-w-[260px] align-top">
                {row.purpose}
              </TableCell>
              <TableCell className="min-w-[220px] align-top">{row.data}</TableCell>
              <TableCell className="min-w-[220px] align-top">
                {row.location}
                <span className="mt-1 block text-[12px] text-content-muted">
                  {row.transfer}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    heading: "1. Who we are, and the two relationships this policy covers",
    body: (
      <>
        <p>
          ClientTurn is a trading name of {COMPANY.registeredName} (company
          number {COMPANY.companyNumber}), registered office{" "}
          {COMPANY.registeredAddress}. We are the organisation responsible for
          this website and for the ClientTurn service.
        </p>
        <p>
          ClientTurn connects a business&rsquo;s Meta (Facebook and Instagram)
          lead ads to automated follow-up, deterministic qualification and
          booking. That means personal data reaches us in two very different
          ways, and our legal role is different in each:
        </p>
        <ul>
          <li>
            <strong>Our customers.</strong> The business owners and team members
            who hold a ClientTurn account. For their account, billing, security
            and support data we are the <strong>controller</strong>, and
            sections 3 to 5 and 9 to 14 tell you what we do with it.
          </li>
          <li>
            <strong>Our customers&rsquo; leads.</strong> The members of the
            public who submit a lead form to, or exchange messages with, one of
            our customers. For that data <strong>our customer is the
            controller</strong> and we are their <strong>processor</strong>,
            acting only on their documented instructions. Sections 6 to 8 and 15
            explain that arrangement.
          </li>
        </ul>
        <p>
          <strong>If you enquired with a business and want your data removed,
          contact that business first</strong> — they decide, not us. If you
          cannot identify or reach them, write to{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a> with
          the phone number or email address you used and we will identify the
          controller, pass the request on within 3 Working Days, and tell you who
          they are. We can also suppress your number across the platform so you
          are not contacted again, and we will do that on request.
        </p>
        <p>
          We have not appointed a Data Protection Officer, because we are not
          required to under Article 37 UK GDPR. Responsibility for data
          protection sits with the directors, reachable at{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>.
        </p>
        {COMPANY.icoRegistration ? (
          <p>
            We are registered with the Information Commissioner&rsquo;s Office
            under registration number {COMPANY.icoRegistration}.
          </p>
        ) : (
          <p>
            We pay the data protection fee to the Information
            Commissioner&rsquo;s Office as a UK controller. Our registration
            number will be published in this section as soon as the entry appears
            on the public register.
          </p>
        )}
      </>
    ),
  },
  {
    id: "scope",
    heading: "2. What this policy covers",
    body: (
      <>
        <p>This policy applies to:</p>
        <ul>
          <li>the clientturn.com marketing site;</li>
          <li>the ClientTurn application and its APIs and background jobs;</li>
          <li>
            email, SMS and WhatsApp messages sent or received through the
            service;
          </li>
          <li>our support and billing correspondence.</li>
        </ul>
        <p>
          It does not cover the websites, adverts or systems of our customers, or
          the third-party platforms you connect. Those are governed by their own
          privacy notices.
        </p>
      </>
    ),
  },
  {
    id: "account-data",
    heading: "3. The data we hold about account holders",
    body: (
      <>
        <ul>
          <li>
            <strong>Identity and contact.</strong> Name, work email address,
            business name and address, phone number, and the role assigned to you
            in your workspace.
          </li>
          <li>
            <strong>Authentication and security.</strong> Hashed credentials,
            session records, IP address and user agent for sign-in events,
            multi-factor enrolment status, and security events such as failed
            sign-ins and password changes.
          </li>
          <li>
            <strong>Billing.</strong> Plan, subscription status, invoices,
            payment references, VAT status and billing address. Card numbers are
            entered into fields hosted by Stripe and never reach our servers; we
            hold only a token and the last four digits.
          </li>
          <li>
            <strong>Configuration.</strong> Your message templates, qualification
            questions, sending schedules, quiet hours, suppression lists and
            integration settings.
          </li>
          <li>
            <strong>Integration credentials.</strong> Access and refresh tokens
            for the platforms you connect. These are held server-side only,
            encrypted, and are never returned to a browser.
          </li>
          <li>
            <strong>Usage and diagnostics.</strong> Audit log entries for actions
            taken in the product, feature usage counts, and error diagnostics.
          </li>
          <li>
            <strong>Correspondence.</strong> Anything you send us by email, and
            our replies.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "lawful-basis",
    heading: "4. Why we use it, and our lawful basis",
    body: (
      <div className="-mx-1 overflow-x-auto rounded-xl border border-line">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Purpose</TableHead>
              <TableHead>Data used</TableHead>
              <TableHead>Lawful basis</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="min-w-[200px] align-top">
                Creating your account and providing the service you bought
              </TableCell>
              <TableCell className="min-w-[200px] align-top">
                Identity, contact, authentication, configuration
              </TableCell>
              <TableCell className="min-w-[200px] align-top">
                Article 6(1)(b) — performance of a contract
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="align-top">
                Taking payment and managing subscriptions
              </TableCell>
              <TableCell className="align-top">Billing data</TableCell>
              <TableCell className="align-top">
                Article 6(1)(b) — contract
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="align-top">
                Keeping accounting and tax records
              </TableCell>
              <TableCell className="align-top">
                Invoices and transaction records
              </TableCell>
              <TableCell className="align-top">
                Article 6(1)(c) — legal obligation (Companies Act 2006, VAT Act
                1994)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="align-top">
                Securing the platform, detecting abuse, investigating incidents
              </TableCell>
              <TableCell className="align-top">
                Security events, IP address, audit logs
              </TableCell>
              <TableCell className="align-top">
                Article 6(1)(f) — legitimate interests in protecting the service
                and our customers
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="align-top">
                Support, service messages and fixing faults
              </TableCell>
              <TableCell className="align-top">
                Contact details, correspondence, diagnostics
              </TableCell>
              <TableCell className="align-top">
                Article 6(1)(b) — contract; Article 6(1)(f) — running a
                supported service
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="align-top">
                Improving the product using aggregated usage patterns
              </TableCell>
              <TableCell className="align-top">
                Feature usage counts, aggregated statistics
              </TableCell>
              <TableCell className="align-top">
                Article 6(1)(f) — legitimate interests in improving a service our
                customers pay for
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="align-top">
                Marketing our own service to business contacts
              </TableCell>
              <TableCell className="align-top">
                Business name and work email address
              </TableCell>
              <TableCell className="align-top">
                Article 6(1)(f) with PECR regulation 22 soft opt-in, or consent.
                Every message carries a one-click unsubscribe.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="align-top">
                Establishing, exercising or defending legal claims
              </TableCell>
              <TableCell className="align-top">
                Whatever is relevant to the claim
              </TableCell>
              <TableCell className="align-top">
                Article 6(1)(f) — legitimate interests in defending our position
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    ),
  },
  {
    id: "legitimate-interests",
    heading: "5. Our legitimate interests assessment, in short",
    body: (
      <>
        <p>
          Where we rely on legitimate interests we have balanced our interest
          against your rights. In each case the processing is what a person would
          reasonably expect from a business software provider, the data is
          limited to what the purpose needs, it is never used to build a profile
          of you, it is never sold, and you can object at any time under section
          13.
        </p>
        <p>
          You can ask for a copy of the balancing test for any of these purposes
          by writing to{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>.
        </p>
      </>
    ),
  },
  {
    id: "lead-data",
    heading: "6. Data we process on behalf of our customers",
    body: (
      <>
        <p>
          When a customer connects Meta, we receive the fields that
          customer&rsquo;s lead form collects — typically a name, phone number,
          email address and the answers to the form&rsquo;s own questions —
          together with the campaign, ad set, ad and form the lead came from. A
          customer may also import contacts by CSV or add them manually.
        </p>
        <p>We then process, strictly on that customer&rsquo;s instruction:</p>
        <ul>
          <li>
            the messages sent and received, including their content, delivery
            status and timing;
          </li>
          <li>
            the answers given to the customer&rsquo;s qualification questions,
            and the outcome those answers produced under the customer&rsquo;s own
            rules;
          </li>
          <li>
            opt-out and do-not-contact records, kept specifically so that a
            person is not messaged again;
          </li>
          <li>
            booking records, where the customer has connected a calendar or
            booking provider;
          </li>
          <li>
            attribution data linking a lead back to the advert that produced it.
          </li>
        </ul>
        <p>
          <strong>What we never do with it.</strong> We do not sell it. We do not
          use it to advertise to the people it describes. We do not use one
          customer&rsquo;s lead data to benefit another customer. We do not use
          it to train any machine learning model, and our AI provider is
          contractually barred from doing so. We do not enrich it from external
          data brokers.
        </p>
        <p>
          <strong>Special category data.</strong> The service is not designed for
          it and customers are contractually prohibited from putting it in. Where
          a lead volunteers such information in a free-text reply, we hold it only
          as part of the message and apply the same security and retention rules.
        </p>
      </>
    ),
  },
  {
    id: "processing-terms",
    heading: "7. Our Article 28 processing terms",
    body: (
      <>
        <p>
          This section, together with the{" "}
          <a href="/terms">Terms of Service</a>, is the written contract required
          by Article 28(3) UK GDPR between a customer as controller and us as
          processor. A separate signed data processing agreement is available on
          request from{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>.
        </p>
        <ul>
          <li>
            <strong>Subject matter and duration.</strong> Provision of the
            ClientTurn service for the duration of the customer&rsquo;s
            subscription, plus the exit period in the Terms.
          </li>
          <li>
            <strong>Nature and purpose.</strong> Receiving, storing, organising,
            transmitting, analysing and erasing lead and message data in order to
            deliver automated follow-up, qualification, booking and reporting.
          </li>
          <li>
            <strong>Types of personal data.</strong> Name, phone number, email
            address, postcode or service area, lead form answers, message
            content, qualification answers, booking details, and campaign
            attribution identifiers.
          </li>
          <li>
            <strong>Categories of data subject.</strong> The customer&rsquo;s
            prospective and existing clients, and the customer&rsquo;s own staff
            users.
          </li>
          <li>
            <strong>Documented instructions.</strong> We process only on the
            customer&rsquo;s documented instructions, which are given through the
            configuration in the product and these terms, unless required
            otherwise by law — in which case we tell the customer first unless the
            law prohibits it.
          </li>
          <li>
            <strong>Confidentiality.</strong> Everyone we authorise to process
            the data is bound by a duty of confidence.
          </li>
          <li>
            <strong>Security.</strong> We implement the measures in section 11,
            appropriate under Article 32.
          </li>
          <li>
            <strong>Sub-processing.</strong> Governed by section 8. General
            written authorisation is given by the customer on acceptance of the
            Terms, subject to the notice and objection right in that section.
          </li>
          <li>
            <strong>Data subject rights.</strong> We assist the customer by
            appropriate technical and organisational measures — search, export
            and deletion tools in the product — and by responding to reasonable
            requests for help.
          </li>
          <li>
            <strong>Articles 32 to 36.</strong> We assist the customer with
            security, breach notification and data protection impact assessments,
            taking into account the nature of the processing and the information
            available to us.
          </li>
          <li>
            <strong>Deletion or return.</strong> On termination we delete or
            return the data as set out in section 10 and in the Terms.
          </li>
          <li>
            <strong>Audit.</strong> We make available the information needed to
            demonstrate compliance and allow for audits, including inspections,
            by the customer or an auditor it mandates, on reasonable notice, no
            more than once in any 12 months except after a personal data breach,
            and subject to confidentiality and to not compromising other
            customers.
          </li>
          <li>
            <strong>Breach notification.</strong> We notify the customer without
            undue delay, and in any event within 24 hours, of becoming aware of a
            personal data breach affecting their data, with the information
            available at that point and updates as we get them.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "subprocessors",
    heading: "8. Our sub-processors",
    body: (
      <>
        <p>
          We use a small, deliberately short list of providers to run the
          service. Each is engaged under a written contract imposing terms no
          less protective than these, each may act only on our instructions, and
          we remain fully liable to our customers for what they do.
        </p>
        <p>
          <strong>Core sub-processors</strong> — engaged for every workspace:
        </p>
        <SubProcessorTable rows={CORE_SUBPROCESSORS} />
        <p>
          <strong>Customer-enabled providers</strong> — these receive data only
          if the customer connects the integration or turns the feature on. When
          a customer connects one, that is an instruction from the customer as
          controller to disclose data to it:
        </p>
        <SubProcessorTable rows={CUSTOMER_ENABLED_SUBPROCESSORS} />
        <p>
          The register above is also published on its own at{" "}
          <a href="/sub-processors">clientturn.com/sub-processors</a>, with a
          change log. We give customers at least{" "}
          <strong>{SUBPROCESSOR_NOTICE_DAYS} days&rsquo; notice</strong> by email
          before a new sub-processor begins processing their data. A customer may
          object on reasonable data-protection grounds; if we cannot resolve the
          objection, the customer may terminate the affected part of the service
          and receive a pro-rata refund.
        </p>
        <p>
          Separately from sub-processing, we may disclose personal data to our
          professional advisers, insurers, auditors, a law enforcement body or
          regulator where legally required, and to a purchaser in connection with
          a sale of the business — in which case the purchaser is bound by this
          policy until it lawfully changes it with notice.
        </p>
      </>
    ),
  },
  {
    id: "transfers",
    heading: "9. Where data is stored and international transfers",
    body: (
      <>
        <p>
          Our primary database, in which all account, lead, message and
          qualification data is held at rest, is hosted in{" "}
          <strong>London, United Kingdom</strong>.
        </p>
        <p>
          Some providers we rely on process data outside the UK, as set out in
          section 8. Where a restricted transfer takes place we rely on:
        </p>
        <ul>
          <li>
            <strong>UK adequacy regulations</strong> for transfers to the
            European Economic Area;
          </li>
          <li>
            the <strong>International Data Transfer Addendum</strong> to the EU
            Standard Contractual Clauses, or the UK International Data Transfer
            Agreement, for transfers elsewhere;
          </li>
          <li>
            in each case supported by a transfer risk assessment and by
            supplementary measures — encryption in transit and at rest, access
            control, and data minimisation.
          </li>
        </ul>
        <p>
          You can request a copy of the relevant transfer mechanism, with
          commercial terms redacted, from{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    heading: "10. How long we keep data",
    body: (
      <>
        <p>
          We keep personal data no longer than necessary. Where a customer
          deletes a record, it is removed from the live system immediately and
          from encrypted backups as those backups expire.
        </p>
        <div className="-mx-1 overflow-x-auto rounded-xl border border-line">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Category</TableHead>
                <TableHead>Retention</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {RETENTION.map((row) => (
                <TableRow key={row.category}>
                  <TableCell className="min-w-[220px] align-top font-medium">
                    {row.category}
                  </TableCell>
                  <TableCell className="min-w-[180px] align-top">
                    {row.period}
                  </TableCell>
                  <TableCell className="min-w-[260px] align-top">
                    {row.reason}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    ),
  },
  {
    id: "security",
    heading: "11. Security",
    body: (
      <>
        <ul>
          <li>
            <strong>Encryption.</strong> Data is encrypted in transit with TLS
            and at rest by the storage platform.
          </li>
          <li>
            <strong>Tenant isolation.</strong> Every tenant table carries a
            workspace identifier and is protected by database row-level security,
            so one workspace physically cannot read another&rsquo;s records, even
            if application code is wrong.
          </li>
          <li>
            <strong>Secret handling.</strong> Service-role keys, provider tokens
            and webhook secrets are server-side only. They are never placed in a
            client bundle, never exposed through a public environment variable,
            and never returned in a response body.
          </li>
          <li>
            <strong>Webhook integrity.</strong> Every inbound webhook signature
            is verified before the payload is trusted, and events are
            deduplicated so a replayed event cannot cause a second action.
          </li>
          <li>
            <strong>Access control.</strong> Role-based access within a
            workspace; administrative access to the platform is restricted to
            named individuals, requires step-up authentication, and is written to
            an audit log.
          </li>
          <li>
            <strong>Least privilege and review.</strong> Access is granted on a
            need-to-know basis and reviewed when someone changes role or leaves.
          </li>
          <li>
            <strong>Backups.</strong> Encrypted, taken continuously, and
            restore-tested.
          </li>
          <li>
            <strong>Change control.</strong> Changes are reviewed before release,
            and dependencies are monitored for known vulnerabilities.
          </li>
        </ul>
        <p>
          No system is perfectly secure. If a personal data breach occurs we will
          notify the Information Commissioner&rsquo;s Office within 72 hours
          where the breach is likely to result in a risk to individuals, notify
          affected customers without undue delay and within 24 hours of becoming
          aware where their data is involved, and notify affected individuals
          directly where the risk to them is high.
        </p>
      </>
    ),
  },
  {
    id: "responsibilities",
    heading: "12. What our customers are responsible for",
    body: (
      <>
        <p>
          If you use ClientTurn to contact people, you are the controller for
          that contact and the sender of every message. You are responsible for:
        </p>
        <ul>
          <li>
            having a lawful basis under the UK GDPR and satisfying PECR
            regulation 22 for every message, including any reactivation of older
            leads — the age of a lead does not by itself make contacting them
            lawful;
          </li>
          <li>
            the wording of your messages, including identifying yourself and
            including a clear, working, free opt-out in every direct-marketing
            message;
          </li>
          <li>
            giving the people who contact you the privacy information Articles 13
            and 14 require, at the point you collect their data;
          </li>
          <li>
            responding to requests those people make about their own data, within
            one month;
          </li>
          <li>
            keeping your own record of consent where you rely on it, and
            screening against the Telephone Preference Service where relevant;
          </li>
          <li>
            not putting special category data, criminal offence data, payment card
            data or children&rsquo;s data into the service.
          </li>
        </ul>
        <p>
          The product enforces opt-outs, quiet hours and attempt limits, and
          re-checks them immediately before every send. Those controls are a
          safeguard, not a legal opinion. They do not decide whether your
          campaign is lawful. That judgement is yours.
        </p>
      </>
    ),
  },
  {
    id: "your-rights",
    heading: "13. Your rights",
    body: (
      <>
        <p>Under the UK GDPR you have the right to:</p>
        <ul>
          <li>
            <strong>be informed</strong> — which is what this policy is for;
          </li>
          <li>
            <strong>access</strong> a copy of your personal data;
          </li>
          <li>
            <strong>rectification</strong> of data that is inaccurate or
            incomplete;
          </li>
          <li>
            <strong>erasure</strong>, where the data is no longer needed, consent
            is withdrawn, or you object and there is no overriding ground;
          </li>
          <li>
            <strong>restriction</strong> of processing while a dispute about
            accuracy or legitimate interests is resolved;
          </li>
          <li>
            <strong>data portability</strong> for data you gave us that we
            process by automated means on the basis of contract or consent;
          </li>
          <li>
            <strong>object</strong> to processing based on legitimate interests,
            and an absolute right to object to direct marketing;
          </li>
          <li>
            <strong>withdraw consent</strong> at any time where processing relies
            on it, without affecting processing before withdrawal;
          </li>
          <li>
            not be subject to a decision based solely on automated processing
            producing legal or similarly significant effects. We do not make such
            decisions.
          </li>
        </ul>
        <p>
          To exercise a right against us as controller, email{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>. We
          respond within <strong>one month</strong>, extendable by two further
          months for complex requests, and we will tell you if we extend. We will
          ask for enough information to be satisfied of your identity, and we do
          not charge a fee unless a request is manifestly unfounded or excessive.
        </p>
        <p>
          If your data is held in a customer&rsquo;s workspace, we will pass your
          request to that customer as controller and assist them, as described in
          section 1.
        </p>
        <p>
          You may complain to us first, and you may complain at any time to the{" "}
          <a
            href="https://ico.org.uk/make-a-complaint/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Information Commissioner&rsquo;s Office
          </a>{" "}
          — Wycliffe House, Water Lane, Wilmslow, Cheshire SK9 5AF, telephone
          0303 123 1113.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    heading: "14. Cookies and similar technologies",
    body: (
      <p>
        Our use of cookies, <code>localStorage</code> and similar technologies is
        described in the <a href="/cookies">Cookie Policy</a>. Nothing beyond
        what is strictly necessary to deliver the service you requested is stored
        or read on your device until you have given consent, as PECR regulation 6
        requires.
      </p>
    ),
  },
  {
    id: "children",
    heading: "15. Children",
    body: (
      <p>
        ClientTurn is a business tool and is not directed at children. We do not
        knowingly collect data about anyone under 18, and customers are
        contractually prohibited from processing children&rsquo;s data through
        the service. If you believe a child&rsquo;s data has reached us, tell us
        at <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a> and
        we will act promptly.
      </p>
    ),
  },
  {
    id: "changes",
    heading: "16. Changes to this policy",
    body: (
      <>
        <p>
          We will update this policy when the service or the law changes. The
          version date is shown at the top of this page.
        </p>
        <p>
          Material changes — a new purpose, a new lawful basis, or a change that
          reduces your rights — are notified to account holders by email or in the
          product at least 30 days before they take effect. We keep previous
          versions and will provide one on request.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    heading: "17. How to contact us",
    body: (
      <>
        <p>
          Data protection, privacy requests and formal notices:{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>.
        </p>
        <p>
          Everything else, including account and technical support:{" "}
          <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.
        </p>
        <p>
          By post: {COMPANY.registeredName}, {COMPANY.registeredAddress}.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="What ClientTurn does with personal data — both the data of the businesses who hold an account, and the data of the leads those businesses contact through the product. This page also contains our Article 28 processing terms and our full sub-processor register."
      currentPath="/privacy"
      sections={SECTIONS}
    />
  );
}
