"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CreditCard, ExternalLink, MessageSquare, ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  SELF_SERVE_PLANS,
  formatMinorGbp,
  planOffer,
  type SelfServePlan,
} from "@/lib/billing/trial-upgrade-prompt";
import {
  endTrialNowAction,
  previewTrialUpgradeAction,
  type EndTrialActionResult,
} from "@/lib/billing/trial-upgrade-actions";
import type { TrialUpgradeOffer } from "@/lib/billing/trial-upgrade-service";

/**
 * "Upgrade now: start your plan today" -- ends the card-first trial on the
 * card already on file (service operation `billing.end_trial_now`).
 *
 * Steps: choose (the plan chosen at checkout, switchable) -> confirm (states
 * today's charge, from Stripe's own preview) -> done, or an error that says
 * what to do next. The confirmation nonce is created once per confirm step,
 * so a double click replays one Stripe request instead of charging twice.
 */

export type TrialUpgradeLead = { id: string; name: string };

type Step =
  | { kind: "choose" }
  | { kind: "confirm"; nonce: string }
  | { kind: "done"; result: Extract<EndTrialActionResult, { ok: true }> }
  | { kind: "error"; message: string; actionUrl?: string; requiresAction?: boolean };

function newNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function priceLabel(price: number, interval: "month" | "year") {
  return `£${price.toLocaleString("en-GB")} / ${interval === "year" ? "year" : "month"}`;
}

