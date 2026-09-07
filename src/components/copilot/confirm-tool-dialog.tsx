"use client";

import * as React from "react";
import { ConfirmDialog } from "@/components/ui/modal";
import { copilotTool } from "@/lib/copilot/types";

/**
 * The high-impact confirmation (V4 §28.7).
 *
 * States the effect in plain words before anything happens, because "Pause
 * Campaign B?" on its own does not tell someone what stops, what is held, or
 * what happens to prospects mid-sequence.
 *
 * This dialog is a courtesy to the user, not the security control. The tool
 * service checks `requiresConfirmation` independently, so an action that
 * skipped this dialog is still refused server-side.
 */
export function ConfirmToolDialog({
  tool,
  onCancel,
  onConfirm,
  pending,
}: {
  tool: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const declaration = copilotTool(tool);
  if (!declaration) return null;

  return (
    <ConfirmDialog
      open
      onClose={onCancel}
      onConfirm={onConfirm}
      loading={pending}
      variant="warning"
      title={`${declaration.summary}?`}
      scope="Requested by Copilot, on your behalf"
      consequence={
        declaration.effect ??
        "This runs the same action the app performs, with your permissions."
      }
      confirmLabel="Confirm"
    />
  );
}
