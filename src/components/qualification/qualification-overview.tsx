import { Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { QualificationResult } from "@/lib/qualification/engine";
import {
  QUALIFICATION_STAT_META,
  QUALIFICATION_STAT_ORDER,
  ROUTING_EXPLANATION,
} from "@/lib/qualification/draft";

/**
 * The banner that explains what qualification is for, alongside what it has
 * actually done. The tiles are live counts across the workspace's real leads
 * — never a placeholder — so the explanation is grounded in the reader's own
 * data rather than an illustration.
 */
export function QualificationOverview({
  stats,
}: {
  stats: Record<QualificationResult, number>;
}) {
  return (
    <Card>
      <CardContent className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.5fr)_auto_minmax(0,0.8fr)]">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="bg-success-50 text-success-600 flex size-10 shrink-0 items-center justify-center rounded-xl"
          >
            <Target className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-content text-[16px] font-semibold">
              Qualification helps you focus on the right enquiries
            </h2>
            <p className="text-content-muted mt-1 text-[12.5px] leading-[1.55]">
              Ask a few simple questions to understand if an enquiry is a good
              fit. Leads are automatically routed based on their answers, so you
              can spend time on the right opportunities.
            </p>
          </div>
        </div>

        <div className="border-line-subtle xl:border-l xl:pl-5">
          <h3 className="text-content text-[13px] font-semibold">
            Qualification results
          </h3>
          <dl className="mt-2.5 flex flex-wrap gap-2">
            {QUALIFICATION_STAT_ORDER.map((key) => {
              const meta = QUALIFICATION_STAT_META[key];
              return (
                <div
                  key={key}
                  className={cn(
                    "border-line min-w-[4.5rem] rounded-lg border px-3 py-2",
                    key === "QUALIFIED" && "border-success-100 bg-success-50",
                    key === "NOT_QUALIFIED" && "border-danger-100 bg-danger-50",
                    key === "REVIEW" && "border-warning-100 bg-warning-50",
                    key === "PENDING" && "bg-surface-sunken",
                  )}
                >
                  <dd className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn("size-2 shrink-0 rounded-full", meta.dot)}
                    />
                    <span className="text-content lr-tabular text-[15px] font-semibold">
                      {stats[key].toLocaleString("en-GB")}
                    </span>
                  </dd>
                  <dt className="text-content-subtle mt-1 text-[10px] font-medium tracking-[0.06em] uppercase">
                    {meta.label}
                  </dt>
                </div>
              );
            })}
          </dl>
        </div>

        <div className="border-line-subtle xl:border-l xl:pl-5">
          <h3 className="text-content text-[13px] font-semibold">
            How routing works
          </h3>
          <ul className="text-content-muted mt-2.5 space-y-1.5 text-[12px]">
            {ROUTING_EXPLANATION.map((row) => (
              <li key={row.status} className="flex gap-1.5">
                <span aria-hidden className="text-content-subtle">
                  •
                </span>
                <span>
                  <span
                    className={cn(
                      "font-semibold",
                      row.status === "QUALIFIED" && "text-success-700",
                      row.status === "REVIEW" && "text-warning-700",
                      row.status === "NOT_QUALIFIED" && "text-danger-700",
                    )}
                  >
                    {row.status}
                  </span>{" "}
                  → {row.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
