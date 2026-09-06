import * as React from "react";
import { Activity, Mail, MessageCircle, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/app/page-header";
import { CHANNEL_LABEL, type Channel } from "@/lib/automations/types";
import type { FollowUpPerformance } from "@/lib/follow-up/performance";

const CHANNEL_ICON: Record<Channel, React.ComponentType<{ className?: string }>> = {
  sms: MessageSquare,
  whatsapp: MessageCircle,
  email: Mail,
};

const STOP_REASON_LABEL: Record<string, string> = {
  replied: "Lead replied",
  booked: "Lead booked",
  won: "Lead won",
  lost: "Lead lost",
  opted_out: "Lead opted out",
  human_takeover: "A person took over",
  paused: "Follow-up paused",
  subscription_inactive: "Subscription inactive",
  integration_unavailable: "Channel unavailable",
  suppressed: "Contact suppressed",
  invalid_number: "No usable contact details",
};

/**
 * How the sequence is actually doing (V4 §19.4).
 *
 * Every figure comes from `getFollowUpPerformance`, which counts only
 * automation-origin messages — a campaign send or a hand-typed reply can never
 * inflate these numbers, and neither can a test send.
 */
export function FollowUpPerformancePanel({
  performance,
}: {
  performance: FollowUpPerformance;
}) {
  if (performance.enrolled === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={Activity}
            title="No leads have entered the sequence yet"
            description={`Nothing has been enrolled in the last ${performance.windowDays} days, so there is nothing to measure.`}
          />
        </CardContent>
      </Card>
    );
  }

  const stats = [
    { label: "Leads enrolled", value: performance.enrolled },
    { label: "Completed the sequence", value: performance.completed },
    { label: "Stopped early", value: performance.stopped },
    { label: "Replied, booked or won", value: performance.positiveOutcomes },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b-0 px-5 pt-5 pb-0">
          <SectionHeader
            icon={Activity}
            tone="info"
            title="Follow-up performance"
            description={`Automation-origin sends over the last ${performance.windowDays} days.`}
          />
        </CardHeader>
        <CardContent className="px-5 pt-4 pb-5">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-line bg-surface-sunken/40 px-3.5 py-3"
              >
                <dt className="text-[12.5px] text-content-muted">{stat.label}</dt>
                <dd className="lr-tabular mt-1 text-[22px] font-semibold leading-none text-content">
                  {stat.value.toLocaleString("en-GB")}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b-0 px-5 pt-5 pb-0">
            <SectionHeader
              title="By channel"
              description="Messages sent by this sequence, and how they landed."
              dense
            />
          </CardHeader>
          <CardContent className="px-5 pt-3 pb-5">
            {performance.channels.length === 0 ? (
              <p className="text-[13px] text-content-muted">
                No messages sent in this window.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <caption className="sr-only">
                  Messages sent, delivered and failed per channel.
                </caption>
                <thead>
                  <tr className="border-b border-line-subtle text-left text-[12px] text-content-muted">
                    <th scope="col" className="pb-1.5 font-medium">
                      Channel
                    </th>
                    <th scope="col" className="pb-1.5 text-right font-medium">
                      Sent
                    </th>
                    <th scope="col" className="pb-1.5 text-right font-medium">
                      Delivered
                    </th>
                    <th scope="col" className="pb-1.5 text-right font-medium">
                      Delivery rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {performance.channels.map((row) => {
                    const Icon = CHANNEL_ICON[row.channel];
                    return (
                      <tr key={row.channel} className="border-b border-line-subtle last:border-0">
                        <th
                          scope="row"
                          className="py-2 text-left font-normal text-content"
                        >
                          <span className="inline-flex items-center gap-2">
                            <Icon
                              className="size-4 text-content-muted"
                              aria-hidden
                            />
                            {CHANNEL_LABEL[row.channel]}
                          </span>
                        </th>
                        <td className="lr-tabular py-2 text-right">{row.sent}</td>
                        <td className="lr-tabular py-2 text-right">
                          {row.delivered}
                        </td>
                        <td className="lr-tabular py-2 text-right">
                          {row.deliveryRate === null
                            ? "—"
                            : `${(row.deliveryRate * 100).toFixed(1)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b-0 px-5 pt-5 pb-0">
            <SectionHeader
              title="Why sequences stopped"
              description="A reply, a booking or a win is a success, not a failure."
              dense
            />
          </CardHeader>
          <CardContent className="px-5 pt-3 pb-5">
            {performance.stopReasons.length === 0 ? (
              <p className="text-[13px] text-content-muted">
                No sequence has stopped early in this window.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {performance.stopReasons.map((row) => (
                  <li
                    key={row.reason}
                    className="flex items-center justify-between gap-3 text-[13px]"
                  >
                    <span className="min-w-0 truncate text-content-secondary">
                      {STOP_REASON_LABEL[row.reason] ?? row.reason}
                    </span>
                    <span className="lr-tabular shrink-0 font-semibold text-content">
                      {row.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
