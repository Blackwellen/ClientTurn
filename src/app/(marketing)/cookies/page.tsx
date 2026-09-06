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
import { CookiePreferencesButton } from "@/components/marketing/cookie-preferences-button";
import { COMPANY } from "@/lib/marketing/company";

const description =
  "Every cookie and browser storage item ClientTurn sets, what it is for, how long it lasts, and how to accept, reject or withdraw consent under PECR regulation 6.";

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

type CookieRow = {
  name: string;
  kind: string;
  provider: string;
  purpose: string;
  duration: string;
};

const ESSENTIAL: CookieRow[] = [
  {
    name: "sb-<project>-auth-token",
    kind: "First-party cookie",
    provider: "Supabase (on our behalf)",
    purpose:
      "Holds your signed-in session so the application knows who you are on each request. Without it you cannot stay signed in.",
    duration: "Session, refreshed for up to 30 days",
  },
  {
    name: "sb-<project>-auth-token-code-verifier",
    kind: "First-party cookie",
    provider: "Supabase (on our behalf)",
    purpose:
      "A single-use value used to complete the sign-in exchange securely (PKCE). Deleted the moment sign-in finishes.",
    duration: "Minutes",
  },
  {
    name: "__cf_bm and Cloudflare network cookies",
    kind: "First-party cookie",
    provider: "Cloudflare",
    purpose:
      "Distinguishes real visitors from automated traffic and protects the site from abuse and denial-of-service attempts.",
    duration: "Up to 30 minutes",
  },
  {
    name: "__stripe_mid, __stripe_sid",
    kind: "Third-party cookie, set only on billing pages",
    provider: "Stripe",
    purpose:
      "Fraud prevention on the payment form. Set only when a checkout or billing page is loaded, and required to take a payment safely.",
    duration: "Session to 12 months",
  },
  {
    name: "lr.cookie-consent",
    kind: "localStorage",
    provider: "ClientTurn",
    purpose:
      "Remembers whether you accepted or rejected non-essential storage, so we do not ask again on every page. Stored in your browser and never transmitted to us.",
    duration: "Until you change it or clear site data",
  },
];

const OPTIONAL: CookieRow[] = [
  {
    name: "lr.attribution",
    kind: "sessionStorage",
    provider: "ClientTurn",
    purpose:
      "Records the advert, campaign or link that brought you to the site, plus a random identifier for this browsing session, so that a sign-up can be credited to the marketing that produced it. First touch wins.",
    duration: "Until you close the browser tab",
  },
  {
    name: "CTA analytics events",
    kind: "Server-side event, no device storage of its own",
    provider: "ClientTurn",
    purpose:
      "Records which call-to-action buttons are pressed, together with the campaign values held in lr.attribution, so we can tell which pages and adverts work. Sent only after you accept.",
    duration: "Aggregated; underlying events kept 12 months",
  },
];

