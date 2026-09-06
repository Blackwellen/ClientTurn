import * as React from "react";
import { requireWorkspace } from "@/lib/auth/session";
import { getBillingView } from "@/lib/settings/queries";
import { listRecentInvoices } from "@/lib/billing/invoices";
import { PermissionDenied } from "@/components/settings/notices";
import { BillingSettings } from "@/components/settings/billing/billing-settings";

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

  const [billing, invoices] = await Promise.all([
    getBillingView(workspace.businessId),
    listRecentInvoices(workspace.businessId),
  ]);

  return (
    <BillingSettings
      billing={billing}
      invoices={invoices.ok ? invoices.invoices : []}
      invoicesError={invoices.ok ? null : invoices.error}
    />
  );
}
