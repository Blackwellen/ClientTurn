"use client";

import * as React from "react";
import { Mail, Pencil, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { Drawer } from "@/components/ui/drawer";
import { StatusBadge } from "@/components/ui/badge";
import { emailOwnersAboutMaintenance, endMaintenanceNow } from "@/lib/maintenance/actions";
import { formatLondon } from "@/lib/maintenance/schedule";
import { LEVEL_LABEL } from "@/lib/maintenance/types";
import type { AdminMaintenanceWindow } from "@/lib/maintenance/admin-types";
import { MaintenanceForm } from "./maintenance-form";
import { useSiteAction } from "./use-site-action";

/** Every window, newest first: edit, end or cancel, and email owners. */
export function MaintenanceWindows({ windows }: { windows: AdminMaintenanceWindow[] }) {
  const [editing, setEditing] = React.useState<AdminMaintenanceWindow | null>(null);
  const [ending, setEnding] = React.useState<AdminMaintenanceWindow | null>(null);
  const [emailing, setEmailing] = React.useState<AdminMaintenanceWindow | null>(null);
  const { run, pending, stepUpDialog } = useSiteAction();

  if (windows.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-[13px] text-content-muted">
        No maintenance has been scheduled yet. Scheduled and past windows appear here.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-line">
        {windows.map((window) => {
          const open = window.phase === "ACTIVE" || window.phase === "SCHEDULED";
          return (
            <li key={window.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:px-5">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge kind="maintenance_state" value={window.phase} dense />
                  <StatusBadge kind="maintenance_level" value={window.level} dense />
                  {window.keepAutomationRunning ? (
                    <span className="text-[11.5px] text-content-muted">· follow-up keeps sending</span>
                  ) : null}
                  {window.noticeQueuedAt ? <span className="text-[11.5px] text-content-muted">· owners emailed</span> : null}
                </div>
                <p className="text-[13px] text-content">
                  {formatLondon(window.startsAt)}
                  {" → "}
                  {window.endedAt
                    ? `ended ${formatLondon(window.endedAt)}`
                    : window.cancelledAt
                      ? `cancelled ${formatLondon(window.cancelledAt)}`
                      : window.endsAt
                        ? formatLondon(window.endsAt)
                        : "until ended"}
                </p>
                {window.message ? <p className="line-clamp-2 text-[12.5px] text-content-muted">{window.message}</p> : null}
                <p className="text-[11.5px] text-content-subtle">
                  {window.createdByEmail ? `By ${window.createdByEmail}` : "By an operator"}
                  {window.reason ? ` · ${window.reason}` : ""}
                </p>
              </div>
              {open ? (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Button size="xs" variant="secondary" onClick={() => setEditing(window)}>
                    <Pencil className="size-3" aria-hidden />
                    Edit
                  </Button>
                  {!window.noticeQueuedAt ? (
                    <Button size="xs" variant="secondary" onClick={() => setEmailing(window)}>
                      <Mail className="size-3" aria-hidden />
                      Email owners
                    </Button>
                  ) : null}
                  <Button size="xs" variant={window.phase === "ACTIVE" ? "danger" : "secondary"} onClick={() => setEnding(window)}>
                    <Power className="size-3" aria-hidden />
                    {window.phase === "ACTIVE" ? "End now" : "Cancel"}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit maintenance"
        description="Times are UK time (Europe/London)."
        size="lg"
      >
        {editing ? <MaintenanceForm key={editing.id} editing={editing} onDone={() => setEditing(null)} /> : null}
      </Drawer>

      <ConfirmDialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title={ending?.phase === "ACTIVE" ? "End maintenance now?" : "Cancel this maintenance?"}
        scope={ending ? `${LEVEL_LABEL[ending.level]} from ${formatLondon(ending.startsAt)}.` : ""}
        consequence="Every server picks this up within about 20 seconds."
        confirmLabel={ending?.phase === "ACTIVE" ? "End maintenance" : "Cancel maintenance"}
        variant={ending?.phase === "ACTIVE" ? "danger" : "default"}
        loading={pending === "end"}
        onConfirm={async () => {
          if (!ending) return;
          if (await run("end", () => endMaintenanceNow({ id: ending.id }))) setEnding(null);
        }}
      />

      <ConfirmDialog
        open={emailing !== null}
        onClose={() => setEmailing(null)}
        title="Email every workspace owner?"
        scope="One email per owner describing this window, sent once. It cannot be unsent."
        consequence="Each copy counts against that workspace's daily system-email cap."
        confirmLabel="Queue emails"
        loading={pending === "email"}
        onConfirm={async () => {
          if (!emailing) return;
          if (await run("email", () => emailOwnersAboutMaintenance({ id: emailing.id }))) setEmailing(null);
        }}
      />
      {stepUpDialog}
    </>
  );
}
