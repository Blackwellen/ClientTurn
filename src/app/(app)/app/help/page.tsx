import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock,
  Mail,
  MessageSquareText,
  Plug,
  Sparkles,
  Terminal,
  Users,
} from "lucide-react";
import { requireWorkspace } from "@/lib/auth/session";
import { getWorkspaceHealth } from "@/lib/app/health";
import { getGettingStarted } from "@/lib/settings/queries";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PageHeader, SectionHeader } from "@/components/app/page-header";
import { BUNDLED_ARTICLES } from "@/lib/support/help";

export const metadata: Metadata = { title: "Help · Client Turn" };
export const dynamic = "force-dynamic";

const SUPPORT_EMAIL = "support@clientturn.com";

const GUIDES: {
  label: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    label: "Leads",
    description: "How a lead moves from arrival to booking, and what each status means.",
    href: "/app/leads",
    icon: Users,
  },
  {
    label: "Follow-Up",
    description: "The follow-up sequence, its timings and its stop conditions.",
    href: "/app/follow-up",
    icon: MessageSquareText,
  },
  {
    label: "Qualification",
    description: "The deterministic rules that decide who is worth booking.",
    href: "/app/follow-up?view=qualification",
    icon: Sparkles,
  },
  {
    label: "Integrations",
    description: "Connect a lead source, a messaging channel and a calendar.",
    href: "/app/settings?section=connections",
    icon: Plug,
  },
  {
    label: "API, webhooks & assistants",
    description: "Create a key, receive events, and connect an AI assistant.",
    href: "/app/settings?section=developer",
    icon: Terminal,
  },
];

/**
 * The developer articles, read from the bundled index rather than restated.
 *
 * They are rendered inline as disclosures rather than linked to a separate
 * reader: there are four of them, someone reading one usually wants the next,
 * and a page of links to four short articles is a worse experience than the
 * four articles.
 */
const DEVELOPER_ARTICLES = BUNDLED_ARTICLES.filter(
  (article) => article.category === "Developer",
);

