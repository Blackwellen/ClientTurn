import type { Metadata } from "next";
import {
  Building2,
  CheckCircle2,
  Database,
  FileText,
  Gauge,
  Handshake,
  Headphones,
  Layers,
  Lock,
  Plug,
  Scale,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  SECURITY_CONTROLS,
  STATUS_LABEL,
  unavailableControls,
  type ControlStatus,
} from "@/lib/marketing/security";
import { showcaseProviders, showcaseConnectors } from "@/lib/marketing/integrations";
import {
  AVAILABILITY_LABEL,
  type MarketingAvailability,
} from "@/lib/marketing/integration-types";
import { PLANS } from "@/lib/billing/plans";
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
  StatePill,
  type StateTone,
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
import {
  AppFrame,
  DashboardFrame,
} from "@/components/marketing/public/home/app-frames";
import { IllustrativeNote } from "@/components/marketing/public/screen";

const title = "Enterprise";
const description =
  "ClientTurn for complex, high-volume lead operations: custom entitlements, workspace isolation, role-based access, audit logging, integration discovery and implementation support.";
const path = "/enterprise";

const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com"
).replace(/\/$/, "");

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "enterprise lead management software",
    "enterprise lead generation software",
    "multi-location lead management",
    "enterprise prospecting platform",
    "enterprise lead automation",
  ],
  alternates: { canonical: path },
  openGraph: {
    title: `${title}`,
    description,
    url: path,
    siteName: "ClientTurn",
    locale: "en_GB",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${title}`,
    description,
  },
};

/** How a security control's status is shown. Nothing unbuilt reads as available. */
const CONTROL_TONE: Record<ControlStatus, StateTone> = {
  in_place: "go",
  configurable: "info",
  on_request: "muted",
  not_available: "stop",
};

/**
 * How each availability state is shown. `coming_soon` is deliberately given
 * the "stop" tone rather than a hopeful one: on an enterprise page, a provider
 * that cannot be connected today must not read like one that can.
 */
const INTEGRATION_TONE: Record<MarketingAvailability, StateTone> = {
  native_live: "go",
  webhook_bridge_live: "info",
  platform_managed: "info",
  coming_soon: "stop",
};

const INTEGRATION_NOTE: Record<MarketingAvailability, string> = {
  native_live: "Connect your own account from Settings today.",
  webhook_bridge_live:
    "Delivered through our signed inbound webhook bridge.",
  platform_managed:
    "Run by ClientTurn. Nothing for you to connect.",
  coming_soon:
    "Set up with our team during implementation.",
};

/**
 * The six security themes the reference shows.
 *
 * Each is a heading over controls that live in `SECURITY_CONTROLS`; the
 * register beside them carries the per-control status, so nothing here can
 * imply a control the catalogue marks unavailable.
 */
const SECURITY_GROUPS = [
  {
    icon: ShieldCheck,
    heading: "Secure by design",
    body: "Row-level security, server-only secrets and short-lived signed file access.",
  },
  {
    icon: Users,
    heading: "Authentication and access",
    body: "Server-checked roles. Step-up verification for platform administration.",
  },
  {
    icon: Layers,
    heading: "Data isolation",
    body: "Each workspace is a separate tenant, with no cross-workspace read path.",
  },
  {
    icon: FileText,
    heading: "Audit and monitoring",
    body: "Configuration and lifecycle changes logged, append-only, against the acting user.",
  },
  {
    icon: Gauge,
    heading: "AI governance",
    body: "Deterministic rules decide. AI assists within bounds and is off by default.",
  },
  {
    icon: Lock,
    heading: "Payments and billing",
    body: "Cards are entered on Stripe's pages. We store a reference, not a card.",
  },
] as const;

const IMPLEMENTATION = [
  {
    title: "Discovery",
    body: "Map your volumes, sources, systems, teams and procurement requirements.",
  },
  {
    title: "Solution design",
    body: "Entitlements, workspaces, integrations, rules and routing, agreed in writing.",
  },
  {
    title: "Implementation",
    body: "Provision workspaces, connect systems and configure rules with you.",
  },
  {
    title: "Testing and training",
    body: "Validate end to end on real data, then train your team.",
  },
  {
    title: "Go live",
    body: "Switch on, monitor the first cohort and review against the design.",
  },
] as const;

const FAQS: FaqItem[] = [
  {
    q: "Can ClientTurn support multiple business units or locations?",
    a: "Yes, each as its own isolated workspace with its own leads, rules, members and reporting. There is no workspace switcher or combined cross-workspace report yet, so people sign in to each separately. If you need a single view across locations, tell us at discovery.",
  },
  {
    q: "Can you integrate with our CRM?",
    a: "HubSpot and Zoho CRM connect in the app today. Salesforce is built and rolling out; until it is verified with a live org, our team connects it with you. Anything else is a discovery conversation, and we will say what is realistic before you commit.",
  },
  {
    q: "Do you offer a data processing agreement?",
    a: "Yes, as part of an Enterprise agreement. Use ours or send us yours. Our sub-processor list is published and kept current.",
  },
  {
    q: "Is SSO or SAML available?",
    a: "Not today. Sign-in is email and password with email verification, and workspace MFA is not yet available; step-up verification covers platform administration only. If SSO is a hard requirement, raise it before you evaluate.",
  },
  {
    q: "Are you SOC 2 or ISO 27001 certified?",
    a: "No, and we will not imply otherwise. We will walk you through the controls actually in place and answer your security questionnaire honestly. If a certification is a procurement gate, talk to us early.",
  },
  {
    q: "Can we negotiate custom limits?",
    a: "Yes. Enterprise entitlements are set per contract, not from the public rate card. Leads, prospects, sourcing, messaging, sending identities, users and workspaces are all configurable.",
  },
  {
    q: "What support is included?",
    a: `Enterprise includes a dedicated support contact and onboarding assistance. ${PLANS.pro.name} and below use standard support. Response times are agreed per contract; we publish no blanket SLA.`,
  },
  {
    q: "How does implementation work?",
    a: "Five stages: discovery, solution design, implementation, testing and training, then go live. Timing depends mostly on how many systems connect and how much of your qualification logic is already written down.",
  },
  {
    q: "Where is our data stored?",
    a: "The database runs in Supabase's eu-west-2 (London) region, and AI assistance uses EU Azure OpenAI endpoints. Uploaded files sit in Cloudflare R2, reached only through short-lived signed URLs. We will walk you through the full data-flow and sub-processor map.",
  },
  {
    q: "How does Enterprise pricing work?",
    a: "It is priced against your requirements, not published. Volume, users, workspaces, support and terms all feed in, and we quote accurately after discovery.",
  },
];

export default function EnterprisePage() {
  /*
   * Availability is derived by `showcaseProviders` from the provider registry
   * and the credentials this deployment actually holds — so the page cannot
   * claim a connection the app would refuse to make.
   */
  const providers = showcaseProviders();
  const connectors = showcaseConnectors();
  const liveCount = providers.filter((p) => p.availability === "native_live").length;
  const managedCount = providers.filter(
    (p) => p.availability === "platform_managed",
  ).length;

  const providerGroups = Array.from(
    providers.reduce((groups, provider) => {
      const list = groups.get(provider.category) ?? [];
      list.push(provider);
      groups.set(provider.category, list);
      return groups;
    }, new Map<string, typeof providers>()),
  );
  const gaps = unavailableControls();

  return (
    <>
      <ScrollProgress />
      <FaqJsonLd items={FAQS} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
              {
                "@type": "ListItem",
                position: 2,
                name: "Enterprise",
                item: `${siteUrl}${path}`,
              },
            ],
          }),
        }}
      />

      {/* -------------------------------------------------------------- hero --- */}
      <section className="pub-page-hero" aria-labelledby="ent-hero">
        <GridTexture />
        <Glow x="right" y="top" />
        <PublicContainer>
          <div className="pub-hero-split pub-hero-copy-wide">
            <Reveal>
              <SectionEyebrow className="mb-5">Enterprise</SectionEyebrow>
              <h1 id="ent-hero" className="pub-h1">
                ClientTurn for complex,{" "}
                <span className="pub-accent">high-volume lead operations.</span>
              </h1>
              <p className="pub-lead mt-6 max-w-xl">
                Custom entitlements, stronger controls and implementation
                support, with straight answers on what we do not support yet.
              </p>

              <ActionRow>
                <PrimaryCta
                  placement="enterprise_hero"
                  href="/contact-sales"
                  size="lg"
                >
                  Talk to sales
                </PrimaryCta>
                <AnchorCta href="#scale" size="lg">
                  See enterprise capabilities
                </AnchorCta>
              </ActionRow>

              <TrustRow
                items={[
                  {
                    icon: <Scale className="size-3.5" />,
                    label: "Scale with confidence",
                  },
                  {
                    icon: <ShieldCheck className="size-3.5" />,
                    label: "Enterprise-grade controls",
                  },
                  {
                    icon: <Plug className="size-3.5" />,
                    label: "Integrate with your systems",
                  },
                  {
                    icon: <Headphones className="size-3.5" />,
                    label: "Dedicated support",
                  },
                ]}
              />
            </Reveal>

            <Reveal delay={0.08}>
              <div>
                  <AppFrame label="ClientTurn lead conversion dashboard showing connection status, lead and booking counts, the conversion funnel and estimated pipeline.">
                    <DashboardFrame />
                  </AppFrame>
                  <IllustrativeNote />
                </div>
            </Reveal>
          </div>
        </PublicContainer>
      </section>

      <PublicContainer>
        <BandStack>
          {/* ------------------------------------------------------ scale --- */}
          <Band id="scale" aria-labelledby="ent-scale">
              <div className="pub-split pub-split-narrow">
                <div>
                  <SectionEyebrow className="mb-5">Scale</SectionEyebrow>
                  <h2 id="ent-scale" className="pub-h2">
                    Grow without operational limits.
                  </h2>
                  <p className="pub-lead mt-5">
                    Every allowance is set per contract, not from the public
                    rate card, and raised without a release.
                  </p>
                  <ul className="pub-checks">
                    {[
                      "High-volume lead capture and management",
                      "Large-scale sourcing and verification",
                      "Multi-team outreach and follow-up",
                      "Support for multiple brands and markets",
                    ].map((item) => (
                      <li key={item}>
                        <CheckCircle2 className="size-4" aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="pub-small mt-6">
                    No allowance is unlimited. Every limit is a visible number
                    in your contract.
                  </p>
                </div>

                <RevealGrid className="pub-grid pub-grid-2">
                  {[
                    {
                      icon: Layers,
                      title: "Isolated workspaces",
                      body: "Each brand, region or unit is its own tenant.",
                    },
                    {
                      icon: Users,
                      title: "Larger teams",
                      body: "Server-enforced roles and an audit trail of who changed what.",
                    },
                    {
                      icon: Database,
                      title: "Large data operations",
                      body: "Built for high-volume sourcing, verification and outreach.",
                    },
                    {
                      icon: Gauge,
                      title: "Retry-safe processing",
                      body: "State is re-read before every external action, so retries never double-send.",
                    },
                  ].map((item) => (
                    <PublicCard key={item.title} interactive className="pub-cell">
                      <GlyphTile icon={item.icon} size={38} glyph={17} />
                      <h3 className="mt-4">{item.title}</h3>
                      <p>{item.body}</p>
                    </PublicCard>
                  ))}
                </RevealGrid>
              </div>
          </Band>

          {/* --------------------------------------------- multi-location --- */}
          <Band aria-labelledby="ent-locations">
              <div className="pub-split">
                <div>
                  <AppFrame label="ClientTurn lead conversion dashboard showing connection status, lead and booking counts, the conversion funnel and estimated pipeline.">
                    <DashboardFrame />
                  </AppFrame>
                  <IllustrativeNote />
                </div>

                <div>
                  <SectionEyebrow className="mb-5">
                    Multi-location operations
                  </SectionEyebrow>
                  <h2 id="ent-locations" className="pub-h2">
                    Run each location as its own isolated workspace.
                  </h2>
                  <p className="pub-lead mt-5">
                    Isolation is enforced in the database by row-level
                    security, not just in the interface.
                  </p>
                  <ul className="pub-checks">
                    {[
                      "Per-workspace rules, sequences and routing",
                      "Roles checked on the server for every privileged action",
                      "Audit trail of configuration and lifecycle changes",
                      "Provisioned with our team during implementation",
                    ].map((item) => (
                      <li key={item}>
                        <CheckCircle2 className="size-4" aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>

                  {/*
                    Stated on the page rather than left for the buyer to
                    discover in a trial. A multi-location prospect will hit this
                    in week one; finding it here costs us a lead, and finding it
                    later costs us the account.
                  */}
                  <div className="pub-evidence mt-8">
                    <span className="pub-ring pub-ring-lg" aria-hidden>
                      <Lock className="size-4" />
                    </span>
                    <div>
                      <h3>One limitation, stated plainly</h3>
                      <p>
                        There is no workspace switcher or combined report
                        across workspaces yet, so people sign in to each
                        separately. If that matters, raise it at discovery.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
          </Band>

          {/* ----------------------------------------------- integrations --- */}
          <Band aria-labelledby="ent-integrations">
              <SectionEyebrow className="mb-5">Integrations</SectionEyebrow>
              <h2 id="ent-integrations" className="pub-h2">
                Connect ClientTurn to your existing systems.
              </h2>
              <p className="pub-lead mt-5 max-w-3xl">
                {liveCount + managedCount + connectors.length} systems from the
                product&rsquo;s own provider registry. Connect them from
                Settings, or we set them up with you.
              </p>

              <div className="mt-10">
                {providerGroups.map(([category, items]) => (
                  <div key={category} className="pub-tile-group">
                    <h3>{category}</h3>
                    <div className="pub-tiles">
                      {items.map((item) => (
                        <div key={item.id} className="pub-tile-card">
                          <strong>{item.name}</strong>
                          <StatePill tone={INTEGRATION_TONE[item.availability]}>
                            {AVAILABILITY_LABEL[item.availability]}
                          </StatePill>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="pub-tile-group">
                  <h3>Inbound webhook bridge</h3>
                  <div className="pub-tiles">
                    {connectors.map((connector) => (
                      <div key={connector.id} className="pub-tile-card">
                        <strong>{connector.name}</strong>
                        <StatePill tone={INTEGRATION_TONE[connector.availability]}>
                          {AVAILABILITY_LABEL[connector.availability]}
                        </StatePill>
                      </div>
                    ))}
                  </div>
                  <p className="pub-small mt-4">
                    These send leads into ClientTurn. They are not a two-way
                    sync.
                  </p>
                </div>
              </div>

              {/*
                What each state means, said once rather than repeated on every
                tile — the reference keeps the grid compact.
              */}
              <ul className="pub-checks mt-8 sm:grid-cols-2">
                {Array.from(
                  new Set<MarketingAvailability>([
                    ...providers.map((provider) => provider.availability),
                    ...connectors.map((connector) => connector.availability),
                  ]),
                ).map((state) => (
                  <li key={state}>
                    <CheckCircle2 className="size-4" aria-hidden />
                    <span>
                      <strong className="font-semibold text-[var(--pub-text)]">
                        {AVAILABILITY_LABEL[state]}
                      </strong>
                      : {INTEGRATION_NOTE[state]}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="pub-small mt-8">
                Anything not listed is a discovery conversation. We will say
                what is realistic before you commit.
              </p>
          </Band>

          {/* -------------------------------------------------- security --- */}
          <Band id="security" aria-labelledby="ent-security">
              <SectionEyebrow className="mb-5">Security and data</SectionEyebrow>
              <h2 id="ent-security" className="pub-h2">
                Controls for serious business operations.
              </h2>
              <p className="pub-lead mt-5 max-w-3xl">
                Every control below is built, configurable or plainly marked
                not available.
              </p>

              {/*
                Two columns, as the reference lays it out: the controls that
                are built on the left, and the full status register — including
                what we do not have — on the right. The register is what makes
                the section honest, so it is never the half that gets cut.
              */}
              <div className="pub-split pub-split-narrow mt-10">
                <RevealGrid className="pub-grid pub-grid-2">
                  {SECURITY_GROUPS.map((group) => (
                    <PublicCard key={group.heading} interactive className="pub-cell">
                      <GlyphTile icon={group.icon} size={38} glyph={17} />
                      <h3 className="mt-4">{group.heading}</h3>
                      <p>{group.body}</p>
                    </PublicCard>
                  ))}
                </RevealGrid>

                <PublicCard className="pub-cell">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3>Status register</h3>
                    <StatePill tone="muted">{SECURITY_CONTROLS.length} controls</StatePill>
                  </div>
                  <ul className="pub-register">
                    {SECURITY_CONTROLS.map((control) => (
                      <li key={control.id}>
                        <span title={control.detail}>{control.name}</span>
                        <StatePill tone={CONTROL_TONE[control.status]}>
                          {STATUS_LABEL[control.status]}
                        </StatePill>
                      </li>
                    ))}
                  </ul>
                </PublicCard>
              </div>

              <div className="pub-evidence mt-10">
                <span className="pub-ring pub-ring-lg" aria-hidden>
                  <ShieldCheck className="size-4" />
                </span>
                <div>
                  <h3>What we do not have</h3>
                  <p>
                    {gaps.map((gap) => gap.name).join(", ")}. If one of these
                    is a procurement gate, tell us on the first call.
                  </p>
                </div>
              </div>
          </Band>

          {/* ------------------------------------------------ commercial --- */}
          <Band aria-labelledby="ent-commercial">
              <div className="pub-split pub-split-narrow">
                <div>
                  <SectionEyebrow className="mb-5">Commercial</SectionEyebrow>
                  <h2 id="ent-commercial" className="pub-h2">
                    Flexible commercial options.
                  </h2>
                  <p className="pub-lead mt-5">
                    Entitlements and terms agreed against your numbers, not a
                    rate card.
                  </p>

                  <RevealGrid className="pub-grid pub-grid-2 mt-8">
                    {[
                      {
                        icon: Scale,
                        title: "Custom volume allowances",
                        body: "Leads, sourcing, messaging, users and workspaces set per contract.",
                      },
                      {
                        icon: Handshake,
                        title: "Procurement support",
                        body: "Purchase orders, invoicing and your security questionnaire.",
                      },
                      {
                        icon: FileText,
                        title: "DPA and legal review",
                        body: "Use our agreement or send us yours. Sub-processors are published.",
                      },
                      {
                        icon: Headphones,
                        title: "Dedicated support",
                        body: "A named contact and onboarding assistance.",
                      },
                    ].map((item) => (
                      <PublicCard key={item.title} interactive className="pub-cell">
                        <div className="pub-cell-row">
                          <GlyphTile icon={item.icon} size={36} glyph={16} />
                          <div>
                            <h3>{item.title}</h3>
                            <p>{item.body}</p>
                          </div>
                        </div>
                      </PublicCard>
                    ))}
                  </RevealGrid>
                </div>

                <PublicCard className="pub-cell">
                  <h3 className="mb-5">Included in an Enterprise agreement</h3>
                  <ul className="grid gap-0">
                    {PLANS.enterprise.features.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-center gap-3 border-b border-[var(--lr-border-subtle)] py-3.5 text-[0.82rem] text-[var(--pub-text-secondary)] last:border-0"
                      >
                        <CheckCircle2
                          className="size-4 shrink-0 text-[var(--pub-lime)]"
                          aria-hidden
                        />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <ActionRow>
                    <SecondaryCta
                      placement="enterprise_commercial"
                      href="/contact-sales"
                      withArrow
                    >
                      Discuss your requirements
                    </SecondaryCta>
                  </ActionRow>
                </PublicCard>
              </div>
          </Band>

          {/* -------------------------------------------- implementation --- */}
          <Band aria-labelledby="ent-implementation">
              <SectionEyebrow className="mb-5">Implementation</SectionEyebrow>
              <h2 id="ent-implementation" className="pub-h2">
                A structured path from discovery to go-live.
              </h2>
              <p className="pub-lead mt-5 max-w-3xl">
                Timing depends on how many systems connect. You get a timeline
                after discovery.
              </p>

              <StepRail steps={IMPLEMENTATION} variant="timeline" />
          </Band>

          {/* -------------------------------------------------------- FAQ --- */}
          <Band aria-labelledby="enterprise-faq-heading">
              <PublicFaq
                id="enterprise-faq"
                eyebrow="Frequently asked questions"
                title="Common questions from enterprise buyers."
                items={FAQS}
                event="enterprise_faq_expand"
              />
          </Band>

          {/* ------------------------------------------------- final CTA --- */}
          <Reveal>
            <FinalCtaBand
              eyebrow="Ready to discuss your requirements?"
              title={
                <>
                  Let&rsquo;s design the right ClientTurn setup for{" "}
                  <span className="pub-accent">your organisation.</span>
                </>
              }
              body="Tell us your volumes, systems and constraints. We will tell you what fits and what we cannot do yet."
              actions={
                <>
                  <PrimaryCta
                    placement="enterprise_final"
                    href="/contact-sales"
                    size="lg"
                  >
                    Talk to sales
                  </PrimaryCta>
                  <SecondaryCta
                    placement="enterprise_final"
                    href="/pricing"
                    size="lg"
                  >
                    Compare plans
                  </SecondaryCta>
                </>
              }
              points={[
                {
                  icon: <Building2 className="size-4" />,
                  title: "Built around your operation",
                  body: "Entitlements set against your actual volumes.",
                },
                {
                  icon: <ShieldCheck className="size-4" />,
                  title: "Straight answers on security",
                  body: "What is in place, and what is not.",
                },
                {
                  icon: <Plug className="size-4" />,
                  title: "Integration discovery first",
                  body: "We scope it before you commit to it.",
                },
                {
                  icon: <TrendingUp className="size-4" />,
                  title: "Support through go-live",
                  body: "A named contact from design onward.",
                },
              ]}
            />
          </Reveal>
        </BandStack>
      </PublicContainer>
    </>
  );
}
