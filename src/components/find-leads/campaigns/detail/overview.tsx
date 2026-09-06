import * as React from "react";
import Link from "next/link";
import {
  BarChart3,
  CalendarCheck,
  Check,
  CircleCheck,
  Database,
  LineChart,
  ListChecks,
  Mail,
  MessageSquare,
  Rocket,
  Settings2,
  Sparkles,
  TriangleAlert,
  Undo2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";
import {
  OPTIMIZATION_DIMENSIONS,
  formatCount,
  formatMoneyMinor,
} from "@/lib/outreach/campaign-draft";
import type { CampaignOverview } from "@/lib/outreach/campaigns/detail";
import { CampaignControls } from "./controls";
import { PerformanceChart } from "./performance-chart";

/**
 * Campaign Detail — Overview.
 *
 * Every figure here is a database aggregate. Nothing is derived from a sample,
 * nothing is modelled, and a stage with no data shows an empty state rather
 * than a zero dressed up as a measurement.
 */
export function CampaignOverviewTab({
  data,
  canManage,
}: {
  data: CampaignOverview;
  canManage: boolean;
}) {
  const { header, kpis, stages, budget, series, replies, attention } = data;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          icon={Rocket}
          label="Campaign goal"
          value={header.conversionGoalLabel ?? "Not set"}
          detail={
            header.serviceName
              ? `Generate qualified ${header.conversionGoalLabel?.toLowerCase() ?? "outcomes"} for ${header.serviceName}.`
              : undefined
          }
          compact
        />
        <KpiCard
          icon={Users}
          label="Prospects in campaign"
          value={formatCount(kpis.prospects)}
          detail={
            kpis.targetProspects > 0
              ? `Target ${formatCount(kpis.targetProspects)}`
              : undefined
          }
        />
        <KpiCard
          icon={Mail}
          label="Contacts sent"
          value={formatCount(kpis.contactsSent)}
          detail={
            kpis.targetProspects > 0
              ? `${Math.round((kpis.contactsSent / kpis.targetProspects) * 100)}% of target`
              : undefined
          }
        />
        <KpiCard
          icon={Undo2}
          label="Replies"
          value={formatCount(kpis.replies)}
          detail={
            kpis.contactsSent > 0
              ? `${((kpis.replies / kpis.contactsSent) * 100).toFixed(1)}% reply rate`
              : undefined
          }
        />
        <KpiCard
          icon={CalendarCheck}
          label="Qualified"
          value={formatCount(kpis.qualified)}
          detail={
            kpis.prospects > 0
              ? `${((kpis.qualified / kpis.prospects) * 100).toFixed(1)}% of total`
              : undefined
          }
        />
        <KpiCard
          icon={BarChart3}
          label="Booked"
          value={formatCount(kpis.booked)}
          detail={
            kpis.prospects > 0
              ? `${((kpis.booked / kpis.prospects) * 100).toFixed(1)}% of total`
              : undefined
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.85fr)]">
        {/* ------------------------------------------------------- funnel */}
        <Panel
          icon={Undo2}
          title="Campaign funnel"
          description="From outreach to booked outcomes."
          aside={<span className="text-[12px] text-content-muted">Last 30 days</span>}
        >
          {kpis.prospects === 0 ? (
            <EmptyState
              icon={Users}
              title="No prospects yet"
              description="The audience is still being built. Come back once it has run."
            />
          ) : (
            <Funnel stages={stages} />
          )}
        </Panel>

        {/* -------------------------------------------------- budget usage */}
        <Panel icon={Database} title="Budget usage" tone="purple">
          {budget.capMinor === 0 ? (
            <p className="text-[12.5px] text-content-muted">
              No provider budget was reserved for this campaign, so there is nothing to
              spend against.
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[20px] font-bold tabular-nums text-content">
                  {formatMoneyMinor(budget.spentMinor)}{" "}
                  <span className="text-content-muted">
                    / {formatMoneyMinor(budget.capMinor)}
                  </span>
                </p>
                <span className="shrink-0 text-[12px] tabular-nums text-content-muted">
                  {budget.percentUsed ?? 0}% used
                </span>
              </div>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken"
                role="progressbar"
                aria-valuenow={budget.percentUsed ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Budget used"
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    (budget.percentUsed ?? 0) >= 100
                      ? "bg-danger-500"
                      : (budget.percentUsed ?? 0) >= 80
                        ? "bg-warning-500"
                        : "bg-success-500",
                  )}
                  style={{ width: `${budget.percentUsed ?? 0}%` }}
                />
              </div>

              {budget.empty ? (
                <p className="mt-3 text-[12px] text-content-muted">
                  Nothing has been attributed to a cost category yet. A breakdown appears
                  once this campaign starts spending.
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {budget.breakdown.map((row, index) => (
                    <li key={row.category} className="flex items-center gap-2 text-[12px]">
                      <span
                        aria-hidden
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          [
                            "bg-info-500",
                            "bg-purple-500",
                            "bg-warning-500",
                            "bg-danger-500",
                          ][index % 4],
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-content-secondary">
                        {row.label}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums text-content">
                        {formatMoneyMinor(row.minor)}
                      </span>
                      <span className="w-9 shrink-0 text-right tabular-nums text-content-muted">
                        {row.percent}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>

        {/* ---------------------------------------------------- controls */}
        <div className="space-y-4">
          <CampaignControls campaign={header} canManage={canManage} />

          <Panel icon={Sparkles} title="Auto optimize" tone="purple">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[12.5px] leading-snug text-content-secondary">
                The system will automatically optimise send times, message variants and
                prospect ordering within your configured limits.
              </p>
              <Badge tone={header.autoOptimize ? "success" : "neutral"} dot>
                {header.autoOptimize ? "Enabled" : "Off"}
              </Badge>
            </div>

            <Link
              href={`/app/find-leads/campaigns/${header.id}?view=performance#optimisation`}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[12.5px] font-medium text-content transition-colors hover:bg-surface-hover"
            >
              <Settings2 className="size-3.5" aria-hidden />
              Configuration
            </Link>

            {header.autoOptimize && (
              <div className="mt-3 rounded-lg bg-success-50 px-3.5 py-3">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-content">
                  <CircleCheck className="size-3.5 text-success-600" aria-hidden />
                  Optimisation is active
                </p>
                <ul className="mt-2 space-y-1">
                  {OPTIMIZATION_DIMENSIONS.filter((dimension) =>
                    header.optimization.dimensions.includes(dimension.key),
                  ).map((dimension) => (
                    <li
                      key={dimension.key}
                      className="flex items-center gap-1.5 text-[11.5px] text-content-secondary"
                    >
                      <Check className="size-3 shrink-0 text-success-600" aria-hidden />
                      {dimension.label} (enabled)
                    </li>
                  ))}
                </ul>
                {/* The constraint, stated where the capability is claimed. */}
                <p className="mt-2 text-[11.5px] leading-snug text-content-muted">
                  Cannot increase spend beyond your budget or bypass compliance rules.
                </p>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.85fr)]">
        {/* -------------------------------------------------- performance */}
        <Panel
          icon={LineChart}
          title="Current performance"
          description="Daily contacts, replies and bookings."
          tone="info"
          aside={<span className="text-[12px] text-content-muted">Last 30 days</span>}
        >
          {series.every((point) => point.contactsSent === 0 && point.replies === 0) ? (
            <EmptyState
              icon={LineChart}
              title="Nothing to chart yet"
              description="A trend appears once this campaign has sent for a few days."
            />
          ) : (
            <PerformanceChart series={series} />
          )}
        </Panel>

        {/* ------------------------------------------------ recent replies */}
        <Panel
          icon={MessageSquare}
          title="Recent replies"
          aside={
            <Link
              href={`/app/find-leads/campaigns/${header.id}?view=audience&filter=replied`}
              className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-content transition-colors hover:bg-surface-hover"
            >
              View all
            </Link>
          }
        >
          {replies.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No replies yet"
              description="Replies appear here as soon as someone answers."
            />
          ) : (
            <ul className="divide-y divide-line-subtle">
              {replies.map((reply) => (
                <li key={reply.messageId} className="py-2.5 first:pt-0 last:pb-0">
                  <Link
                    href={`/app/find-leads?view=prospects&prospect=${reply.prospectId}`}
                    className="flex gap-2.5 rounded-md px-1 py-1 transition-colors hover:bg-surface-hover"
                  >
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-semibold text-content-secondary"
                    >
                      {initials(reply.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[12.5px] font-semibold text-content">
                          {reply.name}
                        </span>
                        <ReplyBadge classification={reply.classification} />
                        <span className="ml-auto shrink-0 text-[11.5px] text-content-muted">
                          {relative(reply.receivedAt)}
                        </span>
                      </div>
                      <p className="truncate text-[11.5px] text-content-muted">
                        {reply.company ?? "Unknown company"}
                      </p>
                      {/* A preview only. The whole reply lives in the
                          conversation, where reading it is deliberate. */}
                      <p className="mt-1 line-clamp-1 text-[12px] text-content-secondary">
                        {reply.snippet}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ------------------------------------------------------ next steps */}
        <Panel icon={ListChecks} title="Next steps">
          <ol className="space-y-2.5">
            {nextSteps(data).map((item) => (
              <li key={item.label} className="flex gap-2 text-[12.5px] leading-snug">
                <span
                  aria-hidden
                  className={cn(
                    "mt-px flex size-4 shrink-0 items-center justify-center rounded-full",
                    item.done
                      ? "bg-success-500 text-white"
                      : "border border-line-strong bg-surface",
                  )}
                >
                  {item.done && <Check className="size-2.5" strokeWidth={3} />}
                </span>
                <span className={item.done ? "text-content" : "text-content-secondary"}>
                  {item.label}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      {/* ----------------------------------------------------- attention */}
      <Panel icon={TriangleAlert} title="Attention items" tone="warning">
        {attention.length === 0 ? (
          <p className="flex items-center gap-2 text-[12.5px] text-content-secondary">
            <CircleCheck className="size-4 text-success-600" aria-hidden />
            Everything looks good.
          </p>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {attention.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md",
                    item.tone === "danger"
                      ? "bg-danger-50 text-danger-600"
                      : item.tone === "warning"
                        ? "bg-warning-50 text-warning-600"
                        : "bg-info-50 text-info-600",
                  )}
                >
                  <TriangleAlert className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold text-content">{item.title}</p>
                  <p className="text-[11.5px] text-content-muted">{item.detail}</p>
                </div>
                {item.action && (
                  <Link
                    href={item.action.href}
                    className="shrink-0 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-hover"
                  >
                    {item.action.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------------- pieces */

function Panel({
  icon: Icon,
  title,
  description,
  tone = "accent",
  aside,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  tone?: "accent" | "info" | "warning" | "purple";
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tones = {
    accent: "bg-success-50 text-success-600",
    info: "bg-info-50 text-info-600",
    warning: "bg-warning-50 text-warning-600",
    purple: "bg-purple-50 text-purple-600",
  } as const;

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tones[tone])}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[13.5px] font-semibold leading-tight text-content">{title}</h2>
            {description && (
              <p className="mt-0.5 text-[12px] leading-snug text-content-muted">
                {description}
              </p>
            )}
          </div>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  compact,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-success-50 text-success-600"
        >
          <Icon className="size-3.5" />
        </span>
        <p className="min-w-0 truncate text-[12px] text-content-muted">{label}</p>
      </div>
      <p
        className={cn(
          "mt-1.5 font-bold leading-tight text-content",
          compact ? "text-[15px]" : "text-[22px] tabular-nums",
        )}
      >
        {value}
      </p>
      {detail && (
        <p className="mt-0.5 text-[11.5px] leading-snug text-content-muted">{detail}</p>
      )}
    </div>
  );
}

/** The funnel. Bars sized against the first stage, labelled with real counts. */
function Funnel({
  stages,
}: {
  stages: { key: string; label: string; value: number; percent: number | null }[];
}) {
  const top = Math.max(...stages.map((stage) => stage.value), 1);
  const colours = [
    "bg-info-400",
    "bg-purple-400",
    "bg-purple-300",
    "bg-success-400",
    "bg-warning-400",
    "bg-success-500",
  ];

  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ minHeight: 150 }}>
      {stages.map((stage, index) => {
        const height = Math.max(4, Math.round((stage.value / top) * 96));
        return (
          <div key={stage.key} className="flex min-w-[64px] flex-1 flex-col items-center gap-1.5">
            <span className="text-[14px] font-bold leading-none tabular-nums text-content">
              {formatCount(stage.value)}
            </span>
            <span className="text-center text-[10.5px] leading-tight text-content-muted">
              {stage.label}
            </span>
            {stage.percent !== null && (
              <span className="text-[10.5px] leading-none tabular-nums text-content-subtle">
                {stage.percent.toFixed(1)}%
              </span>
            )}
            <div
              className={cn("w-full rounded-t-md", colours[index % colours.length])}
              style={{ height }}
              aria-hidden
            />
          </div>
        );
      })}
    </div>
  );
}

function ReplyBadge({ classification }: { classification: string | null }) {
  if (!classification) return <Badge tone="neutral" dense>Unclassified</Badge>;

  const map: Record<string, { label: string; tone: "success" | "info" | "danger" | "warning" | "neutral" }> = {
    POSITIVE_INTEREST: { label: "Positive", tone: "success" },
    NEUTRAL_QUESTION: { label: "Question", tone: "info" },
    OBJECTION: { label: "Objection", tone: "warning" },
    NOT_NOW: { label: "Not interested", tone: "danger" },
    UNSUBSCRIBE: { label: "Unsubscribed", tone: "danger" },
    COMPLAINT: { label: "Complaint", tone: "danger" },
    HUMAN_REQUEST: { label: "Human request", tone: "warning" },
    WRONG_PERSON: { label: "Wrong person", tone: "neutral" },
  };

  const entry = map[classification] ?? { label: "Unclassified", tone: "neutral" as const };
  return (
    <Badge tone={entry.tone} dense>
      {entry.label}
    </Badge>
  );
}

/** Guidance, never a hidden action. Nothing here happens on its own. */
function nextSteps(data: CampaignOverview): { label: string; done: boolean }[] {
  const running = data.header.status === "ACTIVE" || data.header.status === "OPTIMIZING";

  return [
    { label: "Campaign is live and sending", done: running },
    { label: "Monitor replies and qualify prospects", done: data.kpis.replies > 0 },
    {
      label: "Review and adjust based on performance",
      done: data.kpis.qualified > 0,
    },
    { label: "Consider expanding to nearby locations", done: false },
  ];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function relative(value: string): string {
  const diff = Date.now() - Date.parse(value);
  const hours = Math.round(diff / 3600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export { Panel };
