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
  "workspace": { "id": "…", "name": "Apex Roofing", "timezone": "Europe/London" },
  "key":       { "name": "CRM sync", "environment": "live",
                 "scopes": ["leads:read", "leads:write"] },
  "acting_as": { "role": "admin" }
}`;

const LIST_LEADS = `curl "${siteUrl}/api/v1/leads?status=QUALIFIED&limit=25" \\
  -H "Authorization: Bearer ct_live_your_key_here"`;

const UPDATE_LEAD = `curl -X PATCH ${siteUrl}/api/v1/leads/{id} \\
  -H "Authorization: Bearer ct_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "WON", "note": "Signed the quote." }'`;

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
    body: "The workspace, the key's scopes and the live role behind it. Start here.",
  },
  {
    method: "GET",
    path: "/api/v1/leads",
    scope: "leads:read",
    role: "Viewer",
    body: "Search leads by text, status or attention flag.",
  },
  {
    method: "GET",
    path: "/api/v1/leads/{id}",
    scope: "leads:read",
    role: "Viewer",
    body: "One lead with its recent activity.",
  },
  {
    method: "PATCH",
    path: "/api/v1/leads/{id}",
    scope: "leads:write",
    role: "Member",
    body: "Change details, move status, add a note. Runs the same status rules as the app.",
  },
  {
    method: "GET",
    path: "/api/v1/events",
    scope: "business:read",
    role: "Viewer",
    body: "Recent webhook deliveries — what was sent, what your server said, whether it will retry.",
  },
] as const;

const ERRORS = [
  { code: "unauthorized", http: "401", body: "The key is missing, unknown, revoked, expired or blocked by its IP allowlist." },
  { code: "forbidden", http: "403", body: "The key lacks the scope, or its owner no longer holds the role." },
  { code: "invalid_request", http: "400", body: "The body or a parameter did not validate. The message names the field." },
  { code: "not_found", http: "404", body: "No such record in this workspace." },
  { code: "rate_limited", http: "429", body: "300 requests a minute per key. `retry_after` says how long to wait." },
  { code: "needs_confirmation", http: "409", body: "The action requires a person to agree, so it cannot be done through the API. `effect` says what would have happened." },
  { code: "server_error", http: "500", body: "Our fault. Quote the `request_id` — it identifies the exact attempt." },
] as const;

const GUARANTEES = [
  {
    icon: Fingerprint,
    title: "Shown once, stored as a digest",
    body: "We keep a SHA-256 fingerprint of your key and nothing else. There is no screen, and no support process, that can show it to you again — because there is no code that could.",
  },
  {
    icon: UserCheck,
    title: "A key is one person's authority",
    body: "It stores who it acts as, never what role they had. Every request re-reads their current membership, so removing someone from the workspace disables their keys on the next call. Nobody has to remember to go and find them.",
  },
  {
    icon: Layers,
    title: "Scopes narrow, never widen",
    body: "A key granted write access on a viewer's authority still cannot write. Both checks run on every request, and the narrower of the two wins.",
  },
  {
    icon: Lock,
    title: "Never usable from a browser",
    body: "The API sends no CORS headers at all, so a key pasted into front-end JavaScript simply will not work. A key in a web page is a key in the hands of every visitor.",
  },
  {
    icon: ListChecks,
    title: "Every request is on the record",
    body: "Allowed or refused, with the key that made it, visible to your admins in Settings. A key being refused repeatedly is either a misconfiguration or someone probing, and you can see both.",
  },
  {
    icon: ShieldCheck,
    title: "Optional IP allowlist",
    body: "If your integration runs from a fixed address, list it. A stolen key is then useless from anywhere else — and if we cannot determine the caller's address, the request is refused rather than waved through.",
  },
] as const;

const RETRY_TOTAL_HOURS = Math.round(
  WEBHOOK_RETRY_BACKOFF_SECONDS.reduce((sum, seconds) => sum + seconds, 0) / 3600,
);

