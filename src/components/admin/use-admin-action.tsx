"use client";

import * as React from "react";
import { useToast } from "@/components/ui/toast";
import { StepUpDialog } from "./step-up-dialog";
import type { AdminActionResult } from "@/lib/admin/actions";

/**
 * Every mutating admin action funnels through here, so a step-up challenge is
 * offered once and the action is retried only after it is satisfied — and a
 * failure is always surfaced rather than swallowed.
 */
export function useAdminAction() {
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);
  const [stepUpFor, setStepUpFor] = React.useState<null | (() => Promise<void>)>(
    null,
  );

  const run = React.useCallback(
    async (key: string, fn: () => Promise<AdminActionResult>, success: string) => {
      setPending(key);
      try {
        const result = await fn();
        if (result.ok) {
          toast({ variant: "success", title: result.message ?? success });
          return;
        }
        if (result.code === "step_up_required") {
          setStepUpFor(() => async () => {
            const retry = await fn();
            if (retry.ok) {
              toast({ variant: "success", title: retry.message ?? success });
            } else {
              toast({ variant: "error", title: retry.error });
            }
          });
          return;
        }
        toast({ variant: "error", title: result.error });
      } catch {
        toast({
          variant: "error",
          title: "That action could not be completed. Please try again.",
        });
      } finally {
        setPending(null);
      }
    },
    [toast],
  );

  const stepUpDialog = (
    <StepUpDialog
      open={stepUpFor !== null}
      onClose={() => setStepUpFor(null)}
      onConfirmed={async () => {
        const action = stepUpFor;
        setStepUpFor(null);
        if (action) await action();
      }}
    />
  );

  return { run, pending, stepUpDialog };
}
