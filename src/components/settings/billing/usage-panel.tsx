"use client";

import * as React from "react";
import {
  BarChart3,
  Gauge,
  Mail,
  MessageCircle,
  MessageSquare,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Switch } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { cn } from "@/lib/cn";
import { formatMetric } from "@/lib/analytics/v4-metrics";
import {
  saveAllocation,
  saveDailyCaps,
  saveOverage,
} from "@/lib/billing/usage-actions";
import {
  ALLOCATION_CHANNELS,
  CHANNEL_LABEL,
  allocationTotal,
  estimateSends,
  rebalance,
  validateAllocation,
  type Allocation,
  type AllocationChannel,
} from "@/lib/billing/usage-allocation";
import type { UsageOverview } from "@/lib/billing/usage-service";

const CHANNEL_ICON: Record<
  AllocationChannel,
  React.ComponentType<{ className?: string }>
> = {
  email: Mail,
  sms: MessageSquare,
  whatsapp: MessageCircle,
};

const SLIDER_TONE: Record<AllocationChannel, string> = {
  email: "accent-success-600",
  sms: "accent-info-600",
  whatsapp: "accent-purple-600",
};

/**
 * Billing & Usage: allocation, caps, overage and history (V4 §27).
 *
 * Two things this panel is careful about.
 *
 * **It shows sends, never prices.** The provider price book is
 * platform-confidential; what a customer needs is how far their allowance goes,
 * which is what the estimates express — and they are labelled as estimates,
 * because segmentation and retries mean the ledger is the authority.
 *
 * **Overage is never a quiet toggle.** It is the one control here that can
 * increase a bill, so switching it on requires a confirmation that states the
 * effect, and the cap is re-validated against the account ceiling server-side.
 */
