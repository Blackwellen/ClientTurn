"use client";

import Link from "next/link";
import { PieChart } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SectionHeader } from "@/components/app/page-header";
import { serviceScopeSummary, type DraftQuestion } from "@/lib/qualification/draft";
import type { ServiceRef } from "@/lib/qualification/types";

/**
 * How much of the qualification set each service actually gets asked.
 *
 * Computed from the live draft, so scoping a question to one service shows up
 * here immediately — including the case worth spotting, where a service is
 * covered by fewer questions than the rest.
 */
export function ServiceScopeCard({
  questions,
  services,
}: {
  questions: DraftQuestion[];
  services: ServiceRef[];
}) {
  const rows = serviceScopeSummary(questions, services);

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-0 border-b-0 px-5 pt-5 pb-0">
        <SectionHeader
          dense
          icon={PieChart}
          tone="purple"
          title="Service scope summary"
          description="See which services have qualification questions."
        />
      </CardHeader>

      <CardContent className="px-5 pt-4 pb-5">
        {services.length === 0 ? (
          <div>
            <p className="text-content-muted text-[13px]">
              You have not added any services yet, so questions cannot be scoped
              to one service. Every question applies to every enquiry until you
              do.
            </p>
            <Link
              href="/app/settings?section=workspace"
              className="text-content-accent mt-2 inline-block text-[13px] font-medium"
            >
              Add your services
            </Link>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((row) => (
              <li
                key={row.id ?? "all"}
                className="grid grid-cols-[minmax(4.5rem,1fr)_auto_minmax(4rem,1.2fr)_2.5rem] items-center gap-3"
              >
                <span className="text-content truncate text-[13px]">
                  {row.name}
                </span>
                <span className="text-content-muted lr-tabular text-[12px] whitespace-nowrap">
                  {row.count} {row.count === 1 ? "question" : "questions"}
                </span>
                <Progress
                  className="h-2"
                  value={row.percent}
                  tone="success"
                  label={`${row.name} question coverage`}
                />
                <span className="text-content-muted lr-tabular text-right text-[12px]">
                  {row.percent}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
