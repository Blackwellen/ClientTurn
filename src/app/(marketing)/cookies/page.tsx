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

const description =
  "Which cookies ClientTurn sets, why they are set, and how to accept or reject non-essential cookies.";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description,
  alternates: { canonical: "/cookies" },
  openGraph: {
    title: "Cookie Policy · ClientTurn",
    description,
    url: "/cookies",
    siteName: "ClientTurn",
    locale: "en_GB",
    type: "article",
  },
  twitter: {
    card: "summary",
    title: "Cookie Policy · ClientTurn",
    description,
  },
};

const COOKIES = [
  {
    name: "Authentication session",
    type: "Strictly necessary",
    purpose: "Keeps you signed in and protects requests you make in the app.",
    duration: "Session to 30 days",
  },
  {
    name: "Security and abuse prevention",
    type: "Strictly necessary",
    purpose:
      "Detects unusual sign-in behaviour and protects forms from automated abuse.",
    duration: "Up to 12 months",
  },
  {
    name: "Consent choice",
    type: "Strictly necessary",
    purpose:
      "Remembers whether you accepted or rejected non-essential cookies. Stored in your browser, not sent to us.",
    duration: "Until cleared",
  },
  {
    name: "Campaign attribution",
    type: "Analytics",
    purpose:
      "Records which advert or link brought you to the site so we can tell which marketing works.",
    duration: "Session",
  },
  {
    name: "Product analytics",
    type: "Analytics",
    purpose:
      "Aggregated page and CTA statistics used to improve the site and the product.",
    duration: "Up to 12 months",
  },
] as const;

const SECTIONS: LegalSection[] = [
  {
    id: "what",
    heading: "1. What cookies are",
    body: (
      <p>
        Cookies are small files a website stores in your browser. This policy
        also covers similar technologies such as <code>localStorage</code> and{" "}
        <code>sessionStorage</code>, which we use for the same purposes.
      </p>
    ),
  },
  {
    id: "consent",
    heading: "2. Your choice",
    body: (
      <>
        <p>
          Strictly necessary cookies are set without consent because the site
          cannot work without them — this is permitted under PECR. Everything
          else is only set after you press <strong>Accept all</strong> on the
          banner.
        </p>
        <p>
          If you press <strong>Reject non-essential</strong>, analytics and
          attribution are not enabled and you can still use the whole site. Your
          choice is stored in your browser; clearing site data will show the
          banner again.
        </p>
      </>
    ),
  },
  {
    id: "what-we-set",
    heading: "3. What we set",
    body: (
      <div className="-mx-1 overflow-x-auto rounded-xl border border-line">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Cookie</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {COOKIES.map((cookie) => (
              <TableRow key={cookie.name}>
                <TableCell className="whitespace-nowrap font-medium">
                  {cookie.name}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {cookie.type}
                </TableCell>
                <TableCell className="min-w-[260px]">{cookie.purpose}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {cookie.duration}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    ),
  },
  {
    id: "third-party",
    heading: "4. Third parties",
    body: (
      <p>
        We do not run third-party advertising or retargeting pixels on this
        site. Where an analytics provider is used, it is configured to collect
        aggregate usage only, and it is only loaded once you have accepted
        analytics cookies.
      </p>
    ),
  },
  {
    id: "browser",
    heading: "5. Controlling cookies in your browser",
    body: (
      <>
        <p>
          Every major browser lets you block or delete cookies from its privacy
          settings. Blocking strictly necessary cookies will prevent you from
          signing in.
        </p>
        <p>
          To change the choice you made on our banner, clear this site&rsquo;s
          storage in your browser settings and reload the page.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    heading: "6. Contact",
    body: (
      <p>
        Questions about this policy:{" "}
        <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>.
        See also our <a href="/privacy">Privacy Policy</a>.
      </p>
    ),
  },
];

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      intro="What we store in your browser, why, and how to say no to the parts that are not strictly necessary."
      operatorNote="This policy describes the intended cookie behaviour of the site. It is not legal advice. Before launch the operator must audit the cookies actually set in production, confirm that no analytics or attribution storage occurs before consent, and have the wording reviewed against PECR and UK GDPR."
      sections={SECTIONS}
    />
  );
}
