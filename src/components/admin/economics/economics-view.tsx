import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Coins, Percent, Server, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelEmpty } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { formatMoney, formatMoneyPrecise, formatNumber, titleise } from "@/lib/admin/format";
import {
  MARGIN_BANDS,
  marginTone,
  type EconomicsData,
} from "@/lib/admin/economics";

/**
 * Admin → Usage & Margins (V4 §46).
 *
 * Ordered worst-margin-first throughout: this page exists to find the tenants
 * costing more than they pay, not to celebrate the healthy ones. Everything
 * here is raw provider cost and is platform-only (§90).
 */
export function EconomicsView({ data }: { data: EconomicsData }) {
  const { totals, bandCounts } = data;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Revenue" value={formatMoney(totals.revenue)} icon={Wallet} />
        <Kpi label="Cost of goods" value={formatMoney(totals.cogs)} icon={Coins} />
        <Kpi
          label="Contribution"
          value={formatMoney(totals.contribution)}
          icon={Coins}
          tone={totals.contribution < 0 ? "danger" : undefined}
        />
        <Kpi
          label="Margin"
          value={totals.marginPercent === null ? "—" : `${totals.marginPercent.toFixed(1)}%`}
          icon={Percent}
          tone={
            totals.marginPercent !== null && totals.marginPercent < 55 ? "danger" : undefined
          }
        />
      </div>

      {data.awaitingRollup && (
        <p className="rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-[12.5px] text-info-700">
          Provider cost has been recorded for this period but the monthly margin snapshot has
          not run yet — it executes on the first of the month. Per-provider spend below is
          live from the ledger.
        </p>
      )}

      {/* --------------------------------------------------------- alerts */}
      {data.alerts.length > 0 && (
        <Panel
          icon={AlertTriangle}
          tone="danger"
          title="Open economics alerts"
          description="Anomalies and threshold breaches waiting on an operator."
        >
          <ul className="divide-y divide-line-subtle">
            {data.alerts.map((alert) => (
              <li key={alert.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-content">{alert.title}</p>
                    {alert.detail && (
                      <p className="mt-0.5 text-[12px] text-content-muted">{alert.detail}</p>
                    )}
                    {alert.businessName && (
                      <Link
                        href={`/admin/customers?business=${alert.businessId}`}
                        className="mt-0.5 inline-block text-[11.5px] text-content-accent underline-offset-4 hover:underline"
                      >
                        {alert.businessName}
                      </Link>
                    )}
                  </div>
                  <Badge
                    tone={alert.severity === "CRITICAL" ? "danger" : "warning"}
                    dense
                  >
                    {titleise(alert.alertType)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ---------------------------------------------------------- bands */}
      <Panel
        icon={Percent}
        title="Margin distribution"
        description="Contribution margin bands from the platform guardrails."
      >
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-4 sm:px-5">
          {MARGIN_BANDS.map((band) => (
            <div key={band.state} className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-[20px] font-semibold tabular-nums",
                    band.state === "CRITICAL" && bandCounts[band.state] > 0
                      ? "text-danger-600"
                      : "text-content",
                  )}
                >
                  {bandCounts[band.state]}
                </span>
                <Badge tone={marginTone(band.state)} dense>
                  {titleise(band.state)}
                </Badge>
              </div>
              <p className="mt-1 text-[11.5px] text-content-muted">{band.label}</p>
            </div>
          ))}
        </div>
      </Panel>

      {/* ------------------------------------------------------ customers */}
      <Panel
        icon={Wallet}
        title="Customer economics"
        description="Worst margin first. Contribution is revenue minus every tracked and allocated cost."
      >
        {data.customers.length === 0 ? (
          <PanelEmpty>
            No margin snapshots for this period yet. They are written by the monthly rollup.
          </PanelEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-content-muted">
                  <th className="px-4 py-2 font-medium sm:px-5">Workspace</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">COGS</th>
                  <th className="px-3 py-2 text-right font-medium">Contribution</th>
                  <th className="px-3 py-2 text-right font-medium">Margin</th>
                  <th className="px-4 py-2 font-medium sm:px-5">Biggest cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {data.customers.map((customer) => {
                  const biggest = largestCost(customer.breakdown);
                  return (
                    <tr key={customer.businessId}>
                      <td className="px-4 py-2.5 sm:px-5">
                        <Link
                          href={`/admin/customers?business=${customer.businessId}`}
                          className="text-[13px] font-medium text-content hover:text-content-accent"
                        >
                          {customer.businessName}
                        </Link>
                        {customer.planKey && (
                          <span className="ml-2 text-[11px] text-content-subtle">
                            {customer.planKey}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums text-content-secondary">
                        {formatMoney(customer.totalRevenue)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums text-content-secondary">
                        {formatMoney(customer.totalCogs)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right text-[12.5px] tabular-nums",
                          customer.contribution < 0 ? "text-danger-600" : "text-content",
                        )}
                      >
                        {formatMoney(customer.contribution)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Badge tone={marginTone(customer.marginState)} dense>
                          {customer.marginPercent === null
                            ? "—"
                            : `${customer.marginPercent.toFixed(1)}%`}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-content-muted sm:px-5">
                        {biggest ? `${biggest.label} · ${formatMoneyPrecise(biggest.value)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ------------------------------------------------------ providers */}
      <Panel
        icon={Server}
        title="Provider spend"
        description="Live from the cost ledger for this period, independent of the monthly rollup."
      >
        {data.providers.length === 0 ? (
          <PanelEmpty>No provider cost recorded in this period.</PanelEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-content-muted">
                  <th className="px-4 py-2 font-medium sm:px-5">Provider</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Calls</th>
                  <th className="px-3 py-2 text-right font-medium">Workspaces</th>
                  <th className="px-4 py-2 text-right font-medium sm:px-5">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {data.providers.map((provider) => (
                  <tr key={`${provider.provider}-${provider.category}`}>
                    <td className="px-4 py-2.5 text-[13px] text-content sm:px-5">
                      {provider.provider}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone="neutral" dense>
                        {provider.category ? titleise(provider.category) : "Uncategorised"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums text-content-secondary">
                      {formatNumber(provider.events)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12.5px] tabular-nums text-content-secondary">
                      {formatNumber(provider.businesses)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[12.5px] tabular-nums text-content sm:px-5">
                      {formatMoneyPrecise(provider.totalCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

const COST_LABELS: Record<string, string> = {
  ai: "AI",
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
  discovery: "Discovery",
  enrichment: "Enrichment",
  verification: "Verification",
  intent: "Intent",
  stripe: "Stripe",
  infrastructure: "Infrastructure",
};

function largestCost(
  breakdown: Record<string, number>,
): { label: string; value: number } | null {
  const entries = Object.entries(breakdown).filter(([, value]) => value > 0);
  if (entries.length === 0) return null;
  const [key, value] = entries.reduce((max, entry) => (entry[1] > max[1] ? entry : max));
  return { label: COST_LABELS[key] ?? titleise(key), value };
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "danger";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] text-content-muted">{label}</span>
        <Icon className="size-4 shrink-0 text-content-subtle" aria-hidden />
      </div>
      <p
        className={cn(
          "mt-1.5 text-[22px] font-semibold leading-none tabular-nums",
          tone === "danger" ? "text-danger-600" : "text-content",
        )}
      >
        {value}
      </p>
    </div>
  );
}