export function TrialUpgradeModal({
  open,
  onClose,
  offer,
  canUpgrade,
  lead,
  onNotNow,
}: {
  open: boolean;
  onClose: () => void;
  offer: TrialUpgradeOffer;
  canUpgrade: boolean;
  /** The lead waiting on an SMS reply, when opened from a conversation. */
  lead?: TrialUpgradeLead | null;
  /** "Not now": the prompt records the dismissal. Defaults to closing. */
  onNotNow?: () => void;
}) {
  const router = useRouter();
  const [plan, setPlan] = React.useState<SelfServePlan>(offer.selectedPlan);
  const [step, setStep] = React.useState<Step>({ kind: "choose" });
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState<{ amountDueMinor: number; currency: string } | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  // Every way out resets the dialog, so the next open starts at the
  // beginning on the plan chosen at checkout.
  function reset() {
    setPlan(offer.selectedPlan);
    setStep({ kind: "choose" });
    setPreview(null);
  }

  function close() {
    reset();
    onClose();
  }

  function notNow() {
    reset();
    (onNotNow ?? onClose)();
  }

  const chosen = planOffer(plan, offer.interval);
  const catalogueAmount = `£${chosen.price.toLocaleString("en-GB")}.00`;
  const amountText = preview ? formatMinorGbp(preview.amountDueMinor, preview.currency) : catalogueAmount;
  const cardText = offer.card
    ? `your ${offer.card.brand.charAt(0).toUpperCase()}${offer.card.brand.slice(1)} ending ${offer.card.last4}`
    : "the card on file";

  async function goToConfirm() {
    setStep({ kind: "confirm", nonce: newNonce() });
    setPreview(null);
    setPreviewLoading(true);
    try {
      const result = await previewTrialUpgradeAction({ plan });
      setPreview(result.ok ? { amountDueMinor: result.amountDueMinor, currency: result.currency } : null);
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirm() {
    if (step.kind !== "confirm" || busy) return;
    setBusy(true);
    try {
      const result = await endTrialNowAction({ plan, nonce: step.nonce });
      if (result.ok) {
        setStep({ kind: "done", result });
      } else {
        setStep({
          kind: "error",
          message: result.error,
          actionUrl: result.actionUrl,
          requiresAction: result.requiresAction,
        });
      }
    } catch {
      setStep({ kind: "error", message: "The upgrade could not be completed. Nothing has been charged; try again." });
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    close();
    router.refresh();
  }

  const title =
    step.kind === "done"
      ? "Your plan has started"
      : lead
        ? "Continue this conversation by SMS"
        : "Upgrade now: start your plan today";

  let footer: React.ReactNode;
  if (step.kind === "choose") {
    footer = (
      <>
        <Button variant="secondary" size="sm" onClick={notNow}>
          Not now
        </Button>
        {canUpgrade ? (
          <Button size="sm" onClick={goToConfirm}>
            Upgrade now
          </Button>
        ) : null}
      </>
    );
  } else if (step.kind === "confirm") {
    footer = (
      <>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => setStep({ kind: "choose" })}>
          Back
        </Button>
        <Button size="sm" loading={busy} disabled={previewLoading} onClick={confirm}>
          {previewLoading ? "Checking amount" : `Confirm and pay ${amountText}`}
        </Button>
      </>
    );
  } else if (step.kind === "done") {
    footer = (
      <Button size="sm" onClick={finish}>
        Done
      </Button>
    );
  } else {
    footer = (
      <>
        <Button variant="secondary" size="sm" onClick={close}>
          Close
        </Button>
        {!step.requiresAction ? (
          <Button size="sm" onClick={() => setStep({ kind: "choose" })}>
            Try again
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : close} title={title} size="md" footer={footer}>
      {step.kind === "choose" ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-brand-midnight px-4 py-3.5 text-white">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-lime text-brand-midnight">
                <MessageSquare className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 space-y-1">
                {lead ? (
                  <>
                    <p className="text-[14px] font-semibold">
                      To continue this conversation fully by SMS, upgrade your subscription now.
                    </p>
                    <p className="text-[13px] text-white/75">
                      Your trial SMS allowance is used up. {lead.name} replied and is waiting.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[14px] font-semibold">End your trial today and start your plan.</p>
                    <p className="text-[13px] text-white/75">
                      The plan&apos;s full limits, including its SMS allowance, switch on straight away.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          <fieldset>
            <legend className="mb-2 text-[12px] font-medium text-content-subtle">
              Plan {plan === offer.selectedPlan ? "(chosen when you started your trial)" : ""}
            </legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
              {SELF_SERVE_PLANS.map((id) => {
                const option = planOffer(id, offer.interval);
                const selected = id === plan;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPlan(id)}
                    className={cn(
                      "rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
                      selected
                        ? "border-brand-midnight bg-accent-50 ring-1 ring-brand-midnight"
                        : "border-line bg-surface hover:bg-surface-hover",
                    )}
                  >
                    <span className="block text-[13px] font-semibold text-content">{option.name}</span>
                    <span className="lr-tabular block text-[12px] text-content-secondary">
                      {priceLabel(option.price, option.interval)}
                    </span>
                    <span className="mt-1 block text-[11px] text-content-muted">
                      {option.smsSegmentAllowance.toLocaleString("en-GB")} SMS segments,{" "}
                      {option.leadLimit.toLocaleString("en-GB")} leads a month
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[12px] text-content-muted">
              Need more?{" "}
              <Link href="/contact-sales" className="font-medium text-content-accent hover:underline">
                Talk to sales about Enterprise
              </Link>
              .
            </p>
          </fieldset>

          <div>
            <p className="text-[12px] font-medium text-content-subtle">{chosen.name} includes</p>
            <ul className="mt-1.5 space-y-1">
              {chosen.features.slice(0, 6).map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success-600" aria-hidden />
                  <span className="text-[13px] text-content-secondary">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {canUpgrade ? (
            <p className="flex items-center gap-1.5 text-[12px] text-content-muted">
              <CreditCard className="size-3.5" aria-hidden />
              Charged to {cardText}. You confirm the amount on the next step.
            </p>
          ) : (
            <p className="rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-[13px] text-content">
              Only the workspace owner can upgrade. Ask them to open this workspace and choose Upgrade now.
            </p>
          )}
        </div>
      ) : null}

      {step.kind === "confirm" ? (
        <div className="space-y-3">
          <p className="text-[14px] text-content">
            {previewLoading ? (
              "Checking today's amount with Stripe…"
            ) : (
              <>
                <span className="font-semibold">{amountText}</span> will be charged to {cardText} now for{" "}
                {chosen.name} ({chosen.interval === "year" ? "annual" : "monthly"} billing).
              </>
            )}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-content-secondary">
            <li>Your trial ends now and {chosen.name}&apos;s limits switch on straight away.</li>
            <li>
              Your plan then renews every {chosen.interval === "year" ? "year" : "month"} from today. Cancel any time
              from Billing.
            </li>
            {!preview && !previewLoading ? (
              <li>The amount shown is the list price; Stripe&apos;s invoice is the final figure.</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {step.kind === "done" ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-content">
            <CheckCircle2 className="size-4 text-success-600" aria-hidden />
            You are on {planOffer(step.result.data.plan, offer.interval).name}.
          </p>
          {step.result.data.status === "already_active" ? (
            <p className="text-[13px] text-content-secondary">
              Your plan was already active, so nothing more was charged.
            </p>
          ) : step.result.data.amountPaidMinor !== null ? (
            <p className="text-[13px] text-content-secondary">
              {formatMinorGbp(step.result.data.amountPaidMinor, step.result.data.currency ?? "gbp")} was charged.
              Stripe emails your receipt.
            </p>
          ) : null}
          <p className="text-[13px] text-content-secondary">
            {step.result.data.released.messagesRequeued > 0
              ? `${step.result.data.released.messagesRequeued === 1 ? "The reply that was waiting is" : `${step.result.data.released.messagesRequeued} replies that were waiting are`} being sent by SMS now.`
              : "SMS replies are back on for your leads."}
          </p>
          {step.result.warning ? <p className="text-[12px] text-content-muted">{step.result.warning}</p> : null}
        </div>
      ) : null}

      {step.kind === "error" ? (
        <div className="space-y-3">
          <p className="flex items-start gap-2 text-[13px] text-content">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger-600" aria-hidden />
            {step.message}
          </p>
          {step.requiresAction && step.actionUrl ? (
            <Button asChild size="sm">
              <a href={step.actionUrl} target="_blank" rel="noopener noreferrer">
                Confirm the payment with your bank
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </Button>
          ) : null}
          {step.requiresAction ? (
            <p className="text-[12px] text-content-muted">
              Your trial continues until the payment is confirmed. Once it is, your plan starts and this page updates
              within a minute.
            </p>
          ) : (
            <p className="text-[12px] text-content-muted">
              Your trial continues unchanged. You can update your card in{" "}
              <a href="/api/billing/portal" className="font-medium text-content-accent hover:underline">
                the billing portal
              </a>
              .
            </p>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
