import "server-only";
import * as React from "react";
import Link from "next/link";
import { FileSignature } from "lucide-react";
import { Skeleton } from "@/components/ui/feedback";
import { liveQuoteDeps } from "@/lib/quotes/effects";
import { getQuote, listQuotes, type QuoteActor } from "@/lib/quotes/service-core";
import { leadInvoices, leadOpportunities, quoteCapabilities } from "@/lib/quotes/queries";
import { loadQuoteSettings, loadWorkspaceCatalogue } from "@/lib/quotes/store";
import { toPublicItem } from "@/lib/catalogue/rows";
import type { BusinessRole } from "@/lib/auth/session";
import { LeadQuotesPanel, type QuoteCardData } from "./lead-quotes-panel";

/**
 * The lead page's Quotes card (gap map §48): every quote on this lead's
 * opportunities, its status, total, validity, timeline and revisions, with
 * the next step for the viewer's role. The reads go through the same service
 * core the operations use; the writes are server actions that run the
 * operations (lib/quotes/actions.ts).
 *
 * States: loading (skeleton), error, plan-limit (not on the plan),
 * integration-required (no catalogue yet, linking to Settings), empty (no
 * quotes: create one), and read-only for viewers.
 */
export async function LeadQuotesCard({
  businessId,
  leadId,
  role,
  userId,
  canWrite,
}: {
  businessId: string;
  leadId: string;
  role: BusinessRole;
  userId: string;
  canWrite: boolean;
}) {
  let data: QuoteCardData | null = null;
  let deniedMessage: string | null = null;
  try {
    const capabilities = await quoteCapabilities(businessId);
    if (!capabilities.builder.allowed) {
      deniedMessage = capabilities.builder.message ?? "Quotes are not on this plan.";
    } else {
      const deps = liveQuoteDeps(businessId);
      const actor: QuoteActor = { kind: "HUMAN", userId, role };
      const internal = role === "owner" || role === "admin";
      const settings = await loadQuoteSettings(businessId);
      const [opportunities, catalogue, list] = await Promise.all([
        leadOpportunities(businessId, leadId),
        loadWorkspaceCatalogue(businessId, settings.currency),
        listQuotes(deps, businessId, { leadId, limit: 10 }),
      ]);
      const details = await Promise.all(list.quotes.map((quote) => getQuote(deps, businessId, actor, { quoteId: quote.id })));
      const invoices = await leadInvoices(businessId, opportunities.map((o) => o.id));
      data = {
        leadId,
        currency: settings.currency,
        role,
        canWrite,
        capabilities,
        opportunities,
        items: catalogue.items.filter((item) => item.active).map((item) => (internal ? item : toPublicItem(item))),
        bundles: catalogue.bundles.filter((bundle) => bundle.active),
        quotes: details,
        invoices,
        defaultDepositBps: settings.defaultDepositBps,
      };
    }
  } catch (error) {
    console.error("[lead quotes] read failed", error);
    return (
      <Shell>
        <p className="px-5 py-4 text-[12.5px] text-content-muted" role="alert">Quotes could not be loaded right now. Nothing has changed; try again shortly.</p>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <p className="px-5 py-4 text-[12.5px] text-content-muted" role="status">
          {deniedMessage}{" "}
          <Link href="/app/settings?section=billing" className="font-medium text-content-accent underline-offset-4 hover:underline">See plans</Link>
        </p>
      </Shell>
    );
  }
  return <LeadQuotesPanel data={data} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface" aria-label="Quotes">
      <header className="flex items-center gap-2 border-b border-line-subtle px-5 py-3">
        <FileSignature className="size-4 text-content-muted" aria-hidden />
        <h2 className="text-[13px] font-semibold text-content">Quotes</h2>
      </header>
      {children}
    </section>
  );
}

export function LeadQuotesSkeleton() {
  return <Skeleton className="h-36 w-full rounded-xl" />;
}
