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
    "Delivered through the signed inbound webhook bridge that ClientTurn hosts.",
  platform_managed:
    "Run by ClientTurn for every workspace. There is nothing for you to connect.",
  coming_soon:
    "Not connectable yet on this deployment. Raise it at discovery and we will tell you where it sits.",
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
    body: "Row-level security on every tenant table, server-only secrets and signed, short-lived file access.",
  },
  {
    icon: Users,
    heading: "Authentication and access",
    body: "Ranked roles checked on the server, and step-up verification for platform administration.",
  },
  {
    icon: Layers,
    heading: "Data isolation",
    body: "Each workspace is a separate tenant. There is no cross-workspace read path in the application.",
  },
  {
    icon: FileText,
    heading: "Audit and monitoring",
    body: "Configuration and lifecycle changes are written to an append-only log against the acting user.",
  },
  {
    icon: Gauge,
    heading: "AI governance",
    body: "Deterministic decisions remain the system of record. AI assists inside configured bounds, off by default.",
  },
  {
    icon: Lock,
    heading: "Payments and billing",
    body: "Card details are entered on Stripe's own pages. ClientTurn stores a customer reference, not a card.",
  },
] as const;

const IMPLEMENTATION = [
  {
    title: "Discovery",
    body: "We map your volumes, sources, systems, teams and the requirements procurement will raise.",
  },
  {
    title: "Solution design",
    body: "Entitlements, workspace shape, integration approach, qualification rules and routing, agreed in writing.",
  },
  {
    title: "Implementation",
    body: "Workspaces provisioned, sources and systems connected, rules and sequences configured with you.",
  },
  {
    title: "Testing and training",
    body: "Validate the flow end to end on real data, then train the people who will run it.",
  },
  {
    title: "Go live",
    body: "Switch on, monitor the first cohort closely, and review against what we agreed at design.",
  },
] as const;

