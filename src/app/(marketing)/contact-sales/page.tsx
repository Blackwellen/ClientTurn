import type { Metadata } from "next";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Compass,
  Handshake,
  Headphones,
  Layers,
  MessagesSquare,
  Plug,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { COMPANY } from "@/lib/marketing/company";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import {
  PublicContainer,
  PublicCard,
  SectionEyebrow,
  GlyphTile,
  GridTexture,
  Glow,
} from "@/components/marketing/public/ui";
import {
  Band,
  BandStack,
  StepRail,
  TrustRow,
} from "@/components/marketing/public/shell";
import {
  Reveal,
  RevealGrid,
  ScrollProgress,
} from "@/components/marketing/public/reveal";
import {
  PrimaryCta,
  SecondaryCta,
  AnchorCta,
  ActionRow,
} from "@/components/marketing/public/actions";
import { FinalCtaBand } from "@/components/marketing/public/final-cta";
import { PublicFaq, FaqJsonLd, type FaqItem } from "@/components/marketing/public/faq";
import { SalesForm } from "@/components/marketing/public/contact-sales/sales-form";
import {
  AppFrame,
  DashboardFrame,
} from "@/components/marketing/public/home/app-frames";
import { IllustrativeNote } from "@/components/marketing/public/screen";

const title = "Contact Sales";
const description =
  "Tell us about your goals, volume and requirements and we will help work out the right ClientTurn setup — integrations, security, custom entitlements and implementation.";
const path = "/contact-sales";

