"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { VoiceSettingsView } from "@/lib/services/operations/voice";
import type { VoiceSettingsSection } from "@/lib/voice/settings-model";
import type { VoicePurchaseState } from "@/lib/billing/voice-purchase";
import { formatDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { UsageMeter } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { addVoiceNumberAction, removeProVoiceAction, startVoicePackCheckoutAction } from "@/lib/billing/voice-actions";
import { Fact, Notice, PanelCard } from "./voice-shared";

/**
 * Budget and usage: the minute balance, how routes share it, and buying
 * (owner only, re-checked by the billing actions). A minute pack goes to
 * Stripe Checkout; the number item is added to the live subscription, so it
 * is confirmed first. Nothing here grants minutes: the Stripe webhook does.
 */

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export function BudgetPanel({
  view,
  purchase,
  isOwner,
  routeLabels,
  onNavigate,
}: {
  view: VoiceSettingsView;
  purchase: VoicePurchaseState | null;
  isOwner: boolean;
  routeLabels: Readonly<Record<string, string>>;
  onNavigate: (p: VoiceSettingsSection) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [buying, setBuying] = React.useState<number | null>(null);
  const [numberOpen, setNumberOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const m = view.minutes;
  const usedIncluded = Math.max(0, m.periodIncludedMin - m.includedRemainingMin);
  const allocated = view.routes.filter((r) => r.enabled && r.percent != null);

  async function buy(minutes: number) {
    setBuying(minutes);
    setError(null);
    try {
      const result = await startVoicePackCheckoutAction(minutes);
      if (result.ok) {
        window.location.assign(result.url);
        return;
      }
      setError(result.error);
    } catch {
      setError("Checkout could not be started. Try again.");
    } finally {
      setBuying(null);
    }
  }

  async function addNumber() {
    setError(null);
    const result = await addVoiceNumberAction();
    setNumberOpen(false);
    if (result.ok) {
      toast({ variant: "success", title: result.changed ? "Dedicated number added to your subscription." : "Your subscription already includes the number." });
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function removeVoice() {
    setError(null);
    const result = await removeProVoiceAction();
    setRemoveOpen(false);
    if (result.ok) {
      toast({
        variant: "success",
        title: result.keepsNumber ? "Voice removed. Your number stays on its own item." : "Voice removed. Your number is kept until the end of this billing period.",
      });
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <PanelCard title="Minutes" description="Included minutes are used first, then pack minutes.">
        {m.periodIncludedMin > 0 ? (
          <UsageMeter label="Included minutes this month" used={usedIncluded} limit={m.periodIncludedMin} unit="min" />
        ) : (
          <p className="text-[13px] text-content-muted">Your plan has no included voice minutes. Minute packs cover your calls.</p>
        )}
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label="Included left">{m.includedRemainingMin.toLocaleString("en-GB")} min</Fact>
          <Fact label="Pack minutes left">{m.packRemainingMin.toLocaleString("en-GB")} min</Fact>
          <Fact label="Resets">{m.periodEnd ? formatDate(m.periodEnd) : "No monthly allowance"}</Fact>
        </dl>
        {!m.available && (
          <Notice tone="warning" role="status">
            No minutes are available, so calls wait in the queue. Buy a pack below to continue now.
          </Notice>
        )}
      </PanelCard>

      <PanelCard
        title="Route allocations"
        description="Each route's share of your minutes. Change them under Routes."
        aside={
          <Button size="xs" variant="ghost" onClick={() => onNavigate("routes")}>
            Edit routes
          </Button>
        }
      >
        {allocated.length === 0 ? (
          <p className="text-[13px] text-content-muted">No fixed shares. Every enabled route draws from the same balance.</p>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {allocated.map((r) => (
              <li key={r.route} className="flex items-center justify-between gap-3">
                <span className="text-content">{routeLabels[r.route] ?? r.route}</span>
                <span className="tabular-nums text-content-secondary">{r.percent}%</span>
              </li>
            ))}
          </ul>
        )}
      </PanelCard>

      <PanelCard title="Buy minutes" description="Prepaid packs never expire and are non-refundable once used.">
        {error && (
          <Notice tone="warning" role="alert">
            {error}
          </Notice>
        )}
        {!isOwner || !purchase ? (
          <Notice role="status">Only the workspace owner can buy minutes or add the number.</Notice>
        ) : !purchase.canBuyPacks && purchase.packsBlockedReason ? (
          <Notice tone="warning" role="status">
            {purchase.packsBlockedReason}
          </Notice>
        ) : null}
        {purchase && (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {purchase.packs.map((pack) => (
              <li key={pack.key} className="flex flex-col justify-between gap-3 rounded-lg border border-line px-4 py-3">
                <div>
                  <p className="text-[15px] font-semibold text-content tabular-nums">{pack.minutes.toLocaleString("en-GB")} minutes</p>
                  <p className="text-[13px] text-content-secondary tabular-nums">
                    {GBP.format(pack.priceGbp)}
                    <span className="text-content-muted"> · {GBP.format(pack.priceGbp / pack.minutes)} a minute</span>
                  </p>
                </div>
                {isOwner && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={buying === pack.minutes}
                    disabled={!purchase.canBuyPacks || !pack.available || buying !== null}
                    onClick={() => buy(pack.minutes)}
                  >
                    Buy
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelCard>

      <PanelCard
        title="Dedicated number"
        description={`Your own UK business number for calls and texts, ${GBP.format(purchase?.numberMonthlyGbp ?? 11.99)} a month.`}
      >
        {purchase?.numberState === "included" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-content-secondary">Included with your Pro voice item (£100 a month, 200 minutes).</p>
            {isOwner && (
              <Button size="sm" variant="ghost" onClick={() => setRemoveOpen(true)}>
                Remove voice (£100 less a month)
              </Button>
            )}
          </div>
        ) : purchase?.numberState === "owned" ? (
          <p className="text-[13px] text-content-secondary">On your subscription. Set it up under Number.</p>
        ) : purchase && !purchase.canAddNumber && purchase.numberBlockedReason ? (
          <Notice tone="warning" role="status">
            {purchase.numberBlockedReason}
          </Notice>
        ) : null}
        {isOwner && purchase?.canAddNumber && (
          <div>
            <Button size="sm" onClick={() => setNumberOpen(true)}>
              Add the number for {GBP.format(purchase.numberMonthlyGbp)} a month
            </Button>
          </div>
        )}
      </PanelCard>

      {purchase?.numberState === "included" && (
        <ConfirmDialog
          open={removeOpen}
          onClose={() => setRemoveOpen(false)}
          onConfirm={removeVoice}
          title="Remove voice from Pro?"
          scope="Your plan becomes Pro without voice at £399 a month. The £100 voice item is removed now and prorated, and its included minutes end. Minute packs you bought stay."
          consequence="Your dedicated number is kept until the end of this billing period, then released, unless you add it on its own for £11.99 a month. Queued AI calls wait for minutes."
          confirmLabel="Remove voice"
        />
      )}

      {purchase && (
        <ConfirmDialog
          open={numberOpen}
          onClose={() => setNumberOpen(false)}
          onConfirm={addNumber}
          title="Add a dedicated number?"
          scope={`${GBP.format(purchase.numberMonthlyGbp)} a month is added to your subscription, prorated for this billing period.`}
          consequence="After it is added, request the number under Number. Twilio reviews your business details before it is issued."
          confirmLabel="Add number"
        />
      )}
    </>
  );
}
