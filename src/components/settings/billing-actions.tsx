"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { openBillingPortal, startPlanCheckout } from "@/lib/settings/actions";

export function ManageBillingButton({
  disabled,
  disabledReason,
}: {
  disabled: boolean;
  disabledReason?: string;
}) {
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  async function onClick() {
    setPending(true);
    const result = await openBillingPortal();
    setPending(false);

    if (result.ok) {
      window.location.href = result.url;
    } else {
      toast({
        variant: "error",
        title: "Billing portal unavailable",
        description: result.error,
      });
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button size="sm" variant="secondary" loading={pending} disabled={disabled} onClick={onClick}>
        <ExternalLink className="size-3.5" aria-hidden />
        Manage billing
      </Button>
      {disabled && disabledReason && (
        <p className="text-content-subtle text-[12px]">{disabledReason}</p>
      )}
    </div>
  );
}

export function UpgradeButton({
  plan,
  label,
  variant = "primary",
  disabled,
}: {
  plan: string;
  label: string;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  async function onClick() {
    setPending(true);
    const result = await startPlanCheckout({ plan, interval: "month" });
    setPending(false);

    if (result.ok) {
      window.location.href = result.url;
    } else {
      toast({
        variant: "error",
        title: "Checkout could not start",
        description: result.error,
      });
    }
  }

  return (
    <Button
      size="sm"
      variant={variant}
      loading={pending}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
