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
  formatPackPrice,
  formatTokens,
  TOKEN_PACK_LIST,
  TOKEN_STATE_LABEL,
  TOKEN_STATE_TONE,
  tokensPerPound,
  type TokenSummary,
} from "@/lib/billing/tokens";
import {
  REFUND_STATE_LABEL,
  type RefundState,
} from "@/lib/billing/refundability";

export type TokenMeterStatus = TokenSummary & {
  periodStart: string;
  periodEnd: string;
  plan: string;
  blocked: boolean;
};

export type TokenPurchaseRow = {
  id: string;
  packKey: string;
  tokens: number;
  amountMinor: number;
  currency: string;
  status: string;
  createdAt: string;
  /**
   * FIFO refund state (refundability.ts): refundable only while none of the
   * pack's tokens have been used. Refunds are issued by the owner in Stripe.
   */
  refundState?: RefundState;
};

/**
 * The AI allowance, and how to buy more.
 *
 * Deliberately shows tokens and conversations — never a cost per token. What
 * a token costs the platform is internal; what a customer needs is how much
 * they have and roughly what it buys them.
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

  const renewal = new Date(status.periodEnd).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={Sparkles}
          title="AI allowance"
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
              {formatTokens(status.remaining)} left
            </span>
            <span className="text-muted text-[12.5px]">
              {formatTokens(status.used)} of {formatTokens(status.granted)} used
            </span>
          </div>

          <div
            className="bg-surface-sunken h-2 w-full overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={status.percentUsed}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="AI allowance used"
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
            Roughly {status.approximateTurnsLeft.toLocaleString("en-GB")} more assistant
            replies. Your included allowance renews on {renewal}.
            {status.purchasedTokens > 0
              ? ` ${formatTokens(status.purchasedTokens)} of that is topped-up tokens, which carry over.`
              : ""}
          </p>
          <p className="text-muted text-[12.5px]">
            This allowance counts AI use in tokens; the separate £ spending limits in{" "}
            <Link
              href="/app/settings?section=ai-selling"
              className="font-medium text-content-accent underline-offset-4 hover:underline"
            >
              AI &amp; selling
            </Link>{" "}
            also apply, and AI stops at whichever limit is reached first while your rules carry on.
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
          <h3 className="text-content mb-2 text-[13px] font-medium">Buy more tokens</h3>
          {!canBuy ? (
            <p className="text-muted text-[12.5px]">
              Only the workspace owner can buy AI tokens.
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
                      {formatTokens(pack.tokens)}
                    </span>
                    {pack.bestValue && <Badge tone="accent">Best value</Badge>}
                  </div>
                  <span className="text-muted mt-0.5 text-[11.5px]">
                    {formatPackPrice(pack)} ·{" "}
                    {formatTokens(tokensPerPound(pack))} per £1
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
            Topped-up tokens are prepaid, never expire and carry over between periods.
            You are never billed for AI use you have not paid for. A pack can be refunded
            only while none of its tokens have been used; your included allowance is always
            used before topped-up tokens.
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
                    {formatTokens(purchase.tokens)} tokens
                  </span>
                  <span className="text-muted">
                    £{(purchase.amountMinor / 100).toFixed(2)} ·{" "}
                    {new Date(purchase.createdAt).toLocaleDateString("en-GB")}
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
          Tokens are consumed by assistant replies, reply interpretation and
          conversation summaries. Deterministic follow-up and qualification never
          consume any.
        </p>
      </CardFooter>
    </Card>
  );
}
