import * as React from "react";
import Link from "next/link";
import {
  Activity,
  CircleDollarSign,
  Clock,
  Mail,
  MessageSquare,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatCount, formatMoneyMinor, stepTiming, stepTitle } from "@/lib/outreach/campaign-draft";
import { gradeTone } from "@/lib/prospects/types";
import type {
  AudienceFilter,
  CampaignActivityEntry,
  CampaignAudienceRow,
  CampaignPerformanceView,
  CampaignSequenceView,
} from "@/lib/outreach/campaigns/detail";
import { Panel } from "./overview";
import { PerformanceChart } from "./performance-chart";

/* ---------------------------------------------------------------- audience */

const FILTERS: { key: AudienceFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "contacted", label: "Contacted" },
  { key: "replied", label: "Replied" },
  { key: "review", label: "Review" },
  { key: "suppressed", label: "Suppressed" },
  { key: "promoted", label: "Promoted" },
];

/**
 * The campaign's audience.
 *
 * A prospect is never removed from this list once they have been part of the
 * campaign — historical participation is what makes the funnel reconcilable.
 * "Remove from future sending" stops the sequence; it does not delete the row.
 */
export function CampaignAudienceTab({
  campaignId,
  filter,
  rows,
  total,
}: {
  campaignId: string;
  filter: AudienceFilter;
  rows: CampaignAudienceRow[];
  total: number;
}) {
  return (
    <Panel
      icon={Users}
      title="Campaign audience"
      description={`${formatCount(total)} prospect${total === 1 ? "" : "s"} in this campaign.`}
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((option) => (
          <Link
            key={option.key}
            href={`/app/find-leads/campaigns/${campaignId}?view=audience&filter=${option.key}`}
            aria-current={filter === option.key ? "true" : undefined}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors",
              filter === option.key
                ? "border-success-600 bg-success-50 text-success-700"
                : "border-line-strong bg-surface text-content-secondary hover:bg-surface-hover",
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nothing in this view"
          description="No prospects in this campaign match that filter yet."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prospect</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Eligibility</TableHead>
                <TableHead>Send state</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.prospectId}>
                  <TableCell>
                    <Link
                      href={`/app/find-leads?view=prospects&prospect=${row.prospectId}`}
                      className="font-medium text-content underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <span className="block text-[11.5px] text-content-muted">
                      {row.company ?? "Unknown company"}
                    </span>
                  </TableCell>
                  <TableCell className="text-content-secondary">{row.role ?? "—"}</TableCell>
                  <TableCell>
                    {row.grade ? (
                      <Badge tone={gradeTone(row.grade)} dense>
                        {row.grade}
                        {row.score !== null && ` · ${Math.round(row.score)}`}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      tone={
                        row.eligibility === "ELIGIBLE"
                          ? "success"
                          : row.eligibility === "SUPPRESSED"
                            ? "danger"
                            : "warning"
                      }
                      dense
                    >
                      {row.eligibility.toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-content-secondary">{sendStateLabel(row.sendState)}</TableCell>
                  <TableCell className="tabular-nums text-content-secondary">{row.stepsSent}</TableCell>
                  <TableCell>
                    {row.promotedLeadId ? (
                      <Link
                        href={`/app/leads/${row.promotedLeadId}`}
                        className="text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
                      >
                        Promoted to lead
                      </Link>
                    ) : (
                      <span className="text-content-muted">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

function sendStateLabel(state: string): string {
  const map: Record<string, string> = {
    NOT_ENROLLED: "Not enrolled",
    PENDING: "Waiting",
    SCHEDULED: "Scheduled",
    ACTIVE: "Sending",
    REPLIED: "Replied",
    STOPPED: "Stopped",
    BOUNCED: "Bounced",
    SUPPRESSED: "Suppressed",
    COMPLETED: "Finished",
    FAILED: "Failed",
  };
  return map[state] ?? state;
}

/* ---------------------------------------------------------------- sequence */

/**
 * The sequence as it is currently published.
 *
 * A running campaign shows its content read-only. Editing a published step
 * would rewrite messages that have already been sent, so changes create a new
 * version instead — which is a wizard action, not an inline edit here.
 */
export function CampaignSequenceTab({
  sequence,
}: {
  sequence: CampaignSequenceView | null;
}) {
  if (!sequence) {
    return (
      <Panel icon={Mail} title="Email sequence">
        <EmptyState
          icon={Mail}
          title="No sequence yet"
          description="This campaign has no published email sequence."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel
        icon={Mail}
        title="Email sequence"
        description={`Version ${sequence.version} · ${sequence.status.toLowerCase()}`}
        aside={
          sequence.frozen ? (
            <Badge tone="neutral">Frozen while sending</Badge>
          ) : (
            <Badge tone="accent">Editable</Badge>
          )
        }
      >
        {sequence.frozen && (
          <p className="mb-3 rounded-lg border border-info-100 bg-info-50 px-3.5 py-2.5 text-[12px] leading-snug text-content-secondary">
            This campaign is sending, so its published steps are read-only. Changing the
            wording now would rewrite messages people have already received. Duplicate the
            campaign to try different copy.
          </p>
        )}

        <ol className="space-y-3">
          {sequence.steps.map((step) => (
            <li key={step.position} className="rounded-lg border border-line bg-surface p-3.5">
              <div className="flex flex-wrap items-start gap-3">
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-[12.5px] font-semibold tabular-nums text-content"
                >
                  {step.position}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13px] font-semibold text-content">
                      {stepTitle(step.position)}
                    </p>
                    <span className="text-[11.5px] text-content-muted">
                      {stepTiming(step.delayDays)}
                    </span>
                    {!step.enabled && <Badge tone="neutral" dense>Disabled</Badge>}
                  </div>
                  <p className="mt-1 text-[12.5px] font-medium text-content">
                    {step.subject ?? "No subject"}
                  </p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] leading-snug text-content-secondary">
                    {step.body}
                  </p>
                </div>
                <dl className="flex shrink-0 gap-4 text-right">
                  <div>
                    <dd className="text-[15px] font-semibold tabular-nums text-content">
                      {formatCount(step.sent)}
                    </dd>
                    <dt className="text-[11px] text-content-muted">Sent</dt>
                  </div>
                  <div>
                    <dd className="text-[15px] font-semibold tabular-nums text-content">
                      {formatCount(step.replies)}
                    </dd>
                    <dt className="text-[11px] text-content-muted">Replies</dt>
                  </div>
                </dl>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      {sequence.variants.length > 0 && (
        <Panel icon={MessageSquare} title="Variant performance" tone="purple">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variant</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Allocation</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Replies</TableHead>
                  <TableHead>Positive</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sequence.variants.map((variant) => (
                  <TableRow key={`${variant.stepPosition}-${variant.label}`}>
                    <TableCell className="font-medium text-content">{variant.label}</TableCell>
                    <TableCell className="text-content-secondary">
                      {variant.stepPosition ?? "All"}
                    </TableCell>
                    <TableCell className="tabular-nums text-content-secondary">
                      {variant.allocationPercent}%
                    </TableCell>
                    <TableCell className="tabular-nums text-content-secondary">
                      {formatCount(variant.sent)}
                    </TableCell>
                    <TableCell className="tabular-nums text-content-secondary">
                      {formatCount(variant.replies)}
                    </TableCell>
                    <TableCell className="tabular-nums text-content-secondary">
                      {formatCount(variant.positiveReplies)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- performance */

export function CampaignPerformanceTab({
  performance,
}: {
  performance: CampaignPerformanceView | null;
}) {
  if (!performance) {
    return (
      <Panel icon={Activity} title="Performance">
        <EmptyState
          icon={Activity}
          title="No performance data yet"
          description="Figures appear once this campaign has started sending."
        />
      </Panel>
    );
  }

  const rows: { label: string; value: string; hint?: string }[] = [
    { label: "Contacts sent", value: formatCount(performance.sent) },
    { label: "Delivered", value: formatCount(performance.delivered) },
    { label: "Bounced", value: formatCount(performance.bounced) },
    { label: "Replies", value: formatCount(performance.replies) },
    { label: "Positive replies", value: formatCount(performance.positiveReplies) },
    { label: "Promoted to leads", value: formatCount(performance.promoted) },
    { label: "Booked", value: formatCount(performance.booked) },
    { label: "Opt-outs", value: formatCount(performance.optOuts) },
    {
      label: "Conversion rate",
      value:
        performance.conversionRate === null
          ? "—"
          : `${(performance.conversionRate * 100).toFixed(1)}%`,
      hint: "Prospects promoted to leads, over prospects contacted.",
    },
  ];

  return (
    <div className="space-y-4">
      <Panel
        icon={Activity}
        title="Performance"
        description="Delivery, engagement and outcomes for this campaign."
        tone="info"
      >
        <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {rows.map((row) => (
            <div key={row.label} className="rounded-lg border border-line bg-surface p-3">
              <dd className="text-[18px] font-semibold leading-none tabular-nums text-content">
                {row.value}
              </dd>
              <dt className="mt-1 text-[11.5px] text-content-muted">{row.label}</dt>
            </div>
          ))}
        </dl>

        <div className="mt-4">
          <PerformanceChart series={performance.series} />
        </div>
      </Panel>

      <Panel
        icon={CircleDollarSign}
        title="Cost"
        description="What this campaign has spent, and what each outcome cost."
        tone="purple"
      >
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-surface p-3">
            <dd className="text-[18px] font-semibold leading-none tabular-nums text-content">
              {formatMoneyMinor(performance.budget.spentMinor)}
            </dd>
            <dt className="mt-1 text-[11.5px] text-content-muted">
              Spent of {formatMoneyMinor(performance.budget.capMinor)}
            </dt>
          </div>
          <div className="rounded-lg border border-line bg-surface p-3">
            <dd className="text-[18px] font-semibold leading-none tabular-nums text-content">
              {performance.costPerReplyMinor === null
                ? "—"
                : formatMoneyMinor(performance.costPerReplyMinor)}
            </dd>
            <dt className="mt-1 text-[11.5px] text-content-muted">Cost per reply</dt>
          </div>
          <div className="rounded-lg border border-line bg-surface p-3">
            <dd className="text-[18px] font-semibold leading-none tabular-nums text-content">
              {performance.costPerQualifiedMinor === null
                ? "—"
                : formatMoneyMinor(performance.costPerQualifiedMinor)}
            </dd>
            <dt className="mt-1 text-[11.5px] text-content-muted">Cost per qualified lead</dt>
          </div>
        </dl>
        {/* Null, not zero: dividing by nothing is unknown, and "£0 per reply"
            on a campaign with no replies reads as a bargain. */}
        <p className="mt-2 text-[11.5px] text-content-muted">
          Cost per outcome is shown once there is at least one of that outcome.
        </p>
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- activity */

export function CampaignActivityTab({
  entries,
}: {
  entries: CampaignActivityEntry[];
}) {
  return (
    <Panel
      icon={Clock}
      title="Activity"
      description="Everything that has happened to this campaign."
    >
      {entries.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Nothing recorded yet"
          description="Campaign events appear here as they happen."
        />
      ) : (
        <ol className="space-y-0">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex gap-3 border-b border-line-subtle py-3 last:border-0"
            >
              <span
                aria-hidden
                className={cn(
                  "mt-1 size-2 shrink-0 rounded-full",
                  entry.actorType === "OPTIMIZATION"
                    ? "bg-purple-500"
                    : entry.actorType === "SYSTEM"
                      ? "bg-info-500"
                      : "bg-success-500",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-content">
                  {entry.summary ?? humanise(entry.eventType)}
                </p>
                <p className="mt-0.5 text-[11.5px] text-content-muted">
                  {entry.actorName ??
                    (entry.actorType === "OPTIMIZATION" ? "Auto optimise" : "System")}
                  {" · "}
                  {new Date(entry.createdAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {entry.fromStatus && entry.toStatus && (
                    <>
                      {" · "}
                      {entry.fromStatus.toLowerCase()} → {entry.toStatus.toLowerCase()}
                    </>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function humanise(eventType: string): string {
  return eventType.charAt(0) + eventType.slice(1).toLowerCase().replace(/_/g, " ");
}
