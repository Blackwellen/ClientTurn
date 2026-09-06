"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  CircleAlert,
  Coins,
  Mail,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Search,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown";
import { EmptyState, PlanLimitState } from "@/components/ui/feedback";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { shortAgo } from "@/lib/prospects/activity";
import {
  CAMPAIGN_STATUSES,
  campaignStatusLabel,
  campaignStatusTone,
  complianceSummary,
  formatRate,
  isSpendingStatus,
  launchBlockers,
  priorityLabel,
  priorityTone,
  type CampaignListData,
  type CampaignRow,
  type CampaignStatus,
} from "@/lib/outreach/types";
import { CampaignBuilder } from "./campaign-builder";
import { CampaignControls } from "./campaign-controls";

/**
 * The acquisition Campaigns view (V4 §16).
 *
 * Purpose-built rather than a generic workflow builder: a campaign is an
 * audience, a goal, a bounded sequence and a budget, and §16.9 is explicit that
 * exposing arbitrary node graphs is not what this is. Everything a row can do
 * is one of seven states, and the state machine lives on the server.
 *
 * Two things this page insists on saying. First, for anything not running, why
 * — a campaign stuck in DRAFT because no sender is attached is the most common
 * state here, and it must read as a blocked campaign, not an empty one. Second,
 * budget as a proportion rather than an amount: provider spend is admin-only
 * (§90), and "42% of your cap" answers "can this keep running" without crossing
 * that line.
 *
 * Filtering is client-side, and deliberately: a workspace has tens of
 * campaigns, not tens of thousands, and they are all already loaded for the
 * rollup cards.
 */

type SortKey = "updated" | "name" | "status" | "budget";

export function CampaignsView({
  data,
  canManage,
}: {
  data: CampaignListData;
  canManage: boolean;
}) {
  const { campaigns, unassignedReady, hasSender, senders, mailboxConnected } = data;

  const [search, setSearch] = React.useState("");
  const [statuses, setStatuses] = React.useState<CampaignStatus[]>([]);
  const [goals, setGoals] = React.useState<string[]>([]);
  const [sort, setSort] = React.useState<SortKey>("updated");

  const goalOptions = React.useMemo(
    () =>
      [...new Set(campaigns.map((c) => c.conversionGoalName).filter((v): v is string => Boolean(v)))].sort(),
    [campaigns],
  );

  const visible = React.useMemo(() => {
    const term = search.trim().toLowerCase();

    const filtered = campaigns.filter((campaign) => {
      if (statuses.length > 0 && !statuses.includes(campaign.status)) return false;
      if (goals.length > 0 && !goals.includes(campaign.conversionGoalName ?? "")) return false;
      if (!term) return true;
      return [campaign.name, campaign.description, campaign.audience.segment]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term));
    });

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name, "en-GB");
        case "status":
          return CAMPAIGN_STATUSES.indexOf(a.status) - CAMPAIGN_STATUSES.indexOf(b.status);
        case "budget":
          return (b.budgetPercent ?? -1) - (a.budgetPercent ?? -1);
        default:
          return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
      }
    });
  }, [campaigns, search, statuses, goals, sort]);

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <CampaignKpiStrip data={data} />

        {!hasSender && (
          <PlanLimitState
            title="No verified sending identity"
            description="Cold email needs a connected mailbox with a verified sender before any campaign can run. Nothing will be sent until one exists."
            action={
              <Link
                href="/app/settings?view=connections"
                className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
              >
                Connect a mailbox
              </Link>
            }
          />
        )}

        {unassignedReady > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-200/60 bg-accent-50/40 px-4 py-3">
            <p className="text-[12.5px] text-content-secondary">
              <strong className="font-semibold text-content">
                {unassignedReady.toLocaleString("en-GB")}
              </strong>{" "}
              approved prospect{unassignedReady === 1 ? "" : "s"} are not in a campaign yet.
            </p>
            <Link
              href="/app/find-leads?view=prospects&quick=ready"
              className="text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
            >
              Review them
            </Link>
          </div>
        )}

        <Toolbar
          search={search}
          onSearch={setSearch}
          statuses={statuses}
          onStatuses={setStatuses}
          goals={goals}
          goalOptions={goalOptions}
          onGoals={setGoals}
          sort={sort}
          onSort={setSort}
          builder={
            <CampaignBuilder
              senders={senders}
              mailboxConnected={mailboxConnected}
              canManage={canManage}
            />
          }
        />

        {campaigns.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface">
            <EmptyState
              icon={Megaphone}
              title="No campaigns yet"
              description="A campaign takes approved prospects and works a permitted email sequence, with daily caps and contact rules enforced on every send."
            />
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface">
            <EmptyState
              icon={Search}
              title="No campaigns match these filters"
              description="Try clearing the status or goal filter."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setStatuses([]);
                    setGoals([]);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          </div>
        ) : (
          <CampaignTable campaigns={visible} total={campaigns.length} canManage={canManage} />
        )}

        <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-sunken/50 px-4 py-3 text-[12px] text-content-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-content-accent" aria-hidden />
          <span>
            Cold outreach is email only. SMS, WhatsApp and social are blocked for cold contact
            by the policy pack for each country, and cannot be enabled from here. Warm leads
            who reply move to Follow-Up, where the other channels are available.
          </span>
        </p>
      </div>

      <aside className="space-y-4">
        <PerformanceCard data={data} />
        <UpcomingSendsCard data={data} />
        <BudgetAllocationCard campaigns={campaigns} />
        <ComplianceCard data={data} />
      </aside>
    </div>
  );
}