const FAQS: FaqItem[] = [
  {
    q: "Who can create an API key?",
    a: "Workspace owners and admins, in Settings → Developer. Handing out a credential that can read your leads from anywhere on the internet is an administrative act, and the key outlives the session that made it — which is exactly why a member cannot mint one for themselves.",
  },
  {
    q: "What happens to a key when someone leaves?",
    a: "It stops working on the next request. A key records whose authority it carries, and we re-read that person's membership every time it is used — so an offboarding disables their integrations immediately, without anyone having to hunt for keys they issued.",
  },
  {
    q: "Can I create leads through the API?",
    a: "Not yet, and deliberately so. Creating a lead in ClientTurn means deduplication, capturing a lawful basis for contacting them, and starting follow-up. An endpoint that skipped those would leave you with duplicate records and leads nobody is following up — worse than not having one. Use a lead source integration or the Add Lead form, both of which do all three.",
  },
  {
    q: "Why did my write get a 409 rather than a 200?",
    a: "Some actions need a person to agree before they happen — archiving a lead, sending a message. The API has nobody at a keyboard, so it refuses rather than guessing, and returns what would have happened so you can tell your user and offer to do it in the app.",
  },
  {
    q: "Do I have to expose an endpoint to receive events?",
    a: "No. If you cannot accept inbound requests, poll GET /api/v1/events instead — it returns the same payloads, with what we sent, what your server answered and whether we will try again.",
  },
  {
    q: "How is the MCP endpoint different from the API?",
    a: "It is the same permission model reached over JSON-RPC, for AI assistants rather than your own code, and it exposes more: leads, appointments, campaigns, prospects, connections, your metrics and your AI agents. The important difference is that anything needing a person's confirmation does not execute — it parks in your workspace for someone to approve, and the assistant is told plainly that nothing has happened yet.",
  },
  {
    q: "Can an assistant really set up my AI agents?",
    a: "Yes — it can create one, choose its sources, set its schedule and its daily and monthly limits, and adjust how the conversation assistant behaves. It cannot start one. A new agent is always a draft, so configuring it changes nothing until you say go, and starting it parks for your approval because it spends money on a schedule without anyone watching.",
  },
  {
    q: "Can it change what model or prompt you use?",
    a: "No, and neither can you. Models, temperatures, token budgets and system prompts are not exposed through any surface — not the API, not MCP, not the app. A caller that could set them could talk the assistant out of its own guardrails, which is exactly why they stay internal.",
  },
  {
    q: "Which assistants can connect?",
    a: "Any MCP client that can send a bearer header, which includes Claude, Codex and Gemini. Your workspace API key is the credential — there is nothing else to set up.",
  },
  {
    q: "Is there a sandbox?",
    a: "Keys are labelled Live or Test so you can tell them apart in your own configuration and revoke the right one. Both read the same workspace — we do not run a separate sandbox environment, and saying otherwise would be misleading.",
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

export default function DevelopersPage() {
  return (
    <>
      <ScrollProgress />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
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
                Your leads, <span className="pub-accent">in your systems</span> —
                and an <span className="pub-accent">assistant</span> that can act
                on them.
              </h1>
              <p className="pub-lead mt-6 max-w-xl">
                A scoped REST API, signed webhooks and an MCP endpoint. One
                permission model, one audit trail, and a key you can revoke in a
                click — all set up from Settings, with no sales call.
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
              description="They share one set of permissions and one audit trail, and they live in one place in Settings — because they are one decision: what leaves this workspace, and who may act on it."
            />

            <RevealGrid className="pub-grid pub-grid-3 mt-10">
              {[
                {
                  icon: Braces,
                  title: "REST API",
                  body: "Read and update leads from your own code over HTTPS. Scoped per key, rate limited per key, and every call goes through the same rules the app itself uses.",
                  href: "#api",
                  cta: "Read the reference",
                },
                {
                  icon: Webhook,
                  title: "Webhooks",
                  body: "We POST a signed JSON body to your server the moment a lead arrives, qualifies, books, replies, or needs a person. Retried on failure, with a delivery log you can read.",
                  href: "#webhooks",
                  cta: "See the events",
                },
                {
                  icon: Bot,
                  title: "MCP",
                  body: "Connect Claude, Codex or Gemini with the same key. It can work your leads, set up and run your AI agents, and check your connections — within the permissions you grant, and anything risky waits for a person.",
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
                  Create a key in Settings → Developer, choose exactly what it may
                  do, and call the API. The key is shown once — we store only a
                  fingerprint of it, so it cannot be shown again.
                </p>

                <ol className="pub-timeline mt-8">
                  {[
                    {
                      title: "Create a key",
                      body: "Settings → Developer → New key. Nothing is pre-selected: you choose the permissions and the expiry, and can restrict it to your own IP addresses.",
                    },
                    {
                      title: "Send it as a bearer token",
                      body: "From your own server. Never from a browser — the API sends no CORS headers, so it will not work there by design.",
                    },
                    {
                      title: "Check it with /me",
                      body: "It returns the workspace, the key's scopes and the live role behind it. If a later call is refused, this tells you which of the three is the reason.",
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
              description="No endpoint reads the database directly. Each one calls the same internal operation the app, the copilot and your assistant use, so the workspace scoping, the status rules and the audit trail apply without any endpoint having to remember them."
            />

            <div className="pub-ref-scroll mt-9">
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
            </div>

            <PublicCard className="mt-8 p-6">
              <div className="flex items-start gap-3">
                <GlyphTile icon={ListChecks} size={34} glyph={17} />
                <div>
                  <h3 className="pub-h3">
                    Creating a lead is deliberately not here
                  </h3>
                  <p className="pub-body mt-2">
                    Creating a lead in ClientTurn means deduplicating it against
                    what you already have, recording a lawful basis for contacting
                    that person, and starting follow-up. An endpoint that skipped
                    those three would hand you duplicate records and leads nobody
                    is chasing — which is worse than not having one. Use a lead
                    source integration or the Add Lead form, both of which do all
                    three. The endpoint exists and says exactly this, rather than
                    returning a bare error.
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
                  Scopes are a ceiling, never a floor. Both checks run on every
                  request — what the key was granted, and what its owner can still
                  do today — and the narrower wins. There is no all-access scope
                  and nothing is selected by default.
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
                </ul>
              </div>

              <div className="pub-ref-scroll">
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
              </div>
            </div>
          </Band>

          {/* ----------------------------------------------- webhooks --- */}
          <Band id="webhooks" aria-labelledby="dev-webhooks">
            <SectionHeading
              id="dev-webhooks"
              eyebrow="Webhooks"
              title={
                <>
                  Told the moment it happens —{" "}
                  <span className="pub-accent">and provably by us.</span>
                </>
              }
              description="Add an https endpoint in Settings, choose your events, and we POST a signed JSON body to it. Every request carries an HMAC-SHA256 signature over the timestamp and the raw body, so you can prove it came from us and refuse a replay."
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
                  An event appears in this list only once something actually sends
                  it. A subscription you can tick for an event that never fires is
                  worse than a missing feature.
                </p>

                <div className="pub-ref-scroll mt-5">
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
                </div>

                <h3 className="pub-h3 mt-8">Delivery</h3>
                <ul className="pub-register mt-3">
                  <li>
                    <span>Retries on failure</span>
                    <StatePill tone="go">
                      {WEBHOOK_RETRY_BACKOFF_SECONDS.length} attempts over ~
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
                  Give an assistant a key to the workspace — and a leash.
                </h2>
                <p className="pub-lead mt-5">
                  ClientTurn is an MCP server. Point Claude, Codex or Gemini at it
                  with your API key and it works inside your workspace — inside
                  the permissions you granted, and never beyond what you can do
                  yourself.
                </p>

                <p className="pub-body mt-4">
                  It reaches the same operations the app does, not a thinner copy
                  of them: leads and their conversations, appointments,
                  reactivation campaigns, sourced prospects, your connected
                  systems, and your headline numbers. It can also set your AI
                  agents up end to end — create one, choose its sources, schedule
                  and limits, and start or pause it — and change how the
                  conversation assistant behaves.
                </p>

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
                    It cannot set a model, a prompt or a token budget — those are
                    not exposed to anyone
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
                        High-impact actions do not run when an assistant asks for
                        them. They park in your workspace with a plain-English
                        summary of what was requested and what it would do, and
                        the assistant is told clearly that nothing has happened —
                        so it cannot report success. Approving runs the action on
                        the approver&rsquo;s authority, once, however many times
                        it is clicked.
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
                  Set an agent up in a sentence —{" "}
                  <span className="pub-accent">start it on purpose.</span>
                </>
              }
              description="An assistant can create an agent, choose its sources, set its schedule and its daily and monthly limits, and read back everything it has done. What it cannot do is set one running: that spends real money on a schedule with nobody watching, so it waits for you."
            />

            <RevealGrid className="pub-grid pub-grid-3 mt-10">
              {[
                {
                  icon: Bot,
                  title: "Configured by conversation",
                  body: "Describe what you want the agent to do and the assistant sets the parameters — type, cadence, sources, enrichment, and how much it may do without your review. Every new agent is a draft, so getting it wrong costs nothing.",
                },
                {
                  icon: UserCheck,
                  title: "Started only by you",
                  body: "Starting an agent, or running one immediately, parks for approval with a summary of what it will do. An agent can never configure an agent either — including itself — so nothing running can widen the limits it runs under. Pausing and stopping are never gated.",
                },
                {
                  icon: Lock,
                  title: "The model stays ours",
                  body: "There is no way — for an assistant, an API caller or anyone else — to set a model, a temperature, a token budget or a system prompt. Anything that could talk an agent out of its own guardrails is not exposed at all.",
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
              description="These are properties of the code, not policies we intend to follow. Each one is covered by a test that fails if it stops being true."
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
                  Refusals never say which check failed — telling a caller their
                  key exists but expired would tell someone holding a stolen key
                  exactly what they have. Your admins see the specific reason in
                  Settings, where it belongs.
                </p>
                <p className="pub-body mt-4">
                  A <code className="pub-inline-code">PATCH</code> asking for
                  several changes is not a transaction, so if one step fails the
                  response names what was applied before it. You are never left
                  unable to tell an untouched record from a half-changed one.
                </p>
              </div>

              <div className="pub-ref-scroll">
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
              </div>
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
              body={`Everything on this page is available on every plan, from the free trial upward. No integration tier, no per-call pricing, and nothing to unlock at ${siteHost}.`}
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
                "No card required",
                "Keys created in Settings, in seconds",
                "Revocable at any time",
              ]}
              points={[
                {
                  icon: <Terminal className="size-3.5" />,
                  title: "REST API",
                  body: "Read and update your leads from your own systems.",
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
