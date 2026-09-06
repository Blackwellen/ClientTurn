import * as React from "react";
import Link from "next/link";
import { Activity, ChevronRight } from "lucide-react";
import {
  Panel,
  PanelEmpty,
  PanelLink,
  ProviderMark,
  ProviderStatusBadge,
} from "@/components/admin/ui";
import { formatMs, formatUptime } from "@/lib/admin/format";
import type { PlatformProviderRow } from "@/lib/admin/types";

export function ProviderHealthPanel({
  providers,
}: {
  providers: PlatformProviderRow[];
}) {
  return (
    <Panel
      icon={Activity}
      tone="success"
      title="Provider health"
      description="Real-time status of key integrations and providers."
      action={
        <PanelLink href="/admin/system?view=health">View all providers</PanelLink>
      }
    >
      {providers.length === 0 ? (
        <PanelEmpty>No providers are configured on this deployment.</PanelEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-line-subtle bg-surface-sunken/60">
                <th scope="col" className="h-8 px-5 text-left text-[11.5px] font-medium text-content-muted">
                  Provider
                </th>
                <th scope="col" className="h-8 px-3 text-left text-[11.5px] font-medium text-content-muted">
                  Status
                </th>
                <th scope="col" className="h-8 px-3 text-left text-[11.5px] font-medium whitespace-nowrap text-content-muted">
                  Response time (p95)
                </th>
                <th scope="col" className="h-8 px-3 text-left text-[11.5px] font-medium whitespace-nowrap text-content-muted">
                  Uptime (30d)
                </th>
                <th scope="col" className="h-8 w-8 px-3">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {providers.map((row) => (
                <tr key={row.provider} className="hover:bg-surface-hover">
                  <td className="px-5 py-2">
                    <Link
                      href={`/admin/system?view=health&provider=${row.provider}`}
                      className="flex items-center gap-2.5 text-[13px] font-medium whitespace-nowrap text-content hover:text-content-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
                    >
                      <ProviderMark provider={row.provider} />
                      {row.label}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <ProviderStatusBadge status={row.status} />
                  </td>
                  <td className="lr-tabular px-3 py-2 text-[12.5px] text-content-secondary">
                    {formatMs(row.p95Ms)}
                  </td>
                  <td className="lr-tabular px-3 py-2 text-[12.5px] text-content-secondary">
                    {formatUptime(row.uptime30d)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ChevronRight
                      className="inline size-4 text-content-subtle"
                      aria-hidden
                    />
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
