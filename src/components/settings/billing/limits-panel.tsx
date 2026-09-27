"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Gauge, MessageSquarePlus, Rocket, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { formatDate } from "@/lib/dates";
import { startCreditPurchase } from "@/lib/billing/checkout-actions";
import { startPlanCheckout } from "@/lib/settings/actions";
import {
  TRIAL_CREDIT_PURCHASE_REFUSAL,
  creditBundlesFor,
  type MessageCreditChannel,
} from "@/lib/billing/plans";
import type { LimitLevel, UpsellOffer } from "@/lib/billing/limits";
import type { AllowanceAlert } from "@/lib/billing/allowance-alerts";
import { REFUND_STATE_LABEL, TOP_UP_REFUND_NOTICE, type RefundState } from "@/lib/billing/refundability";
import {
  WHATSAPP_TOKEN_NATURE,
  WHATSAPP_TOKEN_RATE_TEXT,
  whatsappCoverageText,
} from "@/lib/billing/whatsapp-tokens";

/** Mirrors `LimitRow` from limits-service, which is server-only. */
export type LimitRowView = {
  key: string;
  label: string;
  unit: string;
  monthly: { used: number; limit: number; percent: number; level: LimitLevel };
  daily: { used: number; cap: number } | null;
  credits: number | null;
  atLimit: string;
  upsell: UpsellOffer | null;
  /** SMS / WhatsApp running low from 75% (allowance-alerts.ts). */
  alert?: AllowanceAlert | null;
};

export type CreditPurchaseView = {
  id: string;
  bundleKey: string;
  channel: MessageCreditChannel;
  credits: number;
  amountMinor: number;
  currency: string;
  status: string;
  createdAt: string;
  /** FIFO refundability (billing/refundability.ts), from listCreditPurchases. */
  refundState?: RefundState;
};

const NUMBER = new Intl.NumberFormat("en-GB");
const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

const LEVEL_TONE: Record<LimitLevel, "accent" | "warning" | "danger"> = {
  ok: "accent",
  warning: "warning",
  reached: "danger",
};

const PURCHASE_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  PAID: "success",
  PENDING: "warning",
  EXPIRED: "neutral",
  FAILED: "danger",
  REFUNDED: "neutral",
};

/**
 * Usage & limits (8.13): every metered limit with this period's and today's
 * usage against it, remaining top-up credit, and what happens at the limit.
 * Upsells (8.11) appear only at 80% / 100% of a limit, and only offer an
 * upgrade that genuinely raises that limit. The server enforces all of this
 * at send time; this is only the view.
 */
