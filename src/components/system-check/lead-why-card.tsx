import "server-only";
import * as React from "react";
import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/feedback";
import type { ActiveWorkspace } from "@/lib/auth/session";
import { loadLeadWhy } from "@/lib/system-check/lead-why";
import { formatWhen, SYSTEM_CHECK_HREF } from "@/lib/system-check/types";
import type { WhyTone } from "@/lib/system-check/model";

/**
 * "Why hasn't anything happened?" on the lead page: what is holding this
 * lead, in the send guard's and the policy engine's own terms, plus the next
 * scheduled step. A native <details> so it is keyboard- and screen-reader
 * operable with no script, open by default when something is blocking.
 */

const TONE: Record<WhyTone, { label: string; tone: "info" | "warning" | "danger" }> = {
  info: { label: "Info", tone: "info" },
  warning: { label: "Check", tone: "warning" },
  blocked: { label: "Blocked", tone: "danger" },
};

export async function LeadWhyCard({ workspace, leadId }: { workspace: ActiveWorkspace; leadId: string }) {
  let why: Awaited<ReturnType<typeof loadLeadWhy>>;
  try {
    why = await loadLeadWhy({ businessId: workspace.businessId, userId: workspace.userId, role: workspace.role }, leadId);
  } catch (error) {
    console.error("[lead why] read failed", error);
    return (
      <Shell open={false} headline="This couldn't be checked right now. Every send is still checked at the moment it goes.">
        <SystemCheckLink />
      </Shell>
    );
  }
  if (!why) return null;
  const blocking = why.items.some((item) => item.tone === "blocked");

  return (
    <Shell open={blocking} headline={why.headline}>
      {why.next && (
        <p className="text-[12.5px] text-content-secondary">
          <span className="font-medium text-content">{why.next.label}:</span> {formatWhen(why.next.at, workspace.timezone)}
        </p>
      )}
      {why.items.length > 0 ? (
        <ul className="space-y-2.5">
          {why.items.map((item) => (
            <li key={item.id} className="min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-medium text-content">{item.title}</p>
                <Badge tone={TONE[item.tone].tone} dense>
                  {TONE[item.tone].label}
                </Badge>
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-content-muted">{item.detail}</p>
              {item.fix && (
                <Link
                  href={item.fix.href}
                  className="mt-1 inline-block rounded-sm text-[12px] font-medium text-content-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                >
                  {item.fix.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-content-muted">No stop conditions apply to this lead.</p>
      )}
      <SystemCheckLink />
    </Shell>
  );
}

function SystemCheckLink() {
  return (
    <p className="border-t border-line-subtle pt-2 text-[12px] text-content-muted">
      Workspace-wide problems (channels, calendar, AI, voice) are listed in{" "}
      <Link
        href={SYSTEM_CHECK_HREF}
        className="rounded-sm font-medium text-content-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
      >
        Settings → System check
      </Link>
      .
    </p>
  );
}

function Shell({ open, headline, children }: { open: boolean; headline: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby="lead-why-heading" className="min-w-0 rounded-xl border border-line bg-surface shadow-xs">
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2.5 rounded-xl px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent">
          <CircleHelp className="mt-0.5 size-4 shrink-0 text-content-muted" aria-hidden />
          <span className="min-w-0">
            <h2 id="lead-why-heading" className="text-[14px] font-semibold text-content">
              Why hasn&apos;t anything happened?
            </h2>
            <span className="mt-0.5 block text-[12.5px] text-content-secondary">{headline}</span>
          </span>
        </summary>
        <div className="space-y-3 px-5 pb-4">{children}</div>
      </details>
    </section>
  );
}

export function LeadWhySkeleton() {
  return <Skeleton className="h-20 w-full rounded-xl" />;
}
