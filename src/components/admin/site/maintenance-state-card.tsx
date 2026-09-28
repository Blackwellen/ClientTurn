"use client";

import * as React from "react";
import { CalendarClock, CircleCheck, ExternalLink, Power, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { StatusBadge } from "@/components/ui/badge";
import { formatCountdown, formatLondon, expectedBack } from "@/lib/maintenance/schedule";
import { LEVEL_DESCRIPTION, LEVEL_LABEL, type MaintenanceStatus } from "@/lib/maintenance/types";
import { endMaintenanceNow } from "@/lib/maintenance/actions";
import { useSiteAction } from "./use-site-action";

/**
 * The big state card: Off, Scheduled or Active, with a live countdown to the
 * start or the end, and the one-click "End maintenance now". Turning
 * maintenance off asks for a plain confirmation and step-up only: the safe
 * direction is deliberately the easy one.
 */
export function MaintenanceStateCard({
  status,
  nowIso,
  envOverride,
}: {
  status: MaintenanceStatus;
  nowIso: string;
  envOverride: string | null;
}) {
  const [now, setNow] = React.useState(() => Date.parse(nowIso));
  const [confirming, setConfirming] = React.useState(false);
  const { run, pending, stepUpDialog } = useSiteAction();

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const phase = status.phase;
  const window_ = status.active ?? status.upcoming;
  const back = expectedBack(status.active);
  const target =
    phase === "ACTIVE" ? (status.active?.endsAt ? Date.parse(status.active.endsAt) : null)
    : phase === "SCHEDULED" && status.upcoming ? Date.parse(status.upcoming.startsAt)
    : null;
  const left = target !== null ? target - now : null;

  const tone =
    phase === "ACTIVE"
      ? status.level === "READ_ONLY" ? "warning" : "danger"
      : phase === "SCHEDULED" ? "info" : "success";
  const Icon = phase === "ACTIVE" ? Wrench : phase === "SCHEDULED" ? CalendarClock : CircleCheck;

  const headline =
    phase === "ACTIVE"
      ? `Maintenance active: ${LEVEL_LABEL[status.level]}`
      : phase === "SCHEDULED" && status.upcoming
        ? `Scheduled: ${LEVEL_LABEL[status.upcoming.level]}`
        : "Maintenance is off";

  const sub =
    phase === "ACTIVE" && status.active
      ? LEVEL_DESCRIPTION[status.active.level]
      : phase === "SCHEDULED" && status.upcoming
        ? `Starts ${formatLondon(status.upcoming.startsAt)}${status.upcoming.endsAt ? `, ends ${formatLondon(status.upcoming.endsAt)}` : ", runs until ended"}.`
        : "Customers and the website are running normally. Webhooks, the worker and the status page are never affected by maintenance.";

  return (
    <section
      aria-labelledby="maintenance-state-title"
      className={cn(
        "rounded-xl border p-5 shadow-xs sm:p-6",
        tone === "danger" && "border-danger-100 bg-danger-50",
        tone === "warning" && "border-warning-100 bg-warning-50",
        tone === "info" && "border-info-100 bg-info-50",
        tone === "success" && "border-success-100 bg-success-50",
      )}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-xl text-white",
              tone === "danger" && "bg-danger-600",
              tone === "warning" && "bg-warning-600",
              tone === "info" && "bg-info-600",
              tone === "success" && "bg-success-600",
            )}
          >
            <Icon className="size-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge kind="maintenance_state" value={phase} />
              {window_ ? <StatusBadge kind="maintenance_level" value={window_.level} /> : null}
              {envOverride ? (
                <StatusBadge kind="maintenance_level" value={envOverride} className="ring-1 ring-danger-200" />
              ) : null}
            </div>
            <h2 id="maintenance-state-title" className="mt-2 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-content">
              {headline}
            </h2>
            <p className="mt-1 max-w-[62ch] text-[13.5px] text-content-secondary">{sub}</p>
            {phase === "ACTIVE" && back ? (
              <p className="mt-1 text-[13px] text-content-muted">Expected back: {formatLondon(back)}</p>
            ) : null}
            {window_?.message ? (
              <p className="mt-2 max-w-[62ch] whitespace-pre-line rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-content">
                {window_.message}
              </p>
            ) : null}
            {envOverride ? (
              <p className="mt-2 max-w-[62ch] text-[12.5px] font-medium text-danger-700">
                MAINTENANCE_OVERRIDE_LEVEL is set on this deployment, which forces {LEVEL_LABEL[envOverride as keyof typeof LEVEL_LABEL] ?? envOverride} whatever this page says. Remove the environment variable and redeploy to lift it.
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
          {left !== null ? (
            <div className="lg:text-right">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-content-subtle">
                {phase === "ACTIVE" ? "Ends in" : "Starts in"}
              </p>
              {/* Not a live region: a ticking announcement every second is noise. */}
              <p className="lr-tabular text-[30px] font-semibold leading-none text-content">
                {formatCountdown(left)}
              </p>
            </div>
          ) : phase === "ACTIVE" ? (
            <p className="text-[13px] text-content-muted lg:text-right">No end time: runs until ended.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm">
              <a href="/status" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" aria-hidden />
                Status page
              </a>
            </Button>
            {window_ && !envOverride ? (
              <Button
                variant={phase === "ACTIVE" ? "danger" : "secondary"}
                size="sm"
                loading={pending === "end"}
                onClick={() => setConfirming(true)}
              >
                <Power className="size-3.5" aria-hidden />
                {phase === "ACTIVE" ? "End maintenance now" : "Cancel scheduled maintenance"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={phase === "ACTIVE" ? "End maintenance now?" : "Cancel scheduled maintenance?"}
        scope={
          phase === "ACTIVE"
            ? "The app and the website come back for everyone, and paused changes and sends resume."
            : "The scheduled window and its upcoming-maintenance notice are removed."
        }
        consequence="Every server picks this up within about 20 seconds. The change is recorded in the history below."
        confirmLabel={phase === "ACTIVE" ? "End maintenance" : "Cancel maintenance"}
        onConfirm={async () => {
          if (!window_) return;
          const ok = await run("end", () => endMaintenanceNow({ id: window_.id }));
          if (ok) setConfirming(false);
        }}
      />
      {stepUpDialog}
    </section>
  );
}
