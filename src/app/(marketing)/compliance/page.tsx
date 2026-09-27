import type { Metadata } from "next";
import Link from "next/link";
import {
  Ban,
  BookOpen,
  Building2,
  Check,
  Clock,
  FileText,
  Fingerprint,
  Info,
  Mail,
  MapPin,
  Hash,
  MessageSquareOff,
  Mic,
  PhoneCall,
  PhoneOff,
  Scale,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import {
  PublicContainer,
  PublicCard,
  SectionEyebrow,
  GlyphTile,
  GridTexture,
  Glow,
} from "@/components/marketing/public/ui";
import { Band, BandStack, TrustRow, StatePill } from "@/components/marketing/public/shell";
import { Reveal, RevealGrid, ScrollProgress } from "@/components/marketing/public/reveal";
import {
  PrimaryCta,
  SecondaryCta,
  AnchorCta,
  ActionRow,
} from "@/components/marketing/public/actions";
import { FinalCtaBand } from "@/components/marketing/public/final-cta";
import { OPENER_TEMPLATE, RECORDING_NOTICE } from "@/lib/voice/opener";
import { CALLING_HOURS_BOUNDS, DEFAULT_CALLING_HOURS } from "@/lib/voice/calling-hours";
import { CALL_BUDGET_MINUTES } from "@/lib/marketing/voice-offer";

/**
 * /compliance — how ClientTurn helps a UK business stay inside PECR and UK GDPR.
 *
 * Every statement on this page describes behaviour the product ships today
 * (the policy engine under src/lib/policy, the Article 14 line, suppression,
 * quiet hours, consent records and data-rights routing) or a fact recorded in
 * the sub-processor register. It names no certification, because the company
 * holds none it can evidence, and it says plainly what stays with the
 * customer: they are the controller, and this is not legal advice.
 */

const title = "How we keep you compliant";
const description =
  "How ClientTurn applies PECR and UK GDPR to every message and AI call: corporate and sole-trader rules, consent-only AI calls, source disclosure, opt-outs, calling hours and data rights.";
const path = "/compliance";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com").replace(/\/$/, "");

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "pecr compliant cold email",
    "uk gdpr b2b outreach",
    "legitimate interests assessment",
    "sole trader pecr",
    "corporate subscriber",
    "article 14 privacy notice",
    "email suppression list",
    "uk compliant lead follow-up",
    "pecr ai voice calls",
    "ai call disclosure uk",
  ],
  alternates: { canonical: path },
  openGraph: {
    title,
    description,
    url: path,
    siteName: "ClientTurn",
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

/** A breadcrumb only. No ratings and no claims a snippet could misstate. */
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
        { "@type": "ListItem", position: 2, name: "Compliance", item: `${siteUrl}${path}` },
      ],
    },
  ],
};

/** How each subscriber type is treated for cold outreach. Mirrors policy/packs. */
const SUBSCRIBERS: { type: string; outcome: string; tone: "go" | "hold" | "stop" }[] = [
  { type: "Limited company", outcome: "Allowed", tone: "go" },
  { type: "LLP", outcome: "Allowed (treated as a company)", tone: "go" },
  { type: "Scottish partnership", outcome: "Allowed (treated as a company)", tone: "go" },
  { type: "Sole trader", outcome: "Blocked", tone: "stop" },
  { type: "Ordinary partnership", outcome: "Blocked", tone: "stop" },
  { type: "Private individual", outcome: "Blocked", tone: "stop" },
  { type: "Not yet known", outcome: "Held for your review", tone: "hold" },
];

type Safeguard = {
  icon: typeof Mail;
  title: string;
  body: string;
  link?: { href: string; label: string };
};

