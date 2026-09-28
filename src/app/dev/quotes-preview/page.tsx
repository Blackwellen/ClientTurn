import * as React from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DevShell } from "@/components/dev/dev-shell";
import { QuoteSettingsForm } from "@/components/settings/quotes/quote-settings-form";
import { CatalogueCard } from "@/components/settings/quotes/catalogue-card";
import { LeadQuotesPanel, type QuoteCardData } from "@/components/quotes/lead-quotes-panel";
import { PublicQuoteDocument } from "@/components/quotes/public-quote-document";
import { SignPanel } from "@/components/quotes/sign-panel";
import { PoweredByBadge } from "@/components/public/powered-by-badge";
import { calculateQuote } from "@/lib/quotes/calculate";
import { buildQuoteRenderModel, renderModelHash } from "@/lib/quotes/render-model";
import { presentQuote, presentRevision, type RevisionRow } from "@/lib/quotes/service-core";
import { DEFAULT_QUOTE_SETTINGS } from "@/lib/quotes/settings";
import type { Catalogue } from "@/lib/catalogue/types";

export const metadata: Metadata = { title: "Quotes preview" };
export const dynamic = "force-dynamic";

/**
 * Development-only visual harness for the quote-to-cash surfaces, against
 * fixed data (no database, no session):
 *
 *   /dev/quotes-preview?view=settings | lead | public
 *
 * It 404s outside development and is never linked from the product.
 */

const CATALOGUE: Catalogue = {
  currency: "GBP",
  items: [
    { id: "website-build", name: "Website build", serviceId: null, currency: "GBP", chargeType: "ONE_OFF", unit: "project", unitPriceMinor: 650_000, costPriceMinor: 260_000, vatRate: "STANDARD", tiers: [], options: [], addOnItemIds: ["care-plan"], addOnOnly: false, active: true },
    { id: "care-plan", name: "Care plan: hosting and updates", serviceId: null, currency: "GBP", chargeType: "RECURRING", interval: { unit: "MONTH", count: 1 }, unit: "month", unitPriceMinor: 9_500, costPriceMinor: 2_000, vatRate: "STANDARD", tiers: [], options: [], addOnItemIds: [], addOnOnly: false, active: true },
    { id: "workshop", name: "Discovery workshop", serviceId: null, currency: "GBP", chargeType: "ONE_OFF", unit: "day", unitPriceMinor: 120_000, costPriceMinor: null, vatRate: "STANDARD", tiers: [], options: [], addOnItemIds: [], addOnOnly: false, active: true },
  ],
  bundles: [],
};

function fixture() {
  const calc = calculateQuote({
    currency: "GBP",
    vatRegistered: true,
    catalogue: CATALOGUE,
    lines: [
      { lineId: "l1", kind: "ITEM", itemId: "workshop", quantity: 1 },
      { lineId: "l2", kind: "ITEM", itemId: "website-build", quantity: 1, discount: { type: "PERCENT", bps: 1000 } },
      { lineId: "l3", kind: "ITEM", itemId: "care-plan", quantity: 1, parentLineId: "l2" },
    ],
    payment: { deposit: { type: "PERCENT", bps: 5000 }, remainder: { type: "SINGLE", due: { type: "ON_COMPLETION" } }, recurringBilledUpfront: true },
  });
  if (!calc.ok) throw new Error("fixture does not price");
  const model = buildQuoteRenderModel({
    quote: { number: "Q-00012", revision: 1, title: "New website for Northwind Studio", issuedOn: "2026-09-27", validUntil: "2026-10-27" },
    seller: { name: "Blackwellen Digital", legalName: "Blackwellen Digital Ltd", address: ["14 Wellington Street", "Leeds LS1 4DL"], companyNumber: "12345678", vatNumber: "GB123456789", email: "hello@blackwellen.test" },
    buyer: { name: "Priya Shah", company: "Northwind Studio Ltd", email: "priya@northwind.test", address: ["EC1A 1BB"] },
    calculation: calc.quote,
    terms: "Payment of the deposit starts the work. The balance is due on completion. Quotes are valid for 30 days.",
    customerNote: "Thanks for the call on Tuesday. This covers the discovery day, the build and a year of care.",
    poweredBy: true,
  });
  const revision: RevisionRow = {
    id: "rev-1", quoteId: "q-1", revisionNo: 1, status: "SENT",
    calcInput: { currency: "GBP", vatRegistered: true, catalogue: CATALOGUE, lines: [], customerNote: null },
    calculation: calc.quote, calculationHash: calc.quote.calculationHash, renderModel: model, renderHash: renderModelHash(model),
    pdfObjectKey: null, approvalRequired: false, validUntil: "2026-10-27T23:59:59.999Z", frozenAt: "2026-09-27T10:00:00Z",
    sentAt: "2026-09-27T10:00:00Z", firstViewedAt: "2026-09-27T11:30:00Z", acceptedAt: null, signedAt: null,
    internalNote: null, aiRationale: null, createdByKind: "HUMAN", createdAt: "2026-09-27T09:40:00Z",
  };
  return { model, revision };
}

