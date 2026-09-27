import * as React from "react";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { catalogueCheckoutLinks, loadQuoteSettingsView } from "@/lib/quotes/queries";
import { settingsGaps } from "@/lib/quotes/settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanLimitState } from "@/components/ui/feedback";
import { ReadOnlyNotice } from "@/components/settings/notices";
import { SectionLoadError } from "@/components/settings/ai-selling/section-load-error";
import { QuoteSettingsForm } from "@/components/settings/quotes/quote-settings-form";
import { CatalogueCard } from "@/components/settings/quotes/catalogue-card";

/**
 * Settings -> Quotes & invoices (gap map §44). One Settings section, not a
 * new destination (V3: Settings stays one of the five). Cards in the order a
 * workspace sets them up: the business on the document and the quote
 * defaults (numbering, signatures, reminders and approvals behind "More
 * options"), the catalogue, then how customers pay.
 *
 * States: plan-limit (quotes are on every paid plan, not the trial), a
 * load error, read-only for members and viewers (pricing and legal settings
 * are owner/admin, enforced again by quote_settings.update and catalogue.*),
 * an empty catalogue, and integration-required when there is no payment link.
 */
export async function QuotesSection() {
  const workspace = await requireWorkspace();
  const canManage = hasRole(workspace.role, "admin");

  let view: Awaited<ReturnType<typeof loadQuoteSettingsView>>;
  let checkoutByItem: Record<string, string | null>;
  try {
    [view, checkoutByItem] = await Promise.all([
      loadQuoteSettingsView(workspace.businessId, canManage),
      catalogueCheckoutLinks(workspace.businessId),
    ]);
  } catch (error) {
    console.error("[settings: quotes] read failed", error);
    return <SectionLoadError title="Quotes & invoices" href="/app/settings?section=quotes" />;
  }

  const { builder, esign, approvals, invoicing } = view.capabilities;
  if (!builder.allowed) {
    return (
      <PlanLimitState
        title="Quotes, e-signatures and invoicing are on every paid plan"
        description={builder.message ?? "Choose a plan to build quotes from your catalogue, collect signatures and send invoices."}
        action={
          <Link href="/app/settings?section=billing" className="text-[13px] font-medium text-content-accent underline-offset-4 hover:underline">
            See plans
          </Link>
        }
      />
    );
  }

  const gaps = settingsGaps(view.settings, view.business.name);

  return (
    <div className="space-y-4">
      {!canManage && (
        <ReadOnlyNotice message="Only an owner or admin can change prices, VAT, terms and approvals. You can see every setting here, and build quotes from a lead." />
      )}
      {gaps.length > 0 && canManage && (
        <div role="status" className="rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-[13px] text-warning-700">
          <span className="font-semibold">Before you send quotes:</span> add {gaps.join(", ").toLowerCase()}.
        </div>
      )}

      <QuoteSettingsForm
        settings={view.settings}
        business={view.business}
        canEdit={canManage}
        esign={{ allowed: esign.allowed, message: esign.message }}
        approvals={{ allowed: approvals.allowed, message: approvals.message }}
      />

      <CatalogueCard
        currency={view.settings.currency}
        items={view.catalogue.items}
        bundles={view.catalogue.bundles}
        checkoutLinks={view.checkoutLinks}
        checkoutByItem={checkoutByItem}
        canEdit={canManage}
        showCost={canManage}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Payment</CardTitle>
            <CardDescription>How a customer pays after accepting a quote, and how invoices are chased.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-[13px] text-content-secondary">
          {view.checkoutLinks.length === 0 ? (
            <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-sunken px-4 py-3" role="status">
              <CreditCard className="mt-0.5 size-4 shrink-0 text-content-muted" aria-hidden />
              <div>
                <p className="font-semibold text-content">No payment link connected</p>
                <p className="mt-0.5">
                  Customers can accept quotes, but there is no pay-now step yet. Add your own Stripe or shop checkout link under{" "}
                  <Link href="/app/settings?section=business-profile" className="font-medium text-content-accent underline-offset-4 hover:underline">Business Profile, Direct close</Link>
                  {" "}and confirm payments by connecting your payment webhook in{" "}
                  <Link href="/app/settings?section=connections" className="font-medium text-content-accent underline-offset-4 hover:underline">Connections</Link>.
                </p>
              </div>
            </div>
          ) : (
            <p>
              {view.checkoutLinks.length} approved checkout link{view.checkoutLinks.length === 1 ? "" : "s"}. Choose one per catalogue item: after a customer accepts, the quote page offers it as the payment step (the deposit, or the amount due on acceptance). Payments are confirmed from your own Stripe account; ClientTurn never holds the money.
            </p>
          )}
          <p>
            {invoicing.allowed
              ? "Invoices are created from a signed quote's payment schedule on the lead page. Reminders follow the offsets above and your contact-frequency limits."
              : invoicing.message}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
