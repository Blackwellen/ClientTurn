import type { Metadata } from "next";
import {
  Bot,
  Braces,
  Clock,
  Fingerprint,
  KeyRound,
  Layers,
  ListChecks,
  Lock,
  RefreshCw,
  ShieldCheck,
  Terminal,
  UserCheck,
  Webhook,
} from "lucide-react";
import { PLATFORM_SCOPES, SCOPE_DESCRIPTIONS } from "@/lib/platform/scopes";
import { WEBHOOK_EVENTS, WEBHOOK_RETRY_BACKOFF_SECONDS } from "@/lib/webhooks/events";
import {
  PublicContainer,
  PublicCard,
  SectionEyebrow,
  SectionHeading,
  GlyphTile,
  GridTexture,
  Glow,
  ArrowLink,
} from "@/components/marketing/public/ui";
import {
  Band,
  BandStack,
  TrustRow,
  StatePill,
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
import { CodeBlock } from "@/components/marketing/public/developers/code-block";
import { ScrollRegion } from "@/components/ui/scroll-region";

const title = "For developers";
const description =
  "Build on ClientTurn: a scoped REST API, signed webhooks and an MCP endpoint for AI assistants — one permission model, one audit trail, keys you can revoke in a click.";
const path = "/developers";

const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://clientturn.com"
).replace(/\/$/, "");

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "lead management API",
    "CRM webhooks",
    "MCP server",
    "Model Context Protocol CRM",
    "lead API integration",
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

/**
 * `/developers` — the public documentation for the three ways into a workspace
 * from outside.
 *
 * Two rules govern what this page is allowed to say, and they are the reason it
 * imports from `lib/` rather than restating anything:
 *
 *   1. **The scope list and the event list are read from the catalogues the
 *      runtime enforces.** A page that hard-coded them would eventually promise
 *      a permission that does not exist or omit one that does — and a developer
 *      discovers that by building against it and failing.
 *   2. **Nothing here describes an unbuilt surface.** Every endpoint, every
 *      event and every guarantee below is live and covered by
 *      `tests/developer-platform-e2e.test.ts`. There is no "coming soon" row,
 *      because a roadmap item on a reference page reads as a feature.
 */

const siteHost = siteUrl.replace(/^https?:\/\//, "");

/* ------------------------------------------------------------- samples --- */

const QUICKSTART = `curl ${siteUrl}/api/v1/me \\
  -H "Authorization: Bearer ct_live_your_key_here"`;

const QUICKSTART_RESPONSE = `{
  "workspace": { "id": "…", "name": "Northwind Digital", "timezone": "Europe/London" },
  "key":       { "name": "CRM sync", "environment": "live",
                 "scopes": ["leads:read", "leads:write"] },
  "acting_as": { "role": "admin" }
}`;

const LIST_LEADS = `curl "${siteUrl}/api/v1/leads?status=QUALIFIED&limit=25" \\
  -H "Authorization: Bearer ct_live_your_key_here"`;

const UPDATE_LEAD = `curl -X PATCH ${siteUrl}/api/v1/leads/{id} \\
  -H "Authorization: Bearer ct_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "WON", "note": "Signed the proposal." }'`;

const VERIFY = `import crypto from "node:crypto";

// The RAW body, before JSON.parse. Re-serialising changes the key
// order and the signature will fail intermittently.
function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=")),
  );

  // Reject anything older than five minutes. This is what stops a
  // request anyone once saw from being replayed forever.
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (age > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${parts.t}.\${rawBody}\`)
    .digest("hex");

  // Constant time. A plain === leaks the signature a byte at a time.
  return crypto.timingSafeEqual(
    Buffer.from(parts.v1),
    Buffer.from(expected),
  );
}`;

const WEBHOOK_BODY = `{
  "id": "8f14e45f-ceea-467a-9f5b-2c1e9d4a77b3",
  "type": "lead.qualified",
  "created_at": "2026-09-08T09:14:02.117Z",
  "data": {
    "lead_id": "3a7c…",
    "result": "QUALIFIED",
    "status": "QUALIFIED",
    "reasons": [{ "code": "in_service_area" }]
  }
}`;

const MCP_ADD = `claude mcp add --transport http clientturn \\
  ${siteUrl}/api/mcp \\
  --header "Authorization: Bearer ct_live_your_key_here"`;

const MCP_CALL = `{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": {
    "name": "lead.set_status",
    "arguments": { "leadId": "3a7c…", "status": "QUALIFIED" }
  }
}`;

/* --------------------------------------------------------- reference --- */

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/v1/me",
    scope: "business:read",
    role: "Viewer",
    body: "The workspace, the key's scopes and its live role. Start here.",
  },
  {
    method: "GET",
    path: "/api/v1/leads",
    scope: "leads:read",
    role: "Viewer",
    body: "Search leads by text, status or attention flag.",
  },
  {
    method: "POST",
    path: "/api/v1/leads",
    scope: "leads:write",
    role: "Member",
    body: "Record an inbound lead through the ad-form intake. Needs an Idempotency-Key and a warm relationship. 201 created, 200 merged or duplicate, 409 if suppressed (nothing stored).",
  },
  {
    method: "GET",
    path: "/api/v1/leads/{id}",
    scope: "leads:read",
    role: "Viewer",
    body: "One lead, with its last 20 messages as recent_activity.",
  },
  {
    method: "PATCH",
    path: "/api/v1/leads/{id}",
    scope: "leads:write",
    role: "Member",
    body: "Change details, move status, add a note. Same status rules as the app.",
  },
  {
    method: "GET",
    path: "/api/v1/events",
    scope: "business:read",
    role: "Viewer",
    body: "Recent webhook deliveries: what was sent, your server's reply, and whether it will retry.",
  },
] as const;

