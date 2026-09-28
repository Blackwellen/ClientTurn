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
    title: "The source line on the first message",
    body: "UK GDPR Article 14: the first cold email says where their details came from and links your privacy notice. Never AI-written. Held if the source or notice URL is missing.",
    link: { href: "/help/compliance/article-14-source-disclosure", label: "How the source line works" },
  },
  {
    icon: MessageSquareOff,
    title: "Opt-outs on every message, honoured at once",
    body: "Marketing email carries an unsubscribe link and one-click header. STOP ends that channel; STOPALL, a written request or email unsubscribe ends everything.",
    link: { href: "/help/compliance/suppression-and-unsubscribe", label: "Opt-outs and suppression" },
  },
  {
    icon: Fingerprint,
    title: "Suppression that survives deletion",
    body: "Suppression is by address, so re-adding someone does not bypass it. After erasure, a one-way hash keeps them blocked without storing the address.",
    link: { href: "/help/compliance/data-rights", label: "Erasure and what is kept" },
  },
  {
    icon: Clock,
    title: "Quiet hours for texts and WhatsApp",
    body: "Automated SMS and WhatsApp wait until quiet hours end, re-checked immediately before each send.",
  },
  {
    icon: UserCheck,
    title: "Consent records for SMS and WhatsApp",
    body: "Texts and WhatsApp only go to mobiles people gave you themselves, with how and when recorded. No evidence means no consent. WhatsApp needs an explicit opt-in, as Meta requires.",
    link: { href: "/help/compliance/consent-and-whatsapp-opt-in", label: "Consent and WhatsApp opt-in" },
  },
  {
    icon: PhoneOff,
    title: "No phone numbers from enrichment",
    body: "Cold outreach is business email only. ClientTurn never buys or looks up phone numbers.",
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
    body: "PECR regulation 19 requires prior consent for automated calls, which very likely covers an AI agent, for companies too. The agent only calls leads who asked or agreed on your form, with evidence recorded. A number alone is not consent, and none come from enrichment or imports.",
  },
  {
    icon: Clock,
    title: "Calling hours in the lead's own time",
    body: `Default: weekdays ${WEEKDAY_HOURS?.start} to ${WEEKDAY_HOURS?.end}, Saturdays ${SATURDAY_HOURS?.start} to ${SATURDAY_HOURS?.end}, no Sundays or UK bank holidays. You can narrow them, never beyond ${CALLING_HOURS_BOUNDS.earliest} to ${CALLING_HOURS_BOUNDS.latest}. If the lead's time zone is unknown, no call is made.`,
  },
  {
    icon: Mic,
    title: "Recording notice, straight after the opener",
    body: "With recording on, the call says so right after the opener, before anything else. With it off, nothing is recorded.",
  },
  {
    icon: Hash,
    title: "Your own number, and who you are on request",
    body: "Each business calls from its own dedicated UK number, never shared, rotated or disguised. Your legal name and a contact address or freephone number are required, and read out on request.",
  },
  {
    icon: PhoneOff,
    title: "Opt-outs end the call and stick",
    body: `If someone asks not to be called, the call ends politely and the lead is suppressed. Attempts are capped, and each call has a ${CALL_BUDGET_MINUTES} minute budget.`,
  },
  {
    icon: Scale,
    title: "Rules the AI cannot override",
    body: "Consent, calling hours, suppression and attempt limits are fixed rules checked before every dial, not by the model. Human calls without call consent are screened against TPS and CTPS first.",
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
                PECR and UK GDPR applied as fixed rules at the moment each message
                is sent. AI never makes these decisions and cannot override them.
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
                  Each check can allow, block or hold a message for a person. The
                  reason is always recorded.
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
                  PECR lets you email a <strong>corporate subscriber</strong> (a
                  limited company, LLP or Scottish partnership) without prior
                  consent, if they can opt out. A <strong>sole trader</strong> or
                  ordinary partnership counts as an individual and needs consent
                  first.
                </p>
                <ul className="pub-ticks">
                  {[
                    "Status comes from Companies House, never an import column.",
                    "An unmatched company is unknown, never assumed incorporated. Nothing is sent until resolved.",
                    "Set your caution level in Settings → Data Controls; asking you about unclear cases is the default.",
                    "No setting can loosen a rule that refuses a message.",
                  ].map((item) => (
                    <li key={item}>
                      <Check aria-hidden className="size-3.5" />
                      {item}
                    </li>
                  ))}
                </ul>
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
                  A sole trader who connects or follows you on LinkedIn can get one
                  non-promotional opener; marketing waits for a reply. <Link href="/help/compliance/corporate-and-individual-subscribers" className="underline underline-offset-4">Read the detail</Link>.
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
                  Emailing a named person uses personal data, so UK GDPR applies
                  even where PECR needs no consent. Most B2B outreach relies on{" "}
                  <strong>legitimate interests</strong>, backed by a legitimate
                  interests assessment (LIA).
                </p>
              </div>
              <RevealGrid className="pub-grid">
                <PublicCard className="pub-cell">
                  <div className="pub-cell-row">
                    <GlyphTile icon={BookOpen} size={36} glyph={16} />
                    <div>
                      <h3>Your basis is recorded</h3>
                      <p>
                        State your basis and summarise your assessment in Data
                        Controls. Until then, every cold contact waits for a person.
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
                        Each send records the decision, the rule version in force
                        and the facts it relied on.
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
                  agreed to one on your form. It never makes cold calls, and its
                  opening cannot be edited, shortened or skipped.
                </p>
                <p className="pub-small mt-5">
                  Only what follows the opener is yours to word. ClientTurn is not
                  named unless someone asks who built the assistant.
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
                  {"{your business}"} is your trading name; {"{day}"} reads as
                  &ldquo;earlier today&rdquo;, &ldquo;yesterday&rdquo; or a date.
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
              This describes product behaviour and is not legal advice. You remain
              responsible for the consent you collect and calls made in your name.
              See the ICO&rsquo;s{" "}
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
                  Once verified, every workspace holding them gets its own copy,
                  dated from the first request, so deadlines run from the right day.
                </p>
                <p className="pub-small mt-4">
                  Export, suppress, restrict, anonymise or erase any lead, with what
                  is removed and kept shown before you confirm.{" "}
                  <Link href="/help/compliance/data-rights" className="underline underline-offset-4">How data rights work</Link>.
                </p>
              </div>
              <div className="pub-column">
                <SectionEyebrow className="mb-5">Where data is held</SectionEyebrow>
                <h2 className="pub-h2 !text-[clamp(1.7rem,2.4vw,2.4rem)]">
                  A London database, and a published supplier list.
                </h2>
                <p className="pub-lead mt-5">
                  The application database, holding your leads, messages and audit
                  records, is hosted in London (Supabase, eu-west-2). Optional AI
                  assist runs on Microsoft Azure in the EU; uploaded files stay in
                  EU-restricted storage.
                </p>
                <p className="pub-small mt-4">
                  Some suppliers process data outside the UK. Each one, where, and
                  the transfer safeguard relied on are listed on our{" "}
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
                  The product enforces rules and keeps records; it cannot decide
                  whether your outreach is lawful. You are responsible for:
                </p>
                <ul className="pub-ticks">
                  {[
                    "Your legitimate interests assessment. ClientTurn records it; it does not assess it.",
                    "An accurate privacy notice, with your legal name and notice URL kept current.",
                    "Which data sources you permit, and truthful consent and relationship records.",
                    "What your messages say, including claims, prices and messages you send yourself.",
                    "Answering privacy requests on time, and ICO registration where it applies.",
                  ].map((item) => (
                    <li key={item}>
                      <Check aria-hidden className="size-3.5" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p>
                  ClientTurn holds no compliance certification it could evidence,
                  so it claims none. The ICO is the authoritative source; see its{" "}
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
              body="Set up Data Controls once; every message is checked against it at send time."
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
