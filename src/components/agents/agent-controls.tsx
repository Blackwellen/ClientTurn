"use client";

import { FormError } from "@/components/ui/feedback";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { controlAgent, deleteAgent } from "@/lib/agents/actions";
import { runButton } from "@/lib/agents/policy";

/**
 * Start, pause, stop and delete for one agent.
 *
 * Three deliberate properties:
 *
 *   * **Stop confirms.** It is the only one of the three a customer cannot
 *     undo by pressing the neighbouring button, so it asks first and says what
 *     survives — the prospects an agent already found are kept.
 *   * **Failures are shown, not swallowed.** A refused command (no admin role,
 *     no approved plan, no allowance left) puts its reason on screen rather
 *     than leaving a button that appears to do nothing.
 *   * **The server decides.** These controls are a convenience; `controlAgent`
 *     re-checks role, entitlement and plan approval on every call.
 */
export function AgentControls({
  id,
  status,
  cadence,
}: {
  id: string;
  status: string;
  cadence: string;
}) {
  const primary = runButton({ status, cadence });
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState("");
  const [confirmStop, setConfirmStop] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const remove = () => {
    startTransition(async () => {
      const result = await deleteAgent(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/app/agents");
      router.refresh();
    });
  };

  const run = (command: "run" | "pause" | "stop") => {
    startTransition(async () => {
      try {
        const result = await controlAgent(id, command);
        setError(result.error ?? "");
        router.refresh();
      } catch {
        // A thrown action is the role check refusing, which reaches the client
        // as an opaque error rather than a returned message.
        setError("You need workspace admin access to change this agent.");
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button loading={pending} onClick={() => run("run")} title={primary.hint}>
          <Play className="size-4" aria-hidden />
          {primary.label}
        </Button>

        <Button
          variant="secondary"
          disabled={pending || status !== "ACTIVE"}
          onClick={() => run("pause")}
          title={status === "ACTIVE" ? undefined : "This agent is not running"}
        >
          <Pause className="size-4" aria-hidden />
          Pause
        </Button>

        <Button
          variant="ghost"
          disabled={pending || status === "STOPPED"}
          onClick={() => setConfirmStop(true)}
          title={status === "STOPPED" ? "This agent is already stopped" : undefined}
        >
          <Square className="size-4" aria-hidden />
          Stop
        </Button>

        <Button
          variant="ghost"
          className="text-danger-600 hover:text-danger-700"
          disabled={pending}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-4" aria-hidden />
          Delete
        </Button>
      </div>

      <p className="max-w-lg text-[11.5px] text-content-muted">{primary.hint}</p>

      <FormError message={error} className="max-w-lg" />

      <ConfirmDialog
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={() => {
          setConfirmStop(false);
          run("stop");
        }}
        title="Stop this agent?"
        scope="The agent stops after the work it is currently doing finishes."
        consequence="Prospects it has already found are kept, and so is its history. A stopped agent has to be started again. It will not resume on its schedule."
        confirmLabel="Stop agent"
        variant="danger"
        loading={pending}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          remove();
        }}
        title="Delete this agent?"
        scope="The agent, its setup, queue, signals and activity timeline are removed."
        consequence="The leads, prospects and sourcing runs it produced are kept. If one of its runs is still in progress, stop the agent and wait for it to finish first. This cannot be undone."
        confirmLabel="Delete agent"
        variant="danger"
        loading={pending}
      />
    </div>
  );
}
