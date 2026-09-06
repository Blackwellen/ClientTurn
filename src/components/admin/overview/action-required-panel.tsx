import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronRight,
  CircleAlert,
  Clock,
  CreditCard,
  Gauge,
  PlugZap,
} from "lucide-react";
import { Panel, PanelEmpty, PanelLink } from "@/components/admin/ui";
import { formatRelative } from "@/lib/admin/format";
import { ACTION_REQUIRED_LABEL, type ActionRequiredRow } from "@/lib/admin/types";
import { cn } from "@/lib/cn";

const KIND_ICON = {
  payment_failed: { icon: CreditCard, className: "text-danger-600" },
  trial_ending: { icon: Clock, className: "text-warning-600" },
  high_usage: { icon: Gauge, className: "text-warning-600" },
  integration_error: { icon: PlugZap, className: "text-danger-600" },
  workspace_health: { icon: CircleAlert, className: "text-danger-600" },
} as const;

export function ActionRequiredPanel({ items }: { items: ActionRequiredRow[] }) {
  return (
    <Panel
      icon={AlertTriangle}
      tone="warning"
      title="Action required"
      description="Items that need your attention."
      action={<PanelLink href="/admin/customers?filter=past_due">View all</PanelLink>}
    >
      {items.length === 0 ? (
        <PanelEmpty>Nothing needs your attention right now.</PanelEmpty>
      ) : (
        <div className="overflow-x-auto">
          {/* table-fixed: the Description is the only cell allowed to give
              way, so Customer and Time never get pushed out of the panel. */}
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="border-y border-line-subtle bg-surface-sunken/60">
                <th scope="col" className="h-8 w-[150px] px-5 text-left text-[11.5px] font-medium text-content-muted">
                  Type
                </th>
                <th scope="col" className="h-8 px-3 text-left text-[11.5px] font-medium text-content-muted">
                  Description
                </th>
                <th scope="col" className="h-8 w-[160px] px-3 text-left text-[11.5px] font-medium text-content-muted">
                  Customer
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
              {items.map((row) => {
                const config = KIND_ICON[row.kind];
                const Icon = config.icon;
                return (
                  <tr key={row.id} className="hover:bg-surface-hover">
                    <td className="px-5 py-2">
                      <span className="flex items-center gap-2 text-[12.5px] font-medium whitespace-nowrap text-content">
                        <Icon
                          className={cn("size-3.5 shrink-0", config.className)}
                          aria-hidden
                        />
                        {ACTION_REQUIRED_LABEL[row.kind]}
                      </span>
                    </td>
                    <td className="max-w-0 px-3 py-2 text-[12.5px] text-content-secondary">
                      <span className="block truncate">{row.detail}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={row.href}
                        className="block truncate text-[12.5px] font-medium whitespace-nowrap text-content hover:text-content-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                      >
                        {row.businessName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-[12.5px] whitespace-nowrap text-content-muted">
                      {row.occurredAt ? formatRelative(row.occurredAt) : "Ongoing"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ChevronRight className="inline size-4 text-content-subtle" aria-hidden />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