const FAQS: FaqItem[] = [
  {
    q: "Can ClientTurn support multiple business units or locations?",
    a: "Yes, as separate workspaces. Each location or business unit runs as its own fully isolated workspace with its own leads, rules, sequences, members and reporting. Be aware of one current limitation: there is no in-app workspace switcher yet, so a person who needs access to more than one signs in to each separately, and there is no combined cross-workspace report. If a single pane across locations is a requirement, tell us at discovery so we can be honest about timing.",
  },
  {
    q: "Can you integrate with our CRM?",
    a: "HubSpot and Zoho CRM can be connected in the app today. Salesforce is supported but does not yet have a self-serve connection screen, so it is connected with our team. Anything outside that list is a technical discovery conversation rather than a switch we can flip — we will tell you what is realistic before you commit to anything.",
  },
  {
    q: "Do you offer a data processing agreement?",
    a: "Yes, as part of an Enterprise agreement. Send us your paper and we will review it, or use ours. Our sub-processor list is published publicly and kept current.",
  },
  {
    q: "Is SSO or SAML available?",
    a: "Not today. Sign-in is email and password with email verification, and multi-factor authentication is not yet available for customer workspace users either — step-up verification currently covers platform administration only. If SSO is a hard requirement for your rollout, raise it before you invest time in an evaluation.",
  },
  {
    q: "Are you SOC 2 or ISO 27001 certified?",
    a: "No, and we will not imply otherwise. We can walk you through the controls that are actually in place — row-level security on every tenant table, workspace isolation, role-based access, audit logging, server-only secrets, signed short-lived file access, and UK and EU processing — and we will answer a security questionnaire honestly. If a certification is a procurement gate, that is a reason to talk to us early rather than late.",
  },
  {
    q: "Can we negotiate custom limits?",
    a: "Yes. Enterprise entitlements are set per contract rather than from the public rate card: lead volume, verified prospect allowance, sourcing runs, messaging volume, sending identities, users and workspaces are all configurable per tenant.",
  },
  {
    q: "What support is included?",
    a: `Enterprise agreements include a dedicated support contact and onboarding assistance. ${PLANS.pro.name} and below use standard support channels. Formal response-time commitments are agreed per contract; we do not publish a blanket SLA we have not signed up to.`,
  },
  {
    q: "How does implementation work?",
    a: "Five stages: discovery, solution design, implementation, testing and training, then go live. The length depends almost entirely on how many systems have to be connected and how much of your qualification logic already exists in a written form.",
  },
  {
    q: "Where is our data stored?",
    a: "The application database runs in Supabase's eu-west-2 (London) region, and AI assistance uses EU Azure OpenAI endpoints. Uploaded files are held in Cloudflare R2 and reached only through short-lived signed URLs generated server-side. We will walk through the full data-flow and sub-processor map with you rather than summarise it on a marketing page.",
  },
  {
    q: "How does Enterprise pricing work?",
    a: "It is priced against your requirements rather than published. Volume, users, workspaces, support and commercial terms all feed into it, and we would rather quote something accurate after discovery than a number now that changes later.",
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
  const pendingCount = providers.filter(
    (p) => p.availability === "coming_soon",
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
                Run acquisition and conversion across teams, locations and
                systems with custom entitlements, stronger controls and
                implementation support — and a straight answer about what we do
                and do not support yet.
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
                    Enterprise entitlements are set per tenant rather than from
                    the public rate card. Lead volume, verified prospect
                    allowance, sourcing runs, messaging volume, sending
                    identities and users are all configurable — and raised by
                    changing a row, not by shipping a release.
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
                    We do not describe any allowance as unlimited. Every limit
                    is a number in your contract, and you can see it.
                  </p>
                </div>

                <RevealGrid className="pub-grid pub-grid-2">
                  {[
                    {
                      icon: Layers,
                      title: "Isolated workspaces",
                      body: "Each brand, region or business unit runs as its own tenant with its own data, rules and members.",
                    },
                    {
                      icon: Users,
                      title: "Larger teams",
                      body: "Ranked roles, server-enforced permissions and an audit trail of who changed what.",
                    },
                    {
                      icon: Database,
                      title: "Large data operations",
                      body: "Built around high-volume sourcing, verification and outreach rather than retrofitted to it.",
                    },
                    {
                      icon: Gauge,
                      title: "Retry-safe processing",
                      body: "Background work re-reads current state before any external action, so a retry cannot double-send.",
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
                    Every location, brand or business unit gets a workspace with
                    its own leads, qualification rules, sequences, members and
                    reporting. Isolation is enforced in the database, not just
                    in the interface: each tenant table carries a business id
                    and is protected by row-level security.
                  </p>
                  <ul className="pub-checks">
                    {[
                      "Per-workspace qualification rules, sequences and routing",
                      "Ranked roles, checked on the server for every privileged action",
                      "An audit trail of configuration and lifecycle changes",
                      "Provisioned and configured with our team during implementation",
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
                        There is no in-app workspace switcher yet, and no
                        combined report across workspaces. Someone who works
                        across two locations signs in to each separately today.
                        If a single pane across locations is a requirement,
                        raise it at discovery — we will tell you where it sits
                        rather than let you find out after you have signed.
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
                The list below is generated from the product&rsquo;s own provider
                registry and the credentials this deployment holds, so it cannot
                advertise a connection the app would refuse to make.{" "}
                {liveCount} can be connected from Settings today,{" "}
                {managedCount} {managedCount === 1 ? "is" : "are"} run by us on
                every workspace&rsquo;s behalf, {pendingCount} {pendingCount === 1 ? "is" : "are"}{" "}
                not connectable yet, and {connectors.length} more systems can
                send us leads through the hosted webhook bridge.
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
                    sync, and we do not describe them as one.
                  </p>
                </div>
              </div>

              {/*
                What each state means, said once rather than repeated on every
                tile — the reference keeps the grid compact.
              */}
              <ul className="pub-checks mt-8 sm:grid-cols-2">
                {(
                  [
                    "native_live",
                    "platform_managed",
                    "webhook_bridge_live",
                    "coming_soon",
                  ] as MarketingAvailability[]
                ).map((state) => (
                  <li key={state}>
                    <CheckCircle2 className="size-4" aria-hidden />
                    <span>
                      <strong className="font-semibold text-[var(--pub-text)]">
                        {AVAILABILITY_LABEL[state]}
                      </strong>{" "}
                      — {INTEGRATION_NOTE[state]}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="pub-small mt-8">
                Anything not listed is a technical discovery conversation, not a
                switch we can flip. We will tell you what is realistic before
                you commit to anything.
              </p>
          </Band>

          {/* -------------------------------------------------- security --- */}
          <Band id="security" aria-labelledby="ent-security">
              <SectionEyebrow className="mb-5">Security and data</SectionEyebrow>
              <h2 id="ent-security" className="pub-h2">
                Controls for serious business operations.
              </h2>
              <p className="pub-lead mt-5 max-w-3xl">
                Everything below is either built and running, configurable, or
                honestly marked as not available. We have not written
                &ldquo;designed to support&rdquo; anywhere on this page to stand
                in for an audit that has not happened.
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
                    {gaps.map((gap) => gap.name).join(", ")}. These are listed
                    here rather than omitted, because a buyer who cannot find
                    SSO on a page assumes it exists rather than that we chose
                    not to mention it. If one of them is a procurement gate,
                    tell us at the first call.
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
                    Custom entitlements, procurement support and commercial
                    terms for larger organisations — agreed against your numbers
                    rather than assumed from a rate card.
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
                        body: "Purchase orders, invoicing and your security questionnaire, answered honestly.",
                      },
                      {
                        icon: FileText,
                        title: "DPA and legal review",
                        body: "Use our agreement or send us yours. Sub-processors are published.",
                      },
                      {
                        icon: Headphones,
                        title: "Dedicated support",
                        body: "A named contact and onboarding assistance from implementation onward.",
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
                How long it takes depends almost entirely on how many systems
                have to be connected and how much of your qualification logic
                already exists in writing. We will give you a timeline after
                discovery, not before it.
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
              body="Tell us your volumes, your systems and your constraints. We will tell you what fits, what needs building, and what we cannot do yet."
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
