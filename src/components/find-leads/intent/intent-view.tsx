"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Plus, Radar, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  SIGNAL_SOURCES,
  cadenceLabel,
  freshnessPercent,
  monitorStatusTone,
  monitorTypeLabel,
  signalSourceLabel,
  type IntentViewData,
} from "@/lib/intent/types";
import { intentFreshness } from "@/lib/prospects/types";
import { CategoryBuilder } from "./category-builder";
import { MonitorBuilder } from "./monitor-builder";
import { IntentControls } from "./intent-controls";

/**
 * The Intent view (V4 §15).
 *
 * Three blocks in the order the work happens: define what a buying signal means
 * for this business, point a monitor at somewhere to look, then read what came
 * back. Signals that have aged out are shown greyed rather than hidden — seeing
 * that a signal expired is how someone learns the freshness window is wrong.
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

  const { overview, categories, monitors, events } = data;
  const monitorsFull = overview.monitorsUsed >= overview.monitorLimit;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active categories" value={overview.activeCategories} />
        <Stat
          label="Active monitors"
          value={overview.activeMonitors}
          hint={`of ${overview.monitorLimit} on your plan`}
          tone={monitorsFull ? "warning" : undefined}
        />
        <Stat label="Live signals" value={overview.liveSignals} />
        <Stat label="Prospects with intent" value={overview.prospectsWithIntent} />
      </div>

      {/* ------------------------------------------------------- categories */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-content">Intent categories</h2>
            <p className="mt-0.5 text-[12.5px] text-content-muted">
              What counts as a buying signal for your business, and how much it should
              move a prospect&rsquo;s score.
            </p>
          </div>
          {canManage && (
            <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
              <Plus className="size-3.5" aria-hidden />
              New category
            </Button>
          )}
        </div>

        {editing && (
          <CategoryBuilder
            category={
              editing === "new" ? null : (categories.find((c) => c.id === editing) ?? null)
            }
            onClose={() => setEditing(null)}
          />
        )}

        {categories.length === 0 && !editing ? (
          <EmptyState
            icon={Sparkles}
            title="No intent categories yet"
            description="Name the signals that mean someone is likely to buy — a tender, a new location, a visit to your site — and prospects showing them are prioritised."
            action={
              canManage ? (
                <Button size="sm" onClick={() => setEditing("new")}>
                  Create your first category
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {categories.map((category) => (
              <li key={category.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-content">
                        {category.name}
                      </span>
                      {!category.active && (
                        <Badge tone="neutral" dense>
                          paused
                        </Badge>
                      )}
                      {category.autoAddToSearch && (
                        <Badge tone="accent" dense>
                          used in searches
                        </Badge>
                      )}
                    </div>
                    {category.description && (
                      <p className="mt-0.5 text-[12px] text-content-muted">
                        {category.description}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {category.signalTypes.map((key) => (
                        <Tooltip key={key} content={SIGNAL_SOURCES[key]?.mechanism ?? ""}>
                          <Badge tone="neutral" dense>
                            {signalSourceLabel(key)}
                          </Badge>
                        </Tooltip>
                      ))}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    <dl className="text-right">
                      <dd className="text-[15px] font-semibold tabular-nums text-content">
                        {category.liveSignals}
                      </dd>
                      <dt className="text-[11px] text-content-muted">live signals</dt>
                    </dl>
                    <dl className="text-right">
                      <dd className="text-[15px] font-semibold tabular-nums text-content">
                        +{category.scoreImpact}
                      </dd>
                      <dt className="text-[11px] text-content-muted">
                        max score · {category.freshnessDays}d
                      </dt>
                    </dl>
                    {canManage && (
                      <IntentControls
                        kind="category"
                        id={category.id}
                        active={category.active}
                        onEdit={() => setEditing(category.id)}
                      />
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --------------------------------------------------------- monitors */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-content">Monitors</h2>
            <p className="mt-0.5 text-[12.5px] text-content-muted">
              Where to watch for those signals, and how often.
            </p>
          </div>
          {canManage && categories.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              disabled={monitorsFull && !addingMonitor}
              title={monitorsFull ? "You have as many active monitors as your plan allows" : undefined}
              onClick={() => setAddingMonitor((open) => !open)}
            >
              <Plus className="size-3.5" aria-hidden />
              New monitor
            </Button>
          )}
        </div>

        {addingMonitor && (
          <MonitorBuilder
            categories={categories.filter((c) => c.active)}
            icpProfiles={data.icpProfiles}
            onClose={() => setAddingMonitor(false)}
          />
        )}

        {monitors.length === 0 && !addingMonitor ? (
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
          <ul className="divide-y divide-line-subtle">
            {monitors.map((monitor) => (
              <li
                key={monitor.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-content">
                    {monitor.name || monitor.categoryName}
                  </p>
                  <p className="mt-0.5 text-[12px] text-content-muted">
                    {monitorTypeLabel(monitor.monitorType)} · {cadenceLabel(monitor.cadence)}
                    {monitor.targetCount > 0 && ` · ${monitor.targetCount} target(s)`}
                  </p>
                  {monitor.lastError && (
                    <p className="mt-0.5 text-[12px] text-danger-600">{monitor.lastError}</p>
                  )}
                  <p className="mt-0.5 text-[11.5px] text-content-subtle">
                    {monitor.lastRunAt
                      ? `Last run ${intentFreshness(monitor.lastRunAt).toLowerCase()}`
                      : "Not run yet"}
                    {monitor.nextRunAt && monitor.status === "ACTIVE"
                      ? ` · next ${new Date(monitor.nextRunAt).toLocaleDateString("en-GB")}`
                      : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <Badge tone={monitorStatusTone(monitor.status)} dense dot>
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

      {/* ----------------------------------------------------------- events */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
        <h2 className="text-[14px] font-semibold text-content">Recent signals</h2>
        <p className="mb-3 mt-0.5 text-[12.5px] text-content-muted">
          A signal stops affecting scores once its freshness window closes. Expired ones
          stay here as history.
        </p>

        {events.length === 0 ? (
          <EmptyState
            title="No signals yet"
            description="Signals appear here as your monitors run."
          />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {events.map((event) => {
              const remaining = freshnessPercent(event.observedAt, event.expiresAt);
              return (
                <li
                  key={event.id}
                  className={cn("py-3", event.expired && "opacity-60")}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={event.expired ? "neutral" : "purple"} dense>
                          {event.categoryName}
                        </Badge>
                        <span className="text-[13px] font-medium text-content">
                          {event.companyName ?? "Company"}
                        </span>
                      </div>
                      {event.evidenceSummary && (
                        <p className="mt-0.5 text-[12px] text-content-muted">
                          {event.evidenceSummary}
                        </p>
                      )}
                      <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-content-subtle">
                        {signalSourceLabel(event.signalType)} ·{" "}
                        {intentFreshness(event.observedAt)}
                        {event.sourceUrl && (
                          <a
                            href={event.sourceUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-content-accent underline-offset-4 hover:underline"
                          >
                            source <ExternalLink className="size-3" aria-hidden />
                          </a>
                        )}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      {event.expired ? (
                        <Badge tone="neutral" dense>
                          expired
                        </Badge>
                      ) : (
                        <>
                          <div
                            className="h-1 w-16 overflow-hidden rounded-full bg-surface-sunken"
                            role="progressbar"
                            aria-valuenow={remaining}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label="Freshness remaining"
                          >
                            <div
                              className="h-full rounded-full bg-purple-500"
                              style={{ width: `${remaining}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[11px] text-content-subtle">
                            {remaining}% fresh
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <Link
          href="/app/find-leads?view=prospects&quick=intent"
          className="mt-3 inline-block text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
        >
          See prospects showing intent
        </Link>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "warning";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <p className="text-[12.5px] text-content-muted">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-[22px] font-semibold leading-none tabular-nums",
          tone === "warning" ? "text-warning-700" : "text-content",
        )}
      >
        {value.toLocaleString("en-GB")}
      </p>
      {hint && <p className="mt-1 text-[11px] text-content-subtle">{hint}</p>}
    </div>
  );
}
