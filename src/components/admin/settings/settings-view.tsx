"use client";

import * as React from "react";
import {
  AlertTriangle,
  Bot,
  CircleDollarSign,
  Flag,
  Gauge,
  Power,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Switch } from "@/components/ui/form";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/feedback";
import { IconTile, Panel, PanelEmpty, ProviderMark, type TileTone } from "@/components/admin/ui";
import { useAdminParams } from "@/components/admin/use-admin-params";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { ProviderDrawer } from "./provider-drawer";
import {
  setAiKillSwitch,
  updateAgentSettings,
  updateAiSettings,
  updateFeatureFlag,
  updateOutreachSettings,
  updateProviderSettings,
} from "@/lib/admin/settings-actions";
import { formatDate, formatMoneyPrecise, formatNumber, formatRelative } from "@/lib/admin/format";
import {
  FLAG_STATUSES,
  FLAG_STATUS_LABEL,
  PROVIDER_HEALTH_LABEL,
  PROVIDER_HEALTH_TONE,
  PROVIDER_TYPE_LABEL,
  SETTINGS_VIEWS,
  SETTINGS_VIEW_LABEL,
  type PlatformSettingsData,
  type SettingsView,
} from "@/lib/admin/platform-settings-types";

export function SettingsView({
  data,
  search,
}: {
  data: PlatformSettingsData;
  search: string;
}) {
  const { setParams } = useAdminParams();
  const { run, pending, stepUpDialog } = useAdminAction();

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Platform settings view"
        className="flex gap-1 overflow-x-auto border-b border-line"
      >
        {SETTINGS_VIEWS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={data.view === option}
            onClick={() =>
              setParams({ view: option === "providers" ? null : option, q: null })
            }
            className={cn(
              "shrink-0 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors",
              data.view === option
                ? "border-accent-500 text-content-accent"
                : "border-transparent text-content-muted hover:text-content",
            )}
          >
            {SETTINGS_VIEW_LABEL[option]}
          </button>
        ))}
      </div>

      <SummaryStrip data={data} />

      {data.view === "providers" && (
        <ProvidersView data={data} search={search} />
      )}
      {data.view === "ai" && (
        <AiView
          data={data}
          pending={pending}
          onSaveAi={(input) =>
            void run("ai", () => updateAiSettings(input), "AI settings saved.")
          }
          onToggleAgent={(agent, enabled) =>
            void run(
              `agent:${agent}`,
              () => updateAgentSettings({ agent, enabled }),
              "Agent updated.",
            )
          }
          onKillSwitch={(enabled, reason) =>
            void run(
              "kill",
              () => setAiKillSwitch({ enabled, reason }),
              enabled ? "Kill switch engaged." : "Kill switch released.",
            )
          }
        />
      )}
      {data.view === "outreach" && (
        <OutreachView
          data={data}
          pending={pending}
          onSave={(input) =>
            void run(
              "outreach",
              () => updateOutreachSettings(input),
              "Outreach settings saved.",
            )
          }
        />
      )}
      {data.view === "compliance" && <ComplianceSummaryView />}
      {data.view === "price-book" && <PriceBookView data={data} />}
      {data.view === "flags" && (
        <FlagsView
          data={data}
          pending={pending}
          onSave={(key, status, rolloutPercent) =>
            void run(
              `flag:${key}`,
              () => updateFeatureFlag({ key, status, rolloutPercent }),
              "Feature flag saved.",
            )
          }
        />
      )}

      <ChangeLog data={data} />

      {data.providerDetail && (
        <ProviderDrawer
          key={data.providerDetail.provider}
          provider={data.providerDetail}
          pending={pending}
          onClose={() => setParams({ provider: null })}
          onSave={(input) =>
            void run(
              `provider:${data.providerDetail!.provider}`,
              () => updateProviderSettings(input),
              "Provider updated.",
            )
          }
        />
      )}

      {stepUpDialog}
    </div>
  );
}

/* --------------------------------------------------------------- summary --- */

