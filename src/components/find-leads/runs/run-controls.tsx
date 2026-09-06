"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pause, Play, Plus, Square, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import type { RunControls as Controls } from "@/lib/find-leads/types";
import {
  increaseRunTargetAction,
  pauseSourcingRunAction,
  resumeSourcingRunAction,
  stopSourcingRunAction,
} from "@/lib/find-leads/actions";

/**
 * Run controls (V4 §11.15).
 *
 * Six actions, and a deliberate absence: there is no "ignore budget", no
 * "force continue", no "bypass suppression". Those are not missing features —
 * a control that let a customer override the compliance engine would make the
 * engine advisory, and the engine is the thing that keeps cold outreach lawful.
 *
 * Stop is destructive in the sense that it ends the run, so it confirms. It is
 * not destructive to data: everything the run already produced is kept, and the
 * dialog says so, because a customer who thinks stopping loses their results
 * will leave a run going that they wanted stopped.
 */

export function RunControls({
  runId,
  controls,
  variant = "panel",
}: {
  runId: string;
  controls: Controls;
  /** "header" renders the compact toolbar; "panel" the full card. */
  variant?: "panel" | "header";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [confirmStop, setConfirmStop] = React.useState(false);

  const act = (
    action: () => Promise<{ ok: boolean; data?: { message: string }; error?: string }>,
  ) => {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast({ variant: "error", title: result.error ?? "That did not work." });
        return;
      }
      toast({ variant: "success", title: result.data?.message ?? "Done." });
      router.refresh();
    });
  };

  const pause = () => act(() => pauseSourcingRunAction(runId));
  const resume = () => act(() => resumeSourcingRunAction(runId));
  const stop = () => act(() => stopSourcingRunAction(runId));

  const increase = () => {
    const answer = window.prompt("How many more prospects should we look for?", "50");
    const additional = Number(answer);
    if (!Number.isFinite(additional) || additional < 1) return;
    act(() => increaseRunTargetAction(runId, Math.floor(additional)));
  };

  const stopDialog = (
    <ConfirmDialog
      open={confirmStop}
      onClose={() => setConfirmStop(false)}
      onConfirm={() => {
        setConfirmStop(false);
        stop();
      }}
      title="Stop this sourcing run?"
      scope="The run stops after the step it is currently on."
      consequence="The prospects it has already found are kept, and so is anything already spent. A stopped run cannot be resumed — start a new run to continue looking."
      confirmLabel="Stop run"
      variant="danger"
      loading={pending}
    />
  );

  if (variant === "header") {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          {controls.canPause && (
            <Button variant="secondary" size="md" onClick={pause} disabled={pending}>
              <Pause className="size-3.5" aria-hidden />
              Pause run
            </Button>
          )}
          {controls.canResume && (
            <Button variant="secondary" size="md" onClick={resume} disabled={pending}>
              <Play className="size-3.5" aria-hidden />
              Resume run
            </Button>
          )}
          {controls.canStop && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => setConfirmStop(true)}
              disabled={pending}
              className="text-danger-600"
            >
              <Square className="size-3.5 fill-current" aria-hidden />
              Stop run
            </Button>
          )}
          <Button
            variant="secondary"
            size="md"
            onClick={() => router.push(`/app/find-leads?view=prospects&runId=${runId}`)}
          >
            <Users className="size-3.5" aria-hidden />
            Open prospects
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() =>
              router.push(`/app/find-leads?view=prospects&runId=${runId}&quick=review`)
            }
          >
            <AlertTriangle className="size-3.5" aria-hidden />
            Open issues
          </Button>
        </div>
        {stopDialog}
      </>
    );
  }

  return (
    <>
      <section className="rounded-xl border border-line bg-surface shadow-xs">
        <header className="flex gap-2.5 px-4 py-3.5">
          <span
            aria-hidden
            className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-accent-50 text-content-accent"
          >
            <Play className="size-3.5" />
          </span>
          <div>
            <h2 className="text-[14.5px] font-semibold text-content">Run controls</h2>
            <p className="text-[11.5px] text-content-muted">Manage this sourcing run</p>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-2 border-t border-line-subtle p-3">
          <Button
            variant="secondary"
            size="md"
            onClick={pause}
            disabled={!controls.canPause || pending}
          >
            <Pause className="size-3.5" aria-hidden />
            Pause run
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={resume}
            disabled={!controls.canResume || pending}
          >
            <Play className="size-3.5" aria-hidden />
            Resume run
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setConfirmStop(true)}
            disabled={!controls.canStop || pending}
            className="text-danger-600"
          >
            <Square className="size-3.5 fill-current" aria-hidden />
            Stop run
          </Button>

          {/* The reason is attached to the control rather than hidden, so a
              customer knows whether it is their role or their allowance. */}
          <Tooltip content={controls.increaseTargetReason ?? "Look for more prospects"}>
            <span className="contents">
              <Button
                variant="secondary"
                size="md"
                onClick={increase}
                disabled={!controls.canIncreaseTarget || pending}
              >
                <Plus className="size-3.5" aria-hidden />
                Increase target
              </Button>
            </span>
          </Tooltip>

          <Button
            variant="secondary"
            size="md"
            onClick={() => router.push(`/app/find-leads?view=prospects&runId=${runId}`)}
          >
            <Users className="size-3.5" aria-hidden />
            Open prospects
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() =>
              router.push(`/app/find-leads?view=prospects&runId=${runId}&quick=review`)
            }
          >
            <AlertTriangle className="size-3.5" aria-hidden />
            Open issues
          </Button>
        </div>

        {controls.increaseTargetReason && !controls.canIncreaseTarget && (
          <p className="border-t border-line-subtle px-4 py-2.5 text-[11.5px] text-content-muted">
            {controls.increaseTargetReason}
          </p>
        )}
      </section>
      {stopDialog}
    </>
  );
}
