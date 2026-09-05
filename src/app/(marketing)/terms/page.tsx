import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { COMPANY } from "@/lib/marketing/company";
import { TRIAL_DAYS } from "@/lib/billing/plans";

const description =
  "The terms on which UK businesses may use ClientTurn: subscriptions, acceptable use, messaging compliance, liability and cancellation.";

export const metadata: Metadata = {
  title: "Terms of Service",
  description,
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "Terms of Service · ClientTurn",
    description,
    url: "/terms",
    siteName: "ClientTurn",
    locale: "en_GB",
    type: "article",
  },
  twitter: {
    card: "summary",
    title: "Terms of Service · ClientTurn",
    description,
  },
};

const SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    heading: "1. The agreement",
    body: (
      <>
        <p>
          These terms govern your use of ClientTurn. By creating an account you
          accept them on behalf of the business you represent, and you confirm
          you are authorised to do so.
        </p>
        <p>
          ClientTurn is sold to businesses. It is not a consumer product, and
          consumer cancellation rights do not apply to a business subscription.
        </p>
      </>
    ),
  },
  {
    id: "service",
    heading: "2. What the service does",
    body: (
      <>
        <p>
          ClientTurn receives leads from the Meta lead forms you connect, sends
          the follow-up messages you configure, asks the qualification questions
          you configure, and passes qualified leads to a booking link or a named
          member of your team.
        </p>
        <p>
          The follow-up and qualification engines are deterministic: they apply
          the rules you set. Where an optional AI assist feature is enabled, it
          may only help interpret an inbound message or extract a value for a
          question you have already configured. It never composes a quote, a
          price, a promise of availability or a service-area commitment, and the
          deterministic rules always make the final decision.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    heading: "3. Accounts and access",
    body: (
      <>
        <ul>
          <li>
            You are responsible for the accuracy of your account details and for
            keeping credentials confidential.
          </li>
          <li>
            You are responsible for everything done under your workspace,
            including by users you invite.
          </li>
          <li>
            User and lead limits are set by your plan and are enforced by the
            service.
          </li>
          <li>
            Tell us promptly at{" "}
            <a href={`mailto:${COMPANY.supportEmail}`}>
              {COMPANY.supportEmail}
            </a>{" "}
            if you believe your account has been accessed without authorisation.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "trial-billing",
    heading: "4. Trial, fees and billing",
    body: (
      <>
        <ul>
          <li>
            The free trial runs for {TRIAL_DAYS} days and does not require a
            card. Trial workspaces carry reduced limits.
          </li>
          <li>
            Paid subscriptions renew automatically, monthly or annually
            depending on the term you choose, until cancelled.
          </li>
          <li>
            Prices shown on the site are in GBP and exclude VAT. VAT is applied
            where due.
          </li>
          <li>
            Charges from your SMS or WhatsApp provider are billed by that
            provider and are not included in your ClientTurn subscription.
          </li>
          <li>
            Fees paid are non-refundable except where the law requires
            otherwise. We may change prices with at least 30 days&rsquo; notice,
            effective at your next renewal.
          </li>
          <li>
            If payment fails we may suspend the service after notifying you and
            allowing a reasonable period to fix it.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "messaging",
    heading: "5. Messaging and marketing compliance",
    body: (
      <>
        <p>
          You are the sender of every message the service delivers on your
          behalf, and you are the data controller for the people you contact.
          You agree that:
        </p>
        <ul>
          <li>
            you have a lawful basis under UK GDPR and PECR for every message you
            send, including any reactivation of older leads;
          </li>
          <li>
            every direct-marketing message includes a valid opt-out and your
            identity as the sender;
          </li>
          <li>
            you will not use the service to send unsolicited bulk messages,
            content that misleads about who is contacting the recipient, or
            content that is unlawful, harassing or deceptive;
          </li>
          <li>
            you will honour opt-outs and will not attempt to circumvent the
            opt-out, quiet-hours or attempt-limit controls.
          </li>
        </ul>
        <p>
          You must also comply with the terms of the platforms you connect,
          including Meta&rsquo;s platform terms and your messaging
          provider&rsquo;s policies.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    heading: "6. Acceptable use",
    body: (
      <ul>
        <li>
          Do not attempt to access another workspace&rsquo;s data, probe our
          security controls, or interfere with the service.
        </li>
        <li>
          Do not resell, sublicense or provide the service to a third party as
          your own product without a written agreement with us.
        </li>
        <li>
          Do not upload contact lists you have no lawful basis to contact.
        </li>
        <li>
          Do not use the service to process special category data, payment card
          data, or data about children.
        </li>
      </ul>
    ),
  },
  {
    id: "your-data",
    heading: "7. Your data",
    body: (
      <>
        <p>
          You retain ownership of the leads, messages, configuration and content
          in your workspace. You grant us the limited licence needed to host and
          process it in order to provide the service.
        </p>
        <p>
          We process personal data as described in the{" "}
          <a href="/privacy">Privacy Policy</a>. Enterprise customers may
          request a signed data processing agreement.
        </p>
      </>
    ),
  },
  {
    id: "integrations",
    heading: "8. Third-party integrations",
    body: (
      <p>
        The service depends on providers we do not control, including Meta, your
        SMS or WhatsApp provider, and your calendar or booking provider. If one
        of them changes, restricts or withdraws access, or is unavailable, parts
        of the service may not function. We will make reasonable efforts to
        restore or replace the affected capability but cannot guarantee
        continued availability of a third party&rsquo;s platform.
      </p>
    ),
  },
  {
    id: "availability",
    heading: "9. Availability and support",
    body: (
      <p>
        We aim to keep the service available and to carry out planned
        maintenance outside UK business hours where practical. We do not offer a
        contractual uptime commitment on self-serve plans. Support is provided
        by email at{" "}
        <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>{" "}
        during UK business hours.
      </p>
    ),
  },
  {
    id: "no-guarantee",
    heading: "10. No guarantee of results",
    body: (
      <p>
        ClientTurn automates response speed, follow-up and qualification. It
        does not guarantee any number of replies, qualified leads, bookings, won
        jobs or revenue. Any figures shown on this website are illustrative
        product demonstrations, not customer results and not a forecast of your
        performance.
      </p>
    ),
  },
  {
    id: "liability",
    heading: "11. Liability",
    body: (
      <>
        <p>
          Nothing in these terms limits liability for death or personal injury
          caused by negligence, for fraud, or for anything else that cannot
          lawfully be limited.
        </p>
        <p>
          Subject to that, neither party is liable for loss of profit, loss of
          business, loss of goodwill or indirect or consequential loss. Our
          total liability in any 12-month period is limited to the fees you paid
          us in that period.
        </p>
        <p>
          You will indemnify us against claims arising from messages you sent
          through the service in breach of section 5 or section 6.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    heading: "12. Cancellation, suspension and termination",
    body: (
      <ul>
        <li>
          You may cancel a self-serve subscription at any time from your billing
          settings. Access continues to the end of the period you have paid for.
        </li>
        <li>
          We may suspend the service immediately where use of it is unlawful,
          creates a security risk, or breaches section 5 or 6.
        </li>
        <li>
          We may terminate for material breach that is not remedied within 14
          days of written notice.
        </li>
        <li>
          After termination you may export your data for 30 days. It is then
          deleted in line with the retention periods in the Privacy Policy.
        </li>
      </ul>
    ),
  },
  {
    id: "general",
    heading: "13. Changes, law and contact",
    body: (
      <>
        <p>
          We may update these terms. Material changes are notified at least 30
          days before they take effect, and continuing to use the service after
          that date means you accept them.
        </p>
        <p>
          These terms are governed by the laws of England and Wales, and the
          courts of England and Wales have exclusive jurisdiction.
        </p>
        <p>
          Questions:{" "}
          <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="The agreement between ClientTurn and the business using it. Please read section 5 carefully — you are the sender of every message the service delivers on your behalf."
      operatorNote="These terms are a working draft that reflects how the product operates. They are not legal advice and no legal certainty is claimed. Before launch the operator must have them reviewed by a qualified adviser, insert the registered company details, and confirm the direct-marketing and opt-out wording used in production message templates against UK GDPR and PECR."
      sections={SECTIONS}
    />
  );
}