export function LimitsPanel({
  rows,
  credits,
  purchases,
  canBuy,
  whatsappEnabled,
  preselectedBundle = null,
  trial = false,
}: {
  rows: LimitRowView[];
  credits: Record<MessageCreditChannel, number>;
  purchases: CreditPurchaseView[];
  canBuy: boolean;
  /** The plan includes WhatsApp; without it, WhatsApp token packs are not offered. */
  whatsappEnabled: boolean;
  /** A pack to highlight, from a running-low prompt's link (`?bundle=`). */
  preselectedBundle?: string | null;
  /**
   * In a trial no packs are sold (createCreditCheckout refuses them); the
   * path is "Upgrade now" in the plan card above.
   */
  trial?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);

  // Arriving from "Buy SMS credits": bring the pre-selected pack into view
  // and put focus on its Buy button, so one more click starts checkout.
  React.useEffect(() => {
    if (!preselectedBundle) return;
    const card = document.getElementById(`bundle-${preselectedBundle}`);
    card?.scrollIntoView({ block: "center" });
    card?.querySelector("button")?.focus({ preventScroll: true });
  }, [preselectedBundle]);

  async function buy(bundleKey: string) {
    setPending(bundleKey);
    const result = await startCreditPurchase({ bundleKey });
    if (result.ok) {
      window.location.assign(result.url);
      return;
    }
    setPending(null);
    toast({ variant: "error", title: "Checkout could not start", description: result.error });
  }

  async function upgrade(plan: string) {
    if (plan === "enterprise") {
      router.push("/contact-sales");
      return;
    }
    setPending(`plan:${plan}`);
    // No interval: the server keeps the subscription's own (annual stays annual).
    const result = await startPlanCheckout({ plan });
    setPending(null);
    if (result.ok) {
      window.location.assign(result.url);
      return;
    }
    toast({ variant: "error", title: "Could not change plan", description: result.error });
  }

  return (
    <div className="space-y-4">
      <Card id="usage-limits">
        <CardHeader>
          <SectionHeader
            icon={Gauge}
            title="Usage & limits"
            description="Every limit on your plan, this period and today. Limits are enforced when a message is sent, not just shown here."
          />
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Limit</TableHead>
                <TableHead>This period</TableHead>
                <TableHead>Today</TableHead>
                <TableHead numeric>Top-up credit</TableHead>
                <TableHead>At the limit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <React.Fragment key={row.key}>
                  <TableRow>
                    <TableCell>
                      <span className="font-medium text-content">{row.label}</span>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-[160px]">
                        <Progress
                          value={row.monthly.used}
                          max={Math.max(row.monthly.limit, 1)}
                          tone={LEVEL_TONE[row.monthly.level]}
                          label={`${row.label} this period`}
                        />
                        <p className="lr-tabular mt-1 text-[12px] text-content-muted">
                          {NUMBER.format(row.monthly.used)} of {NUMBER.format(row.monthly.limit)} {row.unit}
                          {row.monthly.limit > 0 ? ` (${row.monthly.percent}%)` : ""}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.daily ? (
                        <span className="lr-tabular text-[13px] text-content-secondary">
                          {NUMBER.format(row.daily.used)} of {NUMBER.format(row.daily.cap)} messages
                        </span>
                      ) : (
                        <span className="text-[12px] text-content-subtle">No daily limit</span>
                      )}
                    </TableCell>
                    <TableCell numeric>
                      {row.credits === null ? (
                        <span className="text-[12px] text-content-subtle">—</span>
                      ) : (
                        <span className="lr-tabular">{NUMBER.format(row.credits)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-[12px] text-content-muted">{row.atLimit}</span>
                    </TableCell>
                  </TableRow>
                  {row.upsell ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <UpsellCard
                          label={row.label}
                          alert={row.alert ?? null}
                          upsell={row.upsell}
                          unit={row.unit}
                          canBuy={canBuy}
                          pending={pending}
                          onBuy={buy}
                          onUpgrade={upgrade}
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
          <p className="border-t border-line px-5 py-3 text-[12px] text-content-muted">
            Order of use on SMS: your monthly allowance first, then top-up credit. WhatsApp is a paid
            add-on with no included messages, so every message uses WhatsApp tokens. {WHATSAPP_TOKEN_RATE_TEXT}{" "}
            With none left, sending on that channel stops; there are no extra charges past what you have bought.{" "}Daily limits count messages, reset at 00:05 UTC, and apply to automated and campaign
            sends, not to replies you type yourself.
          </p>
        </CardContent>
      </Card>

      <Card id="message-credits" className="scroll-mt-4">
        <CardHeader>
          <SectionHeader
            icon={MessageSquarePlus}
            title="Message credits"
            description="SMS top-up credit is used after your monthly allowance. WhatsApp is paid in WhatsApp tokens. Neither expires."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {(["sms", "whatsapp"] as const).map((channel) => (
              <div key={channel} className="rounded-xl border border-line bg-surface px-4 py-3">
                <p className="text-[12px] text-content-subtle">
                  {channel === "sms" ? "SMS credit (segments)" : "WhatsApp tokens"}
                </p>
                <p className="lr-tabular text-[22px] font-semibold text-content">
                  {NUMBER.format(credits[channel])}
                </p>
                {channel === "whatsapp" && credits.whatsapp > 0 ? (
                  <p className="text-[12px] text-content-muted">{whatsappCoverageText(credits.whatsapp)}</p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {trial ? (
              <p className="text-[12.5px] text-content-secondary sm:col-span-2 xl:col-span-3">
                {TRIAL_CREDIT_PURCHASE_REFUSAL}
              </p>
            ) : null}
            {(trial ? [] : creditBundlesFor({ whatsappEnabled })).map((bundle) => {
              const selected = bundle.key === preselectedBundle;
              return (
              <div
                key={bundle.key}
                id={`bundle-${bundle.key}`}
                aria-current={selected ? "true" : undefined}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
                  selected ? "border-content-accent ring-2 ring-content-accent/30" : "border-line"
                }`}
              >
                <div>
                  <p className="text-[13px] font-medium text-content">
                    {NUMBER.format(bundle.credits)} {bundle.channel === "sms" ? "SMS segments" : "WhatsApp tokens"}
                    {selected ? (
                      <Badge tone="accent" className="ml-2">
                        Recommended
                      </Badge>
                    ) : null}
                  </p>
                  <p className="lr-tabular text-[12px] text-content-muted">
                    {bundle.channel === "sms"
                      ? `${GBP.format(bundle.priceGbp)} · ${((bundle.priceGbp * 100) / bundle.credits).toFixed(1)}p each`
                      : `${GBP.format(bundle.priceGbp)} · ${whatsappCoverageText(bundle.credits)}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={selected ? "primary" : "secondary"}
                  disabled={!canBuy || pending !== null}
                  loading={pending === bundle.key}
                  onClick={() => buy(bundle.key)}
                >
                  <ShoppingCart className="size-3.5" aria-hidden />
                  Buy
                </Button>
              </div>
              );
            })}
          </div>
          {!whatsappEnabled ? (
            <p className="text-[12px] text-content-subtle">
              WhatsApp is a paid add-on on Growth and above; WhatsApp token packs are offered on those plans.
            </p>
          ) : !trial ? (
            <p className="text-[12px] text-content-muted">
              {WHATSAPP_TOKEN_RATE_TEXT} {WHATSAPP_TOKEN_NATURE}
            </p>
          ) : null}
          {!trial ? <p className="text-[12px] text-content-muted">{TOP_UP_REFUND_NOTICE}</p> : null}
          {!canBuy && !trial ? (
            <p className="text-[12px] text-content-subtle">Only the workspace owner can buy credits.</p>
          ) : null}

          <div>
            <p className="mb-2 text-[13px] font-semibold text-content">Purchase history</p>
            {purchases.length === 0 ? (
              <p className="text-[12px] text-content-muted">No credit purchases yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Credits</TableHead>
                    <TableHead numeric>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Refund</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((purchase) => (
                    <TableRow key={purchase.id}>
                      <TableCell>{formatDate(purchase.createdAt)}</TableCell>
                      <TableCell>
                        {NUMBER.format(purchase.credits)} {purchase.channel === "sms" ? "SMS" : "WhatsApp tokens"}
                      </TableCell>
                      <TableCell numeric>{GBP.format(purchase.amountMinor / 100)}</TableCell>
                      <TableCell>
                        <Badge tone={PURCHASE_TONE[purchase.status] ?? "neutral"} dot>
                          {purchase.status.charAt(0) + purchase.status.slice(1).toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {purchase.refundState ? (
                          <span
                            className={`text-[12px] ${
                              purchase.refundState === "refundable" ? "text-content-secondary" : "text-content-muted"
                            }`}
                          >
                            {REFUND_STATE_LABEL[purchase.refundState]}
                          </span>
                        ) : (
                          <span className="text-[12px] text-content-subtle">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="mt-2 text-[12px] text-content-muted">
              Receipts are emailed by Stripe and listed with your invoices in the billing portal.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UpsellCard({
  label,
  alert,
  unit,
  upsell,
  canBuy,
  pending,
  onBuy,
  onUpgrade,
}: {
  label: string;
  alert: AllowanceAlert | null;
  unit: string;
  upsell: UpsellOffer;
  canBuy: boolean;
  pending: string | null;
  onBuy: (key: string) => void;
  onUpgrade: (plan: string) => void;
}) {
  const reached = upsell.level === "reached";
  // SMS / WhatsApp: the running-low alert decides the copy and the pack. A
  // trial has no packs: it is pointed at its plan instead.
  const trial = alert?.trial ?? false;
  const recommended = alert?.recommended ?? null;
  const topUps = trial
    ? []
    : recommended
      ? [recommended, ...upsell.topUps.filter((bundle) => bundle.key !== recommended.key)].slice(0, 2)
      : upsell.topUps.slice(0, 2);
  if (!upsell.upgrade && topUps.length === 0 && !trial) return null;

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        reached ? "border-danger-100 bg-danger-50" : "border-warning-100 bg-warning-50"
      }`}
    >
      <p className={`text-[13px] font-semibold ${reached ? "text-danger-700" : "text-warning-700"}`}>
        {alert ? alert.title : reached ? `${label}: limit reached` : `${label}: over 80% used`}
      </p>
      {alert ? <p className="mt-0.5 text-[12px] text-content-secondary">{alert.body}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {trial && alert ? (
          <a
            href={alert.action.href}
            className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium text-content hover:bg-surface-hover"
          >
            {alert.action.label}
          </a>
        ) : null}
        {upsell.upgrade ? (
          <Button
            size="sm"
            disabled={!canBuy || pending !== null}
            loading={pending === `plan:${upsell.upgrade.plan.id}`}
            onClick={() => onUpgrade(upsell.upgrade!.plan.id)}
          >
            <Rocket className="size-3.5" aria-hidden />
            {upsell.upgrade.plan.monthlyPrice === null
              ? `Talk to us about ${upsell.upgrade.plan.name}`
              : `${upsell.upgrade.plan.name}: ${NUMBER.format(upsell.upgrade.newLimit)} ${unit} for ${GBP.format(upsell.upgrade.plan.monthlyPrice)}/month`}
          </Button>
        ) : null}
        {topUps.map((bundle) => (
          <Button
            key={bundle.key}
            size="sm"
            variant={bundle.key === recommended?.key ? "primary" : "secondary"}
            disabled={!canBuy || pending !== null}
            loading={pending === bundle.key}
            onClick={() => onBuy(bundle.key)}
          >
            {bundle.key === recommended?.key ? "Buy " : "Add "}
            {NUMBER.format(bundle.credits)} for {GBP.format(bundle.priceGbp)}
          </Button>
        ))}
      </div>
      {topUps.length > 0 ? (
        <p className="mt-1.5 text-[11.5px] text-content-muted">{TOP_UP_REFUND_NOTICE}</p>
      ) : null}
    </div>
  );
}