const SAFEGUARDS: Safeguard[] = [
  {
    icon: FileText,
    title: "Where you got their details, on the first message",
    body: "UK GDPR Article 14 says you must tell someone where their data came from, at the latest when you first contact them. The first cold email carries one sentence, built from what ClientTurn recorded about the source, with a link to your privacy notice. It is never written by AI. If the source or your privacy notice URL is missing, the message is held.",
    link: { href: "/help/compliance/article-14-source-disclosure", label: "How the source line works" },
  },
  {
    icon: MessageSquareOff,
    title: "An opt-out on every message, honoured at once",
    body: "Marketing email carries an unsubscribe link and the one-click unsubscribe header mail apps use. STOP on SMS or WhatsApp stops that channel; STOPALL, a written request to stop, or the email unsubscribe stops everything. Follow-up for that person stops as soon as the opt-out is recorded.",
    link: { href: "/help/compliance/suppression-and-unsubscribe", label: "Opt-outs and suppression" },
  },
  {
    icon: Fingerprint,
    title: "A suppression list that survives deletion",
    body: "Suppression is by address, not by record, so adding the same person again does not get round it. When someone asks to be erased, their do-not-contact entry is kept as a one-way hash: ClientTurn can still match it, but cannot read the address back.",
    link: { href: "/help/compliance/data-rights", label: "Erasure and what is kept" },
  },
  {
    icon: Clock,
    title: "Quiet hours for texts and WhatsApp",
    body: "Automated SMS and WhatsApp messages wait until your quiet hours end rather than landing late at night. The check runs again immediately before each send, not only when the message was scheduled.",
  },
  {
    icon: UserCheck,
    title: "Consent records for SMS and WhatsApp",
    body: "Texts and WhatsApp messages only go to people who gave you their mobile themselves, for example on a lead form. Consent is recorded with how and when it was given, consent without evidence counts as none, and a WhatsApp conversation needs an explicit WhatsApp opt-in, as Meta requires.",
    link: { href: "/help/compliance/consent-and-whatsapp-opt-in", label: "Consent and WhatsApp opt-in" },
  },
  {
    icon: PhoneOff,
    title: "No phone numbers from enrichment",
    body: "Cold outreach is business email only. ClientTurn never buys or looks up phone numbers, so you are not holding personal data you have no lawful use for.",
  },
];

/** The locked opener, shown with the customer's own name as a placeholder. */
const OPENER_EXAMPLE = OPENER_TEMPLATE.replace("{calling_as_name}", "{your business}");

const WEEKDAY_HOURS = DEFAULT_CALLING_HOURS.days[1];
const SATURDAY_HOURS = DEFAULT_CALLING_HOURS.days[6];

const VOICE_RULES: Safeguard[] = [
  {
    icon: PhoneCall,
    title: "Consent before any AI call",
    body: "PECR regulation 19 requires prior consent for calls made by an automated calling system, and an AI voice agent is very likely to be one. It applies to companies as well as individuals. So the agent only calls a lead who asked to be called or agreed to it on your form, with the evidence recorded. A phone number on its own is not consent, and numbers are never taken from enrichment or imports.",
  },
  {
    icon: Clock,
    title: "Calling hours in the lead's own time",
    body: `By default, weekdays ${WEEKDAY_HOURS?.start} to ${WEEKDAY_HOURS?.end} and Saturdays ${SATURDAY_HOURS?.start} to ${SATURDAY_HOURS?.end}, with no Sunday or UK bank holiday calls. You can narrow the hours but never set them earlier than ${CALLING_HOURS_BOUNDS.earliest} or later than ${CALLING_HOURS_BOUNDS.latest}. The time zone comes from the lead, or their number where it maps to one zone; if it cannot be worked out, no call is made.`,
  },
  {
    icon: Mic,
    title: "Recording notice, straight after the opener",
    body: "When you turn recording on, the call tells the person immediately after the opener, before anything else is said. When recording is off, nothing is recorded.",
  },
  {
    icon: Hash,
    title: "Your own number, and who you are on request",
    body: "Each business calls from its own dedicated UK number, never a shared, rotated or disguised one. Before voice can be switched on you give your legal entity name and a contact address or freephone number, and the agent reads those out whenever someone asks who is calling.",
  },
  {
    icon: PhoneOff,
    title: "Opt-outs end the call and stick",
    body: `If someone asks not to be called, the call ends politely and the lead is suppressed from further calls. Attempts per lead are capped, and every call has a ${CALL_BUDGET_MINUTES} minute time budget.`,
  },
  {
    icon: Scale,
    title: "Rules the AI cannot override",
    body: "Consent, calling hours, suppression and attempt limits are checked by fixed rules immediately before every dial, not by the model. Live calls made by a person on a number given without call consent are screened against TPS and CTPS first.",
  },
];

