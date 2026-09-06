import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { COMPANY } from "@/lib/marketing/company";
import { TRIAL_DAYS } from "@/lib/billing/plans";

const description =
  "The contract between Blackwellen Limited and the business using ClientTurn: subscriptions, the 14-day free trial, fees and VAT, refunds and cancellation, messaging compliance, liability and termination. Governed by the law of England and Wales.";

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
    id: "parties",
    heading: "1. These terms and the parties to them",
    body: (
      <>
        <p>
          <strong>1.1</strong> These terms of service (the{" "}
          <strong>&ldquo;Terms&rdquo;</strong>) set out the contract between{" "}
          <strong>{COMPANY.registeredName}</strong>, a company registered in{" "}
          {COMPANY.jurisdiction} under number {COMPANY.companyNumber} whose
          registered office is at {COMPANY.registeredAddress} (
          <strong>&ldquo;we&rdquo;</strong>,{" "}
          <strong>&ldquo;us&rdquo;</strong>,{" "}
          <strong>&ldquo;our&rdquo;</strong>), and the person or organisation
          that opens a ClientTurn account (<strong>&ldquo;you&rdquo;</strong>,{" "}
          <strong>&ldquo;your&rdquo;</strong>, the{" "}
          <strong>&ldquo;Customer&rdquo;</strong>).
        </p>
        <p>
          <strong>1.2</strong> ClientTurn is a trading name of{" "}
          {COMPANY.registeredName}. It is not a separate legal person. Every
          right and obligation described on this site is a right or obligation
          of {COMPANY.registeredName}.
        </p>
        <p>
          <strong>1.3</strong> These Terms, together with the{" "}
          <a href="/privacy">Privacy Policy</a>, the{" "}
          <a href="/cookies">Cookie Policy</a>, the{" "}
          <a href="/sub-processors">sub-processor register</a>, the plan and
          price details shown at checkout, and any order form we both sign,
          form the entire agreement between us (the{" "}
          <strong>&ldquo;Agreement&rdquo;</strong>).
        </p>
        <p>
          <strong>1.4</strong> If you accept these Terms on behalf of a company,
          partnership, charity or other organisation, you warrant that you have
          authority to bind it, and &ldquo;you&rdquo; means that organisation.
        </p>
        <p>
          <strong>1.5</strong> ClientTurn is designed and sold for use by
          businesses. If you are a sole trader or an individual and you are
          buying wholly or mainly for purposes outside your trade, business,
          craft or profession, you are a <strong>consumer</strong> and the
          additional statutory protections in clause 9 and clause 20.6 apply to
          you. Nothing in these Terms removes a right you have as a consumer
          which cannot lawfully be excluded.
        </p>
      </>
    ),
  },
  {
    id: "definitions",
    heading: "2. Definitions",
    body: (
      <>
        <ul>
          <li>
            <strong>Customer Data</strong> — all data you submit to, or that is
            generated in, your Workspace: leads, contact details, messages,
            qualification answers, bookings, configuration and uploaded files.
          </li>
          <li>
            <strong>Lead</strong> — an individual whose details enter your
            Workspace, whether from a connected Meta lead form, an import, an
            integration or manual entry.
          </li>
          <li>
            <strong>Workspace</strong> — the tenant in which your account, users
            and Customer Data live. Data in a Workspace is isolated from every
            other Workspace by database row-level security.
          </li>
          <li>
            <strong>Service</strong> — the ClientTurn software made available at
            clientturn.com and any associated APIs, jobs and integrations.
          </li>
          <li>
            <strong>Plan</strong> — the subscription tier you select, and the
            limits and features it carries as described on the pricing page at
            the time you subscribe.
          </li>
          <li>
            <strong>Subscription Term</strong> — the monthly or annual period
            you have paid for, beginning on the day your first payment is taken
            and renewing automatically under clause 10.
          </li>
          <li>
            <strong>Data Protection Legislation</strong> — the UK GDPR, the Data
            Protection Act 2018, the Privacy and Electronic Communications (EC
            Directive) Regulations 2003 (<strong>PECR</strong>), and any
            successor or replacement legislation.
          </li>
          <li>
            <strong>Working Day</strong> — a day other than a Saturday, Sunday or
            public holiday in England and Wales.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "formation",
    heading: "3. How the contract is formed",
    body: (
      <>
        <p>
          <strong>3.1</strong> The pricing shown on this site is an invitation to
          treat, not an offer. Your submission of a sign-up or checkout form is
          an offer to contract on these Terms.
        </p>
        <p>
          <strong>3.2</strong> The contract is formed when we confirm your
          account by email or make the Workspace available to you, whichever
          happens first. We are not obliged to accept any application and may
          decline one without giving reasons.
        </p>
        <p>
          <strong>3.3</strong> Before you place an order the checkout shows the
          Plan, the price, the billing frequency, whether VAT applies, and the
          renewal behaviour. Pressing the confirmation button places an order
          that carries an obligation to pay. You can correct input errors by
          returning to the previous step of the checkout before confirming.
        </p>
        <p>
          <strong>3.4</strong> We file a record of the concluded contract in your
          billing history, which you can access at any time from your account. The
          contract is concluded in English.
        </p>
        <p>
          <strong>3.5</strong> Any terms you seek to impose — including terms
          printed on a purchase order or in your own supplier conditions — have
          no effect and are excluded, unless we accept them in a document signed
          by a director of {COMPANY.registeredName}.
        </p>
      </>
    ),
  },
  {
    id: "service",
    heading: "4. What the Service does",
    body: (
      <>
        <p>
          <strong>4.1</strong> The Service receives leads from the sources you
          connect, sends the follow-up messages you configure, asks the
          qualification questions you configure, applies the rules you set, and
          hands qualified leads to a booking link or to a named member of your
          team. It also reports on what happened.
        </p>
        <p>
          <strong>4.2</strong> The follow-up and qualification engines are{" "}
          <strong>deterministic</strong>. They execute the rules you configure.
          They are the system of record for every decision the Service makes.
        </p>
        <p>
          <strong>4.3</strong> Where the optional AI assist feature is enabled on
          your Workspace, it may only (a) classify the intent of an inbound
          message, and (b) extract a candidate value for a question you have
          already configured. It never composes a price, a quote, a promise of
          availability, a service-area commitment or any other binding
          statement, and the deterministic rules always make the final decision.
          Where confidence is low or a value cannot be matched, the lead is
          marked for human review rather than progressed. AI assist is off by
          default and is gated by Plan.
        </p>
        <p>
          <strong>4.4</strong> The Service does not make any decision that
          produces a legal or similarly significant effect on a Lead within the
          meaning of Article 22 UK GDPR. Qualification outcomes route work to
          you; they do not determine whether a Lead receives a service.
        </p>
        <p>
          <strong>4.5</strong> We may improve, change or replace parts of the
          Service. We will not make a change that materially reduces the core
          functionality of your Plan during a Subscription Term without giving
          you at least 30 days&rsquo; notice and, if the change materially
          disadvantages you, the right to terminate under clause 22.3.
        </p>
      </>
    ),
  },
  {
    id: "trial",
    heading: `5. The ${TRIAL_DAYS}-day free trial`,
    body: (
      <>
        <p>
          <strong>5.1</strong> New Workspaces receive a free trial of{" "}
          <strong>{TRIAL_DAYS} days</strong>, beginning on the day the Workspace
          is created.
        </p>
        <p>
          <strong>5.2</strong> No payment card is required to start the trial. We
          will not take any payment during the trial, and the trial does not
          convert automatically into a paid subscription. A paid subscription
          begins only when you actively choose a Plan and complete checkout.
        </p>
        <p>
          <strong>5.3</strong> Trial Workspaces carry reduced limits, and some
          features are unavailable. Third-party charges — in particular SMS and
          WhatsApp charges billed by your messaging provider — are payable by you
          during the trial in the ordinary way, because they are not our charges.
        </p>
        <p>
          <strong>5.4</strong> One free trial is available per business. Creating
          additional Workspaces to obtain repeated trials is a breach of clause
          13.
        </p>
        <p>
          <strong>5.5</strong> At the end of the trial, sending stops and the
          Workspace becomes read-only. Your Customer Data remains available for
          export for 30 days, after which it is deleted in line with the{" "}
          <a href="/privacy">Privacy Policy</a>. You may subscribe at any point
          during that window and resume where you left off.
        </p>
        <p>
          <strong>5.6</strong> The Service is provided during a free trial{" "}
          &ldquo;as is&rdquo;, and clause 20.4 applies. Nothing in this clause
          affects your statutory rights.
        </p>
      </>
    ),
  },
  {
    id: "plans",
    heading: "6. Plans, limits and fair use",
    body: (
      <>
        <p>
          <strong>6.1</strong> Each Plan carries a monthly lead allowance, a user
          limit, an included allowance of outbound UK SMS segments, a
          reactivation contact limit, and a defined feature set. The limits
          applicable to your Plan are shown on the pricing page and in your
          billing settings, and are enforced by the Service.
        </p>
        <p>
          <strong>6.2</strong> Limits are enforced server-side. Where you reach a
          limit, the Service will tell you, will stop the activity that would
          exceed it, and will offer an upgrade. We do not silently exceed a limit
          and invoice you for it.
        </p>
        <p>
          <strong>6.3</strong> You may upgrade at any time; the new Plan takes
          effect immediately and we charge the difference pro rata for the
          remainder of the current Subscription Term. You may downgrade with
          effect from your next renewal date; downgrades do not attract a refund
          for the current Term.
        </p>
        <p>
          <strong>6.4</strong> Included allowances are for your own business use.
          They may not be pooled across unrelated businesses, resold, or used to
          provide a messaging service to a third party. Where use is so far
          outside normal use of the Plan that it materially degrades the Service
          for other customers, we may contact you to agree a suitable Plan and,
          failing agreement, apply clause 22.2.
        </p>
      </>
    ),
  },
  {
    id: "fees",
    heading: "7. Charges, VAT and payment",
    body: (
      <>
        <p>
          <strong>7.1 Currency and tax.</strong> All prices are in pounds
          sterling (GBP). Prices shown on the site are exclusive of value added
          tax. Where {COMPANY.registeredName} is registered for VAT, VAT will be
          charged at the prevailing rate and shown separately on your invoice.
          Where you are a business established outside the United Kingdom, tax
          will be handled in accordance with the applicable place-of-supply
          rules, and where the reverse charge applies you are responsible for
          accounting for the tax in your own jurisdiction. You must give us a
          valid VAT registration number if you wish to be treated as a business
          for these purposes.
        </p>
        <p>
          <strong>7.2 Payment method.</strong> Card payments are processed by
          Stripe Payments Europe, Limited, which is regulated in Ireland by the
          Central Bank of Ireland, and its group companies. Card details are
          entered into fields hosted by Stripe and are never transmitted to, or
          stored on, our servers. By subscribing you authorise us, through
          Stripe, to charge your chosen payment method for the recurring fees
          until the subscription is cancelled.
        </p>
        <p>
          <strong>7.3 Strong customer authentication.</strong> Your payment may
          require additional authentication from your bank under the Payment
          Services Regulations 2017. Where authentication is required and not
          completed, the payment will fail and clause 7.6 applies.
        </p>
        <p>
          <strong>7.4 Billing cycle.</strong> Monthly subscriptions are charged
          in advance on the same day each month. Annual subscriptions are charged
          in advance for twelve months. Where a month has no corresponding day,
          the charge falls on the last day of that month.
        </p>
        <p>
          <strong>7.5 Third-party charges.</strong> Charges raised by your SMS,
          WhatsApp, calendar, CRM or advertising providers are billed by those
          providers directly to you under your own contract with them. They are
          not included in your ClientTurn subscription, we do not collect them,
          and we are not liable for them. Where your Plan includes an SMS segment
          allowance, that allowance applies only to segments sent through
          messaging capacity we provide, and is stated in your Plan.
        </p>
        <p>
          <strong>7.6 Failed payment.</strong> If a payment fails we will notify
          you and retry over a period of not less than seven days. If the payment
          remains outstanding we may suspend the Service under clause 22.2. We
          will restore the Service promptly once payment is received.
        </p>
        <p>
          <strong>7.7 Late payment (business customers).</strong> Where you are
          not a consumer, we may charge statutory interest and compensation on
          overdue sums under the Late Payment of Commercial Debts (Interest) Act
          1998 — currently 8% above the Bank of England base rate, accruing daily
          from the due date until payment. We may also recover our reasonable
          costs of recovering the debt.
        </p>
        <p>
          <strong>7.8 Set-off.</strong> Where you are not a consumer, you must
          pay all sums due in full without set-off, counterclaim, deduction or
          withholding, except a deduction required by law.
        </p>
        <p>
          <strong>7.9 Regulatory status.</strong> We are not authorised or
          regulated by the Financial Conduct Authority. We do not provide credit,
          payment services, investment services, insurance mediation or any other
          regulated financial activity, and nothing in the Service constitutes
          financial, legal, tax or accounting advice. Any figures the Service
          reports are operational metrics drawn from your own data and are not
          audited or certified financial information.
        </p>
      </>
    ),
  },
  {
    id: "price-changes",
    heading: "8. Price changes",
    body: (
      <>
        <p>
          <strong>8.1</strong> We may change our prices. We will give you at
          least <strong>30 days&rsquo; notice</strong> by email before a change
          takes effect.
        </p>
        <p>
          <strong>8.2</strong> A price change never applies to a Subscription
          Term you have already paid for. It takes effect from your next renewal
          date.
        </p>
        <p>
          <strong>8.3</strong> If you do not accept a price increase, you may
          cancel under clause 9 before the renewal date and no further payment
          will be taken.
        </p>
      </>
    ),
  },
  {
    id: "refunds",
    heading: "9. Cancellation and refunds",
    body: (
      <>
        <p>
          <strong>9.1 Cancelling a subscription.</strong> You may cancel a
          self-serve subscription at any time from Settings &rarr; Billing, or by
          emailing{" "}
          <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.
          Cancellation stops the next renewal. Your Workspace stays fully
          available until the end of the Subscription Term you have already paid
          for, and is not cut short.
        </p>
        <p>
          <strong>9.2 The general rule.</strong> Because the {TRIAL_DAYS}-day
          free trial lets you evaluate the Service in full before paying, fees
          for a Subscription Term that has begun are not refundable except as set
          out in clauses 9.3 to 9.6 or where the law requires otherwise. We do
          not refund part-months on cancellation.
        </p>
        <p>
          <strong>9.3 First annual payment.</strong> If you take an annual
          subscription and tell us within <strong>14 days</strong> of the first
          annual payment that you wish to cancel, we will refund that payment in
          full, less the value of any SMS segments and other consumable
          allowances already used, and access ends on refund.
        </p>
        <p>
          <strong>9.4 Billing errors.</strong> We refund in full, without
          argument, any amount charged in error, any duplicate charge, and any
          charge taken after a valid cancellation. Tell us within 90 days of the
          charge and we will refund to the original payment method within 14 days
          of agreeing the error.
        </p>
        <p>
          <strong>9.5 Failure on our side.</strong> If a defect for which we are
          responsible makes the Service substantially unusable for a continuous
          period of more than five Working Days and we have not fixed it after
          you told us, you may claim a pro-rata refund of the fees for the
          affected period, or terminate under clause 22.3 and receive a pro-rata
          refund of fees paid for the unexpired part of the Subscription Term.
        </p>
        <p>
          <strong>9.6 Consumer cancellation rights.</strong> If you are a
          consumer, the Consumer Contracts (Information, Cancellation and
          Additional Charges) Regulations 2013 give you the right to cancel a
          distance contract within <strong>14 days</strong> of entering into it,
          without giving a reason. To exercise it, tell us in a clear statement —
          an email to{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a> is
          enough — before the 14 days expire. By subscribing and using the
          Service straight away you expressly request that we begin supply during
          the cancellation period; you acknowledge that if you then cancel you
          must pay a proportionate amount for the service supplied up to the
          moment you told us. We will refund the balance within 14 days of being
          told, using the original payment method.
        </p>
        <p>
          <strong>9.7 How refunds are paid.</strong> Refunds are made to the
          original payment method. We do not pay refunds in cash, in credit
          against third-party charges, or to a different party from the payer.
        </p>
        <p>
          <strong>9.8 No refund of third-party charges.</strong> We cannot refund
          amounts billed to you by Twilio, Meta, Google, Calendly or any other
          provider, because we never received them.
        </p>
      </>
    ),
  },
  {
    id: "renewal",
    heading: "10. Automatic renewal",
    body: (
      <>
        <p>
          <strong>10.1</strong> Paid subscriptions renew automatically for
          successive periods equal to the current Subscription Term until
          cancelled under clause 9.1.
        </p>
        <p>
          <strong>10.2</strong> For annual subscriptions we send a renewal
          reminder by email at least 14 days before the renewal date, stating the
          amount and the date it will be taken.
        </p>
        <p>
          <strong>10.3</strong> Cancelling after a renewal payment has been taken
          stops the following renewal; it does not reverse the payment already
          taken, except under clauses 9.3 to 9.6.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    heading: "11. Your account, users and security",
    body: (
      <>
        <ul>
          <li>
            <strong>11.1</strong> You must give accurate account and billing
            details and keep them up to date.
          </li>
          <li>
            <strong>11.2</strong> You are responsible for everything done under
            your Workspace, including by users you invite, and for ensuring your
            users comply with these Terms.
          </li>
          <li>
            <strong>11.3</strong> You must keep credentials confidential, must
            not share a single login between people, and must remove users who
            leave your business.
          </li>
          <li>
            <strong>11.4</strong> Tell us without delay at{" "}
            <a href={`mailto:${COMPANY.supportEmail}`}>
              {COMPANY.supportEmail}
            </a>{" "}
            if you believe an account has been accessed without authorisation.
          </li>
          <li>
            <strong>11.5</strong> You must be at least 18 and, if a business,
            must be lawfully constituted and entitled to trade in the United
            Kingdom.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "messaging",
    heading: "12. Messaging and marketing compliance",
    body: (
      <>
        <p>
          <strong>12.1</strong> This is the most important clause in these Terms.
          You are the <strong>sender</strong> of every message the Service
          delivers on your behalf and the <strong>data controller</strong> for
          every person you contact. We are your processor. We do not select who
          you contact, what you say, or whether it is lawful for you to say it.
        </p>
        <p>
          <strong>12.2</strong> You warrant that, for every message sent through
          the Service:
        </p>
        <ul>
          <li>
            you have a lawful basis under the UK GDPR and satisfy regulations 22
            and 23 of PECR, including for any reactivation of older contacts;
          </li>
          <li>
            the recipient has consented where consent is required, or the
            &ldquo;soft opt-in&rdquo; conditions in regulation 22(3) PECR are
            genuinely met — the contact details were obtained in the course of a
            sale or negotiations for a sale of a similar product or service, and
            a simple means of refusal was given at that point and in every
            message since;
          </li>
          <li>
            you identify yourself as the sender, do not conceal your identity,
            and give a valid address for opt-out requests;
          </li>
          <li>
            every direct-marketing message carries a clear, working and free
            means of opting out;
          </li>
          <li>
            the content is accurate, not misleading, and complies with the CAP
            Code and the Consumer Protection from Unfair Trading Regulations
            2008;
          </li>
          <li>
            you have screened your list against the Telephone Preference Service
            or Corporate Telephone Preference Service where you are making
            marketing calls.
          </li>
        </ul>
        <p>
          <strong>12.3</strong> The Service enforces opt-outs, quiet hours and
          attempt limits, and re-checks them immediately before every send. Those
          controls are a safeguard. They do not decide, and cannot decide,
          whether your campaign is lawful. That judgement is yours alone.
        </p>
        <p>
          <strong>12.4</strong> You must not attempt to circumvent the opt-out,
          quiet-hours, attempt-limit or suppression controls, including by
          re-importing a suppressed contact.
        </p>
        <p>
          <strong>12.5</strong> You must comply with the terms of every platform
          you connect, including Meta&rsquo;s platform and advertising terms,
          the WhatsApp Business Messaging Policy, and your messaging
          provider&rsquo;s acceptable use policy. A breach of those terms is a
          breach of these Terms.
        </p>
        <p>
          <strong>12.6</strong> If a regulator, a platform or a messaging
          provider notifies us of a complaint about your messaging, we may
          suspend sending on your Workspace immediately under clause 22.2 while
          it is investigated, and we will tell you why.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    heading: "13. Acceptable use",
    body: (
      <>
        <p>You must not, and must not permit anyone else to:</p>
        <ul>
          <li>
            attempt to access another Workspace&rsquo;s data, probe, scan or test
            the security of the Service, or interfere with its operation;
          </li>
          <li>
            reverse engineer, decompile or attempt to derive the source code of
            the Service, except to the extent that right cannot lawfully be
            excluded;
          </li>
          <li>
            resell, sublicense, rent or provide the Service to a third party as
            your own product, or use it to operate a messaging bureau, without a
            written agreement with us;
          </li>
          <li>
            upload or import contact lists you have no lawful basis to contact,
            including purchased, scraped or harvested lists;
          </li>
          <li>
            use the Service to process special category data within the meaning
            of Article 9 UK GDPR, criminal offence data, payment card data, or
            data about children;
          </li>
          <li>
            send content that is unlawful, defamatory, obscene, harassing,
            deceptive, or that impersonates another person or business;
          </li>
          <li>
            use the Service to market regulated products or services you are not
            authorised to market, including consumer credit, claims management,
            or investments;
          </li>
          <li>
            introduce malicious code, use the Service to send malicious links, or
            place a disproportionate load on the infrastructure;
          </li>
          <li>
            create multiple Workspaces to evade Plan limits or obtain repeated
            free trials;
          </li>
          <li>
            use the Service in breach of UK sanctions or export control law, or
            for the benefit of a designated person.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "integrations",
    heading: "14. Third-party platforms and integrations",
    body: (
      <>
        <p>
          <strong>14.1</strong> The Service depends on platforms we do not
          control, including Meta, your SMS or WhatsApp provider, and your
          calendar, booking, CRM or advertising providers.
        </p>
        <p>
          <strong>14.2</strong> Your use of each of those platforms is governed
          by your own contract with that provider. We are not a party to it, and
          we have no control over their pricing, policies, availability or
          decisions about your account.
        </p>
        <p>
          <strong>14.3</strong> If a platform changes, restricts, suspends or
          withdraws access — including if Meta changes its lead-ads API or
          suspends your business account — parts of the Service may stop working.
          We will make reasonable efforts to restore or replace the affected
          capability, but we do not warrant the continued availability of any
          third-party platform and are not liable for its acts or omissions.
        </p>
        <p>
          <strong>14.4</strong> Connecting an integration authorises us to send
          your Customer Data to that provider and to receive data from it, for
          the purpose the integration describes. That is an instruction from you
          as controller. See the{" "}
          <a href="/sub-processors">sub-processor register</a>.
        </p>
      </>
    ),
  },
  {
    id: "ip",
    heading: "15. Intellectual property",
    body: (
      <>
        <p>
          <strong>15.1</strong> We own, or are licensed to use, all intellectual
          property rights in the Service, the software, the ClientTurn name and
          brand, and all documentation. Nothing in these Terms transfers any of
          those rights to you.
        </p>
        <p>
          <strong>15.2</strong> We grant you a non-exclusive, non-transferable,
          revocable licence to use the Service for your own business purposes for
          the duration of the Agreement, subject to your Plan.
        </p>
        <p>
          <strong>15.3</strong> You own your Customer Data and your own logos,
          trade marks and message content. You grant us a non-exclusive,
          worldwide, royalty-free licence to host, copy, transmit, display and
          process it strictly to the extent needed to provide the Service, to
          keep it secure, and to comply with the law.
        </p>
        <p>
          <strong>15.4</strong> We may use aggregated and anonymised statistics
          derived from use of the Service to operate, secure and improve it.
          Those statistics never identify you, your business or any Lead, and are
          never disclosed in a form that could.
        </p>
        <p>
          <strong>15.5</strong> We will not name you, use your logo, or describe
          your results in marketing material without your prior written consent.
        </p>
        <p>
          <strong>15.6</strong> If you give us feedback or suggestions, we may
          use them without obligation or payment. You are not obliged to give
          any.
        </p>
      </>
    ),
  },
  {
    id: "data-protection",
    heading: "16. Data protection",
    body: (
      <>
        <p>
          <strong>16.1</strong> In relation to your account data we are a{" "}
          <strong>controller</strong>. In relation to Lead data you process
          through the Service, you are the <strong>controller</strong> and we are
          your <strong>processor</strong>.
        </p>
        <p>
          <strong>16.2</strong> The processing terms required by Article 28(3) UK
          GDPR — subject matter, duration, nature and purpose, types of personal
          data, categories of data subject, our obligations of confidentiality
          and security, sub-processing, assistance with data subject rights and
          with Articles 32 to 36, deletion or return on termination, and audit —
          are set out in the <a href="/privacy">Privacy Policy</a>, which is
          incorporated into these Terms and forms our data processing agreement.
        </p>
        <p>
          <strong>16.3</strong> Our current sub-processors are published at{" "}
          <a href="/sub-processors">clientturn.com/sub-processors</a>. We give at
          least 30 days&rsquo; notice before a new sub-processor starts
          processing your data, and you may object on reasonable
          data-protection grounds; if we cannot resolve the objection you may
          terminate the affected part of the Service and receive a pro-rata
          refund.
        </p>
        <p>
          <strong>16.4</strong> Each party will comply with the Data Protection
          Legislation. You warrant that the instructions you give us — including
          who to contact, and with what — comply with it.
        </p>
        <p>
          <strong>16.5</strong> A separate signed data processing agreement is
          available on request from{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>.
        </p>
      </>
    ),
  },
  {
    id: "confidentiality",
    heading: "17. Confidentiality",
    body: (
      <>
        <p>
          <strong>17.1</strong> Each party will keep the other&rsquo;s
          confidential information confidential, use it only for the purposes of
          the Agreement, and disclose it only to those of its personnel and
          advisers who need it and who are under equivalent obligations.
        </p>
        <p>
          <strong>17.2</strong> This does not apply to information that is or
          becomes public through no breach, was already lawfully held, is
          independently developed, or must be disclosed by law or by a regulator
          — in which case the disclosing party will, where lawful, give notice
          first.
        </p>
        <p>
          <strong>17.3</strong> These obligations survive termination for five
          years, and indefinitely for personal data.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    heading: "18. Availability, support and maintenance",
    body: (
      <>
        <p>
          <strong>18.1</strong> We aim to keep the Service available at all
          times, and to carry out planned maintenance outside UK business hours
          where practical, with advance notice for anything that will cause an
          interruption.
        </p>
        <p>
          <strong>18.2</strong> We do not offer a contractual uptime commitment
          or service credits on self-serve Plans. Enterprise customers may agree
          a separate service level agreement, which will then take precedence
          over this clause for that customer.
        </p>
        <p>
          <strong>18.3</strong> Support is provided by email at{" "}
          <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>{" "}
          during UK business hours, Monday to Friday, excluding public holidays
          in England and Wales. We aim to acknowledge within one Working Day. We
          do not provide support by telephone.
        </p>
        <p>
          <strong>18.4</strong> We may suspend the Service without notice where
          necessary for emergency maintenance or to address a security incident.
          We will restore it as quickly as we can and tell you what happened.
        </p>
      </>
    ),
  },
  {
    id: "no-guarantee",
    heading: "19. No guarantee of results",
    body: (
      <>
        <p>
          <strong>19.1</strong> The Service automates response speed, follow-up
          and qualification. It does not guarantee any number of replies,
          qualified leads, bookings, won jobs, revenue or return on advertising
          spend. Outcomes depend on your offer, your adverts, your prices, your
          market and your own responsiveness.
        </p>
        <p>
          <strong>19.2</strong> Any figures, charts or examples shown on this
          website are illustrative product demonstrations using sample data. They
          are not customer results, not testimonials, and not a forecast or
          representation of what you will achieve.
        </p>
        <p>
          <strong>19.3</strong> You have not relied on any statement,
          representation or assurance that is not set out in the Agreement. This
          clause does not limit liability for fraudulent misrepresentation.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    heading: "20. Warranties and liability",
    body: (
      <>
        <p>
          <strong>20.1</strong> We warrant that we will provide the Service with
          reasonable care and skill, in accordance with the Supply of Goods and
          Services Act 1982 and, where you are a consumer, the Consumer Rights
          Act 2015.
        </p>
        <p>
          <strong>20.2 Uncapped liability.</strong> Nothing in the Agreement
          limits or excludes either party&rsquo;s liability for: death or
          personal injury caused by negligence; fraud or fraudulent
          misrepresentation; breach of the terms implied by section 12 of the
          Sale of Goods Act 1979 or section 2 of the Supply of Goods and Services
          Act 1982; or any other liability that cannot lawfully be limited or
          excluded.
        </p>
        <p>
          <strong>20.3 Excluded loss.</strong> Subject to clause 20.2, neither
          party is liable to the other, whether in contract, tort (including
          negligence), breach of statutory duty or otherwise, for: loss of
          profits; loss of sales, business or revenue; loss of or damage to
          goodwill or reputation; loss of anticipated savings; loss of agreements
          or contracts; loss of use or corruption of software or data beyond the
          restoration obligation in clause 20.5; or any indirect or consequential
          loss.
        </p>
        <p>
          <strong>20.4 Cap.</strong> Subject to clause 20.2, our total aggregate
          liability arising out of or in connection with the Agreement in any
          period of twelve months is limited to the total fees actually paid by
          you to us under the Agreement in that same twelve-month period. Where
          the Service is provided free of charge, including during the free trial,
          our total aggregate liability is limited to £100.
        </p>
        <p>
          <strong>20.5 Data.</strong> We take regular backups and will use
          reasonable endeavours to restore Customer Data lost through our fault
          from the most recent backup. This is your exclusive remedy for lost
          data. You remain responsible for exporting and keeping your own copies
          of anything you cannot afford to lose.
        </p>
        <p>
          <strong>20.6 Consumers.</strong> If you are a consumer, clauses 20.3
          and 20.4 do not limit our liability for foreseeable loss caused by our
          breach of the Agreement or our failure to use reasonable care and
          skill, and your statutory remedies under the Consumer Rights Act 2015
          are unaffected.
        </p>
        <p>
          <strong>20.7</strong> The parties agree that the allocation of risk in
          this clause is reasonable within the meaning of the Unfair Contract
          Terms Act 1977, having regard to the level of the fees, the
          availability of the free trial, and each party&rsquo;s ability to
          insure.
        </p>
      </>
    ),
  },
  {
    id: "indemnity",
    heading: "21. Indemnity",
    body: (
      <>
        <p>
          <strong>21.1</strong> Where you are not a consumer, you will indemnify
          us against all losses, liabilities, fines, penalties, damages, costs
          and reasonable legal expenses we incur arising from: (a) messages sent
          through the Service in breach of clause 12 or clause 13; (b) your
          breach of the Data Protection Legislation as controller; (c) any claim
          by a Lead, a regulator, a platform or a messaging provider relating to
          your use of the Service; or (d) your infringement of a third
          party&rsquo;s intellectual property rights through content you supply.
        </p>
        <p>
          <strong>21.2</strong> We will notify you promptly of any claim covered
          by clause 21.1, will not settle it without your consent (not to be
          unreasonably withheld), and will give you reasonable assistance at your
          cost.
        </p>
        <p>
          <strong>21.3</strong> We will defend you against any claim that the
          Service, used in accordance with the Agreement, infringes a third
          party&rsquo;s United Kingdom intellectual property rights, and will pay
          the damages finally awarded, provided you notify us promptly, give us
          conduct of the defence, and give us reasonable assistance. This does
          not apply to claims arising from your Customer Data or from use of the
          Service in breach of the Agreement.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    heading: "22. Suspension, termination and exit",
    body: (
      <>
        <p>
          <strong>22.1</strong> You may terminate for convenience by cancelling
          under clause 9.1.
        </p>
        <p>
          <strong>22.2 Suspension.</strong> We may suspend all or part of the
          Service immediately where: use of it is unlawful or we reasonably
          suspect it is; there is a security risk to the Service or to other
          customers; a payment is overdue after the process in clause 7.6; or
          clause 12 or clause 13 has been breached. We will tell you the reason
          and, where the cause is capable of being fixed, what needs to change.
          Suspension does not suspend your obligation to pay.
        </p>
        <p>
          <strong>22.3 Termination for breach.</strong> Either party may
          terminate the Agreement immediately on written notice if the other
          commits a material breach that is capable of remedy and does not remedy
          it within 14 days of written notice, or commits a material breach that
          is not capable of remedy, or becomes insolvent, enters administration,
          has a receiver or administrator appointed, passes a resolution for
          winding up, or ceases to carry on business.
        </p>
        <p>
          <strong>22.4 Effect of termination.</strong> On termination all
          licences end and access to the Service stops at the end of the
          Subscription Term, or immediately where we terminate under clause 22.3
          or you cancel under clause 9.3 or 9.6.
        </p>
        <p>
          <strong>22.5 Exit and export.</strong> For <strong>30 days</strong>{" "}
          after termination you may export your Customer Data through the export
          tools in the product, or ask us at{" "}
          <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>{" "}
          for a machine-readable copy, which we will provide free of charge. After
          that period, and in any event within 90 days, we delete or irreversibly
          anonymise your Customer Data, except records we must retain by law and
          suppression records kept solely so that a contact who has opted out is
          not contacted again.
        </p>
        <p>
          <strong>22.6 Survival.</strong> Clauses 15, 16, 17, 19, 20, 21, 22.5,
          25, 26 and 28, and any other clause intended to survive, continue after
          termination.
        </p>
      </>
    ),
  },
  {
    id: "force-majeure",
    heading: "23. Force majeure",
    body: (
      <p>
        Neither party is in breach of the Agreement, nor liable for delay or
        failure to perform, because of an event beyond its reasonable control —
        including failure of public telecommunications or internet
        infrastructure, failure or withdrawal of a third-party platform, cyber
        attack, epidemic, act of government, industrial action not involving that
        party&rsquo;s own workforce, fire, flood or war. The affected party will
        notify the other and use reasonable endeavours to mitigate. If the event
        continues for more than 30 days, either party may terminate on written
        notice and we will refund fees paid for the unperformed period.
      </p>
    ),
  },
  {
    id: "compliance",
    heading: "24. Compliance with law",
    body: (
      <>
        <p>
          <strong>24.1</strong> Each party will comply with all applicable laws,
          including the Bribery Act 2010, the Modern Slavery Act 2015, and
          applicable UK sanctions and export control legislation.
        </p>
        <p>
          <strong>24.2</strong> You warrant that neither you, nor anyone who owns
          or controls you, is a designated person under UK sanctions, and that
          you will not use the Service for the benefit of a designated person.
        </p>
        <p>
          <strong>24.3</strong> Neither party will offer or accept a bribe or a
          facilitation payment in connection with the Agreement. Breach of this
          clause is a material breach that is not capable of remedy.
        </p>
      </>
    ),
  },
  {
    id: "complaints",
    heading: "25. Complaints and disputes",
    body: (
      <>
        <p>
          <strong>25.1</strong> If something has gone wrong, write to{" "}
          <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.
          We will acknowledge within one Working Day and give a substantive
          response within 10 Working Days. If you are not satisfied, escalate to{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>, and
          a director will respond within a further 10 Working Days.
        </p>
        <p>
          <strong>25.2</strong> Before starting proceedings, the parties will
          attempt in good faith to resolve the dispute through escalation to
          senior representatives, and will consider mediation. This does not
          prevent either party from seeking urgent injunctive relief.
        </p>
        <p>
          <strong>25.3</strong> A data protection complaint may also be made to
          the{" "}
          <a
            href="https://ico.org.uk/make-a-complaint/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Information Commissioner&rsquo;s Office
          </a>
          . Nothing in this clause affects that right.
        </p>
      </>
    ),
  },
  {
    id: "notices",
    heading: "26. Notices",
    body: (
      <>
        <p>
          <strong>26.1</strong> Formal notices to us must be sent to{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a> and,
          for anything commencing proceedings, also by post to{" "}
          {COMPANY.registeredName}, {COMPANY.registeredAddress}.
        </p>
        <p>
          <strong>26.2</strong> Notices to you are sent to the email address on
          your account. It is your responsibility to keep it current and
          monitored.
        </p>
        <p>
          <strong>26.3</strong> An email notice is deemed received at 9.00 am on
          the next Working Day after sending. A posted notice is deemed received
          on the second Working Day after posting by first class post.
        </p>
      </>
    ),
  },
  {
    id: "general",
    heading: "27. General",
    body: (
      <>
        <p>
          <strong>27.1 Changes to these Terms.</strong> We may update these
          Terms. Material changes are notified by email or in the product at
          least <strong>30 days</strong> before they take effect. If a material
          change disadvantages you, you may terminate before it takes effect and
          receive a pro-rata refund for the unexpired Subscription Term.
          Continuing to use the Service after the effective date means you accept
          the change. Changes required by law may take effect sooner where the
          law requires.
        </p>
        <p>
          <strong>27.2 Assignment.</strong> You may not assign or transfer the
          Agreement without our written consent. We may assign it to a group
          company or to a purchaser of our business, provided your rights are not
          reduced.
        </p>
        <p>
          <strong>27.3 Subcontracting.</strong> We may subcontract performance,
          but remain responsible for our subcontractors.
        </p>
        <p>
          <strong>27.4 Third party rights.</strong> A person who is not a party
          to the Agreement has no rights under the Contracts (Rights of Third
          Parties) Act 1999 to enforce any of its terms.
        </p>
        <p>
          <strong>27.5 Entire agreement.</strong> The Agreement is the entire
          agreement between the parties and supersedes all previous
          arrangements, subject to clause 19.3.
        </p>
        <p>
          <strong>27.6 Severance.</strong> If any provision is held invalid or
          unenforceable, it is modified to the minimum extent necessary to make
          it enforceable, and the rest of the Agreement is unaffected.
        </p>
        <p>
          <strong>27.7 Waiver.</strong> A failure or delay in exercising a right
          is not a waiver of it, and a single or partial exercise does not
          prevent further exercise.
        </p>
        <p>
          <strong>27.8 No partnership.</strong> Nothing in the Agreement creates
          a partnership, joint venture, agency or employment relationship.
        </p>
      </>
    ),
  },
  {
    id: "law",
    heading: "28. Governing law and jurisdiction",
    body: (
      <>
        <p>
          <strong>28.1</strong> The Agreement, and any dispute or claim arising
          out of or in connection with it or its subject matter or formation
          (including non-contractual disputes or claims), is governed by and
          construed in accordance with the law of England and Wales.
        </p>
        <p>
          <strong>28.2</strong> The courts of England and Wales have exclusive
          jurisdiction to settle any such dispute or claim.
        </p>
        <p>
          <strong>28.3</strong> If you are a consumer resident in Scotland or
          Northern Ireland, you may also bring proceedings in the courts of your
          own part of the United Kingdom, and the mandatory consumer protection
          law of that part applies to you.
        </p>
        <p>
          <strong>28.4</strong> Questions about these Terms:{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>.
          Everything else:{" "}
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
      intro="The contract between Blackwellen Limited and the business using ClientTurn. Please read clause 12 carefully — you are the sender of every message the Service delivers on your behalf, and the data controller for everyone you contact."
      currentPath="/terms"
      sections={SECTIONS}
    />
  );
}
