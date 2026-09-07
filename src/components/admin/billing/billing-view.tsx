"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CircleDollarSign,
  CreditCard,
  ExternalLink,
  FileText,
  Inbox,
  PieChart,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { SearchInput } from "@/components/ui/search-input";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/feedback";
import { Sparkline } from "@/components/dashboard/sparkline";
import { IconTile, Panel, PanelEmpty, type TileTone } from "@/components/admin/ui";
import { DonutChart } from "@/components/admin/charts";
import { useAdminParams } from "@/components/admin/use-admin-params";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { SubscriptionDrawer } from "./subscription-drawer";
import {
  applyAccountCredit,
  cancelAtPeriodEnd,
  changePlan,
  extendTrial,
  grantEntitlement,
  reverseCredit,
  revertCancellation,
  revokeEntitlement,
} from "@/lib/admin/billing-actions";
import {
  formatDate,
  formatMoney,
  formatMoneyPrecise,
  formatNumber,
  formatPercent,
} from "@/lib/admin/format";
import {
  BILLING_VIEWS,
  BILLING_VIEW_LABEL,
  CREDIT_ENTRY_TYPE_LABEL,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_TONE,
  type BillingView,
  type BillingViewData,
} from "@/lib/admin/billing-types";

const KPIS: {
  key: "totalSubscriptions" | "active" | "trials" | "pastDue" | "cancelled";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: TileTone;
}[] = [
  { key: "totalSubscriptions", label: "Total subscriptions", icon: Users, tone: "accent" },
  { key: "active", label: "Active", icon: CircleDollarSign, tone: "success" },
  { key: "trials", label: "Trials", icon: Sparkles, tone: "info" },
  { key: "pastDue", label: "Past due", icon: AlertTriangle, tone: "danger" },
  { key: "cancelled", label: "Cancelled", icon: Inbox, tone: "neutral" },
];

