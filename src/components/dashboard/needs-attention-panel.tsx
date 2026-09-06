import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  CalendarX,
  Clock,
  FileWarning,
  MapPinOff,
  MessageSquareX,
  PlugZap,
  Rocket,
  SearchCheck,
  ShieldCheck,
  ChevronRight,
  UserRound,
} from "lucide-react";
import type {
  AttentionItem,
  AttentionKind,
  AttentionTone,
} from "@/lib/dashboard/types";
import { formatRelativeShort } from "@/lib/dates";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SectionHeader } from "@/components/app/page-header";
import { CardActionLink } from "./card-action-link";
import { cn } from "@/lib/cn";

/** Dense rows, not a card per alert — six at most, then "View all". */
const MAX_ROWS = 6;

/** Severity picks the colour; the kind picks the glyph. */
const KIND_ICON: Record<
  AttentionKind,
  React.ComponentType<{ className?: string }>
> = {
  human_request: UserRound,
  message_failed: MessageSquareX,
  form_mapping: FileWarning,
  out_of_area: MapPinOff,
  review: SearchCheck,
  no_response: Clock,
  meta: PlugZap,
  messaging: MessageSquareX,
  booking: CalendarX,
  followup: Rocket,
  other: AlertCircle,
};

const TONE_TILE: Record<AttentionTone, string> = {
  danger: "bg-danger-50 text-danger-600",
  warning: "bg-warning-50 text-warning-600",
  info: "bg-info-50 text-info-600",
};

const TONE_LABEL: Record<AttentionTone, string> = {
  danger: "Action required",
  warning: "Warning",
  info: "For information",
};

export function NeedsAttentionPanel({ items }: { items: AttentionItem[] }) {
  const rows = items.slice(0, MAX_ROWS);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <SectionHeader
          title="Needs attention"
          icon={AlertCircle}
          tone={rows.length === 0 ? "success" : "danger"}
          action={
            items.length > 0 ? (
              <CardActionLink href="/app/leads?tab=attention" />
            ) : undefined
          }
        />
      </CardHeader>

      <CardContent className="flex-1 pt-0">
        {rows.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2.5 text-center">
            <span className="bg-success-50 text-success-600 flex size-10 items-center justify-center rounded-xl">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <span>
              <span className="text-content block text-[14px] font-semibold">
                You&apos;re all caught up.
              </span>
              <span className="text-content-muted mt-0.5 block text-[12.5px]">
                Nothing is blocking a lead right now.
              </span>
            </span>
          </div>
        ) : (
          <ul className="divide-line-subtle divide-y">
            {rows.map((item) => {
              const Icon = KIND_ICON[item.kind] ?? AlertCircle;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className={cn(
                      "group -mx-2 flex items-center gap-3 rounded-md px-2 py-2",
                      "transition-colors duration-[var(--lr-duration-fast)] hover:bg-surface-hover",
                      "focus-visible:outline-content-accent focus-visible:outline-2",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-lg",
                        TONE_TILE[item.tone],
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden />
                      <span className="sr-only">{TONE_LABEL[item.tone]}:</span>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="text-content block truncate text-[13px] font-medium">
                        {item.title}
                      </span>
                      <span className="text-content-muted block truncate text-[12px]">
                        {item.detail}
                      </span>
                    </span>

                    {item.at && (
                      <span className="text-content-subtle shrink-0 text-[11.5px] whitespace-nowrap">
                        {formatRelativeShort(item.at)}
                      </span>
                    )}
                    <ChevronRight className="text-content-subtle group-hover:text-content-muted size-4 shrink-0 transition-colors" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