const SECTIONS: LegalSection[] = [
  {
    id: "what",
    heading: "1. What this policy covers",
    body: (
      <>
        <p>
          Cookies are small files a website asks your browser to store. This
          policy covers cookies and every equivalent technology we use —{" "}
          <code>localStorage</code>, <code>sessionStorage</code>, pixels and
          device fingerprinting techniques — because regulation 6 of the Privacy
          and Electronic Communications (EC Directive) Regulations 2003 (
          <strong>PECR</strong>) applies to all of them equally.
        </p>
        <p>
          It applies to clientturn.com and to the ClientTurn application. It is
          published by {COMPANY.registeredName} (company number{" "}
          {COMPANY.companyNumber}), which decides what is stored on your device
          and is therefore the controller for it.
        </p>
        <p>
          Where a cookie also involves personal data, the{" "}
          <a href="/privacy">Privacy Policy</a> explains our lawful basis, how
          long we keep it and your rights over it.
        </p>
      </>
    ),
  },
  {
    id: "consent",
    heading: "2. Your choice, and how we ask for it",
    body: (
      <>
        <p>
          <strong>2.1</strong> Strictly necessary storage is set without consent.
          PECR regulation 6(4) permits that, because the site cannot deliver the
          service you asked for without it — you could not sign in, and we could
          not take a payment safely.
        </p>
        <p>
          <strong>2.2</strong> Everything else is set{" "}
          <strong>only after you press &ldquo;Accept all&rdquo;</strong> on the
          banner. Until you do, nothing in section 4 is written to or read from
          your device, and no analytics event is sent. Continuing to scroll or
          browse is not treated as consent, and no non-essential storage is
          pre-enabled.
        </p>
        <p>
          <strong>2.3</strong> &ldquo;Reject non-essential&rdquo; sits next to
          &ldquo;Accept all&rdquo;, is the same size, and takes the same single
          press. Rejecting costs you nothing: the whole site and the whole
          product remain fully usable, and we do not ask again.
        </p>
        <p>
          <strong>2.4</strong> Withdrawing consent is as easy as giving it. Use
          the button below. It clears the choice, deletes anything stored under
          it, and brings the banner back.
        </p>
        <CookiePreferencesButton />
        <p>
          <strong>2.5</strong> Your choice is recorded in your browser, not in
          your account, so it is per-browser and per-device. Clearing site data
          clears it too, and you will be asked again.
        </p>
      </>
    ),
  },
  {
    id: "essential",
    heading: "3. Strictly necessary storage",
    body: (
      <>
        <p>
          These are always set. Blocking them will stop you signing in or paying.
        </p>
        <div className="-mx-1 overflow-x-auto rounded-xl border border-line">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Set by</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ESSENTIAL.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="min-w-[210px] align-top font-medium">
                    <code>{row.name}</code>
                  </TableCell>
                  <TableCell className="min-w-[150px] align-top">
                    {row.kind}
                  </TableCell>
                  <TableCell className="min-w-[140px] align-top">
                    {row.provider}
                  </TableCell>
                  <TableCell className="min-w-[280px] align-top">
                    {row.purpose}
                  </TableCell>
                  <TableCell className="min-w-[150px] align-top">
                    {row.duration}
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
    id: "optional",
    heading: "4. Optional storage, set only after you accept",
    body: (
      <>
        <div className="-mx-1 overflow-x-auto rounded-xl border border-line">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Set by</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {OPTIONAL.map((row) => (
                <TableRow key={row.name}>
                  <TableCell className="min-w-[210px] align-top font-medium">
                    <code>{row.name}</code>
                  </TableCell>
                  <TableCell className="min-w-[150px] align-top">
                    {row.kind}
                  </TableCell>
                  <TableCell className="min-w-[140px] align-top">
                    {row.provider}
                  </TableCell>
                  <TableCell className="min-w-[280px] align-top">
                    {row.purpose}
                  </TableCell>
                  <TableCell className="min-w-[150px] align-top">
                    {row.duration}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p>
          Attribution values may also appear in the URL as{" "}
          <code>utm_source</code>, <code>utm_medium</code>,{" "}
          <code>utm_campaign</code>, <code>gclid</code> or <code>fbclid</code>{" "}
          parameters when you arrive from an advert. Those are part of the link
          you clicked rather than something we store on your device, and they are
          only carried into your sign-up if you have accepted.
        </p>
      </>
    ),
  },
  {
    id: "not-used",
    heading: "5. What we deliberately do not do",
    body: (
      <ul>
        <li>
          We do not run third-party advertising, retargeting or social media
          pixels on this site — no Meta pixel, no Google Ads remarketing tag, no
          LinkedIn Insight tag.
        </li>
        <li>
          We do not sell or share information about your browsing with data
          brokers or advertising networks.
        </li>
        <li>
          We do not track you across other websites, and we set no cross-site
          identifier.
        </li>
        <li>
          We do not use cookie walls: rejecting optional storage does not reduce
          your access to any part of the site or product.
        </li>
        <li>
          We do not treat scrolling, closing the banner, or continued browsing as
          consent.
        </li>
      </ul>
    ),
  },
  {
    id: "browser",
    heading: "6. Controlling storage in your browser",
    body: (
      <>
        <p>
          Every major browser lets you block or delete cookies and site data from
          its privacy settings, and most offer a per-site control. Blocking
          strictly necessary storage will prevent you from signing in.
        </p>
        <p>
          Most browsers also send a &ldquo;Do Not Track&rdquo; or Global Privacy
          Control signal if you enable it. We do not load any tracking that those
          signals would need to suppress, because nothing optional runs before
          you accept.
        </p>
        <p>
          Guidance for the main browsers is published by their makers:{" "}
          <a
            href="https://support.google.com/chrome/answer/95647"
            target="_blank"
            rel="noreferrer noopener"
          >
            Chrome
          </a>
          ,{" "}
          <a
            href="https://support.apple.com/en-gb/guide/safari/sfri11471/mac"
            target="_blank"
            rel="noreferrer noopener"
          >
            Safari
          </a>
          ,{" "}
          <a
            href="https://support.mozilla.org/en-GB/kb/enhanced-tracking-protection-firefox-desktop"
            target="_blank"
            rel="noreferrer noopener"
          >
            Firefox
          </a>{" "}
          and{" "}
          <a
            href="https://support.microsoft.com/en-gb/microsoft-edge"
            target="_blank"
            rel="noreferrer noopener"
          >
            Edge
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "changes",
    heading: "7. Changes and contact",
    body: (
      <>
        <p>
          If we add or remove anything stored on your device, we update the
          tables above in the same release and, where the change requires
          consent, ask for it again.
        </p>
        <p>
          Questions about this policy, or a complaint:{" "}
          <a href={`mailto:${COMPANY.legalEmail}`}>{COMPANY.legalEmail}</a>.
          General support:{" "}
          <a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>.
          You may also complain to the{" "}
          <a
            href="https://ico.org.uk/make-a-complaint/"
            target="_blank"
            rel="noreferrer noopener"
          >
            Information Commissioner&rsquo;s Office
          </a>
          , which enforces PECR.
        </p>
        <p>
          See also our <a href="/privacy">Privacy Policy</a> and our{" "}
          <a href="/terms">Terms of Service</a>.
        </p>
      </>
    ),
  },
];

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      intro="Exactly what we store in your browser, why, how long it lasts, and how to say no to everything that is not strictly necessary. Nothing optional is stored until you accept."
      currentPath="/cookies"
      sections={SECTIONS}
    />
  );
}
