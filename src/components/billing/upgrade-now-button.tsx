"use client";

import * as React from "react";
import { Rocket } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { loadTrialUpgradeOfferAction } from "@/lib/billing/trial-upgrade-actions";
import type { TrialUpgradeOffer } from "@/lib/billing/trial-upgrade-service";
import { TrialUpgradeModal } from "./trial-upgrade-modal";

/**
 * "Upgrade now: start your plan today" anywhere in a trial (the banner,
 * Settings -> Billing). Loads the plan chosen at checkout and the card on
 * open, then hands over to the same modal the SMS prompt uses: an instant
 * conversion on the card on file, never a second checkout.
 */
export function UpgradeNowButton({
  label = "Upgrade now",
  size = "sm",
  variant = "primary",
  fullWidth,
  className,
}: {
  label?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  fullWidth?: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [state, setState] = React.useState<{ offer: TrialUpgradeOffer; canUpgrade: boolean } | null>(null);
  const [open, setOpen] = React.useState(false);

  async function onClick() {
    if (state) {
      setOpen(true);
      return;
    }
    setLoading(true);
    try {
      const result = await loadTrialUpgradeOfferAction();
      if (result.ok) {
        setState({ offer: result.offer, canUpgrade: result.canUpgrade });
        setOpen(true);
      } else {
        toast({ variant: "error", title: "Could not open the upgrade", description: result.error });
      }
    } catch {
      toast({ variant: "error", title: "Could not open the upgrade", description: "Try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size={size} variant={variant} fullWidth={fullWidth} className={className} loading={loading} onClick={onClick}>
        <Rocket className="size-3.5" aria-hidden />
        {label}
      </Button>
      {state ? (
        <TrialUpgradeModal
          open={open}
          onClose={() => setOpen(false)}
          offer={state.offer}
          canUpgrade={state.canUpgrade}
        />
      ) : null}
    </>
  );
}