export default async function QuotesPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const view = typeof params.view === "string" ? params.view : "settings";
  const { model, revision } = fixture();

  if (view === "public") {
    return (
      <div className="min-h-dvh bg-surface-sunken">
        <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6 sm:py-10">
          <PublicQuoteDocument model={model} documentHash={renderModelHash(model)} logoUrl={null} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] font-medium text-content-accent">Download PDF</span>
            <PoweredByBadge />
          </div>
          <SignPanel token={"A".repeat(43)} nonce="preview" esign requireDrawn={false} initialNextStep={null} signedAlready={false} />
        </main>
      </div>
    );
  }

  if (view === "lead") {
    const quote = { id: "q-1", businessId: "b", opportunityId: "o-1", serviceId: null, number: "Q-00012", title: "New website for Northwind Studio", currency: "GBP", status: "VIEWED" as const, currentRevisionId: "rev-1", createdByKind: "HUMAN" as const, requestKey: null, createdAt: "2026-09-27T09:40:00Z", updatedAt: "2026-09-27T11:30:00Z" };
    const data: QuoteCardData = {
      leadId: "lead-1",
      currency: "GBP",
      role: "admin",
      canWrite: true,
      capabilities: {
        builder: { allowed: true, message: null, unlockingPlan: null },
        esign: { allowed: true, message: null, unlockingPlan: null },
        approvals: { allowed: true, message: null, unlockingPlan: null },
        invoicing: { allowed: true, message: null, unlockingPlan: null },
        directClose: { allowed: true, message: null, unlockingPlan: null },
      },
      opportunities: [{ id: "o-1", name: "Website for Northwind Studio", outcome: "OPEN" }],
      items: CATALOGUE.items,
      bundles: [],
      quotes: [
        {
          quote: presentQuote({ ...quote, status: "VIEWED" }),
          current: { ...presentRevision({ ...revision, status: "VIEWED" }, true), status: "VIEWED" },
          revisions: [{ id: "rev-1", revisionNo: 1, status: "VIEWED", sentAt: revision.sentAt, totalGrossMinor: revision.calculation.totals.grossMinor, createdAt: revision.createdAt }],
          events: [
            { type: "quote.created", actorKind: "HUMAN", occurredAt: "2026-09-27T09:40:00Z", revisionId: "rev-1" },
            { type: "quote.sent", actorKind: "HUMAN", occurredAt: "2026-09-27T10:00:00Z", revisionId: "rev-1" },
            { type: "quote.viewed", actorKind: "CUSTOMER", occurredAt: "2026-09-27T11:30:00Z", revisionId: "rev-1" },
          ],
          approvals: [],
        },
      ],
      invoices: [],
      defaultDepositBps: 5000,
      invoicePayMode: "NONE",
    };
    return (
      <DevShell>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="rounded-xl border border-dashed border-line p-6 text-[13px] text-content-muted">Lead record (tabs) would be here.</div>
          <LeadQuotesPanel data={data} />
        </div>
      </DevShell>
    );
  }

  return (
    <DevShell>
      <div className="space-y-4">
        <QuoteSettingsForm
          settings={{ ...DEFAULT_QUOTE_SETTINGS, vatRegistered: true, vatNumber: "GB123456789", legalName: "Blackwellen Digital Ltd", addressLines: ["14 Wellington Street", "Leeds LS1 4DL"], termsText: "Payment of the deposit starts the work.", defaultDepositBps: 5000 }}
          business={{ name: "Blackwellen Digital", logoUrl: null }}
          canEdit
          esign={{ allowed: true, message: null }}
          approvals={{ allowed: true, message: null }}
        />
        <CatalogueCard currency="GBP" items={CATALOGUE.items} bundles={[]} checkoutLinks={[{ id: "deposit", label: "Deposit link", priceText: "£3,900 deposit" }]} checkoutByItem={{ "website-build": "deposit" }} canEdit showCost />
      </div>
    </DevShell>
  );
}
