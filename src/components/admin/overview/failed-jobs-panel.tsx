import * as React from "react";
import Link from "next/link";
import { ChevronRight, CircleAlert } from "lucide-react";
import { Panel, PanelEmpty, PanelLink } from "@/components/admin/ui";
import { formatRelative } from "@/lib/admin/format";
import type { FailedJobRow } from "@/lib/admin/types";

export function FailedJobsPanel({ jobs }: { jobs: FailedJobRow[] }) {
  return (
    <Panel
      icon={CircleAlert}
      tone="danger"
      title="Failed jobs"
      description="Recent failed or retrying background jobs."
      action={
        <PanelLink href="/admin/system?view=events&type=job&status=FAILED">
          View all
        </PanelLink>
      }
    >
      {jobs.length === 0 ? (
        <PanelEmpty>All background jobs are healthy.</PanelEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="border-y border-line-subtle bg-surface-sunken/60">
                <th scope="col" className="h-8 w-[150px] px-5 text-left text-[11.5px] font-medium text-content-muted">
                  Job type
                </th>
                <th scope="col" className="h-8 w-[170px] px-3 text-left text-[11.5px] font-medium text-content-muted">
                  Customer
                </th>
                <th scope="col" className="h-8 px-3 text-left text-[11.5px] font-medium text-content-muted">
                  Error
                </th>
                <th scope="col" className="h-8 w-[104px] px-3 text-left text-[11.5px] font-medium text-content-muted">
                  Time
                </th>
                <th scope="col" className="h-8 w-9 px-3">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {jobs.map((row) => (
                <tr key={row.id} className="hover:bg-surface-hover">
                  <td className="px-5 py-2">
                    <Link
                      href={row.href}
                      className="text-[12.5px] font-medium whitespace-nowrap text-content hover:text-content-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                    >
                      {row.jobLabel}
                    </Link>
                  </td>
                  <td className="truncate px-3 py-2 text-[12.5px] whitespace-nowrap text-content-secondary">
                    {row.businessId ? (
                      <Link
                        href={`/admin/customers?customer=${row.businessId}`}
                        className="hover:text-content-accent"
                      >
                        {row.businessName}
                      </Link>
                    ) : (
                      "Platform"
                    )}
                  </td>
                  <td className="max-w-0 px-3 py-2 text-[12.5px] text-content-secondary">
                    <span className="block truncate">{row.error}</span>
                  </td>
                  <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-muted">
                    {formatRelative(row.occurredAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ChevronRight className="inline size-4 text-content-subtle" aria-hidden />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
