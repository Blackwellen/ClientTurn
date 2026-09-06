import * as React from "react";
import Link from "next/link";
import { ArrowRight, CircleAlert, CircleCheck, Info, Shield } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import {
  summariseWarmChannels,
  type ChannelAvailability,
} from "@/lib/follow-up/channel-policy";
import type { FollowUpChannelContext } from "@/lib/follow-up/channel-context";

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  social: "Social",
};

/**
 * The channel policy card (V4 §19.2, §19.7).
 *
 * States what warm follow-up may use, and — just as importantly — says out
 * loud that cold prospecting is email-first and that SMS and WhatsApp are
 * blocked for cold. That sentence is the whole reason customers stop asking
 * for cold SMS.
 *
 * The verdicts are rendered from `summariseWarmChannels`, the same pure
 * function the editor uses to decide which channels it may offer, so the card
 * can never claim a channel is allowed that the picker then refuses.
 */
export function ChannelPolicyCard({
  context,
  canEdit,
}: {
  context: FollowUpChannelContext;
  canEdit: boolean;
}) {
  const rows = summariseWarmChannels(context);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-success-100 bg-success-50 text-success-600"
          >
            <Shield className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-content">
              Channel policy
            </h3>
            <p className="text-[12.5px] text-content-muted">
              Warm lead (permissioned)
            </p>
          </div>
        </div>

        {canEdit && (
          <Link
            href="/app/settings?section=connections"
            className={cn(
              "shrink-0 rounded-md border border-line-strong bg-surface px-2.5 py-1",
              "text-[12px] font-medium text-content shadow-xs hover:bg-surface-hover",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
            )}
          >
            Edit
          </Link>
        )}
      </div>

      <CardContent className="space-y-2.5 pt-0">
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <ChannelRow key={row.channel} row={row} />
          ))}
        </ul>

        <div className="rounded-[10px] border border-info-100 bg-info-50/70 p-3">
          <div className="flex gap-2.5">
            <Info
              className="mt-0.5 size-4 shrink-0 text-info-600"
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-[12.5px] leading-[1.45] text-content-secondary">
                Cold prospecting uses email as the primary channel by default.
                SMS and WhatsApp are blocked for cold prospects unless policy
                explicitly permits.
              </p>
              <Link
                href="/app/help#channel-policy"
                className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-content-accent hover:underline"
              >
                Learn about channel policy
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelRow({ row }: { row: ChannelAvailability }) {
  const Icon = row.available ? CircleCheck : CircleAlert;

  return (
    <li className="flex items-start gap-2.5">
      <Icon
        aria-hidden
        className={cn(
          "mt-px size-[18px] shrink-0",
          row.available
            ? "text-success-600"
            : row.channel === "social"
              ? "text-content-subtle"
              : "text-warning-600",
        )}
      />
      <span className="w-[76px] shrink-0 text-[13px] font-medium text-content">
        {CHANNEL_LABEL[row.channel]}
      </span>
      <span className="min-w-0 text-[12.5px] leading-[1.45] text-content-muted">
        {row.verdict}
        {/* Status is never colour-only: the verdict text carries the meaning. */}
        {row.warning && (
          <span className="mt-0.5 block text-warning-700">{row.warning}</span>
        )}
      </span>
    </li>
  );
}