const ERRORS = [
  { code: "unauthorized", http: "401", body: "The key is missing, unknown, revoked, expired or blocked by its IP allowlist." },
  { code: "forbidden", http: "403", body: "The key lacks the scope, or its owner no longer holds the role." },
  { code: "invalid_request", http: "400", body: "The body or a parameter did not validate. The message names the field." },
  { code: "not_found", http: "404", body: "No such record in this workspace." },
  { code: "rate_limited", http: "429", body: "300 requests a minute per key. `retry_after` says how long to wait." },
  { code: "needs_confirmation", http: "409", body: "A person must agree, so the API cannot do it. `effect` says what would have happened." },
  { code: "server_error", http: "500", body: "Our fault. Quote the `request_id`; it identifies the exact attempt." },
] as const;

const GUARANTEES = [
  {
    icon: Fingerprint,
    title: "Shown once, stored as a digest",
    body: "We keep only a SHA-256 fingerprint. No screen or support process can show the key again.",
  },
  {
    icon: UserCheck,
    title: "A key is one person's authority",
    body: "Every request re-reads the owner's membership. Remove someone and their keys stop on the next call.",
  },
  {
    icon: Layers,
    title: "Scopes narrow, never widen",
    body: "Write access on a viewer's authority still cannot write. Both checks run; the narrower wins.",
  },
  {
    icon: Lock,
    title: "Never usable from a browser",
    body: "No CORS headers are sent, so a key pasted into front-end JavaScript will not work.",
  },
  {
    icon: ListChecks,
    title: "Every request is on the record",
    body: "Allowed or refused, with the key that made it, visible to your admins in Settings.",
  },
  {
    icon: ShieldCheck,
    title: "Optional IP allowlist",
    body: "List your fixed addresses. If the caller's address is unknown, the request is refused.",
  },
] as const;

const RETRY_TOTAL_HOURS = Math.round(
  WEBHOOK_RETRY_BACKOFF_SECONDS.reduce((sum, seconds) => sum + seconds, 0) / 3600,
);

