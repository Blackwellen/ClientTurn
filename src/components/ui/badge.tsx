import * as React from "react";
import { cn } from "@/lib/cn";

type Tone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "purple";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-content-secondary border-line",
  accent: "bg-accent-50 text-content-accent border-accent-200/60",
  success: "bg-success-50 text-success-700 border-success-100",
  warning: "bg-warning-50 text-warning-700 border-warning-100",
  danger: "bg-danger-50 text-danger-700 border-danger-100",
  info: "bg-info-50 text-info-700 border-info-100",
  purple: "bg-purple-50 text-purple-700 border-purple-100",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-content-subtle",
  accent: "bg-accent-500",
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
  info: "bg-info-500",
  purple: "bg-purple-500",
};

export function Badge({
  tone = "neutral",
  dot,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
        "text-[11px] font-medium leading-5 whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && (
        <span className={cn("size-1.5 rounded-full shrink-0", DOTS[tone])} />
      )}
      {children}
    </span>
  );
}

/* --------------------------------------------------------------------------
   The single status mapping. Every list, drawer and table reads from here so
   a status can never render two different colours in two places.
   -------------------------------------------------------------------------- */

export const LEAD_STATUS = {
  NEW: { label: "New", tone: "info" },
  CONTACTED: { label: "Contacted", tone: "accent" },
  RESPONDED: { label: "Responded", tone: "purple" },
  QUALIFIED: { label: "Qualified", tone: "success" },
  BOOKED: { label: "Booked", tone: "success" },
  WON: { label: "Won", tone: "success" },
  LOST: { label: "Lost", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const QUALIFICATION_STATE = {
  PENDING: { label: "Pending", tone: "neutral" },
  QUALIFIED: { label: "Meets criteria", tone: "success" },
  NOT_QUALIFIED: { label: "Does not meet", tone: "danger" },
  REVIEW: { label: "Needs review", tone: "warning" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const MESSAGE_STATUS = {
  QUEUED: { label: "Queued", tone: "neutral" },
  SENT: { label: "Sent", tone: "info" },
  DELIVERED: { label: "Delivered", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  RECEIVED: { label: "Received", tone: "accent" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const INTEGRATION_HEALTH = {
  HEALTHY: { label: "Healthy", tone: "success" },
  DEGRADED: { label: "Degraded", tone: "warning" },
  ACTION_REQUIRED: { label: "Action required", tone: "danger" },
  DISCONNECTED: { label: "Not connected", tone: "neutral" },
  TESTING: { label: "Testing", tone: "info" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/**
 * Campaign lifecycle. Tones follow meaning: green is sending, amber is held,
 * red is stopped, blue is finished, and the two "nothing is happening yet"
 * states read as neutral/violet rather than as success.
 */
export const CAMPAIGN_STATUS = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "purple" },
  RUNNING: { label: "Running", tone: "success" },
  PAUSED: { label: "Paused", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "info" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const SUBSCRIPTION_STATUS = {
  TRIALING: { label: "Trial", tone: "info" },
  ACTIVE: { label: "Active", tone: "success" },
  PAST_DUE: { label: "Past due", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  UNPAID: { label: "Unpaid", tone: "danger" },
  INCOMPLETE: { label: "Incomplete", tone: "warning" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

export const BOOKING_STATUS = {
  scheduled: { label: "Scheduled", tone: "accent" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  no_show: { label: "No show", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

type StatusMap = Record<string, { label: string; tone: Tone }>;

const MAPS = {
  lead: LEAD_STATUS,
  qualification: QUALIFICATION_STATE,
  message: MESSAGE_STATUS,
  integration: INTEGRATION_HEALTH,
  campaign: CAMPAIGN_STATUS,
  subscription: SUBSCRIPTION_STATUS,
  booking: BOOKING_STATUS,
} satisfies Record<string, StatusMap>;

export type StatusKind = keyof typeof MAPS;

export function StatusBadge({
  kind,
  value,
  dot = true,
  className,
}: {
  kind: StatusKind;
  value: string;
  dot?: boolean;
  className?: string;
}) {
  const entry = (MAPS[kind] as StatusMap)[value];
  if (!entry) {
    return (
      <Badge tone="neutral" className={className}>
        {value}
      </Badge>
    );
  }
  return (
    <Badge tone={entry.tone} dot={dot} className={className}>
      {entry.label}
    </Badge>
  );
}
