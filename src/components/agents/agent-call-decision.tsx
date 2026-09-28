"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { decideAgentCallAction } from "@/lib/agents/actions";

/**
 * Approve or decline an AI call an agent on a review level asked for. The
 * agent never dials these on its own. Approving is a real call, so it is
 * confirmed first; declining is immediate and leaves the lead to follow-up.
 */
export function AgentCallDecision({ itemId, label }: { itemId: string; label: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function decide(decision: "APPROVE" | "DECLINE") {
    startTransition(async () => {
      const result = await decideAgentCallAction({ itemId, decision });
      setOpen(false);
      if (result.ok) {
        toast({ variant: "success", title: result.message });
        router.refresh();
      } else {
        toast({ variant: "error", title: result.error });
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={() => setOpen(true)} disabled={pending}>
        Approve call
      </Button>
      <Button size="sm" variant="secondary" loading={pending} onClick={() => decide("DECLINE")}>
        Decline
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => decide("APPROVE")}
        loading={pending}
        title={`${label}?`}
        scope="The AI assistant will phone this lead from your dedicated number. It is a real call and uses voice minutes."
        consequence="Consent, TPS, calling hours, attempt limits and your minutes are checked first. Outside their calling hours the call is booked for when they open."
        confirmLabel="Approve call"
      />
    </div>
  );
}
