import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { PeriodCounts } from "@/lib/dashboard/types";
import { leadsHrefForStatus } from "@/lib/leads/filters";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/app/page-header";
import { cn } from "@/lib/cn";

type Stage = {
  key: keyof PeriodCounts;
  label: string;
  href: string;
  /** Restrained pastels; lime marks the stage the product exists to reach. */
  circle: string;
};

/*
 * The tint (`*-50`/`*-100`) flips with the theme, but the mid shades do not —
 * so each number uses the one shade that clears 3:1 against its own tint in
 * both light and dark, rather than the darkest shade that only works on paper.
 */
const STAGES: Stage[] = [
  {
    key: "leads",
    label: "Leads",
    href: "/app/leads",
    circle: "bg-info-50 text-info-600 ring-info-100",
  },
  {
    key: "contacted",
    label: "Contacted",
    href: leadsHrefForStatus("CONTACTED"),
    circle: "bg-info-50 text-info-600 ring-info-100",
  },
  {
    key: "replied",
    label: "Responded",
    href: leadsHrefForStatus("RESPONDED"),
    circle: "bg-purple-50 text-purple-500 ring-purple-100",
  },
  {
    key: "qualified",
    label: "Qualified",
    href: leadsHrefForStatus("QUALIFIED"),
    circle: "bg-warning-50 text-warning-600 ring-warning-100",
  },
  {
    key: "booked",
    label: "Booked",
    href: leadsHrefForStatus("BOOKED"),
    // `content-accent` is defined per theme, so lime stays legible in both.
    circle: "bg-accent-100 text-content-accent ring-accent-200",
  },
  {
    key: "won",
    label: "Won",
    href: leadsHrefForStatus("WON"),
    circle: "bg-success-600 text-white ring-success-600",
  },
];

/** Null when there is no prior period to compare against — never a guess. */
function stageTrend(current: number, previous: number) {
  if (previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) {
    return { text: "No change", tone: "text-content-subtle" };
  }
  return {
    text: `${change > 0 ? "↑" : "↓"} ${Math.abs(change).toFixed(0)}%`,
    tone: change > 0 ? "text-success-600" : "text-danger-600",
  };
}

function FunnelConnector() {
  return (
    <span
      aria-hidden
      className="mt-8 flex min-w-6 flex-1 items-center gap-0.5 px-1 sm:mt-9"
    >
      <span className="bg-line-strong h-px flex-1" />
      <ChevronRight className="text-content-subtle -ml-1 size-3.5 shrink-0" />
    </span>
  );
}

function FunnelStage({
  stage,
  value,
  previous,
}: {
  stage: Stage;
  value: number;
  previous: number;
}) {
  const trend = stageTrend(value, previous);

  return (
    <Link
      href={stage.href}
      className="group focus-visible:outline-content-accent flex shrink-0 flex-col items-center gap-2 rounded-lg px-1 py-1 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <span
        className={cn(
          "flex size-14 items-center justify-center rounded-full text-[19px] font-semibold ring-2",
          "transition-transform duration-[var(--lr-duration-fast)] group-hover:scale-105",
          "lr-tabular tracking-[-0.02em] sm:size-16 sm:text-[21px]",
          stage.circle,
        )}
      >
        {value.toLocaleString("en-GB")}
      </span>
      <span className="flex flex-col items-center gap-0.5">
        <span className="text-content text-[13px] font-medium whitespace-nowrap">
          {stage.label}
        </span>
        <span
          className={cn(
            "lr-tabular text-[11.5px] font-medium whitespace-nowrap",
            trend?.tone ?? "text-content-subtle",
          )}
        >
          {trend?.text ?? "—"}
        </span>
      </span>
    </Link>
  );
}

/**
 * The funnel is the page's answer to "is ClientTurn moving leads?". Every
 * stage is a link into the matching Leads filter — there is no funnel detail
 * page to maintain.
 */
export function LeadFunnelCard({
  current,
  previous,
}: {
  current: PeriodCounts;
  previous: PeriodCounts;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <SectionHeader
          title="Lead funnel"
          description="From new enquiry to won job. Click a stage to view leads."
        />
      </CardHeader>
      <CardContent className="flex flex-1 items-center pt-0">
        {current.leads === 0 ? (
          <EmptyState
            className="w-full"
            title="No leads in this period"
            description="Widen the date range, or connect a lead source to start receiving leads."
          />
        ) : (
          <div className="-mx-1 flex w-full items-start overflow-x-auto px-1 py-2">
            {STAGES.map((stage, index) => (
              <React.Fragment key={stage.key}>
                {index > 0 && <FunnelConnector />}
                <FunnelStage
                  stage={stage}
                  value={current[stage.key] as number}
                  previous={previous[stage.key] as number}
                />
              </React.Fragment>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
