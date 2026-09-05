"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/feedback";
import { KpiCard } from "@/components/ui/stat-card";
import { useToast } from "@/components/ui/toast";
import { DataTable, type Column } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionHeader } from "@/components/app/page-header";
import { StepUpDialog } from "./step-up-dialog";
import { MetaScenarioCalculator } from "./meta-scenario-calculator";
import { retryWebhookEvent } from "@/lib/admin/actions";
import type { AdminActionResult } from "@/lib/admin/actions";
import {
  formatDateTime,
  formatMoneyPrecise,
  formatNumber,
  formatPercent,
  formatRelative,
  providerLabel,
} from "@/lib/admin/format";
import {
  INTEGRATION_HEALTH_LABEL,
  type JobErrorRow,
  type WebhookEventRow,
} from "@/lib/admin/types";

type ProviderHealthRow = {
  provider: string;
  healthy: number;
  degraded: number;
  actionRequired: number;
  disconnected: number;
};

type IntegrationFailure = {
  id: string;
  businessName: string;
  provider: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  occurredAt: string | null;
};

const TABS = [
  { value: "integrations", label: "Integrations" },
  { value: "webhooks", label: "Webhooks" },
  { value: "messaging", label: "Messaging" },
  { value: "ai", label: "AI usage" },
  { value: "economics", label: "Economics" },
  { value: "billing", label: "Billing events" },
  { value: "errors", label: "Errors" },
];

const WEBHOOK_STATUSES = ["all", "received", "processing", "processed", "failed", "ignored"];

