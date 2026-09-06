"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Repeat } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Switch, Label, Select, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown";
import { useToast } from "@/components/ui/toast";
import {
  CADENCE_LABELS,
  type RecurringSearchView,
  type SearchSessionSummary,
} from "@/lib/find-leads/types";
import {
  createRecurringSearchAction,
  deleteRecurringSearchAction,
  setRecurringSearchStatusAction,
} from "@/lib/find-leads/actions";

/**
 * Recurring sourcing.
 *
 * A schedule re-runs a plan the customer already approved — it never re-derives
 * targeting. That is why creating one starts from an existing session rather
 * than from a blank form: there is no way to schedule a search that nobody has
 * reviewed, which is the whole guarantee.
 */

export function RecurringSourcingCard({
  schedules,
  sessions,
  canManage,
}: {
  schedules: RecurringSearchView[];
  /** Sessions with a saved plan, which are the only schedulable things. */
  sessions: SearchSessionSummary[];
  canManage: boolean;
}) {
  const [creating, setCreating] = React.useState(false);

  return (
    <section className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex items-start justify-between gap-3 px-4 py-3.5">
        <div className="flex gap-2.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-accent-50 text-content-accent"
          >
            <Repeat className="size-3.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14.5px] font-semibold text-content">
              Recurring sourcing
            </h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-content-muted">
              Set up recurring searches to automatically find new prospects.
            </p>
          </div>
        </div>
      </header>

      {schedules.length === 0 ? (
        <p className="px-4 pb-3 text-[12.5px] leading-relaxed text-content-muted">
          Create a recurring search to keep your pipeline fresh. Recurring searches
          re-run a plan you have already approved.
        </p>
      ) : (
        <ul className="border-t border-line-subtle">
          {schedules.map((schedule) => (
            <ScheduleRow
              key={schedule.id}
              schedule={schedule}
              canManage={canManage}
            />
          ))}
        </ul>
      )}

      <div className="border-t border-line-subtle px-3 py-3">
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          disabled={!canManage || sessions.length === 0}
          onClick={() => setCreating(true)}
          title={
            sessions.length === 0
              ? "Save a search plan first — a schedule re-runs a plan you have approved."
              : undefined
          }
        >
          Create recurring search
        </Button>
        {sessions.length === 0 && (
          <p className="mt-2 text-center text-[11.5px] text-content-subtle">
            Run a search first — schedules re-use a plan you have approved.
          </p>
        )}
      </div>

      <CreateDialog
        open={creating}
        sessions={sessions}
        onClose={() => setCreating(false)}
      />
    </section>
  );
}

function ScheduleRow({
  schedule,
  canManage,
}: {
  schedule: RecurringSearchView;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const enabled = schedule.status === "ACTIVE";

  const toggle = (next: boolean) => {
    startTransition(async () => {
      const result = await setRecurringSearchStatusAction(schedule.id, next);
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }
      toast({
        variant: "success",
        title: next ? "Recurring search resumed." : "Recurring search paused.",
      });
      router.refresh();
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteRecurringSearchAction(schedule.id);
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }
      toast({
        variant: "success",
        title: "Recurring search stopped.",
        description: "Prospects it already found are kept.",
      });
      router.refresh();
    });
  };

  return (
    <li className="flex items-center gap-3 border-t border-line-subtle px-4 py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-content">{schedule.name}</p>
        <p className="text-[11.5px] text-content-muted">
          {CADENCE_LABELS[schedule.cadence]} ·{" "}
          <span className="tabular-nums">
            {schedule.targetPerRun.toLocaleString("en-GB")}
          </span>{" "}
          prospects
          {schedule.nextRunAt && enabled && (
            <>
              {" · next "}
              {new Date(schedule.nextRunAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              })}
            </>
          )}
        </p>
      </div>

      <Switch
        checked={enabled}
        onCheckedChange={toggle}
        disabled={!canManage || pending}
        tone="success"
        label={`${enabled ? "Pause" : "Resume"} ${schedule.name}`}
      />

      <DropdownMenu
        trigger={
          <IconButton variant="ghost" size="xs" label={`Actions for ${schedule.name}`}>
            <MoreHorizontal className="size-3.5" aria-hidden />
          </IconButton>
        }
      >
        <DropdownItem disabled={!canManage} destructive onSelect={remove}>
          Stop this schedule
        </DropdownItem>
      </DropdownMenu>
    </li>
  );
}

function CreateDialog({
  open,
  sessions,
  onClose,
}: {
  open: boolean;
  sessions: SearchSessionSummary[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [sessionId, setSessionId] = React.useState(sessions[0]?.id ?? "");
  const [cadence, setCadence] = React.useState<RecurringSearchView["cadence"]>("WEEKLY");
  const [target, setTarget] = React.useState(250);

  if (!open) return null;

  const submit = () => {
    startTransition(async () => {
      const result = await createRecurringSearchAction({
        sessionId,
        cadence,
        targetPerRun: target,
      });
      if (!result.ok) {
        toast({ variant: "error", title: result.error });
        return;
      }
      toast({
        variant: "success",
        title: "Recurring search created.",
        description: "It re-runs the plan you approved, within your allowance.",
      });
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal open onClose={onClose} title="Create a recurring search">
      <div className="space-y-4">
        <p className="text-[12.5px] leading-relaxed text-content-muted">
          A schedule re-runs a search plan you have already reviewed. Editing that
          plan later stops the schedule until you approve it again — targeting is
          never re-derived on your behalf.
        </p>

        <div>
          <Label htmlFor="recurring-session">Search to repeat</Label>
          <Select
            id="recurring-session"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            className="mt-1"
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="recurring-cadence">How often</Label>
            <Select
              id="recurring-cadence"
              value={cadence}
              onChange={(event) =>
                setCadence(event.target.value as RecurringSearchView["cadence"])
              }
              className="mt-1"
            >
              {(
                Object.keys(CADENCE_LABELS) as RecurringSearchView["cadence"][]
              ).map((value) => (
                <option key={value} value={value}>
                  {CADENCE_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="recurring-target">Prospects per run</Label>
            <Input
              id="recurring-target"
              type="number"
              min={1}
              max={2000}
              value={target}
              onChange={(event) => setTarget(Number(event.target.value) || 1)}
              className="mt-1"
            />
          </div>
        </div>

        <p className="rounded-lg bg-accent-50/60 px-3 py-2.5 text-[12px] leading-relaxed text-content-secondary">
          Each run is checked against your plan limits before it starts. If your
          allowance is used up, that cycle produces no run rather than an
          overspend.
        </p>

        <div className="flex justify-end gap-2 border-t border-line-subtle pt-4">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!sessionId}>
            Create schedule
          </Button>
        </div>
      </div>
    </Modal>
  );
}
