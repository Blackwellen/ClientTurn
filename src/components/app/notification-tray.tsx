"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BellOff,
  CalendarCheck,
  CreditCard,
  Gauge,
  MessageSquareX,
  PlugZap,
  UserRoundCheck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/feedback";
import { dayGroupLabel, formatRelative } from "@/lib/dates";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/actions";

/** Operational notification types only — nothing marketing or decorative. */
export type NotificationRow = {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
};

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  handover: UserRoundCheck,
  booking: CalendarCheck,
  integration_failure: PlugZap,
  message_failed: MessageSquareX,
  campaign_complete: CalendarCheck,
  billing: CreditCard,
  usage_limit: Gauge,
  lead_attention: AlertTriangle,
};

const SEVERITY_ICON: Record<string, string> = {
  info: "bg-info-50 text-info-600 border-info-100",
  warning: "bg-warning-50 text-warning-700 border-warning-100",
  error: "bg-danger-50 text-danger-600 border-danger-100",
};

function groupByDay(rows: NotificationRow[]) {
  const groups: { label: string; rows: NotificationRow[] }[] = [];
  for (const row of rows) {
    const label = dayGroupLabel(row.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

export function NotificationTray({
  open,
  onClose,
  notifications,
}: {
  open: boolean;
  onClose: () => void;
  notifications: NotificationRow[];
}) {
  const [pending, startTransition] = React.useTransition();
  const [readIds, setReadIds] = React.useState<string[]>([]);

  const rows = notifications.map((row) =>
    readIds.includes(row.id) && !row.read_at
      ? { ...row, read_at: new Date().toISOString() }
      : row,
  );
  const unread = rows.filter((row) => !row.read_at).length;
  const groups = groupByDay(rows);

  function markOne(id: string) {
    setReadIds((ids) => [...ids, id]);
    startTransition(async () => {
      await markNotificationRead(id);
    });
  }

  function markAll() {
    setReadIds(rows.map((row) => row.id));
    startTransition(async () => {
      await markAllNotificationsRead();
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Notifications"
      description={
        unread > 0 ? `${unread} unread` : "You are up to date"
      }
      size="md"
      footer={
        rows.length > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={unread === 0 || pending}
            onClick={markAll}
          >
            Mark all as read
          </Button>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="No notifications"
          description="Handovers, failed messages, bookings and integration problems will appear here."
        />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.label}>
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-content-subtle">
                {group.label}
              </h3>
              <ul className="space-y-1.5">
                {group.rows.map((row) => {
                  const Icon = ICONS[row.type] ?? AlertTriangle;
                  const isUnread = !row.read_at;
                  return (
                    <li
                      key={row.id}
                      className={cn(
                        "rounded-lg border px-3 py-2.5",
                        isUnread
                          ? "border-accent-200/60 bg-accent-50"
                          : "border-line bg-surface",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border",
                            SEVERITY_ICON[row.severity] ?? SEVERITY_ICON.info,
                          )}
                        >
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "text-[13px] text-content",
                              isUnread ? "font-semibold" : "font-medium",
                            )}
                          >
                            {row.title}
                          </p>
                          {row.body && (
                            <p className="mt-0.5 text-[13px] text-content-muted">
                              {row.body}
                            </p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-3">
                            <span className="text-[12px] text-content-subtle">
                              {formatRelative(row.created_at)}
                            </span>
                            {row.link_url && (
                              <Link
                                href={row.link_url}
                                onClick={onClose}
                                className="text-[12px] font-medium text-content-accent hover:underline"
                              >
                                Open
                              </Link>
                            )}
                            {isUnread && (
                              <button
                                type="button"
                                onClick={() => markOne(row.id)}
                                className="text-[12px] font-medium text-content-muted hover:text-content"
                              >
                                Mark as read
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Drawer>
  );
}
