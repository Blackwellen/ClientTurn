"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { startTokenTopUp } from "@/lib/billing/token-actions";
import {
  creditsPerPound,
  formatCredits,
  formatPackPrice,
  TOKEN_PACK_LIST,
  TOKEN_STATE_LABEL,
  TOKEN_STATE_TONE,
  tokensToCredits,
  type CreditSummary,
} from "@/lib/billing/tokens";
import {
  REFUND_STATE_LABEL,
  type RefundState,
} from "@/lib/billing/refundability";
import { formatInZone } from "@/lib/dates";

export type TokenMeterStatus = CreditSummary & {
  periodStart: string;
  periodEnd: string;
  blocked: boolean;
};

export type TokenPurchaseRow = {
  id: string;
  /** The pack in AI credits (converted on the server). */
  credits: number;
  /** The price the customer paid (a price, not a serving cost). */
  amountMinor: number;
  status: string;
  createdAt: string;
  /**
   * FIFO refund state (refundability.ts): refundable only while none of the
   * pack's credits have been used. Refunds are issued by the owner in Stripe.
   */
  refundState?: RefundState;
};

/**
 * The AI allowance in AI credits, and how to buy more.
 *
 * AI credits are ClientTurn's own unit (owner decision, 2026-09-30): never
 * model tokens and never a cost. What a customer needs is how much they have
 * and roughly what it buys them.
 */
export function AiTokenMeter({
  status,
  purchases,
  canBuy,
}: {
  status: TokenMeterStatus;
  purchases: TokenPurchaseRow[];
  /** Buying spends money, so it is the owner's action alone. */
  canBuy: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);

  async function buy(packKey: string) {
    setPending(packKey);
    const result = await startTokenTopUp({ packKey });
    setPending(null);

    if (result.ok) {
      // Full navigation, not a client push: this leaves the app for Stripe.
      window.location.assign(result.url);
    } else {
      toast({ variant: "error", title: result.error });
      router.refresh();
    }
  }

  const renewal = formatInZone(status.periodEnd, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={Sparkles}
          title="AI credits"
          description="What the assistant has used this period, and what is left."
          action={
            <Badge tone={TOKEN_STATE_TONE[status.state] as never}>
              {TOKEN_STATE_LABEL[status.state]}
            </Badge>
          }
        />
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-content text-[15px] font-semibold">
              {formatCredits(status.remainingCredits)} AI credits left
            </span>
            <span className="text-muted text-[12.5px]">
              {formatCredits(status.usedCredits)} of {formatCredits(status.grantedCredits)} used ({status.percentUsed}%)
            </span>
          </div>

          <div
            className="bg-surface-sunken h-2 w-full overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={status.percentUsed}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="AI credits used"
          >
            <div
              className={
                status.state === "EXHAUSTED" || status.state === "CRITICAL"
                  ? "bg-danger-500 h-full rounded-full"
                  : status.state === "APPROACHING"
                    ? "bg-warning-500 h-full rounded-full"
                    : "bg-accent-500 h-full rounded-full"
              }
              style={{ width: `${status.percentUsed}%` }}
            />
          </div>

          <p className="text-muted text-[12.5px]">
            Roughly {status.approximateRepliesLeft.toLocaleString("en-GB")} more assistant
            replies. Your {formatCredits(status.includedCredits)} included credits renew on {renewal}.
            {status.topUpBalanceCredits > 0
              ? ` ${formatCredits(status.topUpBalanceCredits)} of what is left are topped-up credits, which carry over.`
              : ""}
          </p>
          <p className="text-muted text-[12.5px]">
            Your own AI credit limits (per workspace, per lead) are in{" "}
            <Link
              href="/app/settings?section=ai-selling"
              className="font-medium text-content-accent underline-offset-4 hover:underline"
            >
              AI &amp; selling
            </Link>
            ; AI stops at whichever limit is reached first while your rules carry on.
          </p>
        </div>

        {status.blocked && (
          <div className="border-danger-300 bg-danger-50/60 rounded-lg border p-3">
            <p className="text-content text-[12.5px] leading-relaxed">
              <strong>The assistant has paused.</strong> Your follow-up sequences and
              qualification rules are still running exactly as configured. Only the AI
              wording and interpretation stop. Top up to switch it back on.
            </p>
          </div>
        )}

        <div>
          <h3 className="text-content mb-2 text-[13px] font-medium">Buy more AI credits</h3>
          {!canBuy ? (
            <p className="text-muted text-[12.5px]">
              Only the workspace owner can buy AI credits.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {TOKEN_PACK_LIST.map((pack) => (
                <div
                  key={pack.key}
                  className="border-line bg-surface flex flex-col rounded-lg border p-3"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-content text-[13px] font-semibold">
                      {formatCredits(tokensToCredits(pack.tokens))} credits
                    </span>
                    {pack.bestValue && <Badge tone="accent">Best value</Badge>}
                  </div>
                  <span className="text-muted mt-0.5 text-[11.5px]">
                    {formatPackPrice(pack)} ·{" "}
                    {creditsPerPound(pack).toLocaleString("en-GB")} credits per £1
                  </span>
                  <p className="text-muted mt-1 flex-1 text-[11.5px] leading-relaxed">
                    {pack.description}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-2"
                    disabled={pending !== null}
                    onClick={() => buy(pack.key)}
                  >
                    <Zap className="size-3.5" />
                    {pending === pack.key ? "Opening…" : "Buy"}
                  </Button>
                  <p className="text-muted mt-1 text-[11px]">Non-refundable once any credit is used.</p>
                </div>
              ))}
            </div>
          )}
          <p className="text-muted mt-2 text-[11.5px]">
            Topped-up AI credits are prepaid, never expire and carry over between periods.
            You are never billed for AI use you have not paid for. A pack can be refunded
            only while none of its credits have been used; your included credits are always
            used before topped-up credits.
          </p>
        </div>

        {purchases.length > 0 && (
          <div>
            <h3 className="text-content mb-2 text-[13px] font-medium">Recent top-ups</h3>
            <ul className="divide-line divide-y">
              {purchases.slice(0, 5).map((purchase) => (
                <li
                  key={purchase.id}
                  className="flex items-center justify-between gap-3 py-1.5 text-[12.5px]"
                >
                  <span className="text-content">
                    {formatCredits(purchase.credits)} AI credits
                  </span>
                  <span className="text-muted">
                    £{(purchase.amountMinor / 100).toFixed(2)} ·{" "}
                    {formatInZone(purchase.createdAt, "date")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Badge
                      tone={
                        purchase.status === "PAID"
                          ? "success"
                          : purchase.status === "PENDING"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {purchase.status.toLowerCase()}
                    </Badge>
                    {purchase.status === "PAID" &&
                      (purchase.refundState === "refundable" ||
                        purchase.refundState === "in_use") && (
                        <Badge tone="neutral">
                          {REFUND_STATE_LABEL[purchase.refundState]}
                        </Badge>
                      )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <CardFooter>
        <p className="text-muted text-[11.5px]">
          AI credits are used by assistant replies, reply interpretation and
          conversation summaries. Deterministic follow-up and qualification never
          use any.
        </p>
      </CardFooter>
    </Card>
  );
}
