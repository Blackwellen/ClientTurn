import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarCheck,
  Flame,
  Gauge,
  Hourglass,
  MailWarning,
  MessageSquareReply,
  ShieldAlert,
  UserRoundCog,
} from "lucide-react";
import type {
  CardState,
  RevenueControlData,
} from "@/lib/dashboard/revenue-control";
import { formatSampledRate } from "@/lib/analytics/revenue-surfaces";
import { formatMetric } from "@/lib/analytics/v4-metrics";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/app/page-header";
import { cn } from "@/lib/cn";
import { formatInZone } from "@/lib/dates";

/**
 * The Dashboard's "Revenue control" section: what, today, stands between the
 * workspace's leads and revenue. One compact tile per question, then the
 * source-to-won funnel. Each tile carries its own unavailable state, so a
 * table this database does not have yet shows as such rather than as zero.
 */

type Tone = "neutral" | "success" | "warning" | "danger";

const TONE_RING: Record<Tone, string> = {
  neutral: "",
  success: "",
  warning: "border-warning-100",
  danger: "border-danger-100",
};

const TONE_ICON: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-content-muted",
  success: "bg-success-50 text-success-600",
  warning: "bg-warning-50 text-warning-600",
  danger: "bg-danger-50 text-danger-600",
};

function Tile({
  icon: Icon,
  label,
  value,
  detail,
  href,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  href?: string;
  tone?: Tone;
}) {
  const body = (
    <div
      className={cn(
        "flex h-full min-w-0 items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-xs",
        TONE_RING[tone],
        href && "transition-colors hover:bg-surface-hover",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          TONE_ICON[tone],
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-content-muted text-[12px] font-medium">{label}</p>
        <p className="lr-tabular text-content mt-0.5 text-[18px] leading-6 font-semibold">
          {value}
        </p>
        <p className="text-content-subtle mt-0.5 line-clamp-2 text-[11.5px] leading-snug">
          {detail}
        </p>
      </div>
    </div>
  );
  if (!href) return body;
  return (
    <Link
      href={href}
      className="focus-visible:outline-content-accent block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {body}
    </Link>
  );
}

function Unavailable({
  icon,
  label,
  state,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  state: Extract<CardState<unknown>, { status: "unavailable" }>;
}) {
  return <Tile icon={icon} label={label} value="—" detail={state.message} />;
}

const count = (n: number) => n.toLocaleString("en-GB");
const gbp = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);

export function RevenueControlSection({ data }: { data: RevenueControlData }) {
  const {
    hotNotContacted: hot,
    unansweredReplies: unanswered,
    bookingReady,
    stalledOpportunities: stalled,
    aiEscalations: escalations,
    deliverability,
    aiBudget: budget,
    compliance,
  } = data;

  return (
    <section aria-labelledby="revenue-control-title" className="space-y-3" data-tour="dashboard-revenue-control">
      <div id="revenue-control-title">
        <SectionHeader
          title="Revenue control"
          description="What stands between today's leads and revenue. Current state, not the selected range, except the funnel."
          icon={Gauge}
          dense
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {hot.status === "ok" ? (
          <Tile
            icon={Flame}
            label="Hot leads not contacted"
            value={count(hot.data.count)}
            detail={
              hot.data.count === 0
                ? "Every A/B-graded lead has been messaged"
                : hot.data.examples.map((e) => e.name).join(", ")
            }
            href="/app/leads?tab=active"
            tone={hot.data.count > 0 ? "danger" : "success"}
          />
        ) : (
          <Unavailable
            icon={Flame}
            label="Hot leads not contacted"
            state={hot}
          />
        )}

        {unanswered.status === "ok" ? (
          <Tile
            icon={MessageSquareReply}
            label="Unanswered replies"
            value={count(unanswered.data.count)}
            detail={
              unanswered.data.oldestAt
                ? `Oldest waiting since ${formatInZone(unanswered.data.oldestAt, { day: "numeric", month: "short" })}`
                : "No lead is waiting on a reply"
            }
            href="/app/inbox"
            tone={unanswered.data.count > 0 ? "warning" : "success"}
          />
        ) : (
          <Unavailable
            icon={MessageSquareReply}
            label="Unanswered replies"
            state={unanswered}
          />
        )}

        {bookingReady.status === "ok" ? (
          <Tile
            icon={CalendarCheck}
            label="Booking-ready"
            value={count(bookingReady.data.count)}
            detail="Qualified, not yet booked"
            href="/app/leads?tab=qualified"
            tone={bookingReady.data.count > 0 ? "warning" : "neutral"}
          />
        ) : (
          <Unavailable
            icon={CalendarCheck}
            label="Booking-ready"
            state={bookingReady}
          />
        )}

        {stalled.status === "ok" ? (
          <Tile
            icon={Hourglass}
            label="Stalled opportunities"
            value={count(stalled.data.count)}
            detail={
              stalled.data.count === 0
                ? "No open deal idle for 7 days"
                : `${gbp(stalled.data.value)} open, idle 7+ days`
            }
            href="/app/leads"
            tone={stalled.data.count > 0 ? "warning" : "success"}
          />
        ) : (
          <Unavailable
            icon={Hourglass}
            label="Stalled opportunities"
            state={stalled}
          />
        )}

        {escalations.status === "ok" ? (
          <Tile
            icon={UserRoundCog}
            label="AI escalations"
            value={count(escalations.data.count)}
            detail={
              escalations.data.count === 0
                ? "Nothing handed to a person"
                : `${count(escalations.data.urgent)} high or urgent`
            }
            href="/app/leads?tab=attention"
            tone={
              escalations.data.urgent > 0
                ? "danger"
                : escalations.data.count > 0
                  ? "warning"
                  : "success"
            }
          />
        ) : (
          <Unavailable
            icon={UserRoundCog}
            label="AI escalations"
            state={escalations}
          />
        )}

        {deliverability.status === "ok" ? (
          deliverability.data.checked ? (
            <Tile
              icon={MailWarning}
              label="Deliverability"
              value={
                <StatusBadge
                  kind="deliverability"
                  value={deliverability.data.worst}
                />
              }
              detail={
                deliverability.data.attention.length
                  ? deliverability.data.attention.join(" · ")
                  : `${count(deliverability.data.domains)} ${deliverability.data.domains === 1 ? "domain" : "domains"} checked ${deliverability.data.latestDate}`
              }
              href="/app/settings?section=connections"
              tone={
                deliverability.data.worst === "HEALTHY"
                  ? "success"
                  : deliverability.data.worst === "WATCH"
                    ? "warning"
                    : "danger"
              }
            />
          ) : (
            <Tile
              icon={MailWarning}
              label="Deliverability"
              value={<StatusBadge kind="deliverability" value="NOT_CHECKED" />}
              detail={
                deliverability.data.mailboxes === 0
                  ? "No sending mailbox connected"
                  : "No domain health check in the last 7 days"
              }
              href="/app/settings?section=connections"
            />
          )
        ) : (
          <Unavailable
            icon={MailWarning}
            label="Deliverability"
            state={deliverability}
          />
        )}

        {budget.status === "ok" ? (
          <Tile
            icon={Gauge}
            label="AI budget this month"
            value={
              budget.data.ceilingGbp === null
                ? gbp(budget.data.spentGbp, 2)
                : `${gbp(budget.data.spentGbp, 2)} / ${gbp(
                    budget.data.ceilingGbp,
                    // A ceiling under a pound, or with pence, must not round to "£0".
                    Number.isInteger(budget.data.ceilingGbp) ? 0 : 2,
                  )}`
            }
            detail={
              budget.data.ceilingGbp === null
                ? "No monthly ceiling applies"
                : `${formatMetric(budget.data.spentGbp / budget.data.ceilingGbp, "percent")} of the ${budget.data.ceilingSource} ceiling`
            }
            tone={
              budget.data.ceilingGbp === null
                ? "neutral"
                : budget.data.spentGbp >= budget.data.ceilingGbp
                  ? "danger"
                  : budget.data.spentGbp >= budget.data.ceilingGbp * 0.8
                    ? "warning"
                    : "success"
            }
          />
        ) : (
          <Unavailable
            icon={Gauge}
            label="AI budget this month"
            state={budget}
          />
        )}

        {compliance.status === "ok" ? (
          <Tile
            icon={ShieldAlert}
            label="Compliance warnings"
            value={count(
              compliance.data.reviewContactability +
                compliance.data.openMergeCandidates,
            )}
            detail={`${count(compliance.data.reviewContactability)} contact checks need review · ${count(compliance.data.openMergeCandidates)} possible duplicates`}
            href="/app/settings?section=data-controls"
            tone={
              compliance.data.reviewContactability +
                compliance.data.openMergeCandidates >
              0
                ? "warning"
                : "success"
            }
          />
        ) : (
          <Unavailable
            icon={ShieldAlert}
            label="Compliance warnings"
            state={compliance}
          />
        )}
      </div>

      <RevenueFunnel state={data.funnel} />
    </section>
  );
}

function RevenueFunnel({ state }: { state: RevenueControlData["funnel"] }) {
  return (
    <Card>
      <CardHeader className="py-3">
        <div>
          <h3 className="text-content text-[14px] font-semibold">
            Source to won
          </h3>
          <p className="text-content-muted text-[12px]">
            Leads that arrived in the selected range, and how far each got. Step
            rates under 30 show their denominator.
          </p>
        </div>
      </CardHeader>
      <CardContent className="py-3">
        {state.status !== "ok" ? (
          <p className="text-content-muted flex items-center gap-2 text-[13px]">
            <AlertTriangle className="text-warning-600 size-4" aria-hidden />
            {state.message}
          </p>
        ) : state.data[0]?.count === 0 ? (
          <p className="text-content-muted text-[13px]">
            No leads arrived in this range.
          </p>
        ) : (
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {state.data.map((stage, index) => (
              <li
                key={stage.key}
                className="border-line-subtle min-w-0 rounded-lg border px-3 py-2"
              >
                <p className="text-content-muted text-[11.5px] font-medium">
                  {stage.label}
                </p>
                <p className="lr-tabular text-content text-[17px] font-semibold">
                  {stage.tracked ? count(stage.count) : "—"}
                </p>
                <p className="text-content-subtle flex flex-col items-start gap-0.5 text-[11px] leading-snug">
                  {index === 0 ? (
                    "Cohort"
                  ) : !stage.tracked ? (
                    "Not tracked"
                  ) : stage.step ? (
                    <>
                      <span>
                        <span className="lr-tabular whitespace-nowrap">
                          {formatSampledRate(stage.step)}
                        </span>{" "}
                        of previous
                      </span>
                      {stage.step.lowSample && (
                        <Badge
                          dense
                          tone="warning"
                          title="Fewer than 30 in the denominator"
                        >
                          small sample
                        </Badge>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
