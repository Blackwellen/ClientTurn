import * as React from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import type { SliceResult } from "@/lib/analytics/slices";
import {
  ATTRIBUTION_MODELS,
  formatSampledRate,
  SLICE_AVAILABILITY,
  SLICE_DIMENSIONS,
  SLICE_LABEL,
  type AttributionModel,
  type SampledRate,
  type SliceDimension,
} from "@/lib/analytics/revenue-surfaces";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";

const MODEL_LABEL: Record<AttributionModel, string> = {
  first: "First touch",
  last: "Last touch",
  linear: "Linear",
};

function hrefWith(
  base: Record<string, string>,
  change: Record<string, string>,
) {
  const params = new URLSearchParams({ ...base, ...change });
  return `/app/analytics?${params.toString()}`;
}

function Chip({
  href,
  active,
  disabled,
  children,
  title,
}: {
  href: string;
  active: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? "page" : undefined}
      scroll={false}
      className={cn(
        "inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] font-medium transition-colors",
        active
          ? "border-accent-500 bg-surface text-content shadow-xs"
          : "border-line text-content-muted hover:text-content",
        disabled && !active && "border-dashed opacity-70",
      )}
    >
      {children}
    </Link>
  );
}

function RateCell({ sample }: { sample: SampledRate }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {formatSampledRate(sample)}
      {sample.lowSample && (
        <Badge
          dense
          tone="warning"
          title={`Only ${sample.denominator} in the denominator`}
        >
          small sample
        </Badge>
      )}
    </span>
  );
}

const fmt = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toFixed(2);

/**
 * The breakdown under the Analytics views: the period's lead cohort by one
 * dimension, rates flagged below n = 30, and an attribution-model switch for
 * the dimensions attribution applies to.
 */
export function SlicesPanel({
  result,
  dimension,
  model,
  baseParams,
}: {
  result: SliceResult;
  dimension: SliceDimension;
  model: AttributionModel;
  baseParams: Record<string, string>;
}) {
  const attributed = dimension === "source" || dimension === "campaign";
  const base = { ...baseParams, slice: dimension, model };

  return (
    <Card data-tour="analytics-breakdown">
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h2 className="text-content text-[15px] font-semibold">Breakdown</h2>
          <p className="text-content-muted mt-0.5 text-[12.5px]">
            Leads created in this period, by{" "}
            {SLICE_LABEL[dimension].toLowerCase()}. Rates with fewer than 30 in
            the denominator show it.
          </p>
        </div>
        {attributed && (
          <div
            role="group"
            aria-label="Attribution model"
            className="flex shrink-0 gap-1"
          >
            {ATTRIBUTION_MODELS.map((option) => (
              <Chip
                key={option}
                href={hrefWith(base, { model: option })}
                active={option === model}
              >
                {MODEL_LABEL[option]}
              </Chip>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <nav aria-label="Breakdown dimension" className="flex flex-wrap gap-1">
          {SLICE_DIMENSIONS.map((option) => (
            <Chip
              key={option}
              href={hrefWith(base, { slice: option })}
              active={option === dimension}
              disabled={!SLICE_AVAILABILITY[option].available}
              title={
                SLICE_AVAILABILITY[option].available
                  ? undefined
                  : SLICE_AVAILABILITY[option].note
              }
            >
              {SLICE_LABEL[option]}
            </Chip>
          ))}
        </nav>

        {result.status === "unavailable" ? (
          <EmptyState
            icon={Layers}
            title="Not available"
            description={result.message}
            className="py-8"
          />
        ) : result.rows.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No leads in this period"
            description="The breakdown fills in as leads arrive."
            className="py-8"
          />
        ) : (
          <>
            <p className="text-content-subtle text-[12px]">
              {result.note}
              {attributed &&
                model === "linear" &&
                " Linear credit splits each lead across its touches, so counts can be fractional."}
              {result.truncated &&
                " Showing the most recent 5,000 leads of this period."}
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{SLICE_LABEL[dimension]}</TableHead>
                    <TableHead align="right">Leads</TableHead>
                    <TableHead align="right">Reply rate</TableHead>
                    <TableHead align="right">Qualified</TableHead>
                    <TableHead align="right">Booked</TableHead>
                    <TableHead align="right">Won</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="max-w-[260px] truncate">
                        {row.label}
                      </TableCell>
                      <TableCell align="right" numeric>
                        {fmt(row.leads)}
                      </TableCell>
                      <TableCell align="right" numeric>
                        <RateCell sample={row.replyRate} />
                      </TableCell>
                      <TableCell align="right" numeric>
                        <RateCell sample={row.qualifyRate} />
                      </TableCell>
                      <TableCell align="right" numeric>
                        <RateCell sample={row.bookRate} />
                      </TableCell>
                      <TableCell align="right" numeric>
                        <RateCell sample={row.winRate} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
