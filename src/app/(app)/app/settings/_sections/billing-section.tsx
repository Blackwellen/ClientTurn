import { workspaceCan } from "@/lib/auth/permissions";
import * as React from "react";
import { requireWorkspace } from "@/lib/auth/session";
import { getBillingView } from "@/lib/settings/queries";
import { listRecentInvoices } from "@/lib/billing/invoices";
import { PermissionDenied } from "@/components/settings/notices";
import { BillingSettings } from "@/components/settings/billing/billing-settings";
import { AiTokenMeter } from "@/components/settings/ai-token-meter";
import { getCreditStatus, listTokenPurchases } from "@/lib/billing/token-service";
import { getUsageOverview } from "@/lib/billing/usage-service";
import { UsagePanel } from "@/components/settings/billing/usage-panel";
import { getLimitsOverview } from "@/lib/billing/limits-service";
import { listCreditPurchases } from "@/lib/billing/message-credits";
import { LimitsPanel } from "@/components/settings/billing/limits-panel";
import { creditBundlesFor } from "@/lib/billing/plans";
import { parseBundleParam } from "@/lib/billing/allowance-alerts";
import { UpsellBillingCard } from "@/components/settings/billing/upsell-billing-card";
import { passiveAddOns } from "@/lib/billing/upsell-moments";
import { upgradeSuggestionsEnabled } from "@/lib/billing/upsell-service";
import { TOKEN_PACK_LIST, tokensToCredits } from "@/lib/billing/tokens";

export async function BillingSection({
  bundle,
}: {
  /** `?bundle=` from a running-low prompt: the pack to pre-select. */
  bundle?: string | string[];
} = {}) {
  const workspace = await requireWorkspace();

  // Billing is the owner's, or an admin's the owner delegated it to (0172),
  // enforced here and again in every billing action.
  const canManageBilling = await workspaceCan(workspace, "manage_billing");
  if (!canManageBilling) {
    return (
      <PermissionDenied
        title="Billing is restricted"
        description="Only the workspace owner, or an admin they have given billing permission to, can see plan details, usage against limits and invoices. Ask the owner if you need a change to the plan."
      />
    );
  }

  const [billing, invoices, creditStatus, tokenPurchases, usage, limits, creditPurchases, suggestionsOn] =
    await Promise.all([
      getBillingView(workspace.businessId),
      listRecentInvoices(workspace.businessId),
      getCreditStatus(workspace.businessId),
      listTokenPurchases(workspace.businessId),
      getUsageOverview(workspace.businessId),
      getLimitsOverview(workspace.businessId),
      listCreditPurchases(workspace.businessId),
      upgradeSuggestionsEnabled(workspace.businessId),
    ]);

  return (
    <div className="space-y-5">
      <BillingSettings
        billing={billing}
        invoices={invoices.ok ? invoices.invoices : []}
        invoicesError={invoices.ok ? null : invoices.error}
      />
      {/* Every metered limit, daily and monthly, with credit and what happens
          at the limit (8.13); upsells at 80% / 100% only (8.11), and from 75% on
          SMS / WhatsApp (allowance-alerts.ts). */}
      <LimitsPanel
        rows={limits.rows}
        credits={limits.credits}
        purchases={creditPurchases}
        canBuy={canManageBilling}
        whatsappEnabled={limits.whatsappEnabled}
        // Only a pack this workspace can buy is pre-selected; in a trial
        // there are none (packs start with the plan).
        trial={limits.plan === "trial"}
        preselectedBundle={
          limits.plan === "trial"
            ? null
            : parseBundleParam(bundle, creditBundlesFor({ whatsappEnabled: limits.whatsappEnabled }))
        }
      />
      {/* Allocation, caps and history (V4 §27). Every control here is
          a narrowing of what the plan already grants: the server re-derives
          each ceiling and clamps to it rather than trusting the form. */}
      <UsagePanel usage={usage} canManage />

      {/* The AI allowance sits with billing because that is where someone
          goes when they want more of something. */}
      <div id="ai-tokens" className="scroll-mt-4">
        <AiTokenMeter
          status={creditStatus}
          // Credits only reach the browser: never the ledger's model tokens.
          purchases={tokenPurchases.map((purchase) => ({
            id: purchase.id,
            credits: tokensToCredits(purchase.tokens),
            amountMinor: purchase.amountMinor,
            status: purchase.status,
            createdAt: purchase.createdAt,
            refundState: purchase.refundState,
          }))}
          canBuy={canManageBilling}
        />
      </div>

      {/* Passive add-ons card (never a pop-up) and the owner's "Show me
          upgrade suggestions" switch (docs/upsell-plan.md). */}
      <UpsellBillingCard
        enabled={suggestionsOn}
        addOns={passiveAddOns({
          plan: limits.plan,
          state: limits.state,
          whatsappEnabled: limits.whatsappEnabled,
          billingInterval: billing.billingInterval === "year" ? "year" : "month",
          tokenPacks: TOKEN_PACK_LIST,
        })}
      />
    </div>
  );
}
