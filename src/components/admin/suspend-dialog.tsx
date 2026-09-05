"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { FormField, Textarea } from "@/components/ui/form";

/** Suspension is audited, so the reason is required rather than optional. */
type SuspendDialogProps = {
  open: boolean;
  workspaceName: string;
  memberCount: number;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
};

export function SuspendDialog(props: SuspendDialogProps) {
  // Mounted only while open, so the reason box is always empty on a fresh
  // confirmation rather than being cleared by an effect.
  if (!props.open) return null;
  return <SuspendForm {...props} />;
}

function SuspendForm({
  workspaceName,
  memberCount,
  onClose,
  onConfirm,
}: SuspendDialogProps) {
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const trimmed = reason.trim();

  return (
    <Modal open onClose={onClose} title="Suspend this workspace?" size="sm">
      <div className="flex items-start gap-3">
        <span className="bg-danger-50 border-danger-100 flex size-8 shrink-0 items-center justify-center rounded-lg border">
          <AlertTriangle className="text-danger-600 size-4" />
        </span>
        <div className="min-w-0 text-[13px]">
          <p className="text-content">
            {workspaceName} and its {memberCount}{" "}
            {memberCount === 1 ? "member" : "members"} will lose access
            immediately.
          </p>
          <p className="text-content-secondary mt-1.5">
            Automated follow-up stops and no new leads are processed while
            suspended. This is recorded in the audit log and can be reversed.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <FormField
          label="Reason"
          htmlFor="suspend-reason"
          hint="Recorded in the audit log against your operator account."
          required
        >
          <Textarea
            id="suspend-reason"
            rows={3}
            required
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Confirmed payment fraud — flagged by Stripe Radar"
          />
        </FormField>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          loading={pending}
          disabled={trimmed.length < 4}
          onClick={async () => {
            setPending(true);
            try {
              await onConfirm(trimmed);
            } finally {
              setPending(false);
            }
          }}
        >
          Suspend workspace
        </Button>
      </div>
    </Modal>
  );
}