const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com"
).replace(/\/$/, "");

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "contact ClientTurn sales",
    "lead management software demo",
    "enterprise lead management sales",
    "AI prospecting software demo",
  ],
  alternates: { canonical: path },
  openGraph: {
    title: `${title} · ClientTurn`,
    description,
    url: path,
    siteName: "ClientTurn",
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${title} · ClientTurn`,
    description,
  },
};

const STEPS = [
  {
    title: "Submit your details",
    body: "Tell us your volumes, your systems and what you are trying to fix.",
  },
  {
    title: "Discovery call",
    body: "We talk through your requirements and answer questions — including the ones about what we cannot do.",
  },
  {
    title: "Tailored recommendation",
    body: "The right plan or entitlements for your setup, with an integration and implementation approach.",
  },
  {
    title: "Move forward",
    body: "Implementation, or a trial with the configuration we agreed. Whichever makes more sense for you.",
  },
] as const;

const FAQS: FaqItem[] = [
  {
    q: "How quickly will you get back to me?",
    a: `We read every enquiry and reply by email. We have not published a guaranteed response time because we are not yet prepared to commit to one we might miss — if your timeline is tight, say so in the message and we will treat it accordingly. Response-time commitments can be agreed as part of an Enterprise contract.`,
  },
  {
    q: "What should I have ready?",
    a: "Nothing formal. It helps to know roughly how many enquiries or prospects you handle a month, which systems the leads currently land in, and what the current process looks like when someone enquires. If you already have qualification criteria written down, bring them — that is usually the longest part of setup.",
  },
  {
    q: "Is there any obligation?",
    a: "None. A discovery call is a conversation, not a commitment, and there is no minimum term on any self-serve plan either. If ClientTurn is not the right fit we would rather tell you on the first call than after you have signed.",
  },
  {
    q: "Can you help with integrations?",
    a: "Yes, and we will be straight about which ones are a switch and which are a project. Several providers connect from Settings today, some are connected with our team, and anything else is a technical discovery conversation before it is a commitment. The Enterprise page lists the current state of each.",
  },
  {
    q: "Do you work with multiple locations or teams?",
    a: "Yes, as separate isolated workspaces per location or business unit. One current limitation worth knowing before the call: there is no in-app workspace switcher yet and no combined cross-workspace report, so someone covering two locations signs in to each. If a single pane across locations matters to you, raise it early.",
  },
  {
    q: "Can we get a demo?",
    a: "Yes. We can walk through the product on the discovery call. You can also start the free trial and see it on your own leads without talking to anyone first — quite a few people prefer that, and it is a better test than a scripted demo.",
  },
  {
    q: "What happens after I submit the form?",
    a: "Your enquiry is recorded and a member of the team reads it. We reply by email to arrange a call at a time that suits you. We only use what you send to respond to your enquiry; marketing updates are a separate, optional checkbox on the form.",
  },
  {
    q: "Do you offer custom contracts?",
    a: "Yes, for Enterprise. Custom entitlements, volume pricing, purchase orders and invoicing, a data processing agreement and agreed support terms are all part of that conversation. Self-serve plans use standard terms and are cancelled from billing settings at any time.",
  },
];

export default function ContactSalesPage() {
  return (
    <>
      <ScrollProgress />
      <FaqJsonLd items={FAQS} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "BreadcrumbList",
                itemListElement: [
                  {
                    "@type": "ListItem",
                    position: 1,
                    name: "Home",
                    item: siteUrl,
                  },
                  {
                    "@type": "ListItem",
                    position: 2,
                    name: "Contact Sales",
                    item: `${siteUrl}${path}`,
                  },
                ],
              },
              {
                "@type": "Organization",
                name: COMPANY.product,
                legalName: COMPANY.registeredName,
                url: siteUrl,
                email: COMPANY.supportEmail,
                contactPoint: [
                  {
                    "@type": "ContactPoint",
                    contactType: "sales",
                    email: COMPANY.supportEmail,
                    areaServed: "GB",
                    availableLanguage: "English",
                  },
                ],
              },
            ],
          }),
        }}
      />

      {/* -------------------------------------------------------------- hero --- */}
      <section className="pub-page-hero" aria-labelledby="cs-hero">
        <GridTexture />
        <Glow x="right" y="top" />
        <PublicContainer>
          <div className="pub-hero-split pub-split-top">
            <Reveal>
              <SectionEyebrow className="mb-5">Contact sales</SectionEyebrow>
              <h1 id="cs-hero" className="pub-h1">
                Let&rsquo;s build the right solution for{" "}
                <span className="pub-accent">your business.</span>
              </h1>
              <p className="pub-lead mt-6 max-w-xl">
                Talk to us about your goals, volumes, integrations and
                requirements. We will help you work out the right ClientTurn
                setup — and tell you plainly if something you need is not there
                yet.
              </p>

              <TrustRow
                items={[
                  {
                    icon: <Target className="size-3.5" />,
                    label: "Tailored to your requirements",
                  },
                  {
                    icon: <Compass className="size-3.5" />,
                    label: "Expert guidance, no obligation",
                  },
                  {
                    icon: <Plug className="size-3.5" />,
                    label: "Integration discovery",
                  },
                  {
                    icon: <ShieldCheck className="size-3.5" />,
                    label: "Security and commercial support",
                  },
                ]}
              />

              <div className="mt-10">
                <div>
                  <AppFrame label="ClientTurn lead conversion dashboard showing connection status, lead and booking counts, the conversion funnel and estimated pipeline.">
                    <DashboardFrame />
                  </AppFrame>
                  <IllustrativeNote />
                </div>
              </div>
            </Reveal>

            <Reveal delay={0.08}>
              <div id="enquiry">
                <SalesForm />
              </div>
            </Reveal>
          </div>
        </PublicContainer>
      </section>

      <PublicContainer>
        <BandStack>
          {/* --------------------------------------------- why talk to us --- */}
          <Band aria-labelledby="cs-why">
              <SectionEyebrow className="mb-5">
                Why talk to sales?
              </SectionEyebrow>
              <h2 id="cs-why" className="pub-h2">
                More than a product. A partnership.
              </h2>
              <p className="pub-lead mt-5 max-w-3xl">
                We can help design the right setup, connect it to the systems
                you already run, and support your team from rollout to results.
              </p>

              <RevealGrid className="pub-grid pub-grid-4 mt-10">
                {[
                  {
                    icon: Layers,
                    title: "Custom configuration",
                    body: "Entitlements, workflows, qualification rules and team structure shaped around how you actually work.",
                  },
                  {
                    icon: Plug,
                    title: "Integration support",
                    body: "We scope what connects today, what needs work, and what is not realistic — before you commit.",
                  },
                  {
                    icon: ShieldCheck,
                    title: "Security and compliance",
                    body: "Straight answers on data handling, isolation, audit logging and procurement paperwork.",
                  },
                  {
                    icon: Headphones,
                    title: "Dedicated support",
                    body: "A named contact through implementation and beyond on an Enterprise agreement.",
                  },
                ].map((item) => (
                  <PublicCard key={item.title} interactive className="pub-cell">
                    <GlyphTile icon={item.icon} size={38} glyph={17} />
                    <h3 className="mt-4">{item.title}</h3>
                    <p>{item.body}</p>
                  </PublicCard>
                ))}
              </RevealGrid>
          </Band>

          {/* ------------------------------------------------ the process --- */}
          <Band aria-labelledby="cs-process">
              <SectionEyebrow className="mb-5">
                What happens next
              </SectionEyebrow>
              <h2 id="cs-process" className="pub-h2">
                From enquiry to a tailored plan.
              </h2>
              <p className="pub-lead mt-5 max-w-3xl">
                Four steps, kept deliberately short so you get the information
                you need without a procurement process attached to it.
              </p>

              <StepRail steps={STEPS} />
          </Band>

          {/* ------------------------------- who it is for + use cases --- */}
          <Band>
            <div className="pub-columns">
              <Reveal className="pub-column">
                <div aria-labelledby="cs-who">
                  <h2 id="cs-who" className="pub-h2 !text-[clamp(1.5rem,2vw,2rem)]">
                    Who is this for?
                  </h2>
                  <p className="pub-lead mt-4">
                    We work with businesses that need a more tailored setup than
                    the self-serve plans cover, including:
                  </p>
                  <ul className="pub-checks">
                    {[
                      "Higher lead or prospect volumes than the published plans include",
                      "Multiple locations or business units",
                      "Custom integration requirements",
                      "Security, compliance or procurement review",
                      "Dedicated onboarding and support",
                    ].map((item) => (
                      <li key={item}>
                        <CheckCircle2 className="size-4" aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="pub-small mt-6">
                    If none of these apply, the {TRIAL_DAYS}-day trial will
                    probably answer your questions faster than we can.
                  </p>
                  <ActionRow>
                    <SecondaryCta
                      placement="contact_sales_start_free"
                      href="/pricing"
                    >
                      Compare self-serve plans
                    </SecondaryCta>
                  </ActionRow>
                </div>
              </Reveal>
  
              <Reveal delay={0.06} className="pub-column">
                <div aria-labelledby="cs-cases">
                  <h2
                    id="cs-cases"
                    className="pub-h2 !text-[clamp(1.5rem,2vw,2rem)]"
                  >
                    Common use cases
                  </h2>
                  <p className="pub-lead mt-4">
                    The conversations we have most often:
                  </p>
                  <ul className="mt-6 grid gap-3">
                    {[
                      {
                        icon: MessagesSquare,
                        label: "Lead Conversion for inbound enquiries",
                      },
                      { icon: Search, label: "Find Leads for new pipeline" },
                      {
                        icon: Sparkles,
                        label: "Both acquisition and conversion together",
                      },
                      {
                        icon: Plug,
                        label: "Integration with an existing CRM or calendar",
                      },
                      { icon: Building2, label: "Multi-location operations" },
                      {
                        icon: ShieldCheck,
                        label: "Security and data requirements",
                      },
                      { icon: Users, label: "Custom workflows and team structures" },
                    ].map((item) => (
                      <li
                        key={item.label}
                        className="flex items-center gap-3 rounded-[10px] border border-[var(--pub-border)] bg-[var(--pub-bg-raised)] px-3.5 py-3 text-[0.82rem] text-[var(--pub-text-secondary)]"
                      >
                        <GlyphTile icon={item.icon} size={30} glyph={14} />
                        {item.label}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </Band>

          {/* -------------------------------------------------------- FAQ --- */}
          <Band aria-labelledby="contact-sales-faq-heading">
              <PublicFaq
                id="contact-sales-faq"
                eyebrow="Common questions"
                title="Frequently asked questions."
                items={FAQS}
                event="contact_sales_faq_expand"
                aside={
                  <p className="pub-small">
                    Prefer email?{" "}
                    <a
                      className="pub-link"
                      href={`mailto:${COMPANY.supportEmail}?subject=${encodeURIComponent(
                        "ClientTurn sales enquiry",
                      )}`}
                    >
                      {COMPANY.supportEmail}
                    </a>
                  </p>
                }
              />
          </Band>

          {/* ------------------------------------------------- final CTA --- */}
          <Reveal>
            <FinalCtaBand
              eyebrow="Ready to talk?"
              title={
                <>
                  Let&rsquo;s create more opportunities{" "}
                  <span className="pub-accent">together.</span>
                </>
              }
              body="Whether you need higher volumes, custom integrations or support with complex requirements, the team is here to help."
              actions={
                <>
                  <AnchorCta href="#enquiry" size="lg">
                    Request a call
                  </AnchorCta>
                  <PrimaryCta
                    placement="contact_sales_start_free"
                    size="lg"
                  >
                    Start free
                  </PrimaryCta>
                </>
              }
              points={[
                {
                  icon: <Handshake className="size-4" />,
                  title: "Speak to a real person",
                  body: "Expert guidance, not a scripted qualification call.",
                },
                {
                  icon: <CalendarClock className="size-4" />,
                  title: "Flexible scheduling",
                  body: "We arrange a time that suits you.",
                },
                {
                  icon: <Target className="size-4" />,
                  title: "Tailored recommendation",
                  body: "Built around your volumes and systems.",
                },
                {
                  icon: <ShieldCheck className="size-4" />,
                  title: "No obligation",
                  body: "No minimum term on self-serve plans either.",
                },
              ]}
            />
          </Reveal>
        </BandStack>
      </PublicContainer>
    </>
  );
}