const FAQS: FaqItem[] = [
  {
    q: "Who can create an API key?",
    a: "Workspace owners and admins, in Settings → Developer. A key outlives the session that made it, so members cannot mint their own. It stops working on the next request once its owner leaves the workspace.",
  },
  {
    q: "Can I create leads through the API?",
    a: "Yes. POST /api/v1/leads runs the same intake as the ad forms, with deduplication, the suppression check and attribution. It needs an Idempotency-Key and a warm relationship, and never starts follow-up; a person does that.",
  },
  {
    q: "Why did my write get a 409 rather than a 200?",
    a: "Some actions, such as archiving a lead or sending a message, need a person to agree. The API refuses rather than guessing, and returns what would have happened.",
  },
  {
    q: "Do I have to expose an endpoint to receive events?",
    a: "No. Poll GET /api/v1/events instead. It returns the same payloads, your server's replies and whether we will retry.",
  },
  {
    q: "How is the MCP endpoint different from the API?",
    a: "Same permission model over JSON-RPC, for AI assistants, with more reach: appointments, campaigns, prospects, connections, metrics and AI agents. Anything needing confirmation parks for a person to approve, and the assistant is told nothing has happened yet.",
  },
  {
    q: "Can an assistant set up my AI agents, or change the model?",
    a: "It can create an agent and set its sources, schedule and limits, but a new agent is a draft and starting one parks for your approval. Models, temperatures, token budgets and system prompts are not exposed to anyone, through any surface.",
  },
  {
    q: "Which assistants can connect?",
    a: "Any MCP client that can send a bearer header, including Claude, Codex and Gemini. Your workspace API key is the only credential.",
  },
  {
    q: "Is there a sandbox?",
    a: "No. Keys are labelled Live or Test so you can tell them apart, but both read the same workspace.",
  },
];

const structuredData = {
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline: "ClientTurn for developers",
  description,
  url: `${siteUrl}${path}`,
  publisher: { "@type": "Organization", name: "ClientTurn", url: siteUrl },
};

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
    { "@type": "ListItem", position: 2, name: title, item: `${siteUrl}${path}` },
  ],
};

