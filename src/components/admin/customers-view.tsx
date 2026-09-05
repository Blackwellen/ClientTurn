"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SearchInput } from "@/components/ui/search-input";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, formatNumber, formatRelative } from "@/lib/admin/format";
import type {
  CustomerDetail,
  CustomerFilter,
  CustomerListResult,
  CustomerRow,
} from "@/lib/admin/types";
import { CustomerDrawer } from "./customer-drawer";

const FILTER_TABS: { value: CustomerFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "trial", label: "Trial" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Past due" },
  { value: "cancelled", label: "Cancelled" },
  { value: "integration_problem", label: "Integration problem" },
];

const HEALTH_LABEL: Record<string, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  action_required: "Action required",
  disconnected: "Disconnected",
  none: "None connected",
};

const HEALTH_TONE: Record<string, string> = {
  healthy: "text-success-600",
  degraded: "text-warning-600",
  action_required: "text-danger-600",
  disconnected: "text-danger-600",
  none: "text-content-subtle",
};

export function CustomersView({
  result,
  filter,
  search,
  detail,
}: {
  result: CustomerListResult;
  filter: CustomerFilter;
  search: string;
  detail: CustomerDetail | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const columns: Column<CustomerRow>[] = [
    {
      key: "name",
      header: "Workspace",
      render: (row) => (
        <div className="min-w-0">
          <p className="text-content truncate font-medium">{row.name}</p>
          <p className="text-content-subtle truncate text-[12px]">
            {row.ownerName} · {row.ownerEmail}
          </p>
        </div>
      ),
    },
    { key: "plan", header: "Plan", render: (row) => row.plan },
    {
      key: "subscriptionStatus",
      header: "Subscription",
      render: (row) => (
        <StatusBadge kind="subscription" value={row.subscriptionStatus} />
      ),
    },
    {
      key: "leadsThisPeriod",
      header: "Leads",
      align: "right",
      numeric: true,
      render: (row) => formatNumber(row.leadsThisPeriod),
    },
    {
      key: "messagesThisPeriod",
      header: "Messages",
      align: "right",
      numeric: true,
      render: (row) => formatNumber(row.messagesThisPeriod),
    },
    {
      key: "integrationHealth",
      header: "Integrations",
      render: (row) => (
        <span className={HEALTH_TONE[row.integrationHealth] ?? ""}>
          {HEALTH_LABEL[row.integrationHealth] ?? row.integrationHealth}
        </span>
      ),
    },
    {
      key: "joinedAt",
      header: "Joined",
      render: (row) => formatDate(row.joinedAt),
    },
    {
      key: "lastActivityAt",
      header: "Last activity",
      align: "right",
      render: (row) => formatRelative(row.lastActivityAt),
    },
  ];

  return (
    <>
      <div className="space-y-3">
        <Tabs
          items={FILTER_TABS}
          value={filter}
          onChange={(value) =>
            setParams({ filter: value === "all" ? null : value, page: null })
          }
        />

        <SearchInput
          defaultValue={search}
          label="Search customers"
          placeholder="Search by workspace name or owner email"
          onChange={(value) => setParams({ q: value || null, page: null })}
          className="w-full sm:w-96"
        />

        <Card>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              rows={result.rows}
              rowKey={(row) => row.id}
              onRowClick={(row) => setParams({ customer: row.id })}
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              onPageChange={(page) => setParams({ page: String(page) })}
              stickyHeader
              empty={
                <EmptyState
                  icon={Building2}
                  title="No customers match"
                  description="Try a different filter or clear the search."
                />
              }
            />
          </CardContent>
        </Card>
      </div>

      {detail && (
        <CustomerDrawer
          detail={detail}
          onClose={() => setParams({ customer: null })}
        />
      )}
    </>
  );
}
