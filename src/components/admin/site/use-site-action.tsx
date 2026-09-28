"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { StepUpDialog } from "@/components/admin/step-up-dialog";
import type { AdminActionResult } from "@/lib/admin/guarded";

/**
 * The /admin/site version of `useAdminAction`: identical step-up handling
 * (the challenge is offered once and the same call retried after it), but
 * `run` resolves to whether the change landed, so a dialog can close only on
 * success and keep the operator's typing on a refusal.
 */
export function useSiteAction() {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [retry, setRetry] = React.useState<null | { fn: () => Promise<AdminActionResult>; resolve: (ok: boolean) => void }>(null);

  const settle = React.useCallback(
    (result: AdminActionResult): boolean => {
      if (result.ok) {
        toast({ variant: "success", title: result.message ?? "Saved." });
        router.refresh();
        return true;
      }
      toast({ variant: "error", title: result.error });
      return false;
    },
    [router, toast],
  );

  const run = React.useCallback(
    async (key: string, fn: () => Promise<AdminActionResult>): Promise<boolean> => {
      setPending(key);
      try {
        const result = await fn();
        if (!result.ok && result.code === "step_up_required") {
          return await new Promise<boolean>((resolve) => setRetry({ fn, resolve }));
        }
        return settle(result);
      } catch {
        toast({ variant: "error", title: "That change could not be saved. Please try again." });
        return false;
      } finally {
        setPending(null);
      }
    },
    [settle, toast],
  );

  const stepUpDialog = (
    <StepUpDialog
      open={retry !== null}
      onClose={() => {
        retry?.resolve(false);
        setRetry(null);
      }}
      onConfirmed={async () => {
        const current = retry;
        setRetry(null);
        if (!current) return;
        try {
          current.resolve(settle(await current.fn()));
        } catch {
          toast({ variant: "error", title: "That change could not be saved. Please try again." });
          current.resolve(false);
        }
      }}
    />
  );

  return { run, pending, stepUpDialog };
}
