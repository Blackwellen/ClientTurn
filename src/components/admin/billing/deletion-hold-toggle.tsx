"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { setDeletionHold } from "@/lib/admin/workspace-deletion-actions";

/** Hold or release one workspace's scheduled day-90 deletion. */
export function DeletionHoldToggle({
  businessId,
  businessName,
  held,
  disabled,
}: {
  businessId: string;
  businessName: string;
  held: boolean;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  function onClick() {
    let reason: string | undefined;
    if (!held) {
      const answer = window.prompt(
        `Why hold the deletion of "${businessName}"? For example a payment dispute or a legal hold. This is recorded in the audit log.`,
      );
      if (!answer || answer.trim().length < 3) return;
      reason = answer.trim();
    } else if (!window.confirm(`Release the hold on "${businessName}"? Its deletion schedule resumes at the next daily run.`)) {
      return;
    }
    startTransition(async () => {
      const result = await setDeletionHold({ businessId, hold: !held, reason });
      toast(
        result.ok
          ? { variant: "success", title: result.message ?? "Saved." }
          : { variant: "error", title: "Not saved", description: result.error },
      );
    });
  }

  return (
    <Button size="xs" variant={held ? "secondary" : "ghost"} loading={pending} disabled={disabled} onClick={onClick}>
      {held ? "Release hold" : "Hold"}
    </Button>
  );
}
