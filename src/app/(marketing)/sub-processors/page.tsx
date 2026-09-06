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
  SUBPROCESSOR_CHANGES,
  SUBPROCESSOR_NOTICE_DAYS,
  type SubProcessor,
} from "@/lib/marketing/subprocessors";

const description =
  "The full register of every sub-processor ClientTurn uses, what each one does, the personal data it can see, where it processes it, and the transfer mechanism relied on.";

export const metadata: Metadata = {
  title: "Sub-processors",
  description,
  alternates: { canonical: "/sub-processors" },
  openGraph: {
    title: "Sub-processors · ClientTurn",
    description,
    url: "/sub-processors",
    siteName: "ClientTurn",
    locale: "en_GB",
    type: "article",
  },
  twitter: {
    card: "summary",
    title: "Sub-processors · ClientTurn",
    description,
  },
};

function Register({ rows }: { rows: SubProcessor[] }) {
  return (
    <div className="-mx-1 overflow-x-auto rounded-xl border border-line">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Provider</TableHead>
            <TableHead>Contracting entity</TableHead>
            <TableHead>What it does</TableHead>
            <TableHead>Personal data it can see</TableHead>
            <TableHead>Processing location</TableHead>
            <TableHead>Transfer mechanism</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell className="min-w-[160px] align-top font-medium">
                {row.name}
                {row.optional ? (
                  <span className="mt-1 block text-[12px] font-normal text-content-muted">
                    Only if enabled
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="min-w-[220px] align-top">
                {row.entity}
              </TableCell>
              <TableCell className="min-w-[300px] align-top">
                {row.purpose}
              </TableCell>
              <TableCell className="min-w-[240px] align-top">
                {row.data}
              </TableCell>
              <TableCell className="min-w-[200px] align-top">
                {row.location}
              </TableCell>
              <TableCell className="min-w-[220px] align-top">
                {row.transfer}
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
    id: "about",
    heading: "1. About this register",
    body: (
      <>
        <p>
          A sub-processor is a third party we engage to process personal data on
          behalf of our customers. Article 28(2) and 28(4) of the UK GDPR require
          us to have our customers&rsquo; authorisation to use them, to bind each
          one to obligations no less protective than our own, and to remain fully
          liable to the customer for what they do.
        </p>
        <p>
          This page is that register. It is referenced by our{" "}
          <a href="/privacy">Privacy Policy</a>, which contains our Article 28
          processing terms, and by clause 16 of our{" "}
          <a href="/terms">Terms of Service</a>.
        </p>
        <p>
          We keep this list deliberately short. A provider is added only where it
          is genuinely needed to run the service, and it appears here the moment
          it can touch customer or lead personal data in production.
        </p>
      </>
    ),
  },
  {
    id: "core",
    heading: "2. Core sub-processors",
    body: (
      <>
        <p>
          Engaged for every workspace. These are the providers that make the
          service work at all.
        </p>
        <Register rows={CORE_SUBPROCESSORS} />
      </>
    ),
  },
  {
    id: "customer-enabled",
    heading: "3. Customer-enabled providers",
    body: (
      <>
        <p>
          These receive data only where a customer connects the integration or
          turns the feature on. Connecting one is an instruction from the
          customer, as controller, to disclose data to that provider; use of it
          is then governed by the customer&rsquo;s own agreement with them as
          well as by ours.
        </p>
        <Register rows={CUSTOMER_ENABLED_SUBPROCESSORS} />
      </>
    ),
  },
  {
    id: "commitments",
    heading: "4. What we commit to",
    body: (
      <ul>
        <li>
          <strong>Written terms.</strong> Every sub-processor is engaged under a
          written contract imposing data protection obligations no less
          protective than those we owe our customers.
        </li>
        <li>
          <strong>Due diligence.</strong> We assess each provider&rsquo;s
          security posture, certifications, breach history and sub-processing
          before engaging it, and again when its role materially changes.
        </li>
        <li>
          <strong>Transfers.</strong> Where processing leaves the United Kingdom
          we rely on UK adequacy regulations, or on the International Data
          Transfer Addendum to the EU Standard Contractual Clauses supported by a
          transfer risk assessment.
        </li>
        <li>
          <strong>Liability.</strong> We remain fully liable to our customers for
          the performance of every sub-processor&rsquo;s obligations.
        </li>
        <li>
          <strong>Minimisation.</strong> Each provider receives only the data its
          stated purpose requires, and no more.
        </li>
      </ul>
    ),
  },
  {
    id: "notice",
    heading: "5. Notice of changes, and your right to object",
    body: (
      <>
        <p>
          We give customers at least{" "}
          <strong>{SUBPROCESSOR_NOTICE_DAYS} days&rsquo; notice</strong> by email
          before a new sub-processor begins processing their data, and we update
          this page at the same time.
        </p>
        <p>
          A customer may object on reasonable data-protection grounds by writing
          to{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a> within
          the notice period. We will work with you to find an alternative. If we
          cannot resolve the objection, you may terminate the affected part of
          the service and receive a pro-rata refund of fees paid for the
          unexpired part of your subscription term.
        </p>
        <p>
          Where an existing sub-processor must be replaced urgently — for example
          because it has suffered a security incident or ceased trading — we may
          act before the notice period expires, and will tell you what we did and
          why as soon as we can.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    heading: "6. Change log",
    body: (
      <div className="-mx-1 overflow-x-auto rounded-xl border border-line">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Date</TableHead>
              <TableHead>Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SUBPROCESSOR_CHANGES.map((entry) => (
              <TableRow key={entry.date}>
                <TableCell className="min-w-[160px] whitespace-nowrap align-top font-medium">
                  {entry.date}
                </TableCell>
                <TableCell className="min-w-[320px] align-top">
                  {entry.change}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    ),
  },
  {
    id: "contact",
    heading: "7. Contact",
    body: (
      <p>
        To ask about a provider on this register, to request a copy of a transfer
        mechanism with commercial terms redacted, or to request a signed data
        processing agreement, write to{" "}
        <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>.
      </p>
    ),
  },
];

export default function SubProcessorsPage() {
  return (
    <LegalPage
      title="Sub-processors"
      intro="Every third party that can touch personal data in ClientTurn, what it does, the data it sees, where it processes it, and how transfers out of the UK are protected."
      currentPath="/sub-processors"
      sections={SECTIONS}
    />
  );
}
