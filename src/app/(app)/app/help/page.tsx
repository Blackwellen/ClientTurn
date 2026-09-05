import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowUpRight,
  Check,
  Clock,
  Mail,
  MessageSquareText,
  Plug,
  Sparkles,
  Users,
} from "lucide-react";
import { requireWorkspace } from "@/lib/auth/session";
import { getWorkspaceHealth } from "@/lib/app/health";
import { getGettingStarted } from "@/lib/settings/queries";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PageHeader, SectionHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Help · Client Turn" };
export const dynamic = "force-dynamic";

const SUPPORT_EMAIL = "support@clientturn.co.uk";

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
    href: "/app/settings/connections",
    icon: Plug,
  },
];

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
    </div>
  );
}
