import { CalendarClock, Wrench } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import type { StatusMaintenance } from "@/lib/status/types";
import { formatLondon } from "@/lib/maintenance/schedule";

/**
 * The planned-maintenance card on /status: the window in force, or the next
 * one. Times are Europe/London, which is what every customer reads.
 */
export function StatusMaintenanceCard({ maintenance }: { maintenance: StatusMaintenance }) {
  const active = maintenance.phase === "ACTIVE";
  const Icon = active ? Wrench : CalendarClock;
  const back = maintenance.expectedBackAt ?? maintenance.endsAt;

  return (
    <section
      aria-labelledby="status-maintenance-title"
      className="rounded-xl border border-info-100 bg-info-50 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-600 text-white"
        >
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="status-maintenance-title" className="text-[15px] font-semibold text-content">
              {active ? "Planned maintenance in progress" : "Scheduled maintenance"}
            </h2>
            <StatusBadge kind="maintenance_state" value={maintenance.phase} />
            <StatusBadge kind="maintenance_level" value={maintenance.level} />
          </div>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] text-content-muted sm:grid-cols-2">
            <div>
              <dt className="inline font-medium text-content-secondary">{active ? "Started: " : "Starts: "}</dt>
              <dd className="inline">{formatLondon(maintenance.startsAt)}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-content-secondary">
                {active ? "Expected back: " : "Ends: "}
              </dt>
              <dd className="inline">{back ? formatLondon(back) : "When the work is finished"}</dd>
            </div>
          </dl>
          {maintenance.message ? (
            <p className="mt-2 whitespace-pre-line text-[13.5px] text-content">{maintenance.message}</p>
          ) : null}
          <p className="mt-2 text-[12.5px] text-content-muted">
            Leads, payments and opt-outs that arrive during maintenance are still received and queued.
          </p>
        </div>
      </div>
    </section>
  );
}