export default function DevelopersPage() {
  return (
    <>
      <ScrollProgress />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <FaqJsonLd items={FAQS} />

      {/* -------------------------------------------------------- hero --- */}
      <section className="pub-page-hero" aria-labelledby="dev-hero">
        <GridTexture />
        <Glow x="right" y="top" />
        <PublicContainer>
          <div className="pub-hero-split">
            <Reveal>
              <SectionEyebrow className="mb-5">For developers</SectionEyebrow>
              <h1 id="dev-hero" className="pub-h1">
                Your leads <span className="pub-accent">in your systems</span>,
                and an <span className="pub-accent">assistant</span> to act on
                them.
              </h1>
              <p className="pub-lead mt-6 max-w-xl">
                A scoped REST API, signed webhooks and an MCP endpoint. One
                permission model, one audit trail, set up in Settings.
              </p>

              <ActionRow>
                <PrimaryCta placement="developers_hero" size="lg">
                  Start free
                </PrimaryCta>
                <AnchorCta href="#quickstart" size="lg">
                  See the quickstart
                </AnchorCta>
              </ActionRow>

              <TrustRow
                items={[
                  {
                    icon: <KeyRound className="size-3.5" />,
                    label: "Scoped keys, revocable instantly",
                  },
                  {
                    icon: <ShieldCheck className="size-3.5" />,
                    label: "Every webhook signed",
                  },
                  {
                    icon: <ListChecks className="size-3.5" />,
                    label: "Every request audited",
                  },
                ]}
              />
            </Reveal>

            <Reveal delay={0.08}>
              <CodeBlock
                label="Check a key works"
                code={QUICKSTART}
                highlight={["ct_live_your_key_here"]}
              />
              <div className="mt-3">
                <CodeBlock label="Response" code={QUICKSTART_RESPONSE} />
              </div>
            </Reveal>
          </div>
        </PublicContainer>
      </section>

      <PublicContainer>
        <BandStack>
          {/* -------------------------------------------- three ways in --- */}
          <Band id="surfaces" aria-labelledby="dev-surfaces" divided={false}>
            <SectionHeading
              id="dev-surfaces"
              eyebrow="Three ways in"
              title={
                <>
                  Pull, be pushed to, or{" "}
                  <span className="pub-accent">hand it to an assistant.</span>
                </>
              }
              description="One set of permissions, one audit trail, one place in Settings."
            />

            <RevealGrid className="pub-grid pub-grid-3 mt-10">
              {[
                {
                  icon: Braces,
                  title: "REST API",
                  body: "Create, read and update leads over HTTPS. Scoped and rate limited per key, under the app's rules.",
                  href: "#api",
                  cta: "Read the reference",
                },
                {
                  icon: Webhook,
                  title: "Webhooks",
                  body: "A signed JSON POST when a lead arrives, qualifies, books, replies or needs a person. Retried on failure.",
                  href: "#webhooks",
                  cta: "See the events",
                },
                {
                  icon: Bot,
                  title: "MCP",
                  body: "Connect Claude, Codex or Gemini with the same key. Anything risky waits for a person.",
                  href: "#mcp",
                  cta: "Connect an assistant",
                },
              ].map((card) => (
                <PublicCard key={card.title} interactive className="pub-cell">
                  <GlyphTile icon={card.icon} size={38} glyph={17} />
                  <h3 className="mt-4">{card.title}</h3>
                  <p>{card.body}</p>
                  <ArrowLink href={card.href} className="mt-4">
                    {card.cta}
                  </ArrowLink>
                </PublicCard>
              ))}
            </RevealGrid>
          </Band>

          {/* --------------------------------------------- quickstart --- */}
          <Band id="quickstart" aria-labelledby="dev-quickstart">
            <div className="pub-split">
              <div>
                <SectionEyebrow>Quickstart</SectionEyebrow>
                <h2 id="dev-quickstart" className="pub-h2">
                  Three minutes, no sales call.
                </h2>
                <p className="pub-lead mt-5">
                  The key is shown once; we store only its fingerprint.
                </p>

                <ol className="pub-timeline mt-8">
                  {[
                    {
                      title: "Create a key",
                      body: "Settings → Developer → New key. Choose scopes, expiry and optional IP limits.",
                    },
                    {
                      title: "Send it as a bearer token",
                      body: "From your own server only. No CORS headers, so browsers cannot use it.",
                    },
                    {
                      title: "Check it with /me",
                      body: "Shows the workspace, scopes and live role, so you can see why a call is refused.",
                    },
                  ].map((step, index) => (
                    <li key={step.title} className="pub-step">
                      <span className="pub-step-num" aria-hidden>
                        {index + 1}
                      </span>
                      <h3>{step.title}</h3>
                      <p>{step.body}</p>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="space-y-3">
                <CodeBlock
                  label="List qualified leads"
                  code={LIST_LEADS}
                  highlight={["ct_live_your_key_here"]}
                />
                <CodeBlock
                  label="Update a lead"
                  code={UPDATE_LEAD}
                  highlight={["ct_live_your_key_here", "{id}"]}
                />
              </div>
            </div>
          </Band>

          {/* ---------------------------------------------- reference --- */}
          <Band id="api" aria-labelledby="dev-api">
            <SectionHeading
              id="dev-api"
              eyebrow="API reference"
              title={
                <>
                  Everything the app can do,{" "}
                  <span className="pub-accent">through the same rules.</span>
                </>
              }
              description="Each endpoint calls the same operation the app uses, so scoping, status rules and audit always apply."
            />

            <ScrollRegion className="pub-ref-scroll mt-9">
              <table className="pub-ref">
                <caption className="sr-only">
                  ClientTurn API endpoints, with the scope and minimum workspace
                  role each requires
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Endpoint</th>
                    <th scope="col">Scope</th>
                    <th scope="col">Role</th>
                    <th scope="col">What it does</th>
                  </tr>
                </thead>
                <tbody>
                  {ENDPOINTS.map((endpoint) => (
                    <tr key={`${endpoint.method} ${endpoint.path}`}>
                      <td>
                        <span className="pub-ref-method">{endpoint.method}</span>{" "}
                        <code>{endpoint.path}</code>
                      </td>
                      <td>
                        <code>{endpoint.scope}</code>
                      </td>
                      <td>{endpoint.role}</td>
                      <td>{endpoint.body}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>

            <PublicCard className="mt-8 p-6">
              <div className="flex items-start gap-3">
                <GlyphTile icon={ListChecks} size={34} glyph={17} />
                <div>
                  <h3 className="pub-h3">
                    Creating a lead uses the same intake
                  </h3>
                  <p className="pub-body mt-2">
                    <code className="pub-inline-code">POST /api/v1/leads</code>{" "}
                    runs the same deduplication, suppression check and
                    attribution as every other source. It records and qualifies
                    the lead, but never starts follow-up; a person does that.
                  </p>
                </div>
              </div>
            </PublicCard>
          </Band>

          {/* ------------------------------------------------- scopes --- */}
          <Band id="scopes" aria-labelledby="dev-scopes">
            <div className="pub-split">
              <div>
                <SectionEyebrow>Permissions</SectionEyebrow>
                <h2 id="dev-scopes" className="pub-h2">
                  A key can only narrow what its owner could already do.
                </h2>
                <p className="pub-lead mt-5">
                  Every request checks the key&rsquo;s scopes and its owner&rsquo;s
                  current role; the narrower wins.
                </p>

                <ul className="pub-assurances mt-7">
                  <li>
                    <ShieldCheck aria-hidden className="size-3.5" />
                    The same scopes govern the API, webhooks and MCP
                  </li>
                  <li>
                    <UserCheck aria-hidden className="size-3.5" />
                    Demote someone and their keys lose reach on the next call
                  </li>
                  <li>
                    <Clock aria-hidden className="size-3.5" />
                    Keys expire in 90 days unless you choose otherwise
                  </li>
                  <li>
                    <Lock aria-hidden className="size-3.5" />
                    No all-access scope, and nothing selected by default
                  </li>
                </ul>
              </div>

              <ScrollRegion className="pub-ref-scroll">
                <table className="pub-ref">
                  <caption className="sr-only">
                    The permissions a ClientTurn API key or assistant connection
                    can be granted
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Scope</th>
                      <th scope="col">Grants</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PLATFORM_SCOPES.map((scope) => (
                      <tr key={scope}>
                        <td>
                          <code>{scope}</code>
                        </td>
                        <td>{SCOPE_DESCRIPTIONS[scope]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            </div>
          </Band>

          {/* ----------------------------------------------- webhooks --- */}
          <Band id="webhooks" aria-labelledby="dev-webhooks">
            <SectionHeading
              id="dev-webhooks"
              eyebrow="Webhooks"
              title={
                <>
                  Told the moment it happens,{" "}
                  <span className="pub-accent">provably by us.</span>
                </>
              }
              description="Each POST carries an HMAC-SHA256 signature over the timestamp and raw body, so you can verify it and refuse replays."
            />

            <div className="pub-split mt-9">
              <div className="space-y-3">
                <CodeBlock label="What arrives" code={WEBHOOK_BODY} />
                <CodeBlock
                  label="Verifying it (Node)"
                  code={VERIFY}
                  dim={[
                    "// The RAW body, before JSON.parse. Re-serialising changes the key",
                    "// order and the signature will fail intermittently.",
                    "// Reject anything older than five minutes. This is what stops a",
                    "// request anyone once saw from being replayed forever.",
                    "// Constant time. A plain === leaks the signature a byte at a time.",
                  ]}
                />
              </div>

              <div>
                <h3 className="pub-h3">Events</h3>
                <p className="pub-body mt-2">
                  Only events that something actually sends are listed.
                </p>

                <ScrollRegion className="pub-ref-scroll mt-5">
                  <table className="pub-ref">
                    <caption className="sr-only">
                      The events ClientTurn will send to your endpoint
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Event</th>
                        <th scope="col">Sent when</th>
                      </tr>
                    </thead>
                    <tbody>
                      {WEBHOOK_EVENTS.map((event) => (
                        <tr key={event.type}>
                          <td>
                            <code>{event.type}</code>
                          </td>
                          <td>{event.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollRegion>

                <h3 className="pub-h3 mt-8">Delivery</h3>
                <ul className="pub-register mt-3">
                  <li>
                    <span>Retries on failure</span>
                    <StatePill tone="go">
                      {WEBHOOK_RETRY_BACKOFF_SECONDS.length + 1} attempts over ~
                      {RETRY_TOTAL_HOURS}h
                    </StatePill>
                  </li>
                  <li>
                    <span>A 4xx from your server</span>
                    <StatePill tone="stop">Not retried</StatePill>
                  </li>
                  <li>
                    <span>Repeated failure</span>
                    <StatePill tone="hold">
                      Endpoint paused, and you are told why
                    </StatePill>
                  </li>
                  <li>
                    <span>Duplicate deliveries</span>
                    <StatePill tone="go">
                      Stable event id, unique per endpoint
                    </StatePill>
                  </li>
                  <li>
                    <span>Cannot expose an endpoint?</span>
                    <StatePill tone="info">
                      Poll <code>/api/v1/events</code>
                    </StatePill>
                  </li>
                </ul>
              </div>
            </div>
          </Band>

          {/* ---------------------------------------------------- MCP --- */}
          <Band id="mcp" aria-labelledby="dev-mcp">
            <div className="pub-split">
              <div>
                <SectionEyebrow>Model Context Protocol</SectionEyebrow>
                <h2 id="dev-mcp" className="pub-h2">
                  Give an assistant a key to the workspace, and a leash.
                </h2>
                <p className="pub-lead mt-5">
                  Point Claude, Codex or Gemini at ClientTurn&rsquo;s MCP server
                  with your API key; it acts only within the permissions you grant.
                </p>

                <ul className="pub-assurances mt-5">
                  <li>
                    <Braces aria-hidden className="size-3.5" />
                    Leads, conversations, appointments, campaigns, prospects and
                    connections
                  </li>
                  <li>
                    <Bot aria-hidden className="size-3.5" />
                    Sets up AI agents: sources, schedule and limits
                  </li>
                </ul>

                <ul className="pub-assurances mt-7">
                  <li>
                    <ShieldCheck aria-hidden className="size-3.5" />
                    Tools it cannot use are not even listed to it
                  </li>
                  <li>
                    <UserCheck aria-hidden className="size-3.5" />
                    Sending, launching or resuming a campaign, starting an
                    agent, or disconnecting a system all wait for a person
                  </li>
                  <li>
                    <Layers aria-hidden className="size-3.5" />
                    No model, prompt or token budget settings, for anyone
                  </li>
                  <li>
                    <ListChecks aria-hidden className="size-3.5" />
                    Every call it makes, and every refusal, is in your audit log
                  </li>
                  <li>
                    <RefreshCw aria-hidden className="size-3.5" />
                    Revoke the key and it disconnects immediately
                  </li>
                </ul>

                <ActionRow>
                  <SecondaryCta
                    placement="developers_contact_sales"
                    href="/contact-sales"
                    withArrow
                  >
                    Talk to us about a custom integration
                  </SecondaryCta>
                </ActionRow>
              </div>

              <div className="space-y-3">
                <CodeBlock
                  label="Connect Claude Code"
                  code={MCP_ADD}
                  highlight={["ct_live_your_key_here"]}
                />
                <CodeBlock label="Or speak JSON-RPC directly" code={MCP_CALL} />

                <PublicCard className="p-5">
                  <div className="flex items-start gap-3">
                    <GlyphTile icon={UserCheck} size={34} glyph={17} />
                    <div>
                      <h3 className="pub-h3">The approval gate</h3>
                      <p className="pub-body mt-2">
                        High-impact requests park with a plain-English summary,
                        and the assistant is told nothing has happened. Approval
                        runs it once, on the approver&rsquo;s authority.
                      </p>
                    </div>
                  </div>
                </PublicCard>
              </div>
            </div>
          </Band>

          {/* ------------------------------------------------ agents --- */}
          <Band id="agents" aria-labelledby="dev-agents">
            <SectionHeading
              id="dev-agents"
              eyebrow="AI agents"
              title={
                <>
                  Set an agent up in a sentence,{" "}
                  <span className="pub-accent">start it on purpose.</span>
                </>
              }
              description="Running an agent spends money on a schedule, so starting one always waits for you."
            />

            <RevealGrid className="pub-grid pub-grid-3 mt-10">
              {[
                {
                  icon: Bot,
                  title: "Configured by conversation",
                  body: "The assistant sets type, cadence, sources, limits and review level. New agents start as drafts.",
                },
                {
                  icon: UserCheck,
                  title: "Started only by you",
                  body: "Starting or running now parks for approval. Agents cannot configure agents. Pausing is never gated.",
                },
                {
                  icon: Lock,
                  title: "The model stays ours",
                  body: "No one can set a model, temperature, token budget or system prompt, through any surface.",
                },
              ].map((card) => (
                <PublicCard key={card.title} className="pub-cell">
                  <GlyphTile icon={card.icon} size={38} glyph={17} />
                  <h3 className="mt-4">{card.title}</h3>
                  <p>{card.body}</p>
                </PublicCard>
              ))}
            </RevealGrid>
          </Band>

          {/* ---------------------------------------------- security --- */}
          <Band id="security" aria-labelledby="dev-security">
            <SectionHeading
              id="dev-security"
              eyebrow="What we guarantee"
              title={
                <>
                  Built so a leaked key is{" "}
                  <span className="pub-accent">a small problem.</span>
                </>
              }
              description="Properties of the code, each covered by a test that fails if it stops being true."
            />

            <RevealGrid className="pub-grid pub-grid-3 mt-10">
              {GUARANTEES.map((item) => (
                <PublicCard key={item.title} className="pub-cell">
                  <GlyphTile icon={item.icon} size={38} glyph={17} />
                  <h3 className="mt-4">{item.title}</h3>
                  <p>{item.body}</p>
                </PublicCard>
              ))}
            </RevealGrid>
          </Band>

          {/* ------------------------------------------------- errors --- */}
          <Band id="errors" aria-labelledby="dev-errors">
            <div className="pub-split">
              <div>
                <SectionEyebrow>Errors</SectionEyebrow>
                <h2 id="dev-errors" className="pub-h2">
                  A stable code, a readable message, and an id to quote.
                </h2>
                <p className="pub-lead mt-5">
                  Refusals never say which check failed; your admins see the
                  reason in Settings.
                </p>
                <p className="pub-body mt-4">
                  A multi-change <code className="pub-inline-code">PATCH</code> is
                  not a transaction. If a step fails, the response names what was
                  already applied.
                </p>
              </div>

              <ScrollRegion className="pub-ref-scroll">
                <table className="pub-ref">
                  <caption className="sr-only">
                    ClientTurn API error codes and their meanings
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Code</th>
                      <th scope="col">HTTP</th>
                      <th scope="col">Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ERRORS.map((error) => (
                      <tr key={error.code}>
                        <td>
                          <code>{error.code}</code>
                        </td>
                        <td>{error.http}</td>
                        <td>{error.body}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            </div>
          </Band>

          {/* ---------------------------------------------------- faq --- */}
          <Band id="faq">
            <PublicFaq
              id="dev-faq"
              eyebrow="Questions"
              title="Before you build"
              items={FAQS}
              event="developers_faq_expand"
            />
          </Band>

          {/* ---------------------------------------------- final CTA --- */}
          <Band divided={false}>
            <FinalCtaBand
              eyebrow="Start building"
              title={
                <>
                  Create a key and make your first call{" "}
                  <span className="pub-accent">today.</span>
                </>
              }
              body={`Everything here is on every plan, including the free trial. No integration tier and no per-call pricing at ${siteHost}.`}
              actions={
                <>
                  <PrimaryCta placement="developers_final" size="lg">
                    Start free
                  </PrimaryCta>
                  <SecondaryCta
                    placement="developers_contact_sales"
                    href="/contact-sales"
                    size="lg"
                  >
                    Talk to us
                  </SecondaryCta>
                </>
              }
              assurances={[
                "Nothing charged during the trial",
                "Keys created in Settings, in seconds",
                "Revocable at any time",
              ]}
              points={[
                {
                  icon: <Terminal className="size-3.5" />,
                  title: "REST API",
                  body: "Create, read and update leads from your own systems.",
                },
                {
                  icon: <Webhook className="size-3.5" />,
                  title: "Signed webhooks",
                  body: "Told the moment something happens, provably by us.",
                },
                {
                  icon: <Bot className="size-3.5" />,
                  title: "MCP",
                  body: "An AI assistant working your pipeline, within limits.",
                },
                {
                  icon: <ShieldCheck className="size-3.5" />,
                  title: "One audit trail",
                  body: "Every call, every refusal, every approval on the record.",
                },
              ]}
            />
          </Band>
        </BandStack>
      </PublicContainer>
    </>
  );
}