export function UsagePanel({
  usage,
  canManage,
}: {
  usage: UsageOverview;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [allocation, setAllocation] = React.useState<Allocation>(usage.allocation);
  const [caps, setCaps] = React.useState(usage.dailyCaps);
  const [overageOpen, setOverageOpen] = React.useState(false);
  const [overageCap, setOverageCap] = React.useState(
    usage.overageCapMinor > 0 ? String(usage.overageCapMinor / 100) : "",
  );
  const [pending, setPending] = React.useState<string | null>(null);

  const total = allocationTotal(allocation);
  const issues = validateAllocation(allocation);
  const estimates = estimateSends(allocation, usage.monthlyAllowance);

  const allocationDirty =
    JSON.stringify(allocation) !== JSON.stringify(usage.allocation);
  const capsDirty = JSON.stringify(caps) !== JSON.stringify(usage.dailyCaps);

  async function run(key: string, work: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(key);
    try {
      const result = await work();
      toast(
        result.ok
          ? { variant: "success", title: "Saved" }
          : { variant: "error", title: result.error ?? "That change could not be saved." },
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ monthly overview */}
      <Card>
        <CardHeader className="border-b-0 px-5 pt-5 pb-0">
          <SectionHeader
            icon={Gauge}
            tone="info"
            title="Monthly usage overview"
            description="Your current usage across all features this billing period."
          />
        </CardHeader>
        <CardContent className="px-5 pt-4 pb-5">
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <LimitTile label="Prospects sourced" limit={usage.limits.sourcing} />
            <LimitTile label="Messages sent" limit={usage.limits.communication} />
            <LimitTile label="Intent monitors" limit={usage.limits.intentMonitors} />
            <LimitTile label="Search runs" limit={usage.limits.searchRuns} />
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* --------------------------------------------- allocation */}
        <Card className="min-w-0">
          <CardHeader className="items-center border-b-0 px-5 pt-5 pb-0">
            <SectionHeader
              icon={BarChart3}
              tone="accent"
              title="Communication allocation"
              description="Allocate your monthly message allowance between channels."
            />
            <div className="flex shrink-0 items-center gap-3">
              <div className="text-right">
                <p className="text-[11.5px] text-content-muted">Total allowance</p>
                <p className="lr-tabular text-[13px] font-semibold text-content">
                  {usage.monthlyAllowance.toLocaleString("en-GB")} messages
                </p>
              </div>
              {canManage && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setAllocation(usage.allocation)}
                  disabled={!allocationDirty}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Reset
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4 px-5 pt-4 pb-5">
            <ul className="space-y-3.5">
              {ALLOCATION_CHANNELS.map((channel) => {
                const Icon = CHANNEL_ICON[channel];
                const estimate = estimates.find((row) => row.channel === channel);

                return (
                  <li key={channel} className="flex flex-wrap items-center gap-3">
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-line bg-surface-sunken text-content-secondary"
                    >
                      <Icon className="size-4" />
                    </span>
                    <label
                      htmlFor={`allocation-${channel}`}
                      className="w-[4.5rem] shrink-0 text-[13px] font-medium text-content"
                    >
                      {CHANNEL_LABEL[channel]}
                    </label>

                    <input
                      id={`allocation-${channel}`}
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={allocation[channel]}
                      disabled={!canManage}
                      aria-valuetext={`${allocation[channel]} percent, about ${estimate?.estimatedSends.toLocaleString("en-GB") ?? 0} sends`}
                      onChange={(event) =>
                        setAllocation((current) =>
                          rebalance(current, channel, Number(event.target.value)),
                        )
                      }
                      className={cn(
                        "h-2 min-w-[8rem] flex-1 cursor-pointer rounded-full",
                        SLIDER_TONE[channel],
                        "disabled:cursor-not-allowed disabled:opacity-60",
                      )}
                    />

                    <span className="flex shrink-0 items-center gap-1">
                      <Input
                        aria-label={`${CHANNEL_LABEL[channel]} percentage`}
                        type="number"
                        min={0}
                        max={100}
                        value={allocation[channel]}
                        disabled={!canManage}
                        onChange={(event) =>
                          setAllocation((current) =>
                            rebalance(current, channel, Number(event.target.value)),
                          )
                        }
                        className="h-8 w-16 text-[12.5px]"
                      />
                      <span className="text-[12.5px] text-content-muted">%</span>
                    </span>

                    <span className="w-[7.5rem] shrink-0 text-right">
                      <span className="lr-tabular block text-[13px] font-semibold text-content">
                        {estimate?.estimatedSends.toLocaleString("en-GB") ?? "—"}
                      </span>
                      <span className="block text-[11px] text-content-muted">
                        estimated sends
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>

            <div
              role="status"
              className={cn(
                "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5",
                total === 100
                  ? "border-line bg-surface-sunken/50"
                  : "border-warning-100 bg-warning-50",
              )}
            >
              <p className="text-[12.5px] text-content-secondary">
                {total === 100
                  ? "These are estimates. Actual usage is tracked by ClientTurn and is authoritative."
                  : `Allocation totals ${total}%. It must total exactly 100%.`}
              </p>
              {canManage && (
                <Button
                  size="sm"
                  loading={pending === "allocation"}
                  disabled={!allocationDirty || issues.length > 0}
                  onClick={() => run("allocation", () => saveAllocation(allocation))}
                >
                  Save allocation
                </Button>
              )}
            </div>

            {/* ------------------------------------------- daily caps */}
            <div className="rounded-lg border border-line p-3.5">
              <p className="text-[13px] font-semibold text-content">
                Daily sending limits (all channels)
              </p>
              <p className="mt-0.5 text-[12px] text-content-muted">
                You can lower a limit. Raising one beyond your plan, platform and
                sender-health ceiling is not possible.
              </p>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {ALLOCATION_CHANNELS.map((channel) => {
                  const ceiling = usage.effectiveCaps[channel];
                  const requested = caps[channel];
                  return (
                    <div key={channel}>
                      <label
                        htmlFor={`cap-${channel}`}
                        className="block text-[12px] font-medium text-content"
                      >
                        {CHANNEL_LABEL[channel]}
                      </label>
                      <Input
                        id={`cap-${channel}`}
                        type="number"
                        min={0}
                        value={requested}
                        disabled={!canManage}
                        onChange={(event) =>
                          setCaps((current) => ({
                            ...current,
                            [channel]: Number(event.target.value) || 0,
                          }))
                        }
                        className="mt-1 h-9 text-[12.5px]"
                      />
                      <p className="mt-1 text-[11px] text-content-muted">
                        {requested > ceiling
                          ? `Capped at ${ceiling.toLocaleString("en-GB")} per day.`
                          : `Up to ${ceiling.toLocaleString("en-GB")} per day.`}
                      </p>
                    </div>
                  );
                })}
              </div>

              {canManage && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  loading={pending === "caps"}
                  disabled={!capsDirty}
                  onClick={() => run("caps", () => saveDailyCaps(caps))}
                >
                  Save daily limits
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ----------------------------------------------- overage + channels */}
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="items-center border-b-0 px-5 pt-5 pb-0">
              <SectionHeader
                title="Overage control"
                description="Allow automatic overage when you reach your limits."
                dense
              />
              <Switch
                checked={usage.overageEnabled}
                disabled={!canManage}
                tone="success"
                size="lg"
                label="Allow automatic overage"
                onCheckedChange={(next) => {
                  if (next) setOverageOpen(true);
                  else
                    void run("overage", () =>
                      saveOverage({ enabled: false, capMinor: 0, confirmed: true }),
                    );
                }}
              />
            </CardHeader>

            <CardContent className="space-y-3 px-5 pt-3.5 pb-5">
              <div
                className={cn(
                  "flex gap-2.5 rounded-lg border px-3 py-2.5",
                  usage.overageEnabled
                    ? "border-info-100 bg-info-50/70"
                    : "border-warning-100 bg-warning-50/70",
                )}
              >
                <TriangleAlert
                  aria-hidden
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    usage.overageEnabled ? "text-info-600" : "text-warning-600",
                  )}
                />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-content">
                    {usage.overageEnabled ? "Overage is on" : "Overage is off"}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-[1.45] text-content-muted">
                    {usage.overageEnabled
                      ? `Up to £${(usage.overageCapMinor / 100).toLocaleString("en-GB")} of additional spend may be charged this month.`
                      : "You will be notified when you reach 90% of any allowance. No additional charges will be made."}
                  </p>
                </div>
              </div>

              <div>
                <label
                  htmlFor="overage-cap"
                  className="block text-[12.5px] font-medium text-content"
                >
                  Monthly additional spend cap
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[13px] text-content-muted">£</span>
                  <Input
                    id="overage-cap"
                    type="number"
                    min={0}
                    max={usage.accountMaxOverageMinor / 100}
                    value={overageCap}
                    disabled={!canManage || !usage.overageEnabled}
                    placeholder="500"
                    onChange={(event) => setOverageCap(event.target.value)}
                    className="h-9 text-[12.5px]"
                  />
                </div>
                <p className="mt-1 text-[11.5px] text-content-muted">
                  {usage.accountMaxOverageMinor > 0
                    ? `Maximum additional spend per month when overage is enabled: £${(usage.accountMaxOverageMinor / 100).toLocaleString("en-GB")}.`
                    : "Overage is not available on your current plan."}
                </p>
              </div>

              {canManage && usage.overageEnabled && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending === "cap"}
                  onClick={() =>
                    run("cap", () =>
                      saveOverage({
                        enabled: true,
                        capMinor: Math.round(Number(overageCap || 0) * 100),
                        confirmed: true,
                      }),
                    )
                  }
                >
                  Save spend cap
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b-0 px-5 pt-5 pb-0">
              <SectionHeader
                title="Channel usage"
                description="Breakdown of messages sent this month."
                dense
              />
            </CardHeader>
            <CardContent className="px-5 pt-3 pb-5">
              <table className="w-full text-left text-[12.5px]">
                <caption className="sr-only">
                  Messages sent, delivery rate and reply rate by channel.
                </caption>
                <thead>
                  <tr className="border-b border-line-subtle text-[11.5px] text-content-muted">
                    <th scope="col" className="pb-1.5 font-medium">Channel</th>
                    <th scope="col" className="pb-1.5 text-right font-medium">Sent</th>
                    <th scope="col" className="pb-1.5 text-right font-medium">Delivery</th>
                    <th scope="col" className="pb-1.5 text-right font-medium">Replies</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {usage.channels.map((row) => (
                    <tr key={row.channel}>
                      <th scope="row" className="py-2 text-left font-normal text-content">
                        {CHANNEL_LABEL[row.channel]}
                      </th>
                      <td className="lr-tabular py-2 text-right text-content-secondary">
                        {row.sent.toLocaleString("en-GB")}
                      </td>
                      <td className="lr-tabular py-2 text-right text-content-secondary">
                        {formatMetric(row.deliveryRate, "percent")}
                      </td>
                      <td className="lr-tabular py-2 text-right text-content-secondary">
                        {formatMetric(row.repliesPerDelivered, "percent")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ---------------------------------------------------------- history */}
      <Card>
        <CardHeader className="border-b-0 px-5 pt-5 pb-0">
          <SectionHeader
            title="Usage history"
            description="Your monthly usage and spending history."
            dense
          />
        </CardHeader>
        <CardContent className="px-5 pt-3 pb-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-left text-[13px]">
              <caption className="sr-only">
                Prospects sourced, messages sent, search runs and spend by month.
              </caption>
              <thead>
                <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-content-muted">
                  <th scope="col" className="pb-2 font-medium">Month</th>
                  <th scope="col" className="pb-2 text-right font-medium">Prospects</th>
                  <th scope="col" className="pb-2 text-right font-medium">Messages</th>
                  <th scope="col" className="pb-2 text-right font-medium">Search runs</th>
                  <th scope="col" className="pb-2 text-right font-medium">Total spend</th>
                  <th scope="col" className="pb-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {usage.history.map((month) => (
                  <tr key={month.period}>
                    <th scope="row" className="py-2 text-left font-normal text-content">
                      {month.label}
                    </th>
                    <td className="lr-tabular py-2 text-right text-content-secondary">
                      {month.prospectsSourced.toLocaleString("en-GB")}
                    </td>
                    <td className="lr-tabular py-2 text-right text-content-secondary">
                      {month.messagesSent.toLocaleString("en-GB")}
                    </td>
                    <td className="lr-tabular py-2 text-right text-content-secondary">
                      {month.searchRuns.toLocaleString("en-GB")}
                    </td>
                    <td className="lr-tabular py-2 text-right text-content-secondary">
                      £{month.totalSpend.toFixed(2)}
                    </td>
                    <td className="py-2 text-right">
                      <Badge tone={month.current ? "info" : "neutral"} dense>
                        {month.current ? "Current" : "Completed"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={overageOpen}
        onClose={() => setOverageOpen(false)}
        loading={pending === "overage"}
        variant="warning"
        title="Turn on automatic overage?"
        scope={`Up to £${Number(overageCap || 0).toLocaleString("en-GB")} of additional spend per month`}
        consequence="When an allowance runs out, ClientTurn will keep working and charge for the extra usage, up to the cap you set. Sending stops at the cap. You can switch this off at any time."
        confirmLabel="Enable overage"
        onConfirm={async () => {
          await run("overage", () =>
            saveOverage({
              enabled: true,
              capMinor: Math.round(Number(overageCap || 0) * 100),
              confirmed: true,
            }),
          );
          setOverageOpen(false);
        }}
      />
    </div>
  );
}

/** Used / limit with a bar. A zero limit reads as "not included", not 0%. */
function LimitTile({
  label,
  limit,
}: {
  label: string;
  limit: { used: number; limit: number };
}) {
  const share = limit.limit > 0 ? Math.min(1, limit.used / limit.limit) : null;

  return (
    <div className="rounded-lg border border-line bg-surface-sunken/40 px-3.5 py-3">
      <dt className="text-[12.5px] text-content-muted">{label}</dt>
      <dd>
        <p className="lr-tabular mt-1 text-[22px] font-semibold leading-none text-content">
          {limit.used.toLocaleString("en-GB")}
        </p>
        <p className="mt-1 text-[11.5px] text-content-muted">
          {limit.limit > 0
            ? `of ${limit.limit.toLocaleString("en-GB")}`
            : "Not included on your plan"}
        </p>
        {share !== null && (
          <div className="mt-2 flex items-center gap-2">
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <span
                className={cn(
                  "block h-full rounded-full",
                  share >= 0.9
                    ? "bg-danger-500"
                    : share >= 0.75
                      ? "bg-warning-500"
                      : "bg-success-500",
                )}
                style={{ width: `${Math.max(2, share * 100)}%` }}
              />
            </span>
            <span className="lr-tabular shrink-0 text-[11.5px] text-content-muted">
              {Math.round(share * 100)}%
            </span>
          </div>
        )}
      </dd>
    </div>
  );
}
