import "server-only";
import * as React from "react";
import { Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/feedback";
import { loadLeadBestFit } from "@/lib/commercial/rules-queries";
import {
  DEMAND_REASONS,
  EXCLUSION_REASONS,
  FIT_REASON_LABEL,
  INSUFFICIENT_LABEL,
  type FitReason,
} from "@/lib/commercial/best-fit";

/**
 * Best fit (commercial rules, 0174): which product or service in the
 * catalogue suits this lead, with the rules that decided it. Deterministic
 * (commercial/best-fit.ts); the assistant is given the same answer and may
 * only word it. Route states: skeleton (BestFitSkeleton), error (the card
 * says so and the rest of the page stands), empty catalogue, not enough
 * information (said plainly, no guess), and the recommendation.
 */

function Shell({ children, note }: { children: React.ReactNode; note?: string | null }) {
  return (
    <section aria-labelledby="best-fit-title" className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="border-b border-line-subtle px-4 py-3">
        <h2 id="best-fit-title" className="flex items-center gap-1.5 text-[14px] font-semibold text-content">
          <Target className="size-4 text-content-muted" aria-hidden />
          Best fit
        </h2>
        {note ? <p className="mt-1 text-[12px] text-content-muted">{note}</p> : null}
      </header>
      {children}
    </section>
  );
}

function tone(reason: FitReason): "success" | "warning" | "danger" | "neutral" {
  if ((EXCLUSION_REASONS as readonly string[]).includes(reason)) return "danger";
  if (reason === "BUDGET_MAY_BE_LOW" || reason === "SIZE_OUTSIDE_TARGET" || reason === "ICP_FIT_WEAK" || reason === "BUDGET_UNKNOWN") return "warning";
  if ((DEMAND_REASONS as readonly string[]).includes(reason) || reason === "BUDGET_FITS" || reason === "REGION_MATCH" || reason === "SIZE_MATCH" || reason === "ICP_FIT_STRONG") return "success";
  return "neutral";
}

function Reasons({ reasons }: { reasons: readonly FitReason[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Reasons">
      {reasons.map((reason) => (
        <li key={reason}>
          <Badge tone={tone(reason)} title={reason}>
            {FIT_REASON_LABEL[reason]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export async function BestFitCard({ businessId, leadId }: { businessId: string; leadId: string }) {
  let result: Awaited<ReturnType<typeof loadLeadBestFit>>;
  try {
    result = await loadLeadBestFit(businessId, leadId);
  } catch {
    return (
      <Shell>
        <p role="alert" className="px-4 py-3 text-[13px] text-content-muted">
          The best fit could not be worked out. Refresh to try again.
        </p>
      </Shell>
    );
  }
  if (!result) return null;
  const { fit, target } = result;
  const note =
    target.scope === "SELECTED" ? "Only what this lead's agent sells is considered." : "Decided by rules from what this lead has told you.";

  if (fit.status === "INSUFFICIENT_DATA") {
    return (
      <Shell note={note}>
        <div className="space-y-2 px-4 py-3">
          <p className="text-[13px] text-content">{INSUFFICIENT_LABEL[fit.reason]}</p>
          <Reasons reasons={fit.leadNotes} />
        </div>
      </Shell>
    );
  }

  const others = fit.ranked.filter((c) => c.key !== fit.top.key && c.eligible && c.score > 0).slice(0, 2);
  return (
    <Shell note={note}>
      <div className="space-y-2.5 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-[13.5px] font-medium text-content">{fit.top.name}</p>
          <Badge tone="neutral">{fit.top.kind === "SERVICE" ? "Service" : "Product"}</Badge>
        </div>
        <Reasons reasons={fit.reasons} />
        <Reasons reasons={fit.leadNotes} />
        {others.length > 0 && (
          <p className="text-[12px] text-content-muted">Also possible: {others.map((c) => c.name).join(", ")}</p>
        )}
      </div>
    </Shell>
  );
}

export function BestFitSkeleton() {
  return (
    <Shell>
      <div className="space-y-2 px-4 py-3">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </Shell>
  );
}