export function SystemTabs({
  tab,
  provider,
  status,
  page,
  integrations,
  webhooks,
  providers,
  messaging,
  ai,
  economics,
  errors,
}: {
  tab: string;
  provider: string;
  status: string;
  page: number;
  integrations: { providers: ProviderHealthRow[]; failures: IntegrationFailure[] } | null;
  webhooks: { rows: WebhookEventRow[]; total: number } | null;
  providers: string[] | null;
  messaging: {
    sent: number;
    delivered: number;
    failed: number;
    inbound: number;
    optOuts: number;
    cost: number;
    windowDays: number;
  } | null;
  ai: {
    calls: number;
    estimatedCost: number;
    parseFailures: number;
    handoverRate: number;
    handovers: number;
    leads: number;
    windowDays: number;
    nanoCalls: number;
    miniCalls: number;
    reviewRate: number;
  } | null;
  economics: {
    billingPeriod: string;
    totalRevenue: number;
    totalCogs: number;
    grossContribution: number;
    grossMarginPercent: number | null;
    byPlan: {
      plan: string;
      businesses: number;
      revenue: number;
      cogs: number;
      marginPercent: number | null;
    }[];
    costLeaders: { businessId: string; businessName: string; cost30d: number }[];
  } | null;
  errors: JobErrorRow[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [pendingRetry, setPendingRetry] = React.useState<string | null>(null);
  const [stepUpFor, setStepUpFor] = React.useState<null | (() => Promise<void>)>(null);

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

  const runRetry = React.useCallback(
    async (id: string) => {
      const attempt = async (): Promise<AdminActionResult> => retryWebhookEvent(id);
      setPendingRetry(id);
      try {
        const result = await attempt();
        if (result.ok) {
          toast({ variant: "success", title: result.message ?? "Webhook re-queued." });
          router.refresh();
          return;
        }
        if (result.code === "step_up_required") {
          setStepUpFor(() => async () => {
            const retry = await attempt();
            if (retry.ok) {
              toast({ variant: "success", title: retry.message ?? "Webhook re-queued." });
              router.refresh();
            } else {
              toast({ variant: "error", title: retry.error });
            }
          });
          return;
        }
        toast({ variant: "error", title: result.error });
      } finally {
        setPendingRetry(null);
      }
    },
    [router, toast],
  );

  const webhookColumns: Column<WebhookEventRow>[] = [
    {
      key: "provider",
      header: "Provider",
      render: (row) => providerLabel(row.provider),
    },
    { key: "eventType", header: "Event", render: (row) => row.eventType ?? "—" },
    {
      key: "externalEventId",
      header: "External id",
      render: (row) => (
        <span className="lr-tabular block max-w-[14rem] truncate text-[12px]">
          {row.externalEventId}
        </span>
      ),
    },
    {
      key: "businessName",
      header: "Workspace",
      render: (row) => row.businessName ?? "—",
    },
    { key: "status", header: "Status", render: (row) => row.status },
    {
      key: "attempts",
      header: "Attempts",
      align: "right",
      numeric: true,
      render: (row) => row.attempts,
    },
    {
      key: "receivedAt",
      header: "Received",
      render: (row) => formatDateTime(row.receivedAt),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        row.retryable ? (
          <Button
            variant="secondary"
            size="sm"
            loading={pendingRetry === row.id}
            onClick={() => runRetry(row.id)}
          >
            Retry
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <Tabs
        items={TABS}
        value={tab}
        onChange={(value) =>
          setParams({
            tab: value === "integrations" ? null : value,
            page: null,
            provider: null,
            status: null,
          })
        }
      />

      <div className="mt-4 space-y-4">
        {tab === "integrations" && integrations && (
          <>
            <Card>
              <CardHeader>
                <SectionHeader title="Provider health" />
              </CardHeader>
              <CardContent className="pt-0">
                {integrations.providers.length === 0 ? (
                  <EmptyState title="No integrations connected yet" />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {integrations.providers.map((row) => (
                      <div
                        key={row.provider}
                        className="border-line rounded-lg border px-3 py-2.5"
                      >
                        <p className="text-content text-[13px] font-medium">
                          {providerLabel(row.provider)}
                        </p>
                        <dl className="mt-2 grid grid-cols-2 gap-1 text-[12px]">
                          <dt className="text-content-subtle">
                            {INTEGRATION_HEALTH_LABEL.HEALTHY}
                          </dt>
                          <dd className="text-success-600 text-right">{row.healthy}</dd>
                          <dt className="text-content-subtle">
                            {INTEGRATION_HEALTH_LABEL.DEGRADED}
                          </dt>
                          <dd className="text-warning-600 text-right">{row.degraded}</dd>
                          <dt className="text-content-subtle">
                            {INTEGRATION_HEALTH_LABEL.ACTION_REQUIRED}
                          </dt>
                          <dd className="text-danger-600 text-right">
                            {row.actionRequired}
                          </dd>
                          <dt className="text-content-subtle">
                            {INTEGRATION_HEALTH_LABEL.DISCONNECTED}
                          </dt>
                          <dd className="text-content-muted text-right">
                            {row.disconnected}
                          </dd>
                        </dl>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <SectionHeader title="Recent authentication failures" />
              </CardHeader>
              <CardContent className="pt-0">
                {integrations.failures.length === 0 ? (
                  <EmptyState title="No recent failures" />
                ) : (
                  <ul className="divide-line divide-y">
                    {integrations.failures.map((failure) => (
                      <li key={failure.id} className="py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-content text-[13px] font-medium">
                              {failure.businessName} · {providerLabel(failure.provider)}
                            </p>
                            <p className="text-content-muted text-[13px] break-words">
                              {failure.errorCode ? `${failure.errorCode}: ` : ""}
                              {failure.errorMessage ?? "No detail recorded"}
                            </p>
                          </div>
                          <span className="text-content-subtle shrink-0 text-[12px]">
                            {formatRelative(failure.occurredAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {(tab === "webhooks" || tab === "billing") && webhooks && (
          <Card>
            <CardHeader>
              <SectionHeader
                title={tab === "billing" ? "Stripe billing events" : "Webhook events"}
                description="Only rows that failed can be retried."
                action={
                  <div className="flex items-center gap-2">
                    {tab === "webhooks" && providers && (
                      <Select
                        aria-label="Provider"
                        value={provider}
                        onChange={(event) =>
                          setParams({ provider: event.target.value, page: null })
                        }
                        className="h-8 w-auto text-[13px]"
                      >
                        <option value="all">All providers</option>
                        {providers.map((item) => (
                          <option key={item} value={item}>
                            {providerLabel(item)}
                          </option>
                        ))}
                      </Select>
                    )}
                    <Select
                      aria-label="Status"
                      value={status}
                      onChange={(event) =>
                        setParams({ status: event.target.value, page: null })
                      }
                      className="h-8 w-auto text-[13px]"
                    >
                      {WEBHOOK_STATUSES.map((item) => (
                        <option key={item} value={item}>
                          {item === "all" ? "All statuses" : item}
                        </option>
                      ))}
                    </Select>
                  </div>
                }
              />
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={webhookColumns}
                rows={webhooks.rows}
                rowKey={(row) => row.id}
                page={page}
                pageSize={25}
                total={webhooks.total}
                onPageChange={(next) => setParams({ page: String(next) })}
                stickyHeader
                empty={<EmptyState title="No webhook events match" />}
              />
            </CardContent>
          </Card>
        )}

        {tab === "messaging" && messaging && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
              <KpiCard label="Sent" value={formatNumber(messaging.sent)} />
              <KpiCard label="Delivered" value={formatNumber(messaging.delivered)} />
              <KpiCard label="Failed" value={formatNumber(messaging.failed)} />
              <KpiCard label="Inbound" value={formatNumber(messaging.inbound)} />
              <KpiCard label="Opt-outs" value={formatNumber(messaging.optOuts)} />
              <KpiCard label="Cost" value={formatMoneyPrecise(messaging.cost)} />
            </div>
            <p className="text-content-subtle text-[12px]">
              Across the last {messaging.windowDays} days, all workspaces.
            </p>
          </>
        )}

        {tab === "ai" && ai && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
              <KpiCard label="Calls" value={formatNumber(ai.calls)} />
              <KpiCard
                label="Estimated cost"
                value={formatMoneyPrecise(ai.estimatedCost)}
              />
              <KpiCard
                label="Review rate"
                value={formatPercent(ai.reviewRate)}
                hint="Share of calls that came back below the confidence threshold and were left to the deterministic REVIEW path."
              />
              <KpiCard label="Parse failures" value={formatNumber(ai.parseFailures)} />
              <KpiCard
                label="Handover rate"
                value={formatPercent(ai.handoverRate)}
                hint="Share of leads handed to a person. A rise is not automatically bad, but a sharp change is worth investigating."
              />
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
              <KpiCard
                label="Nano calls"
                value={formatNumber(ai.nanoCalls)}
                hint="Fast, structured tasks — intent and answer extraction."
              />
              <KpiCard
                label="Mini calls"
                value={formatNumber(ai.miniCalls)}
                hint="Generation and ambiguous-reply tasks."
              />
              <KpiCard label="Handovers" value={formatNumber(ai.handovers)} />
            </div>
            <p className="text-content-subtle text-[12px]">
              Across the last {ai.windowDays} days, over{" "}
              {formatNumber(ai.leads)} leads.
            </p>
          </>
        )}

        {tab === "economics" && economics && (
          <div className="space-y-4">
            <div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard label="Revenue" value={formatMoneyPrecise(economics.totalRevenue)} />
                <KpiCard label="COGS" value={formatMoneyPrecise(economics.totalCogs)} />
                <KpiCard
                  label="Gross contribution"
                  value={formatMoneyPrecise(economics.grossContribution)}
                />
                <KpiCard
                  label="Gross margin"
                  value={
                    economics.grossMarginPercent === null
                      ? "—"
                      : formatPercent(economics.grossMarginPercent / 100)
                  }
                  hint="Target ≥75%. Below 70% is a warning; below 60% is critical."
                />
              </div>
              <p className="text-content-subtle mt-2 text-[12px]">
                Billing period starting {economics.billingPeriod}. Revenue is approximated from
                each plan&apos;s list price, not a real Stripe invoice total — there is no
                billing-events ledger yet. Platform-cost allocation is not yet tracked, so COGS
                only reflects metered AI/SMS/WhatsApp/Stripe cost.
              </p>
            </div>

            <Card>
              <CardHeader>
                <SectionHeader title="Margin by plan" />
              </CardHeader>
              <CardContent className="pt-0">
                {economics.byPlan.length === 0 ? (
                  <EmptyState title="No completed billing period yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plan</TableHead>
                        <TableHead align="right" numeric>Businesses</TableHead>
                        <TableHead align="right" numeric>Revenue</TableHead>
                        <TableHead align="right" numeric>COGS</TableHead>
                        <TableHead align="right" numeric>Margin</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {economics.byPlan.map((row) => (
                        <TableRow key={row.plan}>
                          <TableCell className="capitalize">{row.plan}</TableCell>
                          <TableCell align="right" numeric>{formatNumber(row.businesses)}</TableCell>
                          <TableCell align="right" numeric>{formatMoneyPrecise(row.revenue)}</TableCell>
                          <TableCell align="right" numeric>{formatMoneyPrecise(row.cogs)}</TableCell>
                          <TableCell align="right" numeric>
                            {row.marginPercent === null
                              ? "—"
                              : formatPercent(row.marginPercent / 100)}
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
                <SectionHeader
                  title="Cost leaders (30d)"
                  description="Highest AI + messaging cost. Not automatically a problem — check against plan and lead volume."
                />
              </CardHeader>
              <CardContent className="pt-0">
                {economics.costLeaders.length === 0 ? (
                  <EmptyState title="No metered cost in the last 30 days" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Workspace</TableHead>
                        <TableHead align="right" numeric>Cost (30d)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {economics.costLeaders.map((row) => (
                        <TableRow key={row.businessId}>
                          <TableCell>{row.businessName}</TableCell>
                          <TableCell align="right" numeric>
                            {formatMoneyPrecise(row.cost30d)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <MetaScenarioCalculator />
          </div>
        )}

        {tab === "errors" && errors && (
          <Card>
            <CardHeader>
              <SectionHeader title="Recent job failures" />
            </CardHeader>
            <CardContent className="pt-0">
              {errors.length === 0 ? (
                <EmptyState
                  title="No failed jobs"
                  description="The worker is draining the queue without errors."
                />
              ) : (
                <ul className="divide-line divide-y">
                  {errors.map((row) => (
                    <li key={row.id} className="py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-content text-[13px] font-medium">
                            {row.area}
                            <span className="text-content-subtle ml-2 text-[12px]">
                              {row.state} · {row.attempts} attempt
                              {row.attempts === 1 ? "" : "s"}
                            </span>
                          </p>
                          <p className="text-content-muted text-[13px] break-words">
                            {row.message}
                          </p>
                          {row.businessName && (
                            <p className="text-content-subtle text-[12px]">
                              {row.businessName}
                            </p>
                          )}
                        </div>
                        <span className="text-content-subtle shrink-0 text-[12px]">
                          {formatRelative(row.occurredAt)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <StepUpDialog
        open={stepUpFor !== null}
        onClose={() => setStepUpFor(null)}
        onConfirmed={async () => {
          const action = stepUpFor;
          setStepUpFor(null);
          if (action) await action();
        }}
      />
    </>
  );
}