/* --------------------------------------------------------------------- kpis */

function CampaignKpiStrip({ data }: { data: CampaignListData }) {
  const { campaigns, performance } = data;

  const active = campaigns.filter((c) => isSpendingStatus(c.status)).length;
  const inOutreach = campaigns.reduce((sum, c) => sum + c.funnel.contacted, 0);
  const replies = campaigns.reduce((sum, c) => sum + c.funnel.replies, 0);
  const qualified = campaigns.reduce((sum, c) => sum + c.funnel.promoted, 0);

  // Budget is a proportion of the caps that exist, never an amount: the money
  // columns are withheld from the browser role, and a mean of percentages is
  // what the server can honestly supply.
  const capped = campaigns.filter((c) => c.hasBudgetCap && c.budgetPercent !== null);
  const budgetPercent =
    capped.length > 0
      ? Math.round(
          capped.reduce((sum, c) => sum + (c.budgetPercent ?? 0), 0) / capped.length,
        )
      : null;

  const cards = [
    { key: "active", icon: Megaphone, label: "Active campaigns", value: String(active) },
    {
      key: "outreach",
      icon: Users,
      label: "Prospects in outreach",
      value: inOutreach.toLocaleString("en-GB"),
    },
    {
      key: "replies",
      icon: MessageSquare,
      label: "Replies",
      value: replies.toLocaleString("en-GB"),
    },
    {
      key: "qualified",
      icon: UserCheck,
      label: "Qualified",
      value: qualified.toLocaleString("en-GB"),
    },
    {
      key: "budget",
      icon: Coins,
      label: "Budget used this month",
      value: budgetPercent === null ? "No cap set" : `${budgetPercent}%`,
      trend:
        performance.qualifiedTrend !== null && budgetPercent !== null
          ? null
          : null,
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
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ toolbar */

function Toolbar({
  search,
  onSearch,
  statuses,
  onStatuses,
  goals,
  goalOptions,
  onGoals,
  sort,
  onSort,
  builder,
}: {
  search: string;
  onSearch: (value: string) => void;
  statuses: CampaignStatus[];
  onStatuses: (value: CampaignStatus[]) => void;
  goals: string[];
  goalOptions: string[];
  onGoals: (value: string[]) => void;
  sort: SortKey;
  onSort: (value: SortKey) => void;
  builder: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 shadow-xs">
      <div className="relative min-w-[200px] flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search campaigns..."
          aria-label="Search campaigns"
          className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[13px] text-content placeholder:text-content-subtle focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-content-accent"
        />
      </div>

      <ChipSelect
        label="Status"
        options={CAMPAIGN_STATUSES.map((status) => ({
          value: status,
          label: campaignStatusLabel(status),
        }))}
        selected={statuses}
        onToggle={(value) =>
          onStatuses(
            statuses.includes(value as CampaignStatus)
              ? statuses.filter((s) => s !== value)
              : [...statuses, value as CampaignStatus],
          )
        }
      />

      <ChipSelect
        label="Goal"
        options={goalOptions.map((goal) => ({ value: goal, label: goal }))}
        selected={goals}
        onToggle={(value) =>
          onGoals(goals.includes(value) ? goals.filter((g) => g !== value) : [...goals, value])
        }
      />

      {/* Channel is shown rather than offered: cold outreach is email-only by
          policy, so a channel filter with one value would be a control that
          cannot do anything. */}
      <Tooltip content="Cold acquisition campaigns are email only, by policy.">
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-sunken/60 px-3 text-[12.5px] font-medium text-content-subtle">
          <Mail className="size-3.5" aria-hidden />
          Email
        </span>
      </Tooltip>

      <ChipSelect
        label="Sort"
        single
        options={[
          { value: "updated", label: "Last updated" },
          { value: "name", label: "Name" },
          { value: "status", label: "Status" },
          { value: "budget", label: "Budget used" },
        ]}
        selected={[sort]}
        onToggle={(value) => onSort(value as SortKey)}
      />

      <div className="ml-auto">{builder}</div>
    </div>
  );
}

function ChipSelect({
  label,
  options,
  selected,
  onToggle,
  single,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  single?: boolean;
}) {
  const active = single ? false : selected.length > 0;
  const summary = single
    ? (options.find((o) => o.value === selected[0])?.label ?? "")
    : selected.length === 1
      ? (options.find((o) => o.value === selected[0])?.label ?? "")
      : selected.length > 1
        ? `${selected.length} selected`
        : "";

  if (options.length === 0) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-8 cursor-not-allowed items-center rounded-lg border border-line bg-surface-sunken/60 px-3 text-[12.5px] font-medium text-content-subtle"
      >
        {label}
      </button>
    );
  }

  return (
    <Popover
      label={label}
      trigger={
        <button
          type="button"
          className={cn(
            "inline-flex h-8 max-w-[14rem] items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent",
            active
              ? "border-accent-500 bg-accent-50 text-content-accent"
              : "border-line bg-surface text-content-secondary hover:bg-surface-hover hover:text-content",
          )}
        >
          <span className="truncate">
            {label}
            {summary && <span className="font-normal opacity-80">: {summary}</span>}
          </span>
        </button>
      }
    >
      {(close) => (
        <div className="min-w-[12rem] py-1">
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role={single ? undefined : "checkbox"}
                aria-checked={single ? undefined : checked}
                aria-current={single && checked ? "true" : undefined}
                onClick={() => {
                  onToggle(option.value);
                  if (single) close();
                }}
                className={cn(
                  "block w-full px-3 py-1.5 text-left text-[12.5px] transition-colors",
                  checked
                    ? "font-medium text-content-accent"
                    : "text-content-secondary hover:bg-surface-hover",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

/* -------------------------------------------------------------------- table */

function CampaignTable({
  campaigns,
  total,
  canManage,
}: {
  campaigns: CampaignRow[];
  total: number;
  canManage: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse">
          <caption className="sr-only">Acquisition campaigns</caption>
          <thead>
            <tr className="border-b border-line bg-surface-sunken/60">
              <Th>Campaign</Th>
              <Th>Audience / target</Th>
              <Th>Objective</Th>
              <Th>Budget usage</Th>
              <Th>Mini funnel</Th>
              <Th>Status</Th>
              <Th>Updated</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <CampaignRowView
                key={campaign.id}
                campaign={campaign}
                canManage={canManage}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-line-subtle px-4 py-3 text-[12.5px] text-content-muted">
        Showing {campaigns.length} of {total} campaign{total === 1 ? "" : "s"}
      </p>
    </section>
  );
}

function CampaignRowView({
  campaign,
  canManage,
}: {
  campaign: CampaignRow;
  canManage: boolean;
}) {
  const blockers = launchBlockers(campaign);
  const audience = campaign.audience;

  return (
    <tr className="border-b border-line-subtle align-top last:border-0">
      <Td>
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-content-accent"
            aria-hidden
          >
            <Megaphone className="size-3.5" />
          </span>
          <div className="min-w-0 max-w-[15rem]">
            <p className="text-[12.5px] font-semibold text-content">{campaign.name}</p>
            {campaign.description && (
              <p className="mt-0.5 text-[11.5px] text-content-muted">
                {campaign.description}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Tooltip content="Priority decides queue order and how contested send capacity is shared. It can never override suppression, contactability or a provider ceiling.">
                <Badge tone={priorityTone(campaign.priority)} dense>
                  {priorityLabel(campaign.priority)}
                </Badge>
              </Tooltip>
              {campaign.autoOptimize && (
                <Tooltip content="Bounded optimisation is on: send times and message variants may change within your limits. It can never raise spend or weaken contact rules.">
                  <Badge tone="purple" dense>
                    auto-optimise
                  </Badge>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </Td>

      <Td>
        <div className="max-w-[11rem]">
          <p className="text-[12px] text-content-secondary">
            {audience.segment ?? campaign.icpProfileName ?? "No audience set"}
          </p>
          {audience.locations.length > 0 && (
            <p className="mt-0.5 text-[11.5px] text-content-muted">
              {audience.locations.join(", ")}
            </p>
          )}
          {audience.radiusMiles !== null && (
            <p className="text-[11.5px] text-content-muted">
              + {audience.radiusMiles} miles
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-content-subtle">
            Grade {campaign.minimumGrade} and above
          </p>
        </div>
      </Td>

      <Td>
        <p className="max-w-[9rem] text-[12px] text-content-secondary">
          {campaign.conversionGoalName ?? "No goal set"}
        </p>
      </Td>

      <Td>
        <BudgetUsage campaign={campaign} />
      </Td>

      <Td>
        <MiniFunnel campaign={campaign} />
      </Td>

      <Td>
        <Badge tone={campaignStatusTone(campaign.status)} dot>
          {campaignStatusLabel(campaign.status)}
        </Badge>
        {blockers.length > 0 && campaign.status === "DRAFT" && (
          <Tooltip content={blockers.join(" ")}>
            <span className="mt-1 flex items-center gap-1 text-[11px] text-warning-700">
              <CircleAlert className="size-3" aria-hidden />
              {blockers.length} blocker{blockers.length === 1 ? "" : "s"}
            </span>
          </Tooltip>
        )}
      </Td>

      <Td>
        <span className="text-[11.5px] text-content-muted">
          {campaign.updatedAt ? shortAgo(campaign.updatedAt) : "—"}
        </span>
      </Td>

      <Td align="right">
        <div className="flex items-center justify-end gap-1">
          {blockers.length === 0 && (
            <CampaignControls campaign={campaign} canManage={canManage} />
          )}
          <DropdownMenu
            trigger={
              <button
                type="button"
                aria-label={`More actions for ${campaign.name}`}
                className="inline-flex size-7 items-center justify-center rounded-md text-content-subtle transition-colors hover:bg-surface-hover hover:text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            }
          >
            <DropdownItem
              onSelect={() =>
                window.location.assign(
                  `/app/find-leads?view=prospects&campaign=${campaign.id}`,
                )
              }
            >
              View prospects in this campaign
            </DropdownItem>
          </DropdownMenu>
        </div>
      </Td>
    </tr>
  );
}

/**
 * Budget as a proportion.
 *
 * There is no monetary figure here on purpose: the amount columns are revoked
 * from the browser role (0041), and the ratio is what actually answers the
 * question the bar is asked — is this campaign about to stop.
 */
function BudgetUsage({ campaign }: { campaign: CampaignRow }) {
  if (!campaign.hasBudgetCap || campaign.budgetPercent === null) {
    return (
      <Tooltip content="No spend cap is set for this campaign. Your workspace and plan ceilings still apply.">
        <span className="text-[11.5px] text-content-subtle">No cap</span>
      </Tooltip>
    );
  }

  const full = campaign.budgetPercent >= 100;
  const near = campaign.budgetPercent >= 80;

  return (
    <div className="w-[104px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] text-content-muted">of cap</span>
        <span
          className={cn(
            "text-[12px] font-semibold tabular-nums",
            full ? "text-danger-600" : near ? "text-warning-700" : "text-content",
          )}
        >
          {campaign.budgetPercent}%
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={campaign.budgetPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${campaign.name} budget used`}
      >
        <div
          className={cn(
            "h-full rounded-full",
            full ? "bg-danger-500" : near ? "bg-warning-500" : "bg-accent-500",
          )}
          style={{ width: `${campaign.budgetPercent}%` }}
        />
      </div>
    </div>
  );
}

/** Sent → Reply → Qualified → Booked, as four compact bars scaled to the widest
 *  stage so the drop-off is visible at a glance. */
function MiniFunnel({ campaign }: { campaign: CampaignRow }) {
  const { funnel } = campaign;
  const stages = [
    { key: "sent", label: "Sent", value: funnel.contacted, tone: "bg-info-500" },
    { key: "reply", label: "Reply", value: funnel.replies, tone: "bg-accent-500" },
    { key: "qual", label: "Qual", value: funnel.positiveReplies, tone: "bg-warning-500" },
    { key: "booked", label: "Booked", value: funnel.promoted, tone: "bg-success-500" },
  ];
  const max = Math.max(...stages.map((stage) => stage.value), 1);

  return (
    <div className="flex items-end gap-2.5">
      {stages.map((stage) => (
        <div key={stage.key} className="w-9 text-center">
          <p className="text-[11.5px] font-semibold tabular-nums text-content">
            {stage.value.toLocaleString("en-GB")}
          </p>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className={cn("h-full rounded-full", stage.tone)}
              style={{ width: `${Math.round((stage.value / max) * 100)}%` }}
            />
          </div>
          <p className="mt-0.5 text-[10px] text-content-subtle">{stage.label}</p>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- right rail */

function RailCard({
  icon: Icon,
  title,
  subtitle,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13.5px] font-semibold text-content">
          <Icon className="size-4 shrink-0 text-content-accent" aria-hidden />
          {title}
          {subtitle && (
            <span className="font-normal text-content-muted">{subtitle}</span>
          )}
        </h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PerformanceCard({ data }: { data: CampaignListData }) {
  const { performance } = data;

  const rows = [
    { label: "Prospects contacted", value: performance.contacted.toLocaleString("en-GB") },
    { label: "Replies", value: performance.replies.toLocaleString("en-GB") },
    { label: "Qualified leads", value: performance.qualified.toLocaleString("en-GB") },
    { label: "Conversion rate", value: formatRate(performance.conversionRate) },
  ];

  return (
    <RailCard icon={BarChart3} title="Campaign performance" subtitle="Last 30 days">
      <dl className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-[12.5px] text-content-secondary">{row.label}</dt>
            <dd className="text-[13px] font-semibold tabular-nums text-content">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {performance.qualifiedTrend !== null && (
        <div
          className={cn(
            "mt-3 flex items-start gap-2.5 rounded-lg border px-3 py-2.5",
            performance.qualifiedTrend >= 0
              ? "border-success-100 bg-success-50/60"
              : "border-warning-100 bg-warning-50/60",
          )}
        >
          <TrendingUp
            className={cn(
              "mt-0.5 size-4 shrink-0",
              performance.qualifiedTrend >= 0
                ? "text-success-600"
                : "rotate-180 text-warning-600",
            )}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold tabular-nums text-content">
              {performance.qualifiedTrend >= 0 ? "+" : ""}
              {Math.round(performance.qualifiedTrend * 100)}%
            </p>
            <p className="text-[11.5px] text-content-muted">
              {performance.qualifiedTrend >= 0 ? "More" : "Fewer"} qualified leads vs
              previous 30 days.
            </p>
          </div>
        </div>
      )}
    </RailCard>
  );
}

function UpcomingSendsCard({ data }: { data: CampaignListData }) {
  const { upcomingSends } = data;

  return (
    <RailCard
      icon={CalendarClock}
      title="Upcoming sends"
      action={
        <Link
          href="/app/find-leads?view=prospects&quick=ready"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-content-accent underline-offset-4 hover:underline"
        >
          View all
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      }
    >
      {upcomingSends.length === 0 ? (
        <p className="text-[12.5px] text-content-muted">
          Nothing is scheduled. Sends appear here once a campaign is running and has
          eligible prospects.
        </p>
      ) : (
        <ul className="space-y-3">
          {upcomingSends.map((send) => (
            <li key={send.campaignId} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="mt-1.5 size-2 shrink-0 rounded-full bg-accent-500"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-content">
                  {send.campaignName}
                </p>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[11.5px] text-content-muted">
                    {send.prospectCount.toLocaleString("en-GB")} prospect
                    {send.prospectCount === 1 ? "" : "s"}
                  </span>
                  <time
                    dateTime={send.dueAt}
                    className="text-[11.5px] text-content-secondary"
                  >
                    {formatDue(send.dueAt)}
                  </time>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

/** "Tomorrow, 9:00 AM" for the near term, an explicit date beyond it. */
function formatDue(value: string): string {
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return "—";

  const time = due.toLocaleTimeString("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(due) - startOfDay(new Date())) / 864e5);

  if (days <= 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  return `${due.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, ${time}`;
}

function BudgetAllocationCard({ campaigns }: { campaigns: CampaignRow[] }) {
  const active = campaigns
    .filter((campaign) => isSpendingStatus(campaign.status) && campaign.hasBudgetCap)
    .sort((a, b) => (b.budgetPercent ?? 0) - (a.budgetPercent ?? 0))
    .slice(0, 6);

  return (
    <RailCard
      icon={Coins}
      title="Budget allocation"
      subtitle="(active campaigns)"
    >
      {active.length === 0 ? (
        <p className="text-[12.5px] text-content-muted">
          No running campaign has a spend cap set. Your workspace and plan ceilings still
          apply to every send.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {active.map((campaign) => (
            <li key={campaign.id} className="flex items-center gap-2.5">
              <span className="w-[7.5rem] shrink-0 truncate text-[12px] text-content-secondary">
                {campaign.name}
              </span>
              <span
                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken"
                role="progressbar"
                aria-valuenow={campaign.budgetPercent ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${campaign.name} budget used`}
              >
                <span
                  className={cn(
                    "block h-full rounded-full",
                    (campaign.budgetPercent ?? 0) >= 100
                      ? "bg-danger-500"
                      : (campaign.budgetPercent ?? 0) >= 80
                        ? "bg-warning-500"
                        : "bg-accent-500",
                  )}
                  style={{ width: `${campaign.budgetPercent ?? 0}%` }}
                />
              </span>
              <span className="w-9 shrink-0 text-right text-[11.5px] tabular-nums text-content-muted">
                {campaign.budgetPercent}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

function ComplianceCard({ data }: { data: CampaignListData }) {
  const summary = complianceSummary(data);

  return (
    <RailCard icon={ShieldCheck} title="Compliance & review">
      <p className="text-[12px] text-content-muted">
        All campaigns are checked for data compliance and sending limits. New campaigns go
        through an automatic review before sending.
      </p>

      <div
        className={cn(
          "mt-3 flex items-start gap-2.5 rounded-lg border px-3 py-2.5",
          summary.ok
            ? "border-success-100 bg-success-50/60"
            : "border-warning-100 bg-warning-50/60",
        )}
      >
        {summary.ok ? (
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success-600" aria-hidden />
        ) : (
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-600" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-content">{summary.title}</p>
          <p className="mt-0.5 text-[11.5px] text-content-muted">{summary.detail}</p>
        </div>
      </div>
    </RailCard>
  );
}

/* ------------------------------------------------------------------ helpers */

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 text-[11.5px] font-medium text-content-muted",
        align === "right" ? "text-right" : "text-left",
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
  align?: "left" | "right";
}) {
  return (
    <td className={cn("px-4 py-3", align === "right" ? "text-right" : "text-left")}>
      {children}
    </td>
  );
}
