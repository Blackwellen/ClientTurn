import * as React from "react";
import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { Panel, PanelEmpty, PanelLink, BusinessCell } from "@/components/admin/ui";
import { StatusBadge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/admin/format";
import type { RecentCustomerRow } from "@/lib/admin/types";

export function RecentCustomersPanel({
  customers,
}: {
  customers: RecentCustomerRow[];
}) {
  return (
    <Panel
      icon={Building2}
      tone="info"
      title="Recent customers"
      description="Latest customers to sign up."
      action={<PanelLink href="/admin/customers">View all customers</PanelLink>}
    >
      {customers.length === 0 ? (
        <PanelEmpty>No customers have signed up yet.</PanelEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-line-subtle bg-surface-sunken/60">
                <th scope="col" className="h-8 px-5 text-left text-[11.5px] font-medium text-content-muted">
                  Name
                </th>
                <th scope="col" className="h-8 px-3 text-left text-[11.5px] font-medium text-content-muted">
                  Plan
                </th>
                <th scope="col" className="h-8 px-3 text-left text-[11.5px] font-medium text-content-muted">
                  Status
                </th>
                <th scope="col" className="h-8 px-3 text-left text-[11.5px] font-medium whitespace-nowrap text-content-muted">
                  Signup date
                </th>
                <th scope="col" className="h-8 w-8 px-3">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {customers.map((row) => (
                <tr key={row.id} className="hover:bg-surface-hover">
                  <td className="px-5 py-2">
                    <Link
                      href={`/admin/customers?customer=${row.id}`}
                      className="block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                    >
                      <BusinessCell name={row.name} domain={row.domain} />
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[12.5px] text-content-secondary">
                    {row.planLabel}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge kind="subscription" value={row.subscriptionStatus} />
                  </td>
                  <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-muted">
                    {formatRelative(row.joinedAt)}
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
