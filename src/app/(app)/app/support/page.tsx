import * as React from "react";
import type { Metadata } from "next";
import { LifeBuoy } from "lucide-react";
import { requireWorkspace } from "@/lib/auth/session";
import { listTickets } from "@/lib/support/service";
import { PageHeader } from "@/components/app/page-header";
import { SupportDeepLink } from "@/components/support/support-deep-link";

export const metadata: Metadata = { title: "Support · ClientTurn" };
export const dynamic = "force-dynamic";

/**
 * `/app/support` — the deep-link and accessibility fallback (V4 §23.1).
 *
 * Support is a shell popout, not a page: someone asking for help is usually
 * stuck in the middle of something, and navigating away to ask about it loses
 * the very context they need to describe.
 *
 * This route exists anyway, for three cases the popout cannot serve:
 *
 *   * a link from an email, a status page or a colleague;
 *   * a browser or assistive setup where a floating panel is awkward;
 *   * a bookmark, so "where do I get help" has a URL answer.
 *
 * It opens the popout on arrival rather than reimplementing it — a second
 * support UI would be a second thing to keep correct, and they would drift.
 */
export default async function SupportPage() {
  const workspace = await requireWorkspace();

  const tickets = await listTickets(
    { businessId: workspace.businessId, userId: workspace.userId },
    5,
  );

  const open = tickets.filter(
    (ticket) => ticket.status !== "RESOLVED" && ticket.status !== "CLOSED",
  ).length;

  return (
    <div className="space-y-5">
      <PageHeader
        size="lg"
        title="Support"
        description="Search help articles, raise a ticket, or check whether ClientTurn is having a problem."
      />

      <div className="rounded-xl border border-line bg-surface p-6 shadow-xs">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-[11px] border border-accent-200/70 bg-accent-50 text-content-accent"
          >
            <LifeBuoy className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-content">
              Opening support
            </h2>
            <p className="mt-1 max-w-[46rem] text-[13px] leading-[1.55] text-content-muted">
              {open === 0
                ? "Support opens in a panel so you keep the page you were on. If it did not open, use the button below."
                : `You have ${open} open ${open === 1 ? "conversation" : "conversations"}. Support opens in a panel so you keep the page you were on.`}
            </p>

            {/* `useSearchParams` needs a boundary; the fallback is the same
                button without its deep-link parameters. */}
            <React.Suspense fallback={null}>
              <SupportDeepLink />
            </React.Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