export default async function HelpPage() {
  const workspace = await requireWorkspace();
  const [steps, health] = await Promise.all([
    getGettingStarted(workspace.businessId),
    getWorkspaceHealth(workspace),
  ]);

  const done = steps.filter((step) => step.done).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Help"
        description="Get set up, understand what Client Turn is doing, and reach a human when you need one."
      />

      <Card id="app-installs" className="space-y-3 p-5">
        <h2 className="font-semibold">Import contacts from another system</h2>
        <p className="text-sm text-content-muted">
          Settings &rarr; Connections gives you a URL that accepts one contact
          per request. Your CRM, outreach tool or automation service posts to
          it and the contact appears in Find Leads for review. This is a
          one-way import: ClientTurn never signs in to the other system and
          cannot read or change anything in it.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-content-muted">
          <li>Choose the system you are sending from and how it will authenticate.</li>
          <li>Save the credential, then copy your endpoint URL.</li>
          <li>Configure the sending tool to POST the payload below.</li>
        </ol>
        <pre className="overflow-x-auto rounded-lg bg-bg p-4 text-xs">{`POST https://app.clientturn.com/api/apps/<id>/events

Content-Type: application/json
x-clientturn-timestamp: 1757116800
x-clientturn-signature: <hmac_hex>

{
  "eventId": "unique-contact-event-123",
  "eventType": "contact.created",
  "firstName": "Alex",
  "lastName": "Taylor",
  "email": "alex@example.com",
  "phone": "+447700900123",
  "company": "Example Ltd"
}`}</pre>
        <p className="text-sm text-content-muted">
          <strong className="font-medium text-content">Signing.</strong> Set{" "}
          <code>x-clientturn-timestamp</code> to the current Unix time in
          seconds, and <code>x-clientturn-signature</code> to the hexadecimal
          HMAC-SHA256 of the timestamp, a full stop, and the exact request body
          you are sending &mdash; signed with your signing secret. Requests more
          than five minutes old are refused. If your tool cannot compute an
          HMAC, choose a bearer token or API key header instead when you set the
          connection up.
        </p>
        <p className="text-sm text-content-muted">
          <strong className="font-medium text-content">Responses.</strong> A 202
          means the event is queued and the contact will appear after background
          processing. 401 means the credential or timestamp was rejected &mdash;
          Connections shows the reason. Reuse the same <code>eventId</code> when
          retrying so a retry cannot create the contact twice. Only{" "}
          <code>eventId</code> and one of <code>email</code> or{" "}
          <code>phone</code> (E.164) are required.
        </p>
        <p className="text-sm text-content-muted">
          Imported contacts stay subject to review, suppression and
          contactability rules, and importing never starts outreach on its own.
          Removing a connection blocks further receipts immediately.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="block">
            <SectionHeader
              title="Getting started"
              description={`${done} of ${steps.length} steps complete.`}
            />
            <Progress
              className="mt-3"
              value={done}
              max={steps.length}
              tone={done === steps.length ? "success" : "accent"}
              label="Getting started progress"
            />
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-line divide-y">
              {steps.map((step) => (
                <li key={step.id}>
                  <Link
                    href={step.href}
                    className="group focus-visible:outline-content-accent -mx-2 flex items-start gap-3 rounded-md px-2 py-3 focus-visible:outline-2"
                  >
                    <span
                      aria-hidden
                      className={
                        step.done
                          ? "bg-success-500 mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full text-white"
                          : "border-line-strong mt-0.5 flex size-4.5 shrink-0 rounded-full border"
                      }
                    >
                      {step.done && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-content block text-[13px] font-medium">
                        {step.label}
                        <span className="sr-only">
                          {step.done ? " (complete)" : " (not done)"}
                        </span>
                      </span>
                      <span className="text-content-muted block text-[13px]">
                        {step.description}
                      </span>
                    </span>
                    <ArrowUpRight className="text-content-subtle group-hover:text-content-muted mt-0.5 size-3.5 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <SectionHeader title="System status" />
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="flex items-center justify-between gap-3">
                <span className="text-content-muted text-[13px]">Integrations</span>
                <StatusBadge kind="integration" value={health.integrationStatus} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-content-muted text-[13px]">
                  Open issues
                </span>
                <Badge tone={health.issues.length === 0 ? "success" : "warning"} dot>
                  {health.issues.length === 0
                    ? "None"
                    : `${health.issues.length} to review`}
                </Badge>
              </div>

              {health.issues.length > 0 && (
                <ul className="border-line space-y-2 border-t pt-3">
                  {health.issues.map((issue) => (
                    <li key={issue.id}>
                      <Link
                        href={issue.actionHref}
                        className="text-content hover:text-content-accent focus-visible:outline-content-accent rounded-xs text-[13px] focus-visible:outline-2"
                      >
                        {issue.title}
                      </Link>
                      <p className="text-content-muted text-[12px]">
                        {issue.description}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <SectionHeader title="Contact support" />
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="flex items-center gap-1.5">
                <Clock className="text-content-subtle size-3.5" aria-hidden />
                <p className="text-content-muted text-[13px]">
                  Weekdays, 9am–6pm UK time
                </p>
              </div>
              <p className="text-content-subtle text-[12px]">
                Include your workspace name so we can find your account
                quickly.
              </p>
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Client Turn support — ${workspace.businessName}`)}`}
                className="border-line-strong bg-surface text-content hover:bg-surface-hover focus-visible:outline-content-accent inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border px-3.5 text-[13px] font-medium shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <Mail className="size-3.5" aria-hidden />
                Email support
              </a>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <SectionHeader
            title="Where things live"
            description="Each area explains itself in context."
          />
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="grid gap-3 sm:grid-cols-2">
            {GUIDES.map((guide) => (
              <li key={guide.href}>
                <Link
                  href={guide.href}
                  className="group border-line hover:border-line-strong hover:shadow-sm focus-visible:outline-content-accent flex items-start gap-3 rounded-lg border px-3.5 py-3 transition-shadow duration-[var(--lr-duration-fast)] focus-visible:outline-2"
                >
                  <span
                    aria-hidden
                    className="bg-accent-50 text-content-accent flex size-8 shrink-0 items-center justify-center rounded-md"
                  >
                    <guide.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-content block text-[13px] font-medium">
                      {guide.label}
                    </span>
                    <span className="text-content-muted block text-[13px]">
                      {guide.description}
                    </span>
                  </span>
                  <ArrowUpRight className="text-content-subtle group-hover:text-content-muted mt-0.5 size-3.5 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            title="For developers"
            description="Read your workspace from your own systems, receive events, or connect an AI assistant."
          />
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          {DEVELOPER_ARTICLES.map((article) => (
            // A native <details> rather than a state-driven accordion: it is
            // keyboard accessible, findable by the browser's own in-page
            // search even while closed, and needs no client component.
            <details
              key={article.slug}
              className="group border-line hover:border-line-strong rounded-lg border transition-colors"
            >
              <summary className="focus-visible:outline-content-accent flex cursor-pointer items-start gap-3 px-3.5 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
                <span
                  aria-hidden
                  className="bg-accent-50 text-content-accent flex size-8 shrink-0 items-center justify-center rounded-md"
                >
                  <Terminal className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-content block text-[13px] font-medium">
                    {article.title}
                  </span>
                  <span className="text-content-muted block text-[13px]">
                    {article.summary}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden
                  className="text-content-subtle mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-180"
                />
              </summary>

              <div className="space-y-3 border-t border-line px-3.5 py-3">
                {article.body.split("\n\n").map((paragraph, index) => (
                  <p
                    key={index}
                    className="text-content-secondary text-[13px] leading-relaxed"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </details>
          ))}

          <Link
            href="/app/settings?section=developer"
            className="group border-line hover:border-line-strong focus-visible:outline-content-accent mt-1 flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-[13px] font-medium focus-visible:outline-2"
          >
            <span className="text-content">Open Settings → Developer</span>
            <ArrowUpRight className="text-content-subtle group-hover:text-content-muted size-3.5 shrink-0" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
