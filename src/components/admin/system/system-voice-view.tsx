import * as React from "react";
import {
  AlertTriangle,
  Calculator,
  Coins,
  Hash,
  PhoneCall,
  ShieldAlert,
  Webhook,
} from "lucide-react";
import type { VoiceOps } from "@/lib/admin/voice-ops";
import { gmHealth, SUSPICION_LABEL, VOICE_GM_FLOOR } from "@/lib/admin/voice-ops-model";
import { Panel, PanelEmpty } from "@/components/admin/ui";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { gbp, percent } from "@/components/admin/economics/format";
import {
  GmTables,
  NumberSuspendControl,
  RetryVoiceJobButton,
  RetryVoiceWebhookButton,
  RunMarginCheckButton,
  VoiceGmSimulator,
  WorkspaceVoiceControls,
} from "./voice-ops-controls";

/**
 * Admin -> System -> Voice ops (brief §58-59). A server component over
 * getVoiceOps(); the only client parts are the confirmed emergency controls,
 * the GM dimension switch and the simulator.
 *
 * States: loading (system/loading.tsx), not installed (voice tables absent),
 * unavailable (a failed read), empty tables per panel, and "needs 0158" on
 * each control whose column is not there yet. Permission: the (ops) layout and
 * the page run requirePlatformAdmin; every control is also guarded server-side.
 */

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-xs">
      <p className="truncate text-[12px] text-content-muted">{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-[20px] font-semibold tabular-nums text-content",
          tone === "success" && "text-success-700",
          tone === "warning" && "text-warning-700",
          tone === "danger" && "text-danger-700",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[11.5px] text-content-subtle">{hint}</p>}
    </div>
  );
}

const minutes = (n: number) => `${n.toLocaleString("en-GB", { maximumFractionDigits: 1 })} min`;