export default function CompliancePage() {
  return (
    <>
      <ScrollProgress />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      {/* -------------------------------------------------------------- hero --- */}
      <section className="pub-page-hero" aria-labelledby="compliance-hero">
        <GridTexture />
        <Glow x="right" y="top" />
        <PublicContainer>
          <div className="pub-hero-split pub-split-top">
            <Reveal>
              <SectionEyebrow className="mb-5">Compliance</SectionEyebrow>
              <h1 id="compliance-hero" className="pub-h1">
                Outreach that follows UK rules{" "}
                <span className="pub-accent">before every send.</span>
              </h1>
              <p className="pub-lead mt-6 max-w-xl">
                ClientTurn applies PECR and UK GDPR as fixed rules, checked at the
                moment each message is sent. AI never makes these decisions and
                cannot override them. Here is what that covers, in plain English,
                and what stays with you.
              </p>

              <ActionRow>
                <AnchorCta href="#pecr" size="lg">
                  See how it works
                </AnchorCta>
                <SecondaryCta placement="compliance_contact_sales" href="/contact-sales" size="lg">
                  Ask a question
                </SecondaryCta>
              </ActionRow>

              <TrustRow
                items={[
                  { icon: <Scale className="size-3.5" />, label: "Rules, not AI judgement" },
                  { icon: <Building2 className="size-3.5" />, label: "Companies House check" },
                  { icon: <Ban className="size-3.5" />, label: "Opt-outs honoured at once" },
                  { icon: <MapPin className="size-3.5" />, label: "Database hosted in London" },
                ]}
              />
            </Reveal>

            <Reveal delay={0.08}>
              <PublicCard className="pub-cell" aria-labelledby="compliance-checks">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 id="compliance-checks" className="text-base font-semibold text-[var(--pub-text)]">
                    Checked before every message
                  </h2>
                  <StatePill tone="info">At send time</StatePill>
                </div>
                <ul className="pub-ticks !mt-0 !border-t-0 !pt-0">
                  {[
                    "Is this address suppressed on this channel?",
                    "Is there a recorded, permitted source for the data?",
                    "Is the recipient a company, or a sole trader or individual?",
                    "Does the relationship allow this message on this channel?",
                    "Is a platform window open (WhatsApp, Instagram, Messenger)?",
                    "Are quiet hours in force?",
                    "Does a cold first contact carry the source line?",
                    "Does marketing email carry an unsubscribe?",
                  ].map((item) => (
                    <li key={item}>
                      <Check aria-hidden className="size-3.5" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="pub-small mt-5">
                  Each check can allow a message, block it, or hold it for a person.
                  Nothing blocked or held is sent silently, and the reason is recorded.
                </p>
              </PublicCard>
            </Reveal>
          </div>
        </PublicContainer>
      </section>

      <PublicContainer>
        <BandStack>
          {/* ------------------------------------------------------ PECR --- */}
          <Band id="pecr" divided={false} aria-labelledby="compliance-pecr">
            <div className="pub-split pub-split-top">
              <div>
                <SectionEyebrow className="mb-5">PECR</SectionEyebrow>
                <h2 id="compliance-pecr" className="pub-h2">
                  A limited company and a sole trader are not the same inbox.
                </h2>
                <p className="pub-lead mt-5">
                  PECR lets you send business email to a <strong>corporate
                  subscriber</strong> (a limited company, an LLP, a Scottish
                  partnership) without prior consent, as long as they can opt
                  out. A <strong>sole trader</strong> or an ordinary partnership
                  counts as an individual, and needs consent first.
                </p>
                <p className="pub-lead mt-4">
                  ClientTurn works out which one a prospect is from Companies
                  House, never from a column in an import. A company it cannot
                  match is treated as unknown, never assumed to be incorporated,
                  and nothing is sent until someone resolves it.
                </p>
                <p className="pub-small mt-5">
                  You choose how cautious to be in <strong>Settings → Data
                  Controls</strong>: only confirmed companies, ask me about anything
                  unclear (the default), or contact on the basis you have stated.
                  A rule that refuses a message cannot be loosened by any setting.
                </p>
              </div>

              <PublicCard className="pub-cell">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3>Cold outreach, by recipient type</h3>
                </div>
                <div className="pub-screen-scroll">
                  <table className="w-full text-[0.82rem]">
                    <thead>
                      <tr className="text-left text-[var(--pub-text-muted)]">
                        <th className="py-2 pr-3 font-medium">Recipient</th>
                        <th className="py-2 font-medium">Cold email</th>
                      </tr>
                    </thead>
                    <tbody className="text-[var(--pub-text-secondary)]">
                      {SUBSCRIBERS.map((row) => (
                        <tr key={row.type} className="border-t border-[var(--pub-border)]">
                          <td className="py-2.5 pr-3 font-medium text-[var(--pub-text)]">{row.type}</td>
                          <td className="py-2.5">
                            <StatePill tone={row.tone}>{row.outcome}</StatePill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="pub-small mt-4">
                  A sole trader who accepts your LinkedIn connection or follows you
                  can receive one non-promotional opener. Marketing waits until they
                  reply. <Link href="/help/compliance/corporate-and-individual-subscribers" className="underline underline-offset-4">Read the detail</Link>.
                </p>
              </PublicCard>
            </div>
          </Band>

          {/* ---------------------------------------- legitimate interests --- */}
          <Band aria-labelledby="compliance-li">
            <div className="pub-split pub-split-top">
              <div>
                <SectionEyebrow className="mb-5">UK GDPR</SectionEyebrow>
                <h2 id="compliance-li" className="pub-h2">
                  Legitimate interests, written down.
                </h2>
                <p className="pub-lead mt-5">
                  Emailing a named person at a company uses their personal data,
                  so UK GDPR applies even where PECR does not require consent.
                  Most B2B outreach relies on <strong>legitimate interests</strong>,
                  which means doing a legitimate interests assessment (an LIA):
                  is your purpose legitimate, is the contact necessary for it, and
                  does it respect the person&rsquo;s interests?
                </p>
              </div>
              <RevealGrid className="pub-grid">
                <PublicCard className="pub-cell">
                  <div className="pub-cell-row">
                    <GlyphTile icon={BookOpen} size={36} glyph={16} />
                    <div>
                      <h3>Your basis is recorded</h3>
                      <p>
                        In Settings → Data Controls you state the basis you rely on
                        and summarise your assessment. Until you do, cold outreach
                        is not ready and every cold contact waits for a person.
                      </p>
                    </div>
                  </div>
                </PublicCard>
                <PublicCard className="pub-cell">
                  <div className="pub-cell-row">
                    <GlyphTile icon={ShieldCheck} size={36} glyph={16} />
                    <div>
                      <h3>Evidence of every decision</h3>
                      <p>
                        Each send records the decision that allowed it, the rule
                        version in force and the facts it relied on, so you can
                        explain a message later against the rules that applied then.
                      </p>
                    </div>
                  </div>
                </PublicCard>
              </RevealGrid>
            </div>
          </Band>

          {/* -------------------------------------------------- AI calls --- */}
          <Band id="voice-calls" aria-labelledby="compliance-voice">
            <div className="pub-split pub-split-top">
              <div>
                <SectionEyebrow className="mb-5">AI voice calls</SectionEyebrow>
                <h2 id="compliance-voice" className="pub-h2">
                  Every AI call says it is an AI. Every AI call was asked for.
                </h2>
                <p className="pub-lead mt-5">
                  The AI Voice Sales Agent only calls people who asked for a call or
                  agreed to one on your form. It never makes cold calls, and the way
                  every call opens is fixed: it cannot be edited, shortened or left out.
                </p>
                <p className="pub-small mt-5">
                  Only what comes after the fixed opening is yours to word. ClientTurn
                  is not named on the call unless someone asks who built the assistant.
                </p>
              </div>

              <PublicCard className="pub-cell">
                <h3>How every call opens</h3>
                <blockquote className="mt-4 border-l-2 border-[var(--pub-lime)] pl-4 text-[var(--pub-text)]">
                  &ldquo;{OPENER_EXAMPLE}&rdquo;
                </blockquote>
                <p className="pub-small mt-4">When recording is on, it continues:</p>
                <blockquote className="mt-2 border-l-2 border-[var(--pub-border-strong)] pl-4 text-[var(--pub-text-secondary)]">
                  &ldquo;{RECORDING_NOTICE}&rdquo;
                </blockquote>
                <p className="pub-small mt-4">
                  {"{your business}"} is the trading name you set; {"{day}"} reads as
                  &ldquo;earlier today&rdquo;, &ldquo;yesterday&rdquo; or a date, in the
                  lead&rsquo;s own time zone.
                </p>
              </PublicCard>
            </div>

            <RevealGrid className="pub-grid pub-grid-3 mt-10">
              {VOICE_RULES.map((item) => (
                <PublicCard key={item.title} className="pub-cell">
                  <GlyphTile icon={item.icon} size={36} glyph={16} />
                  <h3 className="mt-4">{item.title}</h3>
                  <p>{item.body}</p>
                </PublicCard>
              ))}
            </RevealGrid>

            <p className="pub-small mt-6">
              This describes how the product behaves. It is not legal advice: you
              remain responsible for the consent you collect and the calls made in your
              name. Start with the ICO&rsquo;s{" "}
              <a
                href="https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/telephone-marketing/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                guidance on telephone marketing
              </a>
              .
            </p>
          </Band>

          {/* --------------------------------------------------- safeguards --- */}
          <Band aria-labelledby="compliance-safeguards">
            <SectionEyebrow className="mb-5">Built into every message</SectionEyebrow>
            <h2 id="compliance-safeguards" className="pub-h2">
              The safeguards you would otherwise run by hand.
            </h2>
            <RevealGrid className="pub-grid pub-grid-3 mt-8">
              {SAFEGUARDS.map((item) => (
                <PublicCard key={item.title} className="pub-cell">
                  <GlyphTile icon={item.icon} size={36} glyph={16} />
                  <h3 className="mt-4">{item.title}</h3>
                  <p>{item.body}</p>
                  {item.link ? (
                    <p>
                      <Link href={item.link.href} className="underline underline-offset-4">
                        {item.link.label}
                      </Link>
                    </p>
                  ) : null}
                </PublicCard>
              ))}
            </RevealGrid>
          </Band>

          {/* ------------------------------------------ rights and residency --- */}
          <Band aria-labelledby="compliance-rights">
            <div className="pub-columns">
              <div className="pub-column">
                <SectionEyebrow className="mb-5">Data rights</SectionEyebrow>
                <h2 id="compliance-rights" className="pub-h2 !text-[clamp(1.7rem,2.4vw,2.4rem)]">
                  Requests reach the business that holds the data.
                </h2>
                <p className="pub-lead mt-5">
                  Anyone can make a privacy request through our{" "}
                  <Link href="/privacy-request" className="underline underline-offset-4">public form</Link>.
                  Once they verify their email address, ClientTurn finds every
                  workspace that holds them and gives each one its own copy, with
                  the date they first asked, so your deadlines are tracked from
                  the right day.
                </p>
                <p className="pub-small mt-4">
                  On each lead you can export, suppress, restrict, anonymise or
                  erase, and each action says what it removes and what it keeps
                  before you confirm it.{" "}
                  <Link href="/help/compliance/data-rights" className="underline underline-offset-4">How data rights work</Link>.
                </p>
              </div>
              <div className="pub-column">
                <SectionEyebrow className="mb-5">Where data is held</SectionEyebrow>
                <h2 className="pub-h2 !text-[clamp(1.7rem,2.4vw,2.4rem)]">
                  A London database, and a published supplier list.
                </h2>
                <p className="pub-lead mt-5">
                  The application database, where your leads, messages and audit
                  records live, is hosted in London (Supabase, eu-west-2). The
                  optional AI assist runs on Microsoft Azure within the EU.
                  Uploaded files sit in storage restricted to the EU.
                </p>
                <p className="pub-small mt-4">
                  Some suppliers process data outside the UK, for example to host
                  the application or deliver email and texts. Each one, where it
                  processes data and the transfer safeguard relied on is listed on
                  our{" "}
                  <Link href="/sub-processors" className="underline underline-offset-4">sub-processor register</Link>.
                </p>
              </div>
            </div>
          </Band>

          {/* ------------------------------------------ your responsibility --- */}
          <Band aria-labelledby="compliance-yours">
            <SectionEyebrow className="mb-5">What stays with you</SectionEyebrow>
            <h2 id="compliance-yours" className="pub-h2">
              We help you comply. You remain responsible.
            </h2>

            <div className="pub-evidence mt-8" role="note">
              <span className="pub-ring pub-ring-lg" aria-hidden>
                <Info className="size-4" />
              </span>
              <div>
                <h3>This page is not legal advice.</h3>
                <p>
                  For the leads and prospects in your workspace, your business is
                  the <strong>controller</strong> and ClientTurn is your processor.
                  The product enforces rules and keeps records, but it cannot
                  decide for you whether your outreach is lawful. You are
                  responsible for:
                </p>
                <ul className="pub-ticks">
                  {[
                    "Carrying out and keeping your own legitimate interests assessment. ClientTurn records what you state; it does not assess it.",
                    "Publishing an accurate privacy notice, and keeping your legal name and privacy notice URL up to date in Data Controls.",
                    "Choosing which data sources you permit, and recording consent and relationships truthfully, with evidence.",
                    "What your messages say, including any claim, price or promise, and the messages you send yourself on LinkedIn or elsewhere.",
                    "Responding to privacy requests on time, and your own registration with the ICO where it applies.",
                  ].map((item) => (
                    <li key={item}>
                      <Check aria-hidden className="size-3.5" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p>
                  ClientTurn holds no compliance certification that we could
                  evidence here, so we do not claim one. The ICO is the
                  authoritative source; start with its{" "}
                  <a
                    href="https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    guidance on the PECR email marketing rules
                  </a>
                  .
                </p>
              </div>
            </div>
          </Band>

          {/* ------------------------------------------------- final CTA --- */}
          <Reveal>
            <FinalCtaBand
              eyebrow="Reach decision makers the right way"
              title={
                <>
                  Outreach you can explain.{" "}
                  <span className="pub-accent">Every time.</span>
                </>
              }
              body="Set up Data Controls once, and every message after that is checked against it at the moment it is sent."
              actions={
                <>
                  <PrimaryCta placement="compliance_final" size="lg">
                    Start free
                  </PrimaryCta>
                  <SecondaryCta placement="compliance_guide" href="/help/compliance/compliance-overview" size="lg">
                    Read the compliance guide
                  </SecondaryCta>
                </>
              }
              points={[
                {
                  icon: <Scale className="size-4" />,
                  title: "Fixed rules",
                  body: "PECR and UK GDPR checks AI cannot override.",
                },
                {
                  icon: <Mail className="size-4" />,
                  title: "Cold email done right",
                  body: "Source line, unsubscribe and suppression built in.",
                },
                {
                  icon: <Building2 className="size-4" />,
                  title: "Company or sole trader",
                  body: "Checked against Companies House, not guessed.",
                },
                {
                  icon: <FileText className="size-4" />,
                  title: "Evidence on file",
                  body: "Every decision recorded with the rule behind it.",
                },
              ]}
            />
          </Reveal>
        </BandStack>
      </PublicContainer>
    </>
  );
}
