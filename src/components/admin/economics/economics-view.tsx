import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Calculator,
  Coins,
  FileSearch,
  Gauge,
  PieChart,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { IconTile, Panel, PanelEmpty, type TileTone } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { COST_LINES, COST_LINE_ORDER, MIN_GROSS_MARGIN, whatsappPricing } from "@/lib/admin/economics-model";
import type { LiveEconomics, MarginAlertRow, PeriodEconomics } from "@/lib/admin/economics-live";
import { UNIT_COSTS_CHECKED_ON, UNIT_COST_SOURCES, USD_TO_GBP_MODEL } from "@/lib/billing/unit-costs";
import { gbp, percent, count } from "./format";
import { WorkspaceTable } from "./workspace-table";
import { PricingSimulator } from "./pricing-simulator";

/**
 * Admin → Economics. Platform-only: every figure is raw provider cost or
 * margin, which never appears on a customer surface.
 *
 * Cost is ACTUAL recorded usage priced with `unit-costs.ts`; a cost nothing
 * records says "not measured" instead of £0. Revenue is the local subscription
 * mirror and recorded top-ups -- Stripe is never called from this page.
 */
export function EconomicsView({
  data,
  periodKey,
  alerts,
}: {
  data: LiveEconomics;
  periodKey: "mtd" | "last";
  alerts: MarginAlertRow[];
}) {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-content">Economics</h1>
          <p className="mt-0.5 max-w-2xl text-[13px] text-content-muted">
            Revenue, actual cost and gross margin per workspace, against the owner&apos;s rule: at least{" "}
            {percent(MIN_GROSS_MARGIN, 0)} gross margin.
          </p>
        </div>
        <nav aria-label="Period" className="flex gap-1 rounded-lg border border-line bg-surface p-1 shadow-xs">
          {(
            [
              ["mtd", "Month to date"],
              ["last", "Last full month"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={key === "mtd" ? "/admin/economics" : "/admin/economics?period=last"}
              aria-current={periodKey === key ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                periodKey === key
                  ? "bg-accent-50 text-content-accent"
                  : "text-content-muted hover:bg-surface-hover hover:text-content",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>

      {data.state === "unavailable" ? (
        <section className="rounded-xl border border-line bg-surface shadow-xs">
          <EmptyState
            icon={AlertTriangle}
            title="Economics data is unavailable"
            description={data.reason}
          />
        </section>
      ) : (
        <Ready economics={periodKey === "mtd" ? data.mtd : data.last} alerts={alerts} />
      )}

      <Panel
        icon={Calculator}
        title="Pricing simulator"
        description="Edit a plan's price and allowances to see its margin at max and typical usage. Read-only: it never changes a plan."
      >
        <PricingSimulator />
      </Panel>

      <DataSources />
    </div>
  );
}

function Ready({ economics, alerts }: { economics: PeriodEconomics; alerts: MarginAlertRow[] }) {
  const { totals, period, rows } = economics;
  const marginBelow = totals.margin !== null && totals.margin < MIN_GROSS_MARGIN;

  return (
    <>
      <p className="text-[12px] text-content-subtle">
        {period.label} · data to{" "}
        {new Intl.DateTimeFormat("en-GB", {
          dateStyle: "medium",
          timeStyle: period.open ? "short" : undefined,
          timeZone: "UTC",
        }).format(period.open ? new Date(period.asOf) : new Date(new Date(period.end).getTime() - 1))}{" "}
        UTC
        {period.open &&
          " · subscription revenue, Stripe fees and allocations are the whole month; usage is to date"}
      </p>

      {alerts.length > 0 && (
        <Panel
          icon={AlertTriangle}
          tone="danger"
          title="Open margin alerts"
          description="Raised by the daily check, once per workspace per month, when month-to-date or projected month-end margin is below 75%."
        >
          <ul className="divide-y divide-line-subtle border-t border-line-subtle">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-content">{alert.title}</p>
                  {alert.detail && <p className="mt-0.5 text-[12px] text-content-muted">{alert.detail}</p>}
                  {alert.businessId && (
                    <Link
                      href={`/admin/customers?customer=${alert.businessId}`}
                      className="mt-0.5 inline-block text-[11.5px] text-content-accent underline-offset-4 hover:underline"
                    >
                      {alert.businessName ?? "Open workspace"}
                    </Link>
                  )}
                </div>
                <Badge tone={alert.severity === "CRITICAL" ? "danger" : "warning"} dense>
                  {alert.severity === "CRITICAL" ? "Critical" : "Warning"}
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {rows.length === 0 ? (
        <section className="rounded-xl border border-line bg-surface shadow-xs">
          <EmptyState
            icon={Wallet}
            title="Nothing to report for this period"
            description="No workspace was billed, started a trial or used a metered service in this period."
          />
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon={Wallet} tone="accent" label="Platform revenue" value={gbp(totals.revenue, 2)}
              hint={totals.revenueNotRecorded > 0 ? `${totals.revenueNotRecorded} contract price${totals.revenueNotRecorded === 1 ? "" : "s"} not recorded` : "Subscriptions + top-ups"} />
            <Kpi icon={Coins} tone="neutral" label="Cost" value={gbp(totals.cost, 2)}
              hint={`Usage ${gbp(totals.variableCost, 2)} + fees & allocations`} />
            <Kpi icon={Gauge} tone={marginBelow ? "danger" : "success"} label="Gross margin" value={percent(totals.margin)}
              hint={totals.margin === null ? "No revenue yet" : marginBelow ? "Below the 75% rule" : "At or above 75%"} />
            <Kpi icon={AlertTriangle} tone={totals.belowFloor > 0 ? "danger" : "neutral"} label="Workspaces below 75%"
              value={`${totals.belowFloor} / ${totals.workspaces}`} hint="Month to date or closed month" />
            <Kpi icon={Users} tone="info" label="Cost per trial" value={gbp(totals.costPerTrial)}
              hint={totals.trialsStarted === 0 ? "No trial started this period" : `${totals.trialsStarted} trial${totals.trialsStarted === 1 ? "" : "s"} started · usage cost`} />
            <Kpi icon={Users} tone="info" label="Cost per lead" value={gbp(totals.costPerLead)}
              hint={totals.leads === 0 ? "No leads this period" : `${count(totals.leads)} leads · usage cost`} />
            <Kpi icon={Users} tone="info" label="Cost per qualified lead" value={gbp(totals.costPerQualifiedLead)}
              hint={totals.qualifiedLeads === 0 ? "No qualified leads this period" : `${count(totals.qualifiedLeads)} qualified`} />
            <Kpi icon={Coins} tone="neutral" label="Gross profit" value={gbp(totals.grossProfit, 2)}
              hint="Workspaces with recorded revenue" />
          </div>

          <Panel icon={PieChart} title="Cost by driver" description="Where the cost comes from, across every workspace in the period.">
            <ul className="space-y-2.5 border-t border-line-subtle px-4 py-4 sm:px-5">
              {totals.drivers.map((driver) => {
                const meta = COST_LINES[driver.key];
                const allUnmeasured = driver.notMeasuredIn > 0 && driver.notMeasuredIn === totals.workspaces;
                return (
                  <li key={driver.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[180px_minmax(0,1fr)_120px]">
                    <span className="truncate text-[12.5px] text-content-secondary">
                      {meta.label}
                      {meta.kind === "allocation" && (
                        <span className="ml-1 text-[10.5px] uppercase tracking-wide text-content-subtle">allocation</span>
                      )}
                    </span>
                    <span className="order-3 col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken sm:order-none sm:col-span-1">
                      <span
                        className="block h-full rounded-full bg-accent-500"
                        style={{ width: `${Math.max(0, Math.min(100, driver.share * 100))}%` }}
                      />
                    </span>
                    <span className="text-right text-[12.5px] tabular-nums text-content">
                      {allUnmeasured ? (
                        <span className="text-warning-700">not measured</span>
                      ) : (
                        <>
                          {gbp(driver.value, 2)}
                          <span className="ml-1.5 text-[11px] text-content-subtle">{percent(driver.share, 0)}</span>
                        </>
                      )}
                    </span>
                    {driver.notMeasuredIn > 0 && !allUnmeasured && (
                      <span className="order-4 col-span-2 text-[11px] text-warning-700 sm:col-span-3">
                        Not measured in {driver.notMeasuredIn} workspace{driver.notMeasuredIn === 1 ? "" : "s"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel
            icon={Wallet}
            title="Workspaces"
            description="Worst margin first. Open a row for its cost lines. Red rows are below 75%."
          >
            <WorkspaceTable rows={rows} open={period.open} />
          </Panel>
        </>
      )}
    </>
  );
}

function Kpi({
  icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: TileTone;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs">
      <div className="flex items-center gap-2">
        <IconTile icon={icon} tone={tone} className="size-7" />
        <span className="truncate text-[12px] text-content-muted">{label}</span>
      </div>
      <p className="mt-2 text-[20px] font-semibold leading-none tabular-nums text-content">{value}</p>
      <p className="mt-1.5 truncate text-[11.5px] text-content-subtle" title={hint}>
        {hint}
      </p>
    </div>
  );
}

/** (d) Data honesty: where every number comes from, and how old the prices are. */
function DataSources() {
  return (
    <Panel
      icon={FileSearch}
      title="Data sources and unit costs"
      description={`Unit costs from src/lib/billing/unit-costs.ts, every price checked ${UNIT_COSTS_CHECKED_ON}. USD at £${USD_TO_GBP_MODEL} per $1.`}
    >
      <div className="grid gap-5 border-t border-line-subtle px-4 py-4 sm:px-5 xl:grid-cols-2">
        <div className="min-w-0">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-content-muted">Cost lines</h3>
          <dl className="mt-2 space-y-2">
            {COST_LINE_ORDER.map((key) => (
              <div key={key} className="text-[12px]">
                <dt className="font-medium text-content">
                  {COST_LINES[key].label}
                  {COST_LINES[key].kind === "allocation" && (
                    <Badge tone="neutral" dense className="ml-1.5">
                      Allocation
                    </Badge>
                  )}
                </dt>
                <dd className="text-content-muted">{COST_LINES[key].source}</dd>
              </div>
            ))}
            <div className="text-[12px]">
              <dt className="font-medium text-content">Revenue</dt>
              <dd className="text-content-muted">
                Subscription list price for the mirrored plan and interval (annual ÷ 12), plus PAID top-ups recorded
                in the period. No invoice amounts are stored locally, and Stripe is not called.
              </dd>
            </div>
          </dl>
        </div>
        <div className="min-w-0">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-content-muted">Unit costs</h3>
          {UNIT_COST_SOURCES.length === 0 ? (
            <PanelEmpty>No unit costs are defined.</PanelEmpty>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-content-muted">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Item</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">GBP</th>
                    <th scope="col" className="py-1.5 pl-3 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {UNIT_COST_SOURCES.map((item) => (
                    <tr key={item.key}>
                      <td className="py-1.5 pr-3 text-content">{item.label}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-content">
                        {item.key === "stripe" ? percent(item.gbp) : gbp(item.gbp, item.gbp < 0.01 ? 5 : item.gbp < 1 ? 4 : 2)}
                        <span className="block text-[10.5px] text-content-subtle">per {item.unit}</span>
                      </td>
                      <td className="py-1.5 pl-3 text-content-muted">{item.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <WhatsappPricingTable />
      </div>
    </Panel>
  );
}

/**
 * WhatsApp token pricing per category and pack: price, all-in cost and margin
 * after Stripe, from the same constants the send meter charges
 * (economics-model `whatsappPricing`). WhatsApp is the one purchase below the
 * 75% rule, with a floor of cost + 25%.
 */
function WhatsappPricingTable() {
  const rows = whatsappPricing();
  return (
    <div className="min-w-0 xl:col-span-2">
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-content-muted">
        WhatsApp tokens: price and margin per message
      </h3>
      <p className="mt-1 text-[12px] text-content-muted">
        Priced to compete with WhatsApp specialists (economics.md §5.4). Floor: what is kept after Stripe is at least
        cost × 1.25. Cost is the Twilio route (Meta + Twilio both ways + half an inbound); a workspace on its own Meta
        Cloud API number costs less.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-content-muted">
              <th scope="col" className="py-1.5 pr-3 font-medium">Pack</th>
              <th scope="col" className="px-3 py-1.5 font-medium">Category</th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">Tokens</th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">Price</th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">Cost</th>
              <th scope="col" className="px-3 py-1.5 text-right font-medium">Margin</th>
              <th scope="col" className="py-1.5 pl-3 font-medium">Floor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((row) => (
              <tr key={`${row.pack.tokens}-${row.category}`}>
                <td className="py-1.5 pr-3 text-content">
                  {count(row.pack.tokens)} for {gbp(row.pack.priceGbp, 0)}
                </td>
                <td className="px-3 py-1.5 text-content">{row.category.toLowerCase()}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{row.tokens}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{gbp(row.priceGbp, 4)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{gbp(row.costGbp, 4)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{percent(row.margin)}</td>
                <td className="py-1.5 pl-3">
                  <Badge tone={row.aboveFloor ? "success" : "danger"} dense>
                    {row.aboveFloor ? `×${row.markupOnCost.toFixed(2)}` : "Below floor"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
