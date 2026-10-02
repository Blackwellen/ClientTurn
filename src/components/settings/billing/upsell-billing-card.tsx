"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { formatCreditAmount } from "@/lib/billing/tokens";
import { whatsappCoverageText, WHATSAPP_TOKEN_RATE_TEXT } from "@/lib/billing/whatsapp-tokens";
import { priceText, type PassiveAddOns } from "@/lib/billing/upsell-moments";
import { setUpgradeSuggestionsAction } from "@/lib/billing/upsell-actions";

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat("en-GB");

/**
 * Settings -> Billing: the passive "add more when you need it" card (never a
 * pop-up, never frequency-capped) and the owner's "Show me upgrade
 * suggestions" switch, which turns every suggestion off, this card included.
 */
export function UpsellBillingCard({
  addOns,
  enabled,
}: {
  /** Null in a trial: no packs are sold until the plan starts. */
  addOns: PassiveAddOns | null;
  enabled: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [on, setOn] = React.useState(enabled);
  const [saving, setSaving] = React.useState(false);

  async function toggle(next: boolean) {
    setOn(next);
    setSaving(true);
    const result = await setUpgradeSuggestionsAction({ enabled: next });
    setSaving(false);
    if (!result.ok) {
      setOn(!next);
      toast({ variant: "error", title: result.error });
      return;
    }
    toast({ variant: "success", title: next ? "Upgrade suggestions on" : "Upgrade suggestions off" });
    router.refresh();
  }

  return (
    <Card id="add-ons" className="scroll-mt-4">
      <CardHeader>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-content">Add more when you need it</h2>
          <p className="mt-0.5 text-[13px] text-content-muted">
            AI credit packs, WhatsApp tokens and plans. No overage: nothing is charged beyond what you choose to buy.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-[13px] text-content-secondary">
        {on && addOns ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-line p-3">
              <p className="font-semibold text-content">AI credit packs</p>
              <ul className="mt-1 space-y-0.5">
                {addOns.tokenPacks.map((pack) => (
                  <li key={pack.key}>
                    {formatCreditAmount(pack.tokens)} for {GBP.format(pack.amountMinor / 100)}
                  </li>
                ))}
              </ul>
              <Link href="#ai-tokens" className="mt-2 inline-block text-content-accent hover:underline">
                Buy AI credits
              </Link>
            </div>
            <div className="rounded-lg border border-line p-3">
              <p className="font-semibold text-content">WhatsApp tokens</p>
              {addOns.whatsappPacks.length ? (
                <>
                  <ul className="mt-1 space-y-0.5">
                    {addOns.whatsappPacks.map((pack) => (
                      <li key={pack.key}>
                        {NUMBER.format(pack.credits)} for {GBP.format(pack.priceGbp)}
                        <span className="block text-[12px] text-content-muted">{whatsappCoverageText(pack.credits)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[12px] text-content-muted">{WHATSAPP_TOKEN_RATE_TEXT}</p>
                  <Link href="#message-credits" className="mt-2 inline-block text-content-accent hover:underline">
                    Buy WhatsApp tokens
                  </Link>
                </>
              ) : (
                <p className="mt-1">
                  Available on {addOns.whatsappUnlockPlan ?? "a higher plan"} and above. {WHATSAPP_TOKEN_RATE_TEXT}
                </p>
              )}
            </div>
            <div className="rounded-lg border border-line p-3">
              <p className="font-semibold text-content">More leads and users</p>
              {addOns.next?.kind === "upgrade" ? (
                <p className="mt-1">
                  {addOns.next.plan.name}: {NUMBER.format(addOns.next.plan.leadLimit)} new leads a month,{" "}
                  {NUMBER.format(addOns.next.plan.userLimit)} users, {formatCreditAmount(addOns.next.plan.aiTokenAllowance)}
                  , {priceText(addOns.next.plan, addOns.next.interval)}. Use the upgrade button in Plan above.
                </p>
              ) : addOns.next?.kind === "contact_sales" ? (
                <p className="mt-1">
                  Enterprise has custom limits.{" "}
                  <Link href="/contact-sales" className="text-content-accent hover:underline">
                    Talk to sales
                  </Link>
                </p>
              ) : (
                <p className="mt-1">You are on the top plan.</p>
              )}
            </div>
          </div>
        ) : null}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--color-primary,#0B1020)]"
            checked={on}
            disabled={saving}
            onChange={(event) => toggle(event.target.checked)}
          />
          <span>
            <span className="font-medium text-content">Show me upgrade suggestions</span>
            <span className="block text-[12px] text-content-muted">
              Occasional, dismissible suggestions when you are near a limit or a lead is waiting. Never during a
              trial, and never while you are writing a message.
            </span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}