export function SystemVoiceView({ ops }: { ops: VoiceOps }) {
  if (ops.state === "not_installed") {
    return (
      <Panel icon={PhoneCall} title="Voice operations">
        <EmptyState icon={PhoneCall} title="Voice is not set up on this database" description={ops.reason} />
      </Panel>
    );
  }
  if (ops.state === "unavailable") {
    return (
      <Panel icon={PhoneCall} title="Voice operations">
        <ErrorState title="Not available" description={ops.reason} />
      </Panel>
    );
  }

  const t = ops.totals;
  const health = gmHealth(t.gm);
  const flagged = ops.workspaces.filter((w) => w.suspicion.length > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Active calls" value={t.activeCalls.toLocaleString("en-GB")} hint={`${t.claimedInQueue} dialling from queue`} />
        <Kpi label="Queue depth" value={t.queueDepth.toLocaleString("en-GB")} hint="Waiting to dial" tone={t.queueDepth > 50 ? "warning" : undefined} />
        <Kpi label="Minutes today" value={minutes(t.minutesToday)} hint={`${minutes(t.minutesMonth)} this month`} />
        <Kpi label="Provider spend (month)" value={gbp(t.providerSpendMonthGbp)} hint="Cost ledger, estimates replaced by provider figures" />
        <Kpi label="Retail revenue (month)" value={gbp(t.retailRevenueMonthGbp)} hint="Minute packs and Pro voice item" />
        <Kpi
          label="Voice GM (month)"
          value={percent(t.gm)}
          hint={t.gm === null ? "No voice revenue this month" : `Floor ${percent(VOICE_GM_FLOOR, 0)}`}
          tone={health === "HEALTHY" ? "success" : health === "WATCH" ? "warning" : health === "BELOW_FLOOR" ? "danger" : undefined}
        />
        <Kpi label="Call failures today" value={t.callFailuresToday.toLocaleString("en-GB")} tone={t.callFailuresToday > 0 ? "warning" : undefined} />
        <Kpi label="Webhook failures (7 days)" value={t.webhookFailures7d.toLocaleString("en-GB")} tone={t.webhookFailures7d > 0 ? "danger" : undefined} />
        <Kpi label="Quotes sent (month)" value={t.quotesSentMonth === null ? "Not set up" : t.quotesSentMonth.toLocaleString("en-GB")} />
        <Kpi
          label="Payments recorded (month)"
          value={t.paymentsMonth === null ? "Not set up" : t.paymentsMonth.count.toLocaleString("en-GB")}
          hint={t.paymentsMonth ? `${gbp(t.paymentsMonth.amountGbp)} in GBP` : undefined}
        />
      </div>

      {!ops.controlsInstalled && (
        <p className="rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-[12.5px] text-warning-700">
          Pause outbound, number suspension and spending limits need migration 0158, which is not applied on this database yet. The workspace kill switch works now.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          icon={ShieldAlert}
          tone={flagged.length ? "warning" : "neutral"}
          title="Workspaces and emergency controls"
          description="Live calls, usage and spend per workspace. Suspicious usage is flagged against the 7-day baseline."
          className="xl:col-span-2"
        >
          {ops.workspaces.length === 0 ? (
            <PanelEmpty>No workspace has voice set up yet.</PanelEmpty>
          ) : (
            <div className="overflow-x-auto px-4 pb-4 sm:px-5">
              <table className="w-full min-w-[760px] text-left text-[12.5px]">
                <thead className="text-content-muted">
                  <tr>
                    <th className="py-2 pr-2 font-medium">Workspace</th>
                    <th className="px-1 py-2 text-right font-medium">Live / queued</th>
                    <th className="px-1 py-2 text-right font-medium">Today</th>
                    <th className="px-1 py-2 text-right font-medium">Month</th>
                    <th className="px-1 py-2 text-right font-medium">Spend</th>
                    <th className="px-1 py-2 font-medium">Flags</th>
                    <th className="py-2 pl-2 text-right font-medium">Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {ops.workspaces.map((w) => (
                    <tr key={w.businessId} className="align-top">
                      <td className="max-w-[180px] py-2 pr-2">
                        <p className="truncate font-medium text-content">{w.name}</p>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {w.killSwitch && <Badge dense tone="danger">Voice disabled</Badge>}
                          {w.outboundPaused && <Badge dense tone="warning">Outbound paused</Badge>}
                        </div>
                      </td>
                      <td className="px-1 py-2 text-right tabular-nums">
                        {w.liveCalls} / {w.queued}
                        {w.concurrencyLimit !== null && <span className="text-content-subtle"> (max {w.concurrencyLimit})</span>}
                      </td>
                      <td className="px-1 py-2 text-right tabular-nums">{minutes(w.minutesToday)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{minutes(w.minutesMonth)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{gbp(w.providerSpendMonthGbp)}</td>
                      <td className="px-1 py-2">
                        {w.suspicion.length === 0 ? (
                          <span className="text-content-subtle">None</span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {w.suspicion.map((flag, i) => (
                              <span key={flag} title={w.suspicionDetail[i] ?? SUSPICION_LABEL[flag]}>
                                <StatusBadge kind="voice_usage_flag" value={flag} dense />
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pl-2">
                        <WorkspaceVoiceControls
                          businessId={w.businessId}
                          name={w.name}
                          killSwitch={w.killSwitch}
                          outboundPaused={w.outboundPaused}
                          spendLimitGbp={w.spendLimitGbp}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel icon={AlertTriangle} tone={ops.openVoiceAlerts.length ? "danger" : "neutral"} title="Voice margin alerts" description={`Raised when a workspace's voice GM this month is below ${percent(VOICE_GM_FLOOR, 0)}.`} action={<RunMarginCheckButton />}>
          {ops.openVoiceAlerts.length === 0 ? (
            <PanelEmpty>No open voice margin alerts.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-line-subtle px-4 pb-3 sm:px-5">
              {ops.openVoiceAlerts.map((a) => (
                <li key={a.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-medium text-content">{a.title}</span>
                    <Badge dense tone={a.severity === "CRITICAL" ? "danger" : "warning"}>{a.severity === "CRITICAL" ? "Critical" : "Warning"}</Badge>
                  </div>
                  <p className="text-[11.5px] text-content-subtle">{formatDateTime(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel icon={Coins} title="Voice gross margin" description="Revenue, COGS, gross profit and GM over the last six months, by dimension.">
        <div className="px-4 pb-4 sm:px-5">
          <GmTables gm={ops.gm} />
        </div>
      </Panel>

      <Panel icon={Calculator} title="Price and provider simulator" description="What a price change or a provider change does to every voice package's margin.">
        <div className="px-4 pb-4 sm:px-5">
          <VoiceGmSimulator />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel icon={Hash} title="Numbers" description={ops.numberStates.map((s) => `${s.count} ${s.state.toLowerCase().replace(/_/g, " ")}`).join(" · ") || "No numbers yet."}>
          {ops.numbers.length === 0 ? (
            <PanelEmpty>No numbers provisioned.</PanelEmpty>
          ) : (
            <div className="overflow-x-auto px-4 pb-4 sm:px-5">
              <table className="w-full min-w-[520px] text-left text-[12.5px]">
                <thead className="text-content-muted">
                  <tr>
                    <th className="py-2 pr-2 font-medium">Workspace</th>
                    <th className="px-1 py-2 font-medium">Number</th>
                    <th className="px-1 py-2 font-medium">State</th>
                    <th className="py-2 pl-2 text-right font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {ops.numbers.map((n) => (
                    <tr key={n.id} className="align-top">
                      <td className="max-w-[160px] truncate py-2 pr-2 text-content">{n.businessName}</td>
                      <td className="px-1 py-2 tabular-nums text-content-muted">{n.e164Masked}</td>
                      <td className="px-1 py-2">
                        <div className="flex flex-wrap gap-1">
                          <StatusBadge kind="number_state_admin" value={n.state} dense />
                          {n.suspended && <Badge dense tone="danger">Suspended</Badge>}
                          {n.needsAttention && <Badge dense tone="warning">Needs attention</Badge>}
                        </div>
                        {n.lastError && <p className="mt-0.5 max-w-[240px] truncate text-[11px] text-danger-700">{n.lastError}</p>}
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <NumberSuspendControl numberId={n.id} businessId={n.businessId} suspended={n.suspended} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel icon={Webhook} tone={ops.failedWebhooks.length || ops.failedJobs.length ? "danger" : "neutral"} title="Failures to retry" description="Failed voice webhooks and voice jobs in the last 7 days, and provider errors.">
          <div className="space-y-3 px-4 pb-4 sm:px-5">
            {ops.failedWebhooks.length === 0 && ops.failedJobs.length === 0 ? (
              <p className="text-[12.5px] text-content-muted">No failed voice webhooks or jobs in the last 7 days.</p>
            ) : (
              <ul className="divide-y divide-line-subtle">
                {ops.failedWebhooks.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-content">
                        Webhook · {w.provider} · {w.eventType ?? "event"}
                      </p>
                      <p className="truncate text-[11.5px] text-content-subtle">{w.lastError ?? "No error recorded"} · {formatDateTime(w.receivedAt)}</p>
                    </div>
                    <RetryVoiceWebhookButton id={w.id} />
                  </li>
                ))}
                {ops.failedJobs.map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-content">Job · {j.type}</p>
                      <p className="truncate text-[11.5px] text-content-subtle">{j.lastError ?? "No error recorded"} · {formatDateTime(j.createdAt)}</p>
                    </div>
                    <RetryVoiceJobButton id={j.id} />
                  </li>
                ))}
              </ul>
            )}
            <div>
              <h3 className="text-[12.5px] font-semibold text-content">Provider errors (7 days)</h3>
              {ops.providerErrors.length === 0 ? (
                <p className="mt-1 text-[12.5px] text-content-muted">None recorded.</p>
              ) : (
                <ul className="mt-1 space-y-0.5 text-[12px]">
                  {ops.providerErrors.map((e) => (
                    <li key={e.reason} className="flex justify-between gap-2">
                      <span className="truncate text-content">{e.reason}</span>
                      <span className="tabular-nums text-content-muted">{e.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <Panel icon={ShieldAlert} title="Voice entitlement overrides" description="Per-workspace grants that override the plan's voice limits.">
        {ops.entitlementOverrides.length === 0 ? (
          <PanelEmpty>No voice entitlement overrides.</PanelEmpty>
        ) : (
          <div className="overflow-x-auto px-4 pb-4 sm:px-5">
            <table className="w-full min-w-[520px] text-left text-[12.5px]">
              <thead className="text-content-muted">
                <tr>
                  <th className="py-2 pr-2 font-medium">Workspace</th>
                  <th className="px-1 py-2 font-medium">Entitlement</th>
                  <th className="px-1 py-2 font-medium">Value</th>
                  <th className="px-1 py-2 font-medium">Reason</th>
                  <th className="px-1 py-2 font-medium">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {ops.entitlementOverrides.map((g) => (
                  <tr key={`${g.businessId}:${g.key}`}>
                    <td className="py-2 pr-2 text-content">{g.businessName}</td>
                    <td className="px-1 py-2 font-mono text-[11.5px]">{g.key}</td>
                    <td className="px-1 py-2 tabular-nums">{g.value}</td>
                    <td className="max-w-[220px] truncate px-1 py-2 text-content-muted">{g.reason}</td>
                    <td className="px-1 py-2 text-content-muted">{g.expiresAt ? formatDateTime(g.expiresAt) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-[11.5px] text-content-subtle">Generated {formatDateTime(ops.generatedAt)}. Numbers are masked; no transcript, phone number or email is shown here.</p>
    </div>
  );
}
