import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { COMPANY } from "@/lib/marketing/company";

const description =
  "How ClientTurn handles personal data for account holders and for the leads our customers process, under UK GDPR.";

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

const SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    heading: "1. Who we are and who this applies to",
    body: (
      <>
        <p>
          ClientTurn is a software service that connects a business&rsquo;s
          Meta (Facebook and Instagram) lead ads to automated follow-up,
          qualification and booking.
        </p>
        <p>This policy covers two different relationships:</p>
        <ul>
          <li>
            <strong>Our customers.</strong> The business owners and team members
            who hold a ClientTurn account. For their account data we are the{" "}
            <strong>controller</strong>.
          </li>
          <li>
            <strong>Our customers&rsquo; leads.</strong> The members of the
            public who submit a Meta lead form to one of our customers. For that
            data our customer is the <strong>controller</strong> and we are a{" "}
            <strong>processor</strong> acting on their instructions.
          </li>
        </ul>
        <p>
          If you submitted an enquiry to a business and want your data removed,
          contact that business first. If you cannot reach them, write to{" "}
          <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>{" "}
          and we will pass the request on and assist the controller.
        </p>
      </>
    ),
  },
  {
    id: "account-data",
    heading: "2. Data we hold about account holders",
    body: (
      <>
        <ul>
          <li>
            <strong>Identity and contact.</strong> Name, work email address,
            business name, phone number, and the role assigned to you in your
            workspace.
          </li>
          <li>
            <strong>Authentication.</strong> Hashed credentials, session
            records, and security events such as sign-in attempts and password
            changes.
          </li>
          <li>
            <strong>Billing.</strong> Plan, subscription status, invoices and
            payment references. Card details are handled by our payment
            processor and never reach our servers.
          </li>
          <li>
            <strong>Configuration.</strong> Your message templates,
            qualification questions, sending schedules, quiet hours and
            integration settings.
          </li>
          <li>
            <strong>Usage and support.</strong> Audit log entries for actions
            taken in the product, error diagnostics, and any correspondence you
            send us.
          </li>
        </ul>
        <p>
          Our lawful bases are <strong>contract</strong> (running the service
          you bought), <strong>legitimate interests</strong> (securing the
          service, preventing abuse, improving the product) and{" "}
          <strong>legal obligation</strong> (accounting and tax records).
        </p>
      </>
    ),
  },
  {
    id: "lead-data",
    heading: "3. Data we process on behalf of our customers",
    body: (
      <>
        <p>
          When a customer connects Meta, we receive the fields their lead form
          collects. Typically that is a name, phone number, email address and
          the answers to the form&rsquo;s questions, together with the campaign,
          ad set, ad and form the lead came from.
        </p>
        <p>We then process, on the customer&rsquo;s instruction:</p>
        <ul>
          <li>
            the messages sent and received, including delivery status and the
            time of each message;
          </li>
          <li>
            the answers given to the customer&rsquo;s qualification questions
            and the outcome those answers produced;
          </li>
          <li>
            opt-out and do-not-contact records, which we keep for as long as
            necessary specifically so that a contact is not messaged again;
          </li>
          <li>booking records where a booking integration is connected.</li>
        </ul>
        <p>
          We do not sell this data, do not use it to advertise to the people it
          describes, and do not use one customer&rsquo;s lead data to benefit
          another customer.
        </p>
      </>
    ),
  },
  {
    id: "responsibilities",
    heading: "4. Our customers' responsibilities",
    body: (
      <>
        <p>
          If you use ClientTurn to contact people, you are the controller for
          that contact. You are responsible for:
        </p>
        <ul>
          <li>
            having a lawful basis for the messages you send, including for any
            reactivation of older leads;
          </li>
          <li>
            the wording of your messages, including a clear and working opt-out
            in every direct-marketing message;
          </li>
          <li>
            giving the people who contact you the privacy information UK GDPR
            requires;
          </li>
          <li>
            responding to requests those people make about their own data.
          </li>
        </ul>
        <p>
          The product enforces opt-outs, quiet hours and attempt limits, but
          those controls do not decide whether your campaign is lawful. That
          judgement is yours.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    heading: "5. Who we share data with",
    body: (
      <>
        <p>
          We use a small number of sub-processors to run the service. Each is
          bound by a written contract and may only act on our instructions:
        </p>
        <ul>
          <li>cloud database, authentication and hosting providers;</li>
          <li>
            the SMS and WhatsApp providers used to deliver your messages;
          </li>
          <li>Meta, for receiving lead data from your connected lead forms;</li>
          <li>
            calendar and booking providers, where you have connected one;
          </li>
          <li>our payment processor and our transactional email provider;</li>
          <li>error monitoring and product analytics providers.</li>
        </ul>
        <p>
          A current list of sub-processors is available on request from{" "}
          <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>.
          We will tell customers before adding a sub-processor that materially
          changes how their data is handled.
        </p>
      </>
    ),
  },
  {
    id: "transfers",
    heading: "6. Where data is stored",
    body: (
      <>
        <p>
          Our primary database is hosted in the United Kingdom / European
          Economic Area. Some providers we rely on operate outside the UK. Where
          a transfer takes place, we rely on UK adequacy regulations or the UK
          International Data Transfer Addendum to the EU Standard Contractual
          Clauses.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    heading: "7. How long we keep data",
    body: (
      <>
        <ul>
          <li>
            <strong>Account data:</strong> for the life of the account, then up
            to 90 days after closure to allow recovery, then deleted.
          </li>
          <li>
            <strong>Lead and message data:</strong> for as long as the customer
            keeps it, or until they instruct deletion. On account closure it is
            deleted within 90 days unless the law requires otherwise.
          </li>
          <li>
            <strong>Opt-out records:</strong> retained after deletion of the
            rest of the record, because suppressing future contact requires
            keeping a minimal record of the suppression.
          </li>
          <li>
            <strong>Billing records:</strong> retained for six years to meet UK
            accounting requirements.
          </li>
          <li>
            <strong>Security and audit logs:</strong> typically 12 months.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "security",
    heading: "8. Security",
    body: (
      <>
        <ul>
          <li>Data is encrypted in transit and at rest.</li>
          <li>
            Every tenant table is protected by row-level security, so one
            workspace cannot read another&rsquo;s records.
          </li>
          <li>
            Provider tokens and secrets are held server-side only and are never
            returned to a browser.
          </li>
          <li>
            Administrative access is restricted, requires additional
            verification, and is written to an audit log.
          </li>
        </ul>
        <p>
          No system is perfectly secure. If a breach affects your data we will
          notify you and, where required, the Information Commissioner&rsquo;s
          Office without undue delay.
        </p>
      </>
    ),
  },
  {
    id: "your-rights",
    heading: "9. Your rights",
    body: (
      <>
        <p>Under UK GDPR you have the right to:</p>
        <ul>
          <li>be told how your data is used and get a copy of it;</li>
          <li>have inaccurate data corrected;</li>
          <li>have data erased in certain circumstances;</li>
          <li>restrict or object to processing;</li>
          <li>data portability;</li>
          <li>withdraw consent where processing relies on consent.</li>
        </ul>
        <p>
          To exercise a right against us as controller, email{" "}
          <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>.
          We respond within one month. You may also complain to the{" "}
          <a
            href="https://ico.org.uk/make-a-complaint/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Information Commissioner&rsquo;s Office
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    heading: "10. Cookies",
    body: (
      <p>
        Our use of cookies and similar technologies is described in the{" "}
        <a href="/cookies">Cookie Policy</a>. Non-essential cookies are only set
        after you accept them.
      </p>
    ),
  },
  {
    id: "changes",
    heading: "11. Changes and contact",
    body: (
      <>
        <p>
          We will update this policy when the service changes. Material changes
          are notified to account holders by email or in the product.
        </p>
        <p>
          Privacy enquiries:{" "}
          <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>.
          General support:{" "}
          <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="What ClientTurn does with personal data — both the data of the businesses who hold an account, and the data of the leads those businesses contact through the product."
      operatorNote="This policy is a working draft written to reflect how the product actually operates. It is not legal advice. Before launch, the operator must have it reviewed against UK GDPR and PECR by a qualified adviser, confirm the sub-processor list, and confirm the direct-marketing wording used in customer-facing message templates."
      sections={SECTIONS}
    />
  );
}