function SummaryStrip({ data }: { data: PlatformSettingsData }) {
  const cards: {
    label: string;
    value: string;
    sub?: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: TileTone;
  }[] = [
    {
      label: "Total providers",
      value: formatNumber(data.summary.totalProviders),
      sub: `${data.summary.healthyProviders} healthy`,
      icon: Radio,
      tone: "accent",
    },
    {
      label: "Degraded",
      value: formatNumber(data.summary.degradedProviders),
      icon: AlertTriangle,
      tone: "warning",
    },
    {
      label: "Offline / unconfigured",
      value: formatNumber(data.summary.offlineProviders),
      icon: Power,
      tone: "danger",
    },
    {
      label: "Avg. unit cost",
      value:
        data.summary.averageUnitCost === null
          ? "Not set"
          : `$${data.summary.averageUnitCost.toFixed(3)}`,
      sub: "across providers that declare one",
      icon: CircleDollarSign,
      tone: "info",
    },
    {
      label: "Active agents",
      value: `${data.summary.activeAgents} / ${data.summary.totalAgents}`,
      icon: Bot,
      tone: "success",
    },
    {
      label: "Feature flags",
      value: `${data.summary.activeFlags} / ${data.summary.totalFlags}`,
      icon: Flag,
      tone: "neutral",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs"
        >
          <div className="flex items-center gap-2.5">
            <IconTile icon={card.icon} tone={card.tone} />
            <p className="min-w-0 truncate text-[12px] font-medium text-content-muted">
              {card.label}
            </p>
          </div>
          <p className="lr-tabular mt-2.5 truncate text-[24px] leading-none font-semibold tracking-[-0.025em] text-content">
            {card.value}
          </p>
          {card.sub && (
            <p className="mt-1.5 truncate text-[11.5px] text-content-muted">{card.sub}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- providers --- */

function ProvidersView({
  data,
  search,
}: {
  data: PlatformSettingsData;
  search: string;
}) {
  const { setParams } = useAdminParams();
  const term = search.trim().toLowerCase();
  const rows = term
    ? data.providers.filter(
        (row) =>
          row.label.toLowerCase().includes(term) ||
          row.provider.toLowerCase().includes(term) ||
          PROVIDER_TYPE_LABEL[row.type].toLowerCase().includes(term),
      )
    : data.providers;

  return (
    <>
      <SearchInput
        defaultValue={search}
        label="Search providers"
        placeholder="Search providers..."
        onChange={(value) => setParams({ q: value || null })}
        className="w-full min-w-[220px] sm:w-[352px]"
      />

      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
        <p className="border-b border-line bg-surface-sunken px-4 py-2.5 text-[12px] text-content-secondary">
          Credentials are referenced, never stored. A provider marked
          &ldquo;unconfigured&rdquo; is missing an environment variable on this
          deployment — the settings below are still saved and take effect once it is set.
        </p>
        {rows.length === 0 ? (
          <EmptyState
            icon={Radio}
            title="No providers match"
            description="Clear the search to see the full catalogue."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface-sunken/60">
                  {[
                    "Provider",
                    "Type",
                    "Priority",
                    "Failover",
                    "Countries",
                    "Unit cost (est.)",
                    "Cost ceiling",
                    "Rate limits",
                    "Status",
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
                {rows.map((row) => (
                  <tr
                    key={row.provider}
                    className={cn(
                      "transition-colors",
                      data.providerDetail?.provider === row.provider
                        ? "bg-accent-50/60"
                        : "hover:bg-surface-hover",
                      !row.enabled && "opacity-60",
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <ProviderMark provider={row.provider} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-content">
                            {row.label}
                          </span>
                          {!row.credentialConfigured && (
                            <span className="block text-[11px] text-danger-600">
                              Credential not set
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[12.5px] text-content-accent">
                      {PROVIDER_TYPE_LABEL[row.type]}
                    </td>
                    <td className="lr-tabular px-4 py-2.5 text-[12.5px] text-content">
                      {row.priority}
                    </td>
                    <td className="lr-tabular px-4 py-2.5 text-[12.5px] text-content-muted">
                      {row.failoverOrder ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] whitespace-nowrap text-content-secondary">
                      {row.countryCodes.length === 0
                        ? "Global"
                        : row.countryCodes.length <= 3
                          ? row.countryCodes.join(", ")
                          : `${row.countryCodes.slice(0, 3).join(", ")} +${row.countryCodes.length - 3}`}
                    </td>
                    <td className="lr-tabular px-4 py-2.5 text-[12.5px] whitespace-nowrap text-content">
                      {row.unitCostEstimate === null
                        ? "Not set"
                        : `$${row.unitCostEstimate.toFixed(3)}`}
                    </td>
                    <td className="lr-tabular px-4 py-2.5 text-[12.5px] whitespace-nowrap">
                      {row.hardCostCeiling === null ? (
                        <span
                          className="text-warning-700"
                          title="No ceiling configured — spend on this provider is unbounded."
                        >
                          No ceiling
                        </span>
                      ) : (
                        <span className="text-content">
                          ${row.hardCostCeiling.toFixed(3)}
                        </span>
                      )}
                    </td>
                    <td className="lr-tabular px-4 py-2.5 text-[12px] whitespace-nowrap text-content-secondary">
                      {row.rateLimitPerMinute
                        ? `${formatNumber(row.rateLimitPerMinute)}/min`
                        : "Not set"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={PROVIDER_HEALTH_TONE[row.status]} dot>
                        {PROVIDER_HEALTH_LABEL[row.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setParams({ provider: row.provider })}
                        className="inline-flex h-7 items-center rounded-md border border-line px-2.5 text-[11.5px] font-medium text-content-secondary transition-colors hover:bg-surface-hover hover:text-content"
                      >
                        Configure
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------ ai & agents --- */

function AiView({
  data,
  pending,
  onSaveAi,
  onToggleAgent,
  onKillSwitch,
}: {
  data: PlatformSettingsData;
  pending: string | null;
  onSaveAi: (input: {
    defaultModel?: string;
    fallbackModel?: string;
    totalDailyBudget?: number | null;
  }) => void;
  onToggleAgent: (agent: string, enabled: boolean) => void;
  onKillSwitch: (enabled: boolean, reason: string) => void;
}) {
  const { ai } = data;
  const [defaultModel, setDefaultModel] = React.useState(ai.defaultModel);
  const [fallbackModel, setFallbackModel] = React.useState(ai.fallbackModel);
  const [budget, setBudget] = React.useState(
    ai.totalDailyBudget === null ? "" : String(ai.totalDailyBudget),
  );

  const dirty =
    defaultModel !== ai.defaultModel ||
    fallbackModel !== ai.fallbackModel ||
    budget !== (ai.totalDailyBudget === null ? "" : String(ai.totalDailyBudget));

  return (
    <>
      <section
        className={cn(
          "rounded-xl border p-4",
          ai.killSwitch
            ? "border-danger-100 bg-danger-50"
            : "border-line bg-surface shadow-xs",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <IconTile icon={Power} tone={ai.killSwitch ? "danger" : "success"} />
            <div className="min-w-0">
              <h3 className="text-[13px] font-semibold text-content">
                {ai.killSwitch ? "AI kill switch engaged" : "AI kill switch"}
              </h3>
              <p className="mt-0.5 text-[12.5px] text-content-secondary">
                {ai.killSwitch
                  ? `Engaged ${formatRelative(ai.killSwitchAt)} — ${ai.killSwitchReason ?? "no reason recorded"}. No agent will start a new run.`
                  : "Stops every agent from starting a new run, platform-wide. Runs already claimed by a worker finish."}
              </p>
            </div>
          </div>
          <Button
            variant={ai.killSwitch ? "secondary" : "danger"}
            size="sm"
            disabled={pending === "kill"}
            onClick={() => {
              const reason = window.prompt(
                ai.killSwitch
                  ? "Why is the kill switch being released?"
                  : "Why is the kill switch being engaged? This stops all AI across the platform.",
              );
              if (reason && reason.trim().length >= 8) {
                onKillSwitch(!ai.killSwitch, reason.trim());
              }
            }}
          >
            {ai.killSwitch ? "Release kill switch" : "Engage kill switch"}
          </Button>
        </div>
      </section>

      <Panel
        icon={Sparkles}
        tone="accent"
        title="Model routing and budget"
        description="Applies to every agent that has no override of its own."
        action={
          dirty ? (
            <Button
              size="sm"
              disabled={pending === "ai"}
              onClick={() =>
                onSaveAi({
                  defaultModel,
                  fallbackModel,
                  totalDailyBudget: budget === "" ? null : Number(budget),
                })
              }
            >
              Save changes
            </Button>
          ) : null
        }
      >
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-3 sm:px-5">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-content-muted">
              Default model
            </span>
            <Input
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-content-muted">
              Fallback model
            </span>
            <Input
              value={fallbackModel}
              onChange={(event) => setFallbackModel(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-content-muted">
              Total daily budget (£)
            </span>
            <Input
              type="number"
              min="0"
              value={budget}
              placeholder="No cap"
              onChange={(event) => setBudget(event.target.value)}
            />
          </label>
        </div>
        <div className="border-t border-line px-4 py-3 text-[12.5px] text-content-secondary sm:px-5">
          Spent in the last 24 hours:{" "}
          <span className="lr-tabular font-medium text-content">
            {formatMoneyPrecise(ai.spentToday)}
          </span>
          {ai.totalDailyBudget !== null && (
            <>
              {" "}of {formatMoneyPrecise(ai.totalDailyBudget)}
            </>
          )}
        </div>
      </Panel>

      <Panel
        icon={Bot}
        tone="info"
        title="Agent registry"
        description="Every agent the platform runs, with its routing, budget and prompt version."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] border-collapse text-left">
            <thead>
              <tr className="border-y border-line bg-surface-sunken/60">
                {[
                  "Agent",
                  "Enabled",
                  "Primary model",
                  "Fallback",
                  "Daily cap",
                  "Runs (24h)",
                  "Spend (24h)",
                  "Prompt version",
                ].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-4 py-2 text-[11px] font-semibold tracking-wide text-content-muted uppercase"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ai.agents.map((agent) => (
                <tr key={agent.agent} className="hover:bg-surface-hover">
                  <td className="px-4 py-2.5 text-[12.5px] font-medium text-content">
                    {agent.label}
                  </td>
                  <td className="px-4 py-2.5">
                    <Switch
                      checked={agent.enabled && !ai.killSwitch}
                      disabled={ai.killSwitch || pending === `agent:${agent.agent}`}
                      label={`Enable ${agent.label}`}
                      onCheckedChange={(next) => onToggleAgent(agent.agent, next)}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-[12.5px] text-content-secondary">
                    {agent.primaryModel}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-content-muted">
                    {agent.fallbackModel ?? "—"}
                  </td>
                  <td className="lr-tabular px-4 py-2.5 text-[12.5px] whitespace-nowrap">
                    {agent.dailySpendCap === null ? (
                      <span className="text-content-muted">Not set</span>
                    ) : (
                      formatMoneyPrecise(agent.dailySpendCap)
                    )}
                  </td>
                  <td className="lr-tabular px-4 py-2.5 text-[12.5px] text-content">
                    {formatNumber(agent.runs24h)}
                  </td>
                  <td className="lr-tabular px-4 py-2.5 text-[12.5px] text-content">
                    {formatMoneyPrecise(agent.spend24h)}
                  </td>
                  <td className="px-4 py-2.5 text-[12px]">
                    {agent.activePromptVersion ? (
                      <Badge tone="success" className="px-2">
                        {agent.activePromptVersion}
                      </Badge>
                    ) : (
                      <span className="text-content-muted">No active version</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/* --------------------------------------------------------------- outreach --- */

function OutreachView({
  data,
  pending,
  onSave,
}: {
  data: PlatformSettingsData;
  pending: string | null;
  onSave: (input: Record<string, number | null | boolean>) => void;
}) {
  const { outreach } = data;
  const [form, setForm] = React.useState({
    globalDailyEmailCap: outreach.globalDailyEmailCap,
    globalDailySmsCap: outreach.globalDailySmsCap,
    globalDailyWhatsappCap: outreach.globalDailyWhatsappCap,
    perMailboxDailyCap: outreach.perMailboxDailyCap,
    campaignConcurrency: outreach.campaignConcurrency,
    bounceThreshold: outreach.bounceThreshold,
    complaintThreshold: outreach.complaintThreshold,
    minimumDeliveryRate: outreach.minimumDeliveryRate,
    socialChannelsEnabled: outreach.socialChannelsEnabled,
  });

  const field = (
    key: keyof typeof form,
    label: string,
    used?: number,
    step = "1",
  ) => (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-content-muted">
        {label}
      </span>
      <Input
        type="number"
        min="0"
        step={step}
        value={form[key] === null ? "" : String(form[key])}
        placeholder="Not set"
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            [key]: event.target.value === "" ? null : Number(event.target.value),
          }))
        }
      />
      {used !== undefined && (
        <span className="mt-1 block text-[11.5px] text-content-muted">
          {formatNumber(used)} used today
        </span>
      )}
    </label>
  );

  return (
    <>
      <Panel
        icon={Send}
        tone="accent"
        title="Global daily caps"
        description="The ceiling every workspace and campaign sits under. A lower-level limit can never exceed these."
        action={
          <Button
            size="sm"
            disabled={pending === "outreach"}
            onClick={() => onSave(form)}
          >
            Save changes
          </Button>
        }
      >
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-4 sm:px-5">
          {field("globalDailyEmailCap", "Email per day", outreach.emailsToday)}
          {field("globalDailySmsCap", "SMS per day", outreach.smsToday)}
          {field("globalDailyWhatsappCap", "WhatsApp per day", outreach.whatsappToday)}
          {field("perMailboxDailyCap", "Per mailbox per day")}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          icon={Gauge}
          tone="warning"
          title="Mailbox and domain health"
          description="A sender breaching a threshold is paused before it damages the domain."
        >
          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-3 sm:px-5">
            {field("bounceThreshold", "Bounce threshold (%)", undefined, "0.1")}
            {field("complaintThreshold", "Complaint threshold (%)", undefined, "0.01")}
            {field("minimumDeliveryRate", "Minimum delivery (%)", undefined, "0.1")}
          </div>
        </Panel>

        <Panel
          icon={Radio}
          tone="info"
          title="Campaign controls"
          description="Concurrency and channel availability."
        >
          <div className="space-y-3 px-4 pb-4 sm:px-5">
            {field("campaignConcurrency", "Concurrent running campaigns")}
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-content">
                  Social channels
                </p>
                <p className="text-[11.5px] text-content-muted">
                  Direct messaging on social platforms, where policy permits it.
                </p>
              </div>
              <Switch
                checked={form.socialChannelsEnabled}
                label="Enable social channels"
                onCheckedChange={(next) =>
                  setForm((current) => ({ ...current, socialChannelsEnabled: next }))
                }
              />
            </div>
            <p className="text-[11.5px] text-content-muted">
              {formatNumber(outreach.activeCampaigns)} campaigns are running now.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}

/* -------------------------------------------------------------- compliance --- */

function ComplianceSummaryView() {
  return (
    <Panel
      icon={ShieldCheck}
      tone="success"
      title="Compliance"
      description="Policy packs, suppression and regional rules are managed on the System → Compliance surface."
    >
      <div className="px-4 pb-4 text-[13px] text-content-secondary sm:px-5">
        <p>
          Compliance is deliberately not editable from here. A policy is versioned
          and published, not toggled — see{" "}
          <a
            href="/admin/system?view=compliance"
            className="font-medium text-content-accent hover:underline"
          >
            System → Compliance
          </a>{" "}
          for the policy versions, country and channel matrices, the review queue,
          suppression search and the data subject request queue.
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------- price book --- */

function PriceBookView({ data }: { data: PlatformSettingsData }) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <p className="border-b border-line bg-surface-sunken px-4 py-2.5 text-[12px] text-content-secondary">
        Provider prices are effective-dated. A superseded row is kept so a past
        cost calculation can still be reproduced.
      </p>
      {data.priceBook.length === 0 ? (
        <EmptyState
          icon={CircleDollarSign}
          title="No price book entries"
          description="Provider unit costs recorded by the cost pipeline appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/60">
                {["Provider", "Product", "Region", "Unit", "Unit cost", "Effective from", "Status"].map(
                  (heading) => (
                    <th
                      key={heading}
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
              {data.priceBook.map((row) => (
                <tr
                  key={row.id}
                  className={cn("hover:bg-surface-hover", !row.current && "opacity-60")}
                >
                  <td className="px-4 py-2.5 text-[12.5px] font-medium text-content">
                    {row.provider}
                  </td>
                  <td className="px-4 py-2.5 text-[12.5px] text-content-secondary">
                    {row.product}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-content-muted">
                    {row.region ?? "Global"}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-content-muted">{row.unit}</td>
                  <td className="lr-tabular px-4 py-2.5 text-[12.5px] text-content">
                    {row.currency} {row.unitCost.toFixed(6)}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] whitespace-nowrap text-content-muted">
                    {formatDate(row.effectiveFrom)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={row.current ? "success" : "neutral"} dot>
                      {row.current ? "Current" : "Superseded"}
                    </Badge>
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

/* ----------------------------------------------------------- feature flags --- */

function FlagsView({
  data,
  pending,
  onSave,
}: {
  data: PlatformSettingsData;
  pending: string | null;
  onSave: (
    key: string,
    status: "ENABLED" | "BETA" | "DISABLED",
    rolloutPercent: number,
  ) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      {data.flags.length === 0 ? (
        <EmptyState
          icon={Flag}
          title="No feature flags defined"
          description="Flags control staged rollouts. Add one when a feature needs to ship behind a switch."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-surface-sunken/60">
                {["Flag", "Status", "Rollout", "Workspaces", "Updated", ""].map(
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
              {data.flags.map((flag) => (
                <FlagRow key={flag.key} flag={flag} pending={pending} onSave={onSave} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FlagRow({
  flag,
  pending,
  onSave,
}: {
  flag: PlatformSettingsData["flags"][number];
  pending: string | null;
  onSave: (
    key: string,
    status: "ENABLED" | "BETA" | "DISABLED",
    rolloutPercent: number,
  ) => void;
}) {
  const [status, setStatus] = React.useState(flag.status);
  const [rollout, setRollout] = React.useState(String(flag.rolloutPercent));
  const dirty = status !== flag.status || rollout !== String(flag.rolloutPercent);

  return (
    <tr className="hover:bg-surface-hover">
      <td className="px-4 py-2.5">
        <span className="block text-[12.5px] font-medium text-content">{flag.label}</span>
        <span className="lr-tabular block text-[11.5px] text-content-subtle">{flag.key}</span>
      </td>
      <td className="px-4 py-2.5">
        <Select
          value={status}
          aria-label={`Status for ${flag.label}`}
          className="h-8 w-[130px] text-[12px]"
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          {FLAG_STATUSES.map((option) => (
            <option key={option} value={option}>
              {FLAG_STATUS_LABEL[option]}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-4 py-2.5">
        <Input
          type="number"
          min="0"
          max="100"
          value={rollout}
          disabled={status !== "BETA"}
          aria-label={`Rollout percent for ${flag.label}`}
          className="h-8 w-[90px] text-[12px]"
          onChange={(event) => setRollout(event.target.value)}
        />
      </td>
      <td className="lr-tabular px-4 py-2.5 text-[12.5px] text-content-muted">
        {formatNumber(flag.workspaceCount)}
      </td>
      <td className="px-4 py-2.5 text-[12px] whitespace-nowrap text-content-muted">
        {formatRelative(flag.updatedAt)}
      </td>
      <td className="px-4 py-2.5 text-right">
        {dirty && (
          <Button
            size="sm"
            disabled={pending === `flag:${flag.key}`}
            onClick={() => onSave(flag.key, status, Number(rollout) || 0)}
          >
            Save
          </Button>
        )}
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------- changelog --- */

function ChangeLog({ data }: { data: PlatformSettingsData }) {
  return (
    <Panel
      icon={ShieldCheck}
      tone="neutral"
      title="Change log"
      description="Every platform settings change, with who made it."
    >
      {data.changeLog.length === 0 ? (
        <PanelEmpty>No settings have been changed yet.</PanelEmpty>
      ) : (
        <ul className="divide-y divide-line">
          {data.changeLog.slice(0, 8).map((change) => (
            <li key={change.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-content">
                  {change.summary}
                </span>
                <span className="block truncate text-[11.5px] text-content-subtle">
                  {change.namespace} · v{change.version} · {change.changedBy ?? "system"}
                </span>
              </span>
              <span className="shrink-0 text-[11.5px] whitespace-nowrap text-content-muted">
                {formatRelative(change.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
