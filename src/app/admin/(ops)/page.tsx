import * as React from "react";
import Link from "next/link";
import { getAdminOverview } from "@/lib/admin/queries";
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  formatRelative,
  providerLabel,
} from "@/lib/admin/format";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/feedback";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, SectionHeader } from "@/components/app/page-header";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  integration: "bg-warning-500",
  delivery: "bg-danger-500",
  billing: "bg-danger-500",
};

export default async function AdminOverviewPage() {
  const overview = await getAdminOverview();
  const { cards } = overview;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description="Platform health across every workspace."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard label="Active customers" value={formatNumber(cards.activeCustomers)} />
        <KpiCard label="Trials" value={formatNumber(cards.trials)} />
        <KpiCard
          label="MRR mirror"
          value={formatMoney(cards.mrrMirror)}
          hint="Summed from the local subscriptions table. Stripe remains the source of truth for billing."
        />
        <KpiCard label="Enterprise" value={formatNumber(cards.enterpriseAccounts)} />
        <KpiCard
          label="Failed jobs"
          value={formatNumber(cards.failedJobs)}
          hint="Jobs in a failed or dead state awaiting attention."
        />
        <KpiCard label="Signups today" value={formatNumber(cards.signupsToday)} />
        <KpiCard label="Signups (7d)" value={formatNumber(cards.signupsWeek)} />
        <KpiCard label="Leads today" value={formatNumber(cards.leadsToday)} />
        <KpiCard label="Messages today" value={formatNumber(cards.messagesToday)} />
        <KpiCard label="Bookings today" value={formatNumber(cards.bookingsToday)} />
      </div>

      <Card>
        <CardHeader>
          <SectionHeader
            title="Action required"
            description="Only genuinely actionable problems appear here."
          />
        </CardHeader>
        <CardContent className="pt-0">
          {overview.actionRequired.length === 0 ? (
            <EmptyState
              title="Nothing needs attention"
              description="No disconnected integrations, delivery failures or billing problems."
            />
          ) : (
            <ul className="divide-line divide-y">
              {overview.actionRequired.map((item) => (
                <li key={item.id} className="flex items-start gap-3 py-2.5">
                  <span
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${TONE[item.kind] ?? "bg-warning-500"}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/customers?customer=${item.businessId}`}
                      className="text-content hover:text-content-accent text-[13px] font-medium"
                    >
                      {item.businessName}
                    </Link>
                    <p className="text-content-muted text-[13px]">{item.detail}</p>
                  </div>
                  <span className="text-content-subtle shrink-0 text-[12px]">
                    {formatRelative(item.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <SectionHeader title="Recent signups" />
          </CardHeader>
          <CardContent className="pt-0">
            {overview.recentSignups.length === 0 ? (
              <EmptyState title="No signups yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead align="right">Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.recentSignups.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link
                          href={`/admin/customers?customer=${row.id}`}
                          className="text-content hover:text-content-accent font-medium"
                        >
                          {row.name}
                        </Link>
                      </TableCell>
                      <TableCell>{row.plan ?? "—"}</TableCell>
                      <TableCell>{row.status}</TableCell>
                      <TableCell align="right">
                        {formatRelative(row.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionHeader title="Recent cancellations" />
          </CardHeader>
          <CardContent className="pt-0">
            {overview.recentCancellations.length === 0 ? (
              <EmptyState title="No cancellations" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead align="right">Cancelled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.recentCancellations.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link
                          href={`/admin/customers?customer=${row.id}`}
                          className="text-content hover:text-content-accent font-medium"
                        >
                          {row.name}
                        </Link>
                      </TableCell>
                      <TableCell>{row.plan}</TableCell>
                      <TableCell align="right">
                        {formatDateTime(row.cancelledAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <SectionHeader title="Provider health" />
        </CardHeader>
        <CardContent className="pt-0">
          {overview.providerHealth.length === 0 ? (
            <EmptyState
              title="No integrations connected"
              description="Provider health appears once a workspace connects something."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead align="right" numeric>Healthy</TableHead>
                  <TableHead align="right" numeric>Degraded</TableHead>
                  <TableHead align="right" numeric>Action required</TableHead>
                  <TableHead align="right" numeric>Disconnected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.providerHealth.map((row) => (
                  <TableRow key={row.provider}>
                    <TableCell>{providerLabel(row.provider)}</TableCell>
                    <TableCell align="right" numeric>{row.healthy}</TableCell>
                    <TableCell align="right" numeric>{row.degraded}</TableCell>
                    <TableCell align="right" numeric>{row.actionRequired}</TableCell>
                    <TableCell align="right" numeric>{row.disconnected}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
