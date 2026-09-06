import * as React from "react";
import { requireWorkspace } from "@/lib/auth/session";
import { getBillingView } from "@/lib/settings/queries";
import { listRecentInvoices } from "@/lib/billing/invoices";
import { PermissionDenied } from "@/components/settings/notices";
import { BillingSettings } from "@/components/settings/billing/billing-settings";
import { AiTokenMeter } from "@/components/settings/ai-token-meter";
import { getTokenStatus, listTokenPurchases } from "@/lib/billing/token-service";

export async function BillingSection() {
  const workspace = await requireWorkspace();

  // Billing is owner-only, enforced here and again in every billing action.
  if (workspace.role !== "owner") {
    return (
      <PermissionDenied
        title="Billing is owner-only"
        description="Only the workspace owner can see plan details, usage against limits and invoices. Ask them if you need a change to the plan."
      />
    );
  }

  const [billing, invoices, tokenStatus, tokenPurchases] = await Promise.all([
    getBillingView(workspace.businessId),
    listRecentInvoices(workspace.businessId),
    getTokenStatus(workspace.businessId),
    listTokenPurchases(workspace.businessId),
  ]);

  return (
    <div className="space-y-5">
      <BillingSettings
        billing={billing}
        invoices={invoices.ok ? invoices.invoices : []}
        invoicesError={invoices.ok ? null : invoices.error}
      />
      {/* The AI allowance sits with billing because that is where someone
          goes when they want more of something. */}
      <AiTokenMeter
        status={tokenStatus}
        purchases={tokenPurchases}
        canBuy={workspace.role === "owner"}
      />
    </div>
  );
}
