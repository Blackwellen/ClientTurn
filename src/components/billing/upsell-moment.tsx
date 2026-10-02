"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatCreditAmount } from "@/lib/billing/tokens";
import { whatsappCoverageText } from "@/lib/billing/whatsapp-tokens";
import { momentId, priceText, type UpsellCta, type UpsellMoment as Moment } from "@/lib/billing/upsell-moments";
import { recordUpsellEventAction } from "@/lib/billing/upsell-actions";
import { startTokenTopUp } from "@/lib/billing/token-actions";
import { startCreditPurchase } from "@/lib/billing/checkout-actions";
import { startPlanCheckout } from "@/lib/settings/actions";

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat("en-GB");

/** The button label for an offer, from the catalogue values it carries. */
export function ctaLabel(cta: UpsellCta): string {
  switch (cta.kind) {
    case "token_pack":
      return `Buy ${formatCreditAmount(cta.pack.tokens)} for ${GBP.format(cta.pack.amountMinor / 100)}`;
    case "whatsapp_pack":
      return `Buy ${NUMBER.format(cta.bundle.credits)} WhatsApp tokens for ${GBP.format(cta.bundle.priceGbp)}`;
    case "upgrade":
      return `Upgrade to ${cta.plan.name}`;
    case "contact_sales":
      return "Talk to sales";
  }
}

function fire(moment: Moment, event: "impression" | "click" | "dismiss") {
  void recordUpsellEventAction({
    moment: momentId(moment),
    offer: moment.offer,
    surface: moment.surface,
    event,
  }).catch(() => undefined);
}

/**
 * One upsell suggestion (upsell-moments.ts decided it on the server): a
 * banner, an inline card or, for a real blocker only, a modal. "Not now"
 * snoozes it for 30 days. Buying goes through the existing checkouts; an
 * upgrade asks for a confirmation that says what is charged first.
 */
export function UpsellMoment({ moment, canBuy }: { moment: Moment; canBuy: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [hidden, setHidden] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(moment.surface === "modal");
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    fire(moment, "impression");
    // Once per mount: the server dedupes to one impression a day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    fire(moment, "dismiss");
    setModalOpen(false);
    setHidden(true);
  }

  async function act() {
    const cta = moment.cta;
    if (cta.kind === "contact_sales") {
      fire(moment, "click");
      router.push("/contact-sales");
      return;
    }
    if (cta.kind === "upgrade" && !confirming) {
      setConfirming(true);
      return;
    }
    fire(moment, "click");
    setBusy(true);
    try {
      const result =
        cta.kind === "token_pack"
          ? await startTokenTopUp({ packKey: cta.pack.key })
          : cta.kind === "whatsapp_pack"
            ? await startCreditPurchase({ bundleKey: cta.bundle.key })
            : // No interval: a live subscription keeps its own (annual stays annual).
              await startPlanCheckout({ plan: cta.plan.id });
      if (result.ok) {
        window.location.assign(result.url);
      } else {
        toast({ variant: "error", title: "Could not continue", description: result.error });
      }
    } finally {
      setBusy(false);
    }
  }

  if (hidden) return null;

  const cta = moment.cta;
  const detail =
    cta.kind === "whatsapp_pack"
      ? `${whatsappCoverageText(cta.bundle.credits)}. WhatsApp tokens never expire; a pack is not refundable once any of its tokens are used.`
      : cta.kind === "token_pack"
        ? "Bought AI credits never expire; a pack is not refundable once any of its credits are used."
        : null;
  const confirmText =
    cta.kind === "upgrade"
      ? `${cta.plan.name} is ${priceText(cta.plan, cta.interval)}. The upgrade applies now and the difference is charged pro rata today on your card on file. Your billing interval stays the same.`
      : null;

  const actions = canBuy ? (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={act} loading={busy}>
        {confirming ? "Confirm upgrade" : ctaLabel(cta)}
      </Button>
      {confirming ? (
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Back
        </Button>
      ) : null}
      <Link href="/app/settings?section=billing" className="text-[12px] underline underline-offset-2 opacity-80">
        See all options
      </Link>
    </div>
  ) : (
    <p className="text-[12px] opacity-80">The workspace owner can buy this in Settings, Billing.</p>
  );

  if (moment.surface === "modal") {
    return (
      <>
        <Banner moment={moment} onDismiss={dismiss} onOpen={() => setModalOpen(true)} canBuy={canBuy} />
        <Modal
          open={modalOpen}
          onClose={dismiss}
          title={moment.title}
          description={moment.body}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                Not now
              </Button>
              {canBuy ? (
                <Button size="sm" onClick={act} loading={busy}>
                  {confirming ? "Confirm upgrade" : ctaLabel(cta)}
                </Button>
              ) : null}
            </>
          }
        >
          {detail ? <p>{detail}</p> : null}
          {confirming && confirmText ? <p className="mt-2 font-medium text-content">{confirmText}</p> : null}
          {!canBuy ? <p className="mt-2">The workspace owner can buy this in Settings, Billing.</p> : null}
        </Modal>
      </>
    );
  }

  if (moment.surface === "card") {
    return (
      <Card className="flex flex-wrap items-start gap-3 px-4 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-lime text-brand-midnight">
          <Sparkles className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-content">{moment.title}</p>
          <p className="mt-0.5 text-[13px] text-content-secondary">{moment.body}</p>
          {canBuy ? (
            <Link
              href="/app/settings?section=billing"
              onClick={() => fire(moment, "click")}
              className="mt-1 inline-block text-[12px] text-content-accent underline-offset-4 hover:underline"
            >
              Compare plans
            </Link>
          ) : null}
        </div>
        <IconButton size="sm" label="Not now" onClick={dismiss}>
          <X className="size-4" />
        </IconButton>
      </Card>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-3 rounded-lg border border-brand-midnight/15 bg-brand-midnight px-4 py-3 text-white"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-lime text-brand-midnight">
        <Sparkles className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="font-semibold">{moment.title}</p>
        <p className="mt-0.5 text-white/75">{moment.body}</p>
        {confirming && confirmText ? <p className="mt-1 text-white">{confirmText}</p> : null}
        <div className="mt-2">{actions}</div>
      </div>
      <IconButton size="sm" label="Not now" onClick={dismiss} className="text-white/70 hover:text-white">
        <X className="size-4" />
      </IconButton>
    </div>
  );
}

/** The always-visible form of a modal moment: reopens it, and can be snoozed. */
function Banner({
  moment,
  onDismiss,
  onOpen,
  canBuy,
}: {
  moment: Moment;
  onDismiss: () => void;
  onOpen: () => void;
  canBuy: boolean;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-midnight/15 bg-brand-midnight px-4 py-3 text-white"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-lime text-brand-midnight">
        <Sparkles className="size-3.5" aria-hidden />
      </span>
      <p className="min-w-0 flex-1 text-[13px] font-semibold">{moment.title}</p>
      <Button size="sm" onClick={onOpen}>
        {canBuy ? "See options" : "Details"}
      </Button>
      <IconButton size="sm" label="Not now" onClick={onDismiss} className="text-white/70 hover:text-white">
        <X className="size-4" />
      </IconButton>
    </div>
  );
}
