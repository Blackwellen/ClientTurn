"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { controlAgent } from "@/lib/agents/actions";

/**
 * Start, pause and stop for one agent.
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
export function AgentControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState("");
  const [confirmStop, setConfirmStop] = React.useState(false);

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
        <Button loading={pending} onClick={() => run("run")}>
          <Play className="size-4" aria-hidden />
          {status === "ACTIVE" ? "Run now" : "Start agent"}
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
      </div>

      {error && (
        <p role="alert" className="max-w-lg text-[12.5px] text-danger-600">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={() => {
          setConfirmStop(false);
          run("stop");
        }}
        title="Stop this agent?"
        scope="The agent stops after the work it is currently doing finishes."
        consequence="Prospects it has already found are kept, and so is its history. A stopped agent has to be started again — it will not resume on its schedule."
        confirmLabel="Stop agent"
        variant="danger"
        loading={pending}
      />
    </div>
  );
}
