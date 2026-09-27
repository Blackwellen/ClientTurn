import "server-only";
import * as React from "react";
import { Layers } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/feedback";
import { STAGE_LABEL, type OpportunityStage } from "@/lib/opportunities/stages";
import { INTEREST_SOURCE_LABEL } from "@/lib/qualification-intelligence/interests";
import { loadLeadInterests } from "@/lib/leads/detail-queries";
import { AddInterestForm } from "./add-interest-form";

/**
 * Interests (08 §B.20): every offer this lead wants, one card each, with its
 * goal, stage, next best action and value, and one line about the lead
 * overall. Winning one does not close the others. Route states: skeleton
 * (LeadInterestsSkeleton), empty (no interest yet), error (the card says so
 * and the rest of the page stands), read-only (no "Add an interest").
 */

function Shell({ children, summary }: { children: React.ReactNode; summary?: string }) {
  return (
    <section aria-labelledby="interests-title" className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="border-b border-line-subtle px-4 py-3">
        <h2 id="interests-title" className="flex items-center gap-1.5 text-[14px] font-semibold text-content">
          <Layers className="size-4 text-content-muted" aria-hidden />
          Interests
        </h2>
        {summary ? <p className="mt-1 text-[12px] text-content-muted">{summary}</p> : null}
      </header>
      {children}
    </section>
  );
}

function money(value: number | null, currency: string): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value)}`;
  }
}

export async function LeadInterestsCard({ businessId, leadId, canWrite }: { businessId: string; leadId: string; canWrite: boolean }) {
  let view: Awaited<ReturnType<typeof loadLeadInterests>>;
  try {
    view = await loadLeadInterests(businessId, leadId);
  } catch {
    return (
      <Shell>
        <p className="px-4 py-3 text-[13px] text-content-muted">The interests could not be loaded. Refresh to try again.</p>
      </Shell>
    );
  }
  if (view.cards.length === 0) {
    return (
      <Shell summary="No interest recorded yet. One opens when the lead names a service or qualifies.">
        {canWrite ? <AddInterestForm leadId={leadId} services={view.addable} /> : null}
      </Shell>
    );
  }
  return (
    <Shell summary={view.summary}>
      <ul className="divide-y divide-line-subtle">
        {view.cards.map((card) => {
          const value = money(card.value, card.currency);
          return (
            <li key={card.opportunityId ?? card.serviceId ?? card.offer} className="space-y-1.5 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[13px] font-medium text-content">{card.offer}</p>
                <StatusBadge kind="opportunity_outcome" value={card.outcome} dense />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-content-muted">
                {card.goalLabel ? <Badge tone="neutral">{card.goalLabel}</Badge> : null}
                <span>{card.opportunityId ? (STAGE_LABEL[card.stage as OpportunityStage] ?? card.stage) : "Not opened yet"}</span>
                {value ? <span>· {value}</span> : null}
                {card.source ? <span>· {INTEREST_SOURCE_LABEL[card.source]}</span> : null}
              </div>
              {card.nextAction ? (
                <p className="text-[12px] text-content">
                  <span className="font-medium">Next: </span>
                  {card.nextAction}
                  {card.nextActionReason ? <span className="text-content-muted"> ({card.nextActionReason})</span> : null}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canWrite ? <AddInterestForm leadId={leadId} services={view.addable} /> : null}
    </Shell>
  );
}

export function LeadInterestsSkeleton() {
  return (
    <Shell>
      <div className="space-y-2 px-4 py-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </Shell>
  );
}
