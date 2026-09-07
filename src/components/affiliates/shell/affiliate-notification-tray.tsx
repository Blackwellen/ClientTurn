"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { markAffiliateNotificationsRead } from "@/lib/affiliates/link-actions";
import type { AffiliateNotification } from "@/lib/affiliates/notifications";

/**
 * The notification tray (V4 §36).
 *
 * Marks everything read on open rather than per-row: a partner who opened the
 * tray has seen the list, and leaving rows unread after they were displayed
 * makes the badge permanently wrong.
 */
export function AffiliateNotificationTray({
  notifications,
  onClose,
}: {
  notifications: AffiliateNotification[];
  onClose: () => void;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  React.useEffect(() => {
    if (notifications.some((row) => !row.readAt)) {
      void markAffiliateNotificationsRead();
    }
  }, [notifications]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(92vw,360px)] overflow-hidden rounded-[12px] border border-line bg-surface-raised shadow-lg"
    >
      <div className="border-b border-line-subtle px-4 py-3">
        <p className="text-[13.5px] font-semibold text-content">Notifications</p>
      </div>

      {notifications.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-content-muted">
          Nothing yet. We&rsquo;ll let you know about referrals, commission and
          payouts.
        </p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-line-subtle overflow-y-auto">
          {notifications.map((row) => {
            const body = (
              <>
                <p className="text-[13px] font-medium text-content">{row.title}</p>
                {row.body && (
                  <p className="mt-0.5 text-[12px] leading-relaxed text-content-muted">
                    {row.body}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-content-subtle">
                  {new Date(row.createdAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </>
            );

            return (
              <li key={row.id} className={cn(!row.readAt && "bg-accent-50/40")}>
                {row.href ? (
                  <Link
                    href={row.href}
                    onClick={onClose}
                    className="block px-4 py-3 hover:bg-surface-hover"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="px-4 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
