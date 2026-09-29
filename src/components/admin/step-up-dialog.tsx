"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, FormField } from "@/components/ui/form";
import { confirmStepUp } from "@/lib/admin/actions";

/**
 * Re-authentication gate. Mutating support actions require a recent password
 * and authenticator-code confirmation, so possession of a live session is
 * never sufficient on its own.
 */
export function StepUpDialog(props: {
  open: boolean;
  onClose: () => void;
  onConfirmed: () => void | Promise<void>;
}) {
  // Mounted only while open, so each challenge starts with empty state without
  // an effect resetting it.
  if (!props.open) return null;
  return <StepUpForm {...props} />;
}

function StepUpForm({
  onClose,
  onConfirmed,
}: {
  open: boolean;
  onClose: () => void;
  onConfirmed: () => void | Promise<void>;
}) {
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("password", password);
      formData.set("code", code);
      const result = await confirmStepUp(null, formData);
      if (result.ok) await onConfirmed();
      else setError(result.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Confirm it is you" size="sm">
      <form onSubmit={submit}>
        <div className="flex items-start gap-3">
          <span className="bg-warning-50 border-warning-100 flex size-8 shrink-0 items-center justify-center rounded-lg border">
            <ShieldCheck className="text-warning-600 size-4" />
          </span>
          <p className="text-content-secondary text-[13px]">
            This action changes a customer workspace. Re-enter your password
            and the current code from your authenticator app. The confirmation
            lasts 30 minutes.
          </p>
        </div>

        <div className="mt-4">
          <FormField label="Password" htmlFor="step-up-password" error={error ?? undefined}>
            <Input
              id="step-up-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FormField>
        </div>

        <div className="mt-3">
          <FormField label="Authenticator code" htmlFor="step-up-code">
            <Input
              id="step-up-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123 456"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </FormField>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={pending} disabled={!password || code.replace(/\s+/g, "").length !== 6}>
            Confirm
          </Button>
        </div>
      </form>
    </Modal>
  );
}
