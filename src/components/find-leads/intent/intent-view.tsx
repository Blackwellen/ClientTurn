"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  Building2,
  CircleCheck,
  ExternalLink,
  Plus,
  Radar,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/form";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { setIntentCategoryActive } from "@/lib/intent/actions";
import {
  cadenceLabel,
  signalSourceLabel,
  type IntentCategoryRow,
  type IntentViewData,
} from "@/lib/intent/types";
import { shortAgo } from "@/lib/prospects/activity";
import { CategoryBuilder } from "./category-builder";
import { MonitorBuilder } from "./monitor-builder";
import { IntentControls } from "./intent-controls";

/**
 * The Intent view (V4 §15).
 *
 * The order the work actually happens in: define what a buying signal means for
 * this business, point a monitor at somewhere to look, then read what came back.
 *
 * Signals that have aged out are shown greyed rather than hidden. Seeing that a
 * signal expired is how someone learns their freshness window is wrong, and
 * §62.2 is explicit that an expired signal is history, not intent — so it stays
 * visible but contributes nothing.
 */
export function IntentView({
  data,
  canManage,
}: {
  data: IntentViewData;
  canManage: boolean;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [addingMonitor, setAddingMonitor] = React.useState(false);

  const { overview, categories, monitors, monitoredCompanies, events, sourceUsage } = data;
  const monitorsFull = overview.monitorsUsed >= overview.monitorLimit;

  const editingCategory =
    editing && editing !== "new"
      ? (categories.find((category) => category.id === editing) ?? null)
      : null;

  return (
    <div className="space-y-4">
      <IntentKpiStrip data={data} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <CategoryTable
          categories={categories}
          canManage={canManage}
          onNew={() => setEditing("new")}
          onEdit={(id) => setEditing(id)}
        />

        {canManage && editing ? (
          <CategoryBuilder
            category={editingCategory}
            icpProfiles={data.icpProfiles}
            monitorLimit={overview.monitorLimit}
            onClose={() => setEditing(null)}
          />
        ) : (
          <MonitorsCard
            monitors={monitors}
            canManage={canManage}
            monitorsFull={monitorsFull}
            monitorLimit={overview.monitorLimit}
            adding={addingMonitor}
            onToggleAdd={() => setAddingMonitor((open) => !open)}
            categories={categories}
            icpProfiles={data.icpProfiles}
            onCloseAdd={() => setAddingMonitor(false)}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <MonitoredCompaniesCard companies={monitoredCompanies} canManage={canManage} />
        <RecentSignalsCard events={events} />
        <SourceUsageCard usage={sourceUsage} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- overview */

function IntentKpiStrip({ data }: { data: IntentViewData }) {
  const { overview } = data;

  // Real or omitted. A workspace with no previous 30 days has no trend, and
  // "+100%" against a baseline that never existed would be a fabrication.
  const signalTrend =
    overview.signalsPrior30d > 0
      ? (overview.signals30d - overview.signalsPrior30d) / overview.signalsPrior30d
      : null;

  const cards = [
    {
      key: "signals",
      icon: CircleCheck,
      label: "Intent signals",
      value: overview.signals30d.toLocaleString("en-GB"),
      trend: signalTrend,
    },
    {
      key: "companies",
      icon: Building2,
      label: "Companies with intent",
      value: overview.companiesWithIntent.toLocaleString("en-GB"),
      trend: null,
    },
    {
      key: "high",
      icon: Zap,
      label: "High intent prospects",
      value: overview.highIntentProspects.toLocaleString("en-GB"),
      trend: null,
    },
    {
      key: "categories",
      icon: Target,
      label: "Categories active",
      value: `${overview.activeCategories}`,
      suffix: ` / ${overview.totalCategories}`,
      trend: null,
    },
    {
      key: "monitored",
      icon: Users,
      label: "Monitored companies",
      value: overview.monitoredCompanies.toLocaleString("en-GB"),
      trend: null,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.key}
          className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs"
        >
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-content-accent"
              aria-hidden
            >
              <card.icon className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-medium text-content-secondary">
                {card.label}
              </p>
              <p className="mt-0.5 text-[24px] font-semibold leading-tight tabular-nums text-content">
                {card.value}
                {card.suffix && (
                  <span className="text-[16px] font-normal text-content-subtle">
                    {card.suffix}
                  </span>
                )}
              </p>
            </div>
          </div>

          {card.trend !== null && (
            <p
              className={cn(
                "mt-2 flex items-center gap-1 text-[11.5px]",
                card.trend >= 0 ? "text-success-700" : "text-danger-600",
              )}
            >
              <TrendingUp
                className={cn("size-3.5 shrink-0", card.trend < 0 && "rotate-180")}
                aria-hidden
              />
              <span className="font-semibold tabular-nums">
                {card.trend >= 0 ? "+" : ""}
                {Math.round(card.trend * 100)}%
              </span>
              <span className="text-content-muted">vs. previous 30 days</span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- categories */

function CategoryTable({
  categories,
  canManage,
  onNew,
  onEdit,
}: {
  categories: IntentCategoryRow[];
  canManage: boolean;
  onNew: () => void;
  onEdit: (id: string) => void;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-content">
            <Sparkles className="size-4 text-content-accent" aria-hidden />
            Intent categories
          </h2>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            Create and manage the buying-intent categories you want to track.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={onNew}>
            <Plus className="size-3.5" aria-hidden />
            New intent category
          </Button>
        )}
      </div>

      {categories.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No intent categories yet"
          description="Name the signals that mean someone is likely to buy — a tender, a new location, a visit to your site — and prospects showing them are prioritised."
          action={
            canManage ? (
              <Button size="sm" onClick={onNew}>
                Create intent category
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <caption className="sr-only">
              Intent categories, their signal volume and score impact
            </caption>
            <thead>
              <tr className="border-y border-line bg-surface-sunken/60">
                <Th>Category</Th>
                <Th>Description</Th>
                <Th align="right">Signals (30d)</Th>
                <Th align="center">Active</Th>
                <Th align="right">Score impact</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  canManage={canManage}
                  onEdit={() => onEdit(category.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {categories.length > 0 && (
        <p className="border-t border-line-subtle px-5 py-3 text-[12px] text-content-muted">
          Showing {categories.length} categor{categories.length === 1 ? "y" : "ies"}
        </p>
      )}
    </section>
  );
}

function CategoryRow({
  category,
  canManage,
  onEdit,
}: {
  category: IntentCategoryRow;
  canManage: boolean;
  onEdit: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  const toggle = (next: boolean) => {
    startTransition(async () => {
      const result = await setIntentCategoryActive(category.id, next);
      if (result.ok) {
        router.refresh();
        return;
      }
      toast({ variant: "error", title: result.error });
    });
  };

  return (
    <tr className="border-b border-line-subtle last:border-0">
      <Td>
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-content-accent"
            aria-hidden
          >
            <Target className="size-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium text-content">{category.name}</p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {category.signalTypes.slice(0, 2).map((key) => (
                <span key={key} className="text-[10.5px] text-content-subtle">
                  {signalSourceLabel(key)}
                </span>
              ))}
              {category.signalTypes.length > 2 && (
                <span className="text-[10.5px] text-content-subtle">
                  +{category.signalTypes.length - 2}
                </span>
              )}
            </div>
          </div>
        </div>
      </Td>

      <Td>
        <p className="max-w-[16rem] text-[12px] text-content-muted">
          {category.description ?? "No description"}
        </p>
      </Td>

      <Td align="right">
        <p className="text-[13px] font-semibold tabular-nums text-content">
          {category.signals30d.toLocaleString("en-GB")}
        </p>
        {category.signalTrend !== null && (
          <p
            className={cn(
              "text-[11px] font-medium tabular-nums",
              category.signalTrend >= 0 ? "text-success-700" : "text-danger-600",
            )}
          >
            {category.signalTrend >= 0 ? "+" : ""}
            {Math.round(category.signalTrend * 100)}%
          </p>
        )}
      </Td>

      <Td align="center">
        <div className="flex justify-center">
          <Switch
            checked={category.active}
            disabled={!canManage || pending}
            onCheckedChange={toggle}
            tone="success"
            label={`${category.active ? "Pause" : "Activate"} ${category.name}`}
          />
        </div>
      </Td>

      <Td align="right">
        <Tooltip
          content={`Contributes at most +${category.scoreImpact} to a prospect's score, for ${category.freshnessDays} days · ${cadenceLabel(category.defaultCadence)}`}
        >
          <Badge tone="success" dense className="tabular-nums">
            +{category.scoreImpact}
          </Badge>
        </Tooltip>
      </Td>

      <Td align="right">
        {canManage && (
          <div className="flex justify-end">
            <IntentControls
              kind="category"
              id={category.id}
              active={category.active}
              onEdit={onEdit}
            />
          </div>
        )}
      </Td>
    </tr>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2 text-[11.5px] font-medium text-content-muted",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  return (
    <td
      className={cn(
        "px-4 py-2.5 align-middle",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
      )}
    >
      {children}
    </td>
  );
}

/* ---------------------------------------------------------------- monitors */

function MonitorsCard({
  monitors,
  canManage,
  monitorsFull,
  monitorLimit,
  adding,
  onToggleAdd,
  onCloseAdd,
  categories,
  icpProfiles,
}: {
  monitors: IntentViewData["monitors"];
  canManage: boolean;
  monitorsFull: boolean;
  monitorLimit: number;
  adding: boolean;
  onToggleAdd: () => void;
  onCloseAdd: () => void;
  categories: IntentCategoryRow[];
  icpProfiles: { id: string; name: string }[];
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-content">
            <Radar className="size-4 text-content-accent" aria-hidden />
            Monitors
          </h2>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            Where to watch for those signals, and how often. {monitors.length} of{" "}
            {monitorLimit} on your plan.
          </p>
        </div>
        {canManage && categories.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            disabled={monitorsFull && !adding}
            title={
              monitorsFull
                ? "You have as many active monitors as your plan allows"
                : undefined
            }
            onClick={onToggleAdd}
          >
            <Plus className="size-3.5" aria-hidden />
            New monitor
          </Button>
        )}
      </div>

      {adding && (
        <div className="mt-4">
          <MonitorBuilder
            categories={categories.filter((category) => category.active)}
            icpProfiles={icpProfiles}
            onClose={onCloseAdd}
          />
        </div>
      )}

      {monitors.length === 0 && !adding ? (
        <EmptyState
          icon={Radar}
          title="Nothing is being watched yet"
          description={
            categories.length === 0
              ? "Create a category first, then point a monitor at the companies you care about."
              : "Add a monitor to watch an ideal customer profile, or a named list of companies."
          }
        />
      ) : (
        <ul className="mt-3 divide-y divide-line-subtle">
          {monitors.map((monitor) => (
            <li
              key={monitor.id}
              className="flex flex-wrap items-start justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="text-[12.5px] font-medium text-content">
                  {monitor.name || monitor.categoryName}
                </p>
                <p className="mt-0.5 text-[11.5px] text-content-muted">
                  {cadenceLabel(monitor.cadence)}
                  {monitor.targetCount > 0 && ` · ${monitor.targetCount} target(s)`}
                </p>
                {monitor.lastError && (
                  <p className="mt-0.5 text-[11.5px] text-danger-600">{monitor.lastError}</p>
                )}
                <p className="mt-0.5 text-[11px] text-content-subtle">
                  {monitor.lastRunAt ? `Last run ${shortAgo(monitor.lastRunAt)}` : "Not run yet"}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Badge
                  tone={
                    monitor.status === "ACTIVE"
                      ? "success"
                      : monitor.status === "PLAN_LIMITED"
                        ? "warning"
                        : "neutral"
                  }
                  dense
                  dot
                >
                  {monitor.status.toLowerCase().replace(/_/g, " ")}
                </Badge>
                {canManage && (
                  <IntentControls
                    kind="monitor"
                    id={monitor.id}
                    active={monitor.status === "ACTIVE"}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------ monitored companies */

function MonitoredCompaniesCard({
  companies,
  canManage,
}: {
  companies: IntentViewData["monitoredCompanies"];
  canManage: boolean;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-content">
            <Building2 className="size-4 text-content-accent" aria-hidden />
            Monitored companies
          </h2>
          <p className="mt-0.5 text-[12px] text-content-muted">
            Track specific companies or domains for intent signals.
          </p>
        </div>
      </div>

      {companies.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-content-muted">
          {canManage
            ? "No companies are being watched by name yet. Add a monitor of type “a named list of companies”."
            : "No companies are being watched by name yet."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse">
            <caption className="sr-only">Companies watched by name</caption>
            <thead>
              <tr className="border-b border-line">
                <Th>Company</Th>
                <Th>Categories</Th>
                <Th>Last signal</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {companies.slice(0, 8).map((company) => (
                <tr key={company.key} className="border-b border-line-subtle last:border-0">
                  <Td>
                    <p className="truncate text-[12.5px] font-medium text-content">
                      {company.name}
                    </p>
                    {company.domain && (
                      <p className="truncate text-[11px] text-content-subtle">
                        {company.domain}
                      </p>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {company.categories.slice(0, 2).map((name) => (
                        <Badge key={name} tone="purple" dense>
                          <span className="max-w-[7rem] truncate">{name}</span>
                        </Badge>
                      ))}
                      {company.categories.length > 2 && (
                        <span className="text-[11px] text-content-subtle">
                          +{company.categories.length - 2}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <span className="text-[11.5px] text-content-muted">
                      {company.lastSignalAt ? shortAgo(company.lastSignalAt) : "—"}
                    </span>
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        company.status === "INTENT_DETECTED"
                          ? "success"
                          : company.status === "PAUSED"
                            ? "neutral"
                            : "accent"
                      }
                      dense
                      dot
                    >
                      {company.status === "INTENT_DETECTED"
                        ? "Intent detected"
                        : company.status === "PAUSED"
                          ? "Paused"
                          : "Monitoring"}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- recent signals */

function RecentSignalsCard({ events }: { events: IntentViewData["events"] }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-content">
            <Activity className="size-4 text-content-accent" aria-hidden />
            Recent intent signals
          </h2>
          <p className="mt-0.5 text-[12px] text-content-muted">
            Latest signals from your active categories.
          </p>
        </div>
        <Link
          href="/app/find-leads?view=prospects&quick=intent"
          className="text-[12px] font-medium text-content-accent underline-offset-4 hover:underline"
        >
          View all
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-content-muted">
          No signals yet. They appear here as your monitors run.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line-subtle">
          {events.slice(0, 6).map((event) => (
            <li
              key={event.id}
              className={cn(
                "flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0",
                event.expired && "opacity-60",
              )}
            >
              <span
                className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-content-subtle"
                aria-hidden
              >
                <Building2 className="size-3.5" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-content">
                  {event.companyName ?? "Company"}
                </p>
                <p className="truncate text-[11.5px] text-content-muted">
                  {event.evidenceSummary ?? signalSourceLabel(event.signalType)}
                </p>
                {event.sourceUrl && (
                  <a
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-content-accent underline-offset-4 hover:underline"
                  >
                    Source <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </div>

              <div className="shrink-0 text-right">
                <Badge tone={event.expired ? "neutral" : "purple"} dense>
                  <span className="max-w-[7rem] truncate">{event.categoryName}</span>
                </Badge>
                <p className="mt-1 text-[11px] text-content-subtle">
                  {shortAgo(event.observedAt)}
                  {event.expired && " · expired"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- source use */

function SourceUsageCard({ usage }: { usage: IntentViewData["sourceUsage"] }) {
  const total = usage.reduce((sum, row) => sum + row.events, 0);

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-content">
            <BarChart3 className="size-4 text-content-accent" aria-hidden />
            Intent usage &amp; sources
          </h2>
          <p className="mt-0.5 text-[12px] text-content-muted">
            Signals by source and usage this month.
          </p>
        </div>
      </div>

      {usage.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-content-muted">
          No signals have been recorded this month.
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-2.5">
            {usage.map((row) => (
              <li key={row.source} className="flex items-center gap-3">
                <span className="w-[9.5rem] shrink-0 truncate text-[12px] text-content-secondary">
                  {signalSourceLabel(row.source)}
                </span>
                <span
                  className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken"
                  role="progressbar"
                  aria-valuenow={row.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${signalSourceLabel(row.source)} share of this month's signals`}
                >
                  <span
                    className="block h-full rounded-full bg-accent-500"
                    style={{ width: `${row.percent}%` }}
                  />
                </span>
                <span className="w-9 shrink-0 text-right text-[11.5px] tabular-nums text-content-muted">
                  {row.percent}%
                </span>
                <span className="w-10 shrink-0 text-right text-[12px] font-medium tabular-nums text-content">
                  {row.events.toLocaleString("en-GB")}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3 border-t border-line-subtle pt-2.5 text-[11.5px] text-content-subtle">
            {total.toLocaleString("en-GB")} signal{total === 1 ? "" : "s"} this month, across{" "}
            {usage.length} source{usage.length === 1 ? "" : "s"}.
          </p>
        </>
      )}
    </section>
  );
}