export function BillingView({
  data,
  filters,
}: {
  data: BillingViewData;
  filters: { search: string; plan: string; status: string; cycle: string };
}) {
  const { setParams } = useAdminParams();
  const { run, pending, stepUpDialog } = useAdminAction();
  const { summary, detail } = data;

  return (
    <div className="space-y-4">
      {/* -------------------------------------------------------- view tabs */}
      <div
        role="tablist"
        aria-label="Billing view"
        className="flex gap-1 overflow-x-auto border-b border-line"
      >
        {BILLING_VIEWS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={data.view === option}
            onClick={() =>
              setParams({
                view: option === "subscriptions" ? null : option,
                page: null,
              })
            }
            className={cn(
              "shrink-0 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors",
              data.view === option
                ? "border-accent-500 text-content-accent"
                : "border-transparent text-content-muted hover:text-content",
            )}
          >
            {BILLING_VIEW_LABEL[option]}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------- KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {KPIS.map((card) => (
          <div
            key={card.key}
            className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs"
          >
            <div className="flex items-center gap-2.5">
              <IconTile icon={card.icon} tone={card.tone} />
              <p className="min-w-0 truncate text-[12px] font-medium text-content-muted">
                {card.label}
              </p>
            </div>
            <p className="lr-tabular mt-2.5 text-[26px] leading-none font-semibold tracking-[-0.025em] text-content">
              {formatNumber(summary[card.key])}
            </p>
            {card.key === "totalSubscriptions" && (
              <div className="mt-2 flex items-end justify-between gap-2">
                <span className="text-[11.5px] text-content-muted">
                  {formatMoney(summary.mrr)} MRR
                </span>
                <Sparkline values={summary.mrrSeries} tone="positive" width={80} height={22} />
              </div>
            )}
            {card.key === "cancelled" && summary.churnRate30d !== null && (
              <p className="mt-2 text-[11.5px] text-content-muted">
                {formatPercent(summary.churnRate30d)} churn (30d)
              </p>
            )}
          </div>
        ))}
      </div>

      {data.view === "subscriptions" && (
        <SubscriptionsView data={data} filters={filters} />
      )}
      {data.view === "invoices" && <InvoicesView data={data} />}
      {data.view === "credits" && (
        <CreditsView
          data={data}
          pending={pending}
          onReverse={(entryId, reason) =>
            void run(
              `reverse:${entryId}`,
              () => reverseCredit({ entryId, reason }),
              "Credit reversed.",
            )
          }
        />
      )}
      {data.view === "entitlements" && (
        <EntitlementsView
          data={data}
          pending={pending}
          onRevoke={(grantId) =>
            void run(
              `revoke:${grantId}`,
              () => revokeEntitlement({ grantId }),
              "Entitlement revoked.",
            )
          }
        />
      )}

      {detail && (
        <SubscriptionDrawer
          key={detail.id}
          subscription={detail}
          plans={data.plans}
          pending={pending}
          onClose={() => setParams({ subscription: null })}
          onChangePlan={(plan, interval) =>
            void run(
              `plan:${detail.id}`,
              () => changePlan({ subscriptionId: detail.id, plan, interval }),
              "Plan changed.",
            )
          }
          onCancel={(reason) =>
            void run(
              `cancel:${detail.id}`,
              () => cancelAtPeriodEnd({ subscriptionId: detail.id, reason }),
              "Set to cancel at period end.",
            )
          }
          onRevertCancellation={() =>
            void run(
              `revert:${detail.id}`,
              () => revertCancellation({ subscriptionId: detail.id }),
              "Cancellation removed.",
            )
          }
          onApplyCredit={(amount, reason, supportReference) =>
            void run(
              `credit:${detail.id}`,
              () =>
                applyAccountCredit({
                  subscriptionId: detail.id,
                  amount,
                  reason,
                  supportReference,
                }),
              "Credit applied.",
            )
          }
          onGrantEntitlement={(key, value, reason, expiresAt) =>
            void run(
              `grant:${detail.id}`,
              () =>
                grantEntitlement({
                  subscriptionId: detail.id,
                  key,
                  numericValue: value,
                  reason,
                  expiresAt,
                }),
              "Entitlement granted.",
            )
          }
          onExtendTrial={(trialEndsAt, reason) =>
            void run(
              `trial:${detail.id}`,
              () => extendTrial({ subscriptionId: detail.id, trialEndsAt, reason }),
              "Trial extended.",
            )
          }
        />
      )}

      {stepUpDialog}
    </div>
  );
}

/* ------------------------------------------------------- subscriptions --- */

function SubscriptionsView({
  data,
  filters,
}: {
  data: BillingViewData;
  filters: { search: string; plan: string; status: string; cycle: string };
}) {
  const { setParams } = useAdminParams();
  const { subscriptions, summary } = data;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          defaultValue={filters.search}
          label="Search subscriptions"
          placeholder="Search customers, domain or subscription ID..."
          onChange={(value) => setParams({ q: value || null, page: null })}
          className="w-full min-w-[220px] sm:w-[352px]"
        />
        <Select
          value={filters.plan}
          aria-label="Plan"
          className="h-9 w-[150px] text-[12.5px]"
          onChange={(event) =>
            setParams({
              plan: event.target.value === "all" ? null : event.target.value,
              page: null,
            })
          }
        >
          <option value="all">All plans</option>
          {data.plans.map((plan) => (
            <option key={plan.value} value={plan.value}>
              {plan.label}
            </option>
          ))}
        </Select>
        <Select
          value={filters.status}
          aria-label="Status"
          className="h-9 w-[150px] text-[12.5px]"
          onChange={(event) =>
            setParams({
              status: event.target.value === "all" ? null : event.target.value,
              page: null,
            })
          }
        >
          <option value="all">All statuses</option>
          {SUBSCRIPTION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {SUBSCRIPTION_STATUS_LABEL[status]}
            </option>
          ))}
        </Select>
        <Select
          value={filters.cycle}
          aria-label="Billing cycle"
          className="h-9 w-[160px] text-[12.5px]"
          onChange={(event) =>
            setParams({
              cycle: event.target.value === "all" ? null : event.target.value,
              page: null,
            })
          }
        >
          <option value="all">All billing cycles</option>
          <option value="month">Monthly</option>
          <option value="year">Annual</option>
        </Select>
        {(filters.search ||
          filters.plan !== "all" ||
          filters.status !== "all" ||
          filters.cycle !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() =>
              setParams({ q: null, plan: null, status: null, cycle: null, page: null })
            }
          >
            Reset
          </Button>
        )}
      </div>

      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
        {subscriptions.rows.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No subscriptions match these filters"
            description="Clear a filter to see the full book."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1020px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-surface-sunken/60">
                    {[
                      "Customer",
                      "Plan",
                      "Status",
                      "MRR",
                      "Billing cycle",
                      "Current period",
                      "Next billing",
                      "Stripe state",
                      "",
                    ].map((heading, index) => (
                      <th
                        key={heading || index}
                        scope="col"
                        className="px-4 py-2.5 text-[11.5px] font-semibold tracking-wide text-content-muted uppercase"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {subscriptions.rows.map((row) => (
                    <tr
                      key={row.id}
                      className={cn(
                        "transition-colors",
                        data.detail?.id === row.id
                          ? "bg-accent-50/60"
                          : "hover:bg-surface-hover",
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <span className="block truncate text-[13px] font-medium text-content">
                          {row.businessName}
                        </span>
                        {row.domain && (
                          <span className="block truncate text-[11.5px] text-content-subtle">
                            {row.domain}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone="neutral" className="px-2">
                          {row.planLabel}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={SUBSCRIPTION_STATUS_TONE[row.status]} dot>
                          {SUBSCRIPTION_STATUS_LABEL[row.status]}
                        </Badge>
                      </td>
                      <td className="lr-tabular px-4 py-2.5 text-[12.5px] text-content">
                        {formatMoney(row.mrr)}
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] text-content-secondary">
                        {row.billingCycle}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] whitespace-nowrap text-content-muted">
                        {row.currentPeriodStart && row.currentPeriodEnd
                          ? `${formatDate(row.currentPeriodStart)} – ${formatDate(row.currentPeriodEnd)}`
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] whitespace-nowrap text-content-muted">
                        {row.cancelAtPeriodEnd
                          ? "Cancels"
                          : row.nextBillingDate
                            ? formatDate(row.nextBillingDate)
                            : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.stripeState ? (
                          <Badge tone={SUBSCRIPTION_STATUS_TONE[row.stripeState]} dot>
                            {SUBSCRIPTION_STATUS_LABEL[row.stripeState]}
                          </Badge>
                        ) : (
                          <span
                            className="text-[12px] text-content-subtle"
                            title="This workspace has never reached Stripe checkout."
                          >
                            Not in Stripe
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setParams({ subscription: row.id })}
                          className="inline-flex h-7 items-center rounded-md border border-line px-2.5 text-[11.5px] font-medium text-content-secondary transition-colors hover:bg-surface-hover hover:text-content"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={subscriptions.page}
              pageSize={subscriptions.pageSize}
              total={subscriptions.total}
              onPageChange={(page) =>
                setParams({ page: page === 1 ? null : String(page) })
              }
              noun="subscriptions"
            />
          </>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel
          icon={PieChart}
          tone="accent"
          title="Subscriptions by plan"
          description="Current distribution across the book."
        >
          <div className="px-4 pb-4 sm:px-5">
            {summary.byPlan.length === 0 ? (
              <PanelEmpty>No subscriptions yet.</PanelEmpty>
            ) : (
              <DonutChart
                slices={summary.byPlan.map((slice) => ({
                  label: slice.label,
                  value: slice.count,
                }))}
                totalLabel="Total"
                size={158}
                thickness={21}
              />
            )}
          </div>
        </Panel>

        <Panel
          icon={TrendingUp}
          tone="success"
          title="Revenue by plan"
          description="Monthly recurring revenue contribution."
        >
          <div className="px-4 pb-4 sm:px-5">
            {summary.byPlan.length === 0 ? (
              <PanelEmpty>No revenue recorded.</PanelEmpty>
            ) : (
              <ul className="space-y-2.5 pt-1">
                {summary.byPlan.map((slice) => {
                  const share = summary.mrr === 0 ? 0 : slice.mrr / summary.mrr;
                  return (
                    <li key={slice.plan} className="flex items-center gap-3 text-[12.5px]">
                      <span className="w-24 shrink-0 truncate text-content-secondary">
                        {slice.label}
                      </span>
                      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                        <span
                          className="block h-full rounded-full bg-success-500"
                          style={{ width: `${share * 100}%` }}
                        />
                      </span>
                      <span className="lr-tabular w-20 shrink-0 text-right text-content">
                        {formatMoney(slice.mrr)}
                      </span>
                      <span className="lr-tabular w-11 shrink-0 text-right text-content-muted">
                        {Math.round(share * 100)}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ invoices --- */

function InvoicesView({ data }: { data: BillingViewData }) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      {data.invoiceError && (
        <p className="border-b border-warning-100 bg-warning-50 px-4 py-2.5 text-[12.5px] text-warning-700">
          {data.invoiceError}
        </p>
      )}
      {data.invoices.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No invoices to show"
          description="Invoices are read live from Stripe for the most recently active customers."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/60">
                {["Invoice", "Customer", "Date", "Amount", "Status", ""].map(
                  (heading, index) => (
                    <th
                      key={heading || index}
                      scope="col"
                      className="px-4 py-2.5 text-[11.5px] font-semibold tracking-wide text-content-muted uppercase"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-surface-hover">
                  <td className="lr-tabular px-4 py-2.5 text-[12.5px] font-medium text-content">
                    {invoice.number ?? invoice.id.slice(0, 14)}
                  </td>
                  <td className="px-4 py-2.5 text-[12.5px] text-content-secondary">
                    {invoice.businessName}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] whitespace-nowrap text-content-muted">
                    {formatDate(invoice.createdAt)}
                  </td>
                  <td className="lr-tabular px-4 py-2.5 text-[12.5px] text-content">
                    {formatMoneyPrecise(invoice.amount)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      tone={
                        invoice.status === "paid"
                          ? "success"
                          : invoice.status === "open"
                            ? "warning"
                            : "neutral"
                      }
                      dot
                    >
                      {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {invoice.hostedUrl && (
                      <Link
                        href={invoice.hostedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-content-accent hover:underline"
                      >
                        View
                        <ExternalLink className="size-3" aria-hidden />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- credits --- */

function CreditsView({
  data,
  pending,
  onReverse,
}: {
  data: BillingViewData;
  pending: string | null;
  onReverse: (entryId: string, reason: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <p className="border-b border-line bg-surface-sunken px-4 py-2.5 text-[12px] text-content-secondary">
        This ledger is append-only. A mistake is corrected by posting a reversal,
        never by editing or deleting an entry.
      </p>
      {data.credits.length === 0 ? (
        <EmptyState
          icon={CircleDollarSign}
          title="No credits or adjustments"
          description="Credits applied from a customer or subscription drawer appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/60">
                {["Customer", "Type", "Amount", "Reason", "Created by", "Date", "Status", ""].map(
                  (heading, index) => (
                    <th
                      key={heading || index}
                      scope="col"
                      className="px-4 py-2.5 text-[11.5px] font-semibold tracking-wide text-content-muted uppercase"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.credits.map((entry) => (
                <tr key={entry.id} className="hover:bg-surface-hover">
                  <td className="px-4 py-2.5 text-[12.5px] text-content">
                    {entry.businessName}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      tone={entry.entryType === "REVERSAL" ? "warning" : "accent"}
                      className="px-2"
                    >
                      {CREDIT_ENTRY_TYPE_LABEL[entry.entryType]}
                    </Badge>
                  </td>
                  <td className="lr-tabular px-4 py-2.5 text-[12.5px] text-content">
                    {formatMoneyPrecise(entry.amount)}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-content-secondary">
                    {entry.reason}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-content-muted">
                    {entry.createdBy ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] whitespace-nowrap text-content-muted">
                    {formatDate(entry.createdAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      tone={
                        entry.state === "APPLIED"
                          ? "success"
                          : entry.state === "FAILED"
                            ? "danger"
                            : entry.state === "REVERSED"
                              ? "neutral"
                              : "warning"
                      }
                      dot
                    >
                      {entry.state.charAt(0) + entry.state.slice(1).toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {entry.reversible && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending === `reverse:${entry.id}`}
                        onClick={() => {
                          const reason = window.prompt(
                            "Why is this credit being reversed? Recorded against your account.",
                          );
                          if (reason && reason.trim().length >= 5) {
                            onReverse(entry.id, reason.trim());
                          }
                        }}
                      >
                        Reverse
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------- entitlements --- */

function EntitlementsView({
  data,
  pending,
  onRevoke,
}: {
  data: BillingViewData;
  pending: string | null;
  onRevoke: (grantId: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <p className="border-b border-line bg-surface-sunken px-4 py-2.5 text-[12px] text-content-secondary">
        Grants expire automatically. A grant past its expiry is listed but no longer
        applied by the entitlement service.
      </p>
      {data.entitlements.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No entitlement overrides"
          description="Temporary grants issued from a subscription drawer appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/60">
                {["Customer", "Plan", "Feature", "Base limit", "Override", "Reason", "Expires", ""].map(
                  (heading, index) => (
                    <th
                      key={heading || index}
                      scope="col"
                      className="px-4 py-2.5 text-[11.5px] font-semibold tracking-wide text-content-muted uppercase"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.entitlements.map((row) => (
                <tr
                  key={row.id}
                  className={cn("hover:bg-surface-hover", row.expired && "opacity-60")}
                >
                  <td className="px-4 py-2.5 text-[12.5px] text-content">
                    {row.businessName}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone="neutral" className="px-2">
                      {row.planLabel}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-[12.5px] text-content-secondary">
                    {row.keyLabel}
                  </td>
                  <td className="lr-tabular px-4 py-2.5 text-[12.5px] text-content-muted">
                    {row.baseLimit === null ? "—" : formatNumber(row.baseLimit)}
                  </td>
                  <td className="lr-tabular px-4 py-2.5 text-[12.5px] font-medium text-content">
                    {row.override !== null
                      ? formatNumber(row.override)
                      : row.booleanValue === null
                        ? "—"
                        : row.booleanValue
                          ? "Enabled"
                          : "Disabled"}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-content-secondary">
                    {row.reason}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] whitespace-nowrap">
                    {row.expiresAt ? (
                      <span className={row.expired ? "text-content-muted" : "text-content"}>
                        {formatDate(row.expiresAt)}
                        {row.expired ? " (expired)" : ""}
                      </span>
                    ) : (
                      <span className="text-content-muted">No expiry</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {!row.expired && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending === `revoke:${row.id}`}
                        onClick={() => onRevoke(row.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
